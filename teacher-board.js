(function () {
  "use strict";

  const DB_NAME = "ef_teacher_board_v1";
  const DB_VERSION = 2;
  const POINT_QUEUE_KEY = "ef_teacher_board_points_v1";
  const PDF_MODULE_URL =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs";
  const PDF_WORKER_URL =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs";
  const POINT_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;
  const DEFAULT_ZOOM = 1.28;
  const MIN_ZOOM = 0.45;
  const MAX_ZOOM = 3;
  const PAGE_EDGE_PULL_PX = 84;

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
    zoom: DEFAULT_ZOOM,
    mode: "pen",
    color: "#e53935",
    width: 5,
    eraserWidth: 36,
    strokes: [],
    strokesPageNumber: 0,
    activeStroke: null,
    bookOpenToken: 0,
    renderToken: 0,
    pdfRenderTask: null,
    pageBaseCanvas: null,
    annotationCanvas: null,
    rasterCache: new Map(),
    rasterCacheLimit: 5,
    qualityTimer: null,
    idlePrefetchTimer: null,
    previewSaveTimer: null,
    panX: 0,
    panY: 0,
    pageCache: new Map(),
    renderTimer: null,
    saveTimer: null,
    miniSaveTimer: null,
    miniStrokes: [],
    miniKey: "",
    miniActiveStroke: null,
    miniClearArmedUntil: 0,
    pointEvents: [],
    pointSyncing: false,
    pointSyncingIds: new Set(),
    lastPointStudentId: "",
    audioContext: null,
    touchPointers: new Map(),
    touchGesture: null,
    touchWaitForRelease: false,
    sessionGroupId: "",
    sessionDate: "",
    selectedGroupBookId: "",
    groupSwitchToken: 0,
    preparingBookId: "",
    prepareProgress: 0,
    prepareTotal: 0,
    prepareCancelled: false
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

  function boardTodayISO() {
    return typeof localDateISO === "function"
      ? localDateISO()
      : new Date().toISOString().slice(0, 10);
  }

  function refreshBoardSessionDate() {
    const dateInput = el("teacherBoardDate");
    if (!dateInput) return;
    dateInput.value = boardTodayISO();
    state.sessionDate = dateInput.value;
  }

  function groupBookSettingKey(groupId) {
    return `lastBookId:group:${String(groupId || "")}`;
  }

  function populateBookGroupSelect() {
    const select = el("teacherBoardBookLevel");
    if (!select || typeof groups === "undefined") return;
    const currentGroupId = String(el("teacherBoardGroup")?.value || "");
    const previous = String(select.value || "");
    select.innerHTML = [
      '<option value="">اختر المجموعة</option>',
      ...groups.map(group =>
        `<option value="${safeText(group.id)}">${safeText(group.name)}</option>`
      )
    ].join("");
    const preferred = currentGroupId || previous;
    if (groups.some(group => String(group.id) === preferred)) {
      select.value = preferred;
    }
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

        if (!database.objectStoreNames.contains("preparedPages")) {
          const preparedStore = database.createObjectStore("preparedPages", {
            keyPath: "key"
          });
          preparedStore.createIndex("bookId", "bookId");
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
      ["books", "annotations", "miniBoards", "preparedPages"],
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

    const preparedStore = transaction.objectStore("preparedPages");
    const preparedCursor = preparedStore.index("bookId").openCursor(bookId);
    preparedCursor.onsuccess = () => {
      const cursor = preparedCursor.result;
      if (!cursor) return;
      cursor.delete();
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

  async function countPreparedPages(bookId) {
    const database = await openDatabase();
    const transaction = database.transaction("preparedPages", "readonly");
    return requestResult(
      transaction.objectStore("preparedPages").index("bookId").count(bookId)
    );
  }

  function currentMiniKey() {
    const bookId = state.currentBook?.id || "no-book";
    const groupId = state.sessionGroupId || el("teacherBoardGroup")?.value || "no-group";
    const date = state.sessionDate || el("teacherBoardDate")?.value || "no-date";
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
    const matchingBooks = query
      ? state.books.filter(book =>
          [book.title, book.category, book.level, book.academicYear, book.fileName]
            .some(value => String(value || "").toLowerCase().includes(query))
        )
      : state.books;
    const visibleBooks = [...matchingBooks].sort((a, b) => {
      const aSelected = String(a.id) === String(state.selectedGroupBookId) ? 1 : 0;
      const bSelected = String(b.id) === String(state.selectedGroupBookId) ? 1 : 0;
      return bSelected - aSelected;
    });

    if (!visibleBooks.length) {
      target.innerHTML =
        `<div class="teacher-board-empty-small">${
          state.books.length ? "لا توجد نتيجة مطابقة للبحث." : "لا توجد كتب محفوظة بعد."
        }</div>`;
      return;
    }

    target.innerHTML = visibleBooks.map(book => {
      const isPreparing = String(state.preparingBookId) === String(book.id);
      const preparedCount = isPreparing
        ? state.prepareProgress
        : Number(book.preparedPageCount || 0);
      const total = isPreparing
        ? state.prepareTotal
        : Number(book.pageCount || 0);
      const isReady = total > 0 && preparedCount >= total;
      const prepareLabel = isPreparing
        ? `إيقاف التجهيز (${preparedCount}/${total || "؟"})`
        : isReady
          ? `✓ الكتاب جاهز وسريع — ${total} صفحة`
          : `⚡ تجهيز الكتاب قبل الحصة (${preparedCount}/${total || "؟"})`;
      return `
      <article class="teacher-board-book-card ${
        state.currentBook?.id === book.id ? "current" : ""
      }" data-book-id="${safeText(book.id)}">
        <button type="button" class="teacher-board-book-open" data-open-book="${safeText(book.id)}">
          <strong>${safeText(book.title)}</strong>
          <small>${[
            String(book.id) === String(state.selectedGroupBookId) ? "كتاب المجموعة الحالية" : "",
            book.category || "عام",
            book.level,
            book.academicYear,
            formatBytes(book.size),
            book.pageCount ? `${book.pageCount} صفحة` : ""
          ].filter(Boolean).map(safeText).join(" — ")}</small>
        </button>
        <button type="button" class="teacher-board-book-delete" data-delete-book="${safeText(book.id)}" title="حذف الكتاب">🗑</button>
        <button type="button" class="teacher-board-book-prepare ${isReady ? "ready" : ""}" data-prepare-book="${safeText(book.id)}">
          ${prepareLabel}
        </button>
      </article>
    `;
    }).join("");

    target.querySelectorAll("[data-open-book]").forEach(button => {
      button.addEventListener("click", () => openBookById(button.dataset.openBook));
    });

    target.querySelectorAll("[data-delete-book]").forEach(button => {
      button.addEventListener("click", () => deleteBook(button.dataset.deleteBook, button));
    });

    target.querySelectorAll("[data-prepare-book]").forEach(button => {
      button.addEventListener("click", () => {
        const bookId = button.dataset.prepareBook;
        if (String(state.preparingBookId) === String(bookId)) {
          state.prepareCancelled = true;
          button.textContent = "جارٍ إيقاف التجهيز…";
          button.disabled = true;
          return;
        }
        prepareBook(bookId).catch(handleStorageError);
      });
    });
  }

  function setLibraryOpen(open) {
    const library = el("teacherBoardLibrary");
    if (!library) return;
    if (!open && state.preparingBookId) {
      state.prepareCancelled = true;
      showToast("سيتم إيقاف تجهيز الكتاب قبل العودة للشرح");
    }
    library.classList.toggle("open", Boolean(open));
    library.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      populateBookGroupSelect();
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
    const assignedGroupId = String(el("teacherBoardBookLevel")?.value || "").trim();
    const assignedGroup = typeof groupById === "function" ? groupById(assignedGroupId) : null;
    if (!assignedGroupId || !assignedGroup) {
      showToast("اختر المجموعة التي سيُفتح معها الكتاب أولًا");
      if (el("teacherBoardPdfInput")) el("teacherBoardPdfInput").value = "";
      return;
    }
    const level = assignedGroup.name || assignedGroup.code || "";
    const academicYear = String(el("teacherBoardBookYear")?.value || "").trim();
    const buttonLabel = document.querySelector(".teacher-board-file-label");

    if (buttonLabel) buttonLabel.firstChild.textContent = "جارٍ حفظ الكتاب… ";

    try {
      const book = {
        id: makeId(),
        title,
        category,
        level,
        groupId: assignedGroupId,
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
      const changingGroup = String(state.sessionGroupId || "") !== assignedGroupId;
      if (changingGroup) {
        await saveMiniBoard(true).catch(handleStorageError);
        const sessionGroup = el("teacherBoardGroup");
        if (sessionGroup) sessionGroup.value = assignedGroupId;
        state.sessionGroupId = assignedGroupId;
        state.sessionDate = el("teacherBoardDate")?.value || state.sessionDate;
        renderBoardStudents();
      }
      await openBook(book, {
        groupId: assignedGroupId,
        skipMiniSave: changingGroup
      });
      setLibraryOpen(false);
      showToast("تم حفظ الكتاب — جهزه مرة واحدة من المكتبة لأسرع تقليب");
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

  let removePdfArmedId = "";
  let removePdfArmedUntil = 0;

  async function deleteBook(bookId, sourceButton = null) {
    if (String(state.preparingBookId) === String(bookId)) {
      showToast("أوقف تجهيز الكتاب أولًا ثم احذفه");
      return;
    }
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
      const bookSettings = (await dbGetAll("settings")).filter(setting =>
        (setting.key === "lastBookId" || String(setting.key).startsWith("lastBookId:group:")) &&
        String(setting.value) === String(bookId)
      );
      await Promise.all(bookSettings.map(setting => dbDelete("settings", setting.key)));
      if (String(state.selectedGroupBookId) === String(bookId)) state.selectedGroupBookId = "";
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

  function canvasToBlob(canvas, type = "image/webp", quality = 0.98) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
  }

  function yieldToInterface() {
    return new Promise(resolve => setTimeout(resolve, 20));
  }

  async function prepareBook(bookId) {
    if (state.preparingBookId) {
      showToast("يتم تجهيز كتاب آخر الآن");
      return;
    }

    const book = await dbGet("books", bookId);
    if (!book?.file) {
      showToast("ملف الكتاب غير موجود على هذه السبورة");
      return;
    }

    let pdfDocument = null;
    let objectUrl = "";
    state.preparingBookId = bookId;
    state.prepareCancelled = false;
    state.prepareProgress = Number(book.preparedPageCount || 0);
    state.prepareTotal = Number(book.pageCount || 0);
    renderBooks();

    try {
      const pdfjs = await loadPdfModule();
      objectUrl = URL.createObjectURL(book.file);
      pdfDocument = await pdfjs.getDocument({
        url: objectUrl,
        isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false
      }).promise;

      state.prepareTotal = pdfDocument.numPages;
      const storedCount = await countPreparedPages(bookId);
      state.prepareProgress = Math.min(storedCount, state.prepareTotal);
      renderBooks();

      if (state.prepareProgress >= state.prepareTotal) {
        showToast("هذا الكتاب مجهز بالفعل وجاهز للشرح");
        return;
      }

      showToast("بدأ تجهيز الكتاب — اترك مكتبة الكتب مفتوحة حتى يكتمل");
      for (
        let pageNumber = state.prepareProgress + 1;
        pageNumber <= state.prepareTotal;
        pageNumber += 1
      ) {
        if (state.prepareCancelled) break;

        const page = await pdfDocument.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const longEdgeScale = 2000 / Math.max(baseViewport.width, baseViewport.height);
        const pixelSafeScale = Math.sqrt(
          3200000 / Math.max(1, baseViewport.width * baseViewport.height)
        );
        const scale = Math.max(1, Math.min(3, longEdgeScale, pixelSafeScale));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("PDF_CANVAS_CONTEXT_UNAVAILABLE");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvasContext: context,
          viewport,
          background: "rgb(255,255,255)"
        }).promise;

        let blob = await canvasToBlob(canvas);
        if (!blob) blob = await canvasToBlob(canvas, "image/jpeg", 0.98);
        if (!blob) throw new Error("PAGE_IMAGE_ENCODING_FAILED");
        await dbPut("preparedPages", {
          key: annotationKey(bookId, pageNumber),
          bookId,
          pageNumber,
          blob,
          width: canvas.width,
          height: canvas.height,
          updatedAt: new Date().toISOString()
        });

        canvas.width = 1;
        canvas.height = 1;
        page.cleanup?.();
        state.prepareProgress = pageNumber;
        const progressButton = [...document.querySelectorAll("[data-prepare-book]")]
          .find(button => String(button.dataset.prepareBook) === String(bookId));
        if (progressButton) {
          progressButton.textContent = `إيقاف التجهيز (${pageNumber}/${state.prepareTotal})`;
        }
        await yieldToInterface();
      }

      book.pageCount = state.prepareTotal;
      book.preparedPageCount = state.prepareProgress;
      book.preparedAt = state.prepareProgress >= state.prepareTotal
        ? new Date().toISOString()
        : "";
      book.updatedAt = new Date().toISOString();
      await dbPut("books", book);
      state.books = state.books.map(item => item.id === book.id ? book : item);
      if (state.currentBook?.id === book.id) {
        state.currentBook.preparedPageCount = book.preparedPageCount;
        state.currentBook.preparedAt = book.preparedAt;
        clearRasterCache({ keepVisible: true });
        renderPage({ showLoading: false });
      }

      showToast(
        state.prepareCancelled
          ? `تم إيقاف التجهيز عند الصفحة ${state.prepareProgress} — يمكن استكماله لاحقًا`
          : "اكتمل تجهيز الكتاب — الصفحات الآن سريعة وواضحة"
      );
      await updateStorageInfo();
    } catch (error) {
      console.error("Teacher board preparation error:", error);
      showToast(
        error?.name === "QuotaExceededError"
          ? "المساحة المتاحة لا تكفي لتجهيز باقي الكتاب"
          : "تعذر إكمال تجهيز الكتاب — يمكنك المحاولة مرة أخرى"
      );
    } finally {
      try { await pdfDocument?.destroy?.(); } catch {}
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      state.preparingBookId = "";
      state.prepareCancelled = false;
      state.prepareProgress = 0;
      state.prepareTotal = 0;
      renderBooks();
    }
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

  async function closeCurrentBook({ skipMiniSave = false } = {}) {
    state.bookOpenToken += 1;
    state.renderToken += 1;
    clearTimeout(state.renderTimer);
    clearTimeout(state.idlePrefetchTimer);
    clearTimeout(state.previewSaveTimer);
    clearTimeout(state.saveTimer);
    try { state.pdfRenderTask?.cancel?.(); } catch {}
    state.pdfRenderTask = null;
    await saveCurrentAnnotation(true).catch(() => {});
    if (!skipMiniSave) await saveMiniBoard(true).catch(() => {});

    if (state.pdfDocument) {
      try {
        await state.pdfDocument.destroy();
      } catch {}
    }

    if (state.pdfObjectUrl) URL.revokeObjectURL(state.pdfObjectUrl);

    state.pdfDocument = null;
    state.pdfObjectUrl = "";
    state.pageCache.clear();
    clearRasterCache();
    clearTimeout(state.qualityTimer);
    state.pageBaseCanvas = null;
    state.annotationCanvas = null;
    resetBoardPan();
    state.currentBook = null;
    state.pageNumber = 1;
    state.pageCount = 0;
    state.strokes = [];
    state.strokesPageNumber = 0;
    updateBookUi();
  }

  async function showStoredBookPreview(book) {
    const preview = book?.previewBlob;
    if (!preview || !book?.previewWidth || !book?.previewHeight) return false;
    try {
      const bitmap = await createImageBitmap(preview);
      const canvas = el("teacherBoardPdfCanvas");
      const wrap = el("teacherBoardCanvasWrap");
      if (!canvas || !wrap) return false;

      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0);
      bitmap.close?.();

      canvas.style.width = `${book.previewWidth}px`;
      canvas.style.height = `${book.previewHeight}px`;
      const inkCanvas = el("teacherBoardInkCanvas");
      if (inkCanvas) {
        inkCanvas.width = canvas.width;
        inkCanvas.height = canvas.height;
        inkCanvas.style.width = `${book.previewWidth}px`;
        inkCanvas.style.height = `${book.previewHeight}px`;
        inkCanvas.style.display = "block";
        drawingContext(inkCanvas).clearRect(0, 0, inkCanvas.width, inkCanvas.height);
      }
      wrap.style.width = `${book.previewWidth}px`;
      wrap.style.height = `${book.previewHeight}px`;
      wrap.classList.remove("hidden");
      state.pageBaseCanvas = canvas;
      el("teacherBoardWelcome")?.classList.add("hidden");
      return true;
    } catch (error) {
      console.warn("Teacher board preview restore skipped:", error);
      return false;
    }
  }

  function scheduleBookPreviewSave() {
    clearTimeout(state.previewSaveTimer);
    if (!state.currentBook || !state.pageBaseCanvas) return;
    // A preview of this page already exists. Zooming must not repeatedly
    // encode the same large canvas while the teacher is interacting.
    if (Number(state.currentBook.previewPage || 0) === Number(state.pageNumber)) return;
    state.previewSaveTimer = setTimeout(() => {
      if (state.activeStroke || state.touchGesture || state.pdfRenderTask) {
        scheduleBookPreviewSave();
        return;
      }
      const source = state.pageBaseCanvas;
      if (!source?.toBlob || !state.currentBook) return;
      const previewBook = state.currentBook;
      const previewPage = state.pageNumber;
      const maxPreviewPixels = 1200000;
      const previewScale = Math.min(
        1,
        Math.sqrt(maxPreviewPixels / Math.max(1, source.width * source.height))
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(source.width * previewScale));
      canvas.height = Math.max(1, Math.round(source.height * previewScale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async blob => {
        if (
          !blob ||
          !state.currentBook ||
          String(state.currentBook.id) !== String(previewBook.id) ||
          Number(state.pageNumber) !== Number(previewPage)
        ) return;
        try {
          previewBook.previewBlob = blob;
          const visible = el("teacherBoardPdfCanvas");
          previewBook.previewWidth = Math.round(parseFloat(visible?.style.width) || visible?.getBoundingClientRect().width || 0);
          previewBook.previewHeight = Math.round(parseFloat(visible?.style.height) || visible?.getBoundingClientRect().height || 0);
          previewBook.previewPage = previewPage;
          previewBook.updatedAt = new Date().toISOString();
          await dbPut("books", previewBook);
        } catch (error) {
          console.warn("Teacher board preview save skipped:", error);
        }
      }, "image/jpeg", 0.76);
    }, 3200);
  }

  async function openBook(book, options = {}) {
    if (!book?.file) {
      showToast("ملف الكتاب غير موجود على هذه السبورة");
      return;
    }

    const groupIdAtOpen = String(
      options.groupId ?? el("teacherBoardGroup")?.value ?? ""
    );
    await closeCurrentBook({ skipMiniSave: Boolean(options.skipMiniSave) });
    const openToken = ++state.bookOpenToken;
    state.currentBook = book;
    state.pageNumber = Math.max(1, Number(book.lastPage || 1));
    state.zoom = DEFAULT_ZOOM;
    updateBookUi();
    // Do not flash an old compressed JPEG preview before the real page. It
    // looked blurry for several seconds on the classroom display and its
    // background encoding also competed with touch and pen input.
    const previewShown = false;
    setLoading(true, "جارٍ فتح الصفحة بوضوح…");
    el("teacherBoardWelcome")?.classList.add("hidden");

    try {
      const pdfjs = await loadPdfModule();
      const objectUrl = URL.createObjectURL(book.file);
      const loadingTask = pdfjs.getDocument({
        url: objectUrl,
        isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false
      });
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
      dbPut("books", book).catch(handleStorageError);
      dbPut("settings", {
        key: "lastBookId",
        value: book.id,
        updatedAt: new Date().toISOString()
      }).catch(handleStorageError);
      if (groupIdAtOpen) {
        dbPut("settings", {
          key: groupBookSettingKey(groupIdAtOpen),
          value: book.id,
          updatedAt: new Date().toISOString()
        }).catch(handleStorageError);
        if (String(el("teacherBoardGroup")?.value || "") === groupIdAtOpen) {
          state.selectedGroupBookId = book.id;
        }
      }
      state.books = state.books.map(item => item.id === book.id ? book : item);
      renderBooks();
      loadMiniBoard().catch(handleStorageError);
      await renderPage({ showLoading: !previewShown });
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
      el("teacherBoardPageCount").textContent = `of ${state.pageCount}`;
    }
    if (el("teacherBoardZoomText")) {
      el("teacherBoardZoomText").textContent = `${Math.round(state.zoom * 100)}%`;
    }

    const hasPdf = Boolean(state.pdfDocument);
    if (el("teacherBoardRemovePdfBtn")) {
      el("teacherBoardRemovePdfBtn").disabled = !state.currentBook;
    }
    if (el("teacherBoardGoPage")) {
      el("teacherBoardGoPage").disabled = !hasPdf;
    }
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

  function getPdfPage(pageNumber) {
    if (!state.pdfDocument) return Promise.reject(new Error("PDF_NOT_OPEN"));
    const key = Number(pageNumber);
    if (!state.pageCache.has(key)) {
      state.pageCache.set(key, state.pdfDocument.getPage(key));
    }
    return state.pageCache.get(key);
  }

  function viewerMetrics(page) {
    const viewer = el("teacherBoardViewer");
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(260, viewer.clientWidth - 8);
    const availableHeight = Math.max(260, viewer.clientHeight - 8);
    const fitScale = Math.min(
      availableWidth / baseViewport.width,
      availableHeight / baseViewport.height
    );
    // Render the PDF once at its fitted size. Zooming only changes the CSS
    // size afterwards, so it never starts another slow PDF.js render.
    const viewport = page.getViewport({ scale: Math.max(0.1, fitScale) });
    const baseWidth = Math.max(1, Math.round(viewport.width));
    const baseHeight = Math.max(1, Math.round(viewport.height));
    // Unprepared pages still render clearly. Books prepared from the library
    // use the persistent high-quality page image instead of this PDF render.
    const desired = 1.65;
    const memorySafe = Math.sqrt(3000000 / Math.max(1, baseWidth * baseHeight));
    const pixelRatio = Math.max(1, Math.min(desired, memorySafe));

    return {
      viewport,
      baseWidth,
      baseHeight,
      width: Math.max(1, Math.round(baseWidth * state.zoom)),
      height: Math.max(1, Math.round(baseHeight * state.zoom)),
      pixelRatio
    };
  }

  function preparedViewerMetrics(sourceWidth, sourceHeight) {
    const viewer = el("teacherBoardViewer");
    const availableWidth = Math.max(260, viewer.clientWidth - 8);
    const availableHeight = Math.max(260, viewer.clientHeight - 8);
    const fitScale = Math.min(
      availableWidth / Math.max(1, sourceWidth),
      availableHeight / Math.max(1, sourceHeight)
    );
    const baseWidth = Math.max(1, Math.round(sourceWidth * fitScale));
    const baseHeight = Math.max(1, Math.round(sourceHeight * fitScale));
    return {
      viewport: null,
      baseWidth,
      baseHeight,
      width: Math.max(1, Math.round(baseWidth * state.zoom)),
      height: Math.max(1, Math.round(baseHeight * state.zoom)),
      pixelRatio: sourceWidth / Math.max(1, baseWidth)
    };
  }

  function rasterKey(pageNumber, metrics) {
    return [
      pageNumber,
      metrics.baseWidth,
      metrics.baseHeight,
      Math.round(metrics.pixelRatio * 100)
    ].join(":");
  }

  function preparedRasterKey(pageNumber, metrics) {
    return `prepared:${pageNumber}:${metrics.baseWidth}:${metrics.baseHeight}`;
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

  async function makePageRaster(pageNumber, { trackCurrent = false } = {}) {
    const page = await getPdfPage(pageNumber);
    const metrics = viewerMetrics(page);
    const key = rasterKey(pageNumber, metrics);
    const cached = state.rasterCache.get(key);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(metrics.baseWidth * metrics.pixelRatio));
    canvas.height = Math.max(1, Math.round(metrics.baseHeight * metrics.pixelRatio));
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
    try {
      await task.promise;
    } catch (error) {
      canvas.width = 1;
      canvas.height = 1;
      throw error;
    }

    const result = { canvas, ...metrics, key };
    rememberRaster(key, result);
    return result;
  }

  async function makePreparedPageRaster(pageNumber, metrics, record) {
    const key = preparedRasterKey(pageNumber, metrics);
    const cached = state.rasterCache.get(key);
    if (cached) return cached;

    if (!record?.blob) return null;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Number(record.width || 1));
    canvas.height = Math.max(1, Number(record.height || 1));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (globalThis.createImageBitmap) {
      const bitmap = await createImageBitmap(record.blob);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
    } else {
      const url = URL.createObjectURL(record.blob);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    const result = {
      canvas,
      ...metrics,
      pixelRatio: canvas.width / Math.max(1, metrics.baseWidth),
      key
    };
    rememberRaster(key, result);
    return result;
  }

  function applyRaster(raster, strokes) {
    let pdfCanvas = el("teacherBoardPdfCanvas");
    const inkCanvas = el("teacherBoardInkCanvas");
    const wrap = el("teacherBoardCanvasWrap");
    if (!pdfCanvas || !wrap || !raster) return;

    // Put the already-rendered canvas directly in the viewer. Avoiding a
    // second multi-megapixel drawImage copy makes page changes much cheaper.
    if (raster.canvas !== pdfCanvas) {
      const previousCanvas = pdfCanvas;
      raster.canvas.id = "teacherBoardPdfCanvas";
      raster.canvas.className = previousCanvas.className;
      raster.canvas.dataset.mode = state.mode;
      raster.canvas.setAttribute("aria-label", "صفحة الكتاب");
      previousCanvas.removeAttribute("id");
      previousCanvas.replaceWith(raster.canvas);
      pdfCanvas = raster.canvas;
    }

    const displayWidth = Math.max(1, Math.round(raster.baseWidth * state.zoom));
    const displayHeight = Math.max(1, Math.round(raster.baseHeight * state.zoom));
    pdfCanvas.style.width = `${displayWidth}px`;
    pdfCanvas.style.height = `${displayHeight}px`;

    if (inkCanvas) {
      inkCanvas.width = raster.canvas.width;
      inkCanvas.height = raster.canvas.height;
      inkCanvas.style.width = `${displayWidth}px`;
      inkCanvas.style.height = `${displayHeight}px`;
      inkCanvas.style.display = "block";
    }

    state.pageBaseCanvas = raster.canvas;
    wrap.style.width = `${displayWidth}px`;
    wrap.style.height = `${displayHeight}px`;
    state.strokes = strokes;
    state.strokesPageNumber = state.pageNumber;
    redrawInk();
    updateBookUi();
  }

  function prefetchNearbyPages() {
    clearTimeout(state.idlePrefetchTimer);
    // No background PDF rendering on the Hikvision Android processor.
    // Previously it delayed the first pen, pan and zoom action on every page.
  }

  async function renderPage({ showLoading = false } = {}) {
    if (!state.pdfDocument || !state.currentBook) return;

    const token = ++state.renderToken;
    try { state.pdfRenderTask?.cancel?.(); } catch {}
    state.pdfRenderTask = null;

    const pageNumber = state.pageNumber;
    try {
      const bookId = state.currentBook.id;
      const strokesPromise = loadPageStrokes(bookId, pageNumber);
      const preparedRecord = await dbGet(
        "preparedPages",
        annotationKey(bookId, pageNumber)
      );
      if (token !== state.renderToken) return;

      if (preparedRecord?.blob) {
        const preparedMetrics = preparedViewerMetrics(
          Number(preparedRecord.width || 1),
          Number(preparedRecord.height || 1)
        );
        const preparedKey = preparedRasterKey(pageNumber, preparedMetrics);
        let preparedRaster = state.rasterCache.get(preparedKey);
        if (!preparedRaster) {
          preparedRaster = await makePreparedPageRaster(
            pageNumber,
            preparedMetrics,
            preparedRecord
          );
        }
        const strokes = await strokesPromise;
        if (token !== state.renderToken) return;
        applyRaster(preparedRaster, strokes);
        prefetchNearbyPages();
        return;
      }

      const page = await getPdfPage(pageNumber);
      const metrics = viewerMetrics(page);
      const key = rasterKey(pageNumber, metrics);

      const cached = state.rasterCache.get(key);
      if (cached) {
        state.rasterCache.delete(cached.key);
        state.rasterCache.set(cached.key, cached);
        const strokes = await strokesPromise;
        if (token !== state.renderToken) return;
        applyRaster(cached, strokes);
        prefetchNearbyPages();
        return;
      }

      if (showLoading) {
        setLoading(true, `جارٍ تجهيز الصفحة ${pageNumber}…`);
      }

      const [raster, strokes] = await Promise.all([
        makePageRaster(pageNumber, { trackCurrent: true }),
        strokesPromise
      ]);
      if (token !== state.renderToken) return;
      applyRaster(raster, strokes);
      state.pdfRenderTask = null;
      prefetchNearbyPages();
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
    }, 90);
  }

  async function goToPage(nextPage, { edge = "top" } = {}) {
    if (!state.pdfDocument) return;
    const pageNumber = Math.min(
      state.pageCount,
      Math.max(1, Math.trunc(Number(nextPage) || 1))
    );
    if (pageNumber === state.pageNumber) {
      updateBookUi();
      return;
    }

    // Build the save record immediately, but do not block page turning on IndexedDB.
    saveCurrentAnnotation(true).catch(handleStorageError);
    pauseBoardBackgroundWork();
    state.pageNumber = pageNumber;
    state.activeStroke = null;
    resetBoardPan();
    updateBookUi();
    await renderPage({ showLoading: true });
    const viewer = el("teacherBoardViewer");
    if (viewer) {
      requestAnimationFrame(() => {
        viewer.scrollLeft = Math.max(0, (viewer.scrollWidth - viewer.clientWidth) / 2);
        viewer.scrollTop = edge === "bottom"
          ? Math.max(0, viewer.scrollHeight - viewer.clientHeight)
          : 0;
      });
    }
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

  function drawingContext(canvas) {
    if (canvas?.id === "teacherBoardPdfCanvas") {
      return canvas.getContext("2d", { alpha: false }) || canvas.getContext("2d");
    }
    return canvas.getContext("2d", { alpha: true }) || canvas.getContext("2d");
  }

  function redrawCanvas(canvas, strokes) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = canvas.width / rect.width;
    const context = drawingContext(canvas);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    strokes.forEach(stroke => drawStroke(context, stroke, rect.width, rect.height));
  }

  function drawStrokeIncremental(canvas, stroke, startIndex) {
    if (!canvas || !stroke?.points?.length) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = canvas.width / rect.width;
    const from = Math.max(0, Math.min(startIndex, stroke.points.length - 1));
    const partialStroke = {
      ...stroke,
      points: stroke.points.slice(from)
    };
    const context = drawingContext(canvas);
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawStroke(context, partialStroke, rect.width, rect.height);
    context.restore();
  }

  function redrawInk() {
    const canvas = el("teacherBoardInkCanvas");
    if (!canvas || !canvas.width || !canvas.height) return;
    const context = drawingContext(canvas);
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);

    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, rect.width || canvas.width);
    const cssHeight = Math.max(1, rect.height || canvas.height);
    const ratio = canvas.width / cssWidth;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    [...state.strokes, ...(state.activeStroke ? [state.activeStroke] : [])]
      .forEach(stroke => drawStroke(context, stroke, cssWidth, cssHeight));
    context.setTransform(1, 0, 0, 1, 0, 0);
  }

  function setMode(mode) {
    state.mode = ["pen", "eraser", "move"].includes(mode) ? mode : "pen";
    document.querySelectorAll(".teacher-board-mode").forEach(button => {
      button.classList.toggle("active", button.dataset.boardMode === state.mode);
    });
    const ink = el("teacherBoardInkCanvas");
    const pdf = el("teacherBoardPdfCanvas");
    if (ink) ink.dataset.mode = state.mode;
    if (pdf) pdf.dataset.mode = state.mode;
  }

  function bindDrawingCanvas(canvas, options) {
    if (!canvas) return;

    canvas.addEventListener("pointerdown", event => {
      // Hikvision may report its side pen as a touch pointer. In Pen/Eraser,
      // one pointer writes; two pointers are reserved for pinch zoom.
      if (
        canvas.id === "teacherBoardInkCanvas" &&
        event.pointerType === "touch" &&
        (state.touchPointers.size > 1 || state.touchWaitForRelease)
      ) return;
      if (state.mode === "move" || event.button > 0) return;
      if (canvas.id === "teacherBoardInkCanvas") pauseBoardBackgroundWork();
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      const point = canvasPoint(event, canvas);
      const rect = canvas.getBoundingClientRect();
      const tool = state.mode === "eraser" ? "eraser" : "pen";
      const brushWidth = tool === "eraser" ? state.eraserWidth : state.width;
      const stroke = {
        id: makeId(),
        pointerId: event.pointerId,
        tool,
        color: state.color,
        widthNorm: brushWidth / Math.max(1, rect.width),
        points: [point],
        renderedPointCount: 1,
        frameId: 0,
        lastPaintAt: 0
      };
      options.setActive(stroke);
      // Avoid a full high-resolution page composite at stroke start. Drawing
      // the first dot directly makes the pen respond immediately.
      if (canvas.id === "teacherBoardInkCanvas") {
        drawStrokeIncremental(canvas, stroke, 0);
      } else {
        options.redraw();
      }
    }, { passive: false });

    canvas.addEventListener("pointermove", event => {
      const stroke = options.getActive();
      if (!stroke || stroke.pointerId !== event.pointerId) return;
      event.preventDefault();
      const events = event.getCoalescedEvents?.() || [event];
      events.forEach(item => stroke.points.push(canvasPoint(item, canvas)));
      // Batch high-frequency pointer events into one paint per animation
      // frame. This keeps the pen smooth on the large Hikvision canvas.
      if (stroke.frameId) return;
      const paintStroke = timestamp => {
        stroke.frameId = 0;
        if (options.getActive() !== stroke) return;
        drawStrokeIncremental(
          canvas,
          stroke,
          Math.max(0, Number(stroke.renderedPointCount || 1) - 1)
        );
        stroke.lastPaintAt = timestamp;
        stroke.renderedPointCount = stroke.points.length;
      };
      stroke.frameId = requestAnimationFrame(paintStroke);
    }, { passive: false });

    const finish = event => {
      const stroke = options.getActive();
      if (!stroke || stroke.pointerId !== event.pointerId) return;
      event.preventDefault();
      if (stroke.frameId) {
        cancelAnimationFrame(stroke.frameId);
        stroke.frameId = 0;
      }
      if (stroke.points.length === 1) stroke.points.push({ ...stroke.points[0] });
      if (canvas.id === "teacherBoardInkCanvas") {
        drawStrokeIncremental(
          canvas,
          stroke,
          Math.max(0, Number(stroke.renderedPointCount || 1) - 1)
        );
      }
      options.commit(stroke);
      options.setActive(null);
      if (canvas.id !== "teacherBoardInkCanvas") {
        options.redraw();
      }
      options.save();
      try {
        canvas.releasePointerCapture?.(event.pointerId);
      } catch {}
    };

    canvas.addEventListener("pointerup", finish, { passive: false });
    canvas.addEventListener("pointercancel", finish, { passive: false });
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

  function clampMiniPosition() {
    const mini = el("teacherBoardMini");
    const shell = mini?.closest(".teacher-board-shell");
    if (!mini || !shell || mini.classList.contains("hidden") || !mini.style.top) return;
    const shellRect = shell.getBoundingClientRect();
    const miniRect = mini.getBoundingClientRect();
    const left = Math.min(Math.max(0, miniRect.left - shellRect.left), Math.max(0, shellRect.width - miniRect.width));
    const top = Math.min(Math.max(0, miniRect.top - shellRect.top), Math.max(0, shellRect.height - miniRect.height));
    mini.style.left = `${left}px`;
    mini.style.top = `${top}px`;
    mini.style.right = "auto";
    mini.style.bottom = "auto";
  }

  function bindMiniDrag() {
    const mini = el("teacherBoardMini");
    const handle = mini?.querySelector(".teacher-board-mini-head");
    const shell = mini?.closest(".teacher-board-shell");
    if (!mini || !handle || !shell) return;
    let drag = null;

    handle.addEventListener("pointerdown", event => {
      if (event.target.closest("button")) return;
      const miniRect = mini.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - miniRect.left,
        offsetY: event.clientY - miniRect.top
      };
      mini.style.left = `${miniRect.left - shellRect.left}px`;
      mini.style.top = `${miniRect.top - shellRect.top}px`;
      mini.style.right = "auto";
      mini.style.bottom = "auto";
      handle.setPointerCapture?.(event.pointerId);
      handle.classList.add("dragging");
      event.preventDefault();
    }, { passive: false });

    handle.addEventListener("pointermove", event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const shellRect = shell.getBoundingClientRect();
      const maxLeft = Math.max(0, shellRect.width - mini.offsetWidth);
      const maxTop = Math.max(0, shellRect.height - mini.offsetHeight);
      const left = Math.min(maxLeft, Math.max(0, event.clientX - shellRect.left - drag.offsetX));
      const top = Math.min(maxTop, Math.max(0, event.clientY - shellRect.top - drag.offsetY));
      mini.style.left = `${left}px`;
      mini.style.top = `${top}px`;
      event.preventDefault();
    }, { passive: false });

    const finishDrag = event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag = null;
      handle.classList.remove("dragging");
      try { handle.releasePointerCapture?.(event.pointerId); } catch {}
      clampMiniPosition();
    };
    handle.addEventListener("pointerup", finishDrag);
    handle.addEventListener("pointercancel", finishDrag);
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
    state.sessionGroupId = select.value || "";
    populateBookGroupSelect();
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

    const studentButton = student => `
      <button type="button" class="teacher-board-student" data-board-student="${safeText(student.id)}" title="إضافة نقطة مشاركة إلى ${safeText(student.name)}">
        <span class="teacher-board-student-count">${pointCountForStudent(student.id)}</span>
        <span class="teacher-board-student-name">${safeText(student.name)}</span>
      </button>
    `;
    const leftStudents = groupStudents.filter((_, index) => index % 2 === 0);
    const rightStudents = groupStudents.filter((_, index) => index % 2 === 1);
    target.innerHTML = `
      <div class="teacher-board-student-rail teacher-board-student-rail-left">
        ${leftStudents.map(studentButton).join("")}
      </div>
      <div class="teacher-board-student-rail teacher-board-student-rail-right">
        ${rightStudents.map(studentButton).join("")}
      </div>
    `;

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

      // Short rising coin/chime sound, kept below half a second so it never
      // interrupts the lesson.
      [740, 990, 1320].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = index === 2 ? "sine" : "triangle";
        oscillator.frequency.value = frequency;
        const start = now + index * 0.055;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(index === 2 ? 0.09 : 0.14, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.21);
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

  async function openBookForSelectedGroup({ openLibraryIfMissing = true } = {}) {
    const groupId = String(el("teacherBoardGroup")?.value || "");
    const switchToken = ++state.groupSwitchToken;
    state.selectedGroupBookId = "";

    if (!groupId) {
      await closeCurrentBook({ skipMiniSave: true });
      renderBooks();
      return false;
    }

    try {
      const setting = await dbGet("settings", groupBookSettingKey(groupId));
      if (switchToken !== state.groupSwitchToken) return false;
      const book = setting?.value ? await dbGet("books", setting.value) : null;
      if (switchToken !== state.groupSwitchToken) return false;

      if (book) {
        state.selectedGroupBookId = book.id;
        renderBooks();
        if (String(state.currentBook?.id || "") === String(book.id)) {
          await loadMiniBoard().catch(handleStorageError);
          return true;
        }
        await openBook(book, { groupId, skipMiniSave: true });
        return true;
      }

      await closeCurrentBook({ skipMiniSave: true });
      renderBooks();
      if (openLibraryIfMissing) {
        setLibraryOpen(true);
        showToast("اختر كتاب هذه المجموعة أول مرة — وسيتم تذكره تلقائيًا");
      }
      await loadMiniBoard().catch(handleStorageError);
      return false;
    } catch (error) {
      handleStorageError(error);
      return false;
    }
  }

  async function onSessionContextChange(event) {
    // Capture the old context immediately, but do not make the visible group
    // wait for IndexedDB or for a large PDF to be parsed.
    const miniSavePromise = saveMiniBoard(true).catch(handleStorageError);
    const groupChanged = event?.target?.id === "teacherBoardGroup";
    state.sessionGroupId = el("teacherBoardGroup")?.value || "";
    state.sessionDate = el("teacherBoardDate")?.value || "";
    renderBoardStudents();
    if (groupChanged) {
      populateBookGroupSelect();
      setLoading(true, "جارٍ فتح كتاب المجموعة…");
      await new Promise(resolve => requestAnimationFrame(resolve));
      await openBookForSelectedGroup();
    } else {
      await miniSavePromise;
      await loadMiniBoard().catch(handleStorageError);
    }
    setLoading(false);
    renderBoardStudents();
  }


  function applyBoardPan() {
    const wrap = el("teacherBoardCanvasWrap");
    if (wrap) wrap.style.transform = `translate(${state.panX}px, ${state.panY}px)`;
  }

  function pauseBoardBackgroundWork() {
    clearTimeout(state.renderTimer);
    clearTimeout(state.qualityTimer);
    clearTimeout(state.idlePrefetchTimer);
    clearTimeout(state.previewSaveTimer);
  }

  function scheduleSettledPageRender(delay = 520) {
    if (!state.pdfDocument || !state.active) return;
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(() => {
      if (state.activeStroke || state.touchGesture) {
        scheduleSettledPageRender(delay);
        return;
      }
      renderPage({ showLoading: false });
    }, delay);
  }

  function resetBoardPan() {
    state.panX = 0;
    state.panY = 0;
    const wrap = el("teacherBoardCanvasWrap");
    if (wrap) wrap.style.transform = "";
  }

  function bindBoardPan() {
    const canvas = el("teacherBoardInkCanvas");
    if (!canvas) return;
    let drag = null;
    canvas.addEventListener("pointerdown", event => {
      if (event.pointerType === "touch") return;
      if (state.mode !== "move" || event.button > 0) return;
      event.preventDefault();
      pauseBoardBackgroundWork();
      drag = { pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, panX:state.panX, panY:state.panY, frameId:0 };
      canvas.setPointerCapture?.(event.pointerId);
      canvas.classList.add("teacher-board-panning");
    }, { passive:false });
    canvas.addEventListener("pointermove", event => {
      if (!drag || drag.pointerId !== event.pointerId || state.mode !== "move") return;
      event.preventDefault();
      state.panX = drag.panX + event.clientX - drag.startX;
      state.panY = drag.panY + event.clientY - drag.startY;
      if (!drag.frameId) {
        drag.frameId = requestAnimationFrame(() => {
          if (!drag) return;
          drag.frameId = 0;
          applyBoardPan();
        });
      }
    }, { passive:false });
    const finish = event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.frameId) cancelAnimationFrame(drag.frameId);
      applyBoardPan();
      drag = null;
      canvas.classList.remove("teacher-board-panning");
      try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
  }

  function applyInstantZoomPreview(previousZoom, nextZoom) {
    const wrap = el("teacherBoardCanvasWrap");
    if (!wrap || !state.pageBaseCanvas) return;
    const ratio = nextZoom / Math.max(0.01, previousZoom || 1);
    const currentWidth = parseFloat(wrap.style.width) || wrap.getBoundingClientRect().width;
    const currentHeight = parseFloat(wrap.style.height) || wrap.getBoundingClientRect().height;
    wrap.style.width = `${Math.max(1, currentWidth * ratio)}px`;
    wrap.style.height = `${Math.max(1, currentHeight * ratio)}px`;

    const pdfCanvas = el("teacherBoardPdfCanvas");
    if (pdfCanvas) {
      const cssWidth = parseFloat(pdfCanvas.style.width) || currentWidth;
      const cssHeight = parseFloat(pdfCanvas.style.height) || currentHeight;
      pdfCanvas.style.width = `${Math.max(1, cssWidth * ratio)}px`;
      pdfCanvas.style.height = `${Math.max(1, cssHeight * ratio)}px`;
    }
    const inkCanvas = el("teacherBoardInkCanvas");
    if (inkCanvas) {
      const cssWidth = parseFloat(inkCanvas.style.width) || currentWidth;
      const cssHeight = parseFloat(inkCanvas.style.height) || currentHeight;
      inkCanvas.style.width = `${Math.max(1, cssWidth * ratio)}px`;
      inkCanvas.style.height = `${Math.max(1, cssHeight * ratio)}px`;
    }
  }

  function setBoardZoom(nextZoom) {
    if (!state.pdfDocument) return;
    pauseBoardBackgroundWork();
    const previousZoom = state.zoom;
    const normalized = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.round(Number(nextZoom || 1) * 100) / 100)
    );
    if (normalized === previousZoom) return;
    state.zoom = normalized;
    applyInstantZoomPreview(previousZoom, normalized);
    updateBookUi();
    clearTimeout(state.renderTimer);
    clearTimeout(state.idlePrefetchTimer);
  }

  function touchDistance(points) {
    if (points.length < 2) return 0;
    return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  }

  function touchCenter(points) {
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2
    };
  }

  function beginSingleTouchGesture(viewer, event) {
    state.touchGesture = {
      type: "pan",
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      edgePull: 0,
      edgeDirection: "",
      turning: false
    };
    try { event.target.setPointerCapture?.(event.pointerId); } catch {}
  }

  function cancelActivePdfStroke() {
    if (!state.activeStroke) return;
    state.activeStroke = null;
    redrawInk();
  }

  function beginPinchGesture(viewer) {
    const points = [...state.touchPointers.values()];
    if (points.length < 2) return;
    const center = touchCenter(points);
    const rect = viewer.getBoundingClientRect();
    state.touchGesture = {
      type: "pinch",
      startDistance: Math.max(1, touchDistance(points)),
      startZoom: state.zoom,
      lastZoom: state.zoom,
      pendingZoom: state.zoom,
      frameId: 0,
      centerX: center.x - rect.left,
      centerY: center.y - rect.top
    };
  }

  function applyPendingPinchZoom(viewer, gesture) {
    if (!gesture || gesture.type !== "pinch") return;
    const previousZoom = state.zoom;
    const oldScrollWidth = Math.max(1, viewer.scrollWidth);
    const oldScrollHeight = Math.max(1, viewer.scrollHeight);
    setBoardZoom(gesture.pendingZoom);
    if (state.zoom === previousZoom) return;
    const widthRatio = viewer.scrollWidth / oldScrollWidth;
    const heightRatio = viewer.scrollHeight / oldScrollHeight;
    viewer.scrollLeft = (viewer.scrollLeft + gesture.centerX) * widthRatio - gesture.centerX;
    viewer.scrollTop = (viewer.scrollTop + gesture.centerY) * heightRatio - gesture.centerY;
    gesture.lastZoom = state.zoom;
  }

  function bindTouchNavigation() {
    const viewer = el("teacherBoardViewer");
    if (!viewer) return;

    viewer.addEventListener("pointerdown", event => {
      if (event.pointerType !== "touch" || !state.pdfDocument) return;
      pauseBoardBackgroundWork();
      state.touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (state.touchPointers.size >= 2) {
        event.preventDefault();
        cancelActivePdfStroke();
        state.touchWaitForRelease = true;
        beginPinchGesture(viewer);
        return;
      }

      const drawingOnPage =
        event.target?.id === "teacherBoardInkCanvas" &&
        state.mode !== "move";
      if (drawingOnPage) {
        // Do not prevent the event: the canvas listener must receive it and
        // start the ink stroke.
        state.touchGesture = { type: "draw", pointerId: event.pointerId };
        return;
      }

      event.preventDefault();
      beginSingleTouchGesture(viewer, event);
    }, { passive: false, capture: true });

    viewer.addEventListener("pointermove", event => {
      if (event.pointerType !== "touch" || !state.touchPointers.has(event.pointerId)) return;
      event.preventDefault();
      state.touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (state.touchPointers.size >= 2) {
        event.preventDefault();
        if (state.touchGesture?.type !== "pinch") beginPinchGesture(viewer);
        const gesture = state.touchGesture;
        const points = [...state.touchPointers.values()];
        const distance = touchDistance(points);
        gesture.pendingZoom = gesture.startZoom * distance / gesture.startDistance;
        if (!gesture.frameId) {
          gesture.frameId = requestAnimationFrame(() => {
            gesture.frameId = 0;
            applyPendingPinchZoom(viewer, gesture);
          });
        }
        return;
      }

      const gesture = state.touchGesture;
      if (gesture?.type === "draw" || gesture?.type === "wait") return;
      if (!gesture || gesture.type !== "pan" || gesture.pointerId !== event.pointerId) return;
      event.preventDefault();
      const deltaX = event.clientX - gesture.lastX;
      const deltaY = event.clientY - gesture.lastY;
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;

      const maxTop = Math.max(0, viewer.scrollHeight - viewer.clientHeight);
      const atTop = viewer.scrollTop <= 2;
      const atBottom = viewer.scrollTop >= maxTop - 2;
      viewer.scrollLeft -= deltaX;
      viewer.scrollTop -= deltaY;

      let edgeDirection = "";
      let edgeAmount = 0;
      if (atBottom && deltaY < 0 && state.pageNumber < state.pageCount) {
        edgeDirection = "next";
        edgeAmount = -deltaY;
      } else if (atTop && deltaY > 0 && state.pageNumber > 1) {
        edgeDirection = "previous";
        edgeAmount = deltaY;
      }

      if (edgeDirection) {
        gesture.edgePull = gesture.edgeDirection === edgeDirection
          ? gesture.edgePull + edgeAmount
          : edgeAmount;
        gesture.edgeDirection = edgeDirection;
      } else {
        gesture.edgePull = Math.max(0, gesture.edgePull - Math.abs(deltaY) * 1.5);
        gesture.edgeDirection = "";
      }

      if (!gesture.turning && gesture.edgePull >= PAGE_EDGE_PULL_PX) {
        gesture.turning = true;
        if (gesture.edgeDirection === "next") {
          goToPage(state.pageNumber + 1, { edge: "top" });
        } else {
          goToPage(state.pageNumber - 1, { edge: "bottom" });
        }
      }
    }, { passive: false, capture: true });

    const finishTouch = event => {
      if (event.pointerType !== "touch") return;
      const finishedGesture = state.touchGesture?.type;
      const finishedGestureState = state.touchGesture;
      state.touchPointers.delete(event.pointerId);
      if (state.touchPointers.size === 1) {
        // After a pinch, wait until both fingers are lifted. Starting a new
        // stroke or pan from the remaining finger would cause a stray mark.
        if (finishedGesture === "pinch" || state.touchWaitForRelease) {
          if (finishedGestureState?.frameId) {
            cancelAnimationFrame(finishedGestureState.frameId);
            finishedGestureState.frameId = 0;
            applyPendingPinchZoom(viewer, finishedGestureState);
          }
          state.touchGesture = { type: "wait" };
        }
      } else if (!state.touchPointers.size) {
        if (finishedGesture === "pinch" && finishedGestureState?.frameId) {
          cancelAnimationFrame(finishedGestureState.frameId);
          finishedGestureState.frameId = 0;
          applyPendingPinchZoom(viewer, finishedGestureState);
        }
        state.touchWaitForRelease = false;
        state.touchGesture = null;
      }
    };
    viewer.addEventListener("pointerup", finishTouch, { capture: true });
    viewer.addEventListener("pointercancel", finishTouch, { capture: true });
  }


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
    build.textContent = "V60";
    nav.append(build, pageGroup, zoomGroup);
    const controls = document.createElement("div");
    controls.className = "teacher-board-controls-row";
    toolbar.parentNode.insertBefore(controls, toolbar);
    controls.append(nav, toolbar);
  }

  function bindEvents() {
    el("teacherBoardLibraryBtn")?.addEventListener("click", () => setLibraryOpen(true));
    el("teacherBoardWelcomeLibrary")?.addEventListener("click", () => setLibraryOpen(true));
    el("teacherBoardLibraryClose")?.addEventListener("click", () => setLibraryOpen(false));
    el("teacherBoardAddPdfBtn")?.addEventListener("click", () => {
      el("teacherBoardPdfInput")?.click();
    });
    el("teacherBoardRemovePdfBtn")?.addEventListener("click", event => {
      if (state.currentBook?.id) deleteBook(state.currentBook.id, event.currentTarget);
    });
    el("teacherBoardPdfInput")?.addEventListener("change", event => importPdf(event.target.files?.[0]));
    el("teacherBoardBookSearch")?.addEventListener("input", renderBooks);

    el("teacherBoardPrevPage")?.addEventListener("click", () => goToPage(state.pageNumber - 1));
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
    el("teacherBoardZoomOut")?.addEventListener("click", () => {
      setBoardZoom(state.zoom - 0.15);
    });
    el("teacherBoardZoomIn")?.addEventListener("click", () => {
      setBoardZoom(state.zoom + 0.15);
    });
    el("teacherBoardFit")?.addEventListener("click", () => {
      pauseBoardBackgroundWork();
      const previousZoom = state.zoom;
      state.zoom = 1;
      applyInstantZoomPreview(previousZoom, state.zoom);
      resetBoardPan();
      updateBookUi();
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
    el("teacherBoardEraserWidth")?.addEventListener("input", event => {
      state.eraserWidth = Number(event.target.value || 36);
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
      requestAnimationFrame(() => { resizeMiniCanvas(); clampMiniPosition(); });
    });
    el("teacherBoardMiniHalf")?.addEventListener("click", () => {
      el("teacherBoardMini").dataset.size = "half";
      requestAnimationFrame(() => { resizeMiniCanvas(); clampMiniPosition(); });
    });
    el("teacherBoardMiniClear")?.addEventListener("click", event => {
      if (!state.miniStrokes.length) return;
      const button = event.currentTarget;
      const now = Date.now();
      if (now > state.miniClearArmedUntil) {
        state.miniClearArmedUntil = now + 2400;
        button.textContent = "Confirm?";
        setTimeout(() => {
          if (Date.now() > state.miniClearArmedUntil && button.textContent === "Confirm?") {
            button.textContent = "Clear";
          }
        }, 2500);
        return;
      }
      state.miniClearArmedUntil = 0;
      button.textContent = "Clear";
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

    const setPseudoFullscreen = active => {
      const shell = el("teacherBoard")?.querySelector(".teacher-board-shell");
      if (!shell) return;
      shell.classList.toggle("teacher-board-pseudo-fullscreen", Boolean(active));
      document.body.classList.toggle("teacher-board-fullscreen-active", Boolean(active));
      const button = el("teacherBoardFullscreenToolBtn");
      if (button) button.innerHTML = active ? "✕ Exit Fullscreen" : "⛶ Fullscreen";
    };

    const resizeBoardAfterFullscreen = () => {
      window.scrollTo?.(0, 0);
      pauseBoardBackgroundWork();
      if (state.pdfDocument && state.active) clearRasterCache();
      scheduleSettledPageRender(900);
    };

    const toggleBoardFullscreen = async () => {
      const shell = el("teacherBoard")?.querySelector(".teacher-board-shell");
      if (!shell) return;
      const active = shell.classList.contains("teacher-board-pseudo-fullscreen");
      if (active) {
        if (document.fullscreenElement && document.exitFullscreen) {
          try { await document.exitFullscreen(); } catch {}
        }
        setPseudoFullscreen(false);
      } else {
        setPseudoFullscreen(true);
        if (shell.requestFullscreen) {
          try {
            await shell.requestFullscreen({ navigationUI: "hide" });
          } catch {
            // Pseudo fullscreen remains as a safe fallback on older Android.
          }
        }
      }
      resizeBoardAfterFullscreen();
    };
    el("teacherBoardFullscreenToolBtn")?.addEventListener("click", toggleBoardFullscreen);
    document.addEventListener("fullscreenchange", () => {
      const shell = el("teacherBoard")?.querySelector(".teacher-board-shell");
      if (!document.fullscreenElement && shell?.classList.contains("teacher-board-pseudo-fullscreen")) {
        setPseudoFullscreen(false);
        resizeBoardAfterFullscreen();
      }
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
          if (entry.target.id === "teacherBoardViewer") {
            clearTimeout(state.renderTimer);
            state.renderTimer = setTimeout(() => {
              if (state.activeStroke || state.pdfRenderTask) {
                scheduleRender();
                return;
              }
              renderPage({ showLoading: false });
            }, 260);
          }
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
    prepareToolbarLayout();
    bindEvents();
    bindMiniDrag();
    bindBoardPan();
    bindTouchNavigation();
    setMode("pen");
    updateBookUi();

    refreshBoardSessionDate();

    try {
      await openDatabase();
      await loadBooks();
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
    refreshBoardSessionDate();
    populateGroups();
    await openBookForSelectedGroup();
    renderBoardStudents();
    setStudentsOpen(true);
    updateStorageInfo();
    // A database migration may have become available since a previous failed
    // attempt. Clear errors for today's points and retry them automatically.
    currentPointEvents().forEach(event => {
      if (event.status !== "synced") event.lastError = "";
    });
    persistPointEvents();
    syncQueuedPoints(true);

    if (state.pdfDocument) {
      scheduleRender();
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

  function installPageLifecycleObserver() {
    const board = el("teacherBoard");
    const appShell = el("appShell");
    if (!board) return;

    let syncing = false;
    const sync = () => {
      if (syncing) return;
      syncing = true;
      Promise.resolve().then(async () => {
        const visible = board.classList.contains("active-page") && !appShell?.classList.contains("hidden");
        if (visible && !state.active) await activate();
        if (!visible && state.active) deactivate();
      }).finally(() => { syncing = false; });
    };

    const observer = new MutationObserver(sync);
    observer.observe(board, { attributes: true, attributeFilter: ["class"] });
    if (appShell) observer.observe(appShell, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        saveCurrentAnnotation(true).catch(() => {});
        saveMiniBoard(true).catch(() => {});
      }
    });
    setTimeout(sync, 0);
  }

  installPageLifecycleObserver();

  window.teacherBoard = {
    activate,
    deactivate,
    logout,
    refreshStudents: renderBoardStudents
  };
})();
