// ========== 11-ai-claim：AI 叫牌决策与回合流程 ==========
// 吃/碰的"要不要"（shouldAiChi/shouldAiPeng/scoreChiCombo/findAiChi/findAiPeng/findRonPriority），
// AI 回合动作（aiDiscard/aiPengClaim/aiChiClaim/aiDrawReplacement），
// 流程推进（resolveAiPengOrAdvance/checkClaimOrAdvance/advanceTurn/takeTilesFromHand）。
// "打出哪张"的决策在 11-ai-discard-3.js（chooseAiDiscardTile）。
// 2026-09-30 骨架重组：自 11-ai-discard-claim-3.js 拆分，零行为变化。
function aiDiscard(player) {
    if (gameOver) return;
    const hand = hands[player];
    if (hand.length === 0) { advanceTurn(); return; } // 防御性检查：正常情况下不会发生
    // AI 加杠 / 暗杠：未听牌时执行（加杠需处理抢杠；暗杠不计抢杠）
    if (!isTenpai(player)) {
        for (const meld of exposedMelds[player]) {
            if (meld.type === 'peng' && hand.includes(meld.tiles[0])) {
                const gTile = meld.tiles[0];
                const robber = findRonPriority(player, gTile);
                if (robber) {
                    const ix = hands[player].indexOf(gTile);
                    if (ix > -1) hands[player].splice(ix, 1);
                    if (robber === 'bottom') {
                        offerHu({ mode: 'dianpao', tile: gTile, fromPlayer: player, robGang: true });
                        return;
                    }
                    hands[robber].push(gTile);
                    settleWinNow({
                        winner: robber,
                        tile: gTile,
                        selfDraw: false,
                        finalTile: false,
                        mode: 'dianpao',
                        payer: player,
                        applyKong: false, // 抢杠按点炮结算，不加杠后点炮
                        logText: nameOf(robber) + ' 抢杠胡了 ' + nameOf(player) + '！',
                        speakText: '胡了，' + voiceName(player) + '点炮',
                        doRender: true,
                        bannerPlayer: robber
                    });
                    return;
                }
                const ix = hands[player].indexOf(gTile);
                if (ix > -1) hands[player].splice(ix, 1);
                meld.type = 'gang';
                meld.tiles.push(gTile);
                meld.concealed = false;
                logFlow(nameOf(player) + ' 加杠 ' + tileGlyph(gTile));
                speak('杠' + tileName(gTile));
                render();
                try { if (typeof sfxGang === 'function') sfxGang(); } catch (e) {}
try { if (typeof feelBanner === 'function') feelBanner('杠', player); } catch (e) {}
                aiDrawReplacement(player);
                return;
            }
        }
        if (exposedMelds[player].length < 3) {
            const counts = {};
            for (const t of hand) counts[t] = (counts[t] || 0) + 1;
            let gangTile = null;
            for (const t of Object.keys(counts)) {
                if (counts[t] >= 4) { gangTile = t; break; }
            }
            if (gangTile) {
                for (let i = 0; i < 4; i++) {
                    const ix = hands[player].indexOf(gangTile);
                    if (ix > -1) hands[player].splice(ix, 1);
                }
                exposedMelds[player].push({ type: 'gang', tiles: [gangTile, gangTile, gangTile, gangTile], concealed: true });
                logFlow(nameOf(player) + ' 暗杠 ' + tileGlyph(gangTile));
                speak('杠' + tileName(gangTile));
                render();
                try { if (typeof sfxGang === 'function') sfxGang(); } catch (e) {}
try { if (typeof feelBanner === 'function') feelBanner('杠', player); } catch (e) {}
                aiDrawReplacement(player);
                return;
            }
        }
    }
    // 保牌策略：孤立字牌 > 孤立中张(非4/5/6优先) > ... > 对子最后才拆，同等级优先选不点炮的
    const tile = chooseAiDiscardTile(hand, player);
    hand.splice(hand.indexOf(tile), 1);
    markKongDiscardIfNeeded(player);
    discardPile.push({ player, tile });
    validateHandCounts('aiDiscard');
    render();
    speak(tileName(tile));
    try { if (typeof sfxDiscard === 'function') sfxDiscard(); } catch (e) {}
    try {
        if (typeof feelFlyAiDiscard === 'function' && typeof tileImg === 'function') {
            feelFlyAiDiscard(player, tileImg(tile));
        }
    } catch (e) {}

    // 多家可以胡的话，按下家方向离出牌人最近的先胡
    const ronPlayer = findRonPriority(player, tile);
    if (ronPlayer === 'bottom') {
        offerHu({ mode: 'dianpao', tile, fromPlayer: player });
        return;
    }
    if (ronPlayer) {
        discardPile.pop();
        hands[ronPlayer].push(tile);
        settleWinNow({
            winner: ronPlayer,
            tile: tile,
            selfDraw: false,
            finalTile: false,
            mode: 'dianpao',
            payer: player,
            applyKong: true,
            logText: nameOf(player) + ' 点炮，' + nameOf(ronPlayer) + ' 胡了！',
            speakText: '胡了，' + voiceName(player) + '点炮',
            doRender: true,
            bannerPlayer: ronPlayer
        });
        return;
    }

    // 无人点炮：杠后点炮标记失效
    if (afterKongDiscardPlayer === player) afterKongDiscardPlayer = null;
    checkClaimOrAdvance(player, tile);
}

