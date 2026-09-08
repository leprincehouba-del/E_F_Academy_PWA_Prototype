from pathlib import Path

p = Path('teacher-board.js')
s = p.read_text(encoding='utf-8')

s = s.replace('    rasterCacheLimit: 3,', '    rasterCacheLimit: 6,', 1)

start = s.find('  function viewerMetrics(page, quality = "hd") {')
end = s.find('\n  function scheduleRender()', start)
if start < 0 or end < 0:
    raise SystemExit('render pipeline markers not found')

pipeline = r'''  function viewerMetrics(page, quality = "hd") {
    const viewer = el("teacherBoardViewer");
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(260, viewer.clientWidth - 28);
    const availableHeight = Math.max(260, viewer.clientHeight - 28);
    const fitScale = Math.min(
      availableWidth / baseViewport.width,
      availableHeight / baseViewport.height
    );
    const scale = Math.max(0.1, fitScale * state.zoom);
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));

    const preview = quality === "preview";
    const desired = preview
      ? 1
      : Math.min(2.35, Math.max(2.05, Number(window.devicePixelRatio || 1)));
    const maxPixels = preview ? 1800000 : 6800000;
    const memorySafe = Math.sqrt(maxPixels / Math.max(1, width * height));
    const pixelRatio = preview
      ? Math.max(0.9, Math.min(desired, memorySafe))
      : Math.max(1.7, Math.min(desired, memorySafe));

    return { viewport, width, height, pixelRatio };
  }

  function rasterKey(pageNumber, metrics, quality) {
    return [
      pageNumber,
      metrics.width,
      metrics.height,
      Math.round(metrics.pixelRatio * 100),
      Math.round(state.zoom * 100),
      quality
    ].join(":");
  }

  function disposeRaster(raster) {
    const canvas = raster?.canvas;
    if (!canvas || canvas === state.pageBaseCanvas) return;
    try {
      canvas.width = 1;
      canvas.height = 1;
    } catch {}
  }

  function clearRasterCache({ keepVisible = true } = {}) {
    state.rasterCache.forEach(raster => {
      if (!keepVisible || raster?.canvas !== state.pageBaseCanvas) disposeRaster(raster);
    });
    state.rasterCache.clear();
  }

  function rememberRaster(key, value) {
    const previous = state.rasterCache.get(key);
    if (previous && previous !== value) disposeRaster(previous);
    if (state.rasterCache.has(key)) state.rasterCache.delete(key);
    state.rasterCache.set(key, value);
    while (state.rasterCache.size > state.rasterCacheLimit) {
      const oldestKey = state.rasterCache.keys().next().value;
      const oldest = state.rasterCache.get(oldestKey);
      state.rasterCache.delete(oldestKey);
      disposeRaster(oldest);
    }
  }

  async function makePageRaster(pageNumber, quality = "hd", { trackCurrent = false } = {}) {
    const page = await getPdfPage(pageNumber);
    const metrics = viewerMetrics(page, quality);
    const key = rasterKey(pageNumber, metrics, quality);
    const cached = state.rasterCache.get(key);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(metrics.width * metrics.pixelRatio));
    canvas.height = Math.max(1, Math.round(metrics.height * metrics.pixelRatio));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("PDF_CANVAS_CONTEXT_UNAVAILABLE");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const task = page.render({
      canvasContext: context,
      viewport: metrics.viewport,
      background: "rgb(255,255,255)",
      transform: metrics.pixelRatio === 1
        ? null
        : [metrics.pixelRatio, 0, 0, metrics.pixelRatio, 0, 0]
    });
    if (trackCurrent) state.pdfRenderTask = task;
    await task.promise;

    const result = { canvas, ...metrics, quality, key };
    rememberRaster(key, result);
    return result;
  }

  function applyRaster(raster, strokes) {
    const pdfCanvas = el("teacherBoardPdfCanvas");
    const inkCanvas = el("teacherBoardInkCanvas");
    const wrap = el("teacherBoardCanvasWrap");
    if (!pdfCanvas || !wrap || !raster) return;

    pdfCanvas.width = raster.canvas.width;
    pdfCanvas.height = raster.canvas.height;
    pdfCanvas.style.width = `${raster.width}px`;
    pdfCanvas.style.height = `${raster.height}px`;

    if (inkCanvas) {
      inkCanvas.width = raster.canvas.width;
      inkCanvas.height = raster.canvas.height;
      inkCanvas.style.display = "none";
    }

    state.pageBaseCanvas = raster.canvas;
    wrap.style.width = `${raster.width}px`;
    wrap.style.height = `${raster.height}px`;
    state.strokes = strokes;
    state.strokesPageNumber = state.pageNumber;
    redrawInk();
    updateBookUi();
  }

  function prefetchNearbyPages() {
    clearTimeout(state.idlePrefetchTimer);
    if (!state.pdfDocument || !state.active) return;

    state.idlePrefetchTimer = setTimeout(async () => {
      if (!state.pdfDocument || !state.active || state.activeStroke || state.pdfRenderTask) return;
      const candidates = [
        state.pageNumber + 1,
        state.pageNumber - 1,
        state.pageNumber + 2
      ].filter(pageNumber => pageNumber >= 1 && pageNumber <= state.pageCount);

      for (const pageNumber of candidates) {
        if (!state.active || state.activeStroke || state.pdfRenderTask) return;
        try {
          await makePageRaster(pageNumber, "preview");
        } catch {}
      }
    }, 120);
  }

  function scheduleQualityUpgrade(token, pageNumber, strokes) {
    clearTimeout(state.qualityTimer);
    state.qualityTimer = setTimeout(async () => {
      if (
        token !== state.renderToken ||
        pageNumber !== state.pageNumber ||
        state.activeStroke
      ) return;

      try {
        const hd = await makePageRaster(pageNumber, "hd", { trackCurrent: true });
        if (
          token !== state.renderToken ||
          pageNumber !== state.pageNumber ||
          state.activeStroke
        ) return;
        applyRaster(hd, strokes);
        scheduleBookPreviewSave();
        prefetchNearbyPages();
      } catch (error) {
        if (error?.name !== "RenderingCancelledException") {
          console.warn("Teacher board HD upgrade skipped:", error);
        }
      } finally {
        if (token === state.renderToken) state.pdfRenderTask = null;
      }
    }, 35);
  }

  async function renderPage({ showLoading = false } = {}) {
    if (!state.pdfDocument || !state.currentBook) return;

    const token = ++state.renderToken;
    try { state.pdfRenderTask?.cancel?.(); } catch {}
    state.pdfRenderTask = null;

    const pageNumber = state.pageNumber;
    const hasVisiblePage = Boolean(state.pageBaseCanvas);
    if (showLoading && !hasVisiblePage) {
      setLoading(true, `Opening page ${pageNumber}…`);
    }

    try {
      const strokesPromise = loadPageStrokes(state.currentBook.id, pageNumber);
      const page = await getPdfPage(pageNumber);
      const hdMetrics = viewerMetrics(page, "hd");
      const previewMetrics = viewerMetrics(page, "preview");
      const hdKey = rasterKey(pageNumber, hdMetrics, "hd");
      const previewKey = rasterKey(pageNumber, previewMetrics, "preview");
      const strokes = await strokesPromise;
      if (token !== state.renderToken) return;

      const hdCached = state.rasterCache.get(hdKey);
      if (hdCached) {
        applyRaster(hdCached, strokes);
        scheduleBookPreviewSave();
        prefetchNearbyPages();
        return;
      }

      const previewCached = state.rasterCache.get(previewKey);
      if (previewCached) {
        applyRaster(previewCached, strokes);
        scheduleQualityUpgrade(token, pageNumber, strokes);
        return;
      }

      const preview = await makePageRaster(pageNumber, "preview", { trackCurrent: true });
      if (token !== state.renderToken) return;
      applyRaster(preview, strokes);
      state.pdfRenderTask = null;
      scheduleQualityUpgrade(token, pageNumber, strokes);
    } catch (error) {
      if (token === state.renderToken) {
        if (error?.name === "RenderingCancelledException") return;
        console.error("Teacher board page render error:", error);
        showToast("Unable to display this page");
      }
    } finally {
      if (token === state.renderToken) {
        setLoading(false);
      }
    }
  }
'''
s = s[:start] + pipeline + s[end:]

