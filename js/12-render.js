// ---------- 渲染 ----------
function renderTile(t, idx, clickable) {
    let marker = '';
    if (idx === selectedIndex) marker = '➡️';
    else if (idx === lastDrawnIndex) marker = '⬇️';
    const danger = isDangerousTile(t) ? 'danger' : '';
    return `<div class="tile-wrap"><div class="tile-marker">${marker}</div><div class="tile ${clickable ? '' : 'disabled'} ${danger}" data-index="${idx}">${tileGlyph(t)}</div></div>`;
}

function renderExposedFace(t) {
    return `<div class="tile-wrap"><div class="tile-marker"></div><div class="tile exposed">${tileGlyph(t)}</div></div>`;
}

function renderExposedBack() {
    return `<div class="tile-wrap"><div class="tile-marker"></div><div class="tileback">🀫</div></div>`;
}

// 按组渲染一组已亮出的牌：亮牌(风/箭)用黑色虚线框；暗杠用黄色虚线框，3张扣着1张露出(避免完全认不出是什么牌)；其余照常整组亮出
function renderMeldGroup(m) {
    let cls = 'meld-group';
    if (m.type === 'winds' || m.type === 'dragons') cls += ' reveal-group';
    if (m.type === 'gang' && m.concealed) cls += ' angang-group';

    let tilesHtml;
    if (m.type === 'gang' && m.concealed) {
        tilesHtml = renderExposedFace(m.tiles[0]) + renderExposedBack() + renderExposedBack() + renderExposedBack();
    } else {
        tilesHtml = m.tiles.map(renderExposedFace).join('');
    }
    return `<div class="${cls}">${tilesHtml}</div>`;
}


function openPoolModal() {
    renderPoolGrid();
    const modal = $('pool-modal');
    if (modal) modal.classList.add('show');
    logFlow('牌池：已弃出 ' + discardPile.length + ' 张，可上下滑动查看');
}
function closePoolModal() {
    const modal = $('pool-modal');
    if (modal) modal.classList.remove('show');
}
function renderPoolGrid() {
    const grid = $('pool-grid');
    if (!grid) return;
    const count = $('pool-box-count');
    if (count) count.textContent = '（' + discardPile.length + ' 张）';
    const sortedPool = [...discardPile].sort((a, b) => poolTileCompare(a.tile, b.tile));
    grid.innerHTML = sortedPool.length
        ? sortedPool.map(d => `<div class="pool-tile">${tileGlyph(d.tile)}</div>`).join('')
        : '<div class="pool-empty">暂无弃牌</div>';
}

function render() {
    for (let p in hands) {
        const isBottom = p === 'bottom';
        const isMyTurn = isBottom && turnOrder[currentIndex] === 'bottom' && !gameOver && (!pendingClaim || pendingClaim.mode === 'selfGang');
        let html = '';
        if (isBottom) {
            html += hands[p].map((t, idx) => renderTile(t, idx, isMyTurn)).join('');
            exposedMelds[p].forEach(m => { html += renderMeldGroup(m); });
            $('hand-' + p).innerHTML = html;
        } else {
            // AI 暗牌不显示；副露直接挂在头像下方，最多三行
            $('hand-' + p).innerHTML = '';
            const expEl = $('exposed-' + p);
            if (expEl) {
                expEl.innerHTML = (exposedMelds[p] || []).map(renderMeldGroup).join('');
            }
        }
    }
    const wall = $('discardWall');
    // 竖屏按原版显示最近 24 张；横屏保持 12 张以免侧栏过挤
    const isPortrait = document.body && document.body.classList.contains('portrait-layout');
    const discardView = discardPile.slice(isPortrait ? -24 : -12);
    wall.innerHTML = discardView.map((d, i, arr) =>
        `<div class="discardTile${i === arr.length - 1 ? ' latest' : ''}">${tileGlyph(d.tile)}</div>`).join('');
    $('wall-count-text').innerText = '牌墙: ' + deck.length + ' 张' + (aiLearn.games > 0 ? ' · 💡' + aiLearn.games : '');
    $('wall-count-text').title = aiLearn.games > 0
        ? 'AI已学习' + aiLearn.games + '局：保守' + aiLearn.confidence.conservative.toFixed(1)
            + ' 激进' + aiLearn.confidence.aggressive.toFixed(1) + ' 精明' + aiLearn.confidence.shrewd.toFixed(1)
        : '';
    const poolModal = $('pool-modal');
    if (poolModal && poolModal.classList.contains('show')) renderPoolGrid();
    markDealer();
    if (exposedInfoShownFor && document.body && document.body.classList.contains('portrait-layout')) {
        try { showExposedInfo(exposedInfoShownFor); } catch (e) {}
    }
    fitBottomHand();
    // 局数变化 / 副露数量变化时，重新核对横屏界面放大系数（04-view-scale.js）
    try { if (typeof uiScaleOnRender === 'function') uiScaleOnRender(); } catch (e) {}
    try { validateHandCounts('render'); } catch (e) {}
}

// ---------- 横屏底牌自适应：无论手牌+吃碰杠亮组有多少张（含最多三次杠），
// 都通过等比缩放让它们在同一行内完整显示，不换行、不重叠、不需要滚动 ----------
function fitBottomHand() {
    const handEl = $('hand-bottom');
    if (!handEl) return;
    // 竖屏：完全按原版固定 29×39 + 横向滑动，不做缩放
    if (document.body && document.body.classList.contains('portrait-layout')) {
        handEl.style.overflowX = 'auto';
        handEl.style.justifyContent = 'flex-start';
        handEl.style.setProperty('--tile-w', '29px');
        handEl.style.setProperty('--tile-h', '39px');
        handEl.style.setProperty('--tile-fs', '29px');
        return;
    }
    // 横屏界面放大系数（04-view-scale.js 按牌桌里的可用空间算出，≥1；未启用时为 1）
    const uiK = (typeof uiScaleK === 'number' && uiScaleK > 0) ? uiScaleK : 1;
    const baseW = 29 * uiK, baseH = 39 * uiK, baseFS = 29 * uiK;
    const MIN_SCALE = 0.42;
    handEl.style.overflowX = 'hidden';
    handEl.style.justifyContent = 'center';
    handEl.style.setProperty('--tile-w', baseW.toFixed(2) + 'px');
    handEl.style.setProperty('--tile-h', baseH.toFixed(2) + 'px');
    handEl.style.setProperty('--tile-fs', baseFS.toFixed(2) + 'px');
    const container = handEl.parentElement;
    if (!container) return;
    const availWidth = container.clientWidth;
    const naturalWidth = handEl.scrollWidth;
    if (availWidth > 0 && naturalWidth > availWidth) {
        let scale = availWidth / naturalWidth;
        if (scale < MIN_SCALE) scale = MIN_SCALE;
        handEl.style.setProperty('--tile-w', (baseW * scale).toFixed(2) + 'px');
        handEl.style.setProperty('--tile-h', (baseH * scale).toFixed(2) + 'px');
        handEl.style.setProperty('--tile-fs', (baseFS * scale).toFixed(2) + 'px');
        requestAnimationFrame(() => {
            if (handEl.scrollWidth > container.clientWidth + 1) {
                handEl.style.overflowX = 'auto';
            }
        });
    }
}

function rotateDealer() {
    // 有人胡牌：赢家是庄家就连庄，否则下庄
    // 流局（winner为null）：无条件连庄
    const dealerStays = winner === null ? true : (winner === dealer);
    if (!dealerStays) dealer = nextPlayerOf(dealer);
}
