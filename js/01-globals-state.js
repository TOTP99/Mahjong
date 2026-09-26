// ---------- 基础常量与全局状态 ----------
const suits = ['万', '条', '筒'];
const honors = ['东', '南', '西', '北', '中', '发', '白'];
const PLAYERS = ['top', 'left', 'right', 'bottom'];
const turnOrder = ['bottom', 'right', 'top', 'left'];
const baseNames = { top: '西', left: '北', right: '南', bottom: '东' };
const statOrder = ['right', 'top', 'left', 'bottom'];
const statAvatar = {
    right: '<img class="stat-avatar-img" src="avatars/stat-lion.webp" alt="南" draggable="false">',
    top: '<img class="stat-avatar-img" src="avatars/stat-dragon.webp" alt="西" draggable="false">',
    left: '<img class="stat-avatar-img" src="avatars/stat-tiger.webp" alt="北" draggable="false">',
    bottom: '<img class="stat-avatar-img" src="avatars/stat-cat.webp" alt="东" draggable="false">'
};

let deck = [];
let hands = { top: [], left: [], right: [], bottom: [] };
let exposedMelds = { top: [], left: [], right: [], bottom: [] };
let discardPile = [];
let currentIndex = 0;
let gameOver = false;
let pendingClaim = null;
let dealer = 'bottom';
let winner = null;
let selectedIndex = null;
let lastDrawnIndex = null;
let scores = { top: 0, left: 0, right: 0, bottom: 0 };
let windDragonBonus = { top: false, left: false, right: false, bottom: false };
let firstTurnPending = { top: true, left: true, right: true, bottom: true };
let lastDrawnTile = { top: null, left: null, right: null, bottom: null };
let lastDrawWasFinal = { top: false, left: false, right: false, bottom: false };
let aiWaitTiles = { top: [], left: [], right: [] };
let lastSettlement = null;
// 杠上开花 / 杠后点炮：杠后补牌标记；打出后转为点炮×2标记
let afterKongDrawPlayer = null;   // 刚杠完并已补牌、尚未出牌的玩家
let afterKongDiscardPlayer = null; // 刚杠后打出的那一张，点炮时×2


// ---------- AI 学习：跨局记忆三种性格(保守/激进/精明)的历史战绩，微调决策倾向 ----------
const AI_LEARN_KEY = 'qionghu_mahjong_ai_learn_v1';
let aiLearn = { games: 0, confidence: { conservative: 0, aggressive: 0, shrewd: 0 } };
function loadAiLearn() {
    try {
        const raw = localStorage.getItem(AI_LEARN_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.confidence) {
            aiLearn = {
                games: parsed.games || 0,
                confidence: {
                    conservative: parsed.confidence.conservative || 0,
                    aggressive: parsed.confidence.aggressive || 0,
                    shrewd: parsed.confidence.shrewd || 0
                }
            };
        }
    } catch (e) { /* 本地存储不可用则用默认值 */ }
}
function saveAiLearn() {
    try { localStorage.setItem(AI_LEARN_KEY, JSON.stringify(aiLearn)); } catch (e) {}
}
loadAiLearn();

function clampConfidence(v) { return Math.max(-3, Math.min(3, v)); }

// AI 学习防抖保存（减少频繁写盘）
let aiLearnSaveTimer = 0;
function scheduleSaveAiLearn() {
    if (aiLearnSaveTimer) clearTimeout(aiLearnSaveTimer);
    aiLearnSaveTimer = setTimeout(() => {
        aiLearnSaveTimer = 0;
        saveAiLearn();
    }, 600);
}

// 一局定输赢后调用：赢家所属性格信心上升，点炮方所属性格信心下降（越玩战绩越好，AI下次就更敢按这个性格的路子来）
function learnFromWin(winnerPlayer, payerPlayer) {
    for (const p of ['top', 'left', 'right']) {
        const style = aiPersonality[p];
        if (!style) continue;
        if (p === winnerPlayer) aiLearn.confidence[style] = clampConfidence(aiLearn.confidence[style] + 0.3);
        else if (p === payerPlayer) aiLearn.confidence[style] = clampConfidence(aiLearn.confidence[style] - 0.5);
    }
    aiLearn.games += 1;
    scheduleSaveAiLearn();
}
// 流局时调用：听牌的性格小幅加分，没听牌的小幅减分
function learnFromDraw(tenpaiPlayers) {
    for (const p of ['top', 'left', 'right']) {
        const style = aiPersonality[p];
        if (!style) continue;
        aiLearn.confidence[style] = clampConfidence(aiLearn.confidence[style] + (tenpaiPlayers.includes(p) ? 0.05 : -0.1));
    }
    aiLearn.games += 1;
    scheduleSaveAiLearn();
}

