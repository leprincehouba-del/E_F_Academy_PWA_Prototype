from pathlib import Path
import re

app_path = Path("app.js")
sw_path = Path("service-worker.js")
text = app_path.read_text(encoding="utf-8")


def replace_once(src, old, new, label):
    count = src.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 exact match, found {count}")
    return src.replace(old, new, 1)


def regex_once(src, pattern, repl, label, flags=0):
    out, count = re.subn(pattern, repl, src, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 regex match, found {count}")
    return out


# 1) Utility for bounded concurrency (used for Walaa point queue only).
marker = "function showToast(message) {"
helper = """async function mapWithConcurrency(items, limit, worker) {
  const list = Array.from(items || []);
  if (!list.length) return;

  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, list.length));
  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= list.length) return;
      await worker(list[index], index);
    }
  });

  await Promise.all(runners);
}

"""
if helper not in text:
    text = replace_once(text, marker, helper + marker, "insert concurrency helper")

# 2) Do not fire dashboard network work while another admin page is active.
text = regex_once(
    text,
    r"function renderAll\(\)\{\s*renderDashboard\(\);",
    "function renderAll(){\n  if ($(\"dashboard\")?.classList.contains(\"active-page\")) {\n    renderDashboard();\n  }",
    "scope dashboard rendering",
)

# 3) Preserve selected group when selects are rebuilt by a live refresh.
old_group_selects = """  ["groupSelect", "newGroup", "manageGroupSelect"].forEach(id => {
    if($(id)) $(id).innerHTML = groupOptions;
  });"""
new_group_selects = """  ["groupSelect", "newGroup", "manageGroupSelect"].forEach(id => {
    const element = $(id);
    if (!element) return;

    const previousValue = element.value;
    element.innerHTML = groupOptions;

    if (previousValue && [...element.options].some(
      option => String(option.value) === String(previousValue)
    )) {
      element.value = previousValue;
    }
  });"""
text = replace_once(text, old_group_selects, new_group_selects, "preserve group selections")

# 4) Package balance + package settings can load in parallel.
old_package_load = """  await loadStudentSessionPackageBalances();
  await loadSessionPackageSettings();
}"""
new_package_load = """  await Promise.allSettled([
    loadStudentSessionPackageBalances(),
    loadSessionPackageSettings()
  ]);
}"""
text = replace_once(text, old_package_load, new_package_load, "parallel package metadata")

# 5) UI role is already known after authentication; remove repeated is_owner RPCs.
text = regex_once(
    text,
    r"async function renderDashboard\(\)\{\s*const supabase = await getSupabase\(\);\s*\n\s*const \{ data: isOwner, error: ownerCheckError \} =\s*\n\s*await supabase\.rpc\(\"is_owner\"\);\s*\n\s*if \(ownerCheckError\) \{.*?\n\s*\}",
    "async function renderDashboard(){\n  const supabase = await getSupabase();\n  const isOwner = currentAppRole === \"owner\";",
    "dashboard owner check",
    re.S,
)
text = regex_once(
    text,
    r"\nconst \{ data: isOwner, error: ownerCheckError \} =\s*\n\s*await supabase\.rpc\(\"is_owner\"\);\s*\n\s*if \(!isCurrentAttendanceLoad\(\)\) return;\s*\n\s*if \(ownerCheckError\) \{.*?\n\s*return;\s*\n\}",
    "\nconst isOwner = currentAppRole === \"owner\";\n\nif (!isCurrentAttendanceLoad()) return;",
    "attendance owner check",
    re.S,
)

# 6) CRITICAL INTEGRITY FIX: owner new-attendance rows use the same safe RPC as managers.
start_marker = '    if(status==="present"){\n      s.present += 1; s.points += 3;'
end_marker = "\n  }\n\nconst pendingItems = ["
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("critical attendance block markers not found")
safe_block = """    if (dueBlocked) {
      blocked += 1;
    }

    const attendanceSaveResult = canEditAccount
      ? await supabase.rpc("save_safe_attendance_with_account", {
          p_session_id: sessionRow.id,
          p_student_id: s.id,
          p_attendance_status: persistedStatus,
          p_payment_status: payStatus,
          p_points_change: sessionPoints,
          p_points_details: pointsDetails,
          p_notes: null
        })
      : await supabase.rpc("save_safe_attendance", {
          p_session_id: sessionRow.id,
          p_student_id: s.id,
          p_attendance_status: persistedStatus,
          p_points_change: sessionPoints,
          p_points_details: pointsDetails,
          p_notes: null
        });

    if (attendanceSaveResult.error) {
      console.error(
        "Safe attendance error:",
        attendanceSaveResult.error
      );
      showToast("تعذر حفظ حضور الطالب؛ لم يتم إغلاق الحصة");
      return;
    }

    // سجل محلي للعرض فقط. الدفع الفعلي يتم داخل RPC الآمن،
    // حتى لا يتكرر الدفع إذا انقطع الاتصال وأُعيد الحفظ.
    if (
      isOwner &&
      isChargeableAttendance &&
      payStatus === "paid"
    ) {
      payments.unshift({
        studentId: s.id,
        amount: group.price,
        method: "نقدي",
        date: new Date().toISOString()
      });
    }

    sessionAttendance[s.id] = {
      status,
      payStatus,
      date: $("sessionDate").value
    };"""
text = text[:start] + safe_block + text[end:]
if "points_balance: s.points" in text:
    raise SystemExit("stale absolute points balance write still exists")

# 7) Save Walaa queued point rows with modest bounded concurrency.
walaa_start = text.find("    for (const entry of entries) {")
walaa_end_marker = "\n\n    renderManagerPointsStudents();"
walaa_end = text.find(walaa_end_marker, walaa_start)
if walaa_start < 0 or walaa_end < 0:
    raise SystemExit("Walaa queue loop markers not found")
walaa_block = text[walaa_start:walaa_end]
if not walaa_block.rstrip().endswith("}"):
    raise SystemExit("Walaa queue loop ending not recognized")
walaa_block = walaa_block.replace(
    "    for (const entry of entries) {",
    "    await mapWithConcurrency(entries, 5, async (entry) => {",
    1,
)
idx = walaa_block.rfind("    }")
if idx < 0:
    raise SystemExit("Walaa queue closing brace not found")
walaa_block = walaa_block[:idx] + "    });" + walaa_block[idx + len("    }"):]
text = text[:walaa_start] + walaa_block + text[walaa_end:]

# 8) Multiple weekly times: retain schedule rows and resolve time by selected date.
mapping_old = """      days: schedules.map((schedule) => schedule.day_name),
      time: schedules[0]?.start_time || group.start_time || "","""
mapping_new = """      days: schedules.map((schedule) => schedule.day_name),
      schedules: schedules.map(schedule => ({
        day_name: schedule.day_name,
        start_time: schedule.start_time,
        is_active: schedule.is_active !== false
      })),
      time: schedules[0]?.start_time || group.start_time || "","""
text = replace_once(text, mapping_old, mapping_new, "retain group schedules")

day_marker = """function dayName(){
  return ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][new Date().getDay()];
}"""
day_replacement = """function dayNameForDate(dateValue = localDateISO()) {
  const match = String(dateValue || "").match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date();

  return ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][date.getDay()];
}

function groupSessionStartTime(group, sessionDate = localDateISO()) {
  const targetDay = dayNameForDate(sessionDate);
  const schedule = Array.isArray(group?.schedules)
    ? group.schedules.find(item =>
        item?.is_active !== false &&
        String(item?.day_name || "") === String(targetDay)
      )
    : null;

  return schedule?.start_time || group?.time || "";
}

function dayName(){
  return dayNameForDate(localDateISO());
}"""
text = replace_once(text, day_marker, day_replacement, "date-aware group time helper")

optional_time_old = "const startTime = normalizeSessionStartTime(group?.time);"
if optional_time_old in text:
    text = text.replace(
        optional_time_old,
        "const startTime = normalizeSessionStartTime(\n    groupSessionStartTime(group, selectedDate)\n  );",
        1,
    )
count_plain = text.count("const startTime = normalizeSessionStartTime(group.time);")
if count_plain != 2:
    raise SystemExit(f"expected 2 attendance group.time startTime uses, found {count_plain}")
text = text.replace(
    "const startTime = normalizeSessionStartTime(group.time);",
    "const startTime = normalizeSessionStartTime(\n    groupSessionStartTime(group, sessionDate)\n  );",
)
text = replace_once(
    text,
    "const expectedSessionTime =\n  normalizeSessionStartTime(group.time);",
    "const expectedSessionTime =\n  normalizeSessionStartTime(\n    groupSessionStartTime(group, selectedSessionDate)\n  );",
    "selected session time",
)

# 9) WhatsApp UUID must be passed as a string.
text = replace_once(
    text,
    '<button class="whatsapp-btn" onclick="sendWhatsApp(${s.id})">واتساب</button>',
    '<button class="whatsapp-btn" onclick="sendWhatsApp(\'${s.id}\')">واتساب</button>',
    "WhatsApp UUID quoting",
)

# 10) Live admin student snapshot sync without touching unsaved attendance values.
globals_marker = "let attendancePendingPointsLiveSyncBusy = false;\n"
globals_add = """let attendancePendingPointsLiveSyncBusy = false;
const STUDENT_SNAPSHOT_SYNC_INTERVAL_MS = 15000;
const PARENT_DASHBOARD_SYNC_INTERVAL_MS = 30000;
let studentSnapshotSyncBusy = false;
let parentDashboardLiveSyncBusy = false;
let attendanceMembershipRefreshNotified = false;
"""
text = replace_once(text, globals_marker, globals_add, "live sync globals")

snapshot_helper = r'''

async function refreshStudentSnapshotLive(options = {}) {
  if (
    studentSnapshotSyncBusy ||
    document.hidden ||
    !currentAuthenticatedUserId ||
    !["owner", "manager"].includes(currentAppRole) ||
    $("appShell")?.classList.contains("hidden") ||
    $("saveAttendanceBtn")?.dataset.saving === "true" ||
    managerPointsSaving
  ) {
    return;
  }

  studentSnapshotSyncBusy = true;

  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("students")
      .select(`
        id,
        full_name,
        created_at,
        school_name,
        parent_phone,
        points_balance,
        due_sessions_count,
        due_amount,
        group_id,
        groups (code)
      `)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const beforeSignature = JSON.stringify(
      students.map(student => [
        student.id,
        student.name,
        student.group,
        Number(student.points || 0),
        Number(student.dueSessions || 0),
        Number(student.dueAmount || 0)
      ])
    );
    const previousById = new Map(
      students.map(student => [String(student.id), student])
    );

    students = (data || []).map(student => {
      const previous = previousById.get(String(student.id));
      return {
        id: student.id,
        name: student.full_name,
        createdAt: student.created_at,
        group: student.groups?.code || "",
        school: student.school_name || "غير محدد",
        phone: student.parent_phone || "",
        points: Number(student.points_balance || 0),
        dueSessions: Number(student.due_sessions_count || 0),
        dueAmount: Number(student.due_amount || 0),
        packageSessions: Number(previous?.packageSessions || 0),
        packageFirstValidDate: previous?.packageFirstValidDate || "",
        packageFirstPurchasedAt: previous?.packageFirstPurchasedAt || "",
        present: Number(previous?.present || 0),
        absent: Number(previous?.absent || 0),
        late: Number(previous?.late || 0)
      };
    });

    const afterSignature = JSON.stringify(
      students.map(student => [
        student.id,
        student.name,
        student.group,
        Number(student.points || 0),
        Number(student.dueSessions || 0),
        Number(student.dueAmount || 0)
      ])
    );

    if (beforeSignature === afterSignature && options.forceRender !== true) {
      return;
    }

    populateSelects();

    if ($("students")?.classList.contains("active-page")) {
      renderStudents();
    }

    if ($("points")?.classList.contains("active-page")) {
      if ($("managerPointsWorkspace")) {
        saveManagerPointsDraft();
        renderManagerPointsStudents();
      } else {
        renderLeaderboard();
      }
    }

    if ($("attendance")?.classList.contains("active-page")) {
      const currentGroupId = $("groupSelect")?.value || "";
      const currentDate = $("sessionDate")?.value || "";
      const draftKey = `${currentGroupId}::${currentDate}`;
      const renderedRows = [
        ...document.querySelectorAll("#attendanceBody tr[data-id]")
      ];
      const renderedIds = new Set(
        renderedRows.map(row => String(row.dataset.id || ""))
      );
      const expectedIds = new Set(
        students
          .filter(student => String(student.group) === String(currentGroupId))
          .map(student => String(student.id))
      );
      const membershipChanged =
        renderedIds.size !== expectedIds.size ||
        [...renderedIds].some(id => !expectedIds.has(id));

      renderedRows.forEach(row => {
        const student = students.find(item =>
          String(item.id) === String(row.dataset.id)
        );
        const balance = row.querySelector(".attendance-points-balance b");
        if (student && balance) {
          balance.textContent = String(Number(student.points || 0));
        }
        if (student) updateAttendanceArrearsRow(student.id);
      });

      if (membershipChanged && !attendanceWorkspaceDirtyKeys.has(draftKey)) {
        attendanceMembershipRefreshNotified = false;
        await loadAttendance();
      } else if (
        membershipChanged &&
        !attendanceMembershipRefreshNotified
      ) {
        attendanceMembershipRefreshNotified = true;
        showToast(
          "تغيرت قائمة المجموعة من جهاز آخر؛ لن نمسح تعديلات الحصة الحالية، وسيتم تحديث القائمة بعد الحفظ"
        );
      } else if (!membershipChanged) {
        attendanceMembershipRefreshNotified = false;
      }
    }
  } catch (error) {
    console.warn("Student snapshot live refresh error:", error);
  } finally {
    studentSnapshotSyncBusy = false;
  }
}
'''
if "async function refreshStudentSnapshotLive" not in text:
    text = replace_once(
        text,
        new_package_load,
        new_package_load + snapshot_helper,
        "student snapshot sync",
    )

# 11) Parent dashboard refreshes points/sessions/ranks without reloading homework/media.
text = replace_once(
    text,
    "function renderParentChild(childId) {\n",
    "function renderParentChild(childId, options = {}) {\n  const reloadResources = options.reloadResources !== false;\n",
    "parent render options",
)
resources_old = """  closeParentSessionDetails();
  parentHomeworkAssignments = [];
  parentLessonContents = [];
  parentHomeworkLoading = false;
  parentLessonContentLoading = false;
  parentHomeworkStudentId = child ? String(child.id) : "";
  parentLessonContentStudentId = child ? String(child.id) : "";
  parentHomeworkError = "";
  parentLessonContentError = "";"""
resources_new = """  if (reloadResources) {
    closeParentSessionDetails();
    parentHomeworkAssignments = [];
    parentLessonContents = [];
    parentHomeworkLoading = false;
    parentLessonContentLoading = false;
    parentHomeworkStudentId = child ? String(child.id) : "";
    parentLessonContentStudentId = child ? String(child.id) : "";
    parentHomeworkError = "";
    parentLessonContentError = "";
  }"""
text = replace_once(text, resources_old, resources_new, "parent resource reset guard")
text = replace_once(
    text,
    "loadParentChildSchedule(child.id);\nloadParentHomework(child.id);\nloadParentLessonContent(child.id);",
    "if (reloadResources) {\n  loadParentChildSchedule(child.id);\n  loadParentHomework(child.id);\n  loadParentLessonContent(child.id);\n}",
    "parent resource reload guard",
)

parent_live_helper = r'''

async function refreshParentDashboardLive() {
  if (
    parentDashboardLiveSyncBusy ||
    document.hidden ||
    currentAppRole !== "parent" ||
    $("parentPortal")?.classList.contains("hidden")
  ) {
    return;
  }

  parentDashboardLiveSyncBusy = true;

  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc("get_parent_dashboard");
    if (error) throw error;

    const selectedId = $("parentChildSelect")?.value || "";
    parentDashboardData = data || { children: [] };
    const children = parentDashboardData.children || [];

    try {
      const balances = await fetchStudentPackageBalances(
        children.map(child => child.id)
      );
      applyPackageBalances(children, balances);
    } catch (packageError) {
      if (!isPackageFeatureMissing(packageError)) {
        console.warn("Parent live package refresh error:", packageError);
      }
    }

    const childSelect = $("parentChildSelect");
    if (childSelect) {
      childSelect.innerHTML = children.map(child => `
        <option value="${child.id}">${child.name}</option>
      `).join("");

      const nextId = children.some(child =>
        String(child.id) === String(selectedId)
      )
        ? selectedId
        : String(children[0]?.id || "");

      if (nextId) childSelect.value = nextId;
      $("parentChildSelectWrap")?.classList.toggle(
        "hidden",
        children.length <= 1
      );

      renderParentChild(nextId, { reloadResources: false });
      refreshOpenParentSessionDetails();
    }
  } catch (error) {
    console.warn("Parent dashboard live refresh error:", error);
  } finally {
    parentDashboardLiveSyncBusy = false;
  }
}
'''
parent_insert_marker = "\nfunction urlBase64ToUint8Array(base64String) {"
if "async function refreshParentDashboardLive" not in text:
    text = replace_once(
        text,
        parent_insert_marker,
        parent_live_helper + parent_insert_marker,
        "parent live sync",
    )

# 12) Live timers/focus/BFCache recovery. Do not clear interval on pagehide.
timer_pattern = r'''const attendanceLiveSyncTimer = setInterval\(\s*runAttendanceLiveSync,\s*ATTENDANCE_LIVE_SYNC_INTERVAL_MS\s*\);\s*\n\s*window\.addEventListener\("focus", runAttendanceLiveSync\);\s*\ndocument\.addEventListener\("visibilitychange", \(\) => \{\s*\n\s*if \(!document\.hidden\) runAttendanceLiveSync\(\);\s*\n\}\);\s*\nwindow\.addEventListener\(\s*"pagehide",\s*\(\) => clearInterval\(attendanceLiveSyncTimer\),.*?\);'''
timer_repl = '''const attendanceLiveSyncTimer = setInterval(
  runAttendanceLiveSync,
  ATTENDANCE_LIVE_SYNC_INTERVAL_MS
);
const studentSnapshotSyncTimer = setInterval(
  refreshStudentSnapshotLive,
  STUDENT_SNAPSHOT_SYNC_INTERVAL_MS
);
const parentDashboardSyncTimer = setInterval(
  refreshParentDashboardLive,
  PARENT_DASHBOARD_SYNC_INTERVAL_MS
);

async function runAppLiveSync() {
  await Promise.allSettled([
    runAttendanceLiveSync(),
    refreshStudentSnapshotLive({ forceRender: true }),
    refreshParentDashboardLive()
  ]);
}

window.addEventListener("focus", runAppLiveSync);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) runAppLiveSync();
});
window.addEventListener("pageshow", event => {
  if (event.persisted) runAppLiveSync();
});'''
text = regex_once(text, timer_pattern, timer_repl, "live timers", re.S)

app_path.write_text(text, encoding="utf-8")

# 13) Service worker: network-first freshness without blocking UI on cache writes.
sw = sw_path.read_text(encoding="utf-8")
sw = replace_once(
    sw,
    'const CACHE = "ef-academy-v42";',
    'const CACHE = "ef-academy-v43";',
    "service worker cache version",
)
old_cache = """        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(e.request, response.clone());
        }

        return response;"""
new_cache = """        if (response.ok) {
          const responseCopy = response.clone();
          caches
            .open(CACHE)
            .then(cache => cache.put(e.request, responseCopy))
            .catch(error => console.warn("Cache update failed:", error));
        }

        return response;"""
sw = replace_once(sw, old_cache, new_cache, "non-blocking cache update")
sw_path.write_text(sw, encoding="utf-8")
