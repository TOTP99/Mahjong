/* 14-credit-clock.js
 * 接管 #credit-label / #credit-label-2 的全部内容（仅竖屏可见，横屏由 CSS 隐藏）：
 *   第一行（金字）：TP制作🌸🦋🍁❄️🧿📿🪷🛫🎏3️⃣6️⃣9️⃣
 *   第二行：时:分:秒 星期(英文全称) 月-日-年(两位) 均为金字（继承 #credit-label-2 的颜色），
 *           ⏰ 本次已玩时间 为红色粗体
 * 已玩时间严格按5分钟一档：<5 mins、5 mins、10 mins … 25 mins（25~29分钟都显示 25 mins）。
 * 只存内存，不写 localStorage；页面切到后台时暂停计时。
 * 必须放在 13-game-actions.js 之后加载。
 */
(function () {
    'use strict';

    var LINE1 = 'TP制作🌸🦋🍁❄️🧿📿🪷🛫🎏3️⃣6️⃣9️⃣';
    var WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var PLAYED_STYLE = 'color:#ff4d4d;font-weight:700;';

    var el1 = document.getElementById('credit-label');
    var el2 = document.getElementById('credit-label-2');
    if (!el1 || !el2) return;

    // 两行都不换行，数字等宽，避免每秒跳动时宽度抖动
    [el1, el2].forEach(function (el) {
        el.style.whiteSpace = 'nowrap';
        el.style.fontVariantNumeric = 'tabular-nums';
    });

    // ---- 已玩时长（仅内存，页面隐藏时暂停）----
    var playedMs = 0;
    var lastTick = Date.now();
    var visible = !document.hidden;

    function accumulate() {
        var now = Date.now();
        if (visible) playedMs += now - lastTick;
        lastTick = now;
    }

    document.addEventListener('visibilitychange', function () {
        accumulate();               // 先结算切换前的时间
        visible = !document.hidden;
        lastTick = Date.now();
        render();
    });

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    // 严格5分钟一档：向下取整到5的倍数
    function playedText(mins) {
        if (mins < 5) return '<5 mins';
        return (Math.floor(mins / 5) * 5) + ' mins';
    }

    var lastHtml2 = '';

    function render() {
        accumulate();
        var d = new Date();
        var mins = Math.floor(playedMs / 60000);
        var clock = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
                    ' ' + WEEK[d.getDay()] + ' ' +
                    pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getFullYear() % 100);
        // 用 innerHTML 是因为要给已玩时间单独上色；内容全部由本脚本生成，没有外部输入
        var html2 = clock + ' <span style="' + PLAYED_STYLE + '">⏰ ' +
                    playedText(mins).replace('<', '&lt;') + '</span>';
        if (el1.textContent !== LINE1) el1.textContent = LINE1;
        if (html2 !== lastHtml2) { el2.innerHTML = html2; lastHtml2 = html2; }
    }

    render();
    setInterval(render, 1000);
})();