// DOM 查询简写：全文本用 $(id) 代替 document.getElementById(id)
const $ = (id) => document.getElementById(id);

// ---------- 局号 + 游戏流程定时器 ----------
// gameEpoch：每开一局（initGame）+1。流程里的延时回调（AI 摸牌/出牌/吃碰后出牌等）
// 都通过 gameTimeout 调度：局号变了（清零重启/开下一局）就直接作废，不会串到新局里多摸/多打一次；
// 骰子仪式期间（diceBusy）自动顺延，不让 AI 在清零菜单弹出时继续推进牌局、覆盖你的吃碰杠提示。
let gameEpoch = 0;
function gameTimeout(fn, ms) {
    const epoch = gameEpoch;
    const run = () => {
        if (epoch !== gameEpoch) return; // 已经不是这一局了
        if (typeof diceBusy !== 'undefined' && diceBusy) { setTimeout(run, 200); return; } // 骰子仪式期间暂停
        fn();
    };
    return setTimeout(run, ms);
}

// ---------- 牌总数守恒检查 ----------
// 一副牌固定 136 张：牌墙 + 四家暗牌 + 四家副露 + 弃牌堆，任何时刻都应等于这个数
// （局已结束时不检查：抢杠等结算路径会把牌挪来挪去）
function totalTilesOf(s) {
    let n = ((s.deck || []).length) + ((s.discardPile || []).length);
    for (const p of PLAYERS) {
        n += ((s.hands && s.hands[p]) || []).length;
        for (const m of ((s.exposedMelds && s.exposedMelds[p]) || [])) n += ((m && m.tiles) || []).length;
    }
    return n;
}
const FULL_DECK_SIZE = suits.length * 9 * 4 + honors.length * 4; // 136
let _lastTileWarnKey = '';
function checkTileConservation(reason) {
    if (gameOver) return true;
    const n = totalTilesOf({ deck, discardPile, hands, exposedMelds });
    if (n === FULL_DECK_SIZE) return true;
    const key = reason + ':' + n;
    if (key !== _lastTileWarnKey) {
        _lastTileWarnKey = key;
        try { console.warn('[tile-check] 牌总数异常', n, '/', FULL_DECK_SIZE, '@' + reason, { deck: deck.length, discard: discardPile.length, hands: cloneState(hands), melds: cloneState(exposedMelds) }); } catch (e) {}
        try { logFlow('【异常】牌总数异常 ' + n + '/' + FULL_DECK_SIZE + (reason ? ' @' + reason : '')); } catch (e) {}
    }
    return false;
}

// 全部 JS 按 01→14 顺序加载、共享全局作用域（无 module）；各文件职责见 README.md 的目录/改哪里表。

// 渲染左侧空地里的状态面板：每位玩家一行，横着写 头像图标 风位 奖杯 庄家 听牌提示（例如 [头像] 西 ★ 庄 听）
function renderStatRow(elId, cellFor) {
    const el = $(elId);
    if (!el) return;
    el.innerHTML = statOrder.map(p => `<span class="stat-cell" data-player="${p}">${cellFor(p)}</span>`).join('');
}

function ensurePortraitStatRows() {
    const ps = $('player-stats');
    if (!ps) return;
    if ($('stat-avatar') && $('stat-wind') && $('stat-medal') && $('stat-dealer') && $('stat-tenpai')) return;
    ps.innerHTML = ''
        + '<div class="stat-row avatar-row" id="stat-avatar"></div>'
        + '<div class="stat-row" id="stat-wind"></div>'
        + '<div class="stat-row" id="stat-medal"></div>'
        + '<div class="stat-row" id="stat-dealer"></div>'
        + '<div class="stat-row" id="stat-tenpai"></div>';
}

function markDealer() {
    const maxScore = Math.max(...Object.values(scores));
    const isPortrait = document.body && document.body.classList.contains('portrait-layout');
    if (isPortrait) {
        // 竖屏：原版牌墙下五行列表（头像/风位/奖杯/庄/听）
        ensurePortraitStatRows();
        renderStatRow('stat-avatar', p => statAvatar[p]);
        renderStatRow('stat-wind', p => baseNames[p]);
        renderStatRow('stat-medal', p => (maxScore > 0 && scores[p] === maxScore) ? '<span class="ico-star">★</span>' : '');
        renderStatRow('stat-dealer', p => p === dealer ? '<span class="ico-badge ico-dealer">庄</span>' : '');
        renderStatRow('stat-tenpai', p => isTenpai(p) ? '<span class="ico-badge ico-tenpai">听</span>' : '');
    } else {
        // 横屏：侧栏每人一行
        const ps = $('player-stats');
        if (ps) {
            ps.innerHTML = statOrder.map(p => {
                const medal = (maxScore > 0 && scores[p] === maxScore) ? ' <span class="ico-star">★</span>' : '';
                const dealerMark = p === dealer ? ' <span class="ico-badge ico-dealer">庄</span>' : '';
                const tenpaiMark = isTenpai(p) ? ' <span class="ico-badge ico-tenpai">听</span>' : '';
                return `<div class="stat-line" data-player="${p}">${statAvatar[p]} ${baseNames[p]}${medal}${dealerMark}${tenpaiMark}</div>`;
            }).join('');
        }
    }
    for (const p of PLAYERS) {
        const s = scores[p];
        const el = $('score-' + p);
        if (el) el.innerText = (s >= 0 ? '+' : '') + s;
    }
    scheduleSaveProgress();
}

