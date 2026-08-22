function startGame() {
    rotateDealer();
    initGame();
}


// 🤫🚫：主动放弃当前可以碰/吃/杠的机会，不用等10秒超时
function declineClaim() {
    if (!pendingClaim) { logFlow('现在没有可以碰/吃/杠的牌'); return; }
    if (pendingClaim.mode === 'diceMenu') return;
    const mode = pendingClaim.mode;
    const fromPlayer = pendingClaim.fromPlayer;
    const tile = pendingClaim.tile;
    pendingClaim = null;
    hideIndicator();
    if (mode === 'nextGame') {
        startGame(); // 流局后点❎也开下一局
        return;
    }
    if (mode === 'selfGang') {
        logFlow('你选择不杠，请出牌');
        return; // 自己回合，继续等你出牌
    }
    logFlow('你选择不吃/碰/杠');
    resolveAiPengOrAdvance(fromPlayer, tile);
}

// 直接判定胡牌并结算：不再需要逐项确认条件，一步到位显示胡牌内容
function offerHu(ctx) {
    hideIndicator();
    let winTile, before, isSelfDraw, isLastTile, payer = null;
    if (ctx.mode === 'dianpao') {
        winTile = ctx.tile;
        before = [...hands.bottom];
        discardPile.pop();
        hands.bottom.push(ctx.tile);
        isSelfDraw = false;
        isLastTile = false;
        payer = ctx.fromPlayer;
    } else {
        winTile = lastDrawnTile.bottom;
        before = [...hands.bottom];
        const idx = before.indexOf(winTile);
        if (idx > -1) before.splice(idx, 1);
        isSelfDraw = true;
        isLastTile = lastDrawWasFinal.bottom;
    }

    const bonus = scoreWinningHand(before, winTile, exposedMelds.bottom, isSelfDraw, isLastTile);
    gameOver = true;
    winner = 'bottom';
    const result = isSelfDraw
        ? settleScore('bottom', 'selfdraw', null, bonus)
        : settleScore('bottom', 'dianpao', payer, bonus);
    logFlow('你胡牌了！' + result.detail);
    speak(isSelfDraw ? '胡了，自摸' : '胡了，' + voiceName(payer) + '点炮');
    learnFromWin('bottom', payer);
    render();
    showResultModal('bottom', isSelfDraw ? 'selfdraw' : 'dianpao', payer, bonus, result, winTile);
}

function callPeng() {
    if (!pendingClaim || !pendingClaim.canPeng) { logFlow('现在不能碰'); return; }
    const { tile, fromPlayer } = pendingClaim;
    discardPile.pop(); // 这张牌被拿走，不再留在弃牌堆
    takeTilesFromHand('bottom', tile, 2);
    exposedMelds.bottom.push({ type: 'peng', tiles: [tile, tile, tile] });
    pendingClaim = null;
    currentIndex = turnOrder.indexOf('bottom');
    hideIndicator();
    selectedIndex = null;
    lastDrawnIndex = null;
    logFlow('你碰了 ' + tileGlyph(tile) + '（' + nameOf(fromPlayer) + '打出），请出牌');
    speak('碰' + tileName(tile));
    render();
}

function callChi() {
    if (!pendingClaim || !pendingClaim.chiCombos || !pendingClaim.chiCombos.length) { logFlow('现在不能吃'); return; }
    if (pendingClaim.chiCombos.length === 1) {
        executeChi(pendingClaim.chiCombos[0]);
        return;
    }
    // 有两种以上吃法，弹窗给选择权（冷色紧凑牌面，与结算页一致）
    const opts = $('chi-choice-options');
    opts.innerHTML = pendingClaim.chiCombos.map((combo, i) => {
        const tiles = [...combo, pendingClaim.tile].sort(tileCompare);
        const tilesHtml = tiles.map(t =>
            `<div class="tile-wrap"><div class="tile-marker"></div><div class="tile exposed">${tileGlyph(t)}</div></div>`
        ).join('');
        return `<div class="hu-opt enabled" onclick="chooseChiCombo(${i})">${tilesHtml}</div>`;
    }).join('');
    $('chi-choice-modal').classList.add('show');
}

function chooseChiCombo(i) {
    const combo = pendingClaim.chiCombos[i];
    $('chi-choice-modal').classList.remove('show');
    executeChi(combo);
}

/** 取消吃法选择 = 过牌，交给 AI 碰/下家流程 */
function closeChiChoice() {
    $('chi-choice-modal').classList.remove('show');
    if (pendingClaim && pendingClaim.mode === 'claim') declineClaim();
}

function executeChi(combo) {
    const { tile } = pendingClaim;
    discardPile.pop();
    combo.forEach(t => {
        const idx = hands.bottom.indexOf(t);
        if (idx > -1) hands.bottom.splice(idx, 1);
    });
    const meldTiles = [...combo, tile].sort(tileCompare);
    exposedMelds.bottom.push({ type: 'chi', tiles: meldTiles });
    pendingClaim = null;
    currentIndex = turnOrder.indexOf('bottom');
    hideIndicator();
    selectedIndex = null;
    lastDrawnIndex = null;
    logFlow('你吃了 ' + tileGlyph(tile) + '，请出牌');
    speak('吃' + tileName(tile));
    render();
}


