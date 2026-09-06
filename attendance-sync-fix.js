(() => {
  if (window.__attendanceLiveSyncFixLoaded) return;
  window.__attendanceLiveSyncFixLoaded = true;

  const LIVE_SYNC_INTERVAL_MS = 3000;
  let managerAccessPollBusy = false;
  let pendingPointsPollBusy = false;
  let lastAccessPollErrorAt = 0;
  let lastPendingPollErrorAt = 0;

  const activePageId = () =>
    document.querySelector(".page.active-page")?.id || "";

  const todayISO = () => localDateISO();

  // لا نعيد تاريخ حصة قديم تلقائياً من Workspace عند فتح التطبيق من جديد.
  // بقية حقول الصفحة تظل قابلة للاستعادة، ومسودات الحضور القديمة تظل محفوظة
  // ويمكن الوصول لها يدوياً باختيار تاريخها.
  if (typeof applyWorkspaceFields === "function") {
    const originalApplyWorkspaceFields = applyWorkspaceFields;

    applyWorkspaceFields = function attendanceSafeWorkspaceRestore(
      fields = {},
      root = document
    ) {
      if (!fields || typeof fields !== "object") {
        return originalApplyWorkspaceFields(fields, root);
      }

      const safeFields = { ...fields };
      delete safeFields.sessionDate;

      return originalApplyWorkspaceFields(safeFields, root);
    };
  }

  function normalizeInitialAttendanceDate() {
    const input = $("sessionDate");
    if (!input) return;

    const today = todayISO();
    if (input.value === today) return;

    input.value = today;

    if (activePageId() === "attendance") {
      loadAttendance();
    }
  }

  // حماية إضافية بعد اكتمال استعادة الحساب، حتى لو كانت الشبكة بطيئة.
  setTimeout(normalizeInitialAttendanceDate, 1200);

  function stopOriginalClick(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // نقاط ولاء الحية تخص حصة اليوم فقط، حتى لا تُربط نقاط اليوم بحصة قديمة.
  $("walaaSessionAccessBtn")?.addEventListener(
    "click",
    event => {
      const selectedDate = $("sessionDate")?.value || "";
      const today = todayISO();

      if (!selectedDate || selectedDate === today) return;

      stopOriginalClick(event);
      showToast(
        "فتح الحصة عند ولاء متاح لحصة اليوم فقط — غيّر التاريخ إلى اليوم أولاً"
      );
    },
    true
  );

  // الحصص التاريخية تظل قابلة للحفظ، لكن لا تمر بالخطأ دون تنبيه واضح.
  $("saveAttendanceBtn")?.addEventListener(
    "click",
    event => {
      const selectedDate = $("sessionDate")?.value || "";
      const today = todayISO();

      if (!selectedDate || selectedDate === today) return;

      const confirmed = window.confirm(
        "تنبيه مهم: تاريخ الحصة المختار ليس تاريخ اليوم.\n\n" +
        `التاريخ المختار: ${selectedDate}\n` +
        `تاريخ اليوم: ${today}\n\n` +
        "إذا كنت تسجل حصة قديمة عمداً اضغط موافق، وإلا اضغط إلغاء وصحح التاريخ."
      );

      if (confirmed) return;

      stopOriginalClick(event);
      showToast("تم إلغاء الحفظ — راجع تاريخ الحصة");
    },
    true
  );

  async function pollManagerPointsAccess() {
    if (
      managerAccessPollBusy ||
      document.hidden ||
      activePageId() !== "points" ||
      !$("managerPointsWorkspace")
    ) {
      return;
    }

    const group = groupById($("managerPointsGroup")?.value || "");
    if (!group?.dbId) return;

    managerAccessPollBusy = true;

    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.rpc(
        "get_manager_points_session_access",
        {
          p_group_id: group.dbId,
          p_session_date: todayISO()
        }
      );

      if (error) throw error;

      updateManagerPointsAccessUI(
        data || { is_open: false }
      );
    } catch (error) {
      const now = Date.now();
      if (now - lastAccessPollErrorAt > 30000) {
        console.warn("Live Walaa access refresh error:", error);
        lastAccessPollErrorAt = now;
      }
    } finally {
      managerAccessPollBusy = false;
    }
  }

  async function pollOwnerPendingPoints() {
    if (
      pendingPointsPollBusy ||
      document.hidden ||
      activePageId() !== "attendance"
    ) {
      return;
    }

    const canEditAccount =
      currentAppRole === "owner" || attendanceAccountEditAllowed;

    if (!canEditAccount) return;

    const sessionDate = $("sessionDate")?.value || "";
    if (!sessionDate || sessionDate !== todayISO()) return;

    const group = groupById($("groupSelect")?.value || "");
    const attendanceBody = $("attendanceBody");

    if (
      !group?.dbId ||
      !attendanceBody?.querySelector("tr[data-id]")
    ) {
      return;
    }

    pendingPointsPollBusy = true;

    try {
      const supabase = await getSupabase();
      const result = await syncPendingPointItemsFromServer(
        supabase,
        group,
        sessionDate
      );

      if (result?.error) throw result.error;

      if (Number(result?.added || 0) > 0) {
        scheduleWorkspaceDraftSave();
        showToast(
          `وصل ${Number(result.added)} تسجيل نقاط جديد من ولاء`
        );
      }
    } catch (error) {
      const now = Date.now();
      if (now - lastPendingPollErrorAt > 30000) {
        console.warn("Live pending points refresh error:", error);
        lastPendingPollErrorAt = now;
      }
    } finally {
      pendingPointsPollBusy = false;
    }
  }

  async function runAttendanceLiveSync() {
    await Promise.allSettled([
      pollManagerPointsAccess(),
      pollOwnerPendingPoints()
    ]);
  }

  const liveSyncTimer = setInterval(
    runAttendanceLiveSync,
    LIVE_SYNC_INTERVAL_MS
  );

  window.addEventListener("focus", runAttendanceLiveSync);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) runAttendanceLiveSync();
  });

  window.addEventListener("pagehide", () => {
    clearInterval(liveSyncTimer);
  }, { once: true });

  console.info("Attendance live sync fix enabled");
})();
