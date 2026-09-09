from pathlib import Path

path = Path('app.js')
text = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    text = text.replace(old, new, 1)

# Live-sync state. Keep attendance/Walaa at 5s, core admin data at 20s,
# parent points/sessions at 60s to avoid unnecessary database pressure.
replace_once(
    'let attendancePendingPointsLiveSyncBusy = false;\n',
    '''let attendancePendingPointsLiveSyncBusy = false;
const STUDENT_SNAPSHOT_SYNC_INTERVAL_MS = 20000;
const PARENT_DASHBOARD_SYNC_INTERVAL_MS = 60000;
let studentSnapshotSyncBusy = false;
let parentDashboardLiveSyncBusy = false;
let attendanceMembershipRefreshNotified = false;
''',
    'sync globals'
)

student_tail = '''  await Promise.allSettled([
    loadStudentSessionPackageBalances(),
    loadSessionPackageSettings()
  ]);
}
async function loadScheduleDataFromSupabase() {'''
student_sync = r'''  await Promise.allSettled([
    loadStudentSessionPackageBalances(),
    loadSessionPackageSettings()
  ]);
}

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
    return false;
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

    const previousById = new Map(
      students.map(student => [String(student.id), student])
    );
    const previousSignature = JSON.stringify(
      students.map(student => [
        String(student.id),
        student.name,
        student.group,
        student.school,
        student.phone,
        Number(student.points || 0),
        Number(student.dueSessions || 0),
        Number(student.dueAmount || 0)
      ])
    );

    const freshStudents = (data || []).map(student => {
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

    const freshSignature = JSON.stringify(
      freshStudents.map(student => [
        String(student.id),
        student.name,
        student.group,
        student.school,
        student.phone,
        Number(student.points || 0),
        Number(student.dueSessions || 0),
        Number(student.dueAmount || 0)
      ])
    );

    if (
      previousSignature === freshSignature &&
      options.forceRender !== true
    ) {
      return false;
    }

    students = freshStudents;
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

    if ($("dashboard")?.classList.contains("active-page")) {
      renderDashboard();
    }

    if ($("attendance")?.classList.contains("active-page")) {
      const currentGroupId = $("groupSelect")?.value || "";
      const currentDate = $("sessionDate")?.value || "";
      const draftKey = `${currentGroupId}::${currentDate}`;
      const renderedRows = [
        ...document.querySelectorAll("#attendanceBody tr[data-id]")
      ];

      // Always refresh visible balances, without touching attendance/payment inputs.
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

      // Membership is only auto-refreshed for today's working session.
      // Historical attendance is intentionally left tied to its stored rows.
      if (currentDate === localDateISO()) {
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

        if (
          membershipChanged &&
          !attendanceWorkspaceDirtyKeys.has(draftKey)
        ) {
          attendanceMembershipRefreshNotified = false;
          await loadAttendance();
        } else if (
          membershipChanged &&
          !attendanceMembershipRefreshNotified
        ) {
          attendanceMembershipRefreshNotified = true;
          showToast(
            "تغيرت قائمة المجموعة من جهاز آخر؛ لن يتم مسح تعديلات الحصة الحالية، وسيتم تحديث القائمة بعد الحفظ"
          );
        } else if (!membershipChanged) {
          attendanceMembershipRefreshNotified = false;
        }
      }
    }

    return true;
  } catch (error) {
    console.warn("Student live refresh error:", error);
    return false;
  } finally {
    studentSnapshotSyncBusy = false;
  }
}

async function loadScheduleDataFromSupabase() {'''
replace_once(student_tail, student_sync, 'admin student live sync')

# Allow lightweight re-render of parent points/sessions without reloading media lists.
replace_once(
    'function renderParentChild(childId) {\n',
    'function renderParentChild(childId, options = {}) {\n  const reloadResources = options.reloadResources !== false;\n',
    'parent render options'
)
replace_once(
'''  closeParentSessionDetails();
  parentHomeworkAssignments = [];
  parentLessonContents = [];
  parentHomeworkLoading = false;
  parentLessonContentLoading = false;
  parentHomeworkStudentId = child ? String(child.id) : "";
  parentLessonContentStudentId = child ? String(child.id) : "";
  parentHomeworkError = "";
  parentLessonContentError = "";''',
'''  if (reloadResources) {
    closeParentSessionDetails();
    parentHomeworkAssignments = [];
    parentLessonContents = [];
    parentHomeworkLoading = false;
    parentLessonContentLoading = false;
    parentHomeworkStudentId = child ? String(child.id) : "";
    parentLessonContentStudentId = child ? String(child.id) : "";
    parentHomeworkError = "";
    parentLessonContentError = "";
  }''',
    'parent resource reset guard'
)
replace_once(
'''loadParentChildSchedule(child.id);
loadParentHomework(child.id);
loadParentLessonContent(child.id);''',
'''if (reloadResources) {
  loadParentChildSchedule(child.id);
  loadParentHomework(child.id);
  loadParentLessonContent(child.id);
}''',
    'parent resource load guard'
)

parent_insert = '\nfunction urlBase64ToUint8Array(base64String) {'
parent_live = r'''

async function refreshParentDashboardLive(options = {}) {
  if (
    parentDashboardLiveSyncBusy ||
    document.hidden ||
    currentAppRole !== "parent" ||
    $("parentPortal")?.classList.contains("hidden")
  ) {
    return false;
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

      if (options.reloadResources === true && nextId) {
        await Promise.allSettled([
          loadParentHomework(nextId),
          loadParentLessonContent(nextId)
        ]);
      }
    }

    return true;
  } catch (error) {
    console.warn("Parent dashboard live refresh error:", error);
    return false;
  } finally {
    parentDashboardLiveSyncBusy = false;
  }
}
'''
replace_once(parent_insert, parent_live + parent_insert, 'parent dashboard live sync')

# Replace the old timer lifecycle. The previous pagehide clear could stop periodic
# synchronization after a BFCache return. Keep intervals alive and explicitly sync on focus/pageshow.
old_timers = '''const attendanceLiveSyncTimer = setInterval(
  runAttendanceLiveSync,
  ATTENDANCE_LIVE_SYNC_INTERVAL_MS
);

window.addEventListener("focus", runAttendanceLiveSync);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) runAttendanceLiveSync();
});
window.addEventListener(
  "pagehide",
  () => clearInterval(attendanceLiveSyncTimer),
  { once: true }
);'''
new_timers = '''const attendanceLiveSyncTimer = setInterval(
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

async function runAppLiveSync(options = {}) {
  const parentResources = options.parentResources === true;

  await Promise.allSettled([
    runAttendanceLiveSync(),
    refreshStudentSnapshotLive({ forceRender: true }),
    refreshParentDashboardLive({ reloadResources: parentResources })
  ]);
}

window.addEventListener("focus", () => {
  runAppLiveSync({ parentResources: true });
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    runAppLiveSync({ parentResources: true });
  }
});
window.addEventListener("pageshow", event => {
  if (event.persisted) {
    runAppLiveSync({ parentResources: true });
  }
});'''
replace_once(old_timers, new_timers, 'live timer lifecycle')

path.write_text(text, encoding='utf-8')