// 弹窗打开时锁定页面滚动，避免底层与弹层抢惯性
function syncBodyScrollLock() {
    const ids = ['result-modal', 'reveal-modal', 'chi-choice-modal', 'pool-modal'];
    const open = ids.some(id => {
        const el = $(id);
        return el && el.classList.contains('show');
    });
    const body = document.body;
    if (open) {
        if (!body.classList.contains('modal-open')) {
            body.dataset.scrollY = String(window.scrollY || window.pageYOffset || 0);
            body.classList.add('modal-open');
            body.style.top = `-${body.dataset.scrollY}px`;
        }
    } else if (body.classList.contains('modal-open')) {
        const y = parseInt(body.dataset.scrollY || '0', 10) || 0;
        body.classList.remove('modal-open');
        body.style.top = '';
        delete body.dataset.scrollY;
        window.scrollTo(0, y);
    }
}
(function watchModalsForScrollLock() {
    const ids = ['result-modal', 'reveal-modal', 'chi-choice-modal', 'pool-modal'];
    const obs = new MutationObserver(syncBodyScrollLock);
    ids.forEach(id => {
        const el = $(id);
        if (el) obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
})();


/** 按住牌桌上下拖动：平移整个界面（不改规则逻辑） */
const VIEW_PAN_STORAGE_KEY = 'qionghu_mahjong_view_pan_y_v1';
const VIEW_PAN_MAX = 180; /* px，相对中心上下限 */
let viewPanY = 0;
let panDrag = null; // { startY, startPan }

function loadSavedViewPan() {
    try {
        const raw = localStorage.getItem(VIEW_PAN_STORAGE_KEY);
        if (raw == null) return 0;
        const n = parseFloat(raw);
        return isFinite(n) ? n : 0;
    } catch (e) { return 0; }
}
function applyViewPan() {
    viewPanY = Math.max(-VIEW_PAN_MAX, Math.min(VIEW_PAN_MAX, viewPanY));
    document.documentElement.style.setProperty('--view-pan-y', viewPanY.toFixed(1) + 'px');
    try { localStorage.setItem(VIEW_PAN_STORAGE_KEY, String(viewPanY)); } catch (e) {}
}
function initTablePan() {
    const wrap = document.getElementById('table-wrap');
    const frame = document.getElementById('table-frame');
    if (!wrap || !frame) return;
    viewPanY = loadSavedViewPan();
    applyViewPan();

    const isInteractive = (t) => !!(t && t.closest && t.closest(
        '.tile, .tileback, .discardTile, .pool-tile, .player-label, button, .meld-group, #claim-indicator, #wall-count, #landscape-ctrl, #discard-query-btn, #discardWall, #pool-modal, #result-modal, #reveal-modal, #chi-choice-modal, img, .claim-btn, .reset-btn, .avatar, input'
    ));

    const onStart = (clientY, target) => {
        if (isInteractive(target)) return false;
        if (document.body.classList.contains('modal-open')) return false;
        panDrag = { startY: clientY, startPan: viewPanY };
        wrap.classList.add('panning');
        return true;
    };
    const onMove = (clientY) => {
        if (!panDrag) return;
        const dy = clientY - panDrag.startY;
        viewPanY = panDrag.startPan + dy;
        applyViewPan();
    };
    const onEnd = () => {
        if (!panDrag) return;
        panDrag = null;
        wrap.classList.remove('panning');
        applyViewPan();
    };

    frame.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (!onStart(e.clientY, e.target)) return;
        try { frame.setPointerCapture(e.pointerId); } catch (err) {}
    });
    frame.addEventListener('pointermove', (e) => {
        if (!panDrag) return;
        onMove(e.clientY);
    });
    frame.addEventListener('pointerup', onEnd);
    frame.addEventListener('pointercancel', onEnd);
    // 避免拖动时触发三连击骰子：移动超过阈值则清空 tap
    frame.addEventListener('pointermove', (e) => {
        if (!panDrag) return;
        if (Math.abs(e.clientY - panDrag.startY) > 8) {
            tableTapTimes = [];
        }
    });
}

initTablePan();
initDicePips();
// 先按原始比例量一次桌面，记下「正常大小」，再应用（可能已保存的）缩放
viewScale = ORIGINAL_VIEW_SCALE;
document.documentElement.style.setProperty('--view-scale', '1');
setTimeout(() => {
    captureOriginalViewSize();
    viewScale = loadSavedViewScale();
    applyViewScale();
}, 0);
// 启动：有完整存档则原样恢复，否则只带积分/庄家开新局
if (loadGameProgress()) {
    resumeFromSave();
} else {
    initGame();
}
