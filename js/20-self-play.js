// ========== 20-self-play：四 AI 自对弈训练（仅开发/训练用，默认不加载） ==========
// 用法（浏览器打开游戏后，控制台执行）：
//   1) 先加载本文件，或把内容粘贴进控制台
//   2) runSelfPlay(1000)          // 打 1000 局并写入 aiLearn
//   3) runSelfPlay(200, {fast:true, logEvery:50})
//
// 说明：
// - 会把 bottom（原人类）也当成 AI，自动出牌/胡；对别家打出的牌一律「过」（不吃不碰不杠明牌，
//   自己回合仍可能暗杠/加杠，由 aiDiscard 决定）。bottom 因此几乎不开门、胜率会明显偏低，
//   训练样本主要来自 top / left / right 三家
// - 尽量跳过渲染与音效，用 0ms 延时推进（仍尊重 gameEpoch 与骰子仪式）
// - 筹码输光弹出的破产窗自动选「继续当前场」
// - 训练会改动当前对局与 localStorage 里的 AI 学习数据（qionghu_mahjong_ai_learn_v1），
//   建议在单独的浏览器配置/无痕窗口里跑，或训练前先备份该键
//
// 2026-10-19 修复：
// - 旧版调用了不存在的 confirmHu / confirmNextHand，且每个 tick 都重复调用 aiDiscard('bottom')，
//   会把手牌连续打光（手牌张数异常）并卡死；现在每个回合只出一次牌，并避开杠后补牌自带的出牌排程
// - 下一局改走 startGame()（含破产窗拦截），局数用自己的计数器，不再靠 aiLearn.games 差值

