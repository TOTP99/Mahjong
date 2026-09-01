function removeTilesFromHand(hand, tilesToRemove) {
    const next = hand.slice();
    for (const t of tilesToRemove) {
        const i = next.indexOf(t);
        if (i >= 0) next.splice(i, 1);
    }
    return next;
}

/** 三门齐相关：吃/碰后是否仍覆盖三门（或至少不比现在更差） */
function suitDiversity(hand, exposed) {
    const suits = new Set();
    for (const t of hand) {
        if (tileSuit(t) !== '字') suits.add(tileSuit(t));
    }
    for (const m of (exposed || [])) {
        for (const t of m.tiles) {
            if (tileSuit(t) !== '字') suits.add(tileSuit(t));
        }
    }
    return suits.size;
}

/** 评估一种吃法：向听下降优先，其次三门齐，再次不拆对子 */
function scoreChiCombo(hand, tile, combo, exposed, player) {
    const style = aiPersonality[player] || 'shrewd';
    const before = estimateShanten(hand, exposed);
    const handAfter = removeTilesFromHand(hand, combo);
    const expAfter = exposed.concat([{ type: 'chi', tiles: [...combo, tile].sort(tileCompare) }]);
    const after = estimateShanten(handAfter, expAfter);
    let score = (before - after) * 10; // 向听改善越大越好
    // 未开门时，吃能开门有额外价值
    if (!isKaimen(exposed)) score += 4;
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
    const score = scoreChiCombo(hands[player], tile, combo, exposed, player);
    const style = aiPersonality[player] || 'shrewd';
    const conf = aiLearn.confidence[style] || 0;
    const open = isKaimen(exposed);
    const baseThreshold = open ? 4 : 2; // 开门：要有明显收益；未开门：略宽松
    return score >= baseThreshold - conf * 0.6;
}

function tileKeepTier(hand, tile) {
    const suit = tileSuit(tile);
    const rank = tileRank(tile);
    const sameCount = hand.filter(t => t === tile).length;
    let tier;

    if (sameCount >= 3) tier = 4; // 刻子
    else if (sameCount === 2) tier = 6; // 对子：不要轻易拆
    else if (suit === '字') tier = 0; // 孤立字牌（字牌没有搭子概念，出现一张就是孤立的）
    else {
        // 同花色±1/±2内是否还有别的牌，用来判断是不是“完全孤立”
        let hasNear = false;
        for (let d = 1; d <= 2; d++) {
            if (hand.includes((rank - d) + suit) || hand.includes((rank + d) + suit)) { hasNear = true; break; }
        }
        const inRun = hand.includes((rank - 1) + suit) || hand.includes((rank + 1) + suit);
        if (!hasNear) {
            tier = (rank === 1 || rank === 9) ? 3 : ([4, 5, 6].includes(rank) ? 2 : 1);
        } else if (inRun) {
            // 连张/搭子（如45、56、67）：默认高优先级保留；但若是边张（12等3 / 89等7）
            // 且那张已经死绝（记牌确认4张都看得见了），就不用死守这个没指望的等张
            let edgeDeadWait = false;
            if (rank === 1 && hand.includes(2 + suit) && isTileDead(3 + suit)) edgeDeadWait = true;
            if (rank === 2 && hand.includes(1 + suit) && isTileDead(3 + suit)) edgeDeadWait = true;
            if (rank === 8 && hand.includes(9 + suit) && isTileDead(7 + suit)) edgeDeadWait = true;
            if (rank === 9 && hand.includes(8 + suit) && isTileDead(7 + suit)) edgeDeadWait = true;
            tier = edgeDeadWait ? 1 : 5;
        } else {
            // 嵌张（如4_6空档等5）：记牌检查缺的那张是不是已经死了，死了就不用留着盼了
            let deadWait = false;
            if (hand.includes((rank - 2) + suit) && isTileDead((rank - 1) + suit)) deadWait = true;
            if (hand.includes((rank + 2) + suit) && isTileDead((rank + 1) + suit)) deadWait = true;
            tier = deadWait ? 1 : 3;
        }
    }

    // 三门齐保护：这是本门(万/条/筒)僅剩的一张，且三门都还在，打了就彻底断这门了 —— 提高保留优先级
    if (tier < 5 && protectsThreeSuits(hand, tile)) tier = 5;
    return tier;
}

