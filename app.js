const VAPID_PUBLIC_KEY =
  "BI441_INsdU7MfijuEieYnhztSYcUcQj2Jax589YO66mQtKqrZ_XUZxQm92PajaYh-6LA1E3qEw_q-ArUP1azAg";
const SUPABASE_URL = "https://bmnrltyodljgvrcssjhd.supabase.co";
const SUPABASE_KEY = "sb_publishable_Tk7XuO4BCs9baofK6yjy0Q_LzOKTNVd";

let supabaseClient;

async function getSupabase() {
  if (supabaseClient) return supabaseClient;

  const { createClient } = await import(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
  );

  supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  return supabaseClient;
}

const groups = [];
let groupSchedules = [];
let scheduleGroups = [];


let students = [];
let payments = JSON.parse(localStorage.getItem("ef_payments") || "[]");
let sessionAttendance = {};
let deferredPrompt = null;

const $ = id => document.getElementById(id);
const groupById = value =>
  groups.find((g) =>
    String(g.id) === String(value) ||
    String(g.code || "")
      .toLowerCase()
      .replaceAll("_", "") ===
    String(value || "")
      .toLowerCase()
      .replaceAll("_", "")
  );
const save = () => {
  localStorage.setItem("ef_students", JSON.stringify(students));
  localStorage.setItem("ef_payments", JSON.stringify(payments));
};

function showToast(message){
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>toast.classList.remove("show"),2600);
}
function localDateISO(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
function setToday(){
  const d = new Date();
  $("todayText").textContent = d.toLocaleDateString("ar-EG",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
 $("sessionDate").value = localDateISO(d);
}

let parentDashboardData = {
  children: []
};

function parentAttendanceLabel(status) {
  return {
    present: "حاضر",
    late: "متأخر",
    absent: "غائب",
    excused: "غائب بعذر"
  }[status] || "غير مسجل";
}

function parentPaymentLabel(status) {
  return {
    paid: "تم الدفع",
    due: "مؤجل",
    free: "حصة مجانية"
  }[status] || "غير محدد";
}

function parentFormatDate(dateValue) {
  if (!dateValue) return "";

  return new Date(
    `${dateValue}T00:00:00`
  ).toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function renderParentChild(childId) {
  const children =
    parentDashboardData.children || [];

  const child =
    children.find(
      item => String(item.id) === String(childId)
    ) || children[0];

  if (!child) {
    $("parentChildName").textContent =
      "لا يوجد طلاب مرتبطون بهذا الحساب";

    $("parentSessionsList").innerHTML = `
      <div class="list-item">
        لا توجد بيانات متاحة
      </div>
    `;

    return;
  }

  $("parentChildName").textContent =
    child.name || "الطالب";

  $("parentChildGroup").textContent =
    [child.group_name, child.grade]
      .filter(Boolean)
      .join(" — ");

  $("parentPoints").textContent =
    Number(child.points || 0);

  $("parentGradeRank").textContent =
    child.grade_rank
      ? `رقم ${child.grade_rank}`
      : "-";

  $("parentOverallRank").textContent =
    child.overall_rank
      ? `رقم ${child.overall_rank}`
      : "-";

  $("parentDueAmount").textContent =
    `${Number(child.due_amount || 0).toFixed(2)} جنيه`;

  $("parentDueSessions").textContent =
    Number(child.due_sessions || 0);

  const sessions =
    Array.isArray(child.sessions)
      ? child.sessions
      : [];

  $("parentSessionsList").innerHTML =
    sessions.length
      ? sessions.map(session => {
          const pointDetails =
            Array.isArray(session.points_details)
              ? session.points_details
              : [];

          const pointReasons =
            pointDetails.length
              ? pointDetails
                  .map(detail => {
                    const value = Number(
                      detail.value ??
                      detail.points ??
                      0
                    );

  const rawReason = String(
  detail.reason ||
  detail.label ||
  "نقاط الحصة"
).trim();

const reasonKey = rawReason
  .toLowerCase()
  .replace(/[\s_-]+/g, "");

const reasonTranslations = {
  attendance: "الحضور",
  attendancepoints: "الحضور",
  present: "الحضور",
  absence: "الغياب",
  absent: "الغياب",
  late: "التأخير",
  delay: "التأخير",
 homework: "الواجب",
homeworkdone: "الواجب",
writtenrecitation: "التسميع التحريري",
oralrecitation: "التسميع الشفوي",
recitation: "التسميع",
  participation: "المشاركة",
  classparticipation: "المشاركة",
  activity: "النشاط",
  exam: "الامتحان",
  test: "الاختبار",
  quiz: "الاختبار",
  behavior: "السلوك",
  conduct: "السلوك",
  other: "سبب آخر",
  bonus: "نقاط إضافية",
  extra: "نقاط إضافية",
  extrapoints: "نقاط إضافية",
  penalty: "خصم نقاط",
  deduction: "خصم نقاط",
  session: "نقاط الحصة",
  sessionpoints: "نقاط الحصة"
};

const reason =
  reasonTranslations[reasonKey] ||
  rawReason;

                    return `
                      <div>
                        ${value > 0 ? "+" : ""}
                        ${value} نقطة — ${reason}
                      </div>
                    `;
                  })
                  .join("")
              : `
                  <div>
                    لا توجد تفاصيل نقاط
                  </div>
                `;

          return `
            <article class="list-item">
              <div>
                <strong>
                  ${parentFormatDate(
                    session.session_date
                  )}
                </strong>

                <span>
                  الحضور:
                  ${parentAttendanceLabel(
                    session.attendance_status
                  )}
                </span>

                <span>
                  الدفع:
                  ${parentPaymentLabel(
                    session.payment_status
                  )}
                </span>

                <span>
                  قيمة الحصة:
                  ${Number(
                    session.charge_amount || 0
                  ).toFixed(2)}
                  جنيه
                </span>

                <span>
                  نقاط الحصة:
                  ${Number(
                    session.points_change || 0
                  )}
                </span>

                <div class="parent-point-reasons">
                  ${pointReasons}
                </div>

                ${
                  session.notes
                    ? `
                        <span>
                          ملاحظات: ${session.notes}
                        </span>
                      `
                    : ""
                }
              </div>
            </article>
          `;
        }).join("")
      : `
          <div class="list-item">
            لا توجد حصص مسجلة لهذا الطالب
          </div>
        `;
}

async function openParentPortal(profile) {
  const supabase =
    await getSupabase();

  const {
    data,
    error
  } = await supabase.rpc(
    "get_parent_dashboard"
  );

  if (error) {
    throw error;
  }

  parentDashboardData =
    data || { children: [] };

  const children =
    parentDashboardData.children || [];

  $("loginScreen")
    .classList.add("hidden");

  $("appShell")
    .classList.add("hidden");

  $("parentPortal")
    .classList.remove("hidden");

  $("parentWelcomeName").textContent =
    `مرحبًا ${profile.full_name || ""}`;

  const childSelect =
    $("parentChildSelect");

  childSelect.innerHTML =
    children.map(child => `
      <option value="${child.id}">
        ${child.name}
      </option>
    `).join("");

  $("parentChildSelectWrap")
    .classList.toggle(
      "hidden",
      children.length <= 1
    );

  renderParentChild(
    children[0]?.id
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding =
    "=".repeat((4 - base64String.length % 4) % 4);

  const base64 =
    (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  const rawData = window.atob(base64);

  return Uint8Array.from(
    [...rawData].map(char => char.charCodeAt(0))
  );
}

async function enableParentNotifications() {
  try {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      showToast("هذا الجهاز لا يدعم الإشعارات");
      return;
    }

    const permission =
      await Notification.requestPermission();

    if (permission !== "granted") {
      showToast("لم يتم السماح بالإشعارات");
      return;
    }

    const registration =
      await navigator.serviceWorker.ready;

    let subscription =
      await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription =
        await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey:
            urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
    }

    const supabase = await getSupabase();

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      throw new Error("لم يتم العثور على حساب ولي الأمر");
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint: subscription.endpoint,
          subscription: subscription.toJSON(),
          updated_at: new Date().toISOString()
        },
        {
          onConflict: "endpoint"
        }
      );

    if (error) {
      throw error;
    }

    showToast("تم تفعيل الإشعارات بنجاح 🔔");

  } catch (error) {
    console.error(
      "Enable notifications error:",
      error
    );

    showToast(
      error?.message || "تعذر تفعيل الإشعارات"
    );
  }
}

async function login() {
  const loginValue =
    $("loginPhone").value.trim().toLowerCase();

  const password =
    $("loginPassword").value;

  if (!loginValue || !password) {
    showToast(
      "أدخل رقم الهاتف أو البريد وكلمة المرور"
    );
    return;
  }

  const emailCandidates = loginValue.includes("@")
  ? [loginValue]
  : [
      `${loginValue}@efacademy.local`,
      `${loginValue}@example.com`
    ];

try {
  const supabase =
    await getSupabase();

  let data = null;
  let lastError = null;

  for (const email of emailCandidates) {
    const result =
      await supabase.auth.signInWithPassword({
        email,
        password
      });

    if (!result.error) {
      data = result.data;
      lastError = null;
      break;
    }

    lastError = result.error;
  }

  if (!data?.user) {
    throw lastError ||
      new Error("تعذر تسجيل الدخول");
  }

    const {
      data: profile,
      error: profileError
    } = await supabase
      .from("user_profiles")
      .select(
        "full_name, role, is_active"
      )
      .eq("id", data.user.id)
      .single();

    if (profileError) {
      throw profileError;
    }

    if (!profile.is_active) {
  await supabase.auth.signOut();

  showToast(
    "هذا الحساب غير مصرح له بالدخول"
  );

  return;
}

if (profile.role === "parent") {
  await openParentPortal(profile);
  return;
}

const allowedRoles = [
  "owner",
  "manager"
];

if (!allowedRoles.includes(profile.role)) {
  await supabase.auth.signOut();

  showToast(
    "هذا الحساب غير مصرح له بالدخول"
  );

  return;
}

$("parentPortal")
  ?.classList.add("hidden");

$("loginScreen")
  .classList.add("hidden");

$("appShell")
  .classList.remove("hidden");

await loadStudentsFromSupabase();
await loadScheduleDataFromSupabase();

renderAll();
await applyManagerPermissions(profile, data.user.id);
  } catch (error) {
    console.error(error);

    showToast(
      error.message ||
      "تعذر تسجيل الدخول"
    );
  }
}

function showParentSignup() {
  const loginBox = $("loginFormBox");
  const signupBox = $("parentSignupBox");

  if (loginBox) {
    loginBox.hidden = true;
  }

  if (signupBox) {
    signupBox.hidden = false;
  }
}

function hideParentSignup() {
  const loginBox = $("loginFormBox");
  const signupBox = $("parentSignupBox");

  if (signupBox) {
    signupBox.hidden = true;
  }

  if (loginBox) {
    loginBox.hidden = false;
  }
}

async function createParentAccount() {
  let phone =
    $("parentSignupPhone")?.value
      .trim()
      .replace(/\D/g, "") || "";

  const password =
    $("parentSignupPassword")?.value || "";

  const passwordConfirm =
    $("parentSignupPasswordConfirm")?.value || "";

  // لو الرقم مكتوب بصيغة 20xxxxxxxxxx
  if (
    phone.startsWith("20") &&
    phone.length === 12
  ) {
    phone = "0" + phone.slice(2);
  }

  if (!/^01[0125]\d{8}$/.test(phone)) {
    showToast("أدخل رقم هاتف مصري صحيح");
    return;
  }

  if (password.length < 6) {
    showToast(
      "كلمة المرور يجب أن تكون 6 أحرف على الأقل"
    );
    return;
  }

  if (password !== passwordConfirm) {
    showToast("كلمتا المرور غير متطابقتين");
    return;
  }

    const email =
  `${phone}@example.com`;

  const signupBtn =
    $("parentSignupBtn");

  if (signupBtn) {
    signupBtn.disabled = true;
    signupBtn.textContent =
      "جارٍ إنشاء الحساب...";
  }

  try {
    const supabase =
      await getSupabase();

    const { data, error } =
      await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            signup_type: "parent",
            phone,
            full_name: "ولي أمر"
          }
        }
      });

    if (error) {
      throw error;
    }

    // لو Supabase سجل دخوله تلقائيًا
    // نخرجه علشان يدخل من شاشة الدخول بنفسه
    if (data?.session) {
      await supabase.auth.signOut();
    }

    $("loginPhone").value = phone;
    $("loginPassword").value = "";

    $("parentSignupPhone").value = "";
    $("parentSignupPassword").value = "";
    $("parentSignupPasswordConfirm").value = "";

    hideParentSignup();

    showToast(
      "تم إنشاء الحساب بنجاح، يمكنك تسجيل الدخول الآن"
    );

  } catch (error) {
    console.error(
      "Parent signup error:",
      error
    );

    let message =
      error.message ||
      "تعذر إنشاء الحساب";

    if (
      message
        .toLowerCase()
        .includes("already registered")
    ) {
      message =
        "يوجد حساب مسجل بالفعل بهذا الرقم";
    }

    showToast(message);

  } finally {
    if (signupBtn) {
      signupBtn.disabled = false;
      signupBtn.textContent =
        "إنشاء الحساب";
    }
  }
}

