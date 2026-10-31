#!/usr/bin/env node
'use strict';
// 旧版单机补牌位边界测试：杠（明/暗/加）与东南西北亮牌的统一收口检查。
// 规则：牌墙剩余 > 16（DEAD_WALL）才有补牌位置；剩 16 张时杠不提示、不执行、
// 风牌不动牌、不流局，全部回到正常出牌；剩 17 张时补牌允许（补走最后一张可摸牌）；
// 中发白亮牌不用补牌，不受影响；抢杠先于补牌位判定（本测试只覆盖无抢杠情形）。
// 只加载 01/06/09/08/11（状态 + 牌工具 + 叫牌工具 + 主流程 + AI 叫牌），其余用桩。
// 旧版脚本共用全局作用域（let/const 绑定不在 global 对象属性上），
// 因此状态读写一律走 vm.runInContext，桩函数在加载后覆盖同名全局函数。
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const calls = { indicator: [], drawReplacement: 0, settle: 0, gameTimeout: 0 };
function fakeEl() {
  return { classList: { add() {}, remove() {} }, innerText: '', textContent: '', style: {}, addEventListener() {} };
}
const ctx = {
  window: { addEventListener() {} },
  document: { getElementById: () => null, addEventListener() {}, readyState: 'complete', body: null, createElement: () => fakeEl(), querySelector: () => null },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: '' },
  setTimeout, clearTimeout, setInterval, clearInterval,
  console, Promise, Object, Array, Date, Number, String, JSON, Math,
  $: () => fakeEl(),
  render: () => {}, speak: () => {}, logFlow: () => {},
  nameOf: p => p, tileGlyph: t => t, tileName: t => t,
  tileCompare: (a, b) => (a < b ? -1 : (a > b ? 1 : 0)),
  showIndicator: (t) => { calls.indicator.push(t); },
  hideIndicator: () => {},
};
vm.createContext(ctx);
for (const f of ['js/01-globals-state.js', 'js/06-tiles-utils.js', 'js/09-turn-settlement.js', 'js/08-game-flow-core.js', 'js/11-ai-claim.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
// 加载后覆盖：避免测试路径级联进未加载模块（胡牌判定、结算、计时）
// showIndicator/hideIndicator 由 09 定义（含 DOM 操作），须在加载后用桩覆盖
ctx.showIndicator = (t) => { calls.indicator.push(t); };
ctx.hideIndicator = () => {};
ctx.findRonPriority = () => null; // 无抢杠情形
ctx.checkHu = () => false;
ctx.validateHandCounts = () => {};
ctx.markKongDraw = () => {};
ctx.markKongDiscardIfNeeded = () => {};
ctx.settleWinNow = () => { calls.settle++; };
ctx.gameTimeout = () => { calls.gameTimeout++; };
ctx.drawReplacementAndContinue = () => { calls.drawReplacement++; };
ctx.isTenpai = () => false;
const v = (code) => vm.runInContext(code, ctx);
// vm 域内数组的原型与宿主不同，deepStrictEqual 须先转成宿主数组
const arr = (code) => [...v(code)];

const WINDS = ['1字', '2字', '3字', '4字'];
const DRAGONS = ['5字', '6字', '7字'];
const FILL = ['1万', '2万', '3万', '4万', '5万', '6万', '7万', '8万', '9万'];
function resetBottom(hand, deckCount) {
  v(`gameOver = false; pendingClaim = null; deck = Array(${deckCount}).fill('1万');` +
    `hands = { top: [], left: [], right: [], bottom: ${JSON.stringify(hand)} };` +
    `exposedMelds = { top: [], left: [], right: [], bottom: [] }; discardPile = [];` +
    `windDragonBonus = { top: false, left: false, right: false, bottom: false };` +
    `lastDrawnTile = { top: null, left: null, right: null, bottom: null };` +
    `lastDrawWasFinal = { top: false, left: false, right: false, bottom: false };`);
  calls.indicator.length = 0;
  calls.drawReplacement = 0;
  calls.settle = 0;
  calls.gameTimeout = 0;
}

// 1. 补牌位判定：17 张有、16 张无、0 张无
v('deck = Array(17).fill("1万")');
assert.strictEqual(ctx.hasReplacementSlot(), true, '牌墙 17 张应有补牌位');
v('deck = Array(16).fill("1万")');
assert.strictEqual(ctx.hasReplacementSlot(), false, '牌墙 16 张（荒牌墙）应无补牌位');
v('deck = []');
assert.strictEqual(ctx.hasReplacementSlot(), false, '牌墙空应无补牌位');

// 2. 风牌亮牌：牌墙 16 张时不动牌、不流局、不记 bonus
resetBottom([...WINDS, ...FILL.slice(0, 9)], 16);
assert.strictEqual(ctx.applyReveal('bottom', 'winds'), false, '无补牌位时风牌亮牌应拒绝');
assert.strictEqual(v('gameOver'), false, '风牌被拒时不应流局');
assert.deepStrictEqual(arr('hands.bottom'), [...WINDS, ...FILL.slice(0, 9)], '风牌被拒时手牌须原样不动');
assert.strictEqual(v('exposedMelds.bottom.length'), 0, '风牌被拒时不得产生副露');
assert.strictEqual(v('deck.length'), 16, '风牌被拒时牌墙不得变化');
assert.strictEqual(v('windDragonBonus.bottom'), false, '风牌被拒时不得记 bonus');

// 3. 风牌亮牌：牌墙 17 张时补走最后一张可摸牌，之后剩 16 张荒牌，手牌结构完整
resetBottom([...WINDS, ...FILL.slice(0, 9)], 17);
assert.strictEqual(ctx.applyReveal('bottom', 'winds'), true, '牌墙 17 张时风牌亮牌应成功');
assert.strictEqual(v('exposedMelds.bottom.length'), 1, '风牌亮牌应产生一组副露');
assert.strictEqual(v('exposedMelds.bottom[0].type'), 'winds', '副露类型应为 winds');
assert.strictEqual(v('hands.bottom.length'), 10, '13 - 4（亮出）+ 1（补牌）= 10 张手牌');
assert.strictEqual(v('deck.length'), 16, '补牌后牌墙应剩 16 张荒牌');
assert.strictEqual(v('lastDrawWasFinal.bottom'), true, '补走最后一张可摸牌应记 final');
assert.strictEqual(v('gameOver'), false, '补牌成功后不应流局');

// 4. 中发白亮牌：牌墙 16 张时照常亮（不用补牌），不摸牌墙
resetBottom([...DRAGONS, ...FILL, '1条'], 16);
assert.strictEqual(ctx.applyReveal('bottom', 'dragons'), true, '中发白亮牌不受补牌位影响');
assert.strictEqual(v('exposedMelds.bottom.length'), 1, '中发白亮牌应产生一组副露');
assert.strictEqual(v('hands.bottom.length'), 10, '13 - 3 = 10 张手牌');
assert.strictEqual(v('deck.length'), 16, '中发白亮牌不得摸牌墙');
assert.strictEqual(v('gameOver'), false, '中发白亮牌后不应流局');

// 5. 自家杠提示：16 张时不提示，17 张时提示
resetBottom(['1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1条', '2条', '3条', '4条', '5万'], 16);
v(`exposedMelds.bottom = [{ type: 'peng', tiles: ['5万', '5万', '5万'] }];`);
ctx.offerSelfGangIfAny();
assert.strictEqual(v('pendingClaim'), null, '无补牌位时不得提示自家杠');
assert.strictEqual(calls.indicator.length, 0, '无补牌位时不得亮杠灯');
resetBottom(['1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1条', '2条', '3条', '4条', '5万'], 17);
v(`exposedMelds.bottom = [{ type: 'peng', tiles: ['5万', '5万', '5万'] }];`);
ctx.offerSelfGangIfAny();
assert.strictEqual(v('pendingClaim.mode'), 'selfGang', '有补牌位时应提示自家杠');
assert.strictEqual(v('pendingClaim.kind'), 'jia', '碰过的牌摸到第 4 张应为加杠');

// 6. 自家加杠执行：16 张时不执行（碰不变、手牌不动、不补牌、不流局）
resetBottom(['1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1条', '2条', '3条', '4条', '5万'], 16);
v(`exposedMelds.bottom = [{ type: 'peng', tiles: ['5万', '5万', '5万'] }];` +
  `pendingClaim = { mode: 'selfGang', kind: 'jia', tile: '5万' };`);
ctx.executeSelfGang();
assert.strictEqual(v('pendingClaim'), null, '加杠被拒后提示须清除');
assert.strictEqual(v('exposedMelds.bottom[0].type'), 'peng', '加杠被拒时碰不得变杠');
assert.ok(v('hands.bottom').includes('5万'), '加杠被拒时第 4 张须留在手里');
assert.strictEqual(calls.drawReplacement, 0, '加杠被拒时不得补牌');
assert.strictEqual(v('gameOver'), false, '加杠被拒时不应流局');

// 7. 自家加杠执行：17 张时执行并补牌
resetBottom(['1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1条', '2条', '3条', '4条', '5万'], 17);
v(`exposedMelds.bottom = [{ type: 'peng', tiles: ['5万', '5万', '5万'] }];` +
  `pendingClaim = { mode: 'selfGang', kind: 'jia', tile: '5万' };`);
ctx.executeSelfGang();
assert.strictEqual(v('exposedMelds.bottom[0].type'), 'gang', '有补牌位时加杠应执行');
assert.ok(!v('hands.bottom').includes('5万'), '加杠执行后第 4 张须离手');
assert.strictEqual(calls.drawReplacement, 1, '加杠执行后应走补牌流程');

// 8. 自家暗杠执行：16 张时不执行（4 张 intact、不补牌）
resetBottom(['5万', '5万', '5万', '5万', '1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1条'], 16);
v(`pendingClaim = { mode: 'selfGang', kind: 'an', tile: '5万' };`);
ctx.executeSelfGang();
assert.strictEqual(v('exposedMelds.bottom.length'), 0, '暗杠被拒时不得产生副露');
assert.strictEqual(v('hands.bottom').filter(t => t === '5万').length, 4, '暗杠被拒时 4 张须原样留在手里');
assert.strictEqual(calls.drawReplacement, 0, '暗杠被拒时不得补牌');
assert.strictEqual(v('gameOver'), false, '暗杠被拒时不应流局');

// 9. 别人打牌的叫牌：16 张时杠降为不提示（碰仍可），17 张时杠可提示
resetBottom(['5万', '5万', '5万', '1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1条', '2条'], 16);
ctx.checkClaimOrAdvance('top', '5万');
assert.strictEqual(v('pendingClaim.canGang'), false, '无补牌位时叫牌不得给杠');
assert.strictEqual(v('pendingClaim.canPeng'), true, '无补牌位时碰仍可给');
resetBottom(['5万', '5万', '5万', '1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1条', '2条'], 17);
ctx.checkClaimOrAdvance('top', '5万');
assert.strictEqual(v('pendingClaim.canGang'), true, '有补牌位时叫牌应给杠');

// 10. AI 叫牌：16 张时凑齐 3 张暗的也只能碰（降级），17 张时杠
resetBottom([], 16);
v(`hands = { top: [], left: ['5万', '5万', '5万', '1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1条', '2条'], right: [], bottom: [] };` +
  `discardPile = [{ player: 'top', tile: '5万' }];`);
ctx.aiPengClaim('left', '5万');
assert.strictEqual(v('exposedMelds.left[0].type'), 'peng', '无补牌位时 AI 叫牌应降为碰');
assert.strictEqual(v('hands.left').filter(t => t === '5万').length, 1, '降为碰只应取 2 张');
assert.strictEqual(v('deck.length'), 16, '降为碰不得摸牌墙');
resetBottom([], 17);
v(`hands = { top: [], left: ['5万', '5万', '5万', '1万', '2万', '3万', '4万', '6万', '7万', '8万', '9万', '1条', '2条'], right: [], bottom: [] };` +
  `discardPile = [{ player: 'top', tile: '5万' }];`);
ctx.aiPengClaim('left', '5万');
assert.strictEqual(v('exposedMelds.left[0].type'), 'gang', '有补牌位时 AI 叫牌应杠');
assert.strictEqual(v('hands.left').filter(t => t === '5万').length, 0, '杠应取 3 张暗牌');
assert.strictEqual(v('deck.length'), 16, '杠后补牌应摸走 1 张（17→16）');
assert.strictEqual(v('lastDrawWasFinal.left'), true, '杠后补走最后一张可摸牌应记 final');

console.log('replacement-slot (old) tests passed');
