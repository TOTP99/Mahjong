// ========== 11-ai-discard：AI 弃牌决策 ==========
// 三家 AI "打出哪张"：保听 → 候选排序 → 求稳过滤 → 炮牌截留/不喂下家 → tier 收窄 → 打平（进张数/2步期望）→ 攻击危险规避。
// 吃/碰的"要不要"（shouldAiChi/shouldAiPeng）与叫牌执行、回合推进在 11-ai-claim-3.js。
// 2026-09-30 骨架重组：自 11-ai-discard-claim-3.js 拆分，零行为变化。
/** 缓存 estimateShanten：键=排序后暗牌+副露数，一次 AI 决策内避免重复跑 DFS */
const _shantenCache = new Map();
function estimateShantenCached(concealed, exposed) {
    const key = concealed.slice().sort().join(',') + '|' + (exposed ? exposed.length : 0);
    let v = _shantenCache.get(key);
    if (v === undefined) {
        v = estimateShanten(concealed, exposed);
        if (_shantenCache.size > 4000) _shantenCache.clear();
        _shantenCache.set(key, v);
    }
    return v;
}

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

function tileKeepTier(hand, tile, style, neutralHonor) {
    const suit = tileSuit(tile);
    const rank = tileRank(tile);
    const sameCount = hand.filter(t => t === tile).length;
    let tier;

    if (sameCount >= 3) tier = 4; // 刻子
    else if (sameCount === 2) tier = 6; // 对子：不要轻易拆
    else if (suit === '字') {
        // 轴5 字牌保留倾向：孤立字牌原本一律tier 0（最先丢），按性格+学习加一点保留倾向
        // （aggressive更愿意赌字牌刻子，conservative维持原来的0，不倒扣成负数）
        // neutralHonor=true 时强制当作没有这条轴（bias=0），给归因用的"没学过会怎么选"对照
        const learn = aiLearn.confidence[style] || {};
        const learnedBias = neutralHonor ? 0 : (learn.honorHold >= 1.5 ? 1 : (learn.honorHold <= -1.5 ? -1 : 0));
        const bias = neutralHonor ? 0 : (AI_TRAITS[style] || AI_TRAITS.shrewd).honorHoldBias;
        tier = Math.max(0, bias + learnedBias);
    }
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
            if (rank === 1 && hand.includes(2 + suit) && isTileDead(3 + suit, hand)) edgeDeadWait = true;
            if (rank === 2 && hand.includes(1 + suit) && isTileDead(3 + suit, hand)) edgeDeadWait = true;
            if (rank === 8 && hand.includes(9 + suit) && isTileDead(7 + suit, hand)) edgeDeadWait = true;
            if (rank === 9 && hand.includes(8 + suit) && isTileDead(7 + suit, hand)) edgeDeadWait = true;
            tier = edgeDeadWait ? 1 : 5;
        } else {
            // 嵌张（如4_6空档等5）：记牌检查缺的那张是不是已经死了，死了就不用留着盼了
            let deadWait = false;
            if (hand.includes((rank - 2) + suit) && isTileDead((rank - 1) + suit, hand)) deadWait = true;
            if (hand.includes((rank + 2) + suit) && isTileDead((rank + 1) + suit, hand)) deadWait = true;
            tier = deadWait ? 1 : 3;
        }
    }

    // 三门齐保护：这是本门(万/条/筒)僅剩的一张，且三门都还在，打了就彻底断这门了 —— 提高保留优先级
    if (tier < 5 && protectsThreeSuits(hand, tile)) tier = 5;
    return tier;
}

// 三家AI性格：北(上家)保守 / 南(下家)激进 / 西(对家)精明
const aiPersonality = { left: 'conservative', right: 'aggressive', top: 'shrewd' };