async function checkSession() {
  try {
    const supabase = await getSupabase();

    const {
      data: { session },
      error
    } = await supabase.auth.getSession();

    if (error) throw error;

    if (!session) {
      $("appShell")?.classList.add("hidden");
      $("parentPortal")?.classList.add("hidden");
      $("loginScreen")?.classList.remove("hidden");
      return;
    }

    const {
      data: profile,
      error: profileError
    } = await supabase
      .from("user_profiles")
      .select("full_name, role, is_active")
      .eq("id", session.user.id)
      .single();

    if (profileError) throw profileError;

    if (!profile.is_active) {
      await supabase.auth.signOut();

      $("appShell")?.classList.add("hidden");
      $("parentPortal")?.classList.add("hidden");
      $("loginScreen")?.classList.remove("hidden");

      showToast("هذا الحساب غير مصرح له بالدخول");
      return;
    }

    if (profile.role === "parent") {
      $("appShell")?.classList.add("hidden");
      $("loginScreen")?.classList.add("hidden");

      await openParentPortal(profile);
      return;
    }

    const allowedRoles = [
      "owner",
      "manager"
    ];

    if (!allowedRoles.includes(profile.role)) {
      await supabase.auth.signOut();

      $("appShell")?.classList.add("hidden");
      $("parentPortal")?.classList.add("hidden");
      $("loginScreen")?.classList.remove("hidden");

      showToast("هذا الحساب غير مصرح له بالدخول");
      return;
    }

    $("parentPortal")?.classList.add("hidden");
    $("loginScreen")?.classList.add("hidden");
    
    await loadScheduleDataFromSupabase();
    await loadStudentsFromSupabase();

    renderAll();
    await applyManagerPermissions(profile, session.user.id);
  } catch (error) {
    console.error("Session check error:", error);

    $("appShell")?.classList.add("hidden");
    $("parentPortal")?.classList.add("hidden");
    $("loginScreen")?.classList.remove("hidden");
  }
}

async function logout() {
  $("appShell")?.classList.add("hidden");
  $("parentPortal")?.classList.add("hidden");
  $("loginScreen")?.classList.remove("hidden");

  if ($("loginPhone")) {
    $("loginPhone").value = "";
  }

  if ($("loginPassword")) {
    $("loginPassword").value = "";
    $("loginPassword").type = "password";
  }

  try {
    const supabase = await getSupabase();

    const { error } = await supabase.auth.signOut();

    if (error) throw error;

    showToast("تم تسجيل الخروج");
  } catch (error) {
    console.error("Logout error:", error);
    showToast("تم إغلاق الواجهة وتعذر إنهاء الجلسة");
  }
}

async function applyManagerPermissions(profile, userId) {
  const navButtons = [
    ...document.querySelectorAll("#navMenu button")
  ];

  // المستر: كل القوائم وواجهة Points الأصلية
  if (profile.role === "owner") {
    navButtons.forEach(button => {
      button.style.display = "";
    });

    restoreOwnerPointsWorkspace();
    $("appShell")?.classList.remove("hidden");
    return;
  }

  // المسؤول
  if (profile.role !== "manager") {
    return;
  }

  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from("manager_permissions")
    .select("permissions")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Permissions error:", error);
    showToast("تعذر تحميل صلاحيات المسؤول");
    return;
  }

  const permissions = data?.permissions || {};

  navButtons.forEach(button => {
    const page = button.dataset.page;

    const allowed =
  (page === "attendance" && permissions.attendance_view === true) ||
  (page === "students" && permissions.students_view === true) ||
  (page === "points" && permissions.points_view === true) ||
  (page === "schedule" && permissions.schedule_view === true);

    button.style.display = allowed ? "" : "none";
  });

  if (permissions.points_view === true) {
  renderManagerPointsWorkspace(permissions.points_edit === true);
}

if (
  permissions.schedule_view === true &&
  permissions.schedule_edit !== true
) {
  const scheduleLayout =
    $("schedule")?.querySelector(".two-col");

  if (scheduleLayout?.children?.[0]) {
    scheduleLayout.children[0].style.display = "none";
  }
  $("schedule")?.classList.add("schedule-readonly");
}
if (permissions.attendance_view === true) {
  navigate("attendance");
} else if (permissions.students_view === true) {
  navigate("students");
} else if (permissions.points_view === true) {
  navigate("points");
} else if (permissions.schedule_view === true) {
  navigate("schedule");
}
$("appShell")?.classList.remove("hidden");
}

function restoreOwnerPointsWorkspace() {
  const managerWorkspace =
    $("managerPointsWorkspace");

  if (managerWorkspace) {
    managerWorkspace.remove();
  }

  const ownerLayout =
    $("points")?.querySelector(".two-col");

  if (ownerLayout) {
    ownerLayout.style.display = "";
  }
}
const managerPointsDrafts = {};

let managerPointsActiveGroup = "";
let managerPointsActiveReason = "";
let managerPointsSaving = false;

function saveManagerPointsDraft() {
  if (
    !managerPointsActiveGroup ||
    !managerPointsActiveReason
  ) {
    return;
  }

  const key =
    `${managerPointsActiveGroup}__${managerPointsActiveReason}`;

  managerPointsDrafts[key] =
    managerPointsDrafts[key] || {};

  document
    .querySelectorAll(
      "#managerPointsStudents .manager-points-value"
    )
    .forEach(input => {
      managerPointsDrafts[key][input.dataset.id] =
        input.value;
    });
}

