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

// ---------- 三击判定 / 旋转动画 / 清零菜单（原先放在 05-device-orientation.js，现与骰子常量放在一起） ----------
function onTableTap(e) {
    if (diceBusy) return;
    if ($('result-modal').classList.contains('show')) return;
    if ($('reveal-modal').classList.contains('show')) return;
    if ($('chi-choice-modal').classList.contains('show')) return;
    if (e.target.closest('.tile, .tileback, .discardTile, .pool-tile, .player-label, button, .meld-group, #claim-indicator, #wall-count, #landscape-ctrl, #discard-query-btn, #discardWall, #pool-modal, img, .claim-btn, .reset-btn')) return;

    const now = Date.now();
    tableTapTimes = tableTapTimes.filter(t => now - t < DICE.TAP_WINDOW);
    tableTapTimes.push(now);
    if (tableTapTimes.length >= 3) {
        tableTapTimes = [];
        startDiceRitual();
    }
}

/** 重置骰子 DOM 状态（隐藏、清除动画类与内联 transform） */
function resetDiceDom() {
    const { stage, scene, cube, shadow } = diceEls();
    if (diceRafId) { cancelAnimationFrame(diceRafId); diceRafId = 0; }
    if (diceVanishTimer) { clearTimeout(diceVanishTimer); diceVanishTimer = 0; }
    stage.classList.remove('show', 'fade-out');
    scene.classList.remove('vanish');
    scene.style.transform = '';
    scene.style.opacity = '';
    cube.classList.remove('settled');
    cube.style.transform = '';
    if (shadow) {
        shadow.style.transform = 'translateZ(-30px) scale(1)';
        shadow.style.opacity = '0.6';
    }
}

function startDiceRitual() {
    if (diceBusy) return;
    diceBusy = true;
    diceSavedClaim = pendingClaim;
    pendingClaim = { mode: 'diceMenu' };
    hideIndicator();
    resetDiceDom();

    const { stage, scene, cube, shadow } = diceEls();
    stage.classList.add('show');
    playDiceSound();

    const face = 1 + Math.floor(Math.random() * 6);
    const end = DICE.FACE_ROT[face];
    const spinsX = (4 + Math.floor(Math.random() * 5)) * 360;
    const spinsY = (6 + Math.floor(Math.random() * 7)) * 360;
    const spinsZ = (2 + Math.floor(Math.random() * 3)) * 360;
    const phase = Math.random() * Math.PI * 2;
    const t0 = performance.now();

    function tick(now) {
        const t = Math.min(1, (now - t0) / DICE.ROLL_MS);
        const ease = 1 - Math.pow(1 - t, 3); // ease-out
        const inv = 1 - ease;
        const lift = Math.sin(Math.PI * t);   // 0→1→0 抛起
        const toss = lift * 54;
        const scale = 1 + lift * 0.22;
        const wobble = inv * 22 * Math.sin((now - t0) * 0.022 + phase);
        const rx = spinsX * inv + end.x * ease + wobble;
        const ry = spinsY * inv + end.y * ease + wobble * 0.65;
        const rz = spinsZ * inv + wobble * 0.4;

        scene.style.transform = `translateY(${-toss}px) scale(${scale})`;
        cube.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
        if (shadow) {
            shadow.style.transform = `translateZ(-30px) scale(${1 - lift * 0.45})`;
            shadow.style.opacity = String(0.25 + 0.4 * (1 - lift));
        }

        if (t < 1) {
            diceRafId = requestAnimationFrame(tick);
            return;
        }
        // 落地定格 → 缩小消失 → 菜单
        diceRafId = 0;
        scene.style.transform = 'translateY(0) scale(1)';
        cube.style.transform = `rotateX(${end.x}deg) rotateY(${end.y}deg) rotateZ(0deg)`;
        cube.classList.add('settled');
        if (shadow) {
            shadow.style.transform = 'translateZ(-30px) scale(1)';
            shadow.style.opacity = '0.6';
        }
        // 强制重绘一帧再加 vanish，确保 transition 生效
        void scene.offsetWidth;
        scene.classList.add('vanish');
        diceVanishTimer = setTimeout(() => {
            diceVanishTimer = 0;
            stage.classList.remove('show');
            scene.classList.remove('vanish');
            scene.style.transform = '';
            scene.style.opacity = '';
            showDiceResetMenu();
        }, DICE.VANISH_MS);
    }
    diceRafId = requestAnimationFrame(tick);
}

function showDiceResetMenu() {
    const el = $('claim-indicator');
    el.innerHTML =
        '<div class="reset-menu">'
        + '<button type="button" class="reset-btn" onclick="event.stopPropagation();confirmFullReset()">清零重启</button>'
        + '<button type="button" class="reset-btn" onclick="event.stopPropagation();cancelDiceRitual()">继续加油</button>'
        + '</div>';
    el.classList.add('show');
}

/** 继续加油：收起菜单，恢复仪式前的吃碰杠提示 */
function cancelDiceRitual() {
    resetDiceDom();
    hideIndicator();
    diceBusy = false;
    pendingClaim = diceSavedClaim;
    diceSavedClaim = null;
    if (!pendingClaim) return;
    if (pendingClaim.mode === 'nextGame') {
        showIndicator('下一局', true);
    } else if (pendingClaim.mode === 'selfGang') {
        showIndicator('杠', true);
    } else if (pendingClaim.mode === 'claim') {
        const options = [
            pendingClaim.canGang ? '杠' : null,
            pendingClaim.canPeng ? '碰' : null,
            (pendingClaim.chiCombos && pendingClaim.chiCombos.length) ? '吃' : null
        ].filter(Boolean).join('/');
        showIndicator(options, true);
    }
}

/** 清零重启：积分/庄家/存档全部归零并开新局 */
function confirmFullReset() {
    resetDiceDom();
    hideIndicator();
    $('result-modal').classList.remove('show');
    $('reveal-modal').classList.remove('show');
    $('chi-choice-modal').classList.remove('show');
    diceBusy = false;
    diceSavedClaim = null;
    pendingClaim = null;
    lastSettlement = null;
    scores = { top: 0, left: 0, right: 0, bottom: 0 };
    dealer = 'bottom';
    try {
        localStorage.removeItem(MAHJONG_STORAGE_KEY);
        localStorage.removeItem('qionghu_mahjong_progress_v1');
    } catch (e) { /* ignore */ }
    winner = null;
    gameOver = false;
    initGame();
    logFlow('已清零，新的一局开始');
}
