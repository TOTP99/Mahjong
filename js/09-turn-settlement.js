function canPeng(hand, tile) {
    return hand.filter(t => t === tile).length >= 2;
}

function canGang(hand, tile) {
    return hand.filter(t => t === tile).length >= 3;
}

// 返回可吃的组合（手牌中的两张），找不到返回 null
// 返回所有可行的吃法组合(可能不止一种，比如摸到5万，手里有3万4万又有6万7万)
function findChiCombos(hand, tile) {
    const suit = tileSuit(tile);
    if (suit === '字') return []; // 字牌没有顺子，不能吃
    const rank = tileRank(tile);
    const combos = [[rank - 2, rank - 1], [rank - 1, rank + 1], [rank + 1, rank + 2]];
    const found = [];
    for (const [a, b] of combos) {
        if (a < 1 || b > 9) continue;
        const ta = a + suit, tb = b + suit;
        if (hand.includes(ta) && hand.includes(tb)) found.push([ta, tb]);
    }
    return found;
}

function nameOf(p) {
    return { top: '西🐲', left: '北🐯', right: '南🦁', bottom: '东🐈' }[p];
}

function stripEmoji(s) { return s.replace(/🐲|🐯|🦁|🐈/g, ''); }

// 显示验胡结算画面：谁胡/自摸or点炮/完整手牌/吃碰杠亮/计分明细/每家加减分
function showResultModal(winnerPlayer, mode, payer, bonus, result, winTile) {
    $('result-title').innerText = stripEmoji(nameOf(winnerPlayer)) + '胡';
    $('result-subtitle').innerText =
        mode === 'selfdraw' ? '自摸' : (stripEmoji(nameOf(payer)) + ' 点炮');

    const concealedSorted = [...hands[winnerPlayer]].sort(tileCompare);
    let winMarked = false;
    $('result-concealed').innerHTML =
        concealedSorted.map(t => {
            const isWin = !winMarked && t === winTile;
            if (isWin) winMarked = true;
            return `<div class="tile-wrap"><div class="tile-marker"></div><div class="tile exposed${isWin ? ' win-glow' : ''}">${tileGlyph(t)}</div></div>`;
        }).join('') || '（无）';
    $('result-exposed').innerHTML =
        exposedMelds[winnerPlayer].map(renderMeldGroup).join('') || '（无）';

    const lines = [mode === 'selfdraw' ? '底分 ×1' : '底分 ×2'];
    result.tags.forEach(t => lines.push(t.replace('×', ' ×')));
    $('result-score-lines').innerHTML = lines.map(l => `<div>${l}</div>`).join('');

    lastSettlement = {
        mode,
        winner: winnerPlayer,
        payer: payer || null,
        systemPayouts: { top: result.payouts.top, left: result.payouts.left, right: result.payouts.right, bottom: result.payouts.bottom },
        payouts: { top: result.payouts.top, left: result.payouts.left, right: result.payouts.right, bottom: result.payouts.bottom },
        systemTotal: result.total,
        adjusting: false
    };
    renderSettlementView();
    $('result-adjust-panel').style.display = 'none';
    const btn = $('btn-toggle-adjust');
    if (btn) btn.textContent = '特殊情况：手动调分';
    $('result-modal').classList.add('show');
    flushSaveProgress(); // 结算后立刻落盘，防刷新丢分
}