function renderManagerPointsStudents() {
  const groupSelect =
    $("managerPointsGroup");

  const listBox =
    $("managerPointsStudents");

  if (!groupSelect || !listBox) return;

  const groupId =
    groupSelect.value;

    const reason =
  $("managerPointsReason")?.value || "";

const draftKey =
  `${groupId}__${reason}`;

const currentDraft =
  managerPointsDrafts[draftKey] || {};

managerPointsActiveGroup = groupId;
managerPointsActiveReason = reason;

  const list = students.filter(
    student =>
      String(student.group) ===
      String(groupId)
  );

  listBox.innerHTML = list.length
    ? `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>الطالب</th>
              <th>رصيد النقاط</th>
              <th>الحصص المتراكمة</th>
              <th>النقاط</th>
            </tr>
          </thead>

          <tbody>
            ${list.map(student => {
              const blocked =
                Number(
                  student.dueSessions || 0
                ) >= 3;

              return `
                <tr>
                  <td>
                    <strong>
                      ${student.name}
                    </strong>

                    ${
                      blocked
                        ? `
                          <div
                            style="
                              margin-top:4px;
                              color:#b42318;
                              font-size:12px;
                            "
                          >
                            متوقف بسبب الحصص غير المدفوعة
                          </div>
                        `
                        : ""
                    }
                  </td>

                  <td>
                    <b>
                      ${Number(
                        student.points || 0
                      )}
                    </b>
                  </td>

                  <td>
                    <span
                      class="badge ${
                        blocked ? "red" : ""
                      }"
                    >
                      ${Number(
                        student.dueSessions || 0
                      )} / 3
                    </span>
                  </td>

                  <td>
                    <input
                      class="manager-points-value"
                      data-id="${student.id}"
                      type="number"
                      step="1"
                     value="${currentDraft[student.id] ?? 0}"
                      placeholder="عدد النقاط"
                      ${blocked ? "disabled" : ""}
                    >
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `
    : `
      <div class="list-item">
        لا يوجد طلاب في هذه المجموعة
      </div>
    `;
}

async function saveManagerPoints() {
  if (managerPointsSaving) {
    return;
  }

  const groupSelect =
    $("managerPointsGroup");

  const reasonSelect =
    $("managerPointsReason");

  const selectedGroupId =
    groupSelect?.value || "";

  if (!selectedGroupId) {
    showToast("اختر المجموعة أولًا");
    return;
  }

  // نحفظ السبب المفتوح حاليًا في المسودة
  saveManagerPointsDraft();

  // أسماء الأسباب كما تظهر في القائمة
  const reasonLabels = {};

  if (reasonSelect) {
    [...reasonSelect.options].forEach(option => {
      if (option.value) {
        reasonLabels[option.value] =
          option.textContent.trim();
      }
    });
  }

  const groupPrefix =
    `${selectedGroupId}__`;

  const entries = [];

  // نجمع كل الأسباب المحفوظة للمجموعة الحالية
  Object.entries(managerPointsDrafts)
    .forEach(([draftKey, draft]) => {

      if (!draftKey.startsWith(groupPrefix)) {
        return;
      }

      const reasonKey =
        draftKey.slice(groupPrefix.length);

      if (!reasonKey) return;

      const reasonText =
        reasonLabels[reasonKey] ||
        reasonKey;

      const reasonType =
        {
          homework: "homework",
          participation: "participation"
        }[reasonKey] || "manual";

      Object.entries(draft || {})
        .forEach(([studentId, rawPoints]) => {

          const points =
            Number(rawPoints || 0);

          if (
            !Number.isFinite(points) ||
            points === 0
          ) {
            return;
          }

          entries.push({
            studentId,
            points,
            reasonKey,
            reasonType,
            reasonText,
            draftKey
          });
        });
    });

  if (!entries.length) {
    showToast(
      "اكتب نقاط طالب واحد على الأقل"
    );
    return;
  }

  managerPointsSaving = true;

  const saveButton =
    $("saveManagerPointsBtn");

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent =
      "جارٍ تسجيل النقاط...";
  }

  if (groupSelect) {
    groupSelect.disabled = true;
  }

  if (reasonSelect) {
    reasonSelect.disabled = true;
  }

  let queued = 0;
  let blocked = 0;
  let closed = 0;
  let failed = 0;

  try {
    const supabase =
      await getSupabase();

    const sessionDate =
      localDateISO();

    for (const entry of entries) {

      const {
        data,
        error
      } = await supabase.rpc(
        "queue_manager_points",
        {
          p_student_id:
            entry.studentId,

          p_points:
            entry.points,

          p_reason_key:
            entry.reasonKey,

          p_reason_type:
            entry.reasonType,

          p_reason_text:
            entry.reasonText,

          p_session_date:
            sessionDate
        }
      );

      if (error) {
        console.error(
          "Pending points save error:",
          error
        );

        failed += 1;
        continue;
      }

      if (data?.blocked) {
        blocked += 1;
        continue;
      }

      if (
        data?.closed ||
        data?.already_applied
      ) {
        closed += 1;
        continue;
      }

      if (!data?.queued) {
        failed += 1;
        continue;
      }

      // نمسح فقط القيمة التي تم إرسالها بنجاح
      if (
        managerPointsDrafts[
          entry.draftKey
        ]
      ) {
        delete managerPointsDrafts[
          entry.draftKey
        ][entry.studentId];

        if (
          Object.keys(
            managerPointsDrafts[
              entry.draftKey
            ]
          ).length === 0
        ) {
          delete managerPointsDrafts[
            entry.draftKey
          ];
        }
      }

      queued += 1;
    }

    renderManagerPointsStudents();

    let message =
      `تم إرسال ${queued} تسجيل نقاط للاعتماد`;

    if (blocked) {
      message +=
        ` — متوقف ${blocked}`;
    }

    if (closed) {
      message +=
        ` — مغلق ${closed}`;
    }

    if (failed) {
      message +=
        ` — تعذر ${failed}`;
    }

    showToast(message);

  } catch (error) {
    console.error(error);

    showToast(
      error.message ||
      "تعذر تسجيل النقاط"
    );

  } finally {
    managerPointsSaving = false;

    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent =
        "حفظ النقاط";
    }

    if (groupSelect) {
      groupSelect.disabled = false;
    }

    if (reasonSelect) {
      reasonSelect.disabled = false;
    }
  }
}

function renderManagerPointsWorkspace(canEdit = false) {
  const pointsPage =
    $("points");

  if (!pointsPage) return;
  if (!canEdit) {
  const ownerLayout =
    pointsPage.querySelector(".two-col");

  const workspace =
    $("managerPointsWorkspace");

  if (workspace) {
    workspace.remove();
  }

  if (ownerLayout) {
    ownerLayout.style.display = "";

    Array.from(ownerLayout.children).forEach(
      (panel, index) => {
        panel.style.display =
          index === 0 ? "none" : "";
      }
    );
  }

  return;
}

  // نخفي واجهة المستر القديمة
  // للمسؤول فقط
  const ownerLayout =
    pointsPage.querySelector(".two-col");

  if (ownerLayout) {
    ownerLayout.style.display = "none";
  }

  let workspace =
    $("managerPointsWorkspace");

  if (!workspace) {
    workspace =
      document.createElement("div");

    workspace.id =
      "managerPointsWorkspace";

    workspace.innerHTML = `
      <article class="panel">

        <div class="panel-head">
          <div>
            <span class="eyebrow">
              تسجيل النقاط
            </span>

            <h3>
              نقاط الطلاب
            </h3>
          </div>
        </div>

        <div class="inline-fields">

          <label>
            المجموعة

            <select
              id="managerPointsGroup"
            ></select>
          </label>

          <label>
            السبب

            <select
              id="managerPointsReason"
            >
              <option value="">
                اختر السبب
              </option>

              <option value="oral_recitation">
                التسميع الشفوي
              </option>

              <option value="written_recitation">
                التسميع التحريري
              </option>

              <option value="homework">
                الواجب
              </option>

              <option value="participation">
                المشاركة
              </option>

              <option value="activity">
                النشاط
              </option>

              <option value="quiz">
                الاختبار
              </option>

              <option value="exam">
                الامتحان
              </option>

              <option value="behavior">
                السلوك
              </option>
            </select>
          </label>

        </div>

        <div
          id="managerPointsStudents"
          style="margin-top:18px;"
        ></div>

        <button
          id="saveManagerPointsBtn"
          class="primary-btn wide"
          type="button"
          style="margin-top:18px;"
        >
          حفظ النقاط
        </button>

        <small
          style="
            display:block;
            margin-top:10px;
          "
        >
تسجيل النقاط فقط — لا تُضاف لرصيد الطالب إلا بعد اعتماد وإغلاق الحصة
        </small>

      </article>
    `;

    pointsPage.prepend(
      workspace
    );

    $("managerPointsGroup")
  ?.addEventListener("change", () => {
    saveManagerPointsDraft();
    renderManagerPointsStudents();
  });
      
      $("managerPointsReason")
  ?.addEventListener("change", () => {
    saveManagerPointsDraft();
    renderManagerPointsStudents();
  });

    $("saveManagerPointsBtn")
      ?.addEventListener(
        "click",
        saveManagerPoints
      );
  }

  const groupSelect =
    $("managerPointsGroup");

  const oldValue =
    groupSelect?.value || "";

  if (groupSelect) {
    groupSelect.innerHTML =
      groups.map(group => `
        <option value="${group.id}">
          ${group.name}
        </option>
      `).join("");

    if (
      oldValue &&
      groups.some(
        group =>
          String(group.id) ===
          String(oldValue)
      )
    ) {
      groupSelect.value =
        oldValue;
    }
  }

  renderManagerPointsStudents();
}

function navigate(page){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active-page"));
  document.querySelectorAll("#navMenu button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  $(page).classList.add("active-page");
  const title = document.querySelector(`#navMenu button[data-page="${page}"]`).textContent.replace(/^[^\s]+\s/,"");
  $("pageTitle").textContent = title;
  document.querySelector(".sidebar").classList.remove("open");
  renderAll();
}

function renderAll(){
  renderDashboard();
  populateSelects();
  renderStudents();
  renderPayments();
  renderLeaderboard();
  renderGradeRanking();
  renderSchedule();
  renderParent();
}

function dayName(){
  return ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][new Date().getDay()];
}
async function loadStudentsFromSupabase() {
  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from("students")
    .select(`
      id,
      full_name,
      school_name,
     
      parent_phone,
      points_balance,
      due_sessions_count,
      due_amount,
      group_id,
      groups (
        code
      )
    `)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) {
    showToast("تعذر تحميل الطلاب");
    return;
  }

  students = data.map(student => ({
    id: student.id,
    name: student.full_name,
    group: (student.groups?.code || "").toLowerCase().replace("-", ""),
    school: student.school_name || "غير محدد",
    phone: student.parent_phone || "",
    points: Number(student.points_balance || 0),
    dueSessions: Number(student.due_sessions_count || 0),
    dueAmount: Number(student.due_amount || 0),
    present: 0,
    absent: 0,
    late: 0
  }));
}
async function loadScheduleDataFromSupabase() {
  try {
    const supabase = await getSupabase();

    const { data: groupsData, error: groupsError } = await supabase
      .from("groups")
    .select("id, code, name, stage, grade, meeting_days, start_time, session_price, is_active")
      .eq("is_active", true)
      .order("stage", { ascending: true })
      .order("grade", { ascending: true })
      .order("name", { ascending: true });

    if (groupsError) throw groupsError;

    const { data: schedulesData, error: schedulesError } = await supabase
      .from("group_schedules")
      .select("id, group_id, day_name, start_time, is_active")
      .eq("is_active", true)
      .order("start_time", { ascending: true });

    if (schedulesError) throw schedulesError;

    scheduleGroups = groupsData || [];
    groupSchedules = schedulesData || [];
    groups.length = 0;

groups.push(
  ...scheduleGroups.map((group) => {
    const schedules = groupSchedules.filter(
      (schedule) =>
        schedule.group_id === group.id &&
        schedule.is_active !== false
    );

    return {
      id: group.code,
      dbId: group.id,
      code: group.code,
      name: group.name,
      stage: group.stage,
      grade: group.grade,
      days: schedules.map((schedule) => schedule.day_name),
      time: schedules[0]?.start_time || group.start_time || "",
      price: Number(group.session_price || 0)
    };
  })
);

    return true;
  } catch (error) {
    console.error("Schedule load error:", error);
    scheduleGroups = [];
    groupSchedules = [];
    showToast("تعذر تحميل بيانات الجدول");
    return false;
  }
}
async function renderDashboard(){
  const supabase = await getSupabase();

  const { data: isOwner, error: ownerCheckError } =
    await supabase.rpc("is_owner");

  if (ownerCheckError) {
    console.error("Owner check error:", ownerCheckError);
    return;
  }

  const ownerOnlyWords = [
  "مدخولات اليوم",
  "الطلاب الذين دفعوا",
  "الطلاب اللي دفعوا",
  "إجمالي التحصيل",
  "المبالغ المحصلة",
  "تم تحصيلها"
];

document
  .querySelectorAll("#dashboard .stat-card, #dashboard article")
  .forEach(card => {
    const isFinancialCard = ownerOnlyWords.some(word =>
      card.textContent.includes(word)
    );

    if (isFinancialCard) {
      card.style.display = isOwner ? "" : "none";
    }
  });
  const totalDueSessions = students.reduce((a,s)=>a+s.dueSessions,0);
  const totalPoints = students.reduce((a,s)=>a+s.points,0);
  const presentToday = Object.values(sessionAttendance).filter(x=>x.status==="present").length;
  const collectedToday = payments
    .filter(p=>new Date(p.date).toDateString()===new Date().toDateString())
    .reduce((a,p)=>a+p.amount,0);
  const todaysGroups = groups.filter(g => {
  const days = Array.isArray(g.days)
    ? g.days
    : Array.isArray(g.meeting_days)
      ? g.meeting_days
      : [];

  return days.includes(dayName());
});
  const todayStudentCount = students.filter(s=>todaysGroups.some(g=>g.id===s.group)).length;

  $("statDueSessions").textContent = totalDueSessions;
  $("statPoints").textContent = totalPoints;
  $("statGroups").textContent = groups.length;
  $("statPresent").textContent = presentToday;
  $("statCollected").textContent = `${collectedToday} ج`;
  $("statTodayStudents").textContent = todayStudentCount;

  $("todayGroups").innerHTML = todaysGroups.length ? todaysGroups.map(g=>`
    <div class="list-item">
      <div><strong>${g.name}</strong><span>${g.time} — مدة الحصة ساعة</span></div>
      <span class="badge">${students.filter(s=>s.group===g.id).length} طالب</span>
    </div>`).join("") : `<div class="list-item"><div><strong>لا توجد حصص اليوم</strong><span>يمكن مراجعة الجدول من الإعدادات</span></div></div>`;

  const alerts = students.filter(s=>s.dueSessions>=2).sort((a,b)=>b.dueSessions-a.dueSessions);
  $("alertsList").innerHTML = alerts.length ? alerts.map(s=>`
    <div class="list-item">
      <div><strong>${s.name}</strong><span>${groupById(s.group).name} — مستحق ${s.dueAmount} جنيه</span></div>
      <span class="badge ${s.dueSessions>=3?"red":"gold"}">${s.dueSessions} حصص</span>
    </div>`).join("") : `<div class="list-item"><div><strong>لا توجد تنبيهات</strong><span>كل الحسابات منتظمة</span></div></div>`;
}

