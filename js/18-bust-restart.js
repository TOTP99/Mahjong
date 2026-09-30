/* js/18-bust-restart.js — 筹码输光：任何一家筹码 < 0 时，开下一局前弹确认（与新版 17-field-manager.js 同一规则）
 *
 * 规则：筹码刚好为 0 可以继续；只要有人 < 0 才触发。
 *   「重新开场」→ 四家筹码设为所选初始筹码 → 掷骰子重新调庄 → 开新场
 *   「继续当前场」→ 照常开下一局（带着负数筹码继续；之后每局结算后仍会再问）
 *
 * 严格等待：弹窗一出现，游戏就停在这里——startGame() 被拦下，不会发牌、不会抓牌，
 * 直到你点了其中一个按钮才继续。初始筹码直接在弹窗里点选/填写（不再用浏览器自带的输入框：
 * 内置浏览器里 prompt() 可能立刻返回而不等你输入，会导致没选完就开局）。
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
    var MAX_CHIPS = 9999999;

    function savedChips() {
        try {
            var n = Math.floor(Number(localStorage.getItem(K_CHIPS)));
            if (isFinite(n) && n >= 1) return n;
        } catch (e) {}
        return DEFAULT_CHIPS;
    }

    var startGameOrig = (typeof window.startGame === 'function') ? window.startGame : null;
    if (!startGameOrig) return;

    var chosen = DEFAULT_CHIPS; // 当前选中的预设（自定义框有内容时以自定义为准）

    function $b(id) { return document.getElementById(id); }
    function isOpen() { var m = $b('bust-modal'); return !!(m && m.classList.contains('show')); }

    function bustedPlayer() {
        for (var i = 0; i < turnOrder.length; i++) {
            if (scores[turnOrder[i]] < 0) return turnOrder[i];
        }
        return null;
    }

    /** 刷新预设按钮的选中态 */
    function syncChips() {
        var custom = $b('bust-custom');
        var usingCustom = !!(custom && String(custom.value).trim() !== '');
        var btns = document.querySelectorAll('#bust-modal .bust-chip');
        for (var i = 0; i < btns.length; i++) {
            var on = !usingCustom && Number(btns[i].getAttribute('data-v')) === chosen;
            btns[i].classList.toggle('on', on);
            btns[i].setAttribute('aria-checked', on ? 'true' : 'false');
        }
        if (custom) custom.classList.toggle('on', usingCustom);
    }

    /** 读出最终选择：自定义框有内容 → 用它（必须是 1~9999999 的整数）；否则用选中的预设。非法返回 null */
    function readChoice() {
        var custom = $b('bust-custom');
        var raw = custom ? String(custom.value).trim() : '';
        if (raw === '') return chosen;
        var n = Number(raw);
        if (!isFinite(n) || n < 1 || n > MAX_CHIPS || Math.floor(n) !== n) return null;
        return n;
    }

    function setError(on) {
        var box = $b('bust-modal');
        if (box) box.classList.toggle('err', !!on);
    }

    window.bustPickChip = function (v) {
        chosen = v;
        var custom = $b('bust-custom');
        if (custom) custom.value = '';
        setError(false);
        syncChips();
    };
    window.bustCustomInput = function () {
        setError(false);
        syncChips();
    };

    window.startGame = function () {
        var b = bustedPlayer();
        var m = $b('bust-modal');
        if (!b || !m) return startGameOrig.apply(this, arguments); // 没人输光（或页面里没有弹窗）：原样开下一局
        if (isOpen()) return;                                      // 已经在问了：继续等，不重复弹、不开局
        var msg = $b('bust-message');
        if (msg) msg.textContent = nameOf(b) + ' 筹码 ' + scores[b] + '，已低于 0';
        chosen = savedChips();
        var custom = $b('bust-custom');
        if (custom) {
            var preset = [50, 100, 200, 500].indexOf(chosen) >= 0;
            custom.value = preset ? '' : String(chosen); // 上次用的是自定义值：填回输入框
        }
        setError(false);
        syncChips();
        try { logFlow(nameOf(b) + ' 筹码为 ' + scores[b] + '，等待确认是否重新开场'); } catch (e) {}
        m.classList.add('show');
    };

    /** 重新开场：四家设为所选初始筹码 → 掷骰子调庄（调庄后由 applyDealerFromDice 发牌开局） */
    window.confirmBustRestart = function () {
        var n = readChoice();
        if (n === null) { setError(true); return; } // 自定义值不合法：留在弹窗里让你改，不往下走
        var m = $b('bust-modal');
        if (m) m.classList.remove('show');
        try { localStorage.setItem(K_CHIPS, String(n)); } catch (e) {}

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