// ---------- AI 7轴静态差异化参数（第一步：先写死三性格的不同倾向，暂不接学习） ----------
// 轴1(吃碰激进度)/轴2(防守让牌) 已经在 scoreChiCombo/shouldAiChi/shouldAiPeng/chooseAiDiscardTile
// 里天然按 style 分支，不需要额外的表；这里只收 3~7 这5条目前代码里没有性格区分的开关
const AI_TRAITS = {
    conservative: {
        chaseSpecialSlack: 0,  // 轴3 特殊牌型追逐：碰碰胡时额外能容忍的向听损失档数
        wallCautionAt: 16,     // 轴4 残局求稳：牌墙剩这么多张开始求稳（越大越早转守）
        honorHoldBias: -1,     // 轴5 字牌保留：孤立字牌保留档加成（越低越想早丢）
        cannonHoldTier: 2,     // 轴6 炮牌截留：为压住炮牌，愿意多容忍几档tier变差
        blockXiajiaTier: 2,    // 轴7a 不喂下家：为不喂下家，愿意多容忍几档tier变差
        riskDefenseAt: 0.5,    // 轴2扩展：对手"看起来要听牌"的风险分到多少就转防守，越低越神经质
        ukeireKeepAt: 0.5      // 吃/碰后进张数至少保留几成（保守：腰斩就 veto）
    },
    aggressive: {
        chaseSpecialSlack: 2,
        wallCautionAt: 6,
        honorHoldBias: 1,
        cannonHoldTier: 0,
        blockXiajiaTier: 0,
        riskDefenseAt: 1.15,   // 只有极端信号（比如对家已经3组副露）才会让激进型也收一收
        ukeireKeepAt: 0.25     // 激进：几乎不看进张损失，只看向听
    },
    shrewd: {
        chaseSpecialSlack: 1,
        wallCautionAt: 10,
        honorHoldBias: 0,
        cannonHoldTier: 1,
        blockXiajiaTier: 1,
        riskDefenseAt: 0.85,
        ukeireKeepAt: 0.45     // 精明：进张损失过大也 veto，但比保守宽容
    }
};

// 按玩家取静态性格参数（AI 3.0 性格引擎：静态底色；学习增量另走 aiLearn.confidence）
function aiTraitOf(player) {
    const style = (typeof aiPersonality !== 'undefined' && aiPersonality[player]) || 'shrewd';
    return AI_TRAITS[style] || AI_TRAITS.shrewd;
}

function prevPlayerOf(p) {
    const idx = turnOrder.indexOf(p);
    return turnOrder[(idx + turnOrder.length - 1) % turnOrder.length];
}
function acrossPlayerOf(p) {
    const idx = turnOrder.indexOf(p);
    return turnOrder[(idx + 2) % turnOrder.length];
}
// 轴6兜底用：这张牌有几家能靠它胡（而不只是"有没有"），候选全是炮牌时挑数字最小的那张
function dangerCount(player, tile) {
    return turnOrder.filter(p => p !== player && checkHu([...hands[p], tile], exposedMelds[p], p)).length;
}
// 轴7a：这张牌会不会让下家吃/碰（下家是"你"时不受此轴约束——喂不喂你不算AI的"位置感"问题）
function feedsXiajia(player, tile) {
    const next = nextPlayerOf(player);
    if (next === 'bottom') return false;
    if (isTenpai(next)) return false; // 下家已听牌，危险度已经由 isTileDangerousFor 覆盖，这里不重复算
    if (exposedMelds[next].length >= 3) return false;
    if (canPeng(hands[next], tile)) return true;
    return findChiCombos(hands[next], tile).length > 0;
}

// 检查某玩家打出这张牌，是否会点炮给别的玩家（用于AI出牌时的危险牌回避）
function isTileDangerousFor(player, tile) {
    return turnOrder.some(p => p !== player && checkHu([...hands[p], tile], exposedMelds[p], p));
}

// 轴2扩展：对手"看起来要听牌了"的启发式风险分（不是读心，纯看得见的信号）——
// 跟 isTileDangerousFor 互补：那个查的是"这一刻打出去必死"，这个查的是"这家开始有听牌相"，
// 用来提前收一收，而不是等对方真听了才后知后觉
function estimateTenpaiRisk(opponent) {
    let risk = 0;
    const melds = exposedMelds[opponent] ? exposedMelds[opponent].length : 0;
    risk += melds * 0.35;
    if (melds >= 3) risk += 0.4; // 穷胡规则最多3组副露，到顶了基本就是在等最后一口
    const recent = discardPile.filter(d => d.player === opponent).slice(-4);
    if (recent.length >= 3) {
        const midCount = recent.filter(d => {
            const s = tileSuit(d.tile), r = tileRank(d.tile);
            return s !== '字' && r >= 4 && r <= 6;
        }).length;
        if (midCount === recent.length) risk += 0.3; // 连续切中张：该扔的边张/字牌早扔完了，牌型收紧
    }
    return Math.min(risk, 1.2);
}