function populateSelects(){
  const groupOptions = groups.map(g=>`<option value="${g.id}">${g.name} — ${g.time}</option>`).join("");
  const studentGroupFilter = $("studentGroupFilter");

if (studentGroupFilter) {
  const currentValue = studentGroupFilter.value;

  studentGroupFilter.innerHTML = `
    <option value="">كل المجموعات</option>
    ${groups.map(g => `
      <option value="${g.id}">${g.name}</option>
    `).join("")}
  `;

  studentGroupFilter.value = currentValue;
}
  ["groupSelect", "newGroup", "manageGroupSelect"].forEach(id => {
    if($(id)) $(id).innerHTML = groupOptions;
  });
  const selectedGroup = groupById($("manageGroupSelect")?.value);

if (selectedGroup) {
  $("manageGroupName").value = selectedGroup.name || "";
  $("manageGroupTime").value = selectedGroup.time || "";
}
  const studentOptions = students.map(s=>`<option value="${s.id}">${s.name} — ${groupById(s.group).name}</option>`).join("");
  ["paymentStudent","attendancePaymentStudent","pointsStudent","parentStudent"].forEach(id=>{
    const el=$(id); if(el){const old=el.value; el.innerHTML=studentOptions; if(old) el.value=old;}
  });
}

async function loadAttendance(){
  const groupId = $("groupSelect").value;
  const group = groupById(groupId);
  const supabase = await getSupabase();

const { data: isOwner, error: ownerCheckError } =
  await supabase.rpc("is_owner");

if (ownerCheckError) {
  console.error("Owner check error:", ownerCheckError);
  showToast("تعذر التحقق من صلاحية الحساب");
  return;
}
  $("selectedPrice").innerHTML = isOwner
  ? `سعر الحصة: <b>${group.price} جنيه</b>`
  : "";

let pendingManagerPoints = [];

if (isOwner) {
  const groupCode =
    group.id
      .toUpperCase()
      .replace(
        /^([PMS]\d)([AB])$/,
        "$1-$2"
      );

  const {
    data: attendanceGroupRow,
    error: attendanceGroupError
  } = await supabase
    .from("groups")
    .select("id")
    .eq("code", groupCode)
    .single();

  if (attendanceGroupError) {
    console.error(
      "Pending points group error:",
      attendanceGroupError
    );
  } else {
    const {
      data: pendingRows,
      error: pendingError
    } = await supabase.rpc(
      "get_owner_pending_session_points",
      {
        p_group_id:
          attendanceGroupRow.id,

        p_session_date:
          $("sessionDate").value
      }
    );

    if (pendingError) {
      console.error(
        "Pending points load error:",
        pendingError
      );
    } else {
      pendingManagerPoints =
        pendingRows || [];
    }
  }
}

  const list = students.filter(s=>s.group===groupId);
  $("attendanceBody").innerHTML = list.length ? list.map(s=>`
    <tr data-id="${s.id}">
      <td><div class="student-name">${s.name}</div><div class="student-sub">${s.school}</div></td>
      <td>
        <select class="attendance-status">
          <option value="present">حاضر</option>
          <option value="late">متأخر</option>
          <option value="absent">غائب</option>
          <option value="excused">غائب بعذر</option>
        </select>
      </td>
        ${isOwner ? `
  <td class="payment-cell">
    <select class="payment-status">
      <option value="paid">دفع الآن</option>
      <option value="due">إضافة للحساب</option>
      <option value="free">حصة مجانية</option>
    </select>
  </td>

  <td>
    <span class="badge ${s.dueSessions >= 3 ? "red" : ""}">
      ${s.dueSessions} / 3
    </span>
  </td>
` : `
  <td></td>
  <td></td>
`}
      <td><b>${s.points}</b></td>
    <td>
  
    <div class="session-points-box">

  <div
    style="
      display:flex;
      align-items:center;
      gap:6px;
      margin-bottom:5px;
    "
  >
    <strong
      style="
        font-size:13px;
        white-space:nowrap;
      "
    >
      النقاط
    </strong>

    <input
      class="session-manual-points"
      type="number"
      step="1"
      value="0"
      style="
        width:55px;
        height:30px;
        padding:2px 5px;
        text-align:center;
      "
    >
  </div>

  <div
    class="pending-points-list"
    style="
      max-height:82px;
      overflow-y:auto;
      overflow-x:hidden;
      padding-left:2px;
    "
  >
    ${
      pendingManagerPoints.filter(
        point =>
          String(point.student_id) ===
          String(s.id)
      ).length

        ? pendingManagerPoints
            .filter(
              point =>
                String(point.student_id) ===
                String(s.id)
            )
            .map(point => `
              <div
                class="pending-point-item"
                data-pending-id="${point.id}"
                style="
                  display:flex;
                  align-items:center;
                  justify-content:space-between;
                  gap:5px;
                  margin-bottom:3px;
                  min-height:28px;
                "
              >
                <span
                  style="
                    font-size:12px;
                    white-space:nowrap;
                    overflow:hidden;
                    text-overflow:ellipsis;
                    flex:1;
                  "
                  title="${point.reason_text || "نقاط"}"
                >
                  ${point.reason_text || "نقاط"}
                </span>

                <input
                  class="pending-point-value"
                  type="number"
                  step="1"
                  value="${Number(point.points)}"
                  style="
                    width:52px;
                    height:27px;
                    padding:1px 4px;
                    text-align:center;
                    flex:none;
                  "
                >
              </div>
            `)
            .join("")

        : ""
    }
  </div>

</div>
</td>
      <td><button class="whatsapp-btn" onclick="sendWhatsApp(${s.id})">واتساب</button></td>
    </tr>`).join("") : `<tr><td colspan="6">لا يوجد طلاب في هذه المجموعة بعد.</td></tr>`;
    document
  .querySelectorAll("#attendanceBody .attendance-status")
  .forEach(select => {

    const updatePaymentVisibility = () => {
      const row = select.closest("tr");
      const paymentCell =
        row?.querySelector(".payment-cell");

      if (!paymentCell) return;

      const hidePayment =
        select.value === "absent" ||
        select.value === "excused";

      paymentCell.style.display =
        hidePayment ? "none" : "";
    };

    select.addEventListener(
      "change",
      updatePaymentVisibility
    );

    updatePaymentVisibility();
  });
}



async function saveAttendance(){
  const rows = [...document.querySelectorAll("#attendanceBody tr[data-id]")];
  if(!rows.length){showToast("اختر مجموعة بها طلاب أولًا");return;}
  const override = $("adminOverride").checked;
  const group = groupById($("groupSelect").value);
  const supabase = await getSupabase();

  const { data: isOwner, error: ownerCheckError } =
    await supabase.rpc("is_owner");

  if (ownerCheckError) {
    console.error("Owner check error:", ownerCheckError);
    showToast("تعذر التحقق من صلاحية الحساب");
    return;
  }

  const { data: groupRow, error: groupError } = await supabase
  .from("groups")
  .select("id")
  .eq("code", group.id.toUpperCase().replace(/^([PMS]\d)([AB])$/, "$1-$2"))
  .single();

if (groupError || !groupRow) {
  showToast("تعذر العثور على المجموعة");
  return;
}
const sessionDate = $("sessionDate").value;

const startTime = group.time.includes("مساء")
  ? `${String((Number(group.time.match(/\d+/)[0]) % 12) + 12).padStart(2, "0")}:00:00`
  : `${String(Number(group.time.match(/\d+/)[0]) % 12).padStart(2, "0")}:00:00`;

const {
  data: existingSession,
  error: existingSessionError
} = await supabase
  .from("sessions")
  .select("id")
  .eq("group_id", groupRow.id)
  .eq("session_date", sessionDate)
  .eq("start_time", startTime)
  .maybeSingle();

if (existingSessionError) {
  console.error(
    "Session check error:",
    existingSessionError
  );
  showToast("تعذر التحقق من الحصة");
  return;
}

if (existingSession) {
  showToast("الحصة مسجلة بالفعل");
  return;
}

const {
  data: sessionRow,
  error: sessionError
} = await supabase
  .from("sessions")
  .insert({
    group_id: groupRow.id,
    session_date: sessionDate,
    start_time: startTime,
    price: group.price,
    status: "scheduled"
  })
  .select("id")
  .single();

if (sessionError?.code === "23505") {
  showToast("الحصة مسجلة بالفعل");
  return;
}

if (sessionError || !sessionRow) {
  console.error(
    "Session save error:",
    sessionError
  );
  showToast("تعذر حفظ الحصة");
  return;
}
  let blocked = 0;
  for (const row of rows) {
    const s = students.find(x => x.id === row.dataset.id);
    const status = row.querySelector(".attendance-status").value;
  const payStatus =
  status === "absent" || status === "excused"
    ? "free"
    : isOwner
      ? row.querySelector(".payment-status")?.value || "due"
      : "due";
   
  const manualPoints = Number(
  row.querySelector(".session-manual-points")?.value || 0
);

if (!Number.isFinite(manualPoints)) {
  showToast("أدخل قيمة صحيحة للنقاط");
  return;
}

const sessionPoints = manualPoints;

const pointsDetails =
  manualPoints !== 0
    ? [
        {
          value: manualPoints,
          reason: "manual",
          reason_label: "النقاط"
        }
      ]
    : [];

    if (!s) return;

    if(status==="present"){
      s.present += 1; s.points += 3;
    }else if(status==="late"){
      s.present += 1; s.late += 1; s.points += 1; // +3 حضور و -2 تأخير
    }else if(status==="absent"){
      s.absent += 1; s.points -= 10;
    }
    s.points += sessionPoints;

    if((status==="present"||status==="late") && payStatus==="due"){
      if(s.dueSessions>=3 && !override){blocked += 1;}
      else {s.dueSessions += 1; s.dueAmount += group.price;}
    }
    if((status==="present"||status==="late") && payStatus==="paid"){
      payments.unshift({studentId:s.id,amount:group.price,method:"نقدي",date:new Date().toISOString()});
      const { error: paymentError } = await supabase
  .from("payments")
  .insert({
    student_id: s.id,
    amount: group.price,
   payment_method: "cash",
    paid_at: new Date().toISOString()
  });

if (paymentError) {
  console.error(paymentError);
  showToast("تعذر حفظ دفعة أحد الطلاب");
  return;
}
    }

    sessionAttendance[s.id]={status,payStatus,date:$("sessionDate").value};
    if (!isOwner) {
  const { error: safeAttendanceError } =
    await supabase.rpc("save_safe_attendance", {
      p_session_id: sessionRow.id,
      p_student_id: s.id,
      p_attendance_status: status,
      p_points_change: sessionPoints,
      p_points_details: pointsDetails,
      p_notes: null
    });

  if (safeAttendanceError) {
    console.error(
      "Safe attendance error:",
      safeAttendanceError
    );

    showToast("تعذر حفظ حضور الطالب");
    return;
  }

  continue;
}
    const { error: attendanceError } = await supabase
  .from("attendance")
  .insert({
   session_id: sessionRow.id,
student_id: s.id,
attendance_status: status,
payment_status: payStatus,
charge_amount:
  (status === "present" || status === "late")
    ? Number(group.price || 0)
    : 0,
points_change: sessionPoints,
points_details: pointsDetails
  });

if (attendanceError) {
  console.error(attendanceError);
  showToast("تعذر حفظ حضور أحد الطلاب");
  return;
}
const { error: studentUpdateError } = await supabase
  .from("students")
  .update({
    due_sessions_count: s.dueSessions,
    due_amount: s.dueAmount,
    points_balance: s.points
  })
  .eq("id", s.id);

if (studentUpdateError) {
  console.error(studentUpdateError);
  showToast("تعذر تحديث حساب الطالب");
  return;
}
  }

const pendingItems = [
  ...document.querySelectorAll(
    "#attendanceBody .pending-point-item"
  )
];

for (const item of pendingItems) {
  const pendingId = item.dataset.pendingId;

  const points = Number(
    item.querySelector(".pending-point-value")?.value || 0
  );

  if (!pendingId) continue;

  if (!Number.isFinite(points)) {
    showToast("يوجد رقم غير صحيح في النقاط");
    return;
  }

  const {
    data: reviewData,
    error: reviewError
  } = await supabase.rpc(
    "review_pending_session_point",
    {
      p_pending_id: pendingId,
      p_action: points === 0 ? "delete" : "approve",
      p_points: points === 0 ? null : points
    }
  );

  if (reviewError || !reviewData?.success) {
    console.error(
      "Pending points review error:",
      reviewError
    );

    showToast("تعذر اعتماد النقاط");
    return;
  }
}

  const {
  data: completionData,
  error: completionError
} = await supabase.rpc(
  "complete_session_with_pending_points",
  {
    p_session_id: sessionRow.id
  }
);

if (completionError) {
  console.error(
    "Session completion error:",
    completionError
  );

  showToast(
    "تم حفظ بيانات الحصة، لكن تعذر اعتماد وإغلاق الحصة"
  );

  return;
}

await loadStudentsFromSupabase();

const attendanceGroupId = $("groupSelect").value;

save();
renderAll();

$("groupSelect").value = attendanceGroupId;
loadAttendance();

const appliedPending =
  Number(
    completionData?.applied_count || 0
  );

let completionMessage =
  blocked
    ? `تم اعتماد وإغلاق الحصة، وتم منع تراكم إضافي لـ ${blocked} طالب`
    : "تم اعتماد وإغلاق الحصة وتحديث الحسابات والنقاط";

if (appliedPending > 0) {
  completionMessage +=
    ` — وتم اعتماد ${appliedPending} تسجيل نقاط معلّق`;
}

showToast(completionMessage);
try {
  const { data: pushData, error: pushError } =
    await supabase.functions.invoke(
      "send-parent-push",
      {
        body: {
          session_id: sessionRow.id
        }
      }
    );

  console.log(
    "Parent push result:",
    pushData,
    "ERROR:",
    pushError
  );
} catch (pushError) {
  console.error(
    "Parent push error:",
    pushError
  );
}
}

