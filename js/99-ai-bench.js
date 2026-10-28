// ========== 99-ai-bench：AI 性能基准（仅开发调试用） ==========
// 自 10-ai-shanten-bench.js 抽出。不要加入 index HTML 的 script 列表，
// 需要时在控制台单独加载：页面加载后用 script 标签或复制粘贴执行。
// 调用 benchmarkMahjongAI() 在控制台看向听/胡牌判定/弃牌决策耗时。

// ========== 性能基准（控制台：benchmarkMahjongAI()）==========
/** 统计一组耗时样本：min/max/avg/median/p95/opsPerSec */
function _benchStats(samplesMs, totalMs, ops) {
    const a = samplesMs.slice().sort((x, y) => x - y);
    const n = a.length;
    const sum = a.reduce((s, v) => s + v, 0);
    const mid = n % 2 ? a[(n - 1) >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2;
    const p95 = a[Math.min(n - 1, Math.ceil(n * 0.95) - 1)];
    return {
        runs: n,
        totalMs: Math.round(totalMs * 1000) / 1000,
        minMs: Math.round(a[0] * 1000) / 1000,
        maxMs: Math.round(a[n - 1] * 1000) / 1000,
        avgMs: Math.round((sum / n) * 1000) / 1000,
        medianMs: Math.round(mid * 1000) / 1000,
        p95Ms: Math.round(p95 * 1000) / 1000,
        opsPerSec: totalMs > 0 ? Math.round((ops / totalMs) * 1000) : 0
    };
}

function _benchNow() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/** 固定测试牌型（覆盖完成形 / 听牌 / 一向听 / 散牌 / 带副露） */
function _benchHandFixtures() {
    return [
        {
            name: 'complete-14',
            concealed: ['1万','2万','3万','4万','5万','6万','7万','8万','9万','1条','1条','1条','2筒','2筒'],
            exposed: []
        },
        {
            name: 'tenpai-13',
            concealed: ['1万','2万','3万','4万','5万','6万','7万','8万','9万','1条','1条','1条','2筒'],
            exposed: []
        },
        {
            name: 'iishanten-like',
            concealed: ['1万','2万','3万','4万','5万','6万','7万','8万','9万','1条','1条','3条'],
            exposed: []
        },
        {
            name: 'messy-13',
            concealed: ['1万','3万','5万','7万','9万','1条','4条','7条','2筒','5筒','8筒','1字','5字'],
            exposed: []
        },
        {
            name: 'open-peng-11',
            concealed: ['1万','2万','3万','4万','5万','6万','7万','8万','9万','2筒','2筒'],
            exposed: [{ type: 'peng', tiles: ['1条', '1条', '1条'] }]
        }
    ];
}

/**
 * 运行性能基准。
 * @param {object} [opt]
 * @param {number} [opt.iterations=200] 每个用例重复次数
 * @param {boolean} [opt.includeAiDiscard=true] 是否测 AI 舍牌
 * @param {boolean} [opt.includeCheckHu=true] 是否测 checkHu
 * @param {boolean} [opt.log=true] 是否 console.table / logFlow
 * @returns {object} 详细报告
 */
function benchmarkMahjongAI(opt) {
    const iterations = (opt && opt.iterations) || 200;
    const includeAiDiscard = !opt || opt.includeAiDiscard !== false;
    const includeCheckHu = !opt || opt.includeCheckHu !== false;
    const doLog = !opt || opt.log !== false;
    const fixtures = _benchHandFixtures();
    const report = {
        meta: {
            iterations,
            ts: new Date().toISOString(),
            userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : 'node',
            note: '结构向听 DFS；不含渲染。opsPerSec 按单次函数调用计。'
        },
        shanten: {},
        checkHu: null,
        aiDiscard: null
    };

    // —— 1) estimateShanten / calcComplexShanten ——
    for (const fx of fixtures) {
        const samples = [];
        const t0 = _benchNow();
        let last = null;
        for (let i = 0; i < iterations; i++) {
            const s0 = _benchNow();
            last = estimateShanten(fx.concealed, fx.exposed);
            samples.push(_benchNow() - s0);
        }
        const total = _benchNow() - t0;
        report.shanten[fx.name] = {
            result: last,
            needMelds: 4 - fx.exposed.length,
            tileCount: fx.concealed.length,
            timing: _benchStats(samples, total, iterations)
        };
    }

    // —— 2) checkHu（听牌形补一张）——
    if (includeCheckHu) {
        const hand = ['1万','2万','3万','4万','5万','6万','7万','8万','9万','1条','1条','1条','2筒'];
        const winTile = '2筒';
        const samples = [];
        const t0 = _benchNow();
        let ok = false;
        for (let i = 0; i < iterations; i++) {
            const s0 = _benchNow();
            ok = checkHu([...hand, winTile], [], null);
            samples.push(_benchNow() - s0);
        }
        report.checkHu = {
            result: ok,
            timing: _benchStats(samples, _benchNow() - t0, iterations)
        };
    }

    // —— 3) chooseAiDiscardTile（需临时挂手牌环境）——
    if (includeAiDiscard && typeof chooseAiDiscardTile === 'function') {
        const savedHands = hands;
        const savedExposed = exposedMelds;
        const savedWait = aiWaitTiles;
        try {
            const discSamples = {};
            for (const fx of fixtures) {
                if (fx.concealed.length < 2) continue;
                hands = {
                    top: fx.concealed.slice(),
                    left: fx.concealed.slice(),
                    right: fx.concealed.slice(),
                    bottom: fx.concealed.slice()
                };
                exposedMelds = {
                    top: fx.exposed.slice(),
                    left: fx.exposed.slice(),
                    right: fx.exposed.slice(),
                    bottom: fx.exposed.slice()
                };
                aiWaitTiles = { top: [], left: [], right: [] };
                const samples = [];
                const t0 = _benchNow();
                let pick = null;
                const n = Math.min(iterations, 80); // 舍牌含多次向听，次数略降
                for (let i = 0; i < n; i++) {
                    const s0 = _benchNow();
                    pick = chooseAiDiscardTile(fx.concealed.slice(), 'top');
                    samples.push(_benchNow() - s0);
                }
                discSamples[fx.name] = {
                    picked: pick,
                    timing: _benchStats(samples, _benchNow() - t0, n)
                };
            }
            report.aiDiscard = discSamples;
        } finally {
            hands = savedHands;
            exposedMelds = savedExposed;
            aiWaitTiles = savedWait;
        }
    }

    if (doLog) {
        console.log('[Mahjong AI Benchmark]', report.meta);
        console.log('--- estimateShanten ---');
        const shanRows = Object.keys(report.shanten).map(k => {
            const r = report.shanten[k];
            return {
                case: k,
                result: r.result,
                tiles: r.tileCount,
                avgMs: r.timing.avgMs,
                medianMs: r.timing.medianMs,
                p95Ms: r.timing.p95Ms,
                opsPerSec: r.timing.opsPerSec
            };
        });
        console.table(shanRows);
        if (report.checkHu) {
            console.log('--- checkHu ---', report.checkHu);
        }
        if (report.aiDiscard) {
            console.log('--- chooseAiDiscardTile ---');
            const rows = Object.keys(report.aiDiscard).map(k => {
                const r = report.aiDiscard[k];
                return {
                    case: k,
                    picked: r.picked,
                    avgMs: r.timing.avgMs,
                    medianMs: r.timing.medianMs,
                    p95Ms: r.timing.p95Ms,
                    opsPerSec: r.timing.opsPerSec
                };
            });
            console.table(rows);
        }
        try {
            const avgShan = shanRows.reduce((s, r) => s + r.avgMs, 0) / (shanRows.length || 1);
            logFlow('基准：向听均 ' + avgShan.toFixed(3) + 'ms；控制台看 benchmarkMahjongAI 详情');
        } catch (e) { /* ignore */ }
    }
    return report;
}

// 暴露到全局，便于手机远程调试 / 桌面控制台
try { window.benchmarkMahjongAI = benchmarkMahjongAI; } catch (e) { /* non-browser */ }
