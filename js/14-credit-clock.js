/* 14-credit-clock.js
 * 接管 #credit-label（署名）/ #credit-label-2（时钟）；
 * 横屏时在左侧栏徽标后追加时分。须在 13-game-actions.js 之后加载。
 */
(function () {
    'use strict';

    var LINE1 = 'TP制作➸369❖❁';
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

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    var lastHtml2 = '';
    var lastBadgeHtml = null;

    function render() {
        var d = new Date();
        var hms = pad(d.getHours()) + ':' + pad(d.getMinutes());
        // 只显示时分
        var html2 = '<span style="' + HMS_STYLE + '">' + hms + '</span>';
        // 只维护第一个文字节点：署名后面追加的按钮（17-toolbar.js）不会被清掉
        // 竖屏署名移到右下角（#credit-corner），顶栏只留按钮
        var wantSig = (document.body && document.body.classList.contains('portrait-layout')) ? '' : LINE1;
        var n1 = el1.firstChild;
        if (!n1 || n1.nodeType !== 3) el1.insertBefore(document.createTextNode(wantSig), el1.firstChild);
        else if (n1.nodeValue !== wantSig) n1.nodeValue = wantSig;
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