// 该不该碰：按性格松紧（保守≤2组/激进≤3组/精明折中）+ 向听容忍；中发白刻子带番单独加权
// 手里还有没有连张(同花色相邻的牌)？没有的话说明这手牌天然在往碰碰胡(飘,8倍)方向走
function isGoingForTriplets(hand) {
    for (const t of hand) {
        const suit = tileSuit(t), rank = tileRank(t);
        if (suit === '字') continue;
        if (hand.includes((rank + 1) + suit)) return false;
    }
    return true;
}

function shouldAiPeng(p, tile, overrides) {
    overrides = overrides || {};
    if (isTenpai(p)) return false; // 已上听不碰，避免拆听
    const style = aiPersonality[p] || 'shrewd';
    const learn = aiLearn.confidence[style] || {};
    // conf=轴1(吃碰激进度)的学习值；chaseConf=轴3(特殊牌型追逐)的学习值；两条轴分开学，互不影响
    const conf = overrides.callAggr !== undefined ? overrides.callAggr : (learn.callAggr || 0);
    const chaseConf = overrides.chaseSpecial !== undefined ? overrides.chaseSpecial : (learn.chaseSpecial || 0);
    const exposed = exposedMelds[p];
    const openCount = exposed.length;
    if (openCount >= 3) return false; // 穷胡：不能手把一

    const hand = hands[p];
    const handAfter = removeTilesFromHand(hand, [tile, tile]);
    const expAfter = exposed.concat([{ type: 'peng', tiles: [tile, tile, tile] }]);
    const shanBefore = estimateShantenCached(hand, exposed);
    const shanAfter = estimateShantenCached(handAfter, expAfter);

    const otherPairs = [...new Set(hand)].filter(t => t !== tile && hand.filter(x => x === t).length >= 2);
    // 中发白可作将，也可直接算有价值字牌
    const isDragon = dragonTilesArr.includes(tile);
    const isWind = windTilesArr.includes(tile);
    const isHonorValue = isDragon || isWind;
    const keepsJiang = otherPairs.length > 0 || isDragon;
    const chasingPengPeng = isGoingForTriplets(hand);

    // 穷胡专属条件：碰完是否补上了原本缺的三门齐/幺九/刻子
    // 缺的条件补上了就值得放宽一档向听要求
    const qhBefore = analyzeHu(hand, exposed, p);
    const qhAfter = analyzeHu(handAfter, expAfter, p);
    const qhGain = (!qhBefore.sanmenqi && qhAfter.sanmenqi)
        || (!qhBefore.yaojiu && qhAfter.yaojiu)
        || (!qhBefore.kezi && qhAfter.kezi);

    // 副露数量上限
    // 激进可略多；冲碰碰胡再按性格+学习给不同额度；学习战绩很好再多给1个名额，很差则少给1个
    // 中发白刻子本身带番，即使已接近上限也允许碰（下面用 isHonorValue 放行）
    const chaseSlack = (AI_TRAITS[style] || AI_TRAITS.shrewd).chaseSpecialSlack
        + (chaseConf >= 1.5 ? 1 : (chaseConf <= -1.5 ? -1 : 0));
    const cap = (style === 'conservative' ? 2 : (style === 'aggressive' ? 3 : 2))
        + (chasingPengPeng ? chaseSlack : 0)
        + (conf >= 1.5 ? 1 : 0) - (conf <= -1.5 ? 1 : 0);
    if (openCount >= cap && !isHonorValue) return false;

    // 向听约束：默认不能明显变差
    // 学习战绩好 / 补上穷胡缺项 / 中发白刻子 → 各可多容忍一档
    const confSlack = conf >= 1.5 ? 1 : (conf <= -1.5 ? -1 : 0);
    const qhSlack = qhGain ? 1 : 0;
    const dragonSlack = isDragon ? 1 : 0; // 中发白刻子×2是稳赚的，比赌三门齐更确定
    const baseSlack = confSlack + qhSlack + dragonSlack;
    // 没开门自摸×2 / 没开门点炮×2：不开门的代价比以前更高，三种性格都该多容忍1档向听去换开门，
    // 保守派也不例外（以前只有精明/激进有这个宽容）
    const openSlack = openCount === 0 ? 1 : 0;
    // AI 4.0 提强4 纪律2：门清贵重手不破。门清且这手牌价值高（winValue>2500）时，
    // 碰要付出代价：碰后向听必须严格改善才碰（中发白刻子本身带番×2是稳赚，不受此限）。
    if (openCount === 0 && !isDragon) {
        try {
            if (winValue(hand, exposed, p) > 2500 && shanAfter >= shanBefore) return false;
        } catch (e) {}
    }

    if (style === 'conservative') {
        if (shanAfter > shanBefore + Math.max(0, openSlack + baseSlack)) return false;
    } else if (style === 'shrewd') {
        if (shanAfter > shanBefore + Math.max(0, openSlack + baseSlack)) return false;
    } else {
        // aggressive：允许为开门或有价值字牌略损向听
        if (shanAfter > shanBefore + Math.max(0, (openSlack || isHonorValue ? 1 : 0) + baseSlack)) return false;
    }

    // 进张保留 veto（ukeireKeepAt，AI 3.0）：碰后进张掉得太多就别碰（保守：腰斩就 veto）
    const keepAt = aiTraitOf(p).ukeireKeepAt || 0;
    if (keepAt > 0) {
        const ukBefore = ukeireCount(hand, exposed);
        const ukAfter = ukeireCount(handAfter, expAfter);
        if (ukBefore > 0 && ukAfter < ukBefore * keepAt) return false;
    }

    // 未开门：优先碰（在向听可接受的前提下）
    if (openCount === 0) return true;

    // 已开门：优先级 中发白 > 冲碰碰胡 > 普通有价值字牌(风) > 保住将
    if (isDragon && shanAfter <= shanBefore + 1) return true; // 中发白刻子带番，多容忍1档也碰
    if (chasingPengPeng && shanAfter <= shanBefore + chaseSlack) return true;
    if (isHonorValue && shanAfter <= shanBefore + 1) return true;
    return keepsJiang && shanAfter <= shanBefore;
}