// 三家AI性格：北(上家)保守 / 南(下家)激进 / 西(对家)精明
const aiPersonality = { left: 'conservative', right: 'aggressive', top: 'shrewd' };

// 检查某玩家打出这张牌，是否会点炮给别的玩家（用于AI出牌时的危险牌回避）
function isTileDangerousFor(player, tile) {
    return turnOrder.some(p => p !== player && checkHu([...hands[p], tile], exposedMelds[p], p));
}

// 在保留等级最低（最优先舍弃）的档位里，优先选不会点炮的牌；避炮的松紧度按性格调整：
// 保守=不惜多跳档也要找安全牌；激进=只在最该舍弃那档找，找不到就照打求效率；精明=折中，最多跳3档
// 牌墙剩余量的紧迫感：越接近荒牌墙，大家都更求稳（多跳几档也要找安全牌）
function wallUrgencyBonus() {
    const remaining = deck.length - DEAD_WALL;
    if (remaining <= 8) return 3;
    if (remaining <= 16) return 1;
    return 0;
}

// 给定手牌+副露，若已是听牌形态，返回可胡的牌列表，否则 []
function getWinningTilesOf(concealed, exposed, player) {
    const neededLen = (4 - exposed.length) * 3 + 2;
    if (concealed.length !== neededLen - 1) return [];
    return allTileTypes().filter(t => checkHu([...concealed, t], exposed, player));
}

// 进张数：打出这张后，还有多少种（未死绝的）牌摸到能让向听数继续下降
// 用于同保留档位打平时的 tie-break，取代纯随机，让AI优先留住选择面更宽的牌
function ukeireCount(hand, exposed) {
    const shan = estimateShanten(hand, exposed);
    let count = 0;
    for (const t of allTileTypes()) {
        if (isTileDead(t)) continue; // 已经死绝的牌摸不到，没有实际意义
        if (estimateShanten([...hand, t], exposed) < shan) count++;
    }
    return count;
}

