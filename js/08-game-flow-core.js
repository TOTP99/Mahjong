// ---------- 游戏流程 ----------
const DEAD_WALL = 16; // 荒牌墙：摸到只剩这些时流局

/** 轮换庄家（从 12-render.js 移入：这是流程逻辑，不是渲染） */
function rotateDealer() {
    // 有人胡牌：赢家是庄家就连庄，否则下庄
    // 流局（winner为null）：无条件连庄
    const dealerStays = winner === null ? true : (winner === dealer);
    if (!dealerStays) dealer = nextPlayerOf(dealer);
}

function initGame() {
    gameEpoch++; // 新的一局：让上一局遗留的延时回调全部作废
    resetSpeechQueue();
    buildDeck();
    hands = { top: [], left: [], right: [], bottom: [] };
    exposedMelds = { top: [], left: [], right: [], bottom: [] };
    discardPile = [];
    gameOver = false;
    winner = null;
    selectedIndex = null;
    lastDrawnIndex = null;
    windDragonBonus = { top: false, left: false, right: false, bottom: false };
    firstTurnPending = { top: true, left: true, right: true, bottom: true };
    lastDrawnTile = { top: null, left: null, right: null, bottom: null };
    lastDrawWasFinal = { top: false, left: false, right: false, bottom: false };
    aiWaitTiles = { top: [], left: [], right: [] };
    pendingClaim = null;
    lastSettlement = null;
    clearKongFlags();
    resetAiAxisUsed();
    resetLastCallTurn();
    handTurnCount = 0;
    currentIndex = turnOrder.indexOf(dealer);
    for (const p of PLAYERS) hands[p] = deck.splice(0, 13).sort(tileCompare);
    snapshotRankAtDeal(); // AI 3.0 名次感：开局记四家名次快照，结算时看名次变化归因
    markDealer();
    render();
    logFlow('发牌完成，游戏开始');
    gameTimeout(() => nextTurn(), 600);
}

const suitOrder = ['万', '条', '筒', '字'];
function tileCompare(a, b) {
    const sa = tileSuit(a), sb = tileSuit(b);
    if (sa !== sb) return suitOrder.indexOf(sa) - suitOrder.indexOf(sb);
    return tileRank(a) - tileRank(b);
}

/** 废牌区（牌池）专用排序：筒→条→万，各花色内部从9到1；字牌按 中发白东西南北 */
const poolSuitOrder = ['筒', '条', '万', '字'];
const poolHonorOrder = ['中', '发', '白', '东', '西', '南', '北'];
function poolTileCompare(a, b) {
    const sa = tileSuit(a), sb = tileSuit(b);
    if (sa !== sb) return poolSuitOrder.indexOf(sa) - poolSuitOrder.indexOf(sb);
    if (sa === '字') {
        const ia = poolHonorOrder.indexOf(honors[tileRank(a) - 1]);
        const ib = poolHonorOrder.indexOf(honors[tileRank(b) - 1]);
        return ia - ib;
    }
    return tileRank(b) - tileRank(a); // 数牌从9到1
}

// 流局：查一下四家听牌情况再宣布
function declareDraw() {
    gameOver = true;
    const tenpaiFlags = {};
    turnOrder.forEach(p => { tenpaiFlags[p] = isTenpai(p); });
    const tenpaiPlayers = turnOrder.filter(p => tenpaiFlags[p]);
    const notTenpai = turnOrder.filter(p => !tenpaiFlags[p]);
    let msg = '牌墙已尽，流局。';
    if (tenpaiPlayers.length === 4) {
        msg += '四家都听牌。';
    } else if (tenpaiPlayers.length === 0) {
        msg += '没有人听牌。';
    } else {
        msg += '听牌：' + tenpaiPlayers.map(nameOf).join('、') + '；不听：' + notTenpai.map(nameOf).join('、');
    }
    logFlow(msg + ' 点确认开下一局');
    speak('流局');
    learnFromDraw(tenpaiPlayers);
    render();
    // 骰子按钮已移除：流局后用提示条开下一局
    pendingClaim = { mode: 'nextGame' };
    showIndicator('流局', true);
}


// 语音串行队列：播报不能互相打断，一句说完再说下一句
let speechQueue = [];
let speechSpeaking = false;
const SPEECH_QUEUE_MAX = 2; // 等待中最多囤2句

function speak(text) {
    try {
        if (!window.speechSynthesis) return;
        speechQueue.push(text);
        // 队列积压太多时丢弃最旧的等待项，只保留最近的，让语音尽量追上当前局面
        while (speechQueue.length > SPEECH_QUEUE_MAX) speechQueue.shift();
        processSpeechQueue();
    } catch (e) { /* 语音不可用则静默 */ }
}

