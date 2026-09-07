from pathlib import Path

js=Path('teacher-board.js')
t=js.read_text(encoding='utf-8')
repls=[]
repls.append(('      const loadingTask = pdfjs.getDocument({ url: objectUrl });', '''      const loadingTask = pdfjs.getDocument({
        url: objectUrl,
        isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false
      });'''))
repls.append(('''      const deviceRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const safeRatio = Math.sqrt(16_000_000 / Math.max(1, width * height));
      const pixelRatio = Math.min(deviceRatio, Math.max(0.5, safeRatio));''', '''      const pixelRatio = 1;'''))
repls.append(('      el("teacherBoardPageCount").textContent = `/ ${state.pageCount}`;', '      el("teacherBoardPageCount").textContent = `of ${state.pageCount}`;'))
repls.append(('''    el("teacherBoardRemovePdfBtn")?.addEventListener("click", () => {
      if (state.currentBook?.id) deleteBook(state.currentBook.id);
    });''', '''    el("teacherBoardRemovePdfBtn")?.addEventListener("click", event => {
      if (state.currentBook?.id) deleteBook(state.currentBook.id, event.currentTarget);
    });'''))
repls.append(('      button.addEventListener("click", () => deleteBook(button.dataset.deleteBook));', '      button.addEventListener("click", () => deleteBook(button.dataset.deleteBook, button));'))
for old,new in repls:
    if old not in t: raise SystemExit('missing marker: '+old[:60])
    t=t.replace(old,new,1)
old='''  async function deleteBook(bookId) {
    const book = state.books.find(item => item.id === bookId);
    if (!book) return;

    if (!window.confirm(`حذف «${book.title}» وكتابته المحفوظة من هذه السبورة؟`)) {
      return;
    }

    try {
      if (state.currentBook?.id === bookId) await closeCurrentBook();
      await deleteBookData(bookId);
      const lastBookSetting = await dbGet("settings", "lastBookId");
      if (lastBookSetting?.value === bookId) {
        await dbDelete("settings", "lastBookId");
      }
      state.books = state.books.filter(item => item.id !== bookId);
      renderBooks();
      await updateStorageInfo();
      showToast("تم حذف الكتاب من هذه السبورة");
    } catch (error) {
      console.error("Teacher board book delete error:", error);
      showToast("تعذر حذف الكتاب");
    }
  }'''
new='''  let removePdfArmedId = "";
  let removePdfArmedUntil = 0;

  async function deleteBook(bookId, sourceButton = null) {
    let book = state.books.find(item => item.id === bookId);
    if (!book && state.currentBook?.id === bookId) book = state.currentBook;
    if (!book) book = await dbGet("books", bookId);
    if (!book) { showToast("PDF not found on this board"); return; }

    const now = Date.now();
    if (removePdfArmedId !== bookId || now > removePdfArmedUntil) {
      removePdfArmedId = bookId;
      removePdfArmedUntil = now + 4000;
      if (sourceButton) {
        sourceButton.dataset.originalLabel = sourceButton.innerHTML;
        sourceButton.innerHTML = "⚠ Confirm Remove";
      }
      showToast("اضغط Remove PDF مرة ثانية خلال 4 ثوانٍ للتأكيد");
      setTimeout(() => {
        if (Date.now() <= removePdfArmedUntil) return;
        removePdfArmedId = "";
        if (sourceButton?.dataset.originalLabel) {
          sourceButton.innerHTML = sourceButton.dataset.originalLabel;
          delete sourceButton.dataset.originalLabel;
        }
      }, 4200);
      return;
    }
    removePdfArmedId = "";
    removePdfArmedUntil = 0;
    try {
      if (state.currentBook?.id === bookId) await closeCurrentBook();
      await deleteBookData(bookId);
      const lastBookSetting = await dbGet("settings", "lastBookId");
      if (lastBookSetting?.value === bookId) await dbDelete("settings", "lastBookId");
      state.books = state.books.filter(item => item.id !== bookId);
      renderBooks();
      await updateStorageInfo();
      showToast("PDF removed from this board");
    } catch (error) {
      console.error("Teacher board book delete error:", error);
      showToast("Unable to remove PDF");
    } finally {
      if (sourceButton?.dataset.originalLabel) {
        sourceButton.innerHTML = sourceButton.dataset.originalLabel;
        delete sourceButton.dataset.originalLabel;
      }
    }
  }'''