// ========== AI 4.0 移植（新版提强点，v18 适配版） ==========
// 以下三个函数 + 下面各处的"AI 4.0"标记修改，构成从新版 AI 4.0 到旧版 v18 的完整移植。
// 适配原则：只用 v18 已有全局变量/函数（不引入 EV 引擎），所有新逻辑失败时回退到原行为。

// ---------- 对手听牌概率（AI 4.0 提强2：读人系统化，v18 适配） ----------
// 综合公开信号估计某对手已听牌的概率 0~1：
//   副露数（最强信号）+ 舍牌趋势（连续切边张/字牌=牌型收紧）+ 巡数（越晚越可能听）
// 只用公开信息，不读暗牌。v18 版用裸全局变量（exposedMelds/discardPile/handTurnCount）。
function estimateOppTenpai(opp) {
    let p = 0.05; // 基础先验
    try {
        const melds = (exposedMelds[opp] || []).length;
        // 副露：1组 +0.15，2组 +0.35，3组 +0.6（穷胡最多3组，到顶基本在等）
        p += [0, 0.15, 0.35, 0.6][Math.min(3, melds)] || 0;
        // 舍牌趋势：最近 4 张若全是边张/字牌，+0.2（该扔的早扔完了）
        const recent = discardPile.filter(d => d.player === opp).slice(-4);
        if (recent.length >= 3) {
            const edgeCount = recent.filter(d => {
                const s = tileSuit(d.tile), r = tileRank(d.tile);
                return s === '字' || r === 1 || r === 9;
            }).length;
            if (edgeCount === recent.length) p += 0.2;
            else if (edgeCount >= recent.length - 1) p += 0.1;
        }
        // 巡数：每 10 巡 +0.08，上限 +0.3（别人也在往听牌走）
        p += Math.min(0.3, (handTurnCount || 0) / 10 * 0.08);
    } catch (e) {}
    return Math.min(0.95, Math.max(0.02, p));
}

// ---------- 和牌价值（AI 4.0 提强3：分值意识，v18 适配） ----------
// 估计这手牌"如果胡了"能值多少（1000×番数启发式）。AI 用它权衡"快胡便宜的" vs "慢做贵的"。
// 只看自己的手牌+副露，不读对手。
function winValue(hand, exposed, player) {
    let mult = 1;
    const cnt = {};
    try {
        for (const t of hand) cnt[t] = (cnt[t] || 0) + 1;
        for (const m of (exposed || [])) for (const t of m.tiles) cnt[t] = (cnt[t] || 0) + 1;
    } catch (e) {}
    // 中发白：刻子 ×2；对子有潜力 ×1.4
    try {
        if (typeof dragonTilesArr !== 'undefined') {
            const hasTrip = dragonTilesArr.some(d => (cnt[d] || 0) >= 3);
            const hasPair = dragonTilesArr.some(d => (cnt[d] || 0) === 2);
            if (hasTrip) mult *= 2;
            else if (hasPair) mult *= 1.4;
        }
    } catch (e) {}
    // 碰碰胡潜力：刻子/对子结构
    const vals = Object.values(cnt);
    const triplets = vals.filter(n => n >= 3).length;
    const pairs = vals.filter(n => n >= 2).length;
    if (triplets >= 3) mult *= 5;       // 很像碰碰胡（×8 的潜力）
    else if (triplets >= 2 && pairs >= 4) mult *= 2.5;
    else if (pairs >= 5) mult *= 1.6;   // 七小对/多对子潜力
    // 门清：没副露，对手难读，有隐藏价值
    if (!exposed || exposed.length === 0) mult *= 1.25;
    // 杠：每个杠都是实打实的番
    try {
        const gangs = (exposed || []).filter(m => m.type === 'gang').length;
        if (gangs) mult *= Math.pow(1.8, gangs);
    } catch (e) {}
    // 七小对进行中（规则允许时）
    try {
        if (typeof ruleAllowsSevenPairs === 'function' && ruleAllowsSevenPairs() && pairs >= 5 && hand.length >= 10) {
            mult = Math.max(mult, 4); // 七小对 ×8，至少给 4
        }
    } catch (e) {}
    return 1000 * mult;
}