// ---------- 语音播报：稳健版 ----------
// 已知坑：①Chrome 会回收局部 utterance → onend 不来；②iOS/Safari 首次必须在用户手势里 speak 一次才解锁；
// ③不指定中文 voice 时，部分浏览器用英文默认声读汉字 = 无声；④cancel() 紧接着 speak() 会被吞；
// ⑤onstart 都没来 = 这句被静默丢了，要重试。
let speechCurrent = null;
let speechToken = 0;
let speechWatchdog = null;
let speechStartTimer = null;
let speechVoice = null;
let speechUnlocked = false;
let speechCancelAt = 0;

function pickSpeechVoice() {
    try {
        const vs = speechSynthesis.getVoices() || [];
        if (!vs.length) return;
        const zh = vs.filter(v => /^(zh|cmn|yue)/i.test(v.lang || '') || /中文|普通话|國語|国语|Chinese|Mandarin/i.test(v.name || ''));
        speechVoice = zh.find(v => /zh[-_]CN|cmn-Hans/i.test(v.lang)) || zh[0] || null;
    } catch (e) {}
}
try {
    if (window.speechSynthesis) {
        pickSpeechVoice();
        if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', pickSpeechVoice);
        else speechSynthesis.onvoiceschanged = pickSpeechVoice;
    }
} catch (e) {}

// 首次触摸/点击时在手势内静音 speak 一次，解锁 iOS / Safari / 部分 WebView
function unlockSpeech() {
    if (speechUnlocked) return;
    speechUnlocked = true;
    try {
        if (!window.speechSynthesis) return;
        const u = new SpeechSynthesisUtterance('好');
        u.volume = 0;
        u.lang = 'zh-CN';
        speechSynthesis.speak(u);
    } catch (e) {}
}
['pointerdown', 'touchend', 'click', 'keydown'].forEach(ev => {
    try { window.addEventListener(ev, unlockSpeech, { once: true, capture: true, passive: true }); } catch (e) {}
});

function speechDone(token) {
    if (token !== speechToken) return;
    clearTimeout(speechWatchdog);
    clearTimeout(speechStartTimer);
    speechCurrent = null;
    speechSpeaking = false;
    processSpeechQueue();
}

function processSpeechQueue(isRetry) {
    if (speechSpeaking || speechQueue.length === 0) return;
    speechSpeaking = true;
    const clean = speechQueue.shift();
    const token = ++speechToken;
    const go = () => {
        if (token !== speechToken) return;
        try {
            if (!speechVoice) pickSpeechVoice();
            if (speechSynthesis.paused) speechSynthesis.resume();
            const utter = new SpeechSynthesisUtterance(clean);
            if (speechVoice) { utter.voice = speechVoice; utter.lang = speechVoice.lang; }
            else utter.lang = 'zh-CN';
            utter.rate = 1.1;
            let started = false;
            utter.onstart = () => { started = true; clearTimeout(speechStartTimer); };
            utter.onend = utter.onerror = () => speechDone(token);
            speechCurrent = utter;
            clearTimeout(speechWatchdog);
            speechWatchdog = setTimeout(() => {
                if (token !== speechToken) return;
                try { speechSynthesis.cancel(); } catch (e) {}
                speechDone(token);
            }, Math.max(2500, clean.length * 500));
            // 1.2 秒内没开口：这句被静默吞了，取消后重来一次（只重试一次）
            clearTimeout(speechStartTimer);
            speechStartTimer = setTimeout(() => {
                if (token !== speechToken || started) return;
                if (!isRetry) {
                    speechToken++;                       // 作废这句的回调
                    try { speechSynthesis.cancel(); } catch (e) {}
                    speechCancelAt = Date.now();
                    speechSpeaking = false;
                    speechQueue.unshift(clean);
                    setTimeout(() => processSpeechQueue(true), 120);
                }
            }, 1200);
            speechSynthesis.speak(utter);
        } catch (e) {
            speechDone(token);
        }
    };
    // cancel() 刚发生过就稍等一下再 speak，否则 Chrome/Safari 会把新句子一起吞掉
    const since = Date.now() - speechCancelAt;
    if (since < 150) setTimeout(go, 150 - since); else go();
}

// 新开一局时清空上一局可能积压的播报，避免旧播报堆到新局里
function resetSpeechQueue() {
    speechQueue = [];
    speechSpeaking = false;
    speechToken++;
    clearTimeout(speechWatchdog);
    clearTimeout(speechStartTimer);
    speechCurrent = null;
    try { if (window.speechSynthesis) { speechSynthesis.cancel(); speechCancelAt = Date.now(); } } catch (e) {}
}