// 除discarder外，检查是否有AI能碰（或杠）这张牌，且局势上值得碰
function findAiPeng(discarder, tile) {
    for (const p of ['top', 'left', 'right']) {
        if (p === discarder) continue;
        if (exposedMelds[p].length >= 3) continue; // 穷胡规则：不能手把一，最多3组面子在外
        if (!canPeng(hands[p], tile)) continue;
        const actual = shouldAiPeng(p, tile);
        // 归因：把轴1/轴3的学习值分别归零，看这个决定是不是因为学到的东西才变了
        // （分别只归零一条、另一条保持实际值，这样才是这条轴自己的影响，不会互相混)
        if (shouldAiPeng(p, tile, { callAggr: 0 }) !== actual) markAxisUsed(p, 'callAggr');
        if (shouldAiPeng(p, tile, { chaseSpecial: 0 }) !== actual) markAxisUsed(p, 'chaseSpecial');
        if (actual) return p;
    }
    return null;
}

// 多家能胡这张牌时，按下家方向（离出牌人最近的下家优先）找第一个能胡的玩家，找不到返回null
function findRonPriority(discarder, tile) {
    const idx = turnOrder.indexOf(discarder);
    for (let step = 1; step <= 3; step++) {
        const p = turnOrder[(idx + step) % turnOrder.length];
        const hand = p === 'bottom' ? [...hands.bottom, tile] : [...hands[p], tile];
        if (checkHu(hand, exposedMelds[p], p)) return p;
    }
    return null;
}