function renderSettlementView() {
    if (!lastSettlement) return;
    const pay = lastSettlement.payouts;
    const edited = turnOrder.some(p => pay[p] !== lastSettlement.systemPayouts[p]);
    const sumWin = turnOrder.reduce((s, p) => s + Math.max(0, pay[p]), 0);
    $('result-total').innerText =
        (edited ? '调整后得分合计：' : '总分：') + sumWin + (edited ? '（已手动修改）' : '');

    // 默认只读展示
    $('result-payouts').innerHTML = turnOrder.map(p => {
        const v = pay[p];
        const cls = v > 0 ? 'pos' : (v < 0 ? 'neg' : '');
        const sign = v > 0 ? '+' : '';
        return `<div class="${cls}">${stripEmoji(nameOf(p))} ${sign}${v}</div>`;
    }).join('');

    // 调分面板（仅打开时可见）
    $('result-payouts-edit').innerHTML = turnOrder.map(p => {
        const v = pay[p];
        const cls = v > 0 ? 'pos' : (v < 0 ? 'neg' : '');
        return `<div class="payout-row ${cls}">
            <span class="pname">${stripEmoji(nameOf(p))}</span>
            <button type="button" class="payout-btn" onclick="event.stopPropagation();adjustSettlementPayoutFactor('${p}', 0.5)">÷2</button>
            <input type="number" step="1" value="${v}" data-player="${p}"
                onchange="onSettlementPayoutEdit(this)">
            <button type="button" class="payout-btn" onclick="event.stopPropagation();adjustSettlementPayoutFactor('${p}', 2)">×2</button>
        </div>`;
    }).join('');
}

function toggleSettlementAdjust() {
    if (!lastSettlement) return;
    lastSettlement.adjusting = !lastSettlement.adjusting;
    const panel = $('result-adjust-panel');
    const btn = $('btn-toggle-adjust');
    if (lastSettlement.adjusting) {
        panel.style.display = 'block';
        if (btn) btn.textContent = '收起手动调分';
        renderSettlementView();
    } else {
        panel.style.display = 'none';
        if (btn) btn.textContent = '特殊情况：手动调分';
    }
}

// 改一家，其余按点炮/自摸关系自动联动
function onSettlementPayoutEdit(input) {
    if (!lastSettlement) return;
    const p = input.dataset.player;
    if (input.value.trim() === '' || input.value.trim() === '-') return; // 还在输入中（比如刚打了个负号），先不处理
    let v = parseInt(input.value, 10);
    if (isNaN(v)) return;
    applySettlementPayoutValue(p, v);
}

// ×2 / ÷2 按钮：在当前值基础上直接乘/除，可反复点击
function adjustSettlementPayoutFactor(p, factor) {
    if (!lastSettlement) return;
    const cur = lastSettlement.payouts[p];
    const v = Math.round(cur * factor);
    applySettlementPayoutValue(p, v);
}

// 改一家，其余按点炮/自摸关系自动联动
function applySettlementPayoutValue(p, v) {
    if (!lastSettlement) return;
    const old = lastSettlement.payouts[p];
    if (v === old) return;

    const { mode, winner, payer } = lastSettlement;
    const pay = lastSettlement.payouts;

    if (mode === 'dianpao') {
        // 点炮：只有赢家与点炮者，互为相反数
        if (p === winner) {
            pay[winner] = v;
            if (payer) pay[payer] = -v;
        } else if (p === payer) {
            pay[payer] = v;
            pay[winner] = -v;
        } else {
            // 其余两家本应是 0，强制回 0
            pay[p] = 0;
        }
    } else {
        // 自摸：三家付钱，赢家收总和
        if (p === winner) {
            // 改赢家总分：按原系统付款比例（或均分）把差额摊到三家
            const losers = turnOrder.filter(x => x !== winner);
            const oldWin = old;
            const delta = v - oldWin;
            pay[winner] = v;
            // 按原付款绝对值比例分摊；若原都为 0 则均分
            const weights = losers.map(x => Math.abs(lastSettlement.systemPayouts[x]) || 0);
            const wsum = weights.reduce((a, b) => a + b, 0);
            if (wsum === 0) {
                const each = Math.trunc(delta / losers.length);
                let remain = delta - each * losers.length;
                losers.forEach((x, i) => {
                    pay[x] -= each + (i === 0 ? remain : 0);
                });
            } else {
                let allocated = 0;
                losers.forEach((x, i) => {
                    if (i === losers.length - 1) {
                        pay[x] -= (delta - allocated);
                    } else {
                        const share = Math.round(delta * weights[i] / wsum);
                        pay[x] -= share;
                        allocated += share;
                    }
                });
            }
        } else {
            // 改某一家付款：赢家收入随之增减
            const delta = v - old; // 付款方变多（如 -4→-6，delta=-2）则赢家少 2
            pay[p] = v;
            pay[winner] -= delta;
        }
    }

    renderSettlementView();
    // 保持当前编辑框焦点数值已由 render 刷新
}

