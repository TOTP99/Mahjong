/* 14-credit-clock.js
 * 接管 #credit-label（署名）/ #credit-label-2（时钟+在线时长，5分钟一档，只存内存，后台暂停）；
 * 横屏时在左侧栏徽标后追加时分。须在 13-game-actions.js 之后加载。
 */
(function () {
    'use strict';

    var LINE1 = 'TP制作➸369❖❁';
    var WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var PLAYED_STYLE = 'color:#ffffff;font-weight:700;';
    // 时分盒子：宽度取 4.6 个数字宽（4位数字+1个冒号的最大宽度），右侧间隙 0.6em（原空格约 0.3em 的两倍）
    var HMS_STYLE = 'display:inline-block;width:4.6ch;margin-right:0.6em;';

    var el1 = document.getElementById('credit-label');
    var el2 = document.getElementById('credit-label-2');
    var badge = document.getElementById('img-display-badge'); // 横屏左侧栏的"TP制作"
    if (!el1 || !el2) return;
    var BADGE_TEXT = 'TP制作';
    // 时:分 放固定宽度盒子（4位数字+1个冒号的最大宽度），分钟变化时右边的牌墙文字不抖动
    var MS_STYLE = 'display:inline-block;width:4.6ch;margin-left:0.4em;';

    // 两行都不换行，数字等宽，避免每秒跳动时宽度抖动
    [el1, el2].forEach(function (el) {
        el.style.whiteSpace = 'nowrap';
        el.style.fontVariantNumeric = 'tabular-nums';
    });

    // ---- 在线时长（仅内存，页面隐藏时暂停）----
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
        if (mins < 5) return '0-5 mins';
        return (Math.floor(mins / 5) * 5) + ' mins';
    }

    var lastHtml2 = '';
    var lastBadgeHtml = null;

    function render() {
        accumulate();
        var d = new Date();
        var mins = Math.floor(playedMs / 60000);
        var hms = pad(d.getHours()) + ':' + pad(d.getMinutes());
        // 时分放进固定宽度的盒子，间隙约为原来一个空格的两倍；分钟变化时后面的文字不再左右抖动
        var clock = '<span style="' + HMS_STYLE + '">' + hms + '</span>' +
                    WEEK[d.getDay()] + ' ' +
                    pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getFullYear() % 100);
        // 用 innerHTML 是因为要给在线时间单独上色；内容全部由本脚本生成，没有外部输入
        var html2 = clock + ' <span style="' + PLAYED_STYLE + '">在线 ' +
                    playedText(mins) + '</span>';
        // 只维护第一个文字节点：署名后面追加的按钮（17-toolbar.js）不会被清掉
        var n1 = el1.firstChild;
        if (!n1 || n1.nodeType !== 3) el1.insertBefore(document.createTextNode(LINE1), el1.firstChild);
        else if (n1.nodeValue !== LINE1) n1.nodeValue = LINE1;
        if (html2 !== lastHtml2) { el2.innerHTML = html2; lastHtml2 = html2; }

        if (badge) {
            var portrait = document.body && document.body.classList.contains('portrait-layout');
            var bh = portrait ? BADGE_TEXT
                : BADGE_TEXT + '<span style="' + MS_STYLE + '">' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '</span>';
            if (bh !== lastBadgeHtml) { badge.innerHTML = bh; lastBadgeHtml = bh; }
        }
    }

    render();
    setInterval(render, 1000);
})();
