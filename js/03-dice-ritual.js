// ========== 三击桌面：黄金镶钻八面骰仪式（清零 / 继续）+ 单骰调庄 ==========
// 流程：连点空白处 3 次 → 一颗八面 d8 从上方抛入桌心，翻滚弹跳落定 → 淡出 → 弹出清零菜单
// 调庄：startDiceDealerRitual / applyDealerFromDice，单骰掷 1–8 点定庄家
//   1-2→东（bottom/猫） 3-4→南（right） 5-6→西（top） 7-8→北（left），四家等概率
const DICE = {
    R: 32,               // 八面体中心到顶点距离（小骰子）
    CAM_D: 620, CAM_F: 620,
    GRAVITY: 2600,       // 重力加速度 px/s²
    BOUNCE_DAMP: 0.5,    // 落地反弹保留系数
    BOUNCE_MIN_VY: 170,  // 小于此速度视为落定
    SETTLE_MS: 300,      // 落定转到目标面的时长
    REST_MS: 1150,       // 落定后停留展示
    VANISH_MS: 450,      // 淡出时长
    TAP_WINDOW: 450       // 三击判定窗口
};

/* 8 个面：符号组合 → 点数（对面之和为 9，标准 d8） */
const D8_FACES = [
    { s: [ 1,  1,  1], n: 1 }, { s: [ 1,  1, -1], n: 2 },
    { s: [ 1, -1,  1], n: 3 }, { s: [ 1, -1, -1], n: 4 },
    { s: [-1,  1,  1], n: 5 }, { s: [-1,  1, -1], n: 6 },
    { s: [-1, -1,  1], n: 7 }, { s: [-1, -1, -1], n: 8 }
];
const D8_SQ3 = Math.sqrt(3);
/* 点数 → 座位（turnOrder 顺序：bottom→right→top→left） */
function d8SeatIndexOfFace(face, startIdx) {
    return (startIdx + Math.floor((face - 1) / 2)) % 4; // 1-2 东 3-4 南 5-6 西 7-8 北
}

let tableTapTimes = [];
let diceBusy = false;
let diceRafId = 0;
let diceVanishTimer = 0;
let diceSavedClaim = null; // 仪式期间暂存吃碰杠/流局提示
let diceRitualMode = 'reset'; // 'reset' | 'dealer'
let diceLastFace = 1;

function diceEls() {
    return {
        stage: $('dice-stage'),
        scene: $('dice-scene'),
        canvas: $('dice-canvas')
    };
}

/** 启动时调用：canvas 版无需预生成点数 DOM，保留为空操作（兼容旧调用） */
function initDicePips() { /* no-op: d8 点数由 canvas 绘制 */ }

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

// ---------- 三击判定 / 骰子仪式 / 清零菜单 ----------
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

/** 重置骰子 DOM 状态（隐藏、停掉 rAF、清掉 canvas） */
function resetDiceDom() {
    const { stage, scene, canvas } = diceEls();
    if (diceRafId) { cancelAnimationFrame(diceRafId); diceRafId = 0; }
    if (diceVanishTimer) { clearTimeout(diceVanishTimer); diceVanishTimer = 0; }
    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    stage.classList.remove('show', 'fade-out');
    scene.classList.remove('vanish');
    scene.style.transform = '';
    scene.style.opacity = '';
}