toolbar_helper = r'''
  function prepareToolbarLayout() {
    const toolbar = document.querySelector("#teacherBoard .teacher-board-toolbar");
    if (!toolbar || document.querySelector("#teacherBoard .teacher-board-nav-row")) return;

    const pageGroup = toolbar.querySelector(".teacher-board-pages");
    const zoomGroup = el("teacherBoardFit")?.closest(".teacher-board-tool-group");
    if (!pageGroup || !zoomGroup) return;

    const nav = document.createElement("div");
    nav.className = "teacher-board-nav-row";
    nav.setAttribute("role", "toolbar");
    nav.setAttribute("aria-label", "Page navigation");

    const build = document.createElement("span");
    build.className = "teacher-board-build";
    build.textContent = "V48";
    nav.append(build, pageGroup, zoomGroup);
    toolbar.parentNode.insertBefore(nav, toolbar);
  }

'''
bind_marker = '  function bindEvents() {'
if bind_marker not in s:
    raise SystemExit('bindEvents marker not found')
s = s.replace(bind_marker, toolbar_helper + bind_marker, 1)
s = s.replace('    readPointEvents();\n    bindEvents();', '    readPointEvents();\n    prepareToolbarLayout();\n    bindEvents();', 1)

fs_start = s.find('    const setPseudoFullscreen = active => {')
fs_end = s.find('\n    bindDrawingCanvas(el("teacherBoardPdfCanvas")', fs_start)
if fs_start < 0 or fs_end < 0:
    raise SystemExit('fullscreen markers not found')