(function () {
    'use strict';

    if (typeof window === 'undefined') return;

    const SelfPlay = {
        running: false,
        targetGames: 0,
        done: 0,
        wins: { top: 0, left: 0, right: 0, bottom: 0, draw: 0 },
        opts: {},
        bottomPending: false,   // 杠后补牌流程已自行排了 bottom 的出牌，harness 不要再插手
        _lastKey: '',
        _handEndArmed: false,
        _orig: {},              // 被替换的全局函数
        _timer: null
    };

    function log() {
        try { console.log.apply(console, ['[SelfPlay]'].concat([].slice.call(arguments))); } catch (e) {}
    }

    function patch(name, fn) {
        if (typeof window[name] === 'function' && !(name in SelfPlay._orig)) {
            SelfPlay._orig[name] = window[name];
            window[name] = fn(SelfPlay._orig[name]);
        }
    }

    function patchFast() {
        // gameTimeout 改成几乎立即执行；仍尊重 gameEpoch，骰子仪式期间继续顺延
        patch('gameTimeout', function () {
            return function (fn) {
                const epoch = gameEpoch;
                const run = function () {
                    if (epoch !== gameEpoch) return;
                    if (typeof diceBusy !== 'undefined' && diceBusy) { setTimeout(run, 20); return; }
                    try { fn(); } catch (e) { console.warn('[SelfPlay] timer error', e); }
                };
                return setTimeout(run, SelfPlay.opts.fast ? 0 : 8);
            };
        });
        // 训练时跳过重渲染，只刷新墙数文字
        patch('render', function () {
            return function () {
                try {
                    const el = document.getElementById('wall-count-text');
                    if (el && typeof deck !== 'undefined') {
                        el.innerText = '训练中 ' + SelfPlay.done + '/' + SelfPlay.targetGames + ' | 墙' + deck.length;
                    }
                } catch (e) {}
            };
        });
        patch('speak', function () { return function () {}; });
        ['sfxDraw', 'sfxDiscard', 'sfxChi', 'sfxPeng', 'sfxGang', 'sfxWin'].forEach(function (n) {
            patch(n, function () { return function () {}; });
        });
        // 记录「流程已替 bottom 排了出牌」：杠后补牌会自己 gameTimeout(aiDiscard)
        patch('aiDrawReplacement', function (orig) {
            return function (p) {
                if (p === 'bottom') SelfPlay.bottomPending = true;
                return orig.apply(this, arguments);
            };
        });
        patch('aiDiscard', function (orig) {
            return function (p) {
                if (p === 'bottom') SelfPlay.bottomPending = false;
                return orig.apply(this, arguments);
            };
        });
    }

    function unpatch() {
        Object.keys(SelfPlay._orig).forEach(function (n) { window[n] = SelfPlay._orig[n]; });
        SelfPlay._orig = {};
        SelfPlay.bottomPending = false;
    }

    function ensureBottomIsAi() {
        if (typeof aiPersonality === 'object' && aiPersonality && !aiPersonality.bottom) {
            aiPersonality.bottom = 'shrewd';
        }
    }

    function isShown(id) {
        const m = document.getElementById(id);
        return !!(m && m.classList.contains('show'));
    }

    // 处理 bottom 侧所有需要「人」点的东西；返回 true 表示本 tick 已处理，不再往下走
    function autoResolveUi() {
        // 破产窗：继续当前场
        if (isShown('bust-modal') && typeof cancelBustRestart === 'function') {
            cancelBustRestart();
            return true;
        }
        if (typeof diceBusy !== 'undefined' && diceBusy) return true; // 骰子仪式中，等它结束
        if (gameOver) return false;
        // 亮牌：不亮
        if (typeof pendingReveal !== 'undefined' && pendingReveal && typeof confirmReveal === 'function') {
            confirmReveal(false);
            return true;
        }
        // 吃法选择窗残留：关闭 = 过
        if (isShown('chi-choice-modal') && typeof closeChiChoice === 'function') {
            closeChiChoice();
            return true;
        }
        // 别家打牌的吃碰杠 / 自己的可选杠提示：一律点过（暗杠/加杠由 aiDiscard 自己判断）
        if (pendingClaim && pendingClaim.mode !== 'diceMenu') {
            declineClaim();
            return true;
        }
        return false;
    }

    function autoPlayBottomIfNeeded() {
        if (gameOver || pendingClaim || SelfPlay.bottomPending) return;
        if (turnOrder[currentIndex] !== 'bottom') return;
        if (!hands.bottom || hands.bottom.length % 3 !== 2) return; // 必须是「待出牌」张数
        // 同一状态只出一次牌；状态变了（摸牌/弃牌数变了）才算新回合
        const key = [handTurnCount, deck.length, discardPile.length, hands.bottom.length,
            exposedMelds.bottom.length].join('|');
        if (key === SelfPlay._lastKey) return;
        SelfPlay._lastKey = key;
        try { aiDiscard('bottom'); } catch (e) { console.warn('[SelfPlay] bottom auto error', e); }
    }

    function startNextHand() {
        SelfPlay._lastKey = '';
        SelfPlay.bottomPending = false;
        try {
            const r = document.getElementById('result-modal');
            if (r) r.classList.remove('show');
        } catch (e) {}
        // startGame：换庄 + initGame + 立即落盘；若有人筹码<0，会被 bust 窗拦下，由 autoResolveUi 处理
        if (typeof startGame === 'function') startGame();
        else if (typeof initGame === 'function') {
            if (typeof rotateDealer === 'function') rotateDealer();
            initGame();
        }
    }

    function onHandFinished() {
        SelfPlay.done++;
        if (winner) SelfPlay.wins[winner] = (SelfPlay.wins[winner] || 0) + 1;
        else SelfPlay.wins.draw++;

        if (SelfPlay.opts.logEvery && SelfPlay.done % SelfPlay.opts.logEvery === 0) {
            log('progress', SelfPlay.done + '/' + SelfPlay.targetGames, 'wins', JSON.parse(JSON.stringify(SelfPlay.wins)));
        }

        if (SelfPlay.done >= SelfPlay.targetGames) {
            const w = JSON.parse(JSON.stringify(SelfPlay.wins));
            stopSelfPlay();
            log('完成', SelfPlay.targetGames, '局。wins=', w);
            log('aiLearn.games=', aiLearn && aiLearn.games, 'confidence=', aiLearn && aiLearn.confidence);
            return;
        }
        try { startNextHand(); } catch (e) {
            console.warn('[SelfPlay] next hand error', e);
            stopSelfPlay();
        }
    }

    function tick() {
        if (!SelfPlay.running) return;
        try {
            if (!autoResolveUi()) {
                if (gameOver) {
                    // 一局结束：稍等结算/学习写完，再记一局并开下一局（每局只触发一次）
                    if (!SelfPlay._handEndArmed) {
                        SelfPlay._handEndArmed = true;
                        setTimeout(function () {
                            SelfPlay._handEndArmed = false;
                            if (SelfPlay.running) onHandFinished();
                        }, SelfPlay.opts.fast ? 20 : 80);
                    }
                } else {
                    autoPlayBottomIfNeeded();
                }
            }
        } catch (e) {
            console.warn('[SelfPlay] tick error', e);
        }
        SelfPlay._timer = setTimeout(tick, SelfPlay.opts.fast ? 4 : 16);
    }

    /**
     * 运行自对弈
     * @param {number} n 目标局数，默认 1000
     * @param {object} [opt]
     * @param {boolean} [opt.fast=true] 极速模式
     * @param {number} [opt.logEvery=100] 每多少局打一次日志
     */
    function runSelfPlay(n, opt) {
        if (SelfPlay.running) {
            log('已在运行，先 stopSelfPlay()');
            return;
        }
        SelfPlay.opts = Object.assign({ fast: true, logEvery: 100 }, opt || {});
        SelfPlay.targetGames = Math.max(1, n || 1000);
        SelfPlay.done = 0;
        SelfPlay.wins = { top: 0, left: 0, right: 0, bottom: 0, draw: 0 };
        SelfPlay._lastKey = '';
        SelfPlay._handEndArmed = false;
        SelfPlay.running = true;
        ensureBottomIsAi();
        patchFast();
        log('开始自对弈', SelfPlay.targetGames, '局；当前 aiLearn.games=', aiLearn && aiLearn.games);

        // 当前没有进行中的局就开一局；已结束的局由 tick 记一局后再开下一局
        try {
            if (!hands || !hands.bottom || (hands.bottom.length === 0 && !gameOver)) startNextHand();
        } catch (e) {}

        tick();
    }

    function stopSelfPlay() {
        SelfPlay.running = false;
        if (SelfPlay._timer) clearTimeout(SelfPlay._timer);
        SelfPlay._timer = null;
        unpatch();
        log('已停止。本轮完成', SelfPlay.done, '局；wins=', SelfPlay.wins);
        try { if (typeof saveAiLearn === 'function') saveAiLearn(); } catch (e) {}
        try { if (typeof render === 'function') render(); } catch (e) {}
    }

    window.runSelfPlay = runSelfPlay;
    window.stopSelfPlay = stopSelfPlay;
    window.SelfPlay = SelfPlay;
    log('已加载。控制台执行 runSelfPlay(1000) 开始训练，stopSelfPlay() 停止。');
})();