// ---------- 2步期望搜索（AI 4.0 提强1，v18 适配） ----------
// 打出 D 后，摸到各种进张 T 后的向听期望。比只看 immediate ukeire 更准：
// 有些牌进张多但都是"死胡同"（摸到后还是难受），2步能看出来。
// 只对 ukeire 打平的前 5 名调用，单次约几十毫秒，走 estimateShantenCached 缓存。
function twoStepExp(hand, exposed, discard) {
    const hand1 = hand.slice();
    const di = hand1.indexOf(discard);
    if (di < 0) return 8;
    hand1.splice(di, 1);
    let s1;
    try { s1 = estimateShantenCached(hand1, exposed); }
    catch (e) { return 8; }
    // hand1 的进张（带剩余张数）：4 - 已见 - 自己手里
    const ukeire = [];
    try {
        for (const t of allTileTypes()) {
            let seen = 0;
            try { seen = tileSeenCount(t); } catch (e2) { seen = 0; }
            const inHand = hand1.filter(x => x === t).length;
            const rem = Math.max(0, 4 - seen - inHand);
            if (!rem) continue;
            if (estimateShantenCached(hand1.concat([t]), exposed) < s1) {
                ukeire.push({ tile: t, rem: rem });
            }
        }
    } catch (e) { return s1; }
    if (!ukeire.length) return s1;
    ukeire.sort((a, b) => b.rem - a.rem);
    const top = ukeire.slice(0, 8); // 只看最可能摸到的 8 种
    let wSum = 0, wTot = 0;
    try {
        for (const u of top) {
            const s2 = estimateShantenCached(hand1.concat([u.tile]), exposed);
            // 上听 (s2==0) 给 -0.5 奖励：能上听的打法优先
            const score = s2 === 0 ? -0.5 : s2;
            wSum += u.rem * score;
            wTot += u.rem;
        }
    } catch (e) { return s1; }
    return wTot ? wSum / wTot : s1;
}

// 轴：速度 vs 牌值——粗略估一下这手牌大概能算多大，不追求精确，只用来在"求快"和"求大"间做取舍
function estimateHandValue(hand, exposed) {
    let mult = 1;
    const allTiles = [...hand, ...exposed.flatMap(m => m.tiles)];
    const suits = new Set(allTiles.map(tileSuit));
    if (isGoingForTriplets(hand)) mult += 1; // 碰碰胡苗头
    const numSuits = [...suits].filter(s => s !== '字');
    if (numSuits.length === 1 && !suits.has('字')) mult += 2; // 清一色苗头
    else if (numSuits.length === 1) mult += 1; // 混一色苗头
    mult += exposed.filter(m => m.type === 'gang').length; // 已经杠过的，牌越来越大
    const yaojiuCount = allTiles.filter(t => { const r = tileRank(t), s = tileSuit(t); return s === '字' || r === 1 || r === 9; }).length;
    if (allTiles.length && yaojiuCount / allTiles.length >= 0.5) mult += 0.5; // 幺九多，字牌/幺九加成有戏
    return mult;
}

// 在保留等级最低（最优先舍弃）的档位里，优先选不会点炮的牌；避炮的松紧度按性格调整：
// 保守=不惜多跳档也要找安全牌；激进=只在最该舍弃那档找，找不到就照打求效率；精明=折中，最多跳3档
// 牌墙剩余量的紧迫感：越接近荒牌墙，大家都更求稳（多跳几档也要找安全牌）
function wallUrgencyBonus(style, wcConfOverride) {
    const remaining = deck.length - DEAD_WALL;
    const learn = aiLearn.confidence[style] || {};
    const wcConf = wcConfOverride !== undefined ? wcConfOverride : (learn.wallCaution || 0);
    const wcDelta = wcConf >= 1.5 ? 2 : (wcConf <= -1.5 ? -2 : 0); // 学习部分：在静态阈值上再多/少2张
    const at = Math.max(2, (AI_TRAITS[style] || AI_TRAITS.shrewd).wallCautionAt + wcDelta);
    if (remaining <= Math.round(at / 2)) return 3;
    if (remaining <= at) return 1;
    return 0;
}

