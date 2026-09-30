// ========== 10-ai-shanten：生产用向听算法 ==========
// 保牌用的保留等级 / 34 计数 / 向听计算（estimateShanten）。
// 性能基准（benchmarkMahjongAI）已抽到 99-ai-bench-3.js，仅开发调试用，不随页面加载。
// 2026-09-30 骨架重组：自 10-ai-shanten-bench.js 抽出基准段落，零行为变化。
// ---------- 保牌AI：给每张牌算一个“保留等级”，数值越小越优先被打出 ----------
// 0=孤立字牌 1=孤立中张(2,3,7,8) 2=孤立中张(4,5,6) 3=孤立幺九/嵌张
// 4=刻子(三者中最先舍) 5=连张/搭子/三门齐保护 6=对子(最优先保留)
function protectsThreeSuits(hand, tile) {
    const suit = tileSuit(tile);
    if (suit === '字') return false; // 字牌不影响三门齐
    const suitsPresent = new Set(hand.filter(t => tileSuit(t) !== '字').map(tileSuit));
    if (suitsPresent.size < 3) return false; // 已经不是三门齐了，没必要为了保它牺牲效率
    return hand.filter(t => tileSuit(t) === suit).length === 1; // 这门僅剩的一张，打了就断这门了
}

// ---------- 记牌：统计场面上能看到的牌，判断某个搭子还有没有指望 ----------
// 只数看得见的：弃牌堆 + 各家已经亮出的碰/吃/明杠/亮牌（暗杠盖着，不算"看得见"）
function tileSeenCount(tile) {
    let count = discardPile.filter(d => d.tile === tile).length;
    for (const p of turnOrder) {
        for (const m of exposedMelds[p]) {
            if (m.type === 'gang' && m.concealed) continue; // 暗杠看不见，不计入
            count += m.tiles.filter(t => t === tile).length;
        }
    }
    return count;
}

// ownHand（可选）：做决策的这位 AI 自己的暗牌——自己手里的牌当然看得见，也要算进"已知张数"。
// 不传则和原来一样，只数场面上的牌。
function isTileDead(tile, ownHand) {
    let seen = tileSeenCount(tile);
    if (ownHand) seen += ownHand.filter(t => t === tile).length;
    return seen >= 4; // 4张都已经在看得见的地方了，这张没指望了
}

// ---------- AI：精确结构向听（DFS 拆面子 + 剩余搭子评估） / 吃碰评估 ----------
/** 牌面 → 0..33：万0-8 条9-17 筒18-26 字27-33 */
function tileToIndex(t) {
    const s = tileSuit(t), r = tileRank(t);
    if (s === '万') return r - 1;
    if (s === '条') return 9 + r - 1;
    if (s === '筒') return 18 + r - 1;
    return 26 + r; // 1字..7字 → 27..33
}

function buildCount34(concealed) {
    const c = new Array(34).fill(0);
    for (const t of concealed) {
        const i = tileToIndex(t);
        if (i >= 0 && i < 34) c[i]++;
    }
    return c;
}

/** 在已去掉完整面子、并已取走将牌（或确定无将）的剩余里，贪心数搭子。
 *  搭子 = 连张(45) / 嵌张(46) / 对子(55，可碰)。 */
function countTaatsu34(cnt) {
    const c = cnt.slice();
    let taatsu = 0;
    // 数牌：连张优先，再嵌张，再对子；剩下的是孤张
    for (let base = 0; base < 27; base += 9) {
        for (let i = 0; i < 9; i++) {
            const p = base + i;
            while (c[p] > 0) {
                if (i <= 7 && c[p + 1] > 0) {
                    c[p]--; c[p + 1]--;
                    taatsu++;
                } else if (i <= 6 && c[p + 2] > 0) {
                    c[p]--; c[p + 2]--;
                    taatsu++;
                } else if (c[p] >= 2) {
                    c[p] -= 2; // 对子也是搭子（等碰）
                    taatsu++;
                } else {
                    c[p]--; // 孤张
                }
            }
        }
    }
    // 字牌没有顺子搭子，但对子同样是搭子
    for (let p = 27; p < 34; p++) {
        if (c[p] >= 2) taatsu++;
    }
    return taatsu;
}

