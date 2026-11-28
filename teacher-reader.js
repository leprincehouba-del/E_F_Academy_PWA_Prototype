(() => {
  "use strict";

  const PDF_MODULE_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs";
  const PDF_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs";
  const PDF_CMAP_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/cmaps/";
  const PDF_STANDARD_FONT_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/standard_fonts/";
  const PDF_WASM_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/wasm/";
  const DB_NAME = "ef-teacher-reader-fresh";
  const DB_VERSION = 1;
  const POINT_QUEUE_KEY = "ef_teacher_reader_points_v1";
  const READING_PROGRESS_PREFIX = "ef_teacher_reader_progress_v1";
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
    zooming: false,
    renderQueue: [],
    renderLoopRunning: false,
    renderSequence: 0,
    renderScanFrame: 0,
    isDrawing: false,
    bitmapCacheLimit: 8,
    saveTimers: new Map(),
    pointEvents: [],
    pointSyncing: false,
    pointRetryTimer: 0,
    pointRetryDelay: 3000,
    blockedPointEntry: null,
    pointStorageFailed: false,
    pointSignInRequired: false,
    pointAuthChecking: true,
    audioContext: null,
    selectedReason: "participation",
    openingBook: false,
    bookGeneration: 0,
    bookRequest: 0,
    bookLoadTask: null,
    activation: null,
    lastPersistedProgress: ""
  };

  const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const cairoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit"
  });
  const today = () => cairoDate.format(new Date());

  async function boardDeadline(request, milliseconds = 10000) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve(request?.abortSignal ? request.abortSignal(controller.signal) : request),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("اتأخر الرد أثناء الاتصال"));
            controller.abort();
          }, milliseconds);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  const safe = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);

  function usesNativeBoardTools() {
    return document.body.classList.contains("screen-board-account") ||
      (typeof currentAppRole !== "undefined" && currentAppRole === "screen");
  }

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

  function readingProgressKey(book = state.book) {
    if (!book?.id || !book?.groupId) return "";
    return `${READING_PROGRESS_PREFIX}:${book.groupId}:${book.id}`;
  }

  function readBookPage(book) {
    const key = readingProgressKey(book);
    if (!key) return 1;
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "null");
      const page = Number(stored?.page ?? stored);
      return Number.isInteger(page) && page > 0 ? page : 1;
    } catch { return 1; }
  }

  function persistReadingProgress(pageNumber = state.currentPage, book = state.book) {
    if (state.openingBook) return;
    const key = readingProgressKey(book);
    const page = Number(pageNumber);
    if (!key || !Number.isInteger(page) || page < 1) return;
    const signature = `${key}:${page}`;
    if (state.lastPersistedProgress === signature) return;
    try {
      localStorage.setItem(key, JSON.stringify({ page, updatedAt: Date.now() }));
      state.lastPersistedProgress = signature;
    } catch {}
  }

  function setCurrentPage(pageNumber, persist = true) {
    const page = Number(pageNumber);
    if (!Number.isInteger(page) || page < 1) return;
    state.currentPage = page;
    if (persist) persistReadingProgress(page);
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

  const BOARD_ARREARS_LIMIT = 3;
  const BOARD_CLOSED_MESSAGE = "الحصة مسجلة أو بدأ إغلاقها بالفعل";
  const BOARD_ARREARS_MESSAGE = "النقاط الموجبة متوقفة حتى تسوية المتأخرات";

  async function refreshStudentArrears(refreshRanking = false) {
    const group = selectedGroup();
    if (!state.active || !group?.dbId || !navigator.onLine || state.arrearsRefreshGroup === group) return;
    state.arrearsRefreshGroup = group;
    const requestStarted = Date.now();
    try {
      const supabase = await getSupabase();
      const columns = refreshRanking ? "id, due_sessions_count, points_balance" : "id, due_sessions_count";
      const { data, error } = await supabase.from("students")
        .select(columns).eq("group_id", group.dbId).eq("is_active", true);
      if (error || !state.active || selectedGroup()?.dbId !== group.dbId) return;
      const records = new Map((data || []).map(row => [String(row.id), row]));
      let changed = false;
      for (const student of studentsForGroup()) {
        const row = records.get(String(student.id));
        if (!row) continue;
        if (refreshRanking && row.points_balance != null) {
          const points = Number(row.points_balance);
          changed ||= points !== student.points;
          student.points = points;
        }
        if (student.boardArrearsBlockedAt >= requestStarted) continue;
        const dueSessions = Number(row.due_sessions_count || 0);
        changed ||= (student.dueSessions >= BOARD_ARREARS_LIMIT) !== (dueSessions >= BOARD_ARREARS_LIMIT);
        student.dueSessions = dueSessions;
      }
      if (changed) renderStudents();
    } catch {
      // Keep the last known values while the connection is unavailable.
    } finally {
      if (state.arrearsRefreshGroup === group) state.arrearsRefreshGroup = null;
    }
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
        ? parsed.filter(item => item && (item.status === "pending" || new Date(item.createdAt).getTime() >= oldest)).map(item => {
            if (item.status !== "synced" && Number(item.points) > 0 && item.lastError === BOARD_ARREARS_MESSAGE) item.status = "rejected";
            return item;
          })
        : [];
    } catch { state.pointEvents = []; }
  }

  function persistPointEvents() {
    const recent = state.pointEvents.slice(-1200);
    const olderPending = state.pointEvents.slice(0, -1200).filter(item => item.status === "pending");
    try {
      localStorage.setItem(POINT_QUEUE_KEY, JSON.stringify([...olderPending, ...recent]));
      state.pointStorageFailed = false;
    } catch {
      state.pointStorageFailed = true;
    }
  }

  function currentPointEvents() {
    const group = selectedGroup();
    const date = el("teacherReaderDate")?.value || "";
    if (!group || !date) return [];
    return state.pointEvents.filter(item =>
      item.status !== "rejected" && String(item.groupId) === String(group.id) && String(item.sessionDate) === date
    );
  }

  function selectedPointReason() {
    return el("teacherReaderReason")?.value || state.selectedReason || "participation";
  }

  function pointCount(studentId) {
    const reasonKey = selectedPointReason();
    return currentPointEvents()
      .filter(item =>
        item.status === "synced" && String(item.studentId) === String(studentId) &&
        String(item.reasonKey || "participation") === String(reasonKey)
      )
      .reduce((total, item) => total + Number(item.points || 0), 0);
  }

  function exportPendingPoints() {
    const group = selectedGroup();
    const sessionDate = el("teacherReaderDate")?.value;
    const events = currentPointEvents().filter(event => event.status === "pending");
    if (!group || !sessionDate || !events.length) return;

    const report = {
      version: 1,
      groupId: group.dbId || group.id,
      groupName: group.name,
      sessionDate,
      events: events.map(({ id, studentId, points, reasonKey, createdAt, undoOf }) => ({
        id, studentId, points, reasonKey, createdAt, undoOf
      }))
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const download = document.createElement("a");
    download.href = url;
    download.download = `teacher-board-points-${sessionDate}.json`;
    document.body.append(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function pointEntryMessage() {
    if (!navigator.onLine) return "الاتصال مقطوع — انتظر رجوعه لتسجيل النقاط";
    if (state.pointSignInRequired) return "سجّل الدخول بحساب السبورة لتسجيل النقاط";
    if (state.pointAuthChecking) return "جارٍ التحقق من جلسة السبورة";
    if (currentPointEvents().some(item => item.lastError === BOARD_CLOSED_MESSAGE)) return BOARD_CLOSED_MESSAGE;
    return "";
  }

  function allowPointEntry() {
    const message = pointEntryMessage();
    if (!message) return true;
    showToast(message);
    return false;
  }

  function pointStatus(forceControls = false) {
    const status = el("teacherReaderStatus");
    const retry = el("teacherReaderRetryPoints");
    const exportButton = el("teacherReaderExportPoints");
    if (!status) return;
    const events = currentPointEvents();
    const pending = events.filter(item => item.status !== "synced");
    const failed = pending.filter(item => item.lastError);
    const entryMessage = pointEntryMessage();
    const blocked = Boolean(entryMessage);
    if (forceControls || state.blockedPointEntry !== blocked) {
      state.blockedPointEntry = blocked;
      for (const button of document.querySelectorAll("[data-reader-point]")) {
        button.disabled = blocked || button.dataset.readerArrears === "true";
      }
    }
    const undo = el("teacherReaderUndoPoint");
    if (undo) undo.disabled = Boolean(entryMessage);
    if (!selectedGroup()) status.textContent = "اختر المجموعة أولًا";
    else if (state.pointSignInRequired || !navigator.onLine || state.pointAuthChecking) status.textContent =
      pending.length ? `${entryMessage} — في انتظار الإرسال: ${pending.length}` : entryMessage;
    else if (failed.some(item => item.lastError === BOARD_CLOSED_MESSAGE)) status.textContent =
      `الحصة مقفولة — نزّل ملف النقاط المعلّقة (${pending.length}) لمراجعتها`;
    else if (state.pointStorageFailed && pending.length) status.textContent =
      "النقاط لسه في الذاكرة فقط — نزّلها قبل إغلاق الصفحة";
    else if (failed.length) status.textContent = `تعذر إرسال ${failed.length} نقطة — اضغط إعادة الإرسال`;
    else if (pending.length) status.textContent = `لم يؤكد السيرفر استلام ${pending.length} عملية بعد`;
    else if (events.length) status.textContent = `أكد السيرفر استلام ${events.length} عملية للحصة`;
    else status.textContent = "يظهر الرصيد بعد تأكيد استلام النقاط";
    if (exportButton) exportButton.hidden = !failed.length && !(pending.length && (state.pointSignInRequired || state.pointStorageFailed || !navigator.onLine));
    if (retry) {
      retry.hidden = failed.length === 0 && !state.pointSignInRequired;
      retry.textContent = state.pointSignInRequired ? "تحديث الصفحة لتسجيل الدخول" : "إعادة إرسال النقاط";
    }
  }

  function renderStudents() {
    const left = el("teacherReaderStudentsLeft");
    const right = el("teacherReaderStudentsRight");
    if (!left || !right) return;
    const list = rankStudentsByPoints(studentsForGroup());
    const button = student => {
      const blocked = student.dueSessions >= BOARD_ARREARS_LIMIT;
      return `<div class="teacher-reader-student" data-reader-student="${safe(student.id)}">
        <span class="teacher-reader-student-count">${pointCount(student.id)}</span>
        <span class="teacher-reader-student-name">${safe(student.name)}${blocked ? ' <small class="teacher-reader-student-arrears">متأخرات</small>' : ""}</span>
        <span class="teacher-reader-student-actions">
          <button type="button" class="teacher-reader-student-remove" data-reader-point="remove" aria-label="خصم نقطة من الطالب ${safe(student.name)}">−</button>
          <button type="button" class="teacher-reader-student-add" data-reader-point="add" data-reader-arrears="${blocked}" aria-label="إضافة نقطة للطالب ${safe(student.name)}" ${blocked ? `disabled title="${BOARD_ARREARS_MESSAGE}"` : ""}>＋</button>
        </span>
      </div>`;
    };
    left.innerHTML = list.filter((_, index) => index % 2 === 0).map(button).join("");
    right.innerHTML = list.filter((_, index) => index % 2 === 1).map(button).join("");
    document.querySelectorAll("[data-reader-student]").forEach(item => {
      item.querySelector('[data-reader-point="add"]')?.addEventListener("click", () => addPoint(item.dataset.readerStudent));
      item.querySelector('[data-reader-point="remove"]')?.addEventListener("click", () => removePoint(item.dataset.readerStudent));
    });
    pointStatus(true);
  }

  function updatePointCounter(studentId) {
    const nameplate = document.querySelector(`[data-reader-student="${CSS.escape(String(studentId))}"] .teacher-reader-student-count`);
    if (nameplate) nameplate.textContent = String(pointCount(studentId));
  }

  function scheduleBoardPointRetry() {
    if (!state.active || !navigator.onLine || state.pointRetryTimer || state.pointSignInRequired) return;
    state.pointRetryTimer = setTimeout(() => {
      state.pointRetryTimer = 0;
      syncPoints("retry");
    }, state.pointRetryDelay);
    state.pointRetryDelay = Math.min(state.pointRetryDelay * 2, 30000);
  }

  function preparePointSound() {
    try {
      const AudioClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioClass) return;
      state.audioContext ||= new AudioClass();
      if (state.audioContext.state === "suspended") state.audioContext.resume().catch(() => {});
    } catch {}
  }

  function playPointSound() {
    try {
      const context = state.audioContext;
      if (context?.state !== "running") return;
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

  function addPoint(studentId) {
    if (!allowPointEntry()) return;
    const group = selectedGroup();
    const sessionDate = el("teacherReaderDate")?.value;
    if (!group || !sessionDate) { showToast("اختر المجموعة وتاريخ الحصة أولًا"); return; }
    const student = studentsForGroup().find(item => String(item.id) === String(studentId));
    if (!student) return;
    if (student.dueSessions >= BOARD_ARREARS_LIMIT) { showToast(BOARD_ARREARS_MESSAGE); return; }
    const reasonKey = el("teacherReaderReason")?.value || state.selectedReason || "participation";
    state.selectedReason = reasonKey;
    try { localStorage.setItem("ef_teacher_reader_reason", reasonKey); } catch {}
    state.pointEvents.push({
      id: makeId(), studentId,
      studentName: student.name,
      groupId: group.id, sessionDate, points: 1, status: "pending", lastError: "",
      reasonKey,
      createdAt: new Date().toISOString()
    });
    persistPointEvents();
    preparePointSound();
    pointStatus();
    syncPoints();
  }

  function removePoint(studentId) {
    if (!allowPointEntry()) return;
    const group = selectedGroup();
    const sessionDate = el("teacherReaderDate")?.value;
    const reasonKey = selectedPointReason();
    if (!group || !sessionDate) { showToast("اختر المجموعة وتاريخ الحصة أولًا"); return; }
    state.pointEvents.push({
      id: makeId(),
      studentId,
      studentName: students.find(item => String(item.id) === String(studentId))?.name || "طالب",
      groupId: group.id,
      sessionDate,
      points: -1,
      reasonKey,
      status: "pending",
      lastError: "",
      action: "deduction",
      createdAt: new Date().toISOString()
    });
    persistPointEvents();
    pointStatus();
    syncPoints();
  }

  function boardPointAuthFailed(status, error) {
    return status === 401 || error?.code === "PGRST301" || error?.code === "PGRST303";
  }

  async function syncPoints(force = false) {
    if (state.pointSyncing || typeof currentAppRole === "undefined" || !["owner", "screen"].includes(currentAppRole) || !navigator.onLine) {
      pointStatus(); return;
    }
    const canSend = item => item.status === "pending" &&
      (force === true || !item.lastError || (force === "retry" && item.retryable));
    let transportIssue = false;
    if (!force && !state.pointEvents.some(canSend)) { pointStatus(); return; }
    state.pointSyncing = true;
    try {
      const supabase = await boardDeadline(getSupabase());
      const { data, error: authError } = await boardDeadline(supabase.auth.getSession());
      if (authError && ![401, 403].includes(authError.status) &&
          authError.code !== "session_not_found" && authError.name !== "AuthSessionMissingError") throw authError;
      const userId = typeof currentAuthenticatedUserId === "undefined" ? null : currentAuthenticatedUserId;
      const canUseSession = session => session?.user?.id && (!userId || session.user.id === userId);
      state.pointSignInRequired = !canUseSession(data?.session);
      state.pointAuthChecking = false;
      pointStatus();
      if (state.pointSignInRequired) return;
      let refreshed = false;
      const attempted = new Set();
      // Re-read the live queue after each response: taps can arrive during an RPC.
      // A snapshot here strands the final taps until another user action.
      while (true) {
        const event = state.pointEvents.find(item =>
          canSend(item) && !attempted.has(item.id) &&
          (!item.undoOf || !state.pointEvents.some(original => original.id === item.undoOf && original.status === "pending"))
        );
        if (!event) break;
        attempted.add(event.id);
        const original = event.undoOf && state.pointEvents.find(item => item.id === event.undoOf);
        if (original?.status === "rejected") {
          event.status = "rejected";
          persistPointEvents();
          pointStatus();
          continue;
        }
        event.retryable = undefined;
        try {
          const args = {
            p_student_id: event.studentId,
            p_points: event.points,
            p_event_key: `teacher_board_${String(event.id).replaceAll("-", "")}`,
            p_session_date: event.sessionDate,
            p_reason_key: event.reasonKey || "participation"
          };
          const send = () => boardDeadline(supabase.rpc("queue_screen_teacher_board_point_with_reason", args));
          let response = await send();
          if (boardPointAuthFailed(response.status, response.error) && !refreshed) {
            refreshed = true;
            const session = await boardDeadline(supabase.auth.refreshSession());
            if (canUseSession(session.data?.session)) response = await send();
          }
          if (boardPointAuthFailed(response.status, response.error)) {
            state.pointSignInRequired = true;
            break;
          }
          const { data, error } = response;
          if (error) {
            event.retryable = !response.status || response.status === 429 || response.status >= 500;
            throw error;
          }
          event.retryable = false;
          if (data?.blocked || data?.closed || data?.success !== true) {
            event.lastError = data?.message || "تعذر تسجيل النقطة لهذه الحصة";
            if (Number(event.points) > 0 && data?.blocked && event.lastError === BOARD_ARREARS_MESSAGE) {
              event.status = "rejected";
              const student = students.find(item => String(item.id) === String(event.studentId));
              if (student) {
                student.dueSessions = Math.max(BOARD_ARREARS_LIMIT, Number(student.dueSessions || 0));
                student.boardArrearsBlockedAt = Date.now();
              }
              renderStudents();
              showToast(BOARD_ARREARS_MESSAGE);
            }
          } else {
            event.status = "synced"; event.lastError = ""; event.syncedAt = new Date().toISOString();
            state.pointRetryDelay = 3000;
            updatePointCounter(event.studentId);
            if (Number(event.points) > 0 && !data.already_applied) playPointSound();
          }
        } catch (error) {
          event.lastError = error?.message || "تعذر الاتصال";
          if (event.retryable !== false || error?.message === "اتأخر الرد أثناء الاتصال") {
            event.retryable = true;
            transportIssue = true;
          }
        }
        persistPointEvents(); pointStatus();
        if (transportIssue) break;
      }
    } catch {
      transportIssue = true;
      for (const event of state.pointEvents.filter(canSend)) {
        if (!event.lastError) event.lastError = "تعذر الاتصال";
        event.retryable = true;
      }
      persistPointEvents();
    } finally {
      state.pointSyncing = false;
      if (transportIssue) scheduleBoardPointRetry();
      pointStatus();
    }
  }

  function undoLastPoint() {
    if (!allowPointEntry()) return;
    const group = selectedGroup();
    const sessionDate = el("teacherReaderDate")?.value;
    if (!group || !sessionDate) { showToast("اختر المجموعة وتاريخ الحصة أولًا"); return; }
    const latest = [...currentPointEvents()].reverse().find(item => Number(item.points) > 0 && !item.undoneBy);
    if (!latest) { showToast("لا توجد نقطة للتراجع عنها"); return; }
    const undoId = makeId();
    latest.undoneBy = undoId;
    state.pointEvents.push({
      id: undoId,
      studentId: latest.studentId,
      studentName: latest.studentName,
      groupId: latest.groupId,
      sessionDate: latest.sessionDate,
      points: -1,
      reasonKey: latest.reasonKey || "participation",
      status: "pending",
      lastError: "",
      undoOf: latest.id,
      createdAt: new Date().toISOString()
    });
    persistPointEvents();
    renderStudents();
    syncPoints();
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
  function ensureStrokes(info) {
    if (!info || info.strokesLoaded) return Promise.resolve(info?.strokes || []);
    if (info.strokesPromise) return info.strokesPromise;
    info.strokesPromise = loadStrokes(info.number).then(strokes => {
      if (state.pages.get(info.number) !== info) return [];
      info.strokes = strokes;
      info.strokesLoaded = true;
      if (strokes.length || info.bitmapActive) resizeInk(info);
      if (info.bitmapActive) redrawInk(info);
      return strokes;
    }).finally(() => { info.strokesPromise = null; });
    return info.strokesPromise;
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
  function resizeInk(info, drawing = false) {
    if (!info) return;
    clearTimeout(info.releaseTimer);
    const size = pageCssSize(info);
    info.wrap.style.width = `${size.width}px`;
    info.wrap.style.height = `${size.height}px`;
    info.ink.style.width = `${size.width}px`; info.ink.style.height = `${size.height}px`;
    if (!drawing && !info.bitmapActive && !info.strokes?.length) {
      if (info.ink.width !== 1 || info.ink.height !== 1) {
        info.ink.width = 1; info.ink.height = 1;
      }
      info.inkContext = null; info.bitmapActive = false;
      return;
    }
    // Limit the transparent bitmap independently from the PDF raster.
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5,
      Math.sqrt(2000000 / (size.width * size.height)));
    const pixelWidth = Math.max(1, Math.round(size.width * ratio));
    const pixelHeight = Math.max(1, Math.round(size.height * ratio));
    info.inkRatio = ratio;
    if (info.ink.width !== pixelWidth || info.ink.height !== pixelHeight) {
      info.ink.width = pixelWidth;
      info.ink.height = pixelHeight;
      info.inkContext = info.ink.getContext("2d", { alpha: true });
      redrawInk(info);
    }
    info.bitmapActive = true;
  }

  function releasePageBitmap(info) {
    if (!info || info.renderTask) return;
    info.pdf.width = 1; info.pdf.height = 1;
    info.ink.width = 1; info.ink.height = 1;
    info.inkContext = null; info.bitmapActive = false; info.renderedZoom = 0;
    info.wrap.classList.remove("rendered");
    info.pdfPage?.cleanup?.();
    if (info.number !== 1) info.pdfPage = null;
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
    if (!info.bitmapActive && info.ink.width <= 1) return;
    const ctx = info.inkContext || info.ink.getContext("2d", { alpha: true });
    info.inkContext = ctx;
    ctx.clearRect(0, 0, info.ink.width, info.ink.height);
    info.strokes.forEach(stroke => drawStroke(ctx, stroke, info));
  }

  function pointerPoint(event, info, cachedRect) {
    const rect = cachedRect || info.ink.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }

  function pausePdfForInk() {
    state.isDrawing = true;
    state.pages.forEach(info => {
      if (info.renderTask) {
        try { info.renderTask.cancel(); } catch {}
      }
    });
  }

  function resumePdfAfterInk(pageNumber) {
    state.isDrawing = false;
    requestAnimationFrame(() => {
      queuePageNeighborhood(pageNumber);
      runRenderQueue();
    });
  }
  function eraseStrokePart(stroke, point, radius) {
    const parts = [];
    let current = [];
    for (const sample of stroke.points || []) {
      if (Math.hypot(sample.x - point.x, sample.y - point.y) > radius) {
        current.push(sample);
      } else {
        if (current.length > 1) parts.push({ ...stroke, points: current });
        current = [];
      }
    }
    if (current.length > 1) parts.push({ ...stroke, points: current });
    return parts;
  }
  function bindInk(info) {
    const canvas = info.ink;
    let active = null;
    const erase = point => {
      const radius = (state.eraserWidth / Math.max(1, canvas.clientWidth)) / state.zoom;
      const next = info.strokes.flatMap(stroke => eraseStrokePart(stroke, point, radius));
      const changed = next.length !== info.strokes.length || next.some((stroke, index) => stroke.points.length !== info.strokes[index]?.points?.length);
      if (changed) { info.strokes = next; redrawInk(info); saveStrokes(info); }
    };
    canvas.addEventListener("pointerdown", event => {
      if (state.mode === "hand") return;
      if (!info.strokesLoaded) {
        ensureStrokes(info);
        showToast("لحظة واحدة لتجهيز الكتابة على هذه الصفحة");
        return;
      }
      event.preventDefault(); setCurrentPage(info.number); resizeInk(info, true); pausePdfForInk();
      canvas.setPointerCapture?.(event.pointerId);
      const rect = canvas.getBoundingClientRect();
      const point = pointerPoint(event, info, rect);
      if (state.mode === "eraser") { active = { pointerId: event.pointerId, erasing: true, rect }; erase(point); return; }
      active = { pointerId: event.pointerId, color: state.color, width: state.penWidth, points: [point], rect };
    }, { passive: false });
    const handleInkMove = event => {
      if (!active || active.pointerId !== event.pointerId) return;
      event.preventDefault();
      const events = event.getCoalescedEvents?.() || [event];
      if (active.erasing) { events.forEach(item => erase(pointerPoint(item, info, active.rect))); return; }
      const ctx = info.inkContext || canvas.getContext("2d", { alpha: true });
      info.inkContext = ctx;
      const previous = active.points[active.points.length - 1];
      ctx.beginPath();
      ctx.moveTo(previous.x * canvas.width, previous.y * canvas.height);
      for (const item of events) {
        const next = pointerPoint(item, info, active.rect);
        active.points.push(next);
        ctx.lineTo(next.x * canvas.width, next.y * canvas.height);
      }
      strokePaint(ctx, active, info); ctx.stroke();
    };
    canvas.addEventListener("onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove", handleInkMove, { passive: false });
    const finish = event => {
      if (!active || active.pointerId !== event.pointerId) return;
      if (!active.erasing) {
        if (active.points.length === 1) active.points.push({ ...active.points[0] });
        info.strokes.push(active); saveStrokes(info);
      }
      active = null;
      try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
      resumePdfAfterInk(info.number);
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("lostpointercapture", finish);
  }

  function enforceBitmapCache() {
    const active = [...state.pages.values()].filter(info => info.pdf.width > 1 || info.ink.width > 1);
    if (active.length <= state.bitmapCacheLimit) return;
    const protectedPages = new Set(usesNativeBoardTools()
      ? [state.currentPage - 1, state.currentPage, state.currentPage + 1]
      : [state.currentPage - 2, state.currentPage - 1, state.currentPage,
          state.currentPage + 1, state.currentPage + 2, state.currentPage + 3]);
    const viewport = el("teacherReaderViewport").getBoundingClientRect();
    active
      .filter(info => {
        if (protectedPages.has(info.number) || info.renderTask || info.visibleRatio > 0) return false;
        const rect = info.wrap.getBoundingClientRect();
        return rect.bottom <= viewport.top || rect.top >= viewport.bottom;
      })
      .sort((a, b) => Number(a.lastUsed || 0) - Number(b.lastUsed || 0))
      .slice(0, Math.max(0, active.length - state.bitmapCacheLimit))
      .forEach(releasePageBitmap);
  }

  function schedulePageRetry(info, targetZoom) {
    if (!info || state.pages.get(info.number) !== info || targetZoom !== state.zoom) return;
    clearTimeout(info.retryTimer);
    info.renderFailures = Number(info.renderFailures || 0) + 1;
    if (info.renderFailures > 6) return;
    const delay = Math.min(1400, 120 * (2 ** (info.renderFailures - 1)));
    info.retryTimer = setTimeout(() => {
      info.retryTimer = 0;
      if (state.pages.get(info.number) !== info || targetZoom !== state.zoom || state.isDrawing) return;
      if (info.visibleRatio > 0 || Math.abs(info.number - state.currentPage) <= 3) queuePdfPage(info, 0, true);
    }, delay);
  }

  function boundedViewport(pdfPage, scale) {
    const viewport = pdfPage.getViewport({ scale });
    const pixelLimit = usesNativeBoardTools() ? 4000000 : 5000000;
    const reduction = Math.min(1, Math.sqrt(pixelLimit / (viewport.width * viewport.height)));
    return reduction < 1 ? pdfPage.getViewport({ scale: scale * reduction }) : viewport;
  }

  async function renderPdfPageNow(info, targetZoom) {
    if (!info || !state.pdfDocument || state.isDrawing || state.zooming || info.renderedZoom === targetZoom) return false;
    let task = null;
    try {
      const pdfPage = info.pdfPage || await boardDeadline(state.pdfDocument.getPage(info.number), 8000);
      if (state.isDrawing || state.zooming || targetZoom !== state.zoom || state.pages.get(info.number) !== info) return false;
      info.pdfPage = pdfPage;
      if (!info.sizeResolved) {
        const natural = pdfPage.getViewport({ scale: 1 });
        info.baseScale = info.baseWidth / natural.width;
        info.baseHeight = info.baseWidth * natural.height / natural.width;
        info.sizeResolved = true;
        resizeInk(info);
      }
      const renderRatio = Math.max(1.5, Math.min(window.devicePixelRatio || 1, 2));
      const viewport = boundedViewport(pdfPage, info.baseScale * targetZoom * renderRatio);
      const buffer = document.createElement("canvas");
      buffer.width = Math.max(1, Math.round(viewport.width)); buffer.height = Math.max(1, Math.round(viewport.height));
      const context = buffer.getContext("2d", { alpha: false });
      // Replace the displayed canvas only after the new page is complete.
      task = pdfPage.render({ canvasContext: context, viewport });
      info.renderTask = task;
      await boardDeadline(task.promise, 8000);
      if (state.pages.get(info.number) !== info || state.zooming || targetZoom !== state.zoom) return false;
      buffer.className = info.pdf.className;
      info.pdf.replaceWith(buffer);
      info.pdf = buffer;
      info.renderedZoom = targetZoom; info.lastUsed = performance.now();
      info.wrap.classList.add("rendered");
      info.renderFailures = 0; clearTimeout(info.retryTimer); info.retryTimer = 0;
      enforceBitmapCache();
      return true;
    } catch (error) {
      if (task) { try { task.cancel(); } catch {} }
      if (error?.name !== "RenderingCancelledException") console.warn("PDF page render failed", error);
      if (!state.isDrawing && targetZoom === state.zoom) schedulePageRetry(info, targetZoom);
      return false;
    } finally { if (task && info.renderTask === task) info.renderTask = null; }
  }

  function queuePdfPage(info, priority = 5, force = false) {
    if (!info || !state.pdfDocument || state.zooming) return;
    const targetZoom = state.zoom;
    if (!force && info.renderedZoom === targetZoom) {
      info.lastUsed = performance.now();
      return;
    }
    const existing = state.renderQueue.find(item => item.info === info && item.zoom === targetZoom);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority);
      existing.force ||= force;
    } else {
      state.renderQueue.push({ info, priority, force, zoom: targetZoom, sequence: ++state.renderSequence });
    }
    state.renderQueue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
    runRenderQueue();
  }

  async function runRenderQueue() {
    if (state.renderLoopRunning || state.isDrawing || state.zooming) return;
    state.renderLoopRunning = true;
    try {
      while (state.renderQueue.length && !state.isDrawing && !state.zooming) {
        const item = state.renderQueue.shift();
        if (item.zoom !== state.zoom || state.pages.get(item.info.number) !== item.info) continue;
        if (item.force && item.info.renderedZoom === item.zoom) item.info.renderedZoom = 0;
        await renderPdfPageNow(item.info, item.zoom);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally {
      state.renderLoopRunning = false;
      if (state.renderQueue.length && !state.isDrawing && !state.zooming) queueMicrotask(runRenderQueue);
    }
  }

  function queuePageNeighborhood(pageNumber, force = false) {
    ensureStrokes(state.pages.get(pageNumber));
    ensureStrokes(state.pages.get(pageNumber + 1));
    queuePdfPage(state.pages.get(pageNumber), 0, force);
    queuePdfPage(state.pages.get(pageNumber + 1), 1, force);
    queuePdfPage(state.pages.get(pageNumber + 2), 2, force);
    queuePdfPage(state.pages.get(pageNumber - 1), 3, force);
    queuePdfPage(state.pages.get(pageNumber + 3), 4, force);
  }

  function updatePageIndicator(pageNumber = state.currentPage) {
    const total = Number(state.pdfDocument?.numPages || 0);
    const value = String(Math.max(1, Math.min(total || 1, pageNumber || 1)));
    ["teacherReaderPageTotal", "teacherReaderScreenPageTotal"].forEach(id => {
      const totalText = el(id); if (totalText) totalText.textContent = String(total);
    });
    ["teacherReaderPageNumber", "teacherReaderScreenPageNumber"].forEach(id => {
      const input = el(id);
      if (!input) return;
      input.max = String(Math.max(1, total));
      if (document.activeElement !== input) input.value = value;
    });
  }

  function goToPage(rawPage, behavior = "auto") {
    const pageNumber = Number(rawPage);
    const total = Number(state.pdfDocument?.numPages || 0);
    const info = state.pages.get(pageNumber);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > total || !info) {
      showToast(total ? `اكتب رقم صفحة من 1 إلى ${total}` : "افتح كتاب PDF أولًا");
      return false;
    }
    setCurrentPage(pageNumber);
    updatePageIndicator(pageNumber);
    ensureStrokes(info);
    state.renderQueue = [];
    state.pages.forEach(page => {
      if (page.renderTask) { try { page.renderTask.cancel(); } catch {} }
    });
    const viewport = el("teacherReaderViewport");
    viewport?.scrollTo({ top: Math.max(0, info.wrap.offsetTop - 10), left: viewport.scrollLeft, behavior });
    queuePageNeighborhood(pageNumber);
    return true;
  }

  function renderVisiblePages(force = false) {
    if (state.openingBook) return;
    const viewport = el("teacherReaderViewport");
    if (!viewport || state.zooming) return;
    const box = viewport.getBoundingClientRect();
    const visible = [...state.pages.values()].filter(info => {
      const rect = info.wrap.getBoundingClientRect();
      return rect.bottom > box.top - box.height && rect.top < box.bottom + box.height;
    });
    visible.forEach((info, index) => { resizeInk(info); queuePdfPage(info, index, force); });
    const center = (box.top + box.bottom) / 2;
    const onScreen = visible.filter(info => {
      const rect = info.wrap.getBoundingClientRect();
      return rect.bottom > box.top && rect.top < box.bottom;
    }).sort((a, b) => {
      const ar = a.wrap.getBoundingClientRect(), br = b.wrap.getBoundingClientRect();
      return Math.abs((ar.top + ar.bottom) / 2 - center) - Math.abs((br.top + br.bottom) / 2 - center);
    });
    if (onScreen[0]) { setCurrentPage(onScreen[0].number); updatePageIndicator(state.currentPage); }
    queuePageNeighborhood(state.currentPage, force);
  }

  async function buildPages(pdfDocument, generation) {
    const container = el("teacherReaderPages");
    container.innerHTML = ""; state.pages.clear(); state.observer?.disconnect();
    state.fitWidth = Math.max(420, Math.min(1050, el("teacherReaderViewport").clientWidth - 38));
    const first = await boardDeadline(pdfDocument.getPage(1), 8000);
    if (generation !== state.bookGeneration) return;
    const firstViewport = first.getViewport({ scale: 1 });
    const defaultRatio = firstViewport.height / firstViewport.width;
    let fragment = document.createDocumentFragment();
    for (let number = 1; number <= pdfDocument.numPages; number++) {
      const baseWidth = state.fitWidth;
      const baseHeight = baseWidth * defaultRatio;
      const wrap = document.createElement("div");
      wrap.className = "teacher-reader-page-wrap"; wrap.dataset.page = number;
      wrap.innerHTML = `<canvas class="teacher-reader-pdf-canvas"></canvas><div class="teacher-reader-page-placeholder">صفحة ${number}</div><canvas class="teacher-reader-ink-canvas"></canvas>`;
      fragment.appendChild(wrap);
      const info = {
        number, pdfPage: number === 1 ? first : null, wrap,
        pdf: wrap.querySelector(".teacher-reader-pdf-canvas"),
        ink: wrap.querySelector(".teacher-reader-ink-canvas"),
        baseWidth, baseHeight, baseScale: baseWidth / firstViewport.width,
        sizeResolved: number === 1,
        strokes: [], strokesLoaded: false, strokesPromise: null, renderedZoom: 0, renderTask: null,
        bitmapActive: false, inkContext: null, releaseTimer: 0, retryTimer: 0, renderFailures: 0,
      };
      const size = pageCssSize(info);
      wrap.style.width = `${size.width}px`; wrap.style.height = `${size.height}px`;
      info.ink.style.width = `${size.width}px`; info.ink.style.height = `${size.height}px`;
      info.pdf.width = 1; info.pdf.height = 1; info.ink.width = 1; info.ink.height = 1;
      state.pages.set(number, info); bindInk(info);
      if (number % 32 === 0) {
        container.appendChild(fragment);
        fragment = document.createDocumentFragment();
        await new Promise(resolve => setTimeout(resolve, 0));
        if (generation !== state.bookGeneration) return;
      }
    }
    container.appendChild(fragment);
    state.observer = new IntersectionObserver(entries => {
      if (generation !== state.bookGeneration || state.zooming) return;
      entries.forEach(entry => {
        const info = state.pages.get(Number(entry.target.dataset.page));
        if (info) info.visibleRatio = entry.isIntersecting ? entry.intersectionRatio : 0;
        if (entry.isIntersecting) {
          ensureStrokes(info);
          resizeInk(info);
          queuePdfPage(info, Math.max(0, Math.round(4 - (entry.intersectionRatio * 4))));
          queuePdfPage(state.pages.get(info.number + 1), 3);
        }
      });
      const viewportRect = el("teacherReaderViewport").getBoundingClientRect();
      const viewportCenter = (viewportRect.top + viewportRect.bottom) / 2;
      const visible = [...state.pages.values()].filter(info => info.visibleRatio > 0).map(info => {
        const rect = info.wrap.getBoundingClientRect();
        return { info, rect, distance: Math.abs((rect.top + rect.bottom) / 2 - viewportCenter) };
      }).filter(item => item.rect.bottom > viewportRect.top && item.rect.top < viewportRect.bottom);
      if (visible.length) {
        visible.sort((a, b) => a.distance - b.distance);
        setCurrentPage(visible[0].info.number);
        updatePageIndicator(state.currentPage);
        queuePageNeighborhood(state.currentPage);
      }
      enforceBitmapCache();
    }, { root: el("teacherReaderViewport"), rootMargin: "75% 0px", threshold: [0, .01, .25, .5, .75] });
    state.pages.forEach(info => state.observer.observe(info.wrap));
    container.hidden = false; el("teacherReaderEmpty").hidden = true;
    state.currentPage = 1;
    updatePageIndicator(1);
    setMode(state.mode);
    renderVisiblePages(true);
  }

  function resetBook() {
    const generation = ++state.bookGeneration;
    state.observer?.disconnect();
    state.renderQueue = [];
    state.isDrawing = false;
    clearTimeout(state.zoomTimer);
    state.zooming = false;
    state.pages.forEach(info => {
      clearTimeout(info.retryTimer);
      clearTimeout(info.releaseTimer);
      try { info.renderTask?.cancel(); } catch {}
    });
    state.pages.clear();
    const loading = state.bookLoadTask;
    const document = state.pdfDocument;
    state.bookLoadTask = null;
    state.pdfDocument = null;
    const previous = loading || document;
    if (previous?.destroy) void Promise.resolve().then(() => previous.destroy()).catch(() => {});
    return generation;
  }

  async function openBook(book) {
    if (!book?.blob || (state.book?.id === book.id && (state.openingBook || state.pdfDocument))) return;
    persistReadingProgress();
    const resumePage = readBookPage(book);
    const generation = resetBook();
    const isCurrent = () => generation === state.bookGeneration;
    state.openingBook = true;
    el("teacherReaderBusy").hidden = false;
    el("teacherReaderPages").hidden = true;
    let loading;
    try {
      state.book = book; state.zoom = 1; updateZoomText();
      const pdfjs = await boardDeadline(loadPdfModule(), 15000);
      if (!isCurrent()) return;
      const bytes = new Uint8Array(await boardDeadline(book.blob.arrayBuffer(), 15000));
      if (!isCurrent()) return;
      loading = pdfjs.getDocument({
        data: bytes,
        cMapUrl: PDF_CMAP_URL,
        cMapPacked: true,
        standardFontDataUrl: PDF_STANDARD_FONT_URL,
        wasmUrl: PDF_WASM_URL,
        useSystemFonts: true,
        disableFontFace: false
      });
      state.bookLoadTask = loading;
      const pdfDocument = await boardDeadline(loading.promise, 15000);
      if (!isCurrent()) return;
      state.pdfDocument = pdfDocument;
      updatePageIndicator(1);
      await buildPages(pdfDocument, generation);
      if (!isCurrent()) return;
      try { localStorage.setItem(`teacherReader:lastBook:${book.groupId}`, book.id); } catch {}
      state.openingBook = false;
      goToPage(Math.min(resumePage, state.pdfDocument.numPages));
    } catch (error) {
      if (!isCurrent()) return;
      console.error("Fresh PDF reader error", error);
      if (loading?.destroy) void Promise.resolve().then(() => loading.destroy()).catch(() => {});
      state.pdfDocument = null;
      showToast("تعذر فتح ملف PDF — اختر الكتاب مرة تانية");
      el("teacherReaderPages").hidden = true; el("teacherReaderEmpty").hidden = false;
    } finally {
      if (isCurrent()) {
        state.bookLoadTask = null;
        state.openingBook = false;
        el("teacherReaderBusy").hidden = true;
      }
    }
  }

  async function refreshBooks(autoOpen = true) {
    const select = el("teacherReaderBook");
    const group = selectedGroup();
    const request = ++state.bookRequest;
    const list = group ? await boardDeadline(booksForGroup(group.id)) : [];
    if (request !== state.bookRequest || selectedGroup()?.id !== group?.id) return [];
    select.innerHTML = '<option value="">اختر الكتاب</option>' + list
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(book => `<option value="${safe(book.id)}">${safe(book.name)}</option>`).join("");
    let preferred = "";
    try { if (group) preferred = localStorage.getItem(`teacherReader:lastBook:${group.id}`); } catch {}
    const chosen = list.find(book => book.id === preferred) || list[0];
    if (chosen) select.value = chosen.id;
    el("teacherReaderRemoveBook").disabled = !chosen;
    if (autoOpen && chosen) await openBook(chosen);
    if (!chosen) {
      resetBook();
      state.book = null;
      state.openingBook = false;
      el("teacherReaderBusy").hidden = true;
      el("teacherReaderPages").innerHTML = ""; el("teacherReaderPages").hidden = true; el("teacherReaderEmpty").hidden = false;
    }
    return list;
  }

  async function addPdf(file) {
    const group = selectedGroup();
    if (!group) { showToast("اختر المجموعة قبل إضافة الكتاب"); return; }
    if (!file || (file.type && file.type !== "application/pdf")) { showToast("اختر ملف PDF صحيحًا"); return; }
    const book = { id: makeId(), groupId: String(group.id), name: file.name.replace(/\.pdf$/i, ""), blob: file, size: file.size, createdAt: Date.now() };
    await putBook(book);
    try { localStorage.setItem(`teacherReader:lastBook:${group.id}`, book.id); } catch {}
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
  function setZoom(value, liveGesture = false, focus = null) {
    const viewport = el("teacherReaderViewport");
    if (!viewport || !state.pages.size) return;
    const nextZoom = Math.max(.55, Math.min(4, value));
    if (Math.abs(nextZoom - state.zoom) < .001) return;
    const viewportRect = viewport.getBoundingClientRect();
    const x = focus ? focus.x - viewportRect.left : viewport.clientWidth / 2;
    const y = focus ? focus.y - viewportRect.top : viewport.clientHeight / 2;
    const targetY = viewportRect.top + y;
    const anchor = [...state.pages.values()].reduce((best, info) => {
      const rect = info.wrap.getBoundingClientRect();
      const distance = Math.max(rect.top - targetY, targetY - rect.bottom, 0);
      return !best || distance < best.distance ? { info, rect, distance } : best;
    }, null);
    const fractionY = (targetY - anchor.rect.top) / anchor.rect.height;
    const fractionX = (viewportRect.left + x - anchor.rect.left) / anchor.rect.width;
    if (!state.zooming) {
      state.renderQueue = [];
      state.pages.forEach(info => {
        if (info.renderTask) { try { info.renderTask.cancel(); } catch {} }
      });
    }
    state.zooming = true;
    state.zoom = nextZoom; updateZoomText();
    state.pages.forEach(info => {
      const size = pageCssSize(info);
      info.wrap.style.width = `${size.width}px`; info.wrap.style.height = `${size.height}px`;
      info.ink.style.width = `${size.width}px`; info.ink.style.height = `${size.height}px`;
    });
    const updated = anchor.info.wrap.getBoundingClientRect();
    viewport.scrollTop += updated.top + fractionY * updated.height - targetY;
    viewport.scrollLeft += updated.left + fractionX * updated.width - (viewportRect.left + x);
    clearTimeout(state.zoomTimer);
    state.zoomTimer = setTimeout(() => {
      state.zooming = false;
      renderVisiblePages();
    }, liveGesture ? 260 : 180);
  }

  function bindHandGestures() {
    const viewport = el("teacherReaderViewport");
    const pointers = new Map();
    let pan = null, pinch = null, zoomFrame = 0, pendingZoom = 1, zoomFocus = null;
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
        const values = [...pointers.values()].slice(0, 2);
        pendingZoom = pinch.zoom * distance(values) / pinch.distance;
        zoomFocus = { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 };
        if (!zoomFrame) zoomFrame = requestAnimationFrame(() => { zoomFrame = 0; setZoom(pendingZoom, true, zoomFocus); });
      } else if (pointers.size === 1 && pan) {
        viewport.scrollLeft = pan.left - (event.clientX - pan.x);
        viewport.scrollTop = pan.top - (event.clientY - pan.y);
      }
    }, { passive: false });
    const finish = event => {
      if (zoomFrame) {
        cancelAnimationFrame(zoomFrame); zoomFrame = 0;
        setZoom(pendingZoom, true, zoomFocus);
      }
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      const remaining = [...pointers.values()][0];
      pan = remaining ? { x: remaining.x, y: remaining.y, left: viewport.scrollLeft, top: viewport.scrollTop } : null;
      try { viewport.releasePointerCapture?.(event.pointerId); } catch {}
    };
    viewport.addEventListener("pointerup", finish);
    viewport.addEventListener("pointercancel", finish);
    viewport.addEventListener("lostpointercapture", event => {
      if (pointers.has(event.pointerId)) finish(event);
    });
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
    el("teacherReaderViewport")?.addEventListener("scroll", () => {
      if (state.renderScanFrame) return;
      state.renderScanFrame = requestAnimationFrame(() => { state.renderScanFrame = 0; renderVisiblePages(); });
    }, { passive: true });
    el("teacherReaderGroup")?.addEventListener("change", () => {
      renderStudents();
      refreshStudentArrears(true);
      syncPoints("retry");
      refreshBooks(true).catch(error => {
        console.error("Board books could not be loaded:", error);
        showToast("تعذر تحميل الكتب لهذه المجموعة");
      });
    });
    el("teacherReaderDate")?.addEventListener("change", () => { renderStudents(); syncPoints("retry"); });
    el("teacherReaderReason")?.addEventListener("change", event => {
      state.selectedReason = event.target.value || "participation";
      try { localStorage.setItem("ef_teacher_reader_reason", state.selectedReason); } catch {}
      renderStudents();
    });
    el("teacherReaderBook")?.addEventListener("change", async event => {
      const group = selectedGroup();
      const bookId = event.target.value;
      const request = ++state.bookRequest;
      try {
        const list = group ? await boardDeadline(booksForGroup(group.id)) : [];
        if (request !== state.bookRequest || selectedGroup()?.id !== group?.id) return;
        const book = list.find(item => item.id === bookId);
        el("teacherReaderRemoveBook").disabled = !book;
        if (book) await openBook(book);
      } catch (error) {
        console.error("Board book selection failed:", error);
        showToast("تعذر تحميل الكتاب المختار");
      }
    });
    el("teacherReaderPdfInput")?.addEventListener("change", async event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (file) await addPdf(file);
    });
    el("teacherReaderRemoveBook")?.addEventListener("click", async () => {
      const id = el("teacherReaderBook")?.value;
      if (!id || !confirm("حذف هذا الكتاب من السبورة؟")) return;
      const group = selectedGroup();
      if (group) {
        localStorage.removeItem(`${READING_PROGRESS_PREFIX}:${group.id}:${id}`);
        if (localStorage.getItem(`teacherReader:lastBook:${group.id}`) === id) {
          localStorage.removeItem(`teacherReader:lastBook:${group.id}`);
        }
      }
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
    el("teacherReaderGoPage")?.addEventListener("click", () => goToPage(el("teacherReaderPageNumber")?.value));
    el("teacherReaderScreenGoPage")?.addEventListener("click", () => goToPage(el("teacherReaderScreenPageNumber")?.value));
    el("teacherReaderPageNumber")?.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); goToPage(event.currentTarget.value); }
    });
    el("teacherReaderScreenPageNumber")?.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); goToPage(event.currentTarget.value); }
    });
    el("teacherReaderFullscreen")?.addEventListener("click", toggleFullscreen);
    el("teacherReaderExportPoints")?.addEventListener("click", exportPendingPoints);
    el("teacherReaderRetryPoints")?.addEventListener("click", () => {
      if (state.pointSignInRequired) { window.location.reload(); return; }
      currentPointEvents().forEach(item => { if (item.status !== "synced") item.lastError = ""; });
      persistPointEvents(); syncPoints(true);
    });
    el("teacherReaderUndoPoint")?.addEventListener("click", undoLastPoint);
    window.addEventListener("online", () => {
      if (state.active) { refreshStudentArrears(); syncPoints("retry"); }
    });
    window.addEventListener("offline", () => { if (state.active) pointStatus(); });
    document.addEventListener("visibilitychange", () => {
      if (state.active && !document.hidden) { refreshStudentArrears(); syncPoints("retry"); }
    });
    setInterval(() => { if (!document.hidden) refreshStudentArrears(); }, 30000);
  }

  async function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    state.bitmapCacheLimit = usesNativeBoardTools() ? 3 : 8;
    bindEvents();
    setMode("hand");
    el("teacherReaderDate").value = today();
    readPointEvents();
    try { state.selectedReason = localStorage.getItem("ef_teacher_reader_reason") || "participation"; } catch {}
    if (el("teacherReaderReason")) el("teacherReaderReason").value = state.selectedReason;
  }

  async function activate() {
    if (typeof currentAppRole !== "undefined" && !["owner", "screen"].includes(currentAppRole)) {
      showToast("سبورة الشرح غير متاحة لهذا الحساب"); return;
    }
    state.active = true;
    if (state.activation) return state.activation;
    state.activation = (async () => {
      await initialize().catch(error => console.warn("Board storage unavailable:", error));
      if (!state.active) return;
      populateGroups();
      renderStudents();
      refreshStudentArrears(true);
      syncPoints("retry");
      await refreshBooks(true).catch(error => {
        console.error("Board books could not be loaded:", error);
        showToast("تعذر تحميل الكتب المحفوظة على الجهاز");
      });
    })();
    try { await state.activation; }
    finally { state.activation = null; }
  }
  function deactivate() { persistReadingProgress(); state.active = false; clearTimeout(state.pointRetryTimer); state.pointRetryTimer = 0; }

  window.teacherReader = { activate, deactivate, refresh: () => { populateGroups(); renderStudents(); } };

  const page = el("teacherReader");
  if (page && typeof MutationObserver === "function") {
    new MutationObserver(() => {
      if (page.classList.contains("active-page")) activate();
      else deactivate();
    }).observe(page, { attributes: true, attributeFilter: ["class"] });
    if (page.classList.contains("active-page")) activate();
  }
})();