if old not in t: raise SystemExit('missing delete block')
t=t.replace(old,new,1)
old='''    el("teacherBoardFullscreenBtn")?.addEventListener("click", async () => {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else {
          await el("teacherBoard").querySelector(".teacher-board-shell").requestFullscreen();
          const orientationLock = screen.orientation?.lock?.("landscape");
          await orientationLock?.catch?.(() => {});
        }
      } catch {
        showToast("المتصفح لا يسمح بملء الشاشة الآن");
      }
    });'''
new='''    const toggleBoardFullscreen = async () => {
      const shell = el("teacherBoard")?.querySelector(".teacher-board-shell");
      if (!shell) return;
      const pseudoActive = shell.classList.contains("teacher-board-pseudo-fullscreen");
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (pseudoActive) {
          shell.classList.remove("teacher-board-pseudo-fullscreen");
          document.body.classList.remove("teacher-board-fullscreen-active");
        } else if (typeof shell.requestFullscreen === "function") {
          await shell.requestFullscreen();
          const orientationLock = screen.orientation?.lock?.("landscape");
          await orientationLock?.catch?.(() => {});
        } else {
          shell.classList.add("teacher-board-pseudo-fullscreen");
          document.body.classList.add("teacher-board-fullscreen-active");
        }
      } catch {
        shell.classList.toggle("teacher-board-pseudo-fullscreen");
        document.body.classList.toggle("teacher-board-fullscreen-active", shell.classList.contains("teacher-board-pseudo-fullscreen"));
      }
      setTimeout(() => scheduleRender(), 80);
    };
    el("teacherBoardFullscreenBtn")?.addEventListener("click", toggleBoardFullscreen);
    el("teacherBoardFullscreenFloatingBtn")?.addEventListener("click", toggleBoardFullscreen);
    document.addEventListener("fullscreenchange", () => setTimeout(() => scheduleRender(), 80));'''
if old not in t: raise SystemExit('missing fullscreen block')
t=t.replace(old,new,1)
js.write_text(t,encoding='utf-8')

html=Path('index.html'); h=html.read_text(encoding='utf-8')
old='''      <div id="teacherBoardViewer" class="teacher-board-viewer">
        <div id="teacherBoardWelcome" class="teacher-board-welcome">'''
new='''      <div id="teacherBoardViewer" class="teacher-board-viewer">
        <button id="teacherBoardFullscreenFloatingBtn" type="button" class="teacher-board-floating-fullscreen" title="Fullscreen">⛶ Fullscreen</button>
        <div id="teacherBoardWelcome" class="teacher-board-welcome">'''
if old not in h: raise SystemExit('missing viewer marker')
h=h.replace(old,new,1)
if '<span id="teacherBoardPageCount">/ 0</span>' not in h: raise SystemExit('missing page count html')
h=h.replace('<span id="teacherBoardPageCount">/ 0</span>','<span id="teacherBoardPageCount">of 0</span>',1)
html.write_text(h,encoding='utf-8')

css=Path('styles.css'); c=css.read_text(encoding='utf-8')
c+='''\n\n/* Teacher board Hikvision compatibility v43 */\n.teacher-board-pages{direction:ltr!important;align-items:center!important;}\n.teacher-board-pages label{direction:ltr!important;display:flex!important;align-items:center!important;gap:6px!important;margin:0!important;}\n#teacherBoardPageNumber{width:86px!important;min-width:86px!important;text-align:center!important;direction:ltr!important;}\n#teacherBoardPageCount{min-width:62px;text-align:center;direction:ltr;white-space:nowrap;}\n#teacherBoardGoPage{min-width:54px;}\n.teacher-board-viewer{position:relative;}\n.teacher-board-floating-fullscreen{position:absolute;left:10px;top:10px;z-index:18;border:1px solid rgba(255,255,255,.55);background:rgba(15,38,32,.82);color:#fff;border-radius:12px;padding:9px 12px;font-weight:800;box-shadow:0 6px 18px rgba(0,0,0,.18);}\n.teacher-board-pseudo-fullscreen{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:99999!important;border-radius:0!important;margin:0!important;}\nbody.teacher-board-fullscreen-active{overflow:hidden!important;}\n@media(max-width:1100px){.teacher-board-header-actions{flex-wrap:wrap!important;}.teacher-board-floating-fullscreen{display:block!important;}}\n'''
css.write_text(c,encoding='utf-8')

sw=Path('service-worker.js'); s=sw.read_text(encoding='utf-8')
if 'const CACHE = "ef-academy-v42";' not in s: raise SystemExit('missing cache marker')
s=s.replace('const CACHE = "ef-academy-v42";','const CACHE = "ef-academy-v43";',1)
sw.write_text(s,encoding='utf-8')
