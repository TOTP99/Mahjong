// ---------- 基础常量与全局状态 ----------
const suits = ['万', '条', '筒'];
const honors = ['东', '南', '西', '北', '中', '发', '白'];
const PLAYERS = ['top', 'left', 'right', 'bottom'];
const turnOrder = ['bottom', 'right', 'top', 'left'];
const baseNames = { top: '西', left: '北', right: '南', bottom: '东' };
const statOrder = ['right', 'top', 'left', 'bottom'];
const statAvatar = { right: '🦁', top: '🐲', left: '🐯', bottom: '🐈' };

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

// 一局定输赢后调用：赢家所属性格信心上升，点炮方所属性格信心下降（越玩战绩越好，AI下次就更敢按这个性格的路子来）
function learnFromWin(winnerPlayer, payerPlayer) {
    for (const p of ['top', 'left', 'right']) {
        const style = aiPersonality[p];
        if (!style) continue;
        if (p === winnerPlayer) aiLearn.confidence[style] = clampConfidence(aiLearn.confidence[style] + 0.3);
        else if (p === payerPlayer) aiLearn.confidence[style] = clampConfidence(aiLearn.confidence[style] - 0.5);
    }
    aiLearn.games += 1;
    saveAiLearn();
}
// 流局时调用：听牌的性格小幅加分，没听牌的小幅减分
function learnFromDraw(tenpaiPlayers) {
    for (const p of ['top', 'left', 'right']) {
        const style = aiPersonality[p];
        if (!style) continue;
        aiLearn.confidence[style] = clampConfidence(aiLearn.confidence[style] + (tenpaiPlayers.includes(p) ? 0.05 : -0.1));
    }
    aiLearn.games += 1;
    saveAiLearn();
}

// DOM 查询简写：全文本用 $(id) 代替 document.getElementById(id)
const $ = (id) => document.getElementById(id);

/* ==================== 函数索引（按职责分类，函数按原顺序散落在下文，此处仅作导航） ====================
 * 存档/进度：      cloneState scheduleSaveProgress flushSaveProgress saveGameProgress loadGameProgress resumeFromSave
 * 算番/胡牌判定：   hasSiGuiYi scoreWinningHand settleScore analyzeHu checkHu decompose allTileTypes
 *                  isTenpai getWinningTiles getWinningTilesOf checkWindDragonPattern
 * 骰子开局仪式：    diceEls initDicePips playDiceSound onTableTap resetDiceDom startDiceRitual
 *                  showDiceResetMenu cancelDiceRitual confirmFullReset
 * 牌堆/牌面工具：   isDangerousTile buildDeck shuffle tileSuit tileRank tileGlyph tileName tileCompare
 * 游戏流程/回合：   initGame declareDraw applyReveal offerReveal confirmReveal continueAfterFirstTurnCheck
 *                  offerSelfGangIfAny executeSelfGang nextTurn advanceTurn handleDiscard
 *                  drawReplacementAndContinue rotateDealer startGame
 * 吃碰杠/AI决策：   canPeng canGang findChiCombos protectsThreeSuits tileSeenCount isTileDead tileKeepTier
 *                  isTileDangerousFor wallUrgencyBonus chooseAiDiscardTile aiDiscard isGoingForTriplets
 *                  shouldAiPeng findAiPeng findRonPriority nextPlayerOf findAiChi aiPengClaim aiChiClaim
 *                  aiDrawReplacement resolveAiPengOrAdvance checkClaimOrAdvance acceptClaim callGang
 *                  callPeng callChi chooseChiCombo closeChiChoice executeChi declineClaim offerHu
 * 渲染/弹窗/UI：    renderTile renderExposedFace renderExposedBack renderMeldGroup render markDealer
 *                  showResultModal renderSettlementView toggleSettlementAdjust onSettlementPayoutEdit
 *                  adjustSettlementPayoutFactor applySettlementPayoutValue resetSettlementPayouts
 *                  closeResultModal showIndicator hideIndicator highlightActive syncBodyScrollLock nameOf stripEmoji speak logFlow
 * ==================================================================================================== */

// 渲染左侧空地里的状态面板：每位玩家一行，横着写 头像 风位 奖杯 庄家 听牌提示（例如 🐲 西 🏆 🎲 ⚠️）
function renderStatRow(elId, cellFor) {
    const el = $(elId);
    if (!el) return;
    el.innerHTML = statOrder.map(p => `<span class="stat-cell">${cellFor(p)}</span>`).join('');
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
        renderStatRow('stat-medal', p => (maxScore > 0 && scores[p] === maxScore) ? '🏆' : '');
        renderStatRow('stat-dealer', p => p === dealer ? '🎲' : '');
        renderStatRow('stat-tenpai', p => isTenpai(p) ? '⚠️' : '');
    } else {
        // 横屏：侧栏每人一行
        const ps = $('player-stats');
        if (ps) {
            ps.innerHTML = statOrder.map(p => {
                const medal = (maxScore > 0 && scores[p] === maxScore) ? ' 🏆' : '';
                const dealerMark = p === dealer ? ' 🎲' : '';
                const tenpaiMark = isTenpai(p) ? ' ⚠️' : '';
                return `<div class="stat-line">${statAvatar[p]} ${baseNames[p]}${medal}${dealerMark}${tenpaiMark}</div>`;
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

function cloneState(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/** 防抖写盘：避免每次 render 都同步 stringify 造成卡顿 */
function scheduleSaveProgress() {
    if (restoringGame) return;
    if (saveProgressTimer) clearTimeout(saveProgressTimer);
    saveProgressTimer = setTimeout(() => {
        saveProgressTimer = 0;
        saveGameProgress();
    }, 280);
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
            pendingClaimMode: pendingClaim && pendingClaim.mode === 'nextGame' ? 'nextGame' : null
        }));
    } catch (e) { /* 隐私模式等不可用时忽略 */ }
}

// 刷新/切后台前强制写入，避免 280ms 防抖窗口内丢进度
window.addEventListener('pagehide', flushSaveProgress);
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
        showIndicator('🔔 下一局', true);
        logFlow((winner ? (nameOf(winner) + ' 胡了。') : '流局。') + '点✅开下一局（积分与庄家已保留）');
        return;
    }
    if (player === 'bottom') {
        logFlow('轮到你，请点击一张牌出牌');
        offerSelfGangIfAny();
    } else {
        logFlow('继续对局…');
        setTimeout(() => {
            const needDiscard = hands[player].length % 3 === 2;
            if (needDiscard) aiDiscard(player);
            else nextTurn();
        }, 600);
    }
}
