// ========== 20-self-play：四 AI 自对弈训练（仅开发/训练用，默认不加载） ==========
// 用法（浏览器打开游戏后，控制台执行）：
//   1) 先加载本文件，或把内容粘贴进控制台
//   2) runSelfPlay(1000)          // 打 1000 局并写入 aiLearn
//   3) runSelfPlay(200, {fast:true, logEvery:50})
//
// 说明：
// - 会把 bottom（原人类）也当成 AI（默认 shrewd），自动出牌/吃碰/胡
// - 尽量跳过渲染与音效，用短延时推进
// - 训练结束后可 localStorage 查看 qionghu_mahjong_ai_learn_v1
// - 不影响已有真实对局存档键；建议训练前可手动备份 aiLearn

(function () {
    'use strict';

    if (typeof window === 'undefined') return;

    const SelfPlay = {
        running: false,
        targetGames: 0,
        startGames: 0,
        done: 0,
        wins: { top: 0, left: 0, right: 0, bottom: 0, draw: 0 },
        opts: {},
        _origGameTimeout: null,
        _origRender: null,
        _origSpeak: null,
        _origSfx: {},
        _timer: null
    };

    function log() {
        try { console.log.apply(console, ['[SelfPlay]'].concat([].slice.call(arguments))); } catch (e) {}
    }

    function patchFast() {
        // 把 gameTimeout 改成几乎立即执行，仍尊重 gameEpoch
        if (!SelfPlay._origGameTimeout && typeof gameTimeout === 'function') {
            SelfPlay._origGameTimeout = gameTimeout;
            window.gameTimeout = function (fn, ms) {
                const epoch = gameEpoch;
                const delay = SelfPlay.opts.fast ? 0 : Math.min(ms || 0, 8);
                return setTimeout(function () {
                    if (epoch !== gameEpoch) return;
                    try { fn(); } catch (e) { console.warn('[SelfPlay] timer error', e); }
                }, delay);
            };
        }
        if (!SelfPlay._origRender && typeof render === 'function') {
            SelfPlay._origRender = render;
            window.render = function () {
                // 训练时跳过重渲染，只在必要时刷新墙数等轻量信息
                try {
                    if ($('wall-count-text') && typeof deck !== 'undefined') {
                        $('wall-count-text').innerText = '训练中 ' + SelfPlay.done + '/' + SelfPlay.targetGames
                            + ' | 墙' + deck.length;
                    }
                } catch (e) {}
            };
        }
        if (!SelfPlay._origSpeak && typeof speak === 'function') {
            SelfPlay._origSpeak = speak;
            window.speak = function () {};
        }
        ['sfxDraw', 'sfxDiscard', 'sfxChi', 'sfxPeng', 'sfxGang', 'sfxWin'].forEach(function (n) {
            if (typeof window[n] === 'function' && !SelfPlay._origSfx[n]) {
                SelfPlay._origSfx[n] = window[n];
                window[n] = function () {};
            }
        });
    }

    function unpatch() {
        if (SelfPlay._origGameTimeout) {
            window.gameTimeout = SelfPlay._origGameTimeout;
            SelfPlay._origGameTimeout = null;
        }
        if (SelfPlay._origRender) {
            window.render = SelfPlay._origRender;
            SelfPlay._origRender = null;
        }
        if (SelfPlay._origSpeak) {
            window.speak = SelfPlay._origSpeak;
            SelfPlay._origSpeak = null;
        }
        Object.keys(SelfPlay._origSfx).forEach(function (n) {
            window[n] = SelfPlay._origSfx[n];
        });
        SelfPlay._origSfx = {};
    }

    function ensureBottomIsAi() {
        if (typeof aiPersonality === 'object') {
            if (!aiPersonality.bottom) aiPersonality.bottom = 'shrewd';
        }
    }

    // 自动处理人类侧弹窗：亮牌 / 胡 / 吃选择等
    function autoResolveUi() {
        try {
            // 亮牌：默认不亮，避免打乱牌型（穷胡亮牌是可选）
            if (typeof pendingReveal !== 'undefined' && pendingReveal && typeof confirmReveal === 'function') {
                confirmReveal(false);
                return true;
            }
            // 胡牌确认
            if (typeof pendingHu !== 'undefined' && pendingHu && typeof confirmHu === 'function') {
                confirmHu(true);
                return true;
            }
            // 吃碰杠确认条：优先胡 > 杠 > 碰 > 吃
            const claim = document.getElementById('claim-indicator');
            if (claim && claim.children && claim.children.length) {
                const btns = claim.querySelectorAll('button, .claim-btn');
                let pick = null;
                btns.forEach(function (b) {
                    const t = (b.textContent || '') + (b.getAttribute('aria-label') || '');
                    if (/胡/.test(t)) pick = b;
                    else if (!pick && /杠/.test(t)) pick = b;
                    else if (!pick && /碰/.test(t)) pick = b;
                    else if (!pick && /吃/.test(t)) pick = b;
                });
                if (pick) { pick.click(); return true; }
            }
            // 吃法选择：点第一组
            const chiOpt = document.querySelector('#chi-choice-options button, #chi-choice-options .tile-wrap, #chi-choice-options [data-combo]');
            if (chiOpt) { chiOpt.click(); return true; }
            // 结算确认
            const result = document.getElementById('result-modal');
            if (result && result.style && result.style.display !== 'none' && result.offsetParent !== null) {
                const ok = result.querySelector('.btn-primary, button');
                if (ok) { ok.click(); return true; }
            }
            // 破产窗：继续当前场
            const bust = document.getElementById('bust-modal');
            if (bust && bust.offsetParent !== null) {
                const cont = bust.querySelector('button');
                if (cont) { cont.click(); return true; }
            }
        } catch (e) {}
        return false;
    }

    function autoPlayBottomIfNeeded() {
        try {
            if (gameOver) return false;
            const player = turnOrder[currentIndex];
            if (player !== 'bottom') return false;
            // 若轮到 bottom 且无待确认，直接走 AI 弃牌逻辑
            if (pendingClaim) return false;
            if (typeof aiDiscard === 'function') {
                aiDiscard('bottom');
                return true;
            }
        } catch (e) {
            console.warn('[SelfPlay] bottom auto error', e);
        }
        return false;
    }

    function onHandFinished() {
        SelfPlay.done = (aiLearn && aiLearn.games ? aiLearn.games : 0) - SelfPlay.startGames;
        if (winner) SelfPlay.wins[winner] = (SelfPlay.wins[winner] || 0) + 1;
        else SelfPlay.wins.draw = (SelfPlay.wins.draw || 0) + 1;

        if (SelfPlay.opts.logEvery && SelfPlay.done % SelfPlay.opts.logEvery === 0) {
            log('progress', SelfPlay.done + '/' + SelfPlay.targetGames, 'wins', JSON.parse(JSON.stringify(SelfPlay.wins)));
        }

        if (SelfPlay.done >= SelfPlay.targetGames) {
            stopSelfPlay();
            log('完成', SelfPlay.targetGames, '局。wins=', SelfPlay.wins);
            log('aiLearn.games=', aiLearn && aiLearn.games, 'confidence=', aiLearn && aiLearn.confidence);
            try { if (typeof saveAiLearn === 'function') saveAiLearn(); } catch (e) {}
            try { if (SelfPlay._origRender) SelfPlay._origRender(); } catch (e) {}
            return;
        }

        // 开下一局
        try {
            if (typeof confirmNextHand === 'function') confirmNextHand();
            else if (typeof initGame === 'function') {
                if (typeof rotateDealer === 'function') rotateDealer();
                initGame();
            }
        } catch (e) {
            console.warn('[SelfPlay] next hand error', e);
            stopSelfPlay();
        }
    }

    function tick() {
        if (!SelfPlay.running) return;
        try {
            autoResolveUi();
            autoPlayBottomIfNeeded();

            // 检测一局结束：gameOver 且已结算
            if (gameOver) {
                // 给结算/学习一点时间
                if (!SelfPlay._endArmed) {
                    SelfPlay._endArmed = true;
                    setTimeout(function () {
                        SelfPlay._endArmed = false;
                        if (!SelfPlay.running) return;
                        onHandFinished();
                    }, SelfPlay.opts.fast ? 20 : 80);
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
        SelfPlay.startGames = (aiLearn && aiLearn.games) || 0;
        SelfPlay.done = 0;
        SelfPlay.wins = { top: 0, left: 0, right: 0, bottom: 0, draw: 0 };
        SelfPlay.running = true;
        ensureBottomIsAi();
        patchFast();
        log('开始自对弈', SelfPlay.targetGames, '局；当前 aiLearn.games=', SelfPlay.startGames);

        // 若当前无局，直接开一局
        try {
            if (typeof initGame === 'function' && (!hands || !hands.bottom || hands.bottom.length === 0)) {
                initGame();
            } else if (gameOver && typeof confirmNextHand === 'function') {
                confirmNextHand();
            } else if (gameOver && typeof initGame === 'function') {
                initGame();
            }
        } catch (e) {}

        tick();
    }

    function stopSelfPlay() {
        SelfPlay.running = false;
        if (SelfPlay._timer) clearTimeout(SelfPlay._timer);
        SelfPlay._timer = null;
        unpatch();
        log('已停止。本轮完成约', SelfPlay.done, '局；wins=', SelfPlay.wins);
        try { if (typeof saveAiLearn === 'function') saveAiLearn(); } catch (e) {}
        try { if (typeof render === 'function') render(); } catch (e) {}
    }

    window.runSelfPlay = runSelfPlay;
    window.stopSelfPlay = stopSelfPlay;
    window.SelfPlay = SelfPlay;
    log('已加载。控制台执行 runSelfPlay(1000) 开始训练，stopSelfPlay() 停止。');
})();
