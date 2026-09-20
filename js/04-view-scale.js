// ---------- 横屏自动适配开关 ----------
// true：横屏时自动算出缩放比例并上下居中，牌桌始终完整落在当前可视区域内，不用再手动"缩小到80%+上下调整"；
// false：恢复纯手动（缩放下限也回到 70%）。竖屏不受影响。
const AUTO_FIT_LANDSCAPE = true;
const AUTO_FIT_MARGIN = 4;   /* 牌桌离可视区域边缘至少留几 px（横屏最大化时为 0） */

const ORIGINAL_VIEW_SCALE = 1;
const VIEW_SCALE_MIN = AUTO_FIT_LANDSCAPE ? 0.5 : 0.7; /* 手动最多缩到原始的 70%；自动适配时放宽到 50%，给很矮的屏幕留余地 */
const VIEW_SCALE_MAX = ORIGINAL_VIEW_SCALE;
const VIEW_SCALE_STEP = 0.05;
const VIEW_SCALE_STORAGE_KEY = 'qionghu_mahjong_view_scale_v1';
const VIEW_ORIGINAL_STORAGE_KEY = 'qionghu_mahjong_view_original_v1';

let viewScale = ORIGINAL_VIEW_SCALE;
/** 启动时记录的桌面原始像素尺寸（供对照/恢复） */
let originalViewRecord = null;

function captureOriginalViewSize() {
    if (originalViewRecord) return originalViewRecord;
    const frame = document.getElementById('table-frame');
    const wrap = document.getElementById('table-wrap');
    let w = 0, h = 0;
    if (frame) {
        const r = frame.getBoundingClientRect();
        // 若当前已缩放，反推未缩放尺寸
        const s = viewScale || 1;
        w = r.width / s;
        h = r.height / s;
    }
    originalViewRecord = {
        scale: ORIGINAL_VIEW_SCALE,
        width: Math.round(w * 10) / 10,
        height: Math.round(h * 10) / 10,
        capturedAt: Date.now()
    };
    try {
        localStorage.setItem(VIEW_ORIGINAL_STORAGE_KEY, JSON.stringify(originalViewRecord));
    } catch (e) { /* ignore */ }
    return originalViewRecord;
}

function loadSavedViewScale() {
    try {
        const raw = localStorage.getItem(VIEW_SCALE_STORAGE_KEY);
        if (raw == null) return ORIGINAL_VIEW_SCALE;
        const n = parseFloat(raw);
        if (!isFinite(n)) return ORIGINAL_VIEW_SCALE;
        return Math.max(VIEW_SCALE_MIN, Math.min(VIEW_SCALE_MAX, n));
    } catch (e) {
        return ORIGINAL_VIEW_SCALE;
    }
}

function applyViewScale() {
    viewScale = Math.round(viewScale * 1000) / 1000;
    if (viewScale > VIEW_SCALE_MAX) viewScale = VIEW_SCALE_MAX;
    if (viewScale < VIEW_SCALE_MIN) viewScale = VIEW_SCALE_MIN;
    document.documentElement.style.setProperty('--view-scale', String(viewScale));
    try {
        localStorage.setItem(VIEW_SCALE_STORAGE_KEY, String(viewScale));
    } catch (e) { /* ignore */ }
    const btnIn = document.getElementById('btn-view-zoom-in');
    const btnOut = document.getElementById('btn-view-zoom-out');
    if (btnIn) btnIn.disabled = viewScale >= VIEW_SCALE_MAX - 1e-9;
    if (btnOut) btnOut.disabled = viewScale <= VIEW_SCALE_MIN + 1e-9;
    // 兜底：部分安卓 WebView 在缩放瞬间会出现"金边框已更新、内部圆角裁剪内容未同步重绘"
    // 的错位现象，这里强制触发一次重排+重绘，确保边框与桌面内容一起刷新
    const frameEl = document.getElementById('table-frame');
    const wrapEl = document.getElementById('table-wrap');
    if (frameEl) {
        void frameEl.offsetHeight; // 强制同步重排
    }
    requestAnimationFrame(() => {
        // 下一帧再强制读取一次布局尺寸，确保边框与内部内容按同一次合成结果绘制
        if (wrapEl) void wrapEl.offsetHeight;
        if (frameEl) void frameEl.offsetHeight;
    });
    setTimeout(fitBottomHand, 120);
}