function chooseAiDiscardTile(hand, player) {
    const exposed = exposedMelds[player];
    const style = aiPersonality[player] || 'shrewd';

    // —— 已上听 / 摸牌后仍可保听：优先打出后仍听的牌，且尽量不换听口 ——
    const keepTenpai = []; // { tile, wins, overlap, safe }
    for (const t of hand) {
        const remain = hand.slice();
        const ix = remain.indexOf(t);
        if (ix < 0) continue;
        remain.splice(ix, 1);
        const wins = getWinningTilesOf(remain, exposed, player);
        if (!wins.length) continue;
        const prev = aiWaitTiles[player] || [];
        const overlap = prev.length ? wins.filter(w => prev.includes(w)).length : wins.length;
        keepTenpai.push({
            tile: t,
            wins,
            overlap,
            waitCount: wins.length,
            safe: !isTileDangerousFor(player, t)
        });
    }
    if (keepTenpai.length) {
        // 1) 有不点炮的保听优先；2) 尽量与原听口重叠；3) 听张数更多
        const pool = keepTenpai.some(x => x.safe) ? keepTenpai.filter(x => x.safe) : keepTenpai;
        pool.sort((a, b) => {
            if (b.overlap !== a.overlap) return b.overlap - a.overlap;
            if (b.waitCount !== a.waitCount) return b.waitCount - a.waitCount;
            return 0;
        });
        const best = pool[0];
        // 在同档最优里随机，避免死板
        const top = pool.filter(x => x.overlap === best.overlap && x.waitCount === best.waitCount);
        const chosen = top[Math.floor(Math.random() * top.length)];
        aiWaitTiles[player] = chosen.wins;
        return chosen.tile;
    }
    // 已无法保听（或尚未上听）→ 清空听口记忆；按「向听优先 + 安全 + 保留档」舍牌
    aiWaitTiles[player] = [];

    const candidates = [];
    for (const t of hand) {
        const remain = removeTilesFromHand(hand, [t]);
        const shan = estimateShanten(remain, exposed);
        const tier = tileKeepTier(hand, t);
        const safe = !isTileDangerousFor(player, t);
        // 穷胡专属条件：打出这张后，三门齐/幺九/刻子还保不保得住（标准向听算法看不到这三条，靠这里补）
        const qh = analyzeHu(remain, exposed, player);
        let qhPenalty = 0;
        if (!qh.sanmenqi) qhPenalty += 2;
        if (!qh.yaojiu) qhPenalty += 2;
        if (!qh.kezi) qhPenalty += 1;
        candidates.push({ tile: t, shan, tier, safe, qhPenalty });
    }
    // 向听越小越好；同向听优先保住三门齐/幺九/刻子；再优先安全；再优先扔掉保留档低的牌
    candidates.sort((a, b) => {
        if (a.shan !== b.shan) return a.shan - b.shan;
        if (a.qhPenalty !== b.qhPenalty) return a.qhPenalty - b.qhPenalty;
        if (a.safe !== b.safe) return a.safe ? -1 : 1;
        if (a.tier !== b.tier) return a.tier - b.tier;
        return 0;
    });
    const bestShan = candidates[0].shan;
    // 性格：可在最佳向听的邻近档里找安全牌
    const shanSlack = style === 'conservative' ? 1 : (style === 'aggressive' ? 0 : 1);
    const urgency = wallUrgencyBonus();
    let pool = candidates.filter(c => c.shan <= bestShan + shanSlack);
    // 学习偏好：这个性格最近战绩差（常点炮/常没听牌）就强制找安全牌；战绩好则可以少受"求稳"的约束
    const conf = aiLearn.confidence[style] || 0;
    const cautious = conf <= -1.5;
    const confident = conf >= 1.5;
    if (urgency >= 1 || cautious) {
        const safePool = pool.filter(c => c.safe);
        if (safePool.length) pool = safePool;
    } else if (style !== 'aggressive' && !confident) {
        const safePool = pool.filter(c => c.safe);
        if (safePool.length) pool = safePool;
    }
    // 在池内按 tier 升序（先丢不保的）
    pool.sort((a, b) => a.tier - b.tier || (a.safe === b.safe ? 0 : (a.safe ? -1 : 1)));
    const topTier = pool[0].tier;
    let finalPool = pool.filter(c => c.tier === topTier);
    // 同档打平：改用进张数排序（谁打出去后选择面更宽就先打谁），而不是纯随机
    if (finalPool.length > 1) {
        finalPool = finalPool.map(c => ({
            ...c,
            ukeire: ukeireCount(removeTilesFromHand(hand, [c.tile]), exposed)
        })).sort((a, b) => b.ukeire - a.ukeire);
        const bestUkeire = finalPool[0].ukeire;
        finalPool = finalPool.filter(c => c.ukeire === bestUkeire);
    }
    return finalPool[Math.floor(Math.random() * finalPool.length)].tile;
}

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
                        offerHu({ mode: 'dianpao', tile: gTile, fromPlayer: player, concealed: [...hands.bottom, gTile] });
                        return;
                    }
                    hands[robber].push(gTile);
                    gameOver = true;
                    winner = robber;
                    const before = [...hands[robber]];
                    before.splice(before.indexOf(gTile), 1);
                    const bonus = scoreWinningHand(before, gTile, exposedMelds[robber], false, false);
                    const result = settleScore(robber, 'dianpao', player, bonus);
                    logFlow(nameOf(robber) + ' 抢杠胡了 ' + nameOf(player) + '！' + result.detail);
                    speak('胡了，' + voiceName(player) + '点炮');
                    learnFromWin(robber, player);
                    render();
                    showResultModal(robber, 'dianpao', player, bonus, result, gTile);
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
                aiDrawReplacement(player);
                return;
            }
        }
    }
    // 保牌策略：孤立字牌 > 孤立中张(非4/5/6优先) > ... > 对子最后才拆，同等级优先选不点炮的
    const tile = chooseAiDiscardTile(hand, player);
    hand.splice(hand.indexOf(tile), 1);
    discardPile.push({ player, tile });
    render();
    speak(tileName(tile));

    // 多家可以胡的话，按下家方向离出牌人最近的先胡
    const ronPlayer = findRonPriority(player, tile);
    if (ronPlayer === 'bottom') {
        const testHand = [...hands.bottom, tile];
        offerHu({ mode: 'dianpao', tile, fromPlayer: player, concealed: testHand });
        return;
    }
    if (ronPlayer) {
        discardPile.pop();
        hands[ronPlayer].push(tile);
        gameOver = true;
        winner = ronPlayer;
        const before = [...hands[ronPlayer]];
        before.splice(before.indexOf(tile), 1);
        const bonus = scoreWinningHand(before, tile, exposedMelds[ronPlayer], false, false);
        const result = settleScore(ronPlayer, 'dianpao', player, bonus);
        logFlow(nameOf(player) + ' 点炮，' + nameOf(ronPlayer) + ' 胡了！' + result.detail);
        speak('胡了，' + voiceName(player) + '点炮');
        learnFromWin(ronPlayer, player);
        render();
        showResultModal(ronPlayer, 'dianpao', player, bonus, result, tile);
        return;
    }

    checkClaimOrAdvance(player, tile);
}