function renderStudents() {
  const q = ($("studentSearch")?.value || "").trim().toLowerCase();
  const selectedGroupId = $("studentGroupFilter")?.value || "";
  const list = students.filter((s) => {
    const group = groupById(s.group);
    const matchesName = String(s.name || "").toLowerCase().includes(q);
const matchesGroup =
  !selectedGroupId ||
  String(s.group) === String(selectedGroupId) ||
  String(group?.id) === String(selectedGroupId) ||
  String(group?.code) === String(selectedGroupId);
    return matchesName && matchesGroup;
  });
  $("studentsTotalCount").textContent = students.length;
$("studentsVisibleCount").textContent = list.length;

const selectedGroup = groupById(selectedGroupId);
$("studentsCurrentGroup").textContent =
  selectedGroup ? selectedGroup.name : "كل المجموعات";
  $("studentsGrid").innerHTML=list.map(s=>`
    <article class="student-card">
      <div class="student-card-head">
        <div class="avatar">${s.name.trim()[0]}</div>
        <div>
  <h4>${s.name}</h4>
  <p>${groupById(s.group)?.name || "غير محدد"} — ${s.school}</p>
</div>
       
      </div>
      <div class="student-metrics">
        <div class="metric"><strong>${s.points}</strong><span>Points</span></div>
        <div class="metric"><strong>${s.dueSessions}</strong><span>حصص متراكمة</span></div>
        <div class="metric"><strong>${s.dueAmount} ج</strong><span>المستحق</span></div>
      </div>
    </article>`).join("");
}

async function addStudent(){
  const name=$("newStudentName").value.trim();
  const groupId=$("newGroup").value;
  const supabase = await getSupabase();
const groupCode = groupId.toUpperCase().replace(/^([PMS]\d)([AB])$/, "$1-$2");
const { data: groupRow, error: groupError } = await supabase
  .from("groups")
  .select("id")
  .eq("code", groupCode)
  .single();
  if (groupError || !groupRow) {
  showToast("تعذر العثور على المجموعة");
  return false;
}
  if(!name){showToast("أدخل اسم الطالب");return false;}
  const { data: newStudent, error: studentError } = await supabase
  .from("students")
  .insert({
    full_name: name,
    group_id: groupRow.id,
    school_name: $("newSchool").value.trim() || null,
   
    parent_phone: $("newPhone").value.trim() || null,
    points_balance: 0,
    due_sessions_count: 0,
    due_amount: 0,
    is_active: true
  })
  .select()
  .single();

if (studentError) {
  showToast("تعذر حفظ الطالب");
  return false;
}
  students.push({
  id: newStudent.id,
  name: newStudent.full_name,
  group: groupId,
  school: newStudent.school_name || "غير محدد",
  phone: newStudent.parent_phone || "",
  points: Number(newStudent.points_balance || 0),
  dueSessions: Number(newStudent.due_sessions_count || 0),
  dueAmount: Number(newStudent.due_amount || 0),
  present: 0,
  absent: 0,
  late: 0
});

renderAll();
showToast("تمت إضافة الطالب بنجاح");
  $("studentDialog").close();
  $("studentForm").reset();
  return true;
}
async function loadSelectedStudentDue() {
  const studentId = $("paymentStudent")?.value;
  const dueElement = $("studentDueAmount");

  if (!studentId || !dueElement) return;

  try {
    const supabase = await getSupabase();

    const { data, error } = await supabase.rpc(
      "get_student_due_balance",
      {
        p_student_id: studentId
      }
    );

    if (error) {
      console.error("Student due error:", error);
      dueElement.textContent = "تعذر تحميل المتأخر";
      return;
    }

    dueElement.textContent =
      `${Number(data?.due_amount || 0).toFixed(2)} جنيه`;

  } catch (error) {
    console.error("Student due error:", error);
  }
}

async function loadAttendanceStudentDue() {
  const studentId = $("attendancePaymentStudent")?.value;
  const dueElement = $("attendanceDueAmount");

  if (!studentId || !dueElement) return;

  try {
    const supabase = await getSupabase();

    const { data, error } = await supabase.rpc(
      "get_student_due_balance",
      {
        p_student_id: studentId
      }
    );

    if (error) {
      console.error("Attendance student due error:", error);
      dueElement.textContent = "تعذر تحميل المتأخر";
      return;
    }

    dueElement.textContent =
      `${Number(data?.due_amount || 0).toFixed(2)} جنيه`;

  } catch (error) {
    console.error("Attendance student due error:", error);
  }
}
async function registerAttendancePayment() {
  const studentId = $("attendancePaymentStudent")?.value;
  const amount = Number($("attendancePaymentAmount")?.value || 0);
  const method = $("attendancePaymentMethod")?.value || "cash";

  if (!studentId) {
    showToast("اختر الطالب");
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("ادخل مبلغاً صحيحاً");
    return;
  }

  try {
    const supabase = await getSupabase();

    const { data, error } = await supabase.rpc(
      "pay_student_due_balance",
      {
        p_student_id: studentId,
        p_amount: amount,
        p_payment_method: method
      }
    );

    if (error) {
      throw error;
    }

    const remainingDue =
      Number(data?.remaining_due || 0);

    const student = students.find(
      item => String(item.id) === String(studentId)
    );

    if (student) {
      student.dueAmount = remainingDue;

      const group = groupById(student.group);

      student.dueSessions =
        group?.price
          ? Math.ceil(
              remainingDue / Number(group.price)
            )
          : 0;
    }

    $("attendancePaymentAmount").value = "";

    await loadAttendanceStudentDue();

    showToast(
      `تم تسجيل سداد ${amount} جنيه بنجاح`
    );

  } catch (error) {
    console.error(
      "Attendance payment error:",
      error
    );

    showToast(
      error?.message || "تعذر تسجيل السداد"
    );
  }
}
async function registerPayment() {
  const studentId = $("paymentStudent")?.value;
  const amount = Number($("paymentAmount")?.value || 0);
  const method = $("paymentMethod")?.value || "نقدي";

  if (!studentId) {
    showToast("اختر الطالب");
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("ادخل مبلغاً صحيحاً");
    return;
  }

  try {
    const supabase = await getSupabase();

    const { data, error } = await supabase.rpc(
      "pay_student_due_balance",
      {
        p_student_id: studentId,
        p_amount: amount,
        p_payment_method: method
      }
    );

    if (error) {
      throw error;
    }

    const remainingDue =
      Number(data?.remaining_due || 0);

    const student = students.find(
      item => String(item.id) === String(studentId)
    );

    if (student) {
      student.dueAmount = remainingDue;

      const group = groupById(student.group);

      student.dueSessions =
        group?.price
          ? Math.ceil(
              remainingDue / Number(group.price)
            )
          : 0;
    }

    payments.unshift({
      studentId,
      amount,
      method,
      date: new Date().toISOString(),
      receiptNumber: data?.receipt_number
    });

    $("paymentAmount").value = "";

    await loadSelectedStudentDue();

    save();
    renderPayments();

    showToast(
      `تم سداد ${amount} جنيه - المتبقي ${remainingDue.toFixed(2)} جنيه - إيصال رقم ${data?.receipt_number}`
    );

  } catch (error) {
    console.error(
      "Payment error:",
      error
    );

    showToast(
      error?.message || "تعذر تسجيل السداد"
    );
  }
}

function renderPayments(){
  $("paymentLog").innerHTML=payments.length?payments.slice(0,8).map(p=>{
    const s=students.find(x=>x.id===p.studentId);
    return `<div class="list-item"><div><strong>${s?s.name:"طالب"}</strong><span>${p.method} — ${new Date(p.date).toLocaleString("ar-EG")}</span></div><span class="badge">${p.amount} ج</span></div>`;
  }).join(""):`<div class="list-item"><div><strong>لا توجد مدفوعات بعد</strong><span>سجل أول عملية دفع من النموذج</span></div></div>`;
  loadDailyPaymentSummary();
}

async function loadDailyPaymentSummary() {
  if (
    !$("payments")?.classList.contains("active-page")
  ) {
    return;
  }

  try {
    const supabase = await getSupabase();

    const {
      data,
      error
    } = await supabase.rpc(
      "get_owner_daily_payment_report",
      {
        p_date: localDateISO()
      }
    );

    if (error) {
      console.error(
        "Daily payment report error:",
        error
      );
      return;
    }

    $("dailyPaidTotal").textContent =
      `${Number(data?.paid_total || 0).toFixed(2)} جنيه`;

    $("dailyDeferredTotal").textContent =
      `${Number(data?.deferred_total || 0).toFixed(2)} جنيه`;

    $("dailyFreeCount").textContent =
      Number(data?.free_count || 0);

    const freeStudents =
      Array.isArray(data?.free_students)
        ? data.free_students
        : [];

    $("dailyFreeStudents").textContent =
      freeStudents.length
        ? `المعفيون: ${freeStudents
            .map(
              student =>
                `${student.student_name} - ${student.group_name || ""}`
            )
            .join(" | ")}`
        : "لا يوجد طلاب معفيون اليوم";

  } catch (error) {
    console.error(
      "Daily payment report error:",
      error
    );
  }
}

