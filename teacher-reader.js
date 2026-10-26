(() => {
  "use strict";

  const PDF_MODULE_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs";
  const PDF_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs";
  const DB_NAME = "ef-teacher-reader-fresh";
  const DB_VERSION = 1;
  const POINT_QUEUE_KEY = "ef_teacher_reader_points_v1";
  const POINT_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;
  const el = id => document.getElementById(id);

  const state = {
    initialized: false,
    active: false,
    db: null,
    pdfModule: null,
    pdfDocument: null,
    book: null,
    mode: "hand",
    color: "#e53935",
    penWidth: 5,
    eraserWidth: 40,
    zoom: 1,
    fitWidth: 900,
    pages: new Map(),
    currentPage: 1,
    observer: null,
    zoomTimer: 0,
    saveTimers: new Map(),
    pointEvents: [],
    pointSyncing: false,
    audioContext: null
  };

  const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const today = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 10);
  };
  const safe = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);

  function openDatabase() {
    if (state.db) return Promise.resolve(state.db);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("books")) {
          const books = db.createObjectStore("books", { keyPath: "id" });
          books.createIndex("groupId", "groupId", { unique: false });
        }
        if (!db.objectStoreNames.contains("annotations")) {
          db.createObjectStore("annotations", { keyPath: "key" });
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

  function storeRequest(storeName, mode, action) {
    return openDatabase().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let request;
      try { request = action(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error || request?.error);
      tx.onabort = () => reject(tx.error || request?.error);
    }));
  }

  const putBook = book => storeRequest("books", "readwrite", store => store.put(book));
  const deleteBook = id => storeRequest("books", "readwrite", store => store.delete(id));
  const putAnnotation = record => storeRequest("annotations", "readwrite", store => store.put(record));
  const getAnnotation = key => storeRequest("annotations", "readonly", store => store.get(key));
  function booksForGroup(groupId) {
    return storeRequest("books", "readonly", store => store.index("groupId").getAll(String(groupId)));
  }

  function selectedGroup() {
    return typeof groupById === "function" ? groupById(el("teacherReaderGroup")?.value || "") : null;
  }

  function studentsForGroup() {
    const group = selectedGroup();
    if (!group || typeof students === "undefined") return [];
    return students.filter(student => {
      const resolved = typeof groupById === "function" ? groupById(student.group) : null;
      return String(student.group) === String(group.id) ||
        String(student.group) === String(group.code || "") ||
        String(resolved?.id || "") === String(group.id);
    });
  }

  function populateGroups() {
    const select = el("teacherReaderGroup");
    if (!select || typeof groups === "undefined") return;
    const current = select.value;
    select.innerHTML = '<option value="">اختر المجموعة</option>' + groups.map(group =>
      `<option value="${safe(group.id)}">${safe(group.name)}</option>`
    ).join("");
    if (groups.some(group => String(group.id) === String(current))) select.value = current;
    else if (groups[0]) select.value = groups[0].id;
  }

  function readPointEvents() {
    try {
      const oldest = Date.now() - POINT_RETENTION_MS;
      const parsed = JSON.parse(localStorage.getItem(POINT_QUEUE_KEY) || "[]");
      state.pointEvents = Array.isArray(parsed)
        ? parsed.filter(item => new Date(item.createdAt).getTime() >= oldest)
        : [];
    } catch { state.pointEvents = []; }
    persistPointEvents();
  }

  function persistPointEvents() {
    localStorage.setItem(POINT_QUEUE_KEY, JSON.stringify(state.pointEvents.slice(-1200)));
  }

  function currentPointEvents() {
    const group = selectedGroup();
    const date = el("teacherReaderDate")?.value || "";
    if (!group || !date) return [];
    return state.pointEvents.filter(item =>
      String(item.groupId) === String(group.id) && String(item.sessionDate) === date
    );
  }

  function pointCount(studentId) {
    return currentPointEvents()
      .filter(item => String(item.studentId) === String(studentId))
      .reduce((total, item) => total + Number(item.points || 0), 0);
  }

  function pointStatus() {
    const status = el("teacherReaderStatus");
    const retry = el("teacherReaderRetryPoints");
    if (!status) return;
    const events = currentPointEvents();
    const pending = events.filter(item => item.status !== "synced");
    const failed = pending.filter(item => item.lastError);
    if (!selectedGroup()) status.textContent = "اختر المجموعة أولًا";
    else if (failed.length) status.textContent = `تعذر إرسال ${failed.length} نقطة — اضغط إعادة الإرسال`;
    else if (pending.length) status.textContent = `محفوظة وتنتظر الإرسال: ${pending.length}`;
    else if (events.length) status.textContent = `تم تسجيل ${events.length} نقطة للحصة`;
    else status.textContent = "كل ضغطة على اسم الطالب = نقطة مشاركة";
    if (retry) retry.hidden = failed.length === 0;
  }

  function renderStudents() {
    const left = el("teacherReaderStudentsLeft");
    const right = el("teacherReaderStudentsRight");
    if (!left || !right) return;
    const list = studentsForGroup();
    const button = student => `<button type="button" class="teacher-reader-student" data-reader-student="${safe(student.id)}">
      <span class="teacher-reader-student-count">${pointCount(student.id)}</span>
      <span class="teacher-reader-student-name">${safe(student.name)}</span>
    </button>`;
    left.innerHTML = list.filter((_, index) => index % 2 === 0).map(button).join("");
    right.innerHTML = list.filter((_, index) => index % 2 === 1).map(button).join("");
    document.querySelectorAll("[data-reader-student]").forEach(item => {
      item.addEventListener("click", () => addPoint(item.dataset.readerStudent, item));
    });
    pointStatus();
  }

  function playPointSound() {
    try {
      const AudioClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioClass) return;
      state.audioContext ||= new AudioClass();
      const context = state.audioContext;
      if (context.state === "suspended") context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1320, context.currentTime + .12);
      gain.gain.setValueAtTime(.12, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .18);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + .19);
    } catch {}
  }

  function addPoint(studentId, button) {
    const group = selectedGroup();
    const sessionDate = el("teacherReaderDate")?.value;
    if (!group || !sessionDate) { showToast("اختر المجموعة وتاريخ الحصة أولًا"); return; }
    state.pointEvents.push({
      id: makeId(), studentId,
      studentName: students.find(item => String(item.id) === String(studentId))?.name || "طالب",
      groupId: group.id, sessionDate, points: 1, status: "pending", lastError: "",
      createdAt: new Date().toISOString()
    });
    persistPointEvents();
    playPointSound();
    renderStudents();
    const fresh = document.querySelector(`[data-reader-student="${CSS.escape(String(studentId))}"]`) || button;
    fresh?.classList.add("point-added");
    setTimeout(() => fresh?.classList.remove("point-added"), 260);
    syncPoints();
  }

  async function syncPoints(force = false) {
    if (state.pointSyncing || typeof currentAppRole === "undefined" || currentAppRole !== "owner" || !navigator.onLine) {
      pointStatus(); return;
    }
    state.pointSyncing = true;
    try {
      const supabase = await getSupabase();
      for (const event of state.pointEvents.filter(item => item.status !== "synced" && (force || !item.lastError))) {
        try {
          const { data, error } = await supabase.rpc("queue_owner_teacher_board_point", {
            p_student_id: event.studentId,
            p_points: event.points,
            p_event_key: `teacher_reader_${String(event.id).replaceAll("-", "")}`,
            p_session_date: event.sessionDate
          });
          if (error) throw error;
          if (data?.blocked || data?.closed || data?.success === false) {
            event.lastError = data?.message || "تعذر تسجيل النقطة لهذه الحصة";
          } else {
            event.status = "synced"; event.lastError = ""; event.syncedAt = new Date().toISOString();
          }
        } catch (error) {
          event.lastError = error?.message || "تعذر الاتصال";
        }
        persistPointEvents(); renderStudents();
      }
    } finally { state.pointSyncing = false; pointStatus(); }
  }

  async function loadPdfModule() {
    if (state.pdfModule) return state.pdfModule;
    state.pdfModule = await import(PDF_MODULE_URL);
    state.pdfModule.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    return state.pdfModule;
  }

  function annotationKey(pageNumber) { return `${state.book?.id || "none"}:${pageNumber}`; }
  async function loadStrokes(pageNumber) {
    const record = await getAnnotation(annotationKey(pageNumber)).catch(() => null);
    return Array.isArray(record?.strokes) ? record.strokes : [];
  }
  function saveStrokes(info) {
    clearTimeout(state.saveTimers.get(info.number));
    const key = annotationKey(info.number);
    const bookId = state.book.id;
    const timer = setTimeout(() => {
      putAnnotation({ key, bookId, page: info.number, strokes: info.strokes, updatedAt: Date.now() })
        .catch(error => console.warn("Annotation save failed", error));
      state.saveTimers.delete(info.number);
    }, 160);
    state.saveTimers.set(info.number, timer);
  }

  function pageCssSize(info) {
    return { width: info.baseWidth * state.zoom, height: info.baseHeight * state.zoom };
  }
  function resizeInk(info) {
    const size = pageCssSize(info);
    info.wrap.style.width = `${size.width}px`;
    info.wrap.style.height = `${size.height}px`;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    info.ink.width = Math.max(1, Math.round(size.width * ratio));
    info.ink.height = Math.max(1, Math.round(size.height * ratio));
    info.ink.style.width = `${size.width}px`; info.ink.style.height = `${size.height}px`;
    info.inkRatio = ratio;
    redrawInk(info);
  }

  function strokePaint(ctx, stroke, info) {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(1, Number(stroke.width || 5) * state.zoom * info.inkRatio);
  }
  function drawStroke(ctx, stroke, info) {
    if (!stroke?.points?.length) return;
    const w = info.ink.width, h = info.ink.height;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * w, stroke.points[0].y * h);
    for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x * w, stroke.points[i].y * h);
    if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x * w + .01, stroke.points[0].y * h + .01);
    strokePaint(ctx, stroke, info); ctx.stroke();
  }
  function redrawInk(info) {
    const ctx = info.ink.getContext("2d");
    ctx.clearRect(0, 0, info.ink.width, info.ink.height);
    info.strokes.forEach(stroke => drawStroke(ctx, stroke, info));
  }

  function pointerPoint(event, info) {
    const rect = info.ink.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function strokeHit(stroke, point, radius) {
    return stroke.points?.some(sample => Math.hypot(sample.x - point.x, sample.y - point.y) <= radius);
  }
  function bindInk(info) {
    const canvas = info.ink;
    let active = null;
    const erase = point => {
      const radius = (state.eraserWidth / Math.max(1, canvas.clientWidth)) / state.zoom;
      const before = info.strokes.length;
      info.strokes = info.strokes.filter(stroke => !strokeHit(stroke, point, radius));
      if (info.strokes.length !== before) { redrawInk(info); saveStrokes(info); }
    };
    canvas.addEventListener("pointerdown", event => {
      if (state.mode === "hand") return;
      event.preventDefault(); state.currentPage = info.number;
      canvas.setPointerCapture?.(event.pointerId);
      const point = pointerPoint(event, info);
      if (state.mode === "eraser") { active = { pointerId: event.pointerId, erasing: true }; erase(point); return; }
      active = { pointerId: event.pointerId, color: state.color, width: state.penWidth, points: [point] };
    }, { passive: false });
    canvas.addEventListener("pointermove", event => {
      if (!active || active.pointerId !== event.pointerId) return;
      event.preventDefault();
      const events = event.getCoalescedEvents?.() || [event];
      if (active.erasing) { events.forEach(item => erase(pointerPoint(item, info))); return; }
      const ctx = canvas.getContext("2d");
      for (const item of events) {
        const next = pointerPoint(item, info);
        const previous = active.points[active.points.length - 1];
        active.points.push(next);
        ctx.beginPath();
        ctx.moveTo(previous.x * canvas.width, previous.y * canvas.height);
        ctx.lineTo(next.x * canvas.width, next.y * canvas.height);
        strokePaint(ctx, active, info); ctx.stroke();
      }
    }, { passive: false });
    const finish = event => {
      if (!active || active.pointerId !== event.pointerId) return;
      if (!active.erasing) {
        if (active.points.length === 1) active.points.push({ ...active.points[0] });
        info.strokes.push(active); saveStrokes(info);
      }
      try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
      active = null;
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
  }

  async function renderPdfPage(info, force = false) {
    if (!info || !state.pdfDocument || (!force && info.renderedZoom === state.zoom)) return;
    if (info.renderTask) { try { info.renderTask.cancel(); } catch {} }
    const pdfPage = info.pdfPage || await state.pdfDocument.getPage(info.number);
    info.pdfPage = pdfPage;
    if (!info.sizeResolved) {
      const natural = pdfPage.getViewport({ scale: 1 });
      info.baseScale = info.baseWidth / natural.width;
      info.baseHeight = info.baseWidth * natural.height / natural.width;
      info.sizeResolved = true;
      resizeInk(info);
    }
    const renderRatio = Math.min(window.devicePixelRatio || 1, 1.65);
    const viewport = pdfPage.getViewport({ scale: info.baseScale * state.zoom * renderRatio });
    const buffer = document.createElement("canvas");
    buffer.width = Math.max(1, Math.round(viewport.width)); buffer.height = Math.max(1, Math.round(viewport.height));
    const task = pdfPage.render({ canvasContext: buffer.getContext("2d", { alpha: false }), viewport });
    info.renderTask = task;
    try {
      await task.promise;
      if (state.pages.get(info.number) !== info) return;
      info.pdf.width = buffer.width; info.pdf.height = buffer.height;
      info.pdf.getContext("2d", { alpha: false }).drawImage(buffer, 0, 0);
      info.renderedZoom = state.zoom; info.wrap.classList.add("rendered");
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") console.warn("PDF page render failed", error);
    } finally { if (info.renderTask === task) info.renderTask = null; }
  }

  function renderVisiblePages(force = false) {
    const viewport = el("teacherReaderViewport");
    if (!viewport) return;
    const box = viewport.getBoundingClientRect();
    const visible = [...state.pages.values()].filter(info => {
      const rect = info.wrap.getBoundingClientRect();
      return rect.bottom > box.top - box.height && rect.top < box.bottom + box.height;
    });
    visible.forEach(info => { resizeInk(info); renderPdfPage(info, force); });
  }

  async function buildPages() {
    const container = el("teacherReaderPages");
    container.innerHTML = ""; state.pages.clear(); state.observer?.disconnect();
    state.fitWidth = Math.max(420, Math.min(1050, el("teacherReaderViewport").clientWidth - 38));
    const first = await state.pdfDocument.getPage(1);
    const firstViewport = first.getViewport({ scale: 1 });
    const defaultRatio = firstViewport.height / firstViewport.width;
    for (let number = 1; number <= state.pdfDocument.numPages; number++) {
      const baseWidth = state.fitWidth;
      const baseHeight = baseWidth * defaultRatio;
      const wrap = document.createElement("div");
      wrap.className = "teacher-reader-page-wrap"; wrap.dataset.page = number;
      wrap.innerHTML = `<canvas class="teacher-reader-pdf-canvas"></canvas><div class="teacher-reader-page-placeholder">صفحة ${number}</div><canvas class="teacher-reader-ink-canvas"></canvas>`;
      container.appendChild(wrap);
      const info = {
        number, pdfPage: number === 1 ? first : null, wrap,
        pdf: wrap.querySelector(".teacher-reader-pdf-canvas"),
        ink: wrap.querySelector(".teacher-reader-ink-canvas"),
        baseWidth, baseHeight, baseScale: baseWidth / firstViewport.width,
        sizeResolved: number === 1,
        strokes: [], renderedZoom: 0, renderTask: null
      };
      state.pages.set(number, info); resizeInk(info); bindInk(info);
      loadStrokes(number).then(strokes => {
        if (state.pages.get(number) !== info) return;
        info.strokes = strokes; redrawInk(info);
      });
    }
    state.observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const number = Number(entry.target.dataset.page);
          state.currentPage = number;
          resizeInk(state.pages.get(number));
          renderPdfPage(state.pages.get(number));
          renderPdfPage(state.pages.get(number - 1));
          renderPdfPage(state.pages.get(number + 1));
        }
      });
    }, { root: el("teacherReaderViewport"), rootMargin: "100% 0px", threshold: .01 });
    state.pages.forEach(info => state.observer.observe(info.wrap));
    container.hidden = false; el("teacherReaderEmpty").hidden = true;
    setMode(state.mode);
    renderVisiblePages(true);
  }

  async function openBook(book) {
    if (!book?.blob) return;
    el("teacherReaderBusy").hidden = false;
    try {
      state.pdfDocument?.destroy?.();
      state.book = book; state.zoom = 1; updateZoomText();
      const pdfjs = await loadPdfModule();
      const bytes = new Uint8Array(await book.blob.arrayBuffer());
      state.pdfDocument = await pdfjs.getDocument({ data: bytes }).promise;
      localStorage.setItem(`teacherReader:lastBook:${book.groupId}`, book.id);
      await buildPages();
    } catch (error) {
      console.error("Fresh PDF reader error", error);
      showToast("تعذر فتح ملف PDF — اختر الملف الأصلي مرة أخرى");
      el("teacherReaderPages").hidden = true; el("teacherReaderEmpty").hidden = false;
    } finally { el("teacherReaderBusy").hidden = true; }
  }

  async function refreshBooks(autoOpen = true) {
    const select = el("teacherReaderBook");
    const group = selectedGroup();
    const list = group ? await booksForGroup(group.id) : [];
    select.innerHTML = '<option value="">اختر الكتاب</option>' + list
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(book => `<option value="${safe(book.id)}">${safe(book.name)}</option>`).join("");
    const preferred = group ? localStorage.getItem(`teacherReader:lastBook:${group.id}`) : "";
    const chosen = list.find(book => book.id === preferred) || list[0];
    if (chosen) select.value = chosen.id;
    el("teacherReaderRemoveBook").disabled = !chosen;
    if (autoOpen && chosen) await openBook(chosen);
    if (!chosen) {
      state.book = null; state.pdfDocument?.destroy?.(); state.pdfDocument = null;
      state.pages.clear(); el("teacherReaderPages").innerHTML = ""; el("teacherReaderPages").hidden = true; el("teacherReaderEmpty").hidden = false;
    }
    return list;
  }

  async function addPdf(file) {
    const group = selectedGroup();
    if (!group) { showToast("اختر المجموعة قبل إضافة الكتاب"); return; }
    if (!file || (file.type && file.type !== "application/pdf")) { showToast("اختر ملف PDF صحيحًا"); return; }
    const book = { id: makeId(), groupId: String(group.id), name: file.name.replace(/\.pdf$/i, ""), blob: file, size: file.size, createdAt: Date.now() };
    await putBook(book);
    localStorage.setItem(`teacherReader:lastBook:${group.id}`, book.id);
    await refreshBooks(false); el("teacherReaderBook").value = book.id; await openBook(book);
    showToast("تم حفظ الكتاب لهذه المجموعة");
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll("[data-reader-mode]").forEach(button => button.classList.toggle("active", button.dataset.readerMode === mode));
    state.pages.forEach(info => {
      info.ink.style.pointerEvents = mode === "hand" ? "none" : "auto";
      info.ink.style.cursor = mode === "eraser" ? "cell" : mode === "pen" ? "crosshair" : "default";
    });
  }

  function updateZoomText() { if (el("teacherReaderZoomText")) el("teacherReaderZoomText").textContent = `${Math.round(state.zoom * 100)}%`; }
  function setZoom(value) {
    const viewport = el("teacherReaderViewport");
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / Math.max(.01, state.zoom);
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / Math.max(.01, state.zoom);
    state.zoom = Math.max(.55, Math.min(4, value)); updateZoomText();
    const viewportBox = viewport.getBoundingClientRect();
    state.pages.forEach(info => {
      const size = pageCssSize(info);
      info.wrap.style.width = `${size.width}px`; info.wrap.style.height = `${size.height}px`;
      const rect = info.wrap.getBoundingClientRect();
      if (rect.bottom > viewportBox.top - viewportBox.height && rect.top < viewportBox.bottom + viewportBox.height) resizeInk(info);
    });
    viewport.scrollLeft = centerX * state.zoom - viewport.clientWidth / 2;
    viewport.scrollTop = centerY * state.zoom - viewport.clientHeight / 2;
    clearTimeout(state.zoomTimer);
    state.zoomTimer = setTimeout(() => renderVisiblePages(true), 220);
  }

  function bindHandGestures() {
    const viewport = el("teacherReaderViewport");
    const pointers = new Map();
    let pan = null, pinch = null, zoomFrame = 0, pendingZoom = 1;
    const distance = values => Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
    viewport.addEventListener("pointerdown", event => {
      if (state.mode !== "hand") return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      viewport.setPointerCapture?.(event.pointerId);
      if (pointers.size === 1) pan = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
      if (pointers.size === 2) {
        const values = [...pointers.values()];
        pinch = { distance: Math.max(1, distance(values)), zoom: state.zoom };
      }
    });
    viewport.addEventListener("pointermove", event => {
      if (state.mode !== "hand" || !pointers.has(event.pointerId)) return;
      event.preventDefault();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2 && pinch) {
        pendingZoom = pinch.zoom * distance([...pointers.values()].slice(0, 2)) / pinch.distance;
        if (!zoomFrame) zoomFrame = requestAnimationFrame(() => { zoomFrame = 0; setZoom(pendingZoom); });
      } else if (pointers.size === 1 && pan) {
        viewport.scrollLeft = pan.left - (event.clientX - pan.x);
        viewport.scrollTop = pan.top - (event.clientY - pan.y);
      }
    }, { passive: false });
    const finish = event => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      const remaining = [...pointers.values()][0];
      pan = remaining ? { x: remaining.x, y: remaining.y, left: viewport.scrollLeft, top: viewport.scrollTop } : null;
      try { viewport.releasePointerCapture?.(event.pointerId); } catch {}
    };
    viewport.addEventListener("pointerup", finish);
    viewport.addEventListener("pointercancel", finish);
  }

  function undoCurrent() {
    const info = state.pages.get(state.currentPage);
    if (!info?.strokes.length) { showToast("لا توجد كتابة للتراجع عنها في هذه الصفحة"); return; }
    info.strokes.pop(); redrawInk(info); saveStrokes(info);
  }
  function clearCurrent() {
    const info = state.pages.get(state.currentPage);
    if (!info?.strokes.length) return;
    if (!confirm(`مسح كل الكتابة من الصفحة ${state.currentPage}؟`)) return;
    info.strokes = []; redrawInk(info); saveStrokes(info);
  }

  function toggleFullscreen() {
    const shell = el("teacherReader")?.querySelector(".teacher-reader-shell");
    const next = !shell?.classList.contains("reader-fullscreen");
    shell?.classList.toggle("reader-fullscreen", next);
    document.body.classList.toggle("teacher-reader-fullscreen-active", next);
    const button = el("teacherReaderFullscreen");
    if (button) button.textContent = next ? "✕ خروج" : "⛶ ملء الشاشة";
    if (next) shell?.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    setTimeout(() => { state.fitWidth = Math.max(420, Math.min(1050, el("teacherReaderViewport").clientWidth - 38)); renderVisiblePages(true); }, 250);
  }

  function bindEvents() {
    bindHandGestures();
    el("teacherReaderGroup")?.addEventListener("change", async () => { renderStudents(); await refreshBooks(true); syncPoints(true); });
    el("teacherReaderDate")?.addEventListener("change", () => { renderStudents(); syncPoints(true); });
    el("teacherReaderBook")?.addEventListener("change", async event => {
      const list = selectedGroup() ? await booksForGroup(selectedGroup().id) : [];
      const book = list.find(item => item.id === event.target.value);
      el("teacherReaderRemoveBook").disabled = !book;
      if (book) openBook(book);
    });
    el("teacherReaderPdfInput")?.addEventListener("change", async event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (file) await addPdf(file);
    });
    el("teacherReaderRemoveBook")?.addEventListener("click", async () => {
      const id = el("teacherReaderBook")?.value;
      if (!id || !confirm("حذف هذا الكتاب من السبورة؟")) return;
      await deleteBook(id); await refreshBooks(true); showToast("تم حذف الكتاب");
    });
    document.querySelectorAll("[data-reader-mode]").forEach(button => button.addEventListener("click", () => setMode(button.dataset.readerMode)));
    el("teacherReaderColor")?.addEventListener("input", event => { state.color = event.target.value; setMode("pen"); });
    el("teacherReaderPenWidth")?.addEventListener("input", event => { state.penWidth = Number(event.target.value); });
    el("teacherReaderEraserWidth")?.addEventListener("input", event => { state.eraserWidth = Number(event.target.value); });
    el("teacherReaderUndo")?.addEventListener("click", undoCurrent);
    el("teacherReaderClear")?.addEventListener("click", clearCurrent);
    el("teacherReaderZoomOut")?.addEventListener("click", () => setZoom(state.zoom / 1.25));
    el("teacherReaderZoomIn")?.addEventListener("click", () => setZoom(state.zoom * 1.25));
    el("teacherReaderFit")?.addEventListener("click", () => setZoom(1));
    el("teacherReaderFullscreen")?.addEventListener("click", toggleFullscreen);
    el("teacherReaderRetryPoints")?.addEventListener("click", () => {
      currentPointEvents().forEach(item => { if (item.status !== "synced") item.lastError = ""; });
      persistPointEvents(); syncPoints(true);
    });
    window.addEventListener("online", () => syncPoints(true));
  }

  async function initialize() {
    if (state.initialized) return;
    state.initialized = true; readPointEvents(); bindEvents(); setMode("hand");
    el("teacherReaderDate").value = today();
    await openDatabase();
  }

  async function activate() {
    if (typeof currentAppRole !== "undefined" && currentAppRole !== "owner") {
      showToast("سبورة الشرح متاحة لحساب المالك فقط"); return;
    }
    state.active = true; await initialize(); populateGroups(); renderStudents(); await refreshBooks(true); syncPoints(true);
  }
  function deactivate() { state.active = false; }

  window.teacherReader = { activate, deactivate, refresh: () => { populateGroups(); renderStudents(); } };

  const page = el("teacherReader");
  if (page && typeof MutationObserver === "function") {
    new MutationObserver(() => {
      if (page.classList.contains("active-page")) activate();
      else deactivate();
    }).observe(page, { attributes: true, attributeFilter: ["class"] });
  }
})();