// 局势判断：这张牌该不该碰（按性格调整松紧度）
// 还没开门：都想尽快满足开门这个硬性条件，优先碰
// 保守：最多碰2组就收手求稳，且必须碰完还留得住将
// 激进：能碰就碰，追求快速开门或飘(碰碰胡)，上限放宽到快满4组前都碰
// 精明：折中，3组以内且碰完留得住将才碰；中发白/风牌额外值得碰
// 中发白刻子本身带番(×2)，价值高于普通风牌，单独多给一档向听容忍与决策优先级
// 手里还有没有连张(同花色相邻的牌)？没有的话说明这手牌天然在往碰碰胡(飘,8倍)方向走
function isGoingForTriplets(hand) {
    for (const t of hand) {
        const suit = tileSuit(t), rank = tileRank(t);
        if (suit === '字') continue;
        if (hand.includes((rank + 1) + suit)) return false;
    }
    return true;
}

function shouldAiPeng(p, tile) {
    if (isTenpai(p)) return false; // 已上听不碰，避免拆听
    const style = aiPersonality[p] || 'shrewd';
    const conf = aiLearn.confidence[style] || 0; // 学习偏好：战绩好更敢碰，战绩差更谨慎
    const exposed = exposedMelds[p];
    const openCount = exposed.length;
    if (openCount >= 3) return false; // 穷胡：不能手把一

    const hand = hands[p];
    const handAfter = removeTilesFromHand(hand, [tile, tile]);
    const expAfter = exposed.concat([{ type: 'peng', tiles: [tile, tile, tile] }]);
    const shanBefore = estimateShanten(hand, exposed);
    const shanAfter = estimateShanten(handAfter, expAfter);

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
    // 激进可略多；冲碰碰胡再+1；学习战绩很好再多给1个名额，很差则少给1个
    // 中发白刻子本身带番，即使已接近上限也允许碰（下面用 isHonorValue 放行）
    const cap = (style === 'conservative' ? 2 : (style === 'aggressive' ? 3 : 2))
        + (chasingPengPeng ? 1 : 0)
        + (conf >= 1.5 ? 1 : 0) - (conf <= -1.5 ? 1 : 0);
    if (openCount >= cap && !isHonorValue) return false;

    // 向听约束：默认不能明显变差
    // 学习战绩好 / 补上穷胡缺项 / 中发白刻子 → 各可多容忍一档
    const confSlack = conf >= 1.5 ? 1 : (conf <= -1.5 ? -1 : 0);
    const qhSlack = qhGain ? 1 : 0;
    const dragonSlack = isDragon ? 1 : 0; // 中发白刻子×2是稳赚的，比赌三门齐更确定
    const baseSlack = confSlack + qhSlack + dragonSlack;

    if (style === 'conservative') {
        if (shanAfter > shanBefore + Math.max(0, baseSlack)) return false;
    } else if (style === 'shrewd') {
        if (shanAfter > shanBefore + Math.max(0, (openCount === 0 ? 1 : 0) + baseSlack)) return false;
    } else {
        // aggressive：允许为开门或有价值字牌略损向听
        if (shanAfter > shanBefore + Math.max(0, (openCount === 0 || isHonorValue ? 1 : 0) + baseSlack)) return false;
    }

    // 未开门：优先碰（在向听可接受的前提下）
    if (openCount === 0) return true;

    // 已开门：优先级 中发白 > 冲碰碰胡 > 普通有价值字牌(风) > 保住将
    if (isDragon && shanAfter <= shanBefore + 1) return true; // 中发白刻子带番，多容忍1档也碰
    if (chasingPengPeng && shanAfter <= shanBefore) return true;
    if (isHonorValue && shanAfter <= shanBefore + 1) return true;
    return keepsJiang && shanAfter <= shanBefore;
}

