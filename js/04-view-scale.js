const ORIGINAL_VIEW_SCALE = 1;
const VIEW_SCALE_MIN = 0.7; /* 最多缩到原始的 70% */
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
        logFlow('已缩小到原始大小的 80%，无法再缩');
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
}
document.addEventListener('fullscreenchange', () => {
    syncAppViewportVars();
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
    schedulePortraitGuardChecks();
});
/** 竖屏引导层：竖屏时显示提示 + 一键进入横屏；横屏时自动隐藏，不做其它处理 */
/** iOS / Android 检测 */