function resetSettlementPayouts() {
    if (!lastSettlement) return;
    lastSettlement.payouts = {
        top: lastSettlement.systemPayouts.top,
        left: lastSettlement.systemPayouts.left,
        right: lastSettlement.systemPayouts.right,
        bottom: lastSettlement.systemPayouts.bottom
    };
    renderSettlementView();
}


function closeResultModal() {
    // 若手动改过分，把差额补进 scores（系统分已在 settleScore 时写入）
    if (lastSettlement) {
        for (const p of turnOrder) {
            const delta = lastSettlement.payouts[p] - lastSettlement.systemPayouts[p];
            if (delta) scores[p] += delta;
        }
        lastSettlement = null;
    }
    $('result-modal').classList.remove('show');
    if (gameOver) startGame();
}

function showIndicator(text, interactive) {
    const el = $('claim-indicator');
    if (interactive) {
        const label = text.replace(/^🔔\s*/, '');
        el.innerHTML = '<span class="claim-bell">🔔</span>'
            + '<span class="claim-actions">'
            + '<span class="claim-btn claim-yes" onclick="event.stopPropagation();acceptClaim()">✅</span>'
            + '<span class="claim-btn claim-no" onclick="event.stopPropagation();declineClaim()">❎</span>'
            + '</span>'
            + '<span class="claim-label">' + label + '</span>';
    } else {
        el.innerText = text;
    }
    el.classList.add('show');
    // 横屏：提示在左侧列表下方，滚入可视区；竖屏固定在牌桌空地，不滚动
    if (!(document.body && document.body.classList.contains('portrait-layout'))) {
        try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
    }
}

function hideIndicator() {
    const el = $('claim-indicator');
    el.classList.remove('show');
    el.innerHTML = '';
}

// ---- 竖屏副露：点击头像显示/隐藏（横屏仍用头像下常驻副露，不走此浮层）----
let exposedInfoShownFor = null;

function toggleExposedInfo(player) {
    if (!(document.body && document.body.classList.contains('portrait-layout'))) {
        // 横屏：不使用浮层，保持原有头像下副露逻辑
        return;
    }
    if (exposedInfoShownFor === player) {
        exposedInfoShownFor = null;
        hideExposedInfo();
        return;
    }
    exposedInfoShownFor = player;
    showExposedInfo(player);
}

function showExposedInfo(player) {
    const tooltip = $('tile-tooltip');
    if (!tooltip) return;
    const melds = exposedMelds[player] || [];
    if (!melds.length) {
        tooltip.innerHTML = '';
        tooltip.classList.remove('show');
        return;
    }
    const avatar = (typeof statAvatar !== 'undefined' && statAvatar[player]) ? statAvatar[player] : '';
    const head = avatar ? `<div class="tt-avatar">${avatar}</div>` : '';
    // 仅三排牌面，无文字标签；最上排上方显示该家 emoji 头像
    const rows = melds.slice(0, 3).map(m => {
        let tilesHtml;
        if (m.type === 'gang' && m.concealed) {
            tilesHtml = renderExposedFace(m.tiles[0]) + renderExposedBack() + renderExposedBack() + renderExposedBack();
        } else {
            tilesHtml = m.tiles.map(renderExposedFace).join('');
        }
        return `<div class="tt-meld"><span class="tt-tiles">${tilesHtml}</span></div>`;
    }).join('');
    tooltip.innerHTML = head + rows;
    tooltip.classList.add('show');
}

function hideExposedInfo() {
    exposedInfoShownFor = null;
    const tooltip = $('tile-tooltip');
    if (tooltip) tooltip.classList.remove('show');
}

function highlightActive(player) {
    document.querySelectorAll('.player').forEach(el => el.classList.remove('active'));
    $('p-' + player).classList.add('active');
}