// 除discarder外，检查是否有AI能碰（或杠）这张牌，且局势上值得碰
function findAiPeng(discarder, tile) {
    for (const p of ['top', 'left', 'right']) {
        if (p === discarder) continue;
        if (exposedMelds[p].length >= 3) continue; // 穷胡规则：不能手把一，最多3组面子在外
        if (canPeng(hands[p], tile) && shouldAiPeng(p, tile)) return p;
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
        aiDrawReplacement(p);
    } else {
        exposedMelds[p].push({ type: 'peng', tiles: [tile, tile, tile] });
        logFlow(nameOf(p) + ' 碰了 ' + tileGlyph(tile));
        speak('碰' + tileName(tile));
        render();
        setTimeout(() => aiDiscard(p), 700);
    }
}

function aiChiClaim(p, tile, combo) {
    discardPile.pop();
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
    setTimeout(() => aiDiscard(p), 700);
}

// AI杠后摸替补牌，检查杠上开花，否则继续正常出牌
function aiDrawReplacement(p) {
    if (deck.length <= DEAD_WALL) { declareDraw(); return; }
    const drawn = deck.pop();
    const isLastTile = deck.length === DEAD_WALL;
    hands[p].push(drawn);
    hands[p].sort(tileCompare);
    render();
    if (checkHu(hands[p], exposedMelds[p], p)) {
        gameOver = true;
        winner = p;
        const before = [...hands[p]];
        before.splice(before.indexOf(drawn), 1);
        const bonus = scoreWinningHand(before, drawn, exposedMelds[p], true, isLastTile);
        const result = settleScore(p, 'selfdraw', null, bonus);
        logFlow(nameOf(p) + ' 杠上开花！自摸胡牌！' + result.detail);
        speak('胡了，自摸');
        learnFromWin(p, null);
        render();
        showResultModal(p, 'selfdraw', null, bonus, result, drawn);
        return;
    }
    setTimeout(() => aiDiscard(p), 700);
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
        showIndicator('🔔 ' + options, true);
        logFlow('可以' + options + '，点✅执行 / 点❎过');
        return;
    }
    resolveAiPengOrAdvance(player, tile);
}