fs = r'''    const setPseudoFullscreen = active => {
      const shell = el("teacherBoard")?.querySelector(".teacher-board-shell");
      if (!shell) return;
      shell.classList.toggle("teacher-board-pseudo-fullscreen", Boolean(active));
      document.body.classList.toggle("teacher-board-fullscreen-active", Boolean(active));
      const button = el("teacherBoardFullscreenToolBtn");
      if (button) button.innerHTML = active ? "✕ Exit Fullscreen" : "⛶ Fullscreen";
    };

    const toggleBoardFullscreen = () => {
      const shell = el("teacherBoard")?.querySelector(".teacher-board-shell");
      if (!shell) return;
      const active = shell.classList.contains("teacher-board-pseudo-fullscreen");
      setPseudoFullscreen(!active);
      window.scrollTo?.(0, 0);
      clearTimeout(state.renderTimer);
      state.renderTimer = setTimeout(() => {
        if (state.pdfDocument && state.active && !state.activeStroke) {
          clearRasterCache();
          renderPage({ showLoading: false });
        }
      }, 700);
    };
    el("teacherBoardFullscreenToolBtn")?.addEventListener("click", toggleBoardFullscreen);
'''
s = s[:fs_start] + fs + s[fs_end:]

old_resize = '          if (entry.target.id === "teacherBoardViewer") {\n            clearTimeout(state.renderTimer);\n            state.renderTimer = setTimeout(() => renderPage({ showLoading: false }), 220);\n          }'
if old_resize in s:
    s = s.replace(old_resize, '          if (entry.target.id === "teacherBoardViewer") { /* handled explicitly */ }', 1)
else:
    s = s.replace('          if (entry.target.id === "teacherBoardViewer") scheduleRender();', '          if (entry.target.id === "teacherBoardViewer") { /* handled explicitly */ }', 1)

p.write_text(s, encoding='utf-8')

html = Path('index.html')
h = html.read_text(encoding='utf-8')
h = h.replace('href="styles.css?v=47"', 'href="styles.css?v=48"')
h = h.replace('href="styles.css?v=46"', 'href="styles.css?v=48"')
h = h.replace('href="styles.css"', 'href="styles.css?v=48"', 1)
h = h.replace('src="teacher-board.js?v=47"', 'src="teacher-board.js?v=48"')
h = h.replace('src="teacher-board.js?v=46"', 'src="teacher-board.js?v=48"')
h = h.replace('src="teacher-board.js"', 'src="teacher-board.js?v=48"')
html.write_text(h, encoding='utf-8')

css = Path('styles.css')
c = css.read_text(encoding='utf-8')
c += r'''

/* Teacher board v48: fixed navigation + smooth classroom toolbar */
.teacher-board-main{grid-template-rows:auto auto minmax(0,1fr)!important;}
.teacher-board-nav-row{position:relative;z-index:8;display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:6px 10px;overflow-x:auto;overflow-y:hidden;direction:ltr;border-bottom:1px solid #cbd7d2;background:#eef4f1;-webkit-overflow-scrolling:touch;}
.teacher-board-nav-row .teacher-board-tool-group{flex:none;}
.teacher-board-build{flex:none;padding:5px 8px;border-radius:8px;background:#17312a;color:#fff;font-size:11px;font-weight:900;letter-spacing:.3px;}
.teacher-board-toolbar{justify-content:flex-start!important;direction:ltr!important;overflow-x:auto!important;overflow-y:hidden!important;padding-inline:10px!important;touch-action:pan-x!important;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;}
.teacher-board-toolbar .teacher-board-tool-group{direction:rtl;}
.teacher-board-nav-row #teacherBoardPageNumber{width:78px!important;min-width:78px!important;}
.teacher-board-pseudo-fullscreen .teacher-board-nav-row,.teacher-board-pseudo-fullscreen .teacher-board-toolbar{flex:none;}
#teacherBoardPdfCanvas{image-rendering:auto!important;}
'''
css.write_text(c, encoding='utf-8')

sw = Path('service-worker.js')
w = sw.read_text(encoding='utf-8')
w = w.replace('const CACHE = "ef-academy-v47";', 'const CACHE = "ef-academy-v48";', 1)
sw.write_text(w, encoding='utf-8')
