(function () {
  "use strict";

  const DB_NAME = "ef_teacher_board_v1";
  const DB_VERSION = 1;
  const POINT_QUEUE_KEY = "ef_teacher_board_points_v1";
  const PDF_MODULE_URL =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs";
  const PDF_WORKER_URL =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs";
  const POINT_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;

  const state = {
    initialized: false,
    active: false,
    db: null,
    books: [],
    currentBook: null,
    pdfDocument: null,
    pdfObjectUrl: "",
    pdfModulePromise: null,
    pageNumber: 1,
    pageCount: 0,
    zoom: 1,
    mode: "pen",
    color: "#e53935",
    width: 5,
    strokes: [],
    strokesPageNumber: 0,
    activeStroke: null,
    bookOpenToken: 0,
    renderToken: 0,
    pdfRenderTask: null,
    renderTimer: null,
    saveTimer: null,
    miniSaveTimer: null,
    miniStrokes: [],
    miniKey: "",
    miniActiveStroke: null,
    pointEvents: [],
    pointSyncing: false,
    pointSyncingIds: new Set(),
    lastPointStudentId: "",
    audioContext: null
  };

  const el = id => document.getElementById(id);

  function safeText(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function makeId() {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} بايت`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} كيلوبايت`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} ميجابايت`;
    return `${(value / 1024 ** 3).toFixed(1)} جيجابايت`;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("DB_ABORTED"));
    });
  }

  function openDatabase() {
    if (state.db) return Promise.resolve(state.db);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains("books")) {
          const booksStore = database.createObjectStore("books", {
            keyPath: "id"
          });
          booksStore.createIndex("createdAt", "createdAt");
        }

        if (!database.objectStoreNames.contains("annotations")) {
          const annotationsStore = database.createObjectStore("annotations", {
            keyPath: "key"
          });
          annotationsStore.createIndex("bookId", "bookId");
        }

        if (!database.objectStoreNames.contains("miniBoards")) {
          database.createObjectStore("miniBoards", { keyPath: "key" });
        }

        if (!database.objectStoreNames.contains("settings")) {
          database.createObjectStore("settings", { keyPath: "key" });
        }
      };

      request.onsuccess = () => {
        state.db = request.result;
        state.db.onversionchange = () => state.db.close();
        resolve(state.db);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function dbGet(storeName, key) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    return requestResult(transaction.objectStore(storeName).get(key));
  }

  async function dbGetAll(storeName) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    return requestResult(transaction.objectStore(storeName).getAll());
  }

  async function dbPut(storeName, value) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
  }

  async function dbDelete(storeName, key) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
  }

  async function deleteBookData(bookId) {
    const database = await openDatabase();
    const transaction = database.transaction(
      ["books", "annotations", "miniBoards"],
      "readwrite"
    );

    transaction.objectStore("books").delete(bookId);

    const annotationStore = transaction.objectStore("annotations");
    const annotationCursor = annotationStore.index("bookId").openCursor(bookId);
    annotationCursor.onsuccess = () => {
      const cursor = annotationCursor.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };

    const miniStore = transaction.objectStore("miniBoards");
    const miniCursor = miniStore.openCursor();
    miniCursor.onsuccess = () => {
      const cursor = miniCursor.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(`${bookId}:`)) cursor.delete();
      cursor.continue();
    };

    await transactionDone(transaction);
  }

  async function updateStorageInfo() {
    const target = el("teacherBoardStorageInfo");
    if (!target) return;

    try {
      if (navigator.storage?.persist) {
        await navigator.storage.persist();
      }

      const estimate = await navigator.storage?.estimate?.();
      if (!estimate?.quota) return;

      const used = formatBytes(estimate.usage || 0);
      const free = formatBytes(Math.max(0, estimate.quota - (estimate.usage || 0)));
      target.textContent = `المستخدم على الجهاز: ${used} — المساحة المتاحة تقريبًا: ${free}`;
    } catch (error) {
      console.warn("Teacher board storage estimate error:", error);
    }
  }

  async function hasSpaceFor(file) {
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (!estimate?.quota) return true;
      const free = estimate.quota - (estimate.usage || 0);
      return file.size < Math.max(0, free * 0.9);
    } catch {
      return true;
    }
  }

  function annotationKey(bookId, pageNumber) {
    return `${bookId}:${pageNumber}`;
  }

  function currentMiniKey() {
    const bookId = state.currentBook?.id || "no-book";
    const groupId = el("teacherBoardGroup")?.value || "no-group";
    const date = el("teacherBoardDate")?.value || "no-date";
    return `${bookId}:${groupId}:${date}`;
  }

  async function loadBooks() {
    state.books = (await dbGetAll("books"))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    renderBooks();
  }

  function renderBooks() {
    const target = el("teacherBoardBooks");
    if (!target) return;

    const query = String(el("teacherBoardBookSearch")?.value || "")
      .trim()
      .toLowerCase();
    const visibleBooks = query
      ? state.books.filter(book =>
          [book.title, book.category, book.level, book.academicYear, book.fileName]
            .some(value => String(value || "").toLowerCase().includes(query))
        )
      : state.books;

    if (!visibleBooks.length) {
      target.innerHTML =
        `<div class="teacher-board-empty-small">${
          state.books.length ? "لا توجد نتيجة مطابقة للبحث." : "لا توجد كتب محفوظة بعد."
        }</div>`;
      return;
    }

    target.innerHTML = visibleBooks.map(book => `
      <article class="teacher-board-book-card ${
        state.currentBook?.id === book.id ? "current" : ""
      }" data-book-id="${safeText(book.id)}">
        <button type="button" class="teacher-board-book-open" data-open-book="${safeText(book.id)}">
          <strong>${safeText(book.title)}</strong>
          <small>${[
            book.category || "عام",
            book.level,
            book.academicYear,
            formatBytes(book.size),
            book.pageCount ? `${book.pageCount} صفحة` : ""
          ].filter(Boolean).map(safeText).join(" — ")}</small>
        </button>
        <button type="button" class="teacher-board-book-delete" data-delete-book="${safeText(book.id)}" title="حذف الكتاب">🗑</button>
      </article>
    `).join("");

    target.querySelectorAll("[data-open-book]").forEach(button => {
      button.addEventListener("click", () => openBookById(button.dataset.openBook));
    });

    target.querySelectorAll("[data-delete-book]").forEach(button => {
      button.addEventListener("click", () => deleteBook(button.dataset.deleteBook));
    });
  }

  function setLibraryOpen(open) {
    const library = el("teacherBoardLibrary");
    if (!library) return;
    library.classList.toggle("open", Boolean(open));
    library.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      loadBooks().catch(handleStorageError);
      updateStorageInfo();
    }
  }

  async function importPdf(file) {
    if (!file) return;

    const isPdf =
      file.type === "application/pdf" ||
      String(file.name || "").toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      showToast("اختر ملف PDF فقط");
      return;
    }

    if (!(await hasSpaceFor(file))) {
      showToast("مساحة الجهاز لا تكفي لحفظ هذا الكتاب — احذف كتابًا قديمًا أو وفر مساحة");
      return;
    }

    const inputTitle = String(el("teacherBoardBookName")?.value || "").trim();
    const title = inputTitle || String(file.name).replace(/\.pdf$/i, "");
    const category = el("teacherBoardBookCategory")?.value || "عام";
    const level = String(el("teacherBoardBookLevel")?.value || "").trim();
    const academicYear = String(el("teacherBoardBookYear")?.value || "").trim();
    const buttonLabel = document.querySelector(".teacher-board-file-label");

    if (buttonLabel) buttonLabel.firstChild.textContent = "جارٍ حفظ الكتاب… ";

    try {
      const book = {
        id: makeId(),
        title,
        category,
        level,
        academicYear,
        fileName: file.name,
        mimeType: "application/pdf",
        size: file.size,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastPage: 1,
        pageCount: 0,
        file
      };

      await dbPut("books", book);
      state.books.unshift(book);
      renderBooks();
      if (el("teacherBoardBookName")) el("teacherBoardBookName").value = "";
      if (el("teacherBoardPdfInput")) el("teacherBoardPdfInput").value = "";
      await openBook(book);
      setLibraryOpen(false);
      showToast("تم حفظ الكتاب كاملًا على السبورة");
      await updateStorageInfo();
    } catch (error) {
      console.error("Teacher board PDF save error:", error);
      showToast(
        error?.name === "QuotaExceededError"
          ? "مساحة التخزين لا تكفي لهذا الكتاب"
          : "تعذر حفظ الكتاب على الجهاز"
      );
    } finally {
      if (el("teacherBoardPdfInput")) el("teacherBoardPdfInput").value = "";
      if (buttonLabel) buttonLabel.firstChild.textContent = "اختيار كتاب PDF كامل ";
    }
  }

  async function deleteBook(bookId) {
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
  }

  async function loadPdfModule() {
    if (!state.pdfModulePromise) {
      state.pdfModulePromise = import(PDF_MODULE_URL).then(pdfjs => {
        pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        return pdfjs;
      });
    }
    return state.pdfModulePromise;
  }

  function setLoading(loading, message = "جارٍ فتح الكتاب…") {
    const loadingBox = el("teacherBoardLoading");
    if (loadingBox) {
      loadingBox.textContent = message;
      loadingBox.classList.toggle("hidden", !loading);
    }
  }

  async function openBookById(bookId) {
    try {
      const book = await dbGet("books", bookId);
      if (!book) {
        showToast("لم يتم العثور على الكتاب على هذا الجهاز");
        return;
      }
      await openBook(book);
      setLibraryOpen(false);
    } catch (error) {
      handleStorageError(error);
    }
  }

  async function closeCurrentBook() {
    state.bookOpenToken += 1;
    state.renderToken += 1;
    clearTimeout(state.renderTimer);
    clearTimeout(state.saveTimer);
    try { state.pdfRenderTask?.cancel?.(); } catch {}
    state.pdfRenderTask = null;
    await saveCurrentAnnotation(true).catch(() => {});
    await saveMiniBoard(true).catch(() => {});

    if (state.pdfDocument) {
      try {
        await state.pdfDocument.destroy();
      } catch {}
    }

    if (state.pdfObjectUrl) URL.revokeObjectURL(state.pdfObjectUrl);

    state.pdfDocument = null;
    state.pdfObjectUrl = "";
    state.currentBook = null;
    state.pageNumber = 1;
    state.pageCount = 0;
    state.strokes = [];
    state.strokesPageNumber = 0;
    updateBookUi();
  }

  async function openBook(book) {
    if (!book?.file) {
      showToast("ملف الكتاب غير موجود على هذه السبورة");
      return;
    }

    await closeCurrentBook();
    const openToken = ++state.bookOpenToken;
    state.currentBook = book;
    state.pageNumber = Math.max(1, Number(book.lastPage || 1));
    state.zoom = 1;
    updateBookUi();
    setLoading(true, "جارٍ فتح الكتاب كاملًا…");
    el("teacherBoardWelcome")?.classList.add("hidden");

    try {
      const pdfjs = await loadPdfModule();
      const objectUrl = URL.createObjectURL(book.file);
      const loadingTask = pdfjs.getDocument({ url: objectUrl });
      const pdfDocument = await loadingTask.promise;

      if (openToken !== state.bookOpenToken) {
        await pdfDocument.destroy().catch(() => {});
        URL.revokeObjectURL(objectUrl);
        return;
      }

      state.pdfObjectUrl = objectUrl;
      state.pdfDocument = pdfDocument;
      state.pageCount = state.pdfDocument.numPages;
      state.pageNumber = Math.min(state.pageNumber, state.pageCount);

      book.pageCount = state.pageCount;
      book.lastPage = state.pageNumber;
      book.updatedAt = new Date().toISOString();
      await dbPut("books", book);
      await dbPut("settings", {
        key: "lastBookId",
        value: book.id,
        updatedAt: new Date().toISOString()
      });
      state.books = state.books.map(item => item.id === book.id ? book : item);
      renderBooks();
      await loadMiniBoard();
      await renderPage();
      showToast(`تم فتح الكتاب — ${state.pageCount} صفحة`);
    } catch (error) {
      if (openToken !== state.bookOpenToken) return;
      console.error("Teacher board PDF open error:", error);
      setLoading(false);
      await closeCurrentBook();
      el("teacherBoardWelcome")?.classList.remove("hidden");
      showToast("تعذر فتح ملف PDF — تأكد أن الملف سليم وأن الإنترنت متاح أول مرة");
    } finally {
      if (openToken === state.bookOpenToken) setLoading(false);
    }
  }

  function updateBookUi() {
    const title = el("teacherBoardBookTitle");
    if (title) {
      title.textContent = state.currentBook?.title || "اختر كتابًا من المكتبة";
    }

    if (el("teacherBoardPageNumber")) {
      el("teacherBoardPageNumber").value = String(state.pageNumber);
      el("teacherBoardPageNumber").max = String(Math.max(1, state.pageCount));
    }
    if (el("teacherBoardPageCount")) {
      el("teacherBoardPageCount").textContent = `/ ${state.pageCount}`;
    }
    if (el("teacherBoardZoomText")) {
      el("teacherBoardZoomText").textContent = `${Math.round(state.zoom * 100)}%`;
    }

    const hasPdf = Boolean(state.pdfDocument);
    [
      "teacherBoardPrevPage",
      "teacherBoardNextPage",
      "teacherBoardPageNumber",
      "teacherBoardZoomOut",
      "teacherBoardZoomIn",
      "teacherBoardFit",
      "teacherBoardUndo",
      "teacherBoardClearPage"
    ].forEach(id => {
      if (el(id)) el(id).disabled = !hasPdf;
    });

    if (el("teacherBoardPrevPage")) {
      el("teacherBoardPrevPage").disabled = !hasPdf || state.pageNumber <= 1;
    }
    if (el("teacherBoardNextPage")) {
      el("teacherBoardNextPage").disabled = !hasPdf || state.pageNumber >= state.pageCount;
    }

    el("teacherBoardCanvasWrap")?.classList.toggle("hidden", !hasPdf);
    if (!hasPdf) el("teacherBoardWelcome")?.classList.remove("hidden");
  }

  async function loadPageStrokes(bookId, pageNumber) {
    const record = await dbGet("annotations", annotationKey(bookId, pageNumber));
    return Array.isArray(record?.strokes) ? record.strokes : [];
  }

  async function saveCurrentAnnotation(immediate = false) {
    clearTimeout(state.saveTimer);
    if (!state.currentBook || !state.strokesPageNumber) return;

    const record = {
      key: annotationKey(state.currentBook.id, state.strokesPageNumber),
      bookId: state.currentBook.id,
      pageNumber: state.strokesPageNumber,
      strokes: state.strokes,
      updatedAt: new Date().toISOString()
    };

    const saveAction = async () => {
      const saveState = el("teacherBoardSaveState");
      if (saveState) saveState.textContent = "جارٍ حفظ الكتابة…";
      await dbPut("annotations", record);
      if (saveState) saveState.textContent = "تم حفظ كتابة هذه الصفحة تلقائيًا";
    };

    if (immediate) return saveAction();
    state.saveTimer = setTimeout(() => saveAction().catch(handleStorageError), 180);
  }

  async function updateBookLastPage() {
    if (!state.currentBook) return;
    state.currentBook.lastPage = state.pageNumber;
    state.currentBook.updatedAt = new Date().toISOString();
    await dbPut("books", state.currentBook);
  }

  async function renderPage() {
    if (!state.pdfDocument || !state.currentBook) return;

    const token = ++state.renderToken;
    try { state.pdfRenderTask?.cancel?.(); } catch {}
    state.pdfRenderTask = null;
    setLoading(true, `جارٍ عرض الصفحة ${state.pageNumber}…`);

    try {
      const [page, strokes] = await Promise.all([
        state.pdfDocument.getPage(state.pageNumber),
        loadPageStrokes(state.currentBook.id, state.pageNumber)
      ]);

      if (token !== state.renderToken) return;

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
      const pdfCanvas = el("teacherBoardPdfCanvas");
      const inkCanvas = el("teacherBoardInkCanvas");
      const wrap = el("teacherBoardCanvasWrap");
      const width = Math.round(viewport.width);
      const height = Math.round(viewport.height);
      const deviceRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const safeRatio = Math.sqrt(16_000_000 / Math.max(1, width * height));
      const pixelRatio = Math.min(deviceRatio, Math.max(0.5, safeRatio));

      [pdfCanvas, inkCanvas].forEach(canvas => {
        canvas.width = Math.max(1, Math.round(width * pixelRatio));
        canvas.height = Math.max(1, Math.round(height * pixelRatio));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      });
      wrap.style.width = `${width}px`;
      wrap.style.height = `${height}px`;

      const pdfContext = pdfCanvas.getContext("2d", { alpha: false });
      state.pdfRenderTask = page.render({
        canvasContext: pdfContext,
        viewport,
        transform: pixelRatio === 1
          ? null
          : [pixelRatio, 0, 0, pixelRatio, 0, 0]
      });
      await state.pdfRenderTask.promise;

      if (token !== state.renderToken) return;

      state.strokes = strokes;
      state.strokesPageNumber = state.pageNumber;
      redrawInk();
      updateBookUi();
      updateBookLastPage().catch(handleStorageError);
    } catch (error) {
      if (token === state.renderToken) {
        if (error?.name === "RenderingCancelledException") return;
        console.error("Teacher board page render error:", error);
        showToast("تعذر عرض هذه الصفحة");
      }
    } finally {
      if (token === state.renderToken) {
        state.pdfRenderTask = null;
        setLoading(false);
      }
    }
  }

  function scheduleRender() {
    if (!state.pdfDocument || !state.active) return;
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(async () => {
      if (state.activeStroke) {
        scheduleRender();
        return;
      }
      await saveCurrentAnnotation(true).catch(handleStorageError);
      renderPage();
    }, 180);
  }

  async function goToPage(nextPage) {
    if (!state.pdfDocument) return;
    const pageNumber = Math.min(
      state.pageCount,
      Math.max(1, Math.trunc(Number(nextPage) || 1))
    );
    if (pageNumber === state.pageNumber) {
      updateBookUi();
      return;
    }

    await saveCurrentAnnotation(true).catch(handleStorageError);
    state.pageNumber = pageNumber;
    state.activeStroke = null;
    await renderPage();
  }

  function canvasPoint(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    };
  }

  function drawStroke(context, stroke, cssWidth, cssHeight) {
    const points = stroke?.points || [];
    if (!points.length) return;

    context.save();
    context.globalCompositeOperation =
      stroke.tool === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = stroke.color || "#e53935";
    context.fillStyle = stroke.color || "#e53935";
    context.lineWidth = Math.max(1, Number(stroke.widthNorm || 0.006) * cssWidth);
    context.lineCap = "round";
    context.lineJoin = "round";

    if (points.length === 1) {
      context.beginPath();
      context.arc(
        points[0].x * cssWidth,
        points[0].y * cssHeight,
        context.lineWidth / 2,
        0,
        Math.PI * 2
      );
      context.fill();
      context.restore();
      return;
    }

    context.beginPath();
    context.moveTo(points[0].x * cssWidth, points[0].y * cssHeight);
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index];
      context.lineTo(point.x * cssWidth, point.y * cssHeight);
    }
    context.stroke();
    context.restore();
  }

  function redrawCanvas(canvas, strokes) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = canvas.width / rect.width;
    const context = canvas.getContext("2d");
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    strokes.forEach(stroke => drawStroke(context, stroke, rect.width, rect.height));
  }

  function redrawInk() {
    redrawCanvas(el("teacherBoardInkCanvas"), [
      ...state.strokes,
      ...(state.activeStroke ? [state.activeStroke] : [])
    ]);
  }

  function setMode(mode) {
    state.mode = ["pen", "eraser", "move"].includes(mode) ? mode : "pen";
    document.querySelectorAll(".teacher-board-mode").forEach(button => {
      button.classList.toggle("active", button.dataset.boardMode === state.mode);
    });
    const ink = el("teacherBoardInkCanvas");
    if (ink) ink.dataset.mode = state.mode;
  }

  function bindDrawingCanvas(canvas, options) {
    if (!canvas) return;

    canvas.addEventListener("pointerdown", event => {
      if (state.mode === "move" || event.button > 0) return;
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      const point = canvasPoint(event, canvas);
      const rect = canvas.getBoundingClientRect();
      const stroke = {
        id: makeId(),
        tool: state.mode === "eraser" ? "eraser" : "pen",
        color: state.color,
        widthNorm: state.width / Math.max(1, rect.width),
        points: [point]
      };
      options.setActive(stroke);
      options.redraw();
    });

    canvas.addEventListener("pointermove", event => {
      const stroke = options.getActive();
      if (!stroke || !canvas.hasPointerCapture?.(event.pointerId)) return;
      event.preventDefault();
      const events = event.getCoalescedEvents?.() || [event];
      events.forEach(item => stroke.points.push(canvasPoint(item, canvas)));
      options.redraw();
    });

    const finish = event => {
      const stroke = options.getActive();
      if (!stroke) return;
      event.preventDefault();
      if (stroke.points.length === 1) stroke.points.push({ ...stroke.points[0] });
      options.commit(stroke);
      options.setActive(null);
      options.redraw();
      options.save();
      try {
        canvas.releasePointerCapture?.(event.pointerId);
      } catch {}
    };

    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
  }

  async function loadMiniBoard() {
    state.miniKey = currentMiniKey();
    const record = await dbGet("miniBoards", state.miniKey);
    state.miniStrokes = Array.isArray(record?.strokes) ? record.strokes : [];
    resizeMiniCanvas();
  }

  async function saveMiniBoard(immediate = false) {
    clearTimeout(state.miniSaveTimer);
    const key = state.miniKey || currentMiniKey();
    const record = {
      key,
      strokes: state.miniStrokes,
      updatedAt: new Date().toISOString()
    };

    const saveAction = () => dbPut("miniBoards", record);
    if (immediate) return saveAction();
    state.miniSaveTimer = setTimeout(() => saveAction().catch(handleStorageError), 180);
  }

  function resizeMiniCanvas() {
    const canvas = el("teacherBoardMiniCanvas");
    if (!canvas || canvas.closest(".hidden")) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    redrawMini();
  }

  function redrawMini() {
    redrawCanvas(el("teacherBoardMiniCanvas"), [
      ...state.miniStrokes,
      ...(state.miniActiveStroke ? [state.miniActiveStroke] : [])
    ]);
  }

  function showMiniBoard() {
    el("teacherBoardMini")?.classList.remove("hidden");
    el("teacherBoardMiniRestore")?.classList.add("hidden");
    requestAnimationFrame(resizeMiniCanvas);
  }

  function hideMiniBoard() {
    saveMiniBoard(true).catch(handleStorageError);
    el("teacherBoardMini")?.classList.add("hidden");
    el("teacherBoardMiniRestore")?.classList.remove("hidden");
  }

  function populateGroups() {
    const select = el("teacherBoardGroup");
    if (!select || typeof groups === "undefined") return;
    const current = select.value;
    select.innerHTML = [
      '<option value="">اختر المجموعة</option>',
      ...groups.map(group =>
        `<option value="${safeText(group.id)}">${safeText(group.name)}</option>`
      )
    ].join("");
    if (groups.some(group => String(group.id) === String(current))) {
      select.value = current;
    } else if (groups[0]) {
      select.value = groups[0].id;
    }
  }

  function selectedGroup() {
    const value = el("teacherBoardGroup")?.value || "";
    return typeof groupById === "function" ? groupById(value) : null;
  }

  function studentsForSelectedGroup() {
    const group = selectedGroup();
    if (!group || typeof students === "undefined") return [];
    return students.filter(student => {
      const studentGroup = typeof groupById === "function"
        ? groupById(student.group)
        : null;
      return (
        String(student.group) === String(group.id) ||
        String(student.group) === String(group.code || "") ||
        String(studentGroup?.id || "") === String(group.id)
      );
    });
  }

  function readPointEvents() {
    try {
      const parsed = JSON.parse(localStorage.getItem(POINT_QUEUE_KEY) || "[]");
      const oldest = Date.now() - POINT_RETENTION_MS;
      state.pointEvents = Array.isArray(parsed)
        ? parsed.filter(event => new Date(event.createdAt).getTime() >= oldest)
        : [];
    } catch {
      state.pointEvents = [];
    }
    persistPointEvents();
  }

  function persistPointEvents() {
    localStorage.setItem(POINT_QUEUE_KEY, JSON.stringify(state.pointEvents.slice(-1000)));
  }

  function currentPointEvents() {
    const group = selectedGroup();
    const date = el("teacherBoardDate")?.value || "";
    if (!group || !date) return [];
    return state.pointEvents.filter(event =>
      String(event.groupId) === String(group.id) &&
      String(event.sessionDate) === String(date)
    );
  }

  function pointCountForStudent(studentId) {
    return currentPointEvents()
      .filter(event =>
        String(event.studentId) === String(studentId) &&
        (event.status === "synced" || !event.lastError)
      )
      .reduce((sum, event) => sum + Number(event.points || 0), 0);
  }

  function renderPointStatus() {
    const status = el("teacherBoardPointStatus");
    const retry = el("teacherBoardRetryPoints");
    if (!status) return;

    const events = currentPointEvents();
    const unsent = events.filter(event => event.status !== "synced");
    const synced = events.length - unsent.length;

    if (!selectedGroup()) {
      status.textContent = "اختر المجموعة أولًا";
    } else if (!events.length) {
      status.textContent = "كل ضغطة على اسم الطالب = نقطة مشاركة للحصة";
    } else if (unsent.length) {
      const errorText = unsent.find(event => event.lastError)?.lastError;
      status.textContent = `تم إرسال ${synced} — محفوظة وتنتظر الإرسال ${unsent.length}${
        errorText ? ` — ${errorText}` : ""
      }`;
    } else {
      status.textContent = `تم إرسال ${synced} نقطة إلى نقاط الحصة`;
    }

    retry?.classList.toggle("hidden", unsent.length === 0);
  }

  function renderBoardStudents() {
    const target = el("teacherBoardStudents");
    if (!target) return;
    const groupStudents = studentsForSelectedGroup();

    if (!selectedGroup()) {
      target.innerHTML = '<div class="teacher-board-empty-small">اختر المجموعة أولًا.</div>';
      renderPointStatus();
      return;
    }

    if (!groupStudents.length) {
      target.innerHTML = '<div class="teacher-board-empty-small">لا يوجد طلاب في هذه المجموعة.</div>';
      renderPointStatus();
      return;
    }

    target.innerHTML = groupStudents.map(student => `
      <button type="button" class="teacher-board-student" data-board-student="${safeText(student.id)}" title="إضافة نقطة مشاركة إلى ${safeText(student.name)}">
        <span class="teacher-board-student-count">${pointCountForStudent(student.id)}</span>
        ${safeText(student.name)}
      </button>
    `).join("");

    target.querySelectorAll("[data-board-student]").forEach(button => {
      button.addEventListener("click", () => addParticipationPoint(button.dataset.boardStudent, button));
    });
    renderPointStatus();
  }

  function pointEvent(studentId, points, extra = {}) {
    const group = selectedGroup();
    return {
      id: makeId(),
      studentId,
      studentName: students.find(item => String(item.id) === String(studentId))?.name || "طالب",
      groupId: group?.id || "",
      groupDbId: group?.dbId || "",
      sessionDate: el("teacherBoardDate")?.value || "",
      points,
      status: "pending",
      attempts: 0,
      lastError: "",
      createdAt: new Date().toISOString(),
      ...extra
    };
  }

  function playPointSound() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!state.audioContext) state.audioContext = new AudioContextClass();
      const context = state.audioContext;
      if (context.state === "suspended") context.resume();
      const now = context.currentTime;

      [660, 880].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + index * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.12, now + index * 0.08 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.08 + 0.14);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now + index * 0.08);
        oscillator.stop(now + index * 0.08 + 0.15);
      });
    } catch (error) {
      console.warn("Teacher board sound error:", error);
    }
  }

  function addParticipationPoint(studentId, button) {
    const group = selectedGroup();
    const sessionDate = el("teacherBoardDate")?.value;
    if (!group || !sessionDate) {
      showToast("اختر المجموعة وتاريخ الحصة أولًا");
      return;
    }

    const event = pointEvent(studentId, 1);
    state.pointEvents.push(event);
    state.lastPointStudentId = studentId;
    persistPointEvents();
    renderBoardStudents();
    playPointSound();

    const currentButton = el("teacherBoardStudents")?.querySelector(
      `[data-board-student="${CSS.escape(String(studentId))}"]`
    ) || button;
    currentButton?.classList.add("celebrate");
    setTimeout(() => currentButton?.classList.remove("celebrate"), 360);
    syncQueuedPoints();
  }

  function undoLastParticipationPoint() {
    const events = currentPointEvents();
    const reversedIds = new Set(
      events.filter(event => event.undoesEventId).map(event => event.undoesEventId)
    );
    const positive = [...events].reverse().find(event =>
      Number(event.points) > 0 && !reversedIds.has(event.id)
    );

    if (!positive) {
      showToast("لا توجد نقطة أخيرة للتراجع عنها");
      return;
    }

    if (
      positive.status === "pending" &&
      Number(positive.attempts || 0) === 0 &&
      !state.pointSyncingIds.has(positive.id)
    ) {
      state.pointEvents = state.pointEvents.filter(event => event.id !== positive.id);
      persistPointEvents();
      renderBoardStudents();
      showToast(`تم إلغاء آخر نقطة لـ ${positive.studentName}`);
      return;
    }

    const undoEvent = pointEvent(positive.studentId, -1, {
      undoesEventId: positive.id
    });
    state.pointEvents.push(undoEvent);
    persistPointEvents();
    renderBoardStudents();
    syncQueuedPoints();
    showToast(`تم تسجيل التراجع عن نقطة ${positive.studentName}`);
  }

  async function syncQueuedPoints(force = false) {
    if (state.pointSyncing || currentAppRole !== "owner" || !navigator.onLine) {
      renderPointStatus();
      return;
    }

    state.pointSyncing = true;

    try {
      const supabase = await getSupabase();
      let pending = state.pointEvents.filter(event =>
        event.status !== "synced" && (force || !event.lastError)
      );

      while (pending.length) {
        const event = pending[0];
        state.pointSyncingIds.add(event.id);
        event.attempts = Number(event.attempts || 0) + 1;

        try {
          const reasonKey = `teacher_board_${String(event.id).replaceAll("-", "")}`;
          const { data, error } = await supabase.rpc(
            "queue_owner_teacher_board_point",
            {
              p_student_id: event.studentId,
              p_points: event.points,
              p_event_key: reasonKey,
              p_session_date: event.sessionDate
            }
          );

          if (error) throw error;

          if (data?.blocked || data?.closed || data?.success === false) {
            event.lastError = data?.message || (data?.closed
              ? "الحصة مغلقة أو مسجلة بالفعل"
              : "تعذر تسجيل النقطة لهذه الحصة");
          } else {
            event.status = "synced";
            event.syncedAt = new Date().toISOString();
            event.lastError = "";
          }
        } catch (error) {
          console.error("Teacher board point sync error:", error);
          event.lastError = error?.message || "تعذر الاتصال";
        } finally {
          state.pointSyncingIds.delete(event.id);
          persistPointEvents();
          renderBoardStudents();
        }

        pending = state.pointEvents.filter(item =>
          item.status !== "synced" && !item.lastError
        );
      }
    } finally {
      state.pointSyncing = false;
      renderPointStatus();
    }
  }

  function retryPoints() {
    currentPointEvents().forEach(event => {
      if (event.status !== "synced") event.lastError = "";
    });
    persistPointEvents();
    renderPointStatus();
    syncQueuedPoints(true);
  }

  function setStudentsOpen(open) {
    const dock = el("teacherBoardStudentDock");
    if (!dock) return;
    dock.classList.toggle("open", Boolean(open));
    dock.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) renderBoardStudents();
  }

  function handleStorageError(error) {
    console.error("Teacher board storage error:", error);
    showToast("تعذر حفظ بيانات السبورة على الجهاز");
  }

  async function onSessionContextChange() {
    await saveMiniBoard(true).catch(handleStorageError);
    await loadMiniBoard().catch(handleStorageError);
    renderBoardStudents();
  }

  function bindEvents() {
    el("teacherBoardLibraryBtn")?.addEventListener("click", () => setLibraryOpen(true));
    el("teacherBoardWelcomeLibrary")?.addEventListener("click", () => setLibraryOpen(true));
    el("teacherBoardLibraryClose")?.addEventListener("click", () => setLibraryOpen(false));
    el("teacherBoardPdfInput")?.addEventListener("change", event => importPdf(event.target.files?.[0]));
    el("teacherBoardBookSearch")?.addEventListener("input", renderBooks);

    el("teacherBoardPrevPage")?.addEventListener("click", () => goToPage(state.pageNumber - 1));
    el("teacherBoardNextPage")?.addEventListener("click", () => goToPage(state.pageNumber + 1));
    el("teacherBoardPageNumber")?.addEventListener("change", event => goToPage(event.target.value));
    el("teacherBoardZoomOut")?.addEventListener("click", () => {
      state.zoom = Math.max(0.45, Math.round((state.zoom - 0.15) * 100) / 100);
      updateBookUi();
      scheduleRender();
    });
    el("teacherBoardZoomIn")?.addEventListener("click", () => {
      state.zoom = Math.min(3, Math.round((state.zoom + 0.15) * 100) / 100);
      updateBookUi();
      scheduleRender();
    });
    el("teacherBoardFit")?.addEventListener("click", () => {
      state.zoom = 1;
      updateBookUi();
      scheduleRender();
    });

    document.querySelectorAll(".teacher-board-mode").forEach(button => {
      button.addEventListener("click", () => setMode(button.dataset.boardMode));
    });
    document.querySelectorAll("[data-board-color]").forEach(button => {
      button.addEventListener("click", () => {
        state.color = button.dataset.boardColor;
        document.querySelectorAll("[data-board-color]").forEach(item => {
          item.classList.toggle("active", item === button);
        });
        if (state.mode === "move" || state.mode === "eraser") setMode("pen");
      });
    });
    el("teacherBoardPenWidth")?.addEventListener("input", event => {
      state.width = Number(event.target.value || 5);
    });

    el("teacherBoardUndo")?.addEventListener("click", () => {
      if (!state.strokes.length) {
        showToast("لا توجد كتابة للتراجع عنها في هذه الصفحة");
        return;
      }
      state.strokes.pop();
      redrawInk();
      saveCurrentAnnotation();
    });
    el("teacherBoardClearPage")?.addEventListener("click", () => {
      if (!state.strokes.length) return;
      if (!window.confirm(`مسح كل الكتابة من الصفحة ${state.pageNumber} فقط؟`)) return;
      state.strokes = [];
      redrawInk();
      saveCurrentAnnotation();
    });

    el("teacherBoardMiniBtn")?.addEventListener("click", showMiniBoard);
    el("teacherBoardMiniRestore")?.addEventListener("click", showMiniBoard);
    el("teacherBoardMiniHide")?.addEventListener("click", hideMiniBoard);
    el("teacherBoardMiniQuarter")?.addEventListener("click", () => {
      el("teacherBoardMini").dataset.size = "quarter";
      requestAnimationFrame(resizeMiniCanvas);
    });
    el("teacherBoardMiniHalf")?.addEventListener("click", () => {
      el("teacherBoardMini").dataset.size = "half";
      requestAnimationFrame(resizeMiniCanvas);
    });
    el("teacherBoardMiniClear")?.addEventListener("click", () => {
      if (!state.miniStrokes.length) return;
      if (!window.confirm("مسح السبورة الإضافية الحالية؟")) return;
      state.miniStrokes = [];
      redrawMini();
      saveMiniBoard();
    });

    el("teacherBoardStudentsBtn")?.addEventListener("click", () => setStudentsOpen(true));
    el("teacherBoardStudentsClose")?.addEventListener("click", () => setStudentsOpen(false));
    el("teacherBoardUndoPoint")?.addEventListener("click", undoLastParticipationPoint);
    el("teacherBoardRetryPoints")?.addEventListener("click", retryPoints);
    el("teacherBoardGroup")?.addEventListener("change", onSessionContextChange);
    el("teacherBoardDate")?.addEventListener("change", onSessionContextChange);

    el("teacherBoardFullscreenBtn")?.addEventListener("click", async () => {
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
    });

    document.addEventListener("fullscreenchange", () => {
      const button = el("teacherBoardFullscreenBtn");
      if (button) {
        button.innerHTML = document.fullscreenElement
          ? "✕ <span>إنهاء ملء الشاشة</span>"
          : "⛶ <span>ملء الشاشة</span>";
      }
      scheduleRender();
    });

    bindDrawingCanvas(el("teacherBoardInkCanvas"), {
      getActive: () => state.activeStroke,
      setActive: stroke => { state.activeStroke = stroke; },
      commit: stroke => state.strokes.push(stroke),
      redraw: redrawInk,
      save: saveCurrentAnnotation
    });

    bindDrawingCanvas(el("teacherBoardMiniCanvas"), {
      getActive: () => state.miniActiveStroke,
      setActive: stroke => { state.miniActiveStroke = stroke; },
      commit: stroke => state.miniStrokes.push(stroke),
      redraw: redrawMini,
      save: saveMiniBoard
    });

    if (typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(entries => {
        entries.forEach(entry => {
          if (entry.target.id === "teacherBoardViewer") scheduleRender();
          if (entry.target.id === "teacherBoardMini") resizeMiniCanvas();
        });
      });
      if (el("teacherBoardViewer")) resizeObserver.observe(el("teacherBoardViewer"));
      if (el("teacherBoardMini")) resizeObserver.observe(el("teacherBoardMini"));
    } else {
      window.addEventListener("resize", scheduleRender);
    }

    window.addEventListener("online", () => {
      state.pointEvents.forEach(event => {
        if (event.status !== "synced") event.lastError = "";
      });
      persistPointEvents();
      syncQueuedPoints();
    });
    window.addEventListener("beforeunload", () => {
      saveCurrentAnnotation(true).catch(() => {});
      saveMiniBoard(true).catch(() => {});
    });
  }

  async function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    readPointEvents();
    bindEvents();
    setMode("pen");
    updateBookUi();

    if (el("teacherBoardDate") && !el("teacherBoardDate").value) {
      el("teacherBoardDate").value =
        typeof localDateISO === "function" ? localDateISO() : new Date().toISOString().slice(0, 10);
    }

    try {
      await openDatabase();
      await loadBooks();
      const setting = await dbGet("settings", "lastBookId");
      if (setting?.value) {
        const book = await dbGet("books", setting.value);
        if (book && state.active) await openBook(book);
      }
    } catch (error) {
      handleStorageError(error);
    }
  }

  async function activate() {
    if (typeof currentAppRole !== "undefined" && currentAppRole !== "owner") {
      showToast("سبورة الشرح متاحة لحساب المالك فقط");
      return;
    }

    state.active = true;
    await initialize();
    populateGroups();
    renderBoardStudents();
    updateStorageInfo();
    syncQueuedPoints();

    if (state.pdfDocument) {
      scheduleRender();
    } else if (!state.currentBook) {
      try {
        const setting = await dbGet("settings", "lastBookId");
        if (setting?.value) {
          const book = await dbGet("books", setting.value);
          if (book) await openBook(book);
        }
      } catch (error) {
        handleStorageError(error);
      }
    }
  }

  function deactivate() {
    if (!state.active) return;
    state.active = false;
    setLibraryOpen(false);
    setStudentsOpen(false);
    saveCurrentAnnotation(true).catch(handleStorageError);
    saveMiniBoard(true).catch(handleStorageError);

    if (state.currentBook) {
      dbPut("settings", {
        key: "lastBookId",
        value: state.currentBook.id,
        updatedAt: new Date().toISOString()
      }).catch(handleStorageError);
    }
  }

  async function logout() {
    deactivate();
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch {}
    }
    if (state.audioContext) {
      try { await state.audioContext.close(); } catch {}
      state.audioContext = null;
    }
  }

  window.teacherBoard = {
    activate,
    deactivate,
    logout,
    refreshStudents: renderBoardStudents
  };
})();