// 点✅：按 杠 > 碰 > 吃 优先级执行
function acceptClaim() {
    if (!pendingClaim) return;
    if (pendingClaim.mode === 'diceMenu') return; // 清零菜单用专用按钮，不走✅
    if (pendingClaim.mode === 'nextGame') {
        pendingClaim = null;
        hideIndicator();
        startGame();
        return;
    }
    if (pendingClaim.mode === 'selfGang') {
        executeSelfGang();
        return;
    }
    // 别人打牌的吃碰杠
    if (pendingClaim.canGang) { callGang(); return; }
    if (pendingClaim.canPeng) { callPeng(); return; }
    if (pendingClaim.chiCombos && pendingClaim.chiCombos.length) { callChi(); return; }
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

function callGang() {
    if (gameOver) { logFlow('本局已结束'); return; }
    // 明杠：别人打出的牌，手里已有3张（由 acceptClaim 在 canGang 时调用）
    // 加杠/暗杠走 executeSelfGang，不在此重复
    if (!pendingClaim || !pendingClaim.canGang) { logFlow('现在不能杠'); return; }
    const { tile, fromPlayer } = pendingClaim;
    discardPile.pop();
    takeTilesFromHand('bottom', tile, 3);
    exposedMelds.bottom.push({ type: 'gang', tiles: [tile, tile, tile, tile], concealed: false });
    pendingClaim = null;
    currentIndex = turnOrder.indexOf('bottom');
    hideIndicator();
    logFlow('你杠了 ' + tileGlyph(tile) + '（' + nameOf(fromPlayer) + '打出），补牌中...');
    speak('杠' + tileName(tile));
    render();
    drawReplacementAndContinue();
}

// 杠后从牌墙补一张，检查杠上开花，否则等你出牌
function drawReplacementAndContinue() {
    if (deck.length <= DEAD_WALL) { declareDraw(); return; }
    const drawn = deck.pop();
    hands.bottom.push(drawn);
    hands.bottom.sort(tileCompare);
    lastDrawnIndex = hands.bottom.lastIndexOf(drawn);
    selectedIndex = null;
    render();
    if (checkHu(hands.bottom, exposedMelds.bottom, 'bottom')) {
        offerHu({ mode: 'selfdraw', concealed: hands.bottom }); // 杠上开花
        return;
    }
    offerSelfGangIfAny();
    logFlow('补牌：' + tileGlyph(drawn) + '，请出牌');
}

function handleDiscard(event) {
    if (gameOver) return;
    // 别人打牌的吃碰杠必须先处理；自己的可选杠不挡出牌
    if (pendingClaim && pendingClaim.mode !== 'selfGang') return;
    if (pendingClaim && pendingClaim.mode === 'selfGang') {
        pendingClaim = null;
        hideIndicator();
    }
    if (turnOrder[currentIndex] !== 'bottom') return; // 不是你的回合
    const target = event.target.closest('.tile');
    if (!target || target.dataset.index === undefined) return;
    const idx = parseInt(target.dataset.index, 10);
    if (isNaN(idx) || idx < 0 || idx >= hands.bottom.length) return;

    if (selectedIndex !== idx) {
        // 第一次点这张（或改按了别的牌）：标记➡️等待确认，不真正出牌
        selectedIndex = idx;
        render();
        return;
    }

    // 再次点同一张：真正打出
    const card = hands.bottom[idx];
    hands.bottom.splice(idx, 1);
    discardPile.push({ player: 'bottom', tile: card });
    selectedIndex = null;
    lastDrawnIndex = null;
    speak(tileName(card));
    logFlow('你打出了 ' + tileGlyph(card));
    render();

    // 检查是否有AI能胡你打出的这张牌
    const ronPlayer = findRonPriority('bottom', card);
    if (ronPlayer) {
        discardPile.pop();
        hands[ronPlayer].push(card);
        gameOver = true;
        winner = ronPlayer;
        const before = [...hands[ronPlayer]];
        before.splice(before.indexOf(card), 1);
        const bonus = scoreWinningHand(before, card, exposedMelds[ronPlayer], false, false);
        const result = settleScore(ronPlayer, 'dianpao', 'bottom', bonus);
        logFlow(nameOf(ronPlayer) + ' 点炮胡了你打出的牌！' + result.detail);
        speak('胡了，' + voiceName('bottom') + '点炮');
        learnFromWin(ronPlayer, 'bottom');
        render();
        showResultModal(ronPlayer, 'dianpao', 'bottom', bonus, result, card);
        return;
    }
    resolveAiPengOrAdvance('bottom', card);
}

function advanceTurn() {
    if (gameOver) return;
    currentIndex = (currentIndex + 1) % turnOrder.length;
    setTimeout(() => nextTurn(), 500);
}

