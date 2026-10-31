#!/usr/bin/env node
'use strict';
// 旧版单机胡牌冒烟测试：checkHu 执行的是完整穷胡判定（不只是牌型），
// 须同时满足开门、三门齐、幺九、刻子。只加载 01/06/07/02/08（状态 + 牌工具 + 胡牌 + 计分常量 + 主流程 tileCompare）。
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const ctx = {
  document: { getElementById: () => null, addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
  window: { addEventListener() {} },
  setTimeout, clearTimeout, console, Math, Array, Object, JSON,
};
vm.createContext(ctx);
for (const f of ['js/01-globals-state.js', 'js/06-tiles-utils.js', 'js/07-hu-detection.js', 'js/02-scoring.js', 'js/08-game-flow-core.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
// 副露 111筒（开门 + 筒门 + 幺九刻子）+ 暗牌 123万/456万/789条/55条对子
const hand = ['1万', '2万', '3万', '4万', '5万', '6万', '7条', '8条', '9条', '5条', '5条'];
const peng = [{ type: 'peng', tiles: ['1筒', '1筒', '1筒'] }];
assert.strictEqual(ctx.checkHu(hand, peng, 'bottom'), true, '满足开门+三门齐+幺九+刻子应胡');
assert.strictEqual(ctx.checkHu(hand, [], 'bottom'), false, '未开门不应胡（门清不算）');
const broken = ['1万', '2万', '3万', '4万', '5万', '6万', '7条', '8条', '9条', '5条', '6条'];
assert.strictEqual(ctx.checkHu(broken, peng, 'bottom'), false, '不成牌（无将）不应胡');
console.log('engine smoke (old) tests passed');