function pointsValue(){
  const reason=$("pointsReason").value;
  if(reason==="participation") return Math.min(10,Math.max(1,Number($("participationValue").value)||1));
  if(reason==="exam"){
    const score=Math.max(0,Number($("examScore").value)||0);
    const max=Math.max(1,Number($("examMax").value)||1);
    return Math.round((score/max)*20*10)/10;
  }
  return Number(reason);
}

function applyPoints() {
  const student = students.find(
    (item) => item.id === Number($("pointsStudent").value)
  );

  if (!student) {
    showToast("اختر الطالب أولًا");
    return;
  }

  const manualInput = $("manualPointsValue");

  // يدعم الواجهة الجديدة، مع الاحتفاظ بالطريقة القديمة احتياطيًا
  const value = manualInput
    ? Number(manualInput.value)
    : pointsValue();

  if (!Number.isFinite(value) || value === 0) {
    showToast("أدخل عدد نقاط صحيح، موجبًا أو سالبًا");
    return;
  }

  const reasonSelect = $("pointsReason");
  const reason =
    reasonSelect?.options[reasonSelect.selectedIndex]?.text ||
    "بدون سبب محدد";

  student.points = Math.round((Number(student.points || 0) + value) * 10) / 10;

  save();
  renderAll();

  if (manualInput) manualInput.value = "";

  showToast(
    `${value > 0 ? "تمت إضافة" : "تم خصم"} ${Math.abs(value)} نقطة — السبب: ${reason}`
  );
}

function pointsStudentGradeKey(student) {
  const group = groupById(student.group);

  if (group?.grade) {
    return group.grade;
  }

  const groupId = String(student.group || "").toLowerCase();

  if (groupId.startsWith("p1")) return "primary_1";
  if (groupId.startsWith("p2")) return "primary_2";
  if (groupId.startsWith("p3")) return "primary_3";
  if (groupId.startsWith("p4")) return "primary_4";
  if (groupId.startsWith("p5")) return "primary_5";
  if (groupId.startsWith("p6")) return "primary_6";

  if (groupId.startsWith("m1")) return "prep_1";
  if (groupId.startsWith("m2")) return "prep_2";
  if (groupId.startsWith("m3")) return "prep_3";

  if (groupId.startsWith("s1")) return "secondary_1";
  if (groupId.startsWith("s2")) return "secondary_2";

  return "";
}

function renderLeaderboard() {
  const leaderboard = $("leaderboard");

  if (!leaderboard) return;

  const selectedGrade =
    $("pointsGradeFilter")?.value || "";

  const rankedStudents = students
    .filter(student => {
      if (!selectedGrade) return true;

      return (
        pointsStudentGradeKey(student) ===
        selectedGrade
      );
    })
    .sort(
      (firstStudent, secondStudent) =>
        Number(secondStudent.points || 0) -
        Number(firstStudent.points || 0)
    );

  leaderboard.innerHTML = rankedStudents.length
    ? rankedStudents
        .map(
          (student, index) => `
            <div class="list-item">
              <div>
                <strong>
                  ${index + 1}. ${student.name}
                </strong>

                <span>
                  ${groupById(student.group)?.name || ""}
                </span>
              </div>

              <span class="badge">
                ${Number(student.points || 0)} نقطة
              </span>
            </div>
          `
        )
        .join("")
    : `
        <div class="list-item">
          لا يوجد طلاب في هذا الصف
        </div>
      `;
}
function renderGradeRanking() {
  const stage = $("gradeRankingStage").value;

  const rankedStudents = students
   .filter(s => groupById(s.group)?.name?.startsWith(stage))
    .sort((a, b) => b.points - a.points);

  $("gradeRankingList").innerHTML = rankedStudents.length
    ? rankedStudents.map((s, index) => `
        <div class="list-item">
          <div>
            <strong>${index + 1}. ${s.name}</strong>
            <span>${groupById(s.group)?.name || ""}</span>
          </div>

          <span class="badge gold">${s.points} نقطة</span>
        </div>
      `).join("")
    : `<div class="list-item">لا يوجد طلاب في هذا الصف</div>`;
}

function scheduleStageName(stage) {
  return {
    primary: "ابتدائي",
    prep: "إعدادي",
    secondary: "ثانوي"
  }[stage] || stage || "غير محدد";
}

function scheduleGradeName(grade) {
  return {
    kg: "KG",
    primary_1: "الصف الأول الابتدائي",
    primary_2: "الصف الثاني الابتدائي",
    primary_3: "الصف الثالث الابتدائي",
    primary_4: "الصف الرابع الابتدائي",
    primary_5: "الصف الخامس الابتدائي",
    primary_6: "الصف السادس الابتدائي",
    prep_1: "الصف الأول الإعدادي",
    prep_2: "الصف الثاني الإعدادي",
    prep_3: "الصف الثالث الإعدادي",
    secondary_1: "الصف الأول الثانوي",
    secondary_2: "الصف الثاني الثانوي",
    secondary_3: "الصف الثالث الثانوي"
  }[grade] || grade || "غير محدد";
}

function scheduleFormatTime(timeValue) {
  if (!timeValue) return "—";

  const [hourText, minuteText = "00"] = String(timeValue).split(":");
  const hour24 = Number(hourText);

  if (!Number.isFinite(hour24)) return String(timeValue);

  const hour12 = hour24 % 12 || 12;
  const period = hour24 >= 12 ? "مساءً" : "صباحًا";

  return `${hour12}:${minuteText.slice(0, 2)} ${period}`;
}
function scheduleTimeToMinutes(timeValue) {
  if (!timeValue) return 0;

  const [hours = "0", minutes = "0"] = String(timeValue).split(":");

  return Number(hours) * 60 + Number(minutes);
}

function scheduleMinutesToLabel(totalMinutes) {
  const hour24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hour12 = hour24 % 12 || 12;
  const period = hour24 >= 12 ? "مساءً" : "صباحًا";

  return `${hour12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function scheduleEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function populateNewGroupGradeOptions() {
  const stageSelect = $("newGroupStage");
  const gradeSelect = $("newGroupGrade");

  if (!stageSelect || !gradeSelect) return;

  const gradesByStage = {
    primary: [
      ["kg", "KG"],
      ["primary_1", "الصف الأول الابتدائي"],
      ["primary_2", "الصف الثاني الابتدائي"],
      ["primary_3", "الصف الثالث الابتدائي"],
      ["primary_4", "الصف الرابع الابتدائي"],
      ["primary_5", "الصف الخامس الابتدائي"],
      ["primary_6", "الصف السادس الابتدائي"]
    ],

    prep: [
      ["prep_1", "الصف الأول الإعدادي"],
      ["prep_2", "الصف الثاني الإعدادي"],
      ["prep_3", "الصف الثالث الإعدادي"]
    ],

    secondary: [
      ["secondary_1", "الصف الأول الثانوي"],
      ["secondary_2", "الصف الثاني الثانوي"],
      ["secondary_3", "الصف الثالث الثانوي"]
    ]
  };

  const grades = gradesByStage[stageSelect.value] || [];

  gradeSelect.innerHTML = `
    <option value="">اختر الصف</option>
    ${grades
      .map(
        ([value, label]) =>
          `<option value="${value}">${label}</option>`
      )
      .join("")}
  `;
}

populateNewGroupGradeOptions();

function openQuickScheduleDialog(day, currentMinutes) {
  const dialog = $("quickScheduleDialog");
  const quickGroupSelect = $("quickScheduleGroupSelect");
  const originalGroupSelect = $("scheduleGroupSelect");
  const slotText = $("quickScheduleSlotText");

  if (
    !dialog ||
    !quickGroupSelect ||
    !originalGroupSelect
  ) {
    return;
  }

  quickGroupSelect.innerHTML =
    originalGroupSelect.innerHTML;

  quickGroupSelect.value = "";

  dialog.dataset.day = day;
  dialog.dataset.minutes = String(currentMinutes);

  if (slotText) {
    slotText.textContent =
      `${day} — ${scheduleMinutesToLabel(currentMinutes)}`;
  }

  dialog.showModal();
}

async function saveQuickSchedule() {
  const dialog = $("quickScheduleDialog");
  const quickGroupSelect = $("quickScheduleGroupSelect");

  if (!dialog || !quickGroupSelect) return;

  const groupId = quickGroupSelect.value;
  const day = dialog.dataset.day || "";
  const totalMinutes = Number(dialog.dataset.minutes);

  if (!groupId) {
    showToast("اختر المجموعة");
    return;
  }

  if (!day || !Number.isFinite(totalMinutes)) {
    showToast("تعذر تحديد اليوم أو الوقت");
    return;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const timeValue =
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}`;

  $("scheduleEditId").value = "";
  $("scheduleGroupSelect").value = groupId;
  $("scheduleDaySelect").value = day;
  $("scheduleTimeInput").value = timeValue;

  $("scheduleGroupSelect").dispatchEvent(
    new Event("change")
  );

  $("scheduleFormTitle").textContent =
    "إضافة موعد جديد";

  $("saveScheduleBtn").textContent =
    "حفظ الموعد";

  $("cancelScheduleEditBtn").classList.add(
    "hidden"
  );

  await saveSchedule();

  dialog.close();
}