function nextPlayerOf(p) {
    const idx = turnOrder.indexOf(p);
    return turnOrder[(idx + 1) % turnOrder.length];
}

// ---------- 吃法评估与"吃不吃"（自 11-ai-discard-3.js 移入：吃碰决策归 11-ai-claim） ----------
/** 评估一种吃法：向听下降优先，其次三门齐，再次不拆对子 */
function scoreChiCombo(hand, tile, combo, exposed, player) {
    const style = aiPersonality[player] || 'shrewd';
    const before = estimateShantenCached(hand, exposed);
    const handAfter = removeTilesFromHand(hand, combo);
    const expAfter = exposed.concat([{ type: 'chi', tiles: [...combo, tile].sort(tileCompare) }]);
    const after = estimateShantenCached(handAfter, expAfter);
    let score = (before - after) * 10; // 向听改善越大越好
    // 未开门时，吃能开门有额外价值：没开门自摸要被单独×2惩罚、没开门点炮也×2，
    // 未开门代价比以前更高，这里把权重从 4 调到 6，让AI更愿意为了开门吃这口
    if (!isKaimen(exposed)) score += 6;
    // 三门齐
    const divBefore = suitDiversity(hand, exposed);
    const divAfter = suitDiversity(handAfter, expAfter);
    score += (divAfter - divBefore) * 3;
    if (divAfter >= 3) score += 2;
    // 穷胡专属条件（三门齐/幺九/刻子）完整度：标准向听改善之外，额外奖励真正推进胡牌资格的吃法
    const qhBefore = analyzeHu(hand, exposed, player);
    const qhAfter = analyzeHu(handAfter, expAfter, player);
    if (!qhBefore.sanmenqi && qhAfter.sanmenqi) score += 3;
    if (!qhBefore.yaojiu && qhAfter.yaojiu) score += 3;
    if (!qhBefore.kezi && qhAfter.kezi) score += 2;
    // 尽量不拆对子：combo 里若拆了对子则扣分
    for (const t of combo) {
        if (hand.filter(x => x === t).length >= 2) score -= 2;
    }
    // 性格：保守要求至少不升高向听；激进可略接受持平
    if (style === 'conservative' && after > before) score -= 20;
    if (style === 'shrewd' && after > before + 1) score -= 20;
    if (style === 'aggressive' && after > before + 1) score -= 12;
    return score;
}

