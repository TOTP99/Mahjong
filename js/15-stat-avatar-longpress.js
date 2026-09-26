/* 15-stat-avatar-longpress.js
 * 四个状态栏小头像：长按保护（避免误触其它操作）
 * Hidden gem：长按「猫」(bottom) → 同一颗黄金骰子 → 按点数从东起顺时针调庄并保留积分开新局
 * 须在 03-dice-ritual.js、13-game-actions.js 之后加载
 */
(function () {
    'use strict';

    var LONG_MS = 520;
    var MOVE_CANCEL_PX = 12;
    var press = null; // { player, x, y, timer, el }

    function clearPress() {
        if (!press) return;
        if (press.timer) clearTimeout(press.timer);
        if (press.el) press.el.classList.remove('stat-avatar-pressing');
        press = null;
    }

    function onDown(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        var cell = e.target.closest && e.target.closest('.stat-cell[data-player]');
        if (!cell) return;
        // 不干扰输入框/按钮
        if (e.target.closest('button, input, a')) return;

        var player = cell.getAttribute('data-player');
        if (!player) return;

        // 长按保护：吞掉后续合成 click 的一部分路径
        e.stopPropagation();

        clearPress();
        press = {
            player: player,
            x: e.clientX,
            y: e.clientY,
            el: cell,
            timer: setTimeout(function () {
                var p = press && press.player;
                clearPress();
                if (!p) return;
                if (p === 'bottom') {
                    // 猫头：调庄 hidden gem
                    try {
                        if (typeof diceBusy !== 'undefined' && diceBusy) return;
                        if (typeof startDiceDealerRitual === 'function') {
                            startDiceDealerRitual();
                        }
                    } catch (err) { /* ignore */ }
                }
                // 其它三家：仅保护，无动作
            }, LONG_MS)
        };
        cell.classList.add('stat-avatar-pressing');
        try {
            if (cell.setPointerCapture && e.pointerId != null) {
                cell.setPointerCapture(e.pointerId);
            }
        } catch (err) {}
    }

    function onMove(e) {
        if (!press) return;
        var dx = e.clientX - press.x;
        var dy = e.clientY - press.y;
        if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) clearPress();
    }

    function onUp() {
        clearPress();
    }

    function onContextMenu(e) {
        if (e.target.closest && e.target.closest('.stat-cell[data-player], .stat-avatar-img')) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    function bind() {
        var root = document.getElementById('wall-count') || document.body;
        root.addEventListener('pointerdown', onDown, true);
        root.addEventListener('pointermove', onMove, true);
        root.addEventListener('pointerup', onUp, true);
        root.addEventListener('pointercancel', onUp, true);
        root.addEventListener('contextmenu', onContextMenu, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
