from pathlib import Path

js = Path('teacher-board.js')
text = js.read_text(encoding='utf-8')

old = '''      const renderContext = renderCanvas.getContext("2d", { alpha: false });
      state.pdfRenderTask = page.render({
        canvasContext: renderContext,
        viewport,
        transform: pixelRatio === 1
          ? null
          : [pixelRatio, 0, 0, pixelRatio, 0, 0]
      });'''
new = '''      const renderContext = renderCanvas.getContext("2d", { alpha: false });
      if (!renderContext) throw new Error("PDF_CANVAS_CONTEXT_UNAVAILABLE");
      renderContext.save();
      renderContext.fillStyle = "#ffffff";
      renderContext.fillRect(0, 0, renderCanvas.width, renderCanvas.height);
      renderContext.restore();
      state.pdfRenderTask = page.render({
        canvasContext: renderContext,
        viewport,
        background: "rgb(255,255,255)",
        transform: pixelRatio === 1
          ? null
          : [pixelRatio, 0, 0, pixelRatio, 0, 0]
      });'''
if old not in text:
    raise SystemExit('render block not found')
text = text.replace(old, new, 1)

old = '''      const pdfContext = pdfCanvas.getContext("2d", { alpha: false });
      pdfContext.setTransform(1, 0, 0, 1, 0, 0);
      pdfContext.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
      pdfContext.drawImage(renderCanvas, 0, 0);'''
new = '''      const pdfContext = pdfCanvas.getContext("2d", { alpha: false });
      if (!pdfContext) throw new Error("PDF_DISPLAY_CONTEXT_UNAVAILABLE");
      pdfContext.setTransform(1, 0, 0, 1, 0, 0);
      pdfContext.fillStyle = "#ffffff";
      pdfContext.fillRect(0, 0, pdfCanvas.width, pdfCanvas.height);
      pdfContext.drawImage(renderCanvas, 0, 0);'''
if old not in text:
    raise SystemExit('display canvas block not found')
text = text.replace(old, new, 1)

marker = '    const hasPdf = Boolean(state.pdfDocument);\n'
addition = '''    const hasPdf = Boolean(state.pdfDocument);
    if (el("teacherBoardRemovePdfBtn")) {
      el("teacherBoardRemovePdfBtn").disabled = !state.currentBook;
    }
    if (el("teacherBoardGoPage")) {
      el("teacherBoardGoPage").disabled = !hasPdf;
    }
'''
if marker not in text:
    raise SystemExit('hasPdf marker not found')
text = text.replace(marker, addition, 1)

marker = '''    el("teacherBoardLibraryBtn")?.addEventListener("click", () => setLibraryOpen(true));
    el("teacherBoardWelcomeLibrary")?.addEventListener("click", () => setLibraryOpen(true));
    el("teacherBoardLibraryClose")?.addEventListener("click", () => setLibraryOpen(false));
    el("teacherBoardPdfInput")?.addEventListener("change", event => importPdf(event.target.files?.[0]));
'''
addition = '''    el("teacherBoardLibraryBtn")?.addEventListener("click", () => setLibraryOpen(true));
    el("teacherBoardWelcomeLibrary")?.addEventListener("click", () => setLibraryOpen(true));
    el("teacherBoardLibraryClose")?.addEventListener("click", () => setLibraryOpen(false));
    el("teacherBoardAddPdfBtn")?.addEventListener("click", () => {
      el("teacherBoardPdfInput")?.click();
    });
    el("teacherBoardRemovePdfBtn")?.addEventListener("click", () => {
      if (state.currentBook?.id) deleteBook(state.currentBook.id);
    });
    el("teacherBoardPdfInput")?.addEventListener("change", event => importPdf(event.target.files?.[0]));
'''
if marker not in text:
    raise SystemExit('bind library marker not found')
text = text.replace(marker, addition, 1)

marker = '''    el("teacherBoardPrevPage")?.addEventListener("click", () => goToPage(state.pageNumber - 1));
    el("teacherBoardNextPage")?.addEventListener("click", () => goToPage(state.pageNumber + 1));
    el("teacherBoardPageNumber")?.addEventListener("change", event => goToPage(event.target.value));
'''
addition = '''    el("teacherBoardPrevPage")?.addEventListener("click", () => goToPage(state.pageNumber - 1));
    el("teacherBoardNextPage")?.addEventListener("click", () => goToPage(state.pageNumber + 1));
    el("teacherBoardPageNumber")?.addEventListener("change", event => goToPage(event.target.value));
    el("teacherBoardPageNumber")?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        goToPage(event.target.value);
      }
    });
    el("teacherBoardGoPage")?.addEventListener("click", () => {
      goToPage(el("teacherBoardPageNumber")?.value);
    });
'''
if marker not in text:
    raise SystemExit('page controls marker not found')
text = text.replace(marker, addition, 1)
js.write_text(text, encoding='utf-8')

html = Path('index.html')
text = html.read_text(encoding='utf-8')
old = '''      <div class="teacher-board-header-actions">
        <button id="teacherBoardLibraryBtn" type="button" class="secondary-btn">📚 <span>Library</span></button>
        <button id="teacherBoardStudentsBtn" type="button" class="secondary-btn">👨‍🎓 <span>Students</span></button>
        <button id="teacherBoardFullscreenBtn" type="button" class="secondary-btn" title="ملء الشاشة">⛶ <span>Fullscreen</span></button>
      </div>'''
new = '''      <div class="teacher-board-header-actions">
        <button id="teacherBoardLibraryBtn" type="button" class="secondary-btn">📚 <span>PDF Library</span></button>
        <button id="teacherBoardAddPdfBtn" type="button" class="secondary-btn">➕ <span>Add PDF</span></button>
        <button id="teacherBoardRemovePdfBtn" type="button" class="secondary-btn" disabled>🗑 <span>Remove PDF</span></button>
        <button id="teacherBoardStudentsBtn" type="button" class="secondary-btn">👨‍🎓 <span>Students</span></button>
        <button id="teacherBoardFullscreenBtn" type="button" class="secondary-btn" title="ملء الشاشة">⛶ <span>Fullscreen</span></button>
      </div>'''
if old not in text:
    raise SystemExit('header actions block not found')
text = text.replace(old, new, 1)

old = '''          <label>
            صفحة
            <input id="teacherBoardPageNumber" type="number" min="1" value="1">
          </label>
          <span id="teacherBoardPageCount">/ 0</span>
          <button id="teacherBoardNextPage" type="button" title="الصفحة التالية">◀</button>'''
new = '''          <label>
            Page
            <input id="teacherBoardPageNumber" type="number" min="1" value="1">
          </label>
          <span id="teacherBoardPageCount">/ 0</span>
          <button id="teacherBoardGoPage" type="button" title="Go to page" disabled>Go</button>
          <button id="teacherBoardNextPage" type="button" title="الصفحة التالية">◀</button>'''
if old not in text:
    raise SystemExit('page toolbar block not found')
text = text.replace(old, new, 1)
html.write_text(text, encoding='utf-8')

sw = Path('service-worker.js')
text = sw.read_text(encoding='utf-8')
if 'const CACHE = "ef-academy-v41";' not in text:
    raise SystemExit('service worker cache marker not found')
text = text.replace('const CACHE = "ef-academy-v41";', 'const CACHE = "ef-academy-v42";', 1)
sw.write_text(text, encoding='utf-8')