// 完整对局记忆（积分/庄家/牌面/轮次）→ localStorage，刷新后原样恢复
const MAHJONG_STORAGE_KEY = 'qionghu_mahjong_progress_v2';
let restoringGame = false;
let saveProgressTimer = 0;
let savedPendingReveal = null; // 存档里记下的「等你选亮牌」类型，读档后由 resumeFromSave 使用

function cloneState(obj) {
    // 优先使用原生 structuredClone（更快），失败时回退到 JSON 方式
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(obj);
        } catch (e) {
            // 极少数环境失败时回退
        }
    }
    return JSON.parse(JSON.stringify(obj));
}

/** 防抖写盘：避免每次 render 都同步 stringify 造成卡顿 */
function scheduleSaveProgress() {
    if (restoringGame) return;
    if (saveProgressTimer) clearTimeout(saveProgressTimer);
    saveProgressTimer = setTimeout(() => {
        saveProgressTimer = 0;
        saveGameProgress();
    }, 400);
}

/** 立刻落盘（取消未执行的防抖），用于关键节点与页面关闭前 */
function flushSaveProgress() {
    if (restoringGame) return;
    if (saveProgressTimer) {
        clearTimeout(saveProgressTimer);
        saveProgressTimer = 0;
    }
    saveGameProgress();
}

function saveGameProgress() {
    if (restoringGame) return;
    if (!checkTileConservation('save')) return; // 牌数不对的异常状态不落盘，保留上一份正常存档
    try {
        localStorage.setItem(MAHJONG_STORAGE_KEY, JSON.stringify({
            v: 2,
            scores, dealer, currentIndex, gameOver, winner,
            selectedIndex, lastDrawnIndex,
            deck: cloneState(deck),
            hands: cloneState(hands),
            exposedMelds: cloneState(exposedMelds),
            discardPile: cloneState(discardPile),
            windDragonBonus: cloneState(windDragonBonus),
            firstTurnPending: cloneState(firstTurnPending),
            lastDrawnTile: cloneState(lastDrawnTile),
            lastDrawWasFinal: cloneState(lastDrawWasFinal),
            aiWaitTiles: cloneState(aiWaitTiles),
            // 仅持久化「下一局」；进行中吃碰杠刷新后由玩家重选，避免半自动卡死
            pendingClaimMode: pendingClaim && pendingClaim.mode === 'nextGame' ? 'nextGame' : null,
            // 等你选「亮牌/不亮」时刷新：记下类型，读档后重新弹窗
            pendingRevealKind: (typeof pendingReveal !== 'undefined') ? pendingReveal : null
        }));
    } catch (e) { /* 隐私模式等不可用时忽略 */ }
}

// 刷新/切后台前强制写入，避免防抖窗口内丢进度；同时强制落盘 AI 学习数据
window.addEventListener('pagehide', () => {
    if (aiLearnSaveTimer) {
        clearTimeout(aiLearnSaveTimer);
        aiLearnSaveTimer = 0;
        saveAiLearn();
    }
    flushSaveProgress();
});
/* resize / orientationchange → bindOrientationListeners → handleOrientationEvent（内含 fitBottomHand） */
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSaveProgress();
});