// 给定手牌+副露，若已是听牌形态，返回可胡的牌列表，否则 []
// 听牌缓存：结果只取决于 暗牌 + 副露(含类型/是否暗杠) + 该玩家的亮牌加成，按这三样做键。
// render 每次都要给四家算听牌提示、给手牌算危险标记，命中缓存后不再重复扫 34 种牌
const _winTilesCache = new Map();
function getWinningTilesOf(concealed, exposed, player) {
    const neededLen = (4 - exposed.length) * 3 + 2;
    if (concealed.length !== neededLen - 1) return [];
    const key = (player || '') + (player && windDragonBonus[player] ? '+' : '-') + '|'
        + concealed.slice().sort().join(',') + '|'
        + exposed.map(m => m.type + (m.concealed ? 'c' : '') + m.tiles.join('')).join(';');
    let res = _winTilesCache.get(key);
    if (res === undefined) {
        res = allTileTypes().filter(t => checkHu([...concealed, t], exposed, player));
        if (_winTilesCache.size > 3000) _winTilesCache.clear();
        _winTilesCache.set(key, res);
    }
    return res.slice(); // 返回副本，调用方随便改也不会污染缓存
}

// 进张数：打出这张后，还有多少种（未死绝的）牌摸到能让向听数继续下降
// 用于同保留档位打平时的 tie-break，取代纯随机，让AI优先留住选择面更宽的牌
function ukeireCount(hand, exposed) {
    const shan = estimateShantenCached(hand, exposed);
    let count = 0;
    for (const t of allTileTypes()) {
        if (isTileDead(t, hand)) continue; // 已经死绝的牌（含自己手里的）摸不到，没有实际意义
        if (estimateShantenCached([...hand, t], exposed) < shan) count++;
    }
    return count;
}

// ========== 弃牌决策主流程：8 个阶段依次收窄候选 ==========
// Phase 1 保听 → Phase 2 候选排序 → Phase 3 求稳过滤 → Phase 4 炮牌截留/不喂下家
// → Phase 5 tier 收窄+兜底 → Phase 6 打平（进张数/2步期望）→ Phase 7 攻击危险规避 → Phase 8 归因
// （2026-09-30 骨架重组：原 200 行单体函数按阶段抽取，逻辑逐字搬运，零行为变化）
function chooseAiDiscardTile(hand, player) {
    const exposed = exposedMelds[player];
    const style = aiPersonality[player] || 'shrewd';
    // Phase 1 保听：已上听/摸牌后仍可保听时，优先打出后仍听的牌
    const tenpaiTile = findKeepTenpaiTile(hand, exposed, player);
    if (tenpaiTile) return tenpaiTile;
    // 已无法保听（或尚未上听）→ 清空听口记忆；按「向听优先 + 安全 + 保留档」舍牌
    aiWaitTiles[player] = [];
    // Phase 2 候选：逐张试打，按向听/穷胡条件/安全/保留档排序，取最佳向听邻近档
    const built = buildDiscardCandidates(hand, exposed, player, style);
    // Phase 3 求稳过滤：残局/防守学习/未开门/对手听牌信号 → 只留安全牌（含学习归因）
    const safePool = applySafetyFilter(built.pool, player, style);
    // Phase 4 炮牌截留 / 不喂下家：退让几档 tier 换安全牌
    const heldPool = applyBlockXiajia(applyCannonHold(safePool, player, style), player, style);
    // Phase 5 tier 收窄：只留最该丢的那一档；全是炮牌时按"能胡家数"兜底
    const narrowed = fallbackByDangerCount(narrowToBestTier(heldPool), player);
    // Phase 6 打平：进张数 → 2 步期望
    const finalPool = breakTiesByTwoStep(breakTiesByUkeire(narrowed, hand, exposed), hand, exposed);
    let chosenTile = finalPool[Math.floor(Math.random() * finalPool.length)].tile;
    // Phase 7 攻击时危险规避（AI 4.0 提强2）；Phase 8 字牌保留归因（轴5）
    chosenTile = avoidDangerWhenAttacking(chosenTile, heldPool, built.bestShan, player, style);
    attributeHonorHold(chosenTile, hand, player, style);
    return chosenTile;
}