/** 是否应该吃：有正收益（或未开门且不太亏）。学习偏好：这个性格最近战绩好就放宽门槛，战绩差就收紧 */
function shouldAiChi(player, tile, combo) {
    if (isTenpai(player)) return false;
    const exposed = exposedMelds[player];
    if (exposed.length >= 3) return false;
    // AI 4.0 提强4 纪律3：吃别把龙对子拆了（中发白对子未来×2的潜力，拆了血亏）
    if (typeof dragonTilesArr !== 'undefined') {
        const cntB = {};
        for (const t of hands[player]) cntB[t] = (cntB[t] || 0) + 1;
        const cntA = {};
        const handAfter = removeTilesFromHand(hands[player], combo);
        for (const t of handAfter) cntA[t] = (cntA[t] || 0) + 1;
        for (const d of dragonTilesArr) {
            if ((cntB[d] || 0) >= 2 && (cntA[d] || 0) < 2) return false;
        }
    }
    // 进张保留 veto（ukeireKeepAt，AI 3.0）：吃后进张掉得太多就别吃（保守：腰斩就 veto）
    {
        const style = aiPersonality[player] || 'shrewd';
        const keepAt = aiTraitOf(player).ukeireKeepAt || 0;
        if (keepAt > 0) {
            const handAfter = removeTilesFromHand(hands[player], combo);
            const meldTiles = [...combo, tile].sort(tileCompare);
            const ukBefore = ukeireCount(hands[player], exposed);
            const ukAfter = ukeireCount(handAfter, exposed.concat([{ type: 'chi', tiles: meldTiles }]));
            if (ukBefore > 0 && ukAfter < ukBefore * keepAt) return false;
        }
    }
    const score = scoreChiCombo(hands[player], tile, combo, exposed, player);
    const style = aiPersonality[player] || 'shrewd';
    const conf = (aiLearn.confidence[style] && aiLearn.confidence[style].callAggr) || 0;
    const open = isKaimen(exposed);
    // 开门：要有明显收益；未开门：新规则下没开门自摸/点炮都要多罚一倍，门槛降到 1，更愿意开门
    const baseThreshold = open ? 4 : 1;
    let threshold = baseThreshold - conf * 0.6;
    // AI 4.0 提强4 纪律2：门清贵重手不破——门清且这手牌价值高时，吃要付出代价（阈值+6，不硬拦）
    if (exposed.length === 0) {
        try {
            if (winValue(hands[player], exposed, player) > 2500) threshold += 6;
        } catch (e) {}
    }
    const actual = score >= threshold;
    // 轴1归因：跟"没学过(conf=0)"时会不会选得不一样比一比，选得不一样说明这条轴真的起作用了
    if (actual !== (score >= baseThreshold)) markAxisUsed(player, 'callAggr');
    return actual;
}

// 只有出牌者的下家能吃；如果下家是AI，检查AI是否能吃
function findAiChi(discarder, tile) {
    const next = nextPlayerOf(discarder);
    if (next === 'bottom') return null; // 你的吃已经在别处处理
    if (isTenpai(next)) return null; // 已上听不吃，避免拆听
    if (exposedMelds[next].length >= 3) return null; // 穷胡规则：不能手把一
    const combos = findChiCombos(hands[next], tile);
    if (!combos.length) return null;
    // 在多种吃法里选评分最高且 shouldAiChi 通过的
    let best = null;
    let bestScore = -Infinity;
    for (const combo of combos) {
        if (!shouldAiChi(next, tile, combo)) continue;
        const sc = scoreChiCombo(hands[next], tile, combo, exposedMelds[next], next);
        if (sc > bestScore) {
            bestScore = sc;
            best = combo;
        }
    }
    return best ? { player: next, combo: best } : null;
}

function aiPengClaim(p, tile) {
    discardPile.pop();
    lastCallTurn[p] = handTurnCount; // 归因细化：记这次碰/杠发生在第几巡
    if (typeof trackAiCall === 'function') trackAiCall(p); // AI 3.0 分化度：记一次吃碰
    const cnt = hands[p].filter(x => x === tile).length;
    const useGang = cnt >= 3; // 凑齐3张暗的+这张，直接杠比碰更优
    const takeCount = useGang ? 3 : 2;
    takeTilesFromHand(p, tile, takeCount);
    currentIndex = turnOrder.indexOf(p);
    if (useGang) {
        exposedMelds[p].push({ type: 'gang', tiles: [tile, tile, tile, tile], concealed: false });
        logFlow(nameOf(p) + ' 杠了 ' + tileGlyph(tile));
        speak('杠' + tileName(tile));
        render();
        try { if (typeof sfxGang === 'function') sfxGang(); } catch (e) {}
try { if (typeof feelBanner === 'function') feelBanner('杠', p); } catch (e) {}
        aiDrawReplacement(p);
    } else {
        exposedMelds[p].push({ type: 'peng', tiles: [tile, tile, tile] });
        logFlow(nameOf(p) + ' 碰了 ' + tileGlyph(tile));
        speak('碰' + tileName(tile));
        render();
        try { if (typeof sfxPeng === 'function') sfxPeng(); } catch (e) {}
try { if (typeof feelBanner === 'function') feelBanner('碰', p); } catch (e) {}
        gameTimeout(() => aiDiscard(p), 700);
    }
}