function renderScheduleGrid(scheduleItems, selectedDay = "") {
  const grid = $("scheduleGrid");

  if (!grid) return;

  const allDays = [
    "السبت",
    "الأحد",
    "الاثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة"
  ];

  const visibleDays = selectedDay
    ? allDays.filter(day => day === selectedDay)
    : allDays;

  const startMinutes = 8 * 60;
  const endMinutes = 22 * 60;
  const stepMinutes = 60;

  const timeRows = [];

  for (
    let currentMinutes = startMinutes;
    currentMinutes < endMinutes;
    currentMinutes += stepMinutes
  ) {
    timeRows.push(currentMinutes);
  }

  const header = `
    <thead>
      <tr>
        <th class="schedule-time-column">الوقت</th>
        ${visibleDays
          .map(day => `<th>${scheduleEscapeHtml(day)}</th>`)
          .join("")}
      </tr>
    </thead>
  `;

  const body = timeRows
    .map(currentMinutes => {
      
      const cells = visibleDays
  .map(day => {
    const matchingSchedules = scheduleItems.filter(item => {
      if (item.day_name !== day) return false;

      const scheduleStart =
        scheduleTimeToMinutes(item.start_time);

      return currentMinutes === scheduleStart;
    });

    if (!matchingSchedules.length) {
      return `
        <td
          class="schedule-slot schedule-slot-free"
          data-day="${day}"
          data-minutes="${currentMinutes}"
        >
          <span>متاح</span>
        </td>
      `;
    }

    return `
      <td class="schedule-slot schedule-slot-busy">
        ${matchingSchedules
          .map(
            item => `
              <div class="schedule-grid-session">
                <strong>${scheduleEscapeHtml(
                  item.group?.name || ""
                )}</strong>
              </div>
            `
          )
          .join("")}
      </td>
    `;
  })
  .join("");

      return `
        <tr>
          <th class="schedule-time-column">
            ${scheduleMinutesToLabel(currentMinutes)}
          </th>
          ${cells}
        </tr>
      `;
    })
    .join("");

  grid.innerHTML = `
    <div class="table-wrap schedule-week-table-wrap">
      <table class="schedule-week-table">
        ${header}
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
  grid
  .querySelectorAll(".schedule-slot-free")
  .forEach(cell => {
    cell.onclick = () => {
      openQuickScheduleDialog(
        cell.dataset.day,
        Number(cell.dataset.minutes)
      );
    };
  });
}

function renderSchedule() {
  const groupSelect = $("scheduleGroupSelect");
  const groupInfo = $("scheduleGroupInfo");
  const stageFilter = $("scheduleFilterStage");
  const gradeFilter = $("scheduleFilterGrade");
  const groupFilter = $("scheduleFilterGroup");
  const dayFilter = $("scheduleFilterDay");
  const tableBody = $("scheduleTableBody");

  if (
    !groupSelect ||
    !groupInfo ||
    !stageFilter ||
    !gradeFilter ||
    !groupFilter ||
    !dayFilter ||
    !tableBody
  ) {
    return;
  }
  const selectedFormGroup = groupSelect.value;
  const selectedStage = stageFilter.value;
  const selectedGrade = gradeFilter.value;
  const selectedGroup = groupFilter.value;

  const sortedGroups = [...scheduleGroups].sort((a, b) => {
    const stageCompare = String(a.stage || "").localeCompare(
      String(b.stage || ""),
      "ar"
    );

    if (stageCompare !== 0) return stageCompare;

    const gradeCompare = String(a.grade || "").localeCompare(
      String(b.grade || ""),
      "ar"
    );

    if (gradeCompare !== 0) return gradeCompare;

    return String(a.name || "").localeCompare(String(b.name || ""), "ar");
  });

  groupSelect.innerHTML = `
    <option value="">اختر المجموعة</option>
    ${sortedGroups
      .map(
        group => `
          <option value="${group.id}">
            ${scheduleGradeName(group.grade)} — ${group.name}
          </option>
        `
      )
      .join("")}
  `;

  if (
    selectedFormGroup &&
    sortedGroups.some(group => group.id === selectedFormGroup)
  ) {
    groupSelect.value = selectedFormGroup;
  }

  const formGroup = sortedGroups.find(
    group => group.id === groupSelect.value
  );

  groupInfo.textContent = formGroup
    ? `المرحلة: ${scheduleStageName(formGroup.stage)} — الصف: ${scheduleGradeName(formGroup.grade)}`
    : "اختر المجموعة لعرض المرحلة والصف الدراسي.";

  const availableGrades = [
    ...new Set(
      sortedGroups
        .filter(group => !selectedStage || group.stage === selectedStage)
        .map(group => group.grade)
        .filter(Boolean)
    )
  ];

  gradeFilter.innerHTML = `
    <option value="">كل الصفوف</option>
    ${availableGrades
      .map(
        grade => `
          <option value="${grade}">
            ${scheduleGradeName(grade)}
          </option>
        `
      )
      .join("")}
  `;

  if (
    selectedGrade &&
    availableGrades.includes(selectedGrade)
  ) {
    gradeFilter.value = selectedGrade;
  }

  const groupsForFilter = sortedGroups.filter(group => {
    const stageMatches =
      !stageFilter.value || group.stage === stageFilter.value;

    const gradeMatches =
      !gradeFilter.value || group.grade === gradeFilter.value;

    return stageMatches && gradeMatches;
  });

  groupFilter.innerHTML = `
    <option value="">كل المجموعات</option>
    ${groupsForFilter
      .map(
        group => `
          <option value="${group.id}">
            ${group.name}
          </option>
        `
      )
      .join("")}
  `;

  if (
    selectedGroup &&
    groupsForFilter.some(group => group.id === selectedGroup)
  ) {
    groupFilter.value = selectedGroup;
  }

  const dayOrder = {
    السبت: 1,
    الأحد: 2,
    الاثنين: 3,
    الثلاثاء: 4,
    الأربعاء: 5,
    الخميس: 6,
    الجمعة: 7
  };

  const filteredSchedules = groupSchedules
    .map(schedule => ({
      ...schedule,
      group: sortedGroups.find(
        group => group.id === schedule.group_id
      )
    }))
    .filter(item => item.group)
    .filter(item => {
      const stageMatches =
        !stageFilter.value ||
        item.group.stage === stageFilter.value;

      const gradeMatches =
        !gradeFilter.value ||
        item.group.grade === gradeFilter.value;

      const groupMatches =
        !groupFilter.value ||
        item.group_id === groupFilter.value;

      const dayMatches =
        !dayFilter.value ||
        item.day_name === dayFilter.value;

      return (
        stageMatches &&
        gradeMatches &&
        groupMatches &&
        dayMatches
      );
    })
    .sort((a, b) => {
      const dayDifference =
        (dayOrder[a.day_name] || 99) -
        (dayOrder[b.day_name] || 99);

      if (dayDifference !== 0) return dayDifference;

      return String(a.start_time || "").localeCompare(
        String(b.start_time || "")
      );
    });

    renderScheduleGrid(
  filteredSchedules,
  dayFilter.value
);

  tableBody.innerHTML = filteredSchedules.length
    ? filteredSchedules
        .map(
          item => `
            <tr>
              <td>${item.day_name}</td>
              <td>${scheduleFormatTime(item.start_time)}</td>
              <td>${scheduleStageName(item.group.stage)}</td>
              <td>${scheduleGradeName(item.group.grade)}</td>
              <td>${item.group.name}</td>
              <td>
                <div class="inline-fields">
                  <button
                    type="button"
                    class="secondary-btn schedule-edit-btn"
                    data-schedule-id="${item.id}"
                  >
                    تعديل
                  </button>

                  <button
                    type="button"
                    class="secondary-btn schedule-delete-btn"
                    data-schedule-id="${item.id}"
                  >
                    حذف
                  </button>
                </div>
              </td>
            </tr>
          `
        )
        .join("")
    : `
        <tr>
          <td colspan="6">لا توجد مواعيد مسجلة بهذه الاختيارات.</td>
        </tr>
      `;

  stageFilter.onchange = () => {
    gradeFilter.value = "";
    groupFilter.value = "";
    renderSchedule();
  };

  gradeFilter.onchange = () => {
    groupFilter.value = "";
    renderSchedule();
  };

  groupFilter.onchange = renderSchedule;
  dayFilter.onchange = renderSchedule;
  groupSelect.onchange = renderSchedule;

  document
    .querySelectorAll(".schedule-edit-btn")
    .forEach(button => {
      button.onclick = () =>
        editSchedule(button.dataset.scheduleId);
    });

  document
    .querySelectorAll(".schedule-delete-btn")
    .forEach(button => {
      button.onclick = () =>
        deleteSchedule(button.dataset.scheduleId);
    });
    const saveScheduleButton = $("saveScheduleBtn");
  if (saveScheduleButton) {
    saveScheduleButton.onclick = saveSchedule;
  }

  const cancelScheduleButton = $("cancelScheduleEditBtn");
  if (cancelScheduleButton) {
    cancelScheduleButton.onclick = resetScheduleForm;
  }

  if ($("schedule")?.classList.contains("schedule-readonly")) {
  document
    .querySelectorAll(".schedule-edit-btn, .schedule-delete-btn")
    .forEach(button => {
      button.style.display = "none";
    });
}
}
function resetScheduleForm() {
  const editId = $("scheduleEditId");
  const groupSelect = $("scheduleGroupSelect");
  const daySelect = $("scheduleDaySelect");
  const timeInput = $("scheduleTimeInput");
  const formTitle = $("scheduleFormTitle");
  const saveButton = $("saveScheduleBtn");
  const cancelButton = $("cancelScheduleEditBtn");

  if (editId) editId.value = "";
  if (groupSelect) groupSelect.value = "";
  if (daySelect) daySelect.value = "";
  if (timeInput) timeInput.value = "";

  if (formTitle) {
    formTitle.textContent = "إضافة موعد جديد";
  }

  if (saveButton) {
    saveButton.textContent = "حفظ الموعد";
  }

  if (cancelButton) {
    cancelButton.classList.add("hidden");
  }

  renderSchedule();
}

async function saveSchedule() {
  const editId = $("scheduleEditId")?.value || "";
  const groupId = $("scheduleGroupSelect")?.value || "";
  const dayName = $("scheduleDaySelect")?.value || "";
  const startTime = $("scheduleTimeInput")?.value || "";

  if (!groupId) {
    showToast("اختر المجموعة");
    return;
  }

  if (!dayName) {
    showToast("اختر يوم الحصة");
    return;
  }

  if (!startTime) {
    showToast("حدد وقت الحصة");
    return;
  }

  const wasEditing = Boolean(editId);

  try {
    const supabase = await getSupabase();

    let result;

    if (wasEditing) {
      result = await supabase
        .from("group_schedules")
        .update({
          group_id: groupId,
          day_name: dayName,
          start_time: startTime,
          is_active: true
        })
        .eq("id", editId);
    } else {
      result = await supabase
        .from("group_schedules")
        .insert({
          group_id: groupId,
          day_name: dayName,
          start_time: startTime,
          is_active: true
        });
    }

    if (result.error) {
      throw result.error;
    }

    await loadScheduleDataFromSupabase();

    resetScheduleForm();
    renderDashboard();

    showToast(
      wasEditing
        ? "تم تعديل الموعد بنجاح"
        : "تم إضافة الموعد بنجاح"
    );
  } catch (error) {
    console.error("Schedule save error:", error);

    if (error.code === "23505") {
      showToast("هذا الموعد مسجل بالفعل لنفس المجموعة");
      return;
    }

    showToast(error.message || "تعذر حفظ الموعد");
  }
}

function editSchedule(scheduleId) {
  const schedule = groupSchedules.find(
    item => String(item.id) === String(scheduleId)
  );

  if (!schedule) {
    showToast("تعذر العثور على الموعد");
    return;
  }

  $("scheduleEditId").value = schedule.id;
  $("scheduleGroupSelect").value = schedule.group_id;

  renderSchedule();

  $("scheduleDaySelect").value = schedule.day_name;
  $("scheduleTimeInput").value = String(
    schedule.start_time || ""
  ).slice(0, 5);

  $("scheduleFormTitle").textContent = "تعديل الموعد";
  $("saveScheduleBtn").textContent = "حفظ التعديل";
  $("cancelScheduleEditBtn").classList.remove("hidden");

  $("scheduleFormTitle")?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

async function deleteSchedule(scheduleId) {
  const schedule = groupSchedules.find(
    item => String(item.id) === String(scheduleId)
  );

  if (!schedule) {
    showToast("تعذر العثور على الموعد");
    return;
  }

  const group = scheduleGroups.find(
    item => item.id === schedule.group_id
  );

  const confirmed = window.confirm(
    `هل تريد حذف موعد ${group?.name || "المجموعة"} يوم ${schedule.day_name}؟`
  );

  if (!confirmed) {
    return;
  }

  try {
    const supabase = await getSupabase();

    const { error } = await supabase
      .from("group_schedules")
      .delete()
      .eq("id", scheduleId);

    if (error) {
      throw error;
    }

    await loadScheduleDataFromSupabase();

    if ($("scheduleEditId")?.value === scheduleId) {
      resetScheduleForm();
    } else {
      renderSchedule();
    }

    renderDashboard();
    showToast("تم حذف الموعد");
  } catch (error) {
    console.error("Schedule delete error:", error);
    showToast(error.message || "تعذر حذف الموعد");
  }
}
function renderParent(){
  const id=Number($("parentStudent").value||students[0]?.id);
  const s=students.find(x=>x.id===id);
  if(!s){$("parentCard").innerHTML="";return;}
  $("parentCard").innerHTML=`
    <div class="parent-content">
      <div class="parent-hero">
        <h3>${s.name}</h3>
        <p>${groupById(s.group).name} — ${s.school}</p>
        <div class="parent-summary">
          <div class="metric"><strong>${s.points}</strong><span>Points</span></div>
          <div class="metric"><strong>${s.dueSessions}/3</strong><span>حصص متراكمة</span></div>
          <div class="metric"><strong>${s.dueAmount} ج</strong><span>المستحق</span></div>
        </div>
      </div>
      <div class="timeline">
        <div class="timeline-item"><strong>الحضور</strong><span>حضر ${s.present} — غاب ${s.absent} — تأخر ${s.late}</span></div>
        <div class="timeline-item"><strong>آخر تحديث للنقاط</strong><span>يظهر سبب كل إضافة أو خصم وتاريخها في النسخة الكاملة.</span></div>
        <div class="timeline-item"><strong>الإشعارات</strong><span>ستصل داخل التطبيق وعلى واتساب بعد ربط الخدمة.</span></div>
        <button class="whatsapp-btn" onclick="sendWhatsApp(${s.id})">فتح رسالة واتساب جاهزة</button>
      </div>
    </div>`;
}

function sendWhatsApp(id){
  const s=students.find(x=>x.id===id);
  const message=`E. F Academy%0Aالطالب: ${encodeURIComponent(s.name)}%0Aالمجموعة: ${encodeURIComponent(groupById(s.group).name)}%0Aالحصص المتراكمة: ${s.dueSessions} من 3%0Aإجمالي المستحق: ${s.dueAmount} جنيه%0ARصيد Points: ${s.points}`;
  window.open(`https://wa.me/${s.phone}?text=${message}`,"_blank");
}

