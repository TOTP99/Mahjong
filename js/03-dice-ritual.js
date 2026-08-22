// ========== 三击桌面：黄金骰子仪式（清零 / 继续） ==========
// 流程：连点空白处 3 次 → 3D 旋转 2s → 缩小消失 → 弹出清零菜单
const DICE = {
    ROLL_MS: 2000,       // 旋转时长
    VANISH_MS: 400,      // 缩小消失时长
    TAP_WINDOW: 450,     // 三击判定窗口
    // 3×3 点数格索引（0–8）
    PIPS: {
        1: [4],
        2: [0, 8],
        3: [0, 4, 8],
        4: [0, 2, 6, 8],
        5: [0, 2, 4, 6, 8],
        6: [0, 2, 3, 5, 6, 8]
    },
    // 目标面朝前时的欧拉角
    FACE_ROT: {
        1: { x: 0, y: 0 },
        2: { x: 0, y: -90 },
        3: { x: 0, y: 180 },
        4: { x: 0, y: 90 },
        5: { x: -90, y: 0 },
        6: { x: 90, y: 0 }
    }
};

let tableTapTimes = [];
let diceBusy = false;
let diceRafId = 0;
let diceVanishTimer = 0;
let diceSavedClaim = null; // 仪式期间暂存吃碰杠/流局提示

function diceEls() {
    return {
        stage: $('dice-stage'),
        scene: $('dice-scene'),
        cube: $('dice-cube'),
        shadow: $('dice-shadow')
    };
}

function initDicePips() {
    document.querySelectorAll('#dice-cube .pips').forEach(el => {
        const n = parseInt(el.dataset.n, 10);
        const on = DICE.PIPS[n] || [];
        el.innerHTML = Array.from({ length: 9 }, (_, i) =>
            on.includes(i) ? '<span class="pip"></span>' : '<span></span>'
        ).join('');
    });
}

/** 合成一串撞击噪声 + 落地低音 */
function playDiceSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        for (let i = 0; i < 8; i++) {
            const t0 = now + i * 0.07;
            const dur = 0.04 + Math.random() * 0.03;
            const n = Math.floor(ctx.sampleRate * dur);
            const buf = ctx.createBuffer(1, n, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let j = 0; j < n; j++) data[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / n, 2);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const filt = ctx.createBiquadFilter();
            filt.type = 'bandpass';
            filt.frequency.value = 800 + Math.random() * 1800;
            filt.Q.value = 1.2;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.35 * (1 - i * 0.04), t0);
            gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
            src.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
            src.start(t0); src.stop(t0 + dur + 0.01);
        }
        const tEnd = now + 0.58;
        const osc = ctx.createOscillator();
        const g2 = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, tEnd);
        osc.frequency.exponentialRampToValueAtTime(60, tEnd + 0.12);
        g2.gain.setValueAtTime(0.22, tEnd);
        g2.gain.exponentialRampToValueAtTime(0.001, tEnd + 0.14);
        osc.connect(g2); g2.connect(ctx.destination);
        osc.start(tEnd); osc.stop(tEnd + 0.15);
        setTimeout(() => { try { ctx.close(); } catch (e) {} }, 1200);
    } catch (e) { /* 无音频权限时静默 */ }
}

/** 桌面单击：仅空白处计入，450ms 内满 3 次触发仪式 */

/** 横屏最大化：全屏 + 尽量锁定横屏（部分浏览器需用户手势） */

/** 桌面可视缩放：1 = 最大；每次 ±5%，下限 0.5 */
/** 原始正常大小（启动时锁定，扩大不能超过它） */