function loadGameProgress() {
    try {
        // 兼容旧版仅存 scores+dealer 的存档
        let raw = localStorage.getItem(MAHJONG_STORAGE_KEY);
        if (!raw) {
            const legacy = localStorage.getItem('qionghu_mahjong_progress_v1');
            if (legacy) {
                const old = JSON.parse(legacy);
                if (old && old.scores) {
                    for (const p of PLAYERS) {
                        if (typeof old.scores[p] === 'number') scores[p] = old.scores[p];
                    }
                }
                if (old && PLAYERS.includes(old.dealer)) {
                    dealer = old.dealer;
                }
            }
            return false; // 无完整对局，走 initGame
        }
        const saved = JSON.parse(raw);
        if (!saved || typeof saved !== 'object') return false;

        // 始终恢复跨局指标
        if (saved.scores) {
            for (const p of PLAYERS) {
                if (typeof saved.scores[p] === 'number') scores[p] = saved.scores[p];
            }
        }
        if (PLAYERS.includes(saved.dealer)) {
            dealer = saved.dealer;
        }

        // 完整对局快照（v2）才恢复牌面
        if (saved.v !== 2 || !Array.isArray(saved.deck) || !saved.hands) return false;
        // 进行中的牌局：牌总数必须是 136，否则说明存档已损坏，放弃牌面、只保留积分/庄家重开一局
        if (!saved.gameOver && totalTilesOf(saved) !== FULL_DECK_SIZE) {
            try { console.warn('[tile-check] 存档牌总数异常，已放弃该存档牌面：', totalTilesOf(saved)); } catch (e) {}
            return false;
        }

        restoringGame = true;
        deck = saved.deck;
        hands = saved.hands;
        exposedMelds = saved.exposedMelds || { top: [], left: [], right: [], bottom: [] };
        discardPile = saved.discardPile || [];
        currentIndex = typeof saved.currentIndex === 'number' ? saved.currentIndex : turnOrder.indexOf(dealer);
        gameOver = !!saved.gameOver;
        winner = saved.winner || null;
        windDragonBonus = saved.windDragonBonus || { top: false, left: false, right: false, bottom: false };
        firstTurnPending = saved.firstTurnPending || { top: false, left: false, right: false, bottom: false };
        lastDrawnTile = saved.lastDrawnTile || { top: null, left: null, right: null, bottom: null };
        lastDrawWasFinal = saved.lastDrawWasFinal || { top: false, left: false, right: false, bottom: false };
        aiWaitTiles = saved.aiWaitTiles || { top: [], left: [], right: [] };
        selectedIndex = saved.selectedIndex ?? null;
        lastDrawnIndex = saved.lastDrawnIndex ?? null;
        pendingClaim = saved.pendingClaimMode === 'nextGame' ? { mode: 'nextGame' } : null;
        savedPendingReveal = saved.pendingRevealKind || null;
        restoringGame = false;
        return true;
    } catch (e) {
        restoringGame = false;
        return false; /* 存档损坏时忽略，从当前默认状态开始 */
    }
}

// 从存档恢复后：重绘桌面，若轮到 AI 且局未结束则继续其出牌
function resumeFromSave() {
    render();
    const player = turnOrder[currentIndex];
    highlightActive(player);
    if (gameOver) {
        // 结算弹窗无法原样恢复：统一给出「开下一局」入口（庄家轮转仍按 winner 计算）
        pendingClaim = { mode: 'nextGame' };
        showIndicator('下一局', true);
        logFlow((winner ? (nameOf(winner) + ' 胡了。') : '流局。') + '点确认开下一局（积分与庄家已保留）');
        return;
    }
    // 情形一：刷新时你正在「亮牌/不亮」弹窗里——重新弹出，选完会接着做自摸判断
    if (player === 'bottom' && savedPendingReveal) {
        const kind = savedPendingReveal;
        savedPendingReveal = null;
        if (hands.bottom.length % 3 === 2 && checkWindDragonPattern(hands.bottom) === kind) {
            offerReveal(kind);
            return;
        }
    }
    // 情形二：AI 刚打出牌、正在等你吃碰杠时刷新——currentIndex 还停在打牌那家，
    // 他手牌是 %3==1，但这一轮其实已经摸过并打完了。不能当成“还没摸牌”再摸一次
    // （否则他会连摸两次、下家被跳过、你的吃碰杠机会也丢了），应重新走吃碰杠/换人流程
    const lastDiscard = discardPile[discardPile.length - 1];
    if (player !== 'bottom' && hands[player].length % 3 === 1 && lastDiscard && lastDiscard.player === player) {
        logFlow('继续对局…');
        gameTimeout(() => checkClaimOrAdvance(player, lastDiscard.tile), 600);
        return;
    }
    // 恢复时先判断“当前该轮到的这家”这一轮是否已经摸过牌：
    // 手牌数 %3==2 说明已摸牌、正等着出牌；%3==1 说明这一轮还没摸牌，需要先补摸，
    // 否则这一轮会被直接跳过出牌提示，导致这张牌永远留在牌堆里没人摸到（表现为手牌永久少一张）。
    // 之前只有 AI 分支（else）做了这个判断，"你"（bottom）分支没做，是本 bug 的根因。
    const needDiscard = hands[player].length % 3 === 2;
    if (player === 'bottom') {
        if (needDiscard) {
            logFlow('轮到你，请点击一张牌出牌');
            offerSelfGangIfAny();
        } else {
            logFlow('继续对局…');
            gameTimeout(() => nextTurn(), 600);
        }
    } else {
        logFlow('继续对局…');
        gameTimeout(() => {
            if (needDiscard) aiDiscard(player);
            else nextTurn();
        }, 600);
    }
}
