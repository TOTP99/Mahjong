/* ============================================================
 * js/19-voice.js — 预录中文报牌（牌名 / 吃碰杠胡 / 自摸 / 点炮 / 庄 / 流局 / 亮牌）
 * 为什么：iOS Safari 对"非用户手势直接触发"的 speechSynthesis 会静默拦截，
 *         表现为第一声能响、之后全没声。这里改用 WebAudio 播放内置 mp3：
 *         与出牌音效同一类通道，首次触摸解锁后任何时候都能响。
 * 约定：覆盖全局 speak(text) / resetSpeechQueue()。文本里认不出的内容 → 回退原来的浏览器语音。
 * 数据：js/19-voice-data.js（window.VOICE_CLIPS，base64 mp3，无需网络请求，file:// 也能用）。
 * ============================================================ */
(function () {
    'use strict';
    var CLIPS = window.VOICE_CLIPS || null;
    var origSpeak = window.speak;
    var origReset = window.resetSpeechQueue;
    if (!CLIPS || typeof origSpeak !== 'function') return;

    var ctx = null, master = null;
    var buffers = {};          // key -> AudioBuffer
    var decoding = {};         // key -> true
    var active = [];           // 正在播/排队的 source
    var nextStart = 0;
    var GAP = 0.03;            // 片段之间的间隔（秒）
    var MAX_LAG = 1.6;         // 积压超过这个时长就丢弃新的，保持与牌局同步

    function getCtx() {
        if (ctx) return ctx;
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = 1.0;
            master.connect(ctx.destination);
        } catch (e) { ctx = null; }
        return ctx;
    }

    function b64ToBuf(b64) {
        var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
        for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
        return u.buffer;
    }

    function decode(key) {
        if (buffers[key] || decoding[key] || !CLIPS[key]) return;
        var c = getCtx(); if (!c) return;
        decoding[key] = true;
        var ab = b64ToBuf(CLIPS[key]);
        var ok = function (buf) { buffers[key] = buf; };
        var fail = function () { decoding[key] = false; };
        try {
            var p = c.decodeAudioData(ab, ok, fail);   // 回调形式兼容旧 Safari；新浏览器同时返回 Promise
            if (p && p.catch) p.catch(fail);
        } catch (e) { fail(); }
    }

    function preloadAll() { Object.keys(CLIPS).forEach(decode); }

    // 首次手势：创建/恢复 AudioContext，并播一个静音缓冲彻底解锁 iOS，然后预解码全部音频
    function unlock() {
        var c = getCtx(); if (!c) return;
        try { if (c.state === 'suspended') c.resume(); } catch (e) {}
        try {
            var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
            s.buffer = b; s.connect(c.destination); s.start(0);
        } catch (e) {}
        preloadAll();
    }
    ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'].forEach(function (ev) {
        try { window.addEventListener(ev, unlock, { capture: true, passive: true }); } catch (e) {}
    });
    // 页面一加载就先尝试预解码（不需要手势；ctx 可能处于 suspended，没关系）
    try { preloadAll(); } catch (e) {}

    // ---------- 文本 → 片段序列 ----------
    var NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
    var SUIT = { '万': 'm', '条': 't', '筒': 'p' };
    var HONOR = { '东': 'z1', '南': 'z2', '西': 'z3', '北': 'z4', '中': 'z5', '发': 'z6', '白': 'z7' };
    var SEAT = { '东': 'e', '南': 's', '西': 'w', '北': 'n' };

    function parse(text) {
        var s = String(text).replace(/[\s,，。！!、]/g, '');
        var out = [], i = 0, m;
        while (i < s.length) {
            var rest = s.slice(i);
            if ((m = /^([东南西北])庄/.exec(rest))) { out.push('zhuang_' + SEAT[m[1]]); i += 2; continue; }
            if ((m = /^([东南西北])点炮/.exec(rest))) { out.push('dp_' + SEAT[m[1]]); i += 3; continue; }
            if ((m = /^你点炮/.exec(rest))) { out.push('dp_you'); i += 3; continue; }
            if ((m = /^([一二三四五六七八九])([万条筒])/.exec(rest))) {
                out.push(SUIT[m[2]] + (NUM.indexOf(m[1]) + 1)); i += 2; continue;
            }
            if (rest.indexOf('胡了') === 0) { out.push('hu'); i += 2; continue; }
            if (rest.indexOf('自摸') === 0) { out.push('zimo'); i += 2; continue; }
            if (rest.indexOf('流局') === 0) { out.push('liuju'); i += 2; continue; }
            if (rest.indexOf('亮牌') === 0) { out.push('liangpai'); i += 2; continue; }
            var ch = rest.charAt(0);
            if (ch === '吃') out.push('chi');
            else if (ch === '碰') out.push('peng');
            else if (ch === '杠') out.push('gang');
            else if (HONOR[ch]) out.push(HONOR[ch]);
            else return null;                       // 认不出 → 交还给浏览器语音
            i += 1;
        }
        return out.length ? out : null;
    }

    // ---------- 播放 ----------
    function speak(text) {
        try {
            var keys = parse(text);
            var c = getCtx();
            if (!keys || !c) return origSpeak(text);
            for (var k = 0; k < keys.length; k++) if (!CLIPS[keys[k]]) return origSpeak(text);
            if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
            for (k = 0; k < keys.length; k++) decode(keys[k]);
            // 解码尚未完成（刚进页面）：这一句跳过，不回退到不稳定的浏览器语音
            for (k = 0; k < keys.length; k++) if (!buffers[keys[k]]) return;

            var now = c.currentTime;
            if (nextStart < now) nextStart = now + 0.01;
            if (nextStart - now > MAX_LAG) return;        // 积压太多：丢弃，追上当前局面
            for (k = 0; k < keys.length; k++) {
                var src = c.createBufferSource();
                src.buffer = buffers[keys[k]];
                src.connect(master);
                src.start(nextStart);
                active.push(src);
                src.onended = (function (s) {
                    return function () { var j = active.indexOf(s); if (j >= 0) active.splice(j, 1); };
                })(src);
                nextStart += src.buffer.duration + GAP;
            }
        } catch (e) {
            try { origSpeak(text); } catch (e2) {}
        }
    }

    function reset() {
        try { origReset && origReset(); } catch (e) {}
        try { active.forEach(function (s) { try { s.stop(); } catch (e) {} }); } catch (e) {}
        active = [];
        nextStart = 0;
    }

    window.speak = speak;
    window.resetSpeechQueue = reset;
    window.voiceClips = { parse: parse, preload: preloadAll };
})();