// 语音播报里指称某家：自己念“你”，其余念座位名（speak 会自动去掉表情符号）
function voiceName(p) { return p === 'bottom' ? '你' : nameOf(p); }


// 流程提示：只显示文字（在“你”的牌下方），不语音
function logFlow(msg) {
    const el = $('flow-log');
    if (el) el.innerText = msg;
}

// 检查某手牌是否凑齐了东南西北(风)或中发白(箭)各一张
function checkWindDragonPattern(hand) {
    const winds = ['1字', '2字', '3字', '4字'];
    const dragons = ['5字', '6字', '7字'];
    if (winds.every(t => hand.includes(t))) return 'winds';
    if (dragons.every(t => hand.includes(t))) return 'dragons';
    return null;
}

// 亮牌：把东南西北(4张)或中发白(3张)从暗牌里移出，变成一组“亮牌”明组，占一个面子位
// 中发白正好3张，跟碰/吃一样不用补牌；东南西北4张，跟杠一样需要补一张牌才能凑够面子位的牌数
// 算幺九+刻子，但不算开门。返回false代表补牌时牌墙已尽、流局已处理，调用方不要再继续往下走
function applyReveal(player, kind) {
    windDragonBonus[player] = true;
    const tiles = kind === 'winds' ? ['1字', '2字', '3字', '4字'] : ['5字', '6字', '7字'];
    tiles.forEach(t => { hands[player].splice(hands[player].indexOf(t), 1); });
    exposedMelds[player].push({ type: kind, tiles: [...tiles] });
    logFlow(nameOf(player) + (kind === 'winds' ? ' 亮出东南西北' : ' 亮出中发白') + '（算幺九+刻子，不算开门）');
    speak('亮牌');
    if (kind === 'dragons') { render(); return true; } // 3张，不用补牌
    if (deck.length <= DEAD_WALL) { declareDraw(); return false; }
    const drawn = deck.pop();
    hands[player].push(drawn);
    hands[player].sort(tileCompare);
    lastDrawnTile[player] = drawn;
    lastDrawWasFinal[player] = deck.length === DEAD_WALL;
    if (player === 'bottom') { lastDrawnIndex = hands.bottom.lastIndexOf(drawn); selectedIndex = null; }
    render();
    return true;
}

let pendingReveal = null; // 'winds' | 'dragons'，等待你在弹窗里选择

function offerReveal(kind) {
    pendingReveal = kind;
    $('reveal-title').innerText =
        (kind === 'winds' ? '手里凑齐了东南西北' : '手里凑齐了中发白') + '，要亮牌吗？（算幺九+刻子，但不算开门；亮牌后补一张牌）';
    $('reveal-modal').classList.add('show');
}

function confirmReveal(reveal) {
    const kind = pendingReveal;
    pendingReveal = null;
    $('reveal-modal').classList.remove('show');
    if (reveal) {
        if (!applyReveal('bottom', kind)) return; // 补牌时牌墙已尽，流局已处理
    }
    continueAfterFirstTurnCheck('bottom');
}

// 摸牌之后的自摸判断与后续流程（首次摸牌的亮牌选择处理完之后也会走到这里）
function continueAfterFirstTurnCheck(player) {
    if (gameOver) return;
    if (checkHu(hands[player], exposedMelds[player], player)) {
        if (player === 'bottom') {
            offerHu({ mode: 'selfdraw' });
        } else {
            settleWinNow({
                winner: player,
                tile: lastDrawnTile[player],
                selfDraw: true,
                finalTile: lastDrawWasFinal[player],
                mode: 'selfdraw',
                payer: null,
                applyKong: true,
                logText: nameOf(player) + ' 自摸胡牌！',
                speakText: '胡了，自摸',
                doRender: false, // 原样：AI自摸后直接弹结果，不重绘桌面
                bannerPlayer: player
            });
        }
        return;
    }

    if (player === 'bottom') {
        // 检查暗杠/加杠机会，可选提示（不挡出牌）
        offerSelfGangIfAny();
        logFlow('轮到你，请点击一张牌出牌');
    } else {
        gameTimeout(() => aiDiscard(player), 700);
    }
}

