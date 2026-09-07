from pathlib import Path

js = Path('teacher-board.js')
text = js.read_text(encoding='utf-8')

old = '''  function drawingContext(canvas) {
    return canvas.getContext("2d", { desynchronized: true }) || canvas.getContext("2d");
  }'''
new = '''  function drawingContext(canvas) {
    // Keep the annotation layer genuinely transparent on Hikvision/Android.
    // Some WebViews render desynchronized transparent canvases as opaque black.
    return canvas.getContext("2d", { alpha: true }) || canvas.getContext("2d");
  }'''
if old not in text:
    raise SystemExit('drawingContext block not found')
text = text.replace(old, new, 1)

old = '''      [pdfCanvas, inkCanvas].forEach(canvas => {
        canvas.width = renderCanvas.width;
        canvas.height = renderCanvas.height;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      });'''
new = '''      [pdfCanvas, inkCanvas].forEach(canvas => {
        canvas.width = renderCanvas.width;
        canvas.height = renderCanvas.height;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      });
      // The ink canvas must stay transparent so the PDF remains visible below it.
      inkCanvas.style.background = "transparent";'''
if old not in text:
    raise SystemExit('canvas sizing block not found')
text = text.replace(old, new, 1)

old = '''    el("teacherBoardFullscreenBtn")?.addEventListener("click", toggleBoardFullscreen);
    el("teacherBoardFullscreenFloatingBtn")?.addEventListener("click", toggleBoardFullscreen);'''
new = '''    el("teacherBoardFullscreenBtn")?.addEventListener("click", toggleBoardFullscreen);
    el("teacherBoardFullscreenFloatingBtn")?.addEventListener("click", toggleBoardFullscreen);
    el("teacherBoardFullscreenToolBtn")?.addEventListener("click", toggleBoardFullscreen);'''
if old not in text:
    raise SystemExit('fullscreen binding block not found')
text = text.replace(old, new, 1)

js.write_text(text, encoding='utf-8')

html = Path('index.html')
h = html.read_text(encoding='utf-8')
old = '''          <button id="teacherBoardZoomIn" type="button" title="Zoom in">＋</button>
          <button id="teacherBoardFit" type="button" title="Fit page">Fit</button>
        </div>'''
new = '''          <button id="teacherBoardZoomIn" type="button" title="Zoom in">＋</button>
          <button id="teacherBoardFit" type="button" title="Fit page">Fit</button>
          <button id="teacherBoardFullscreenToolBtn" type="button" class="teacher-board-fullscreen-tool" title="Fullscreen">⛶ Fullscreen</button>
        </div>'''
if old not in h:
    raise SystemExit('toolbar fit block not found')
h = h.replace(old, new, 1)
html.write_text(h, encoding='utf-8')

css = Path('styles.css')
c = css.read_text(encoding='utf-8')
c = c.replace('''#teacherBoardInkCanvas,
#teacherBoardMiniCanvas{
  will-change:contents;
}
''', '', 1)
c += '''\n\n/* Teacher board Hikvision transparent ink fix v44 */
#teacherBoardInkCanvas{
  background:transparent!important;
  opacity:1!important;
  will-change:auto!important;
  transform:none!important;
  -webkit-transform:none!important;
}
.teacher-board-fullscreen-tool{
  min-width:118px!important;
  white-space:nowrap!important;
  background:#17312a!important;
  color:#fff!important;
  border-color:#17312a!important;
}
.teacher-board-floating-fullscreen{
  z-index:50!important;
}
'''
css.write_text(c, encoding='utf-8')

sw = Path('service-worker.js')
s = sw.read_text(encoding='utf-8')
if 'const CACHE = "ef-academy-v43";' not in s:
    raise SystemExit('v43 cache marker not found')
s = s.replace('const CACHE = "ef-academy-v43";', 'const CACHE = "ef-academy-v44";', 1)
sw.write_text(s, encoding='utf-8')
