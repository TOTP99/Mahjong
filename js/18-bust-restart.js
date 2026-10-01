/* js/18-bust-restart.js — 筹码输光：任何一家筹码 < 0 时，开下一局前弹确认（与新版 17-field-manager.js 同一规则）
 *
 * 规则：筹码刚好为 0 可以继续；只要有人 < 0 才触发。
 *   「重新开场」→ 四家筹码设为左栏「初始筹码」存过的值（没设过默认 50）→ 掷骰子重新调庄 → 开新场
 *   「继续当前场」→ 照常开下一局（带着负数筹码继续；之后每局结算后仍会再问）
 * 要改初始筹码：点横屏左栏「初始筹码」按钮（17-toolbar.js）。
 *
 * 严格等待：弹窗一出现，游戏就停在这里——startGame() 被拦下，不会发牌、不会抓牌，
 * 直到你点了其中一个按钮才继续。
 *
 * 纯附加模块：不改任何原有函数的逻辑，只在外面套一层 startGame()。
 * 所有「开下一局」的入口（结算页点确定、流局后点确认/点过）最终都走 startGame()，所以只需套这一处。
 * 须在 13-game-actions.js、17-toolbar.js 之后加载。
 * 依赖：index.html 里的 #bust-modal 及其子元素；03-dice-ritual.js 的 startDiceRitualWithMode('dealer')。
 * 初始筹码沿用 17-toolbar.js 的存档键 qj_mahjong_init_chips（没设过默认 50）。
 */
(function () {
    'use strict';

    var K_CHIPS = 'qj_mahjong_init_chips';
    var DEFAULT_CHIPS = 50;

    function savedChips() {
        try {
            var n = Math.floor(Number(localStorage.getItem(K_CHIPS)));
            if (isFinite(n) && n >= 1) return n;
        } catch (e) {}
        return DEFAULT_CHIPS;
    }

    var startGameOrig = (typeof window.startGame === 'function') ? window.startGame : null;
    if (!startGameOrig) return;

    function $b(id) { return document.getElementById(id); }
    function isOpen() { var m = $b('bust-modal'); return !!(m && m.classList.contains('show')); }

    function bustedPlayer() {
        for (var i = 0; i < turnOrder.length; i++) {
            if (scores[turnOrder[i]] < 0) return turnOrder[i];
        }
        return null;
    }

    window.startGame = function () {
        var b = bustedPlayer();
        var m = $b('bust-modal');
        if (!b || !m) return startGameOrig.apply(this, arguments); // 没人输光（或页面里没有弹窗）：原样开下一局
        if (isOpen()) return;                                      // 已经在问了：继续等，不重复弹、不开局
        var msg = $b('bust-message');
        if (msg) msg.textContent = nameOf(b) + ' 筹码 ' + scores[b] + '，已低于 0';
        try { logFlow(nameOf(b) + ' 筹码为 ' + scores[b] + '，等待确认是否重新开场'); } catch (e) {}
        m.classList.add('show');
    };

    /** 重新开场：四家设为存过的初始筹码 → 掷骰子调庄（调庄后由 applyDealerFromDice 发牌开局） */
    window.confirmBustRestart = function () {
        var n = savedChips();
        var m = $b('bust-modal');
        if (m) m.classList.remove('show');

        scores = { top: n, left: n, right: n, bottom: n };
        lastSettlement = null;
        try { markDealer(); } catch (e) {}
        try { flushSaveProgress(); } catch (e) {}
        try { logFlow('重新开场：四家筹码 ' + n + '，掷骰子调庄'); } catch (e) {}
        startDiceRitualWithMode('dealer');
    };

    /** 继续当前场：不重开，照常开下一局 */
    window.cancelBustRestart = function () {
        var m = $b('bust-modal');
        if (m) m.classList.remove('show');
        startGameOrig();
    };
})();
