/* js/17-toolbar.js — 署名后的三个小按钮：音效开关 / 危险提示开关 / 初始筹码
 * 纯附加模块：不改任何原有函数的逻辑，只在外面套一层开关。须在 14-credit-clock.js、16-game-feel.js 之后加载。
 *
 *  音效开关    套住 16-game-feel.js 导出的 window.sfxDraw/Discard/Chi/Peng/Gang/Win；关掉即静音。
 *              （原有调用点都是 typeof 检查后按名字调用，所以替换 window.sfx* 就生效）
 *  危险提示    套住 isDangerousTile()（06-tiles-utils.js，只被 12-render.js 的 renderTile 用来给牌加 .danger 样式，
 *              AI 出牌不用它），关掉即不标危险牌。默认开 = 与原来一致。
 *  初始筹码    弹输入框 → 确认 → 走原有 confirmFullReset()（清零重开），再把四家积分设为所选筹码。
 *              三击桌面的「清零重启」：回到初始筹码；没设过则用默认 50（与新版默认一致），不再归 0。
 *              全新开局（无任何对局存档）也从初始筹码开始——这段在 13-game-actions.js 启动处（须早于本文件执行）。
 *
 * 存档键（localStorage）：qj_mahjong_sfx_on / qj_mahjong_danger_hint / qj_mahjong_init_chips
 */
(function () {
    'use strict';

    var K_SFX = 'qj_mahjong_sfx_on';
    var K_DANGER = 'qj_mahjong_danger_hint';
    var K_CHIPS = 'qj_mahjong_init_chips';

    function load(key, def) {
        try { var v = localStorage.getItem(key); return v === null ? def : v; } catch (e) { return def; }
    }
    function save(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

    var sfxOn = load(K_SFX, '1') !== '0';
    var dangerOn = load(K_DANGER, '1') !== '0';

    /* ---------- 音效：套住 window.sfx* ---------- */
    var SFX_NAMES = ['sfxDraw', 'sfxDiscard', 'sfxChi', 'sfxPeng', 'sfxGang', 'sfxWin'];
    var sfxOrig = {};
    SFX_NAMES.forEach(function (n) {
        var f = window[n];
        if (typeof f !== 'function') return;
        sfxOrig[n] = f;
        window[n] = function () {
            if (!sfxOn) return;
            return f.apply(this, arguments);
        };
    });

    /* ---------- 危险提示：套住 isDangerousTile ---------- */
    var dangerOrig = (typeof window.isDangerousTile === 'function') ? window.isDangerousTile : null;
    if (dangerOrig) {
        window.isDangerousTile = function (tile) {
            return dangerOn ? dangerOrig(tile) : false;
        };
    }

    /* ---------- 清零重启：回到初始筹码（没设过用默认 50） ---------- */
    var DEFAULT_CHIPS = 50;
    function savedChips() {
        var n = Math.floor(Number(load(K_CHIPS, '')));
        return (isFinite(n) && n >= 1) ? n : DEFAULT_CHIPS;
    }
    var resetOrig = (typeof window.confirmFullReset === 'function') ? window.confirmFullReset : null;
    if (resetOrig) {
        window.confirmFullReset = function () {
            var r = resetOrig.apply(this, arguments);
            var n = savedChips();
            try {
                scores = { top: n, left: n, right: n, bottom: n };
                markDealer(); // 刷新头像旁数字
                if (typeof saveGameProgress === 'function') saveGameProgress();
            } catch (e) {}
            return r;
        };
    }

    /* ---------- 按钮 ---------- */
    var LABEL = {
        sfx: function () { return sfxOn ? '音效开' : '音效关'; },
        danger: function () { return dangerOn ? '危险开' : '危险关'; },
        chips: function () { return '初始筹码'; }
    };

    function syncButtons() {
        var btns = document.querySelectorAll('.qj-btn');
        for (var i = 0; i < btns.length; i++) {
            var k = btns[i].getAttribute('data-k');
            btns[i].textContent = LABEL[k]();
        }
    }

    function toggleSfx() {
        sfxOn = !sfxOn;
        save(K_SFX, sfxOn ? '1' : '0');
        syncButtons();
        // 打开时给一声确认（用原始未被套住的函数）
        if (sfxOn && sfxOrig.sfxDiscard) { try { sfxOrig.sfxDiscard(); } catch (e) {} }
    }

    function toggleDanger() {
        dangerOn = !dangerOn;
        save(K_DANGER, dangerOn ? '1' : '0');
        syncButtons();
        try { if (typeof render === 'function') render(); } catch (e) {} // 立即刷新手牌上的危险标记
    }

    function setInitialChips() {
        var last = load(K_CHIPS, String(DEFAULT_CHIPS));
        var v = window.prompt('请输入初始筹码（每家）：', last);
        if (v === null) return; // 取消
        var n = Math.floor(Number(v));
        if (!isFinite(n) || n < 1 || n > 9999999) {
            window.alert('请输入 1 以上的整数');
            return;
        }
        if (!window.confirm('四家初始筹码设为 ' + n + '，将清零并重新开局，继续吗？')) return;
        save(K_CHIPS, String(n));
        try {
            confirmFullReset(); // 已被上面套住：清零重开后四家积分设为刚保存的初始筹码
        } catch (e) {
            try { logFlow('设置初始筹码失败，请三击桌面清零重开'); } catch (e2) {}
        }
    }

    var ACTION = { sfx: toggleSfx, danger: toggleDanger, chips: setInitialChips };

    function makeBar() {
        var bar = document.createElement('span');
        bar.className = 'qj-tb';
        ['sfx', 'danger', 'chips'].forEach(function (k) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'qj-btn';
            b.setAttribute('data-k', k);
            // 不让点击冒泡到桌面（避免被三击清零/点桌面等手势误认）
            ['pointerdown', 'touchstart', 'mousedown', 'dblclick'].forEach(function (ev) {
                b.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true });
            });
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                e.preventDefault();
                ACTION[k]();
            });
            bar.appendChild(b);
        });
        return bar;
    }

    function init() {
        var el1 = document.getElementById('credit-label');
        if (!el1) return;
        // 竖屏：紧跟在「TP制作➸369❖❁」后面（14-credit-clock.js 只改第一个文字节点，不会清掉按钮）
        el1.appendChild(makeBar());

        // 横屏：左侧栏 TP制作 那一行下面单独一行
        var hdr = document.getElementById('wall-count-header');
        if (hdr) {
            var row = document.createElement('div');
            row.id = 'qj-tb-ls';
            row.appendChild(makeBar());
            hdr.appendChild(row);
        }
        syncButtons();
    }

    init();
})();