/** delta: +0.05 扩大 / -0.05 缩小；相对「原始正常大小」等比缩放 */
function adjustViewScale(delta) {
    if (!originalViewRecord) captureOriginalViewSize();
    // 已达原始最大尺寸时，扩大无效
    if (delta > 0 && viewScale >= VIEW_SCALE_MAX - 1e-9) {
        logFlow('已是原始正常大小，无法再扩大');
        applyViewScale();
        return;
    }
    if (delta < 0 && viewScale <= VIEW_SCALE_MIN + 1e-9) {
        logFlow('已缩小到原始大小的 ' + Math.round(VIEW_SCALE_MIN * 100) + '%，无法再缩');
        applyViewScale();
        return;
    }
    viewScale = viewScale + delta;
    applyViewScale();
    const pct = Math.round(viewScale * 100);
    if (Math.abs(viewScale - ORIGINAL_VIEW_SCALE) < 1e-9) {
        logFlow('已恢复原始正常大小（100%）');
    } else if (delta < 0) {
        logFlow('整体（含头像）缩小至 ' + pct + '%（原始=100%）');
    } else {
        logFlow('整体（含头像）扩大至 ' + pct + '%（原始=100%）');
    }
}

/* ==================== 横屏自动适配 ====================
 * 原因：手机浏览器里 100vh 常常比真正可见的高度大（地址栏/工具栏占了一部分），
 * 牌桌又是按 vh 算尺寸并在 body 里居中，于是底部被裁掉，只能手动缩小再上下拖。
 * 做法：把牌桌临时还原成"不缩放、不平移"量出它的自然位置，再按当前真正可见的区域（visualViewport，
 *       扣掉刘海/Home 条安全区和 4px 边距）算出：缩放比例 = min(1, 可用宽/桌宽, 可用高/桌高)，
 *       平移 = 让缩放后的牌桌在可见区域里垂直居中。整个过程同步完成、关掉过渡动画，不会闪。
 * 触发：启动、旋转、窗口大小/可视区域变化、进出全屏、弹窗关闭后。
 * 手动的 缩小/扩大/拖动 仍然可用，效果保留到下一次上述事件（或刷新）为止。
 * 竖屏完全不处理。 */
let _autoFitReady = false;   // 13 启动段准备好之后才允许自动适配（避免脚本还没加载完就被 resize 事件触发）
let _autoFitTimers = [];

function syncViewScaleButtons() {
    const btnIn = document.getElementById('btn-view-zoom-in');
    const btnOut = document.getElementById('btn-view-zoom-out');
    if (btnIn) btnIn.disabled = viewScale >= VIEW_SCALE_MAX - 1e-9;
    if (btnOut) btnOut.disabled = viewScale <= VIEW_SCALE_MIN + 1e-9;
}

function autoFitLandscapeView() {
    if (!AUTO_FIT_LANDSCAPE || !_autoFitReady) return false;
    try {
        const body = document.body;
        const wrap = document.getElementById('table-wrap');
        const frame = document.getElementById('table-frame');
        if (!body || !wrap || !frame) return false;
        if (body.classList.contains('portrait-layout')) return false; // 竖屏不动
        if (typeof isPortraitOrientation === 'function' && isPortraitOrientation()) return false;
        if (body.classList.contains('modal-open')) return false;      // 弹窗打开时页面被固定，弹窗关闭后会再触发
        if (typeof panDrag !== 'undefined' && panDrag) return false;  // 正在拖动牌桌

        const root = document.documentElement.style;
        wrap.classList.add('panning');                // 关闭过渡，读到的就是最终位置而不是动画中间值
        root.setProperty('--view-scale', '1');
        root.setProperty('--view-pan-y', '0px');
        const r = frame.getBoundingClientRect();      // 自然尺寸/位置（未缩放、未平移）

        const vv = window.visualViewport;
        const vpW = (vv && vv.width) || window.innerWidth;
        const vpH = (vv && vv.height) || window.innerHeight;
        const isMax = body.classList.contains('landscape-max');
        const cs = window.getComputedStyle ? window.getComputedStyle(body) : null;
        const pad = (k) => (isMax || !cs) ? 0 : (parseFloat(cs[k]) || 0); // 非最大化时 body 的 padding 就是安全区
        const m = isMax ? 0 : AUTO_FIT_MARGIN;
        const availL = pad('paddingLeft') + m, availR = vpW - pad('paddingRight') - m;
        const availT = pad('paddingTop') + m,  availB = vpH - pad('paddingBottom') - m;

        let s = 1;
        if (r.width > 0 && r.height > 0) {
            s = Math.min(1, (availR - availL) / r.width, (availB - availT) / r.height);
        }
        if (!(s > 0)) s = 1;
        if (s > 0.995) s = 1;                         // 误差内视为刚好放得下
        s = Math.max(VIEW_SCALE_MIN, Math.round(s * 1000) / 1000);

        // 缩放以牌桌中心为原点，中心位置不变；再平移到可见区域的垂直中心
        const cy = r.top + r.height / 2;
        let pan = (availT + availB) / 2 - cy;
        if (!isFinite(pan)) pan = 0;
        pan = Math.max(-240, Math.min(240, pan));
        if (Math.abs(pan) < 0.5) pan = 0;

        viewScale = s;
        viewPanY = pan;
        root.setProperty('--view-scale', String(s));
        root.setProperty('--view-pan-y', pan.toFixed(1) + 'px');
        void wrap.offsetHeight;                       // 强制同步布局：这一帧就以最终值绘制
        requestAnimationFrame(() => wrap.classList.remove('panning'));
        syncViewScaleButtons();
        setTimeout(fitBottomHand, 60);
        return true;
    } catch (e) {
        try { document.getElementById('table-wrap').classList.remove('panning'); } catch (e2) {}
        return false;
    }
}