// Phase 1 保听：打出后仍听的牌里，优先不点炮、尽量不换听口、听张数多的；没有返回 null
function findKeepTenpaiTile(hand, exposed, player) {
    const keepTenpai = []; // { tile, wins, overlap, waitCount, safe }
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
    if (!keepTenpai.length) return null;
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

// Phase 2 候选：逐张试打算向听/保留档/安全/穷胡条件，按"向听→穷胡惩罚→安全→保留档"排序；
// 返回最佳向听邻近档（性格+牌值决定 slack 多宽）
function buildDiscardCandidates(hand, exposed, player, style) {
    const candidates = [];
    for (const t of hand) {
        const remain = removeTilesFromHand(hand, [t]);
        const shan = estimateShantenCached(remain, exposed);
        const tier = tileKeepTier(hand, t, style);
        const safe = !isTileDangerousFor(player, t);
        const feedsNext = feedsXiajia(player, t); // 轴7a：这张牌会不会喂下家吃/碰
        // 穷胡专属条件：打出这张后，三门齐/幺九/刻子还保不保得住（标准向听算法看不到这三条，靠这里补）
        const qh = analyzeHu(remain, exposed, player);
        let qhPenalty = 0;
        if (!qh.sanmenqi) qhPenalty += 2;
        if (!qh.yaojiu) qhPenalty += 2;
        if (!qh.kezi) qhPenalty += 1;
        candidates.push({ tile: t, shan, tier, safe, feedsNext, qhPenalty });
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
    let shanSlack = style === 'conservative' ? 1 : (style === 'aggressive' ? 0 : 1);
    // 轴：速度 vs 牌值——保守永远只看上面这套、不受牌值影响；激进平时求快，但牌值真的大了愿意多等一巡；
    // 精明本来就想要大牌，牌值越高越愿意等（跟激进那条一样封顶多等1巡，别真等成流局）
    const handValue = estimateHandValue(hand, exposed);
    if (style === 'aggressive' && handValue >= 2) shanSlack += 1;
    if (style === 'shrewd' && handValue >= 1.5) shanSlack += 1;
    const pool = candidates.filter(c => c.shan <= bestShan + shanSlack);
    return { pool, bestShan };
}

// Phase 3 求稳过滤：残局紧迫 / 防守学习值低 / 未开门 / 对手有听牌信号，任一成立就只留安全牌；
// 并做学习归因（各轴单独归零，看开关会不会翻——翻了说明这条轴决定了这次选择）
function applySafetyFilter(pool, player, style) {
    const learn = aiLearn.confidence[style] || {};
    const urgency = wallUrgencyBonus(style);
    // 轴2(防守让牌)的学习值
    const defenseConf = learn.defense || 0;
    // 轴7b/7c 位置感：读一眼对家/上家是什么性格，微调自己求稳的门槛
    // 对家凶（激进）→ 收紧（更容易触发cautious）；上家稳（保守）→ 松一点（威胁小，不用太紧张）
    let posSlack = 0;
    if (aiPersonality[acrossPlayerOf(player)] === 'aggressive') posSlack -= 1;
    if (aiPersonality[prevPlayerOf(player)] === 'conservative') posSlack += 1;
    const cautious = defenseConf <= -1.5 - posSlack;
    const confident = defenseConf >= 1.5;
    // 没开门点炮×2：自己还没开门时点炮要多付一倍，安全牌优先级必须更硬，
    // 不受性格/战绩自信影响——哪怕是激进/战绩好的AI，没开门也不能对危险牌掉以轻心
    const notOpen = !isKaimen(exposedMelds[player]);
    // 轴2扩展：对手有没有"看起来要听牌"的信号（副露数/连续切中张），门槛按性格+学习值调
    // （战绩差的更神经质、更容易转防守；战绩好的更迟钝一点）
    const riskAt = Math.max(0.3, (AI_TRAITS[style] || AI_TRAITS.shrewd).riskDefenseAt - Math.round(defenseConf) * 0.15);
    // AI 4.0 提强2：读人系统化——用听牌概率(0~1)做"对手已听"判断，跟原来的启发式风险分互补。
    // 有人听牌概率过半(≥0.55)，直接视为高风险（竞速折扣：对手很可能已听，就不该再按"没人听"打）。
    let oppTenpaiMax = 0;
    try {
        for (const p of turnOrder) {
            if (p === player) continue;
            oppTenpaiMax = Math.max(oppTenpaiMax, estimateOppTenpai(p));
        }
    } catch (e) {}
    const highRiskNow = turnOrder.some(p => p !== player && estimateTenpaiRisk(p) >= riskAt)
        || oppTenpaiMax >= 0.55;
    const safeFilterActive = (u, c, cf, hr) => (u >= 1 || c || notOpen || hr) || (style !== 'aggressive' && !cf);
    const actualFilterOn = safeFilterActive(urgency, cautious, confident, highRiskNow);
    const safePoolNow = pool.filter(c => c.safe);
    // 只有"求稳"开关真能改变候选范围时，归因才有意义
    const filterWouldNarrow = safePoolNow.length > 0 && safePoolNow.length < pool.length;
    let out = pool;
    if (actualFilterOn && filterWouldNarrow) out = safePoolNow;
    if (filterWouldNarrow) {
        // 归因：各轴单独归零，看开关会不会翻——翻了说明这条轴能决定这一把的选择
        if (safeFilterActive(urgency, 0 <= -1.5 - posSlack, false, highRiskNow) !== actualFilterOn) {
            markAxisUsed(player, 'defense');
        }
        if (safeFilterActive(wallUrgencyBonus(style, 0), cautious, confident, highRiskNow) !== actualFilterOn) {
            markAxisUsed(player, 'wallCaution');
        }
        if (safeFilterActive(urgency, defenseConf <= -1.5, confident, highRiskNow) !== actualFilterOn) {
            markAxisUsed(player, 'position');
        }
        if (safeFilterActive(urgency, cautious, confident, false) !== actualFilterOn) {
            markAxisUsed(player, 'defense'); // 对手风险信号算在防守这条轴上
        }
    }
    return out;
}

// Phase 4a 炮牌截留（轴6）：最优 tier 里没有安全牌时，按性格+学习退让几档 tier 换安全牌
// （cannonHoldTier=0 时跟以前行为一样，直接返回原池）
function applyCannonHold(pool, player, style) {
    const learn = aiLearn.confidence[style] || {};
    const cannonHoldTier = Math.max(0, (AI_TRAITS[style] || AI_TRAITS.shrewd).cannonHoldTier
        + (learn.cannonHold >= 1.5 ? 1 : (learn.cannonHold <= -1.5 ? -1 : 0)));
    if (cannonHoldTier <= 0) return pool;
    const curBestTier = Math.min(...pool.map(c => c.tier));
    const bestTierHasSafe = pool.some(c => c.tier === curBestTier && c.safe);
    if (!bestTierHasSafe) {
        const widened = pool.filter(c => c.tier <= curBestTier + cannonHoldTier && c.safe);
        if (widened.length) { markAxisUsed(player, 'cannonHold'); return widened; }
    }
    return pool;
}

// Phase 4b 不喂下家（轴7a）：最优 tier 全是会喂下家的牌时，退让几档 tier 躲开
function applyBlockXiajia(pool, player, style) {
    const learn = aiLearn.confidence[style] || {};
    const blockXiajiaTier = Math.max(0, (AI_TRAITS[style] || AI_TRAITS.shrewd).blockXiajiaTier
        + (learn.position >= 1.5 ? 1 : (learn.position <= -1.5 ? -1 : 0)));
    if (blockXiajiaTier <= 0) return pool;
    const curBestTier = Math.min(...pool.map(c => c.tier));
    const bestTierFeedsNext = pool.filter(c => c.tier === curBestTier).every(c => c.feedsNext);
    if (bestTierFeedsNext) {
        const widened = pool.filter(c => c.tier <= curBestTier + blockXiajiaTier && !c.feedsNext);
        if (widened.length) { markAxisUsed(player, 'position'); return widened; }
    }
    return pool;
}

// Phase 5a tier 收窄：在池内按保留档升序（先丢不保的），只留最该丢的那一档
function narrowToBestTier(pool) {
    const sorted = pool.slice().sort((a, b) => a.tier - b.tier || (a.safe === b.safe ? 0 : (a.safe ? -1 : 1)));
    const topTier = sorted[0].tier;
    return sorted.filter(c => c.tier === topTier);
}

// Phase 5b 兜底：候选（当前 tier 里）一张安全牌都没有——"矮子里挑将军"，全是炮牌——
// 这时候不比 tier 了，直接按"能胡的家数"挑最少的那几张
function fallbackByDangerCount(finalPool, player) {
    if (finalPool.length > 1 && !finalPool.some(c => c.safe)) {
        const ranked = finalPool.map(c => ({ ...c, danger: dangerCount(player, c.tile) }))
            .sort((a, b) => a.danger - b.danger);
        const minDanger = ranked[0].danger;
        return ranked.filter(c => c.danger === minDanger);
    }
    return finalPool;
}

// Phase 6a 同档打平：用进张数排序（谁打出去后选择面更宽就先打谁），取代纯随机
function breakTiesByUkeire(finalPool, hand, exposed) {
    if (finalPool.length <= 1) return finalPool;
    const ranked = finalPool.map(c => ({
        ...c,
        ukeire: ukeireCount(removeTilesFromHand(hand, [c.tile]), exposed)
    })).sort((a, b) => b.ukeire - a.ukeire);
    const bestUkeire = ranked[0].ukeire;
    return ranked.filter(c => c.ukeire === bestUkeire);
}

// Phase 6b AI 4.0 提强1：2 步期望——ukeire 打平后，对前 5 名看"打出→摸进张→向听期望"，
// 选"摸到后更舒服"的（差距>0.15 才分胜负，否则保持并列随机，避免过度拟合）
function breakTiesByTwoStep(finalPool, hand, exposed) {
    if (finalPool.length <= 1) return finalPool;
    const tsN = Math.min(5, finalPool.length);
    for (let i = 0; i < tsN; i++) {
        try { finalPool[i].twoStep = twoStepExp(hand, exposed, finalPool[i].tile); }
        catch (e) { finalPool[i].twoStep = finalPool[i].shan; }
    }
    for (let i = tsN; i < finalPool.length; i++) finalPool[i].twoStep = finalPool[i].shan;
    finalPool.sort((a, b) => a.twoStep - b.twoStep);
    const bestTs = finalPool[0].twoStep;
    if (finalPool.some(c => c.twoStep - bestTs > 0.15)) {
        return finalPool.filter(c => c.twoStep - bestTs <= 0.15);
    }
    return finalPool;
}

// Phase 7 AI 4.0 提强2：攻击时也不往枪口撞。即使不在求稳模式，若首选是炮牌（有人能胡）
// 且危险度超过性格阈值，而池里有向听不差太多（≤最优+1）的安全牌，换打安全的。
// 性格差异：保守更早换（阈值0），激进更头铁（阈值2），精明折中（阈值1）。
function avoidDangerWhenAttacking(chosenTile, heldPool, bestShan, player, style) {
    try {
        const chosenDanger = dangerCount(player, chosenTile);
        const dangerThresh = style === 'conservative' ? 0 : (style === 'aggressive' ? 2 : 1);
        if (chosenDanger > dangerThresh) {
            const safer = heldPool.filter(c => c.safe && c.shan <= bestShan + 1)
                .sort((a, b) => a.shan - b.shan || a.tier - b.tier)[0];
            if (safer) {
                markAxisUsed(player, 'defense');
                return safer.tile;
            }
        }
    } catch (e) {}
    return chosenTile;
}

// Phase 8 轴5归因（事后判定）：如果最终选中的这张恰好是一张"因为性格+学习倾向而被抬过 tier"的孤立字牌，
// 且没有这条倾向时 tier 会不一样，就算这条轴真的影响了这次的选择
function attributeHonorHold(chosenTile, hand, player, style) {
    if (tileSuit(chosenTile) === '字' && hand.filter(x => x === chosenTile).length === 1) {
        const withBias = tileKeepTier(hand, chosenTile, style, false);
        const withoutBias = tileKeepTier(hand, chosenTile, style, true);
        if (withBias !== withoutBias) markAxisUsed(player, 'honorHold');
    }
}