/* ---------- 八面体数学 ---------- */
/** 先 Ry(ry) 再 Rx(rx) */
function d8Rot(p, rx, ry) {
    const c1 = Math.cos(ry), s1 = Math.sin(ry);
    const x1 = p.x * c1 + p.z * s1, y1 = p.y, z1 = -p.x * s1 + p.z * c1;
    const c2 = Math.cos(rx), s2 = Math.sin(rx);
    return { x: x1, y: y1 * c2 - z1 * s2, z: y1 * s2 + z1 * c2 };
}
/** 把目标面的法线转到朝向观众所需的 rx, ry（弧度） */
function d8FaceAngles(f) {
    const nx = f.s[0] / D8_SQ3, ny = f.s[1] / D8_SQ3, nz = f.s[2] / D8_SQ3;
    return { ry: Math.atan2(-nx, nz), rx: Math.atan2(ny, Math.hypot(nx, nz)) };
}
function d8NearAngle(cur, target) {
    const TAU = Math.PI * 2;
    return target + TAU * Math.round((cur - target) / TAU);
}
/** 金色：更黄更暗（深 #69460a → 亮 #ebbe2d） */
function d8Gold(b) {
    const dk = [105, 70, 10], lt = [235, 190, 45];
    const k = Math.max(0, Math.min(1, b));
    return 'rgb(' + Math.round(dk[0] + (lt[0] - dk[0]) * k) + ','
        + Math.round(dk[1] + (lt[1] - dk[1]) * k) + ','
        + Math.round(dk[2] + (lt[2] - dk[2]) * k) + ')';
}
const D8_LIGHT = (function () {
    const l = { x: -0.35, y: -0.55, z: 0.76 };
    const m = Math.hypot(l.x, l.y, l.z);
    return { x: l.x / m, y: l.y / m, z: l.z / m };
})();

/** 三击桌面清零菜单用 */
function startDiceRitual() {
    startDiceRitualWithMode('reset');
}

/** 长按猫头调庄：同一颗骰子，点数按东起顺时针数到谁做庄 */
function startDiceDealerRitual() {
    startDiceRitualWithMode('dealer');
}

function startDiceRitualWithMode(mode) {
    if (diceBusy) return;
    if ($('result-modal') && $('result-modal').classList.contains('show')) return;
    diceBusy = true;
    diceRitualMode = mode === 'dealer' ? 'dealer' : 'reset';
    diceSavedClaim = pendingClaim;
    pendingClaim = { mode: 'diceMenu' };
    hideIndicator();
    resetDiceDom();

    const { stage, canvas } = diceEls();
    if (!stage || !canvas) { diceBusy = false; return; }
    // canvas 铺满舞台
    const w = stage.clientWidth || window.innerWidth;
    const h = stage.clientHeight || window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    stage.classList.add('show');
    playDiceSound();

    // 调庄掷 1–8 定庄；清零仪式点数仅动画展示
    const face = D8_FACES[Math.floor(Math.random() * 8)];
    diceLastFace = face.n;

    const cx = w / 2, cy = h * 0.46;
    const sx = Math.random() < 0.5 ? -1 : 1;
    const x0 = cx + sx * (110 + Math.random() * 70);
    const die = {
        x: x0, y: -70,
        vx: (cx + (Math.random() * 20 - 10) - x0) * 2.1, vy: 60,
        rx: Math.random() * 6.28, ry: Math.random() * 6.28,
        vrx: (650 + Math.random() * 550) * (Math.random() < 0.5 ? -1 : 1),
        vry: (650 + Math.random() * 550) * (Math.random() < 0.5 ? -1 : 1),
        floorX: cx + (Math.random() * 16 - 8), floorY: cy + (Math.random() * 12 - 6),
        face: face, state: 'fly',
        fade: 1, dpr: dpr
    };

    const ctx = canvas.getContext('2d');
    let last = performance.now();
    function tick(now) {
        const dt = Math.min(0.033, Math.max(0.001, (now - last) / 1000));
        last = now;
        d8Step(die, dt, now);
        d8Draw(ctx, die);
        if (die.state === 'fade') {
            die.fade -= dt / (DICE.VANISH_MS / 1000);
            if (die.fade <= 0) {
                diceRafId = 0;
                resetDiceDom();
                if (diceRitualMode === 'dealer') {
                    applyDealerFromDice(diceLastFace);
                } else {
                    showDiceResetMenu();
                }
                return;
            }
        }
        diceRafId = requestAnimationFrame(tick);
    }
    diceRafId = requestAnimationFrame(tick);
}