// 检查自己回合是否可暗杠或加杠，弹出「杠」提示与确认/过按钮（可选，点过或不理会都能继续出牌）
function offerSelfGangIfAny() {
    if (gameOver || pendingClaim) return;
    // 加杠：已碰过的牌，手里又有第4张
    for (const meld of exposedMelds.bottom) {
        if (meld.type === 'peng' && hands.bottom.includes(meld.tiles[0])) {
            pendingClaim = { mode: 'selfGang', kind: 'jia', tile: meld.tiles[0] };
            showIndicator('杠', true);
            logFlow('可以加杠 ' + tileGlyph(meld.tiles[0]) + '，点确认杠 / 点过或直接出牌');
            return;
        }
    }
    // 暗杠：手里4张一样（穷胡规则：不能手把一，最多留3组面子在外，第4组必须留在手里）
    if (exposedMelds.bottom.length < 3) {
        const counts = {};
        hands.bottom.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
        for (const t in counts) {
            if (counts[t] >= 4) {
                pendingClaim = { mode: 'selfGang', kind: 'an', tile: t };
                showIndicator('杠', true);
                logFlow('可以暗杠 ' + tileGlyph(t) + '，点确认杠 / 点过或直接出牌');
                return;
            }
        }
    }
}

function executeSelfGang() {
    if (!pendingClaim || pendingClaim.mode !== 'selfGang') return;
    const { kind, tile } = pendingClaim;
    pendingClaim = null;
    hideIndicator();
    if (kind === 'jia') {
        // 抢杠检查
        const robber = findRonPriority('bottom', tile);
        if (robber && robber !== 'bottom') {
            const idx = hands.bottom.indexOf(tile);
            if (idx > -1) hands.bottom.splice(idx, 1);
            hands[robber].push(tile);
            settleWinNow({
                winner: robber,
                tile: tile,
                selfDraw: false,
                finalTile: false,
                mode: 'dianpao',
                payer: 'bottom',
                applyKong: false, // 抢杠按点炮结算，不加杠后点炮；抢杠本身已是特殊
                logText: nameOf(robber) + ' 抢杠胡了你加杠的 ' + tileGlyph(tile) + '！',
                speakText: '胡了，' + voiceName('bottom') + '点炮',
                doRender: true,
                bannerPlayer: robber
            });
            return;
        }
        const idx = hands.bottom.indexOf(tile);
        if (idx > -1) hands.bottom.splice(idx, 1);
        for (const meld of exposedMelds.bottom) {
            if (meld.type === 'peng' && meld.tiles[0] === tile) {
                meld.type = 'gang';
                meld.tiles.push(tile);
                break;
            }
        }
        logFlow('你加杠了 ' + tileGlyph(tile) + '，补牌中...');
        speak('杠' + tileName(tile));
        render();
        try { if (typeof sfxGang === 'function') sfxGang(); } catch (e) {}
try { if (typeof feelBanner === 'function') feelBanner('杠'); } catch (e) {}
        drawReplacementAndContinue();
        return;
    }
    // 暗杠
    if (exposedMelds.bottom.length >= 3) { logFlow('穷胡规则：不能手把一，最后一组必须留在手里'); return; }
    takeTilesFromHand('bottom', tile, 4);
    exposedMelds.bottom.push({ type: 'gang', tiles: [tile, tile, tile, tile], concealed: true });
    logFlow('你暗杠了 ' + tileGlyph(tile) + '，补牌中...');
    speak('杠' + tileName(tile));
    render();
    try { if (typeof sfxGang === 'function') sfxGang(); } catch (e) {}
try { if (typeof feelBanner === 'function') feelBanner('杠'); } catch (e) {}
    drawReplacementAndContinue();
}

function nextTurn() {
    if (gameOver) return;
    if (deck.length <= DEAD_WALL) { declareDraw(); return; }
    handTurnCount++;
    const player = turnOrder[currentIndex];
    const drawn = deck.pop();
    hands[player].push(drawn);
    hands[player].sort(tileCompare);
    lastDrawnTile[player] = drawn;
    lastDrawWasFinal[player] = deck.length === DEAD_WALL;
    if (player === 'bottom') { lastDrawnIndex = hands.bottom.lastIndexOf(drawn); selectedIndex = null; }
    // 普通摸牌不是杠上开花
    validateHandCounts('nextTurn');
    render();
    try { if (typeof sfxDraw === 'function') sfxDraw(); } catch (e) {}
    highlightActive(player);

    if (firstTurnPending[player]) {
        firstTurnPending[player] = false;
        const kind = checkWindDragonPattern(hands[player]);
        if (kind) {
            if (player === 'bottom') {
                offerReveal(kind); // 等你在弹窗里选，选完会调用continueAfterFirstTurnCheck接着走
                return;
            }
            // AI优先自动选择亮牌
            if (!applyReveal(player, kind)) return; // 补牌时牌墙已尽，流局已处理
        }
    }

    continueAfterFirstTurnCheck(player);
}
