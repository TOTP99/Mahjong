/* ============================================================
 * js/16-game-feel.js — 手感层：合成音效 + 出牌飞行
 * 本项目专用（全局函数，无 Game 命名空间、无开关 UI）。
 * 纯装饰：无 AudioContext / 无 DOM / prefers-reduced-motion 时静默 no-op，
 * 不影响规则、牌数、回合、存档。须在 13-game-actions.js 之后加载。
 * ============================================================ */
(function () {
    'use strict';

    /* ---------- WebAudio 合成（无外部音频文件） ---------- */
    var _ctx = null;
    var _master = null;

    function ac() {
        if (typeof window === 'undefined') return null;
        try {
            if (!_ctx) {
                var AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return null;
                _ctx = new AC();
                _master = _ctx.createGain();
                _master.gain.value = 0.45;
                _master.connect(_ctx.destination);
            }
            if (_ctx.state === 'suspended') _ctx.resume();
            return _ctx;
        } catch (e) {
            return null;
        }
    }

    /* iOS/Safari：首次手势解锁音频 */
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('pointerdown', function unlock() {
            ac();
        }, { once: true });
    }

    /** 滤波噪声敲击（牌声主体） */
    function burst(o) {
        var ctx = ac();
        if (!ctx) return;
        try {
            var dur = o.dur || 0.06;
            var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
            var buf = ctx.createBuffer(1, len, ctx.sampleRate);
            var d = buf.getChannelData(0);
            for (var i = 0; i < len; i++) {
                d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
            }
            var src = ctx.createBufferSource();
            src.buffer = buf;
            var f = ctx.createBiquadFilter();
            f.type = 'bandpass';
            f.frequency.value = o.freq || 2200;
            f.Q.value = o.q || 1.1;
            var g = ctx.createGain();
            var t = ctx.currentTime + (o.at || 0);
            g.gain.setValueAtTime(o.gain || 0.5, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            src.connect(f);
            f.connect(g);
            g.connect(_master);
            src.start(t);
            src.stop(t + dur + 0.02);
        } catch (e) { /* ignore */ }
    }

    /** 正弦/三角短音；freqTo 可上滑 */
    function tone(o) {
        var ctx = ac();
        if (!ctx) return;
        try {
            var dur = o.dur || 0.1;
            var osc = ctx.createOscillator();
            osc.type = o.type || 'sine';
            var t = ctx.currentTime + (o.at || 0);
            osc.frequency.setValueAtTime(o.freq || 660, t);
            if (o.freqTo) {
                osc.frequency.exponentialRampToValueAtTime(o.freqTo, t + dur);
            }
            var g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(o.gain || 0.4, t + 0.012);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            osc.connect(g);
            g.connect(_master);
            osc.start(t);
            osc.stop(t + dur + 0.02);
        } catch (e) { /* ignore */ }
    }

    var DISCARD_FREQS = [1900, 2300, 2600, 2900];

    function sfxDraw() {
        burst({ freq: 1350, dur: 0.045, gain: 0.28, q: 0.9 });
    }

    function sfxDiscard() {
        var f = DISCARD_FREQS[(Math.random() * DISCARD_FREQS.length) | 0];
        burst({ freq: f, dur: 0.06, gain: 0.55 });
        burst({ freq: f * 0.5, dur: 0.09, gain: 0.22, at: 0.012 });
    }

    function sfxChi() {
        tone({ freq: 660, dur: 0.09, gain: 0.35 });
        tone({ freq: 880, dur: 0.12, gain: 0.35, at: 0.08 });
    }

    function sfxPeng() {
        tone({ freq: 196, dur: 0.14, type: 'triangle', gain: 0.6 });
        burst({ freq: 900, dur: 0.05, gain: 0.4 });
    }

    function sfxGang() {
        tone({ freq: 130, dur: 0.2, type: 'triangle', gain: 0.65 });
        burst({ freq: 5200, dur: 0.12, gain: 0.18, q: 2, at: 0.02 });
    }

    function sfxWin() {
        var seq = [523, 587, 659, 784, 880];
        for (var i = 0; i < seq.length; i++) {
            tone({ freq: seq[i], dur: 0.16, type: 'triangle', gain: 0.38, at: i * 0.09 });
        }
    }

    function reducedMotion() {
        try {
            return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (e) {
            return false;
        }
    }

    function realDom() {
        try {
            return typeof document !== 'undefined' && document.body && document.body.nodeType === 1;
        } catch (e) {
            return false;
        }
    }

    /**
     * 出牌飞行：从 fromRect 飞到 #discardWall 最新一张中心，约 220ms。
     * tileHtml：牌面内容（通常是 tileImg(t) 的返回值）。
     */
    function feelFlyDiscard(fromRect, tileHtml) {
        try {
            if (reducedMotion() || !realDom() || !fromRect || !tileHtml) return;
            var river = document.querySelector('#discardWall .discardTile.latest') ||
                document.querySelector('#discardWall');
            if (!river) return;
            var to = river.getBoundingClientRect();
            var w = fromRect.width || 30;
            var h = fromRect.height || 40;
            var el = document.createElement('div');
            el.className = 'feel-fly';
            el.innerHTML = '<div class="tile">' + tileHtml + '</div>';
            el.style.left = fromRect.left + 'px';
            el.style.top = fromRect.top + 'px';
            el.style.width = w + 'px';
            el.style.height = h + 'px';
            document.body.appendChild(el);
            void el.offsetWidth;
            var dx = (to.left + to.width / 2) - (fromRect.left + w / 2);
            var dy = (to.top + to.height / 2) - (fromRect.top + h / 2);
            el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(0.94)';
            el.style.opacity = '0.92';
            setTimeout(function () {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 280);
            var latest = document.querySelector('#discardWall .discardTile.latest');
            if (latest && latest.classList) {
                latest.classList.remove('feel-land');
                void latest.offsetWidth;
                latest.classList.add('feel-land');
            }
        } catch (e) { /* ignore */ }
    }

    /** AI 出牌：从该家座位区中心飞出 */
    function feelFlyAiDiscard(player, tileHtml) {
        try {
            if (reducedMotion() || !realDom()) return;
            var seat = document.getElementById('p-' + player);
            if (!seat || !seat.getBoundingClientRect) return;
            var r = seat.getBoundingClientRect();
            var w = 30;
            var h = 40;
            feelFlyDiscard({
                left: r.left + r.width / 2 - w / 2,
                top: r.top + r.height / 2 - h / 2,
                width: w,
                height: h
            }, tileHtml);
        } catch (e) { /* ignore */ }
    }

    window.sfxDraw = sfxDraw;
    window.sfxDiscard = sfxDiscard;
    window.sfxChi = sfxChi;
    window.sfxPeng = sfxPeng;
    window.sfxGang = sfxGang;
    window.sfxWin = sfxWin;
    window.feelFlyDiscard = feelFlyDiscard;
    window.feelFlyAiDiscard = feelFlyAiDiscard;
})();