function saveSettings(){
  const p=Number($("primaryPrice").value), m=Number($("prepPrice").value), s=Number($("secondaryPrice").value);
  groups.forEach(g=>g.price=g.stage==="primary"?p:g.stage==="prep"?m:s);
  showToast("تم حفظ الأسعار والإعدادات في النسخة الحالية");
  loadAttendance();
}

function togglePointsFields(){
  const v=$("pointsReason").value;
  $("participationFields").classList.toggle("hidden",v!=="participation");
  $("examFields").classList.toggle("hidden",v!=="exam");
}
async function updateGroup() {
 const groupCode = $("manageGroupSelect").value;
  const name = $("manageGroupName").value.trim();
 const timeText = $("manageGroupTime").value.trim();
const timeMatch = timeText.match(/(\d{1,2}):(\d{2})/);

let hours = timeMatch ? Number(timeMatch[1]) : 0;
const minutes = timeMatch ? timeMatch[2] : "00";

if (timeText.includes("مساء") && hours < 12) hours += 12;
if (timeText.includes("صباح") && hours === 12) hours = 0;

const time = `${String(hours).padStart(2, "0")}:${minutes}:00`;

 if (!groupCode || !name || !time) {
    showToast("أدخل اسم ووقت المجموعة");
    return;
  }

  const supabase = await getSupabase();

  const { error } = await supabase
    .from("groups")
    .update({
  name,
  start_time: time
})
  
.eq("id", groupCode);
  if (error) {
    console.error(error);
    showToast("تعذر تعديل المجموعة");
    return;
  }

  const group = groupById(groupCode);
  if (group) {
    group.name = name;
    group.time = time;
  }

  populateSelects();
  renderAll();
  showToast("تم تعديل المجموعة بنجاح");
}

function addScheduleRow() {
  const row = document.createElement("div");
  row.className = "schedule-row";

  row.innerHTML = `
    <select class="schedule-day">
      <option value="saturday">السبت</option>
      <option value="sunday">الأحد</option>
      <option value="monday">الاثنين</option>
      <option value="tuesday">الثلاثاء</option>
      <option value="wednesday">الأربعاء</option>
      <option value="thursday">الخميس</option>
      <option value="friday">الجمعة</option>
    </select>

    <input class="schedule-time" type="time">

    <button type="button" class="remove-schedule-row">حذف</button>
  `;

  row.querySelector(".remove-schedule-row").addEventListener("click", () => {
    row.remove();
  });

  $("scheduleRows").appendChild(row);
}
window.addEventListener("beforeinstallprompt",e=>{
  e.preventDefault(); deferredPrompt=e; $("installBtn").classList.remove("hidden");
});
$("installBtn").addEventListener("click",async()=>{
  if(!deferredPrompt)return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $("installBtn").classList.add("hidden");
});

$("loginBtn").addEventListener("click",login);
$("showParentSignupBtn")?.addEventListener("click", showParentSignup);
$("backToLoginBtn")?.addEventListener("click", hideParentSignup);
$("parentSignupBtn")?.addEventListener("click", createParentAccount);
$("logoutBtn")?.addEventListener("click", logout);
$("parentLogoutBtn")?.addEventListener("click", logout);
$("parentEnableNotificationsBtn")?.addEventListener(
  "click",
  enableParentNotifications
);
$("togglePassword")?.addEventListener("click", event => {
  event.preventDefault();

  const passwordInput = $("loginPassword");

  if (!passwordInput) return;

  passwordInput.type =
    passwordInput.type === "password"
      ? "text"
      : "password";
});
$("menuBtn").addEventListener("click",()=>document.querySelector(".sidebar").classList.toggle("open"));
document.querySelectorAll("#navMenu button").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
$("loadGroupBtn").addEventListener("click",loadAttendance);
$("manageGroupSelect").addEventListener("change", async () => {
  const groupId = $("manageGroupSelect").value;
  const group = groupById(groupId);
  const schedulesBox = $("manageGroupSchedules");

  if (!group) {
    schedulesBox.innerHTML = "";
    return;
  }

  $("manageGroupName").value = group.name || "";
  $("manageGroupTime").value = group.time || "";

  if ($("manageGroupStage")) {
    $("manageGroupStage").value = group.stage || "primary";
  }

  schedulesBox.innerHTML = "<p>جاري تحميل المواعيد...</p>";

  const supabase = await getSupabase();

  const { data: schedules, error } = await supabase
    .from("group_schedules")
    .select("id, day, start_time")
    .eq("group_id", group.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    schedulesBox.innerHTML = "<p>تعذر تحميل مواعيد المجموعة</p>";
    return;
  }

  if (!schedules || schedules.length === 0) {
    schedulesBox.innerHTML = "<p>لا توجد مواعيد مسجلة لهذه المجموعة</p>";
    return;
  }

  const dayNames = {
    saturday: "السبت",
    sunday: "الأحد",
    monday: "الاثنين",
    tuesday: "الثلاثاء",
    wednesday: "الأربعاء",
    thursday: "الخميس",
    friday: "الجمعة"
  };

  schedulesBox.innerHTML = schedules
    .map((schedule) => {
      const time = String(schedule.start_time || "").slice(0, 5);

      return `
        <div class="group-schedule-item">
          <strong>${dayNames[schedule.day] || schedule.day}</strong>
          <span>${time}</span>
        </div>
      `;
    })
    .join("");
});
async function saveNewGroupWithSchedules(event) {
  event.preventDefault();

  const stage = $("newGroupStage")?.value || "";
  const grade = $("newGroupGrade")?.value || "";
  const name = $("newGroupName")?.value.trim() || "";

  if (!stage) {
    showToast("اختر المرحلة");
    return;
  }

  if (!grade) {
    showToast("اختر الصف");
    return;
  }

  if (!name) {
    showToast("اكتب اسم المجموعة");
    return;
  }

  try {
    const supabase = await getSupabase();
    const sessionPrice = stage === "primary" ? 15 : 20;
    const groupCode = `group-${Date.now()}`;

    const { data: newGroup, error: groupError } = await supabase
      .from("groups")
      .insert({
        code: groupCode,
        name,
        stage,
        grade,
        meeting_days: [],
        start_time: null,
        session_price: sessionPrice
      })
      .select()
      .single();

    if (groupError) {
      throw groupError;
    }

    groups.push({
      id: newGroup.code,
      code: newGroup.code,
      databaseId: newGroup.id,
      groupId: newGroup.id,
      name: newGroup.name,
      stage: newGroup.stage,
      grade: newGroup.grade,
      days: [],
      meeting_days: [],
      time: "",
      start_time: null,
      price: Number(newGroup.session_price || sessionPrice)
    });

    $("addGroupForm")?.reset();
    populateNewGroupGradeOptions();
    $("addGroupDialog")?.close();

    await loadScheduleDataFromSupabase();
    renderAll();

    showToast(
      "تمت إضافة المجموعة ويمكنك تحديد موعدها من صفحة الجدول"
    );
  } catch (error) {
    console.error("Add group error:", error);
    showToast(error.message || "تعذر إضافة المجموعة");
  }
}
$("gradeRankingStage").addEventListener("change", renderGradeRanking);
$("saveAttendanceBtn").addEventListener("click",saveAttendance);
$("studentSearch").addEventListener("input",e=>renderStudents(e.target.value));
$("studentGroupFilter").addEventListener("change", renderStudents);
$("addStudentBtn").addEventListener("click",()=>$("studentDialog").showModal());
$("addStudentFromAttendanceBtn").addEventListener("click", () => $("studentDialog").showModal());
$("saveStudentBtn").addEventListener("click",e=>{e.preventDefault();addStudent();});
$("registerPaymentBtn").addEventListener("click",registerPayment);
$("paymentStudent")?.addEventListener("change", loadSelectedStudentDue);
$("attendancePaymentStudent")?.addEventListener("change", loadAttendanceStudentDue);
$("attendanceRegisterPaymentBtn")?.addEventListener("click", registerAttendancePayment);
$("pointsReason").addEventListener("change",togglePointsFields);
$("applyPointsBtn").addEventListener("click",applyPoints);
$("parentStudent").addEventListener("change",renderParent);
$("saveSettingsBtn").addEventListener("click",saveSettings);
$("updateGroupBtn").addEventListener("click", updateGroup);
$("addGroupBtn").addEventListener("click", () => {
 
  $("addGroupDialog").showModal();
});
$("addGroupForm").addEventListener("submit", saveNewGroupWithSchedules);
  
$("newStage").addEventListener("change",()=>{
  const stage=$("newStage").value;
  $("newGroup").innerHTML=groups.filter(g=>g.stage===stage).map(g=>`<option value="${g.id}">${g.name}</option>`).join("");
});

$("confirmQuickScheduleBtn")?.addEventListener(
  "click",
  saveQuickSchedule
);

$("cancelQuickScheduleBtn")?.addEventListener(
  "click",
  () => {
    $("quickScheduleDialog")?.close();
  }
);
$("pointsGradeFilter")?.addEventListener(
  "change",
  renderLeaderboard
);

setToday();
populateSelects();
$("groupSelect")?.addEventListener("change", loadAttendance);
loadAttendance();
togglePointsFields();
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js").catch(()=>{}));}

checkSession();