/** 单颗骰子物理步进：重力下落 → 碰地反弹 → 减速落定转到目标面 */
function d8Step(t, dt, now) {
    if (t.state === 'fly') {
        t.vy += DICE.GRAVITY * dt;
        t.x += t.vx * dt;
        t.y += t.vy * dt;
        t.rx += t.vrx * dt;
        t.ry += t.vry * dt;
        if (t.y >= t.floorY && t.vy > 0) {
            t.y = t.floorY;
            const impact = Math.abs(t.vy);
            if (impact > DICE.BOUNCE_MIN_VY) {
                t.vy = -t.vy * DICE.BOUNCE_DAMP;
                t.vx *= 0.72;
                t.vrx *= 0.55; t.vry *= 0.55;
                t.vrx += (Math.random() * 240 - 120);
                t.vry += (Math.random() * 240 - 120);
            } else {
                // 落定：位置咬住桌心目标点（消除弹跳带来的水平漂移），再 ease 转到目标面
                t.x = t.floorX; t.y = t.floorY;
                t.state = 'settle';
                t.settleT0 = now;
                const a = d8FaceAngles(t.face);
                t.fromRx = t.rx; t.fromRy = t.ry;
                t.toRx = d8NearAngle(t.fromRx, a.rx);
                t.toRy = d8NearAngle(t.fromRy, a.ry);
            }
        }
    } else if (t.state === 'settle') {
        const u = Math.min(1, (now - t.settleT0) / DICE.SETTLE_MS);
        // easeOutBack：轻微过冲再回正 → 咬合感
        const c = 1.4;
        const e = 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2);
        t.rx = t.fromRx + (t.toRx - t.fromRx) * e;
        t.ry = t.fromRy + (t.toRy - t.fromRy) * e;
        if (u >= 1) {
            t.state = 'rest';
            t.rx = t.toRx; t.ry = t.toRy;
            t.restT0 = now;
        }
    } else if (t.state === 'rest') {
        if (now - t.restT0 > DICE.REST_MS) t.state = 'fade';
    }
}

/** 把物理状态画到 canvas：阴影 / 八面体 / 镶钻点数 */
function d8Draw(ctx, t) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.save();
    ctx.scale(t.dpr || 1, t.dpr || 1);
    const w = W / (t.dpr || 1), h = H / (t.dpr || 1);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.max(0, t.fade);
    const R = DICE.R, D = DICE.CAM_D, F = DICE.CAM_F;
    // 落地阴影
    const hgt = Math.max(0, (t.floorY - t.y)) / 400;
    ctx.save();
    ctx.translate(t.x, t.floorY + R * 0.9 + 8);
    const shScale = Math.max(0.5, 1 - hgt * 0.3);
    ctx.scale(shScale, 1);
    const sg = ctx.createRadialGradient(0, 0, 2, 0, 0, R * 1.15);
    sg.addColorStop(0, 'rgba(0,0,0,' + (0.5 * Math.max(0.2, 1 - hgt * 0.6)).toFixed(2) + ')');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.15, 0, 6.29); ctx.fill();
    ctx.restore();
    // 8 个面：旋转 → 按深度排序 → 绘制
    const items = D8_FACES.map(function (f) {
        const v = f.s.map(function (sgn, i) {
            const p = { x: 0, y: 0, z: 0 };
            if (i === 0) p.x = sgn * R; else if (i === 1) p.y = sgn * R; else p.z = sgn * R;
            return d8Rot(p, t.rx, t.ry);
        });
        const n = d8Rot({ x: f.s[0] / D8_SQ3, y: f.s[1] / D8_SQ3, z: f.s[2] / D8_SQ3 }, t.rx, t.ry);
        return { f: f, v: v, n: n, z: (v[0].z + v[1].z + v[2].z) / 3 };
    });
    items.sort(function (a, b) { return a.z - b.z; }); // 远的先画
    items.forEach(function (it) {
        if (it.n.z <= 0.02) return; // 背面不画
        const b = 0.42 + 0.58 * Math.max(0, it.n.x * D8_LIGHT.x + it.n.y * D8_LIGHT.y + it.n.z * D8_LIGHT.z);
        const pts = it.v.map(function (p) {
            const s = F / (D - p.z);
            return { x: t.x + p.x * s, y: t.y + p.y * s, s: s };
        });
        // 金面
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.lineTo(pts[2].x, pts[2].y);
        ctx.closePath();
        ctx.fillStyle = d8Gold(b);
        ctx.fill();
        // 顶部高光
        const hg = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[2].x, pts[2].y);
        hg.addColorStop(0, 'rgba(255,250,225,' + (0.42 * b).toFixed(2) + ')');
        hg.addColorStop(0.55, 'rgba(255,250,225,0)');
        ctx.fillStyle = hg; ctx.fill();
        ctx.strokeStyle = 'rgba(90,60,10,0.55)'; ctx.lineWidth = 1; ctx.stroke();
        // 镶钻：三个顶点小钻
        pts.forEach(function (p) {
            ctx.save();
            ctx.shadowColor = 'rgba(220,240,255,0.95)'; ctx.shadowBlur = 6;
            ctx.fillStyle = '#f4faff';
            ctx.beginPath(); ctx.arc(p.x, p.y, 2.1 * p.s, 0, 6.29); ctx.fill();
            ctx.restore();
        });
        // 钻石点数
        const cxp = (pts[0].x + pts[1].x + pts[2].x) / 3, cyp = (pts[0].y + pts[1].y + pts[2].y) / 3;
        const sc = (pts[0].s + pts[1].s + pts[2].s) / 3;
        const fs = 15 * sc;
        ctx.save();
        ctx.font = '700 ' + fs.toFixed(1) + 'px system-ui';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(190,225,255,0.95)'; ctx.shadowBlur = 9;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(it.f.n, cxp, cyp + 1);
        ctx.shadowBlur = 0;
        // 星芒呼吸
        const tw = 0.6 + 0.4 * Math.sin(performance.now() / 380 + it.f.n);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.75 * tw).toFixed(2) + ')';
        ctx.lineWidth = 1.1;
        const L = fs * 0.85 * tw;
        ctx.beginPath();
        ctx.moveTo(cxp - L, cyp); ctx.lineTo(cxp + L, cyp);
        ctx.moveTo(cxp, cyp - L * 0.7); ctx.lineTo(cxp, cyp + L * 0.7);
        ctx.stroke();
        ctx.restore();
    });
    // 落定金光
    if (t.state === 'rest' || t.state === 'fade') {
        ctx.save();
        ctx.globalAlpha *= 0.5;
        const gg = ctx.createRadialGradient(t.x, t.y, 4, t.x, t.y, R * 2.4);
        gg.addColorStop(0, 'rgba(255,220,120,0.55)');
        gg.addColorStop(1, 'rgba(255,220,120,0)');
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(t.x, t.y, R * 2.4, 0, 6.29); ctx.fill();
        ctx.restore();
    }
    ctx.restore();
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