function aiChiClaim(p, tile, combo) {
    discardPile.pop();
    lastCallTurn[p] = handTurnCount; // 归因细化：记这次吃发生在第几巡
    if (typeof trackAiCall === 'function') trackAiCall(p); // AI 3.0 分化度：记一次吃碰
    combo.forEach(t => {
        const idx = hands[p].indexOf(t);
        if (idx > -1) hands[p].splice(idx, 1);
    });
    const meldTiles = [...combo, tile].sort(tileCompare);
    exposedMelds[p].push({ type: 'chi', tiles: meldTiles });
    currentIndex = turnOrder.indexOf(p);
    logFlow(nameOf(p) + ' 吃了 ' + tileGlyph(tile));
    speak('吃' + tileName(tile));
    render();
    try { if (typeof sfxChi === 'function') sfxChi(); } catch (e) {}
try { if (typeof feelBanner === 'function') feelBanner('吃', p); } catch (e) {}
    gameTimeout(() => aiDiscard(p), 700);
}

// AI杠后摸替补牌，检查杠上开花，否则继续正常出牌
function aiDrawReplacement(p) {
    if (deck.length <= DEAD_WALL) { declareDraw(); return; }
    const drawn = deck.pop();
    const isLastTile = deck.length === DEAD_WALL;
    hands[p].push(drawn);
    hands[p].sort(tileCompare);
    lastDrawnTile[p] = drawn;
    lastDrawWasFinal[p] = isLastTile;
    markKongDraw(p);
    validateHandCounts('aiDrawReplacement');
    render();
    try { if (typeof sfxDraw === 'function') sfxDraw(); } catch (e) {}
    if (checkHu(hands[p], exposedMelds[p], p)) {
        settleWinNow({
            winner: p,
            tile: drawn,
            selfDraw: true,
            finalTile: isLastTile,
            mode: 'selfdraw',
            payer: null,
            applyKong: true,
            logText: nameOf(p) + ' 杠上开花！自摸胡牌！',
            speakText: '胡了，自摸',
            doRender: true,
            bannerPlayer: p
        });
        return;
    }
    gameTimeout(() => aiDiscard(p), 700);
}

// 你放弃碰/吃/杠（或没有机会）之后：先看有没有AI能碰/杠，再看下家AI能不能吃，否则正常进入下一家
function resolveAiPengOrAdvance(discarder, tile) {
    const p = findAiPeng(discarder, tile);
    if (p) { aiPengClaim(p, tile); return; }
    const chi = findAiChi(discarder, tile);
    if (chi) { aiChiClaim(chi.player, tile, chi.combo); return; }
    advanceTurn();
}

function checkClaimOrAdvance(player, tile) {
    // 检查你是否可以碰/杠/吃这张牌（穷胡规则：不能手把一，最多3组面子在外，第4组必须留在手里）
    const canClaimMore = exposedMelds.bottom.length < 3;
    const canP = canClaimMore && canPeng(hands.bottom, tile);
    const canG = canClaimMore && canGang(hands.bottom, tile);
    const chiCombos = (canClaimMore && player === 'left') ? findChiCombos(hands.bottom, tile) : []; // 只能吃上家的牌
    if (canP || canG || chiCombos.length) {
        pendingClaim = { tile, fromPlayer: player, canPeng: canP, canGang: canG, chiCombos, mode: 'claim' };
        const options = [canG ? '杠' : null, canP ? '碰' : null, chiCombos.length ? '吃' : null].filter(Boolean).join('/');
        showIndicator(options, true);
        logFlow('可以' + options + '，点确认执行 / 点过');
        return;
    }
    resolveAiPengOrAdvance(player, tile);
}

/** 从指定玩家手牌里移除最多 count 张指定牌（自家/AI 碰杠共用，从末尾往前找） */
function takeTilesFromHand(player, tile, count) {
    let removed = 0;
    const hand = hands[player];
    for (let i = hand.length - 1; i >= 0 && removed < count; i--) {
        if (hand[i] === tile) { hand.splice(i, 1); removed++; }
    }
    return removed;
}

function advanceTurn() {
    if (gameOver) return;
    currentIndex = (currentIndex + 1) % turnOrder.length;
    gameTimeout(() => nextTurn(), 500);
}