/** 视口刚变化时尺寸还没稳定（旋转/全屏动画），在几个时间点各量一次，最后一次为准 */
function scheduleAutoFitBurst() {
    if (!AUTO_FIT_LANDSCAPE) return;
    _autoFitTimers.forEach(clearTimeout);
    _autoFitTimers = [80, 350, 900, 1800].map(ms => setTimeout(autoFitLandscapeView, ms));
}
window.addEventListener('resize', scheduleAutoFitBurst);
window.addEventListener('orientationchange', scheduleAutoFitBurst);
window.addEventListener('pageshow', scheduleAutoFitBurst);
if (window.visualViewport && window.visualViewport.addEventListener) {
    window.visualViewport.addEventListener('resize', scheduleAutoFitBurst);
}

async function toggleLandscapeMaximize() {
    // 横屏调整 = 恢复原始正常大小 + 尽量全屏横屏
    if (!originalViewRecord) captureOriginalViewSize();
    viewScale = ORIGINAL_VIEW_SCALE;
    applyViewScale();
    applyDevicePlatformClass();
    const body = document.body;
    const ios = isIOSDevice();
    const android = isAndroidDevice();
    let fsOk = false;
    try {
        if (!ios) {
            // Android / 桌面 Chrome：Fullscreen + 锁定横屏（用户手势内调用）
            const el = document.documentElement;
            const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
            if (req && !document.fullscreenElement && !document.webkitFullscreenElement) {
                try {
                    // navigationUI: 'hide' 在 Chrome Android 可尽量隐藏系统栏
                    await req.call(el, { navigationUI: 'hide' });
                    fsOk = true;
                } catch (e) {
                    try { await req.call(el); fsOk = true; } catch (e2) {}
                }
            } else if (document.fullscreenElement || document.webkitFullscreenElement) {
                fsOk = true;
            }
            try {
                if (screen.orientation && screen.orientation.lock) {
                    // Android Chrome 支持在全屏后 lock
                    await screen.orientation.lock('landscape').catch(() =>
                        screen.orientation.lock('landscape-primary').catch(() => {})
                    );
                }
            } catch (e) {}
            if (android && !fsOk) {
                // 未进全屏时：滚动收起 Chrome 工具栏
                try { window.scrollTo(0, 1); } catch (e) {}
            }
        } else {
            try { window.scrollTo(0, 1); } catch (e) {}
        }
        body.classList.add('landscape-max');
        syncAppViewportVars();
        if (ios) {
            logFlow(isPortraitOrientation()
                ? '请横向持机；可在设置中关闭竖屏锁定'
                : '已横屏铺满（iOS 可将网页「添加到主屏幕」以隐藏地址栏）');
        } else if (android) {
            logFlow(fsOk
                ? '已全屏横屏（Android）'
                : '已横屏铺满；可再点一次尝试全屏，或「添加到主屏幕」');
        } else {
            logFlow(fsOk ? '已最大化' : '已最大化（可尝试全屏或添加到主屏幕）');
        }
    } catch (e) {
        body.classList.add('landscape-max');
        syncAppViewportVars();
        logFlow('已最大化');
    }
    if (!fsOk) {
        [60, 200, 400, 800, 1200].forEach(ms => {
            setTimeout(() => {
                try { window.scrollTo(0, 1); } catch (e) {}
                syncAppViewportVars();
                fitBottomHand();
            }, ms);
        });
    } else if (android) {
        // 全屏成功后仍同步几次，适配系统栏动画
        [100, 300, 600].forEach(ms => {
            setTimeout(() => { syncAppViewportVars(); fitBottomHand(); }, ms);
        });
    }
    setTimeout(fitBottomHand, 180);
    setTimeout(fitBottomHand, 450);
    scheduleAutoFitBurst();
}
document.addEventListener('fullscreenchange', () => {
    syncAppViewportVars();
    scheduleAutoFitBurst();
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        // 仅退出全屏时不必强制退出横屏铺满（用户可能仍横持）
        setTimeout(() => {
            syncAppViewportVars();
            fitBottomHand();
            schedulePortraitGuardChecks();
        }, 120);
    } else {
        document.body.classList.add('landscape-max');
        setTimeout(() => { syncAppViewportVars(); fitBottomHand(); }, 100);
    }
});
document.addEventListener('webkitfullscreenchange', () => {
    syncAppViewportVars();
    scheduleAutoFitBurst();
    schedulePortraitGuardChecks();
});