/**
 * 调庄：一颗八面骰，1-2→东（bottom/猫）3-4→南（right）5-6→西（top）7-8→北（left）
 * turnOrder: bottom → right → top → left
 * 四家等概率，保留积分，按新庄重新发牌开一局
 */
function applyDealerFromDice(face) {
    resetDiceDom();
    hideIndicator();
    diceBusy = false;
    const saved = diceSavedClaim;
    diceSavedClaim = null;
    pendingClaim = null;

    const f = Math.max(1, Math.min(8, face | 0));
    const start = turnOrder.indexOf('bottom');
    const idx = d8SeatIndexOfFace(f, start);
    dealer = turnOrder[idx];
    try { markDealer(); } catch (e) {}

    const who = (typeof seatLabel === 'function') ? seatLabel(dealer) : nameOf(dealer);
    logFlow('调庄：八面骰 ' + f + ' → ' + who + ' 做庄（保留积分开新局）');
    try {
        if (typeof speak === 'function') speak(nameOf(dealer) + '庄');
    } catch (e) {}

    // 关其它弹层，保留 scores
    try {
        const rm = $('result-modal'); if (rm) rm.classList.remove('show');
        const rv = $('reveal-modal'); if (rv) rv.classList.remove('show');
        const cm = $('chi-choice-modal'); if (cm) cm.classList.remove('show');
    } catch (e) {}
    lastSettlement = null;
    winner = null;
    gameOver = false;
    selectedIndex = null;
    lastDrawnIndex = null;
    try { initGame(); } catch (e) {
        logFlow('调庄发牌失败，请三击桌面重开');
        pendingClaim = saved;
    }
}

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