/**
 * 已知已拆出 melds 个完整面子后，对剩余牌枚举将牌选择，计算向听。
 * 公式：还缺 m 个面子时，向听 ≈ 2m - (有将?1:0) - 可用搭子数（有上限）。
 */
function shantenFromRest(cnt, melds, needMelds) {
    let best = 20;
    const mNeed = Math.max(0, needMelds - melds);

    const evalWith = (pair, taatsu) => {
        // 搭子最多补 mNeed 个面子（面子+搭子的块数不能超过还缺的面子数）
        let t = taatsu;
        if (t > mNeed) t = mNeed;
        // 完成形：melds==needMelds 且 pair→ -1；听牌 → 0
        return 2 * mNeed - (pair ? 1 : 0) - t;
    };

    // 不加将
    best = Math.min(best, evalWith(0, countTaatsu34(cnt)));

    // 枚举一种将牌
    for (let i = 0; i < 34; i++) {
        if (cnt[i] >= 2) {
            cnt[i] -= 2;
            best = Math.min(best, evalWith(1, countTaatsu34(cnt)));
            cnt[i] += 2;
        }
    }
    return best;
}

/**
 * 复杂向听：对「拆出完整面子」的所有分支做 DFS，再评估剩余。
 * 只衡量一般形（面子+将），不含穷胡的开门/三门齐/幺九。
 * 返回：-1 已和（结构），0 听牌，1+ 向听数。
 */
function calcComplexShanten(concealed, needMelds) {
    if (needMelds < 0) return 8;
    if (needMelds === 0) {
        // 只剩将：0～1 张或一对
        if (concealed.length === 0) return 1;
        if (concealed.length === 1) return 0;
        if (concealed.length === 2 && concealed[0] === concealed[1]) return -1;
        return Math.max(0, concealed.length - 1);
    }
    const root = buildCount34(concealed);
    let minS = 20;

    function dfs(cnt, from, melds) {
        // 每个节点都可「停止拆面子」并评估
        const s = shantenFromRest(cnt, melds, needMelds);
        if (s < minS) minS = s;
        if (melds >= needMelds || minS < 0) return;

        for (let i = from; i < 34; i++) {
            if (cnt[i] === 0) continue;
            // 刻子
            if (cnt[i] >= 3) {
                cnt[i] -= 3;
                dfs(cnt, i, melds + 1);
                cnt[i] += 3;
            }
            // 顺子（仅数牌，且起点 rank<=7）
            if (i < 27 && (i % 9) <= 6 && cnt[i] > 0 && cnt[i + 1] > 0 && cnt[i + 2] > 0) {
                cnt[i]--; cnt[i + 1]--; cnt[i + 2]--;
                dfs(cnt, i, melds + 1);
                cnt[i]++; cnt[i + 1]++; cnt[i + 2]++;
            }
        }
    }

    dfs(root, 0, 0);
    if (minS > 8) minS = 8;
    return minS;
}

/**
 * AI 用向听入口：按副露数决定手牌还需几个面子。
 * -1 结构已和；0 结构听牌；正数越大越远。
 */
function estimateShanten(concealed, exposed) {
    const needMelds = 4 - (exposed ? exposed.length : 0);
    if (needMelds < 0) return 8;
    // 张数与目标差太大时先快速裁剪，避免无意义 DFS
    const n = concealed.length;
    const winLen = needMelds * 3 + 2;
    const tenpaiLen = needMelds * 3 + 1;
    if (n === 0) return needMelds * 2 + 1;
    if (n > winLen + 3) return Math.min(8, n - tenpaiLen);
    return calcComplexShanten(concealed, needMelds);
}
