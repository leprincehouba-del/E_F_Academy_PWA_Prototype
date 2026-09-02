const VAPID_PUBLIC_KEY =
  "BI441_INsdU7MfijuEieYnhztSYcUcQj2Jax589YO66mQtKqrZ_XUZxQm92PajaYh-6LA1E3qEw_q-ArUP1azAg";
const SUPABASE_URL = "https://bmnrltyodljgvrcssjhd.supabase.co";
const SUPABASE_KEY = "sb_publishable_Tk7XuO4BCs9baofK6yjy0Q_LzOKTNVd";

let supabaseClient;

async function getSupabase() {
  if (supabaseClient) return supabaseClient;

  // استخدم النسخة المحلية أولاً
  if (window.supabase && typeof window.supabase.createClient === "function") {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return supabaseClient;
  }

  // احتياطي: الطريقة القديمة عبر CDN
  const { createClient } = await import(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
  );

  supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  return supabaseClient;
}

const groups = [];
let groupSchedules = [];
let parentScheduleChannel = null;
let parentScheduleTopic = "";
let parentScheduleChildId = "";
let parentScheduleSessionVersion = 0;
let scheduleGroups = [];


let students = [];
let currentAppRole = "";
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

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;

  const openDialog = document.querySelector("dialog[open]");

  if (openDialog) {
    openDialog.appendChild(toast);
  } else if (toast.parentElement !== document.body) {
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(window.__toastTimer);

  window.__toastTimer = setTimeout(() => {
    toast.classList.remove("show");

    if (!document.querySelector("dialog[open]") && toast.parentElement !== document.body) {
      document.body.appendChild(toast);
    }
  }, 2600);
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

async function stopParentScheduleRealtime() {
  try {
    const supabase = await getSupabase();

    const parentChannels = supabase
      .getChannels()
      .filter(channel =>
        String(channel.topic || "")
          .startsWith("realtime:parent-schedule:")
      );

    for (const channel of parentChannels) {
      await supabase.removeChannel(channel);
    }
  } catch (error) {
    console.error(
      "Parent schedule realtime cleanup error:",
      error
    );
  } finally {
    parentScheduleChannel = null;
    parentScheduleTopic = "";
    parentScheduleChildId = "";
  }
}
async function ensureParentScheduleRealtime(childId, groupId) {
  if (!childId || !groupId) {
    await stopParentScheduleRealtime();
    return;
  }

  const topic = `parent-schedule:${groupId}`;

  if (
    parentScheduleChannel &&
    parentScheduleTopic === topic &&
    String(parentScheduleChildId) === String(childId)
  ) {
    return;
  }

  await stopParentScheduleRealtime();

  const supabase = await getSupabase();

  await supabase.realtime.setAuth();
if ($("parentPortal")?.classList.contains("hidden")) {
  return;
}
  const selectedChildId =
    $("parentChildSelect")?.value || childId;

  if (String(selectedChildId) !== String(childId)) {
    return;
  }

  const channel = supabase
    .channel(topic, {
      config: {
        private: true
      }
    })
    .on(
      "broadcast",
      {
        event: "schedule_changed"
      },
      () => {
        const currentChildId =
          $("parentChildSelect")?.value || childId;

        if (
          String(currentChildId) === String(childId)
        ) {
          loadParentChildSchedule(childId);
        }
      }
    )
    .subscribe((status, error) => {
      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT"
      ) {
        console.error(
          "Parent schedule realtime error:",
          status,
          error
        );
      }
    });

  parentScheduleChannel = channel;
  parentScheduleTopic = topic;
  parentScheduleChildId = childId;
}
function parentAttendanceLabel(status, details = []) {
  const veryLate = Array.isArray(details) && details.some(detail => {
    const reason = String(
      detail?.reason || detail?.reason_key || detail?.reason_label || ""
    ).toLowerCase().replace(/[\s_-]+/g, "");
    return reason === "verylate" || reason === "متأخرجدًا" || reason === "متأخرجدا";
  });

  if (status === "late" && veryLate) {
    return "متأخر جدًا";
  }

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

function normalizeSessionStartTime(value) {
  const text = String(value || "").trim();

  const timeMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const second = Number(timeMatch[3] || 0);

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
    }
  }

  const hourMatch = text.match(/\d{1,2}/);
  if (!hourMatch) return null;

  let hour = Number(hourMatch[0]);
  const isPm = /مساء|م\b|pm/i.test(text);
  const isAm = /صباح|ص\b|am/i.test(text);

  if (isPm && hour < 12) hour += 12;
  if (isAm && hour === 12) hour = 0;

  if (hour < 0 || hour > 23) return null;

  return `${String(hour).padStart(2, "0")}:00:00`;
}

async function findSessionForGroupDate(supabase, groupId, sessionDate, startTime, selectColumns = "id, status, start_time") {
  const exactQuery = await supabase
    .from("sessions")
    .select(selectColumns)
    .eq("group_id", groupId)
    .eq("session_date", sessionDate)
    .eq("start_time", startTime)
    .maybeSingle();

  if (exactQuery.error) {
    throw exactQuery.error;
  }

  if (exactQuery.data) {
    return { session: exactQuery.data, usedLegacyTimeFallback: false };
  }

  const dateQuery = await supabase
    .from("sessions")
    .select(selectColumns)
    .eq("group_id", groupId)
    .eq("session_date", sessionDate);

  if (dateQuery.error) {
    throw dateQuery.error;
  }

  const dateSessions = dateQuery.data || [];

  if (dateSessions.length === 1) {
    console.warn(
      "Using legacy session time fallback:",
      dateSessions[0]?.start_time,
      "expected:",
      startTime
    );

    return {
      session: dateSessions[0],
      usedLegacyTimeFallback: true
    };
  }

  if (dateSessions.length > 1) {
    const error = new Error(
      "يوجد أكثر من تسجيل لنفس المجموعة في هذا التاريخ ولا يمكن اختيار الحصة بأمان"
    );
    error.code = "AMBIGUOUS_SESSION_DATE";
    throw error;
  }

  return { session: null, usedLegacyTimeFallback: false };
}

function parentPointReasonLabel(value) {
  const raw = String(value || "نقاط").trim();
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");

  const labels = {
    attendance: "الحضور",
    attendancepoints: "الحضور",
    present: "الحضور",
    absence: "الغياب",
    absent: "الغياب",
    late: "التأخير",
    verylate: "متأخر جدًا",
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
    manual: "نقاط",
    session: "نقاط الحصة",
    sessionpoints: "نقاط الحصة"
  };

  return labels[key] || raw;
}

function parentFormatDate(dateValue) {
  if (!dateValue) return "";

  return new Date(
    `${dateValue}T00:00:00`
  ).toLocaleDateString("ar-EG", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}
async function loadParentChildSchedule(childId) {
  const list = $("parentScheduleList");
  const sessionVersion = parentScheduleSessionVersion;
  if (!list || !childId) return;

  const loadingItem = document.createElement("div");
  loadingItem.className = "list-item";
  loadingItem.textContent = "جاري تحميل الجدول...";
  list.replaceChildren(loadingItem);

  try {
    const supabase = await getSupabase();

    const { data, error } = await supabase.rpc(
      "get_parent_child_schedule",
      { p_child_id: childId }
    );

    if (error) throw error;
    if (sessionVersion !== parentScheduleSessionVersion) {
  return;
}
if (data?.group_id) {
  await ensureParentScheduleRealtime(
    childId,
    data.group_id
  );
} else {
  await stopParentScheduleRealtime();
}
    const schedules = Array.isArray(data?.schedules)
      ? data.schedules
      : [];

    if (!schedules.length) {
      const emptyItem = document.createElement("div");
      emptyItem.className = "list-item";
      emptyItem.textContent = "لا توجد مواعيد مسجلة حاليًا";
      list.replaceChildren(emptyItem);
      return;
    }

    const items = schedules.map((schedule) => {
      const item = document.createElement("div");
      item.className = "list-item";

      const day = document.createElement("strong");
      day.textContent = schedule.day_name || "";

      const time = document.createElement("span");
const rawTime = String(schedule.start_time || "");
const [hourText, minute = "00"] = rawTime.split(":");
const hour = Number(hourText);
const period = hour >= 12 ? "م" : "ص";
const hour12 = hour % 12 || 12;
time.textContent = `${hour12}:${minute} ${period}`;
      item.append(day, time);
      return item;
    });

    list.replaceChildren(...items);
  } catch (error) {
    console.error("Parent schedule load error:", error);

    const errorItem = document.createElement("div");
    errorItem.className = "list-item";
    errorItem.textContent = "تعذر تحميل جدول الحصص";
    list.replaceChildren(errorItem);
  }
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
loadParentChildSchedule(child.id);
loadParentHomework(child.id);
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

  const pointHistory = Array.isArray(child.point_history)
    ? child.point_history
    : [];

  const pointHistoryList = $("parentPointHistoryList");
  if (pointHistoryList) {
    pointHistoryList.innerHTML = pointHistory.length
      ? pointHistory.map(item => {
          const value = Number(item.points || 0);
          const reason = parentPointReasonLabel(
            item.reason_text || item.reason_type || "نقاط"
          );
          const dateText = item.created_at
            ? new Date(item.created_at).toLocaleString("ar-EG")
            : "";

          return `
            <div class="list-item">
              <div>
                <strong>${value > 0 ? "+" : ""}${value} نقطة — ${escapeHtml(reason)}</strong>
                ${dateText ? `<span>${escapeHtml(dateText)}</span>` : ""}
              </div>
            </div>
          `;
        }).join("")
      : `<div class="list-item">لا توجد حركات نقاط إضافية</div>`;
  }

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
    detail.reason_label ||
    detail.reason_text ||
    detail.reason ||
    detail.label ||
    "نقاط الحصة"
  ).trim();

  const reason = parentPointReasonLabel(rawReason);

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
                    session.attendance_status,
                    pointDetails
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

currentAppRole = profile.role;

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

    currentAppRole = profile.role;

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
  currentAppRole = "";
  attendanceAccountEditAllowed = false;
  managerHomeworkAllowed = false;
  managerPointsAccessOpen = false;
  parentScheduleSessionVersion += 1;
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
    await stopParentScheduleRealtime();

    const { error } = await supabase.auth.signOut();

    if (error) throw error;

    showToast("تم تسجيل الخروج");
  } catch (error) {
    console.error("Logout error:", error);
    showToast("تم إغلاق الواجهة وتعذر إنهاء الجلسة");
  }
}

async function applyManagerPermissions(profile, userId) {
  attendanceAccountEditAllowed = false;
  const navButtons = [
    ...document.querySelectorAll("#navMenu button")
  ];

  // المستر: كل القوائم وواجهة Points الأصلية
 if (profile.role === "owner") {
  attendanceAccountEditAllowed = true;
  managerHomeworkAllowed = true;
  navButtons.forEach(button => {
    button.style.display = "";
  });

  $("schedule")?.classList.remove("schedule-readonly");

  const scheduleLayout =
    $("schedule")?.querySelector(".two-col");

  if (scheduleLayout?.children?.[0]) {
    scheduleLayout.children[0].style.display = "";
  }

  renderSchedule();
  restoreOwnerPointsWorkspace();
  $("appShell")?.classList.remove("hidden");
  await loadAttendance();
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
attendanceAccountEditAllowed = permissions.attendance_edit === true;
managerHomeworkAllowed =
  permissions.attendance_edit === true ||
  permissions.points_edit === true;
  navButtons.forEach(button => {
    const page = button.dataset.page;

    const allowed =
  (page === "attendance" && permissions.attendance_view === true) ||
  (page === "students" && permissions.students_view === true) ||
  (page === "points" && permissions.points_view === true) ||
  (page === "homework" && managerHomeworkAllowed) ||
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
  await loadAttendance();
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
let attendanceAccountEditAllowed = false;
let managerHomeworkAllowed = false;
let managerPointsActiveGroup = "";
let managerPointsActiveReason = "";
let managerPointsSaving = false;
let managerPointsAccessOpen = false;
let managerPointsAccessLoading = false;
let homeworkSelectedFiles = [];
let parentHomeworkLoadVersion = 0;

function updateManagerPointsAccessUI(state = {}) {
  const statusBox = $("managerPointsAccessStatus");
  const saveButton = $("saveManagerPointsBtn");
  const isOpen = state.is_open === true && state.session_exists !== true;

  managerPointsAccessOpen = isOpen;

  if (statusBox) {
    statusBox.classList.toggle("open", isOpen);
    statusBox.classList.toggle("closed", !isOpen);
    statusBox.textContent = isOpen
      ? "الحصة مفتوحة بإذن الإدارة — يمكنك تسجيل النقاط الآن"
      : state.session_exists
        ? "الحصة مسجلة/مغلقة — لا يمكن إضافة نقاط جديدة من ولاء"
        : "الحصة مغلقة — يلزم فتحها من المالك أو مسؤول الحضور";
  }

  document
    .querySelectorAll("#managerPointsStudents .manager-points-value")
    .forEach(input => {
      const rowBlocked = input.dataset.blocked === "true";
      input.disabled = !isOpen || rowBlocked;
    });

  if (saveButton) {
    saveButton.disabled = managerPointsAccessLoading || !isOpen;
  }
}

async function refreshManagerPointsAccess(options = {}) {
  const silent = options.silent === true;
  const groupCode = $("managerPointsGroup")?.value || "";
  const group = groupById(groupCode);

  if (!group?.dbId) {
    updateManagerPointsAccessUI({ is_open: false });
    return { is_open: false };
  }

  managerPointsAccessLoading = true;
  updateManagerPointsAccessUI({ is_open: managerPointsAccessOpen });

  let finalState = { is_open: false };

  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc(
      "get_manager_points_session_access",
      {
        p_group_id: group.dbId,
        p_session_date: localDateISO()
      }
    );

    if (error) throw error;

    finalState = data || { is_open: false };
    managerPointsAccessOpen =
      finalState.is_open === true &&
      finalState.session_exists !== true;

    return finalState;
  } catch (error) {
    console.error("Manager points access error:", error);
    managerPointsAccessOpen = false;
    if (!silent) {
      showToast("تعذر التحقق من فتح حصة ولاء");
    }
    return finalState;
  } finally {
    managerPointsAccessLoading = false;
    updateManagerPointsAccessUI(finalState);
  }
}

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
                      data-blocked="${blocked ? "true" : "false"}"
                      type="number"
                      step="1"
                     value="${currentDraft[student.id] ?? 0}"
                      placeholder="عدد النقاط"
                      ${blocked || !managerPointsAccessOpen ? "disabled" : ""}
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

  const accessState = await refreshManagerPointsAccess({
    silent: true
  });

  if (accessState?.is_open !== true || accessState?.session_exists === true) {
    showToast("الحصة مغلقة عند ولاء — اطلب فتحها من الإدارة");
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
        "queue_manager_points_authorized",
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

     if (data?.closed) {
  closed += 1;
  continue;
}

if (data?.already_applied) {
  if (
    managerPointsDrafts[entry.draftKey]
  ) {
    delete managerPointsDrafts[entry.draftKey][entry.studentId];

    if (
      Object.keys(
        managerPointsDrafts[entry.draftKey]
      ).length === 0
    ) {
      delete managerPointsDrafts[entry.draftKey];
    }
  }

  queued += 1;
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

    await refreshManagerPointsAccess({ silent: true });
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
          id="managerPointsAccessStatus"
          class="manager-points-access-status closed"
          style="margin-top:14px;"
        >
          الحصة مغلقة — يلزم فتحها من الإدارة
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
  ?.addEventListener("change", async () => {
    saveManagerPointsDraft();
    managerPointsAccessOpen = false;
    renderManagerPointsStudents();
    await refreshManagerPointsAccess();
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
  refreshManagerPointsAccess({ silent: true });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderHomeworkSelectedFiles() {
  const box = $("homeworkSelectedFiles");
  if (!box) return;

  box.innerHTML = homeworkSelectedFiles.length
    ? homeworkSelectedFiles.map((file, index) => `
        <div class="homework-selected-file">
          <span>${escapeHtml(file.name)}</span>
          <small>${(file.size / 1024 / 1024).toFixed(2)} MB</small>
          <button
            type="button"
            class="link-btn"
            data-homework-remove="${index}"
          >حذف</button>
        </div>
      `).join("")
    : `<div class="list-item">لم يتم اختيار صور أو PDF بعد</div>`;

  box.querySelectorAll("[data-homework-remove]")
    .forEach(button => {
      button.addEventListener("click", () => {
        homeworkSelectedFiles.splice(
          Number(button.dataset.homeworkRemove),
          1
        );
        renderHomeworkSelectedFiles();
      });
    });
}

function isHeicHomeworkFile(file) {
  const mimeType = String(file?.type || file?.mime_type || "")
    .toLowerCase();
  const fileName = String(file?.name || file?.file_name || "")
    .toLowerCase();

  return (
    mimeType.includes("heic") ||
    mimeType.includes("heif") ||
    /\.(heic|heif)$/.test(fileName)
  );
}

function addHomeworkFiles(fileList) {
  const allowedTypes = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
  ]);
  const allowedNamePattern =
    /\.(pdf|jpe?g|png|webp|gif)$/i;
  const maxBytes = 15 * 1024 * 1024;

  for (const file of [...(fileList || [])]) {
    if (isHeicHomeworkFile(file)) {
      showToast(
        "صيغة HEIC لا تظهر كصورة داخل التطبيق؛ استخدم زر تصوير أو اختر صورة JPG أو PNG"
      );
      continue;
    }

    const isAllowed =
      allowedTypes.has(String(file.type || "").toLowerCase()) ||
      allowedNamePattern.test(String(file.name || ""));

    if (!isAllowed) {
      showToast(
        `الملف ${file.name} ليس صورة مدعومة أو PDF`
      );
      continue;
    }

    if (file.size > maxBytes) {
      showToast(`الملف ${file.name} أكبر من 15 MB`);
      continue;
    }

    const duplicate = homeworkSelectedFiles.some(
      item =>
        item.name === file.name &&
        item.size === file.size &&
        item.lastModified === file.lastModified
    );

    if (!duplicate) {
      homeworkSelectedFiles.push(file);
    }
  }

  renderHomeworkSelectedFiles();
}

async function loadHomeworkAdmin() {
  if (!managerHomeworkAllowed && currentAppRole !== "owner") return;

  const gradeSelect = $("homeworkGrade");
  const list = $("homeworkAdminList");

  if (!gradeSelect || !list) return;

  const previous = gradeSelect.value;
  const uniqueGrades = [];
  const seenGrades = new Set();

  for (const group of groups) {
    const gradeKey = String(group.grade || "").trim();
    if (!gradeKey || seenGrades.has(gradeKey)) continue;
    seenGrades.add(gradeKey);
    uniqueGrades.push({
      key: gradeKey,
      label: scheduleGradeName(gradeKey) || gradeKey
    });
  }

  gradeSelect.innerHTML = uniqueGrades.map(grade => `
    <option value="${escapeHtml(grade.key)}">${escapeHtml(grade.label)}</option>
  `).join("");

  if (previous && uniqueGrades.some(grade => grade.key === previous)) {
    gradeSelect.value = previous;
  }

  const gradeKey = gradeSelect.value;
  if (!gradeKey) return;

  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("homework_assignments")
      .select(`
        id,
        title,
        notes,
        homework_date,
        created_at,
        homework_files (
          id,
          file_name,
          mime_type,
          storage_path
        )
      `)
      .eq("grade_key", gradeKey)
      .eq("is_active", true)
      .order("homework_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(15);

    if (error) throw error;

    list.innerHTML = (data || []).length
      ? data.map(item => `
          <article class="list-item">
            <div>
              <strong>${escapeHtml(item.title || "واجب")}</strong>
              <span>${parentFormatDate(item.homework_date)}</span>
              ${item.notes ? `<span>${escapeHtml(item.notes)}</span>` : ""}
              <small>${(item.homework_files || []).length} مرفق</small>
            </div>
          </article>
        `).join("")
      : `<div class="list-item">لا توجد واجبات مرسلة لهذا الصف</div>`;
  } catch (error) {
    console.error("Homework admin load error:", error);
    list.innerHTML = `<div class="list-item">تعذر تحميل الواجبات</div>`;
  }
}

async function sendHomework() {
  if (!managerHomeworkAllowed && currentAppRole !== "owner") {
    showToast("لا توجد صلاحية لإرسال الواجب");
    return;
  }

  const gradeKey = $("homeworkGrade")?.value || "";
  const homeworkDate = $("homeworkDate")?.value || localDateISO();
  const title = ($("homeworkTitle")?.value || "واجب").trim() || "واجب";
  const notes = ($("homeworkNotes")?.value || "").trim();
  const button = $("sendHomeworkBtn");

  if (!gradeKey) {
    showToast("اختر الصف الدراسي");
    return;
  }

  if (!homeworkSelectedFiles.length) {
    showToast("اختر صورة أو ملف PDF واحدًا على الأقل");
    return;
  }

  button.disabled = true;
  button.textContent = "جارٍ رفع وإرسال الواجب...";

  const uploadedPaths = [];
  let assignmentId = null;

  try {
    const supabase = await getSupabase();

    const { data: assignment, error: assignmentError } = await supabase
      .from("homework_assignments")
      .insert({
        grade_key: gradeKey,
        title,
        notes: notes || null,
        homework_date: homeworkDate
      })
      .select("id")
      .single();

    if (assignmentError || !assignment) {
      throw assignmentError || new Error("Homework assignment creation failed");
    }

    assignmentId = assignment.id;

    for (const file of homeworkSelectedFiles) {
      const originalName = file.name || "homework";
      const extension = originalName.includes(".")
        ? originalName.split(".").pop().toLowerCase()
        : (file.type === "application/pdf" ? "pdf" : "jpg");
      const fileToken =
        crypto.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const storagePath =
        `${assignmentId}/${fileToken}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("homework-files")
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined
        });

      if (uploadError) throw uploadError;
      uploadedPaths.push(storagePath);

      const { error: fileRowError } = await supabase
        .from("homework_files")
        .insert({
          assignment_id: assignmentId,
          storage_path: storagePath,
          file_name: originalName,
          mime_type: file.type || null,
          file_size: file.size
        });

      if (fileRowError) throw fileRowError;
    }

    const {
      data: pushData,
      error: pushError
    } = await supabase.functions.invoke(
      "send-parent-push",
      {
        body: {
          homework_assignment_id: assignmentId
        }
      }
    );

    const pushFailed =
      Boolean(pushError) || pushData?.ok === false;

    if (pushFailed) {
      console.error(
        "Homework push error:",
        pushError || pushData
      );
    }

    homeworkSelectedFiles = [];
    renderHomeworkSelectedFiles();
    if ($("homeworkTitle")) $("homeworkTitle").value = "واجب";
    if ($("homeworkNotes")) $("homeworkNotes").value = "";

    showToast(
      pushFailed
        ? "تم إرسال الواجب للصف داخل التطبيق وتعذر إشعار بعض الأجهزة"
        : "تم إرسال الواجب وإشعار أولياء أمور الصف"
    );

    await loadHomeworkAdmin();
  } catch (error) {
    console.error("Homework send error:", error);

    if (assignmentId) {
      try {
        const supabase = await getSupabase();

        if (uploadedPaths.length) {
          await supabase.storage
            .from("homework-files")
            .remove(uploadedPaths);
        }

        await supabase
          .from("homework_assignments")
          .delete()
          .eq("id", assignmentId);
      } catch (cleanupError) {
        console.error(
          "Homework cleanup error:",
          cleanupError
        );
      }
    }

    showToast(error?.message || "تعذر إرسال الواجب");
  } finally {
    button.disabled = false;
    button.textContent = "إرسال الواجب لأولياء الأمور";
  }
}

function parentHomeworkFileMarkup(file) {
  if (!file.url) {
    return `
      <span class="homework-file-error">
        تعذر فتح ${escapeHtml(file.file_name || "الملف")}
      </span>
    `;
  }

  const safeUrl = escapeHtml(file.url);
  const safeName = escapeHtml(file.file_name || "ملف الواجب");
  const mimeType = String(file.mime_type || "").toLowerCase();
  const isImage =
    mimeType.startsWith("image/") ||
    /\.(jpe?g|png|webp|gif)$/i.test(
      String(file.file_name || "")
    );
  const isHeic = isHeicHomeworkFile(file);

  if (isImage && !isHeic) {
    return `
      <a
        href="${safeUrl}"
        target="_blank"
        rel="noopener"
        class="homework-image-link"
        aria-label="فتح صورة الواجب بالحجم الكامل"
      >
        <img
          src="${safeUrl}"
          alt="${safeName}"
          loading="lazy"
          data-homework-preview
        >
        <span>اضغط لفتح الصورة</span>
      </a>
    `;
  }

  if (isHeic) {
    return `
      <a
        href="${safeUrl}"
        target="_blank"
        rel="noopener"
        class="homework-legacy-file-link"
      >
        <strong>صورة واجب قديمة بصيغة HEIC</strong>
        <small>اضغط لفتحها أو تنزيلها</small>
      </a>
    `;
  }

  return `
    <a
      href="${safeUrl}"
      target="_blank"
      rel="noopener"
      class="homework-pdf-link"
    >
      <strong>ملف PDF</strong>
      <small>${safeName}</small>
    </a>
  `;
}

function parentHomeworkAssignmentMarkup(
  assignment,
  isToday = false
) {
  const previewFiles = assignment.files.filter(
    file => !isHeicHomeworkFile(file)
  );
  const legacyHeicFiles = assignment.files.filter(
    file => isHeicHomeworkFile(file)
  );

  return `
    <article class="homework-parent-card${isToday ? " latest" : ""}">
      <div class="homework-parent-head">
        <div>
          <strong>${escapeHtml(assignment.title || "واجب")}</strong>
          <span>${parentFormatDate(assignment.homework_date)}</span>
        </div>
        ${isToday
          ? '<span class="homework-latest-badge">واجب اليوم</span>'
          : ""}
      </div>

      ${assignment.notes
        ? `<p>${escapeHtml(assignment.notes)}</p>`
        : ""}

      ${previewFiles.length
        ? `
          <div class="homework-parent-files">
            ${previewFiles
              .map(parentHomeworkFileMarkup)
              .join("")}
          </div>
        `
        : ""}

      ${legacyHeicFiles.length
        ? `
          <details class="homework-legacy-files">
            <summary>
              ${legacyHeicFiles.length}
              صورة قديمة بصيغة HEIC
            </summary>

            <div class="homework-legacy-file-list">
              ${legacyHeicFiles
                .map(parentHomeworkFileMarkup)
                .join("")}
            </div>
          </details>
        `
        : ""}

      ${!assignment.files.length
        ? '<div class="daily-report-empty">لا توجد ملفات مرفقة</div>'
        : ""}
    </article>
  `;
}

function activateParentHomeworkImageFallbacks(list) {
  list
    .querySelectorAll("[data-homework-preview]")
    .forEach(image => {
      image.addEventListener(
        "error",
        () => {
          const link = image.closest(
            ".homework-image-link"
          );

          if (!link) return;

          link.classList.add(
            "homework-preview-failed"
          );
          link.innerHTML = `
            <span class="homework-preview-error">
              تعذر عرض المصغّر
              <small>اضغط لفتح الصورة</small>
            </span>
          `;
        },
        { once: true }
      );
    });
}

async function loadParentHomework(childId) {
  const list = $("parentHomeworkList");
  if (!list || !childId) return;

  const loadVersion = ++parentHomeworkLoadVersion;

  list.innerHTML =
    '<div class="list-item">جاري تحميل الواجب...</div>';

  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc(
      "get_parent_homework",
      {
        p_student_id: childId
      }
    );

    if (error) throw error;

    const rows = data || [];
    const grouped = new Map();

    for (const row of rows) {
      if (!grouped.has(row.assignment_id)) {
        grouped.set(row.assignment_id, {
          id: row.assignment_id,
          title: row.title,
          notes: row.notes,
          homework_date: row.homework_date,
          files: []
        });
      }

      if (row.file_id && row.storage_path) {
        grouped.get(row.assignment_id).files.push({
          id: row.file_id,
          file_name: row.file_name,
          mime_type: row.mime_type,
          storage_path: row.storage_path
        });
      }
    }

    const assignments = [...grouped.values()]
      .sort((first, second) => {
        const dateOrder = String(
          second.homework_date || ""
        ).localeCompare(
          String(first.homework_date || "")
        );

        if (dateOrder !== 0) return dateOrder;

        return String(second.id || "").localeCompare(
          String(first.id || "")
        );
      });

    await Promise.all(
      assignments.flatMap(assignment =>
        assignment.files.map(async file => {
          const {
            data: signed,
            error: signedError
          } = await supabase.storage
            .from("homework-files")
            .createSignedUrl(
              file.storage_path,
              3600
            );

          if (!signedError) {
            file.url = signed?.signedUrl || "";
          }
        })
      )
    );

    if (loadVersion !== parentHomeworkLoadVersion) {
      return;
    }

    if (!assignments.length) {
      list.innerHTML =
        '<div class="list-item">لا يوجد واجب مرسل حاليًا</div>';
      return;
    }

    const today = localDateISO();
    const todayAssignments = assignments.filter(
      assignment =>
        String(assignment.homework_date || "") === today
    );
    const previousAssignments = assignments.filter(
      assignment =>
        String(assignment.homework_date || "") !== today
    );

    list.innerHTML = `
      <div class="homework-latest-wrap">
        ${todayAssignments.length
          ? todayAssignments
              .map(assignment =>
                parentHomeworkAssignmentMarkup(
                  assignment,
                  true
                )
              )
              .join("")
          : `
            <div class="homework-today-empty">
              لا يوجد واجب جديد بتاريخ اليوم
            </div>
          `}
      </div>

      ${previousAssignments.length
        ? `
          <details class="homework-archive">
            <summary>
              <span>الواجبات السابقة</span>
              <strong>
                ${previousAssignments.length} واجب
              </strong>
            </summary>

            <div class="homework-archive-list">
              ${previousAssignments
                .map(assignment =>
                  parentHomeworkAssignmentMarkup(
                    assignment
                  )
                )
                .join("")}
            </div>
          </details>
        `
        : ""}
    `;

    activateParentHomeworkImageFallbacks(list);
  } catch (error) {
    if (loadVersion !== parentHomeworkLoadVersion) {
      return;
    }

    console.error("Parent homework load error:", error);
    list.innerHTML =
      '<div class="list-item">تعذر تحميل الواجب</div>';
  }
}


function navigate(page){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active-page"));
  document.querySelectorAll("#navMenu button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  $(page).classList.add("active-page");
  const title = document.querySelector(`#navMenu button[data-page="${page}"]`).textContent.replace(/^[^\s]+\s/,"");
  $("pageTitle").textContent = title;
  document.querySelector(".sidebar").classList.remove("open");
  renderAll();

  if (page === "homework") {
    loadHomeworkAdmin();
  }
}

function renderAll(){
  renderDashboard();
  populateSelects();
  renderStudents();
  renderPayments();
  renderLeaderboard();
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
      created_at,
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
    createdAt: student.created_at,
   group: student.groups?.code || "",
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
async function loadDashboardTodayStats(supabase, isOwner) {
  const today = localDateISO();
  let presentToday = null;
  let collectedToday = null;

  try {
    const { data: todaySessions, error: sessionsError } = await supabase
      .from("sessions")
      .select("id")
      .eq("session_date", today);

    if (sessionsError) throw sessionsError;

    const sessionIds = (todaySessions || []).map(session => session.id);

    if (!sessionIds.length) {
      presentToday = 0;
    } else {
      const { count, error: attendanceError } = await supabase
        .from("attendance")
        .select("id", { count: "exact", head: true })
        .in("session_id", sessionIds)
        .in("attendance_status", ["present", "late"]);

      if (attendanceError) throw attendanceError;
      presentToday = Number(count || 0);
    }
  } catch (error) {
    console.error("Dashboard attendance summary error:", error);
  }

  if (isOwner) {
    try {
      const { data, error } = await supabase.rpc(
        "get_owner_daily_payment_report",
        { p_date: today }
      );

      if (error) throw error;
      collectedToday = Number(data?.paid_total || 0);
    } catch (error) {
      console.error("Dashboard payment summary error:", error);
    }
  }

  return { presentToday, collectedToday };
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
  $("statPresent").textContent = "...";
  $("statCollected").textContent = isOwner ? "..." : "—";
  $("statTodayStudents").textContent = todayStudentCount;

  const { presentToday, collectedToday } =
    await loadDashboardTodayStats(supabase, isOwner);

  $("statPresent").textContent =
    presentToday === null ? "—" : presentToday;

  if (isOwner) {
    $("statCollected").textContent =
      collectedToday === null
        ? "—"
        : `${collectedToday.toFixed(2)} ج`;
  }

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
  ["paymentStudent","pointsStudent","parentStudent"].forEach(id=>{
    const el=$(id); if(el){const old=el.value; el.innerHTML=studentOptions; if(old) el.value=old;}
  });

  filterAttendancePaymentStudents();
}

function filterAttendancePaymentStudents() {
  const gradeSelect = $("attendancePaymentGrade");
  const studentSelect = $("attendancePaymentStudent");

  if (!gradeSelect || !studentSelect) return;

  const selectedGrade = gradeSelect.value;
  const oldStudentId = studentSelect.value;

  const filteredStudents = selectedGrade
    ? students.filter(student => groupById(student.group)?.grade === selectedGrade)
    : [];

  if (!selectedGrade) {
    studentSelect.innerHTML = `<option value="">اختر الصف أولًا</option>`;
    $("attendanceDueAmount").textContent = "0.00 جنيه";
    return;
  }

  if (!filteredStudents.length) {
    studentSelect.innerHTML = `<option value="">لا يوجد طلاب في هذا الصف</option>`;
    $("attendanceDueAmount").textContent = "0.00 جنيه";
    return;
  }

  studentSelect.innerHTML = filteredStudents
    .map(student => `<option value="${student.id}">${student.name} — ${groupById(student.group)?.name || "غير محدد"}</option>`)
    .join("");

  if (
    oldStudentId &&
    filteredStudents.some(student => String(student.id) === String(oldStudentId))
  ) {
    studentSelect.value = oldStudentId;
  }
}
async function refreshWalaaSessionAccessControl() {
  const box = $("walaaSessionAccessBox");
  const button = $("walaaSessionAccessBtn");
  const text = $("walaaSessionAccessText");

  if (!box || !button || !text) return null;

  const canControl =
    currentAppRole === "owner" || attendanceAccountEditAllowed;

  if (!canControl) {
    box.classList.add("hidden");
    return null;
  }

  const group = groupById($("groupSelect")?.value || "");
  const sessionDate = $("sessionDate")?.value;

  if (!group?.dbId || !sessionDate) {
    box.classList.add("hidden");
    return null;
  }

  box.classList.remove("hidden");
  button.disabled = true;
  text.textContent = "جارٍ التحقق من صلاحية ولاء...";

  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc(
      "get_manager_points_session_access",
      {
        p_group_id: group.dbId,
        p_session_date: sessionDate
      }
    );

    if (error) throw error;

    const isOpen = data?.is_open === true && data?.session_exists !== true;

    box.dataset.isOpen = isOpen ? "true" : "false";

    if (data?.session_exists) {
      text.textContent = "الحصة مسجلة — مغلقة تمامًا عند ولاء";
      button.textContent = "مغلقة عند ولاء";
      button.disabled = true;
    } else if (isOpen) {
      text.textContent = "ولاء مسموح لها بتسجيل نقاط هذه الحصة";
      button.textContent = "إغلاق الحصة عند ولاء";
      button.disabled = false;
    } else {
      text.textContent = "ولاء لا تستطيع فتح أو تسجيل نقاط هذه الحصة";
      button.textContent = "فتح الحصة عند ولاء";
      button.disabled = false;
    }

    return data;
  } catch (error) {
    console.error("Walaa access load error:", error);
    text.textContent = "تعذر التحقق من صلاحية ولاء";
    button.textContent = "إعادة المحاولة";
    button.disabled = false;
    return null;
  }
}

async function toggleWalaaSessionAccess() {
  const group = groupById($("groupSelect")?.value || "");
  const sessionDate = $("sessionDate")?.value;
  const box = $("walaaSessionAccessBox");

  if (!group?.dbId || !sessionDate || !box) {
    showToast("اختر المجموعة والتاريخ أولًا");
    return;
  }

  const shouldOpen = box.dataset.isOpen !== "true";

  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc(
      "set_manager_points_session_access",
      {
        p_group_id: group.dbId,
        p_session_date: sessionDate,
        p_is_open: shouldOpen
      }
    );

    if (error) throw error;

    if (data?.ok === false) {
      showToast(data?.message || "تعذر تغيير صلاحية ولاء");
    } else {
      showToast(
        shouldOpen
          ? "تم فتح الحصة عند ولاء"
          : "تم إغلاق الحصة عند ولاء"
      );
    }

    await refreshWalaaSessionAccessControl();
  } catch (error) {
    console.error("Walaa access update error:", error);
    showToast("تعذر تغيير صلاحية ولاء");
  }
}

function pendingPointItemHtml(point) {
  const reasonText = String(point.reason_text || "نقاط");
  const safeReason = reasonText
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  return `
    <div
      class="pending-point-item"
      data-pending-id="${point.id}"
      data-pending-status="${escapeHtml(point.status || "pending")}"
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
        title="${safeReason}"
      >
        ${safeReason}
      </span>

      <input
        class="pending-point-value"
        type="number"
        step="1"
        value="${Number(point.points || 0)}"
        ${point.status === "approved" ? "disabled" : ""}
        style="
          width:52px;
          height:27px;
          padding:1px 4px;
          text-align:center;
          flex:none;
        "
      >
    </div>
  `;
}

async function syncPendingPointItemsFromServer(
  supabase,
  group,
  sessionDate
) {
  const { data, error } = await supabase.rpc(
    "get_owner_pending_session_points",
    {
      p_group_id: group.dbId,
      p_session_date: sessionDate
    }
  );

  if (error) {
    console.error("Pending points refresh error:", error);
    return { added: 0, orphan: 0, error };
  }

  const rows = data || [];
  const existingIds = new Set(
    [...document.querySelectorAll(
      "#attendanceBody .pending-point-item"
    )].map(item => String(item.dataset.pendingId || ""))
  );

  let added = 0;
  let orphan = 0;

  for (const point of rows) {
    if (existingIds.has(String(point.id))) continue;

    const studentRow = document.querySelector(
      `#attendanceBody tr[data-id="${point.student_id}"]`
    );
    const list = studentRow?.querySelector(
      ".pending-points-list"
    );

    if (!list) {
      orphan += 1;
      continue;
    }

    list.insertAdjacentHTML(
      "beforeend",
      pendingPointItemHtml(point)
    );
    existingIds.add(String(point.id));
    added += 1;
  }

  return { added, orphan, rows };
}

let attendanceArrearsPaymentStudentId = "";
let attendanceArrearsPaymentSaving = false;

function updateAttendanceArrearsRow(studentId) {
  const student = students.find(
    item => String(item.id) === String(studentId)
  );
  const row = document.querySelector(
    `#attendanceBody tr[data-id="${studentId}"]`
  );

  if (!student || !row) return;

  const dueAmount = Number(student.dueAmount || 0);
  const dueCount = row.querySelector(".attendance-due-count");
  const dueAmountText = row.querySelector(".attendance-due-amount");
  const payButton = row.querySelector(".attendance-pay-arrears-btn");

  if (dueCount) {
    dueCount.textContent = `${Number(student.dueSessions || 0)} / 3`;
    dueCount.classList.toggle(
      "red",
      Number(student.dueSessions || 0) >= 3
    );
  }

  if (dueAmountText) {
    dueAmountText.textContent = `${dueAmount.toFixed(2)} ج`;
  }

  if (payButton) {
    payButton.disabled = dueAmount <= 0;
    payButton.textContent =
      dueAmount > 0 ? "سداد المتأخر" : "لا يوجد متأخر";
  }
}

function closeAttendanceArrearsDialog() {
  if (attendanceArrearsPaymentSaving) return;

  attendanceArrearsPaymentStudentId = "";
  $("attendanceArrearsDialog")?.close();
}

function openAttendanceArrearsDialog(studentId) {
  const canEditAccount =
    currentAppRole === "owner" ||
    attendanceAccountEditAllowed;

  if (!canEditAccount) {
    showToast("ليس لديك صلاحية لتسجيل السداد");
    return;
  }

  const student = students.find(
    item => String(item.id) === String(studentId)
  );

  if (!student) {
    showToast("تعذر العثور على الطالب");
    return;
  }

  const dueAmount = Number(student.dueAmount || 0);

  if (dueAmount <= 0) {
    showToast("لا توجد متأخرات على الطالب");
    updateAttendanceArrearsRow(student.id);
    return;
  }

  attendanceArrearsPaymentStudentId = String(student.id);

  $("attendanceArrearsStudentName").textContent =
    student.name || "الطالب";
  $("attendanceArrearsCurrentDue").textContent =
    `${dueAmount.toFixed(2)} جنيه`;

  const amountInput = $("attendanceArrearsAmount");
  amountInput.value = dueAmount.toFixed(2);
  amountInput.max = dueAmount.toFixed(2);

  $("attendanceArrearsMethod").value = "cash";
  $("attendanceArrearsDialog")?.showModal();

  requestAnimationFrame(() => {
    amountInput.focus();
    amountInput.select();
  });
}

async function registerAttendanceRowArrearsPayment() {
  if (attendanceArrearsPaymentSaving) return;

  const student = students.find(
    item =>
      String(item.id) ===
      String(attendanceArrearsPaymentStudentId)
  );

  if (!student) {
    showToast("تعذر العثور على الطالب");
    return;
  }

  const currentDue = Number(student.dueAmount || 0);
  const amount = Number($("attendanceArrearsAmount")?.value || 0);
  const method = $("attendanceArrearsMethod")?.value || "cash";

  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("أدخل مبلغًا صحيحًا");
    return;
  }

  if (amount > currentDue) {
    showToast(
      `المبلغ أكبر من المتأخر الحالي (${currentDue.toFixed(2)} جنيه)`
    );
    return;
  }

  const confirmButton = $("attendanceArrearsConfirmBtn");

  try {
    attendanceArrearsPaymentSaving = true;

    if (confirmButton) {
      confirmButton.disabled = true;
      confirmButton.textContent = "جاري تسجيل السداد...";
    }

    const supabase = await getSupabase();

    const {
      data: freshBalance,
      error: balanceError
    } = await supabase.rpc(
      "get_student_due_balance",
      { p_student_id: student.id }
    );

    if (balanceError) throw balanceError;

    const freshDue = Number(freshBalance?.due_amount || 0);
    const balanceGroup = groupById(student.group);

    student.dueAmount = freshDue;
    student.dueSessions =
      balanceGroup?.price
        ? Math.ceil(freshDue / Number(balanceGroup.price))
        : 0;
    updateAttendanceArrearsRow(student.id);

    if (freshDue <= 0) {
      attendanceArrearsPaymentStudentId = "";
      $("attendanceArrearsDialog")?.close();
      showToast("تم سداد المتأخرات بالفعل ولا يوجد مبلغ مستحق");
      return;
    }

    if (amount > freshDue) {
      $("attendanceArrearsAmount").max = freshDue.toFixed(2);
      $("attendanceArrearsAmount").value = freshDue.toFixed(2);
      $("attendanceArrearsCurrentDue").textContent =
        `${freshDue.toFixed(2)} جنيه`;
      showToast(
        "تغير المتأخر من جهاز آخر؛ راجع المبلغ ثم أكد مرة أخرى"
      );
      return;
    }

    const { data, error } = await supabase.rpc(
      "pay_student_due_balance",
      {
        p_student_id: student.id,
        p_amount: amount,
        p_payment_method: method
      }
    );

    if (error) throw error;

    const remainingDue = Number(data?.remaining_due || 0);
    const group = groupById(student.group);

    student.dueAmount = remainingDue;
    student.dueSessions =
      group?.price
        ? Math.ceil(remainingDue / Number(group.price))
        : 0;

    updateAttendanceArrearsRow(student.id);

    if (
      String($("attendancePaymentStudent")?.value || "") ===
      String(student.id)
    ) {
      $("attendanceDueAmount").textContent =
        `${remainingDue.toFixed(2)} جنيه`;
    }

    attendanceArrearsPaymentStudentId = "";
    $("attendanceArrearsDialog")?.close();

    const receiptText = data?.receipt_number
      ? ` — إيصال رقم ${data.receipt_number}`
      : "";

    showToast(
      `تم سداد ${amount.toFixed(2)} جنيه، المتبقي ${remainingDue.toFixed(2)} جنيه${receiptText}`
    );
  } catch (error) {
    console.error("Attendance row arrears payment error:", error);
    showToast(error?.message || "تعذر تسجيل سداد المتأخر");
  } finally {
    attendanceArrearsPaymentSaving = false;

    if (confirmButton) {
      confirmButton.disabled = false;
      confirmButton.textContent = "تأكيد السداد";
    }
  }
}

async function loadAttendance(){
  const groupId = $("groupSelect").value;
  const group = groupById(groupId);
  if (!group) return;
  const supabase = await getSupabase();

const { data: isOwner, error: ownerCheckError } =
  await supabase.rpc("is_owner");

if (ownerCheckError) {
  console.error("Owner check error:", ownerCheckError);
  showToast("تعذر التحقق من صلاحية الحساب");
  return;
}
const canEditAccount =
  isOwner || attendanceAccountEditAllowed;

await refreshWalaaSessionAccessControl();

  $("selectedPrice").innerHTML = isOwner
  ? `سعر الحصة: <b>${group.price} جنيه</b>`
  : "";

// لو الحصة موجودة بالفعل، نحمل بيانات الحضور والحساب المحفوظة
// قبل عرض الصفوف حتى لا تعود القيم الافتراضية (حاضر / دفع الآن)
// وتكتب فوق البيانات الحقيقية عند استكمال حصة معلقة.
let existingSessionForLoad = null;
let existingAttendanceByStudent = new Map();

try {
  const sessionDate = $("sessionDate")?.value;
  const startTime = normalizeSessionStartTime(group.time);

  if (group.dbId && sessionDate && startTime) {
    const { session: sessionData } = await findSessionForGroupDate(
      supabase,
      group.dbId,
      sessionDate,
      startTime,
      "id, status, start_time"
    );

    existingSessionForLoad = sessionData || null;

    if (existingSessionForLoad?.id) {
      const { data: attendanceData, error: attendanceLoadError } = await supabase
        .from("attendance")
        .select("student_id, attendance_status, payment_status, points_change, points_details")
        .eq("session_id", existingSessionForLoad.id);

      if (attendanceLoadError) throw attendanceLoadError;

      existingAttendanceByStudent = new Map(
        (attendanceData || []).map(item => [String(item.student_id), item])
      );
    }
  }
} catch (error) {
  console.error("Existing attendance restore error:", error);
  showToast("تعذر تحميل بيانات الحصة المحفوظة");
  return;
}

let pendingManagerPoints = [];

if (canEditAccount) {
  const {
    data: pendingRows,
    error: pendingError
  } = await supabase.rpc(
    "get_owner_pending_session_points",
    {
     p_group_id: group.dbId,
      p_session_date: $("sessionDate").value
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

const selectedSessionDate = $("sessionDate").value;

const expectedSessionTime =
  normalizeSessionStartTime(group.time);

const sessionDateTime = new Date(
  `${selectedSessionDate}T${expectedSessionTime}`
);

const now = new Date();

const todayLocal =
  `${now.getFullYear()}-` +
  `${String(now.getMonth() + 1).padStart(2, "0")}-` +
  `${String(now.getDate()).padStart(2, "0")}`;

const isPastSessionDay = selectedSessionDate < todayLocal;

const groupStudents = students
  .filter(s => s.group === groupId)
  .filter(s => {
    // حصة اليوم: اعرض كل الطلاب الموجودين حاليًا في المجموعة
    if (!isPastSessionDay) return true;

    // الحصص القديمة: الطالب لازم يكون اتضاف قبل وقت الحصة
    if (!s.createdAt) return true;

    const studentCreatedAt = new Date(s.createdAt);

    if (Number.isNaN(studentCreatedAt.getTime())) {
      return true;
    }

    return studentCreatedAt <= sessionDateTime;
  });

const list =
  isPastSessionDay && existingAttendanceByStudent.size > 0
    ? groupStudents.filter(s =>
        existingAttendanceByStudent.has(String(s.id))
      )
    : groupStudents;
  $("attendanceBody").innerHTML = list.length ? list.map(s=>`
    <tr data-id="${s.id}">
      <td><div class="student-name">${s.name}</div><div class="student-sub">${s.school}</div></td>
      <td>
        <select class="attendance-status">
          <option value="present">حاضر</option>
          <option value="late">متأخر</option>
          <option value="very_late">متأخر جدًا</option>
          <option value="absent">غائب</option>
          <option value="excused">غائب بعذر</option>
        </select>
      </td>
      ${canEditAccount ? `
  <td class="payment-cell">
    <select class="payment-status">
      <option value="paid">دفع الآن</option>
      <option value="due">إضافة للحساب</option>
      <option value="free">حصة مجانية</option>
    </select>
  </td>

  <td>
    <div class="attendance-arrears-cell">
      <span class="badge attendance-due-count ${s.dueSessions >= 3 ? "red" : ""}">
        ${s.dueSessions} / 3
      </span>
      <small class="attendance-due-amount">
        ${Number(s.dueAmount || 0).toFixed(2)} ج
      </small>
      <button
        type="button"
        class="attendance-pay-arrears-btn"
        data-student-id="${escapeHtml(s.id)}"
        ${Number(s.dueAmount || 0) <= 0 ? "disabled" : ""}
      >
        ${Number(s.dueAmount || 0) > 0 ? "سداد المتأخر" : "لا يوجد متأخر"}
      </button>
    </div>
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
                data-pending-status="${escapeHtml(point.status || "pending")}"
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
                  ${point.status === "approved" ? "disabled" : ""}
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
  .querySelectorAll("#attendanceBody .attendance-pay-arrears-btn")
  .forEach(button => {
    button.addEventListener("click", () => {
      openAttendanceArrearsDialog(button.dataset.studentId);
    });
  });

    document
  .querySelectorAll("#attendanceBody .attendance-status")
  .forEach(select => {

    const row = select.closest("tr");
    const savedAttendance = row
      ? existingAttendanceByStudent.get(String(row.dataset.id))
      : null;

    if (savedAttendance) {
      const savedDetails = Array.isArray(savedAttendance.points_details)
        ? savedAttendance.points_details
        : [];

      const wasVeryLate =
        savedAttendance.attendance_status === "late" &&
        savedDetails.some(detail =>
          String(detail?.reason || "") === "very_late"
        );

      select.value = wasVeryLate
        ? "very_late"
        : (savedAttendance.attendance_status || "present");

      const paymentSelect = row?.querySelector(".payment-status");
      if (paymentSelect && savedAttendance.payment_status) {
        paymentSelect.value = savedAttendance.payment_status;
      }

      const manualPointsInput = row?.querySelector(".session-manual-points");
      if (manualPointsInput) {
        const savedManualPoints = savedDetails
          .filter(detail => String(detail?.reason || "") === "manual")
          .reduce((sum, detail) => sum + Number(detail?.value || 0), 0);
        manualPointsInput.value = String(savedManualPoints);
      }
    }

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



async function sendParentPushForSession(
  supabase,
  sessionId
) {
  try {
    const { data, error } =
      await supabase.functions.invoke(
        "send-parent-push",
        {
          body: {
            session_id: sessionId
          }
        }
      );

    if (error) {
      console.error(
        "Parent push invoke error:",
        error
      );
      return null;
    }

    if (data?.ok === false) {
      console.error(
        "Parent push returned error:",
        data
      );
      return data;
    }

    console.log(
      "Parent push result:",
      data
    );

    return data;
  } catch (error) {
    console.error(
      "Parent push error:",
      error
    );

    return null;
  }
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
  const canEditAccount =
  isOwner || attendanceAccountEditAllowed;

  const { data: groupRow, error: groupError } = await supabase
  .from("groups")
  .select("id")
  .eq("id", group.dbId)
  .single();

if (groupError || !groupRow) {
  showToast("تعذر العثور على المجموعة");
  return;
}
const sessionDate = $("sessionDate").value;
const startTime = normalizeSessionStartTime(group.time);

if (!startTime) {
  showToast("تعذر تحديد وقت الحصة");
  return;
}

let existingSession = null;

try {
  const resolvedSession = await findSessionForGroupDate(
    supabase,
    groupRow.id,
    sessionDate,
    startTime,
    "id, status, start_time"
  );

  existingSession = resolvedSession.session || null;
} catch (existingSessionError) {
  console.error(
    "Session check error:",
    existingSessionError
  );
  showToast(
    existingSessionError?.code === "AMBIGUOUS_SESSION_DATE"
      ? existingSessionError.message
      : "تعذر التحقق من الحصة"
  );
  return;
}

if (existingSession?.status === "completed") {
  showToast("الحصة مسجلة ومغلقة بالفعل");
  await refreshWalaaSessionAccessControl();
  return;
}

let sessionRow = existingSession || null;

if (!sessionRow) {
  const {
    data: insertedSession,
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
    .select("id, status")
    .single();

  if (sessionError?.code === "23505") {
    showToast("تم إنشاء الحصة من جهاز آخر — اضغط حفظ مرة أخرى");
    await refreshWalaaSessionAccessControl();
    return;
  }

  if (sessionError || !insertedSession) {
    console.error(
      "Session save error:",
      sessionError
    );
    showToast("تعذر حفظ الحصة");
    return;
  }

  sessionRow = insertedSession;
}

await refreshWalaaSessionAccessControl();

const freshPendingBeforeSave =
  await syncPendingPointItemsFromServer(
    supabase,
    group,
    sessionDate
  );

if (freshPendingBeforeSave.error) {
  showToast("تعذر تحديث نقاط ولاء قبل الحفظ");
  return;
}

if (freshPendingBeforeSave.orphan > 0) {
  showToast("توجد نقاط لطالب غير ظاهر في الحصة — راجع بيانات المجموعة");
  return;
}

if (freshPendingBeforeSave.added > 0) {
  showToast("وصلت نقاط جديدة من ولاء — راجعها ثم اضغط حفظ مرة أخرى");
  return;
}

const {
  data: existingAttendanceRows,
  error: existingAttendanceError
} = await supabase
  .from("attendance")
  .select("student_id")
  .eq("session_id", sessionRow.id);

if (existingAttendanceError) {
  console.error("Existing attendance load error:", existingAttendanceError);
  showToast("تعذر استكمال الحصة المحفوظة");
  return;
}

const existingAttendanceStudentIds = new Set(
  (existingAttendanceRows || []).map(row => String(row.student_id))
);

  let blocked = 0;
  for (const row of rows) {
    const s = students.find(x => x.id === row.dataset.id);
    const status = row.querySelector(".attendance-status").value;
    const persistedStatus = status === "very_late" ? "late" : status;
    const isChargeableAttendance =
      status === "present" || status === "late" || status === "very_late";
 const payStatus =
  status === "absent" || status === "excused"
    ? "free"
    : canEditAccount
      ? row.querySelector(".payment-status")?.value || "due"
      : "due";

  const dueBlocked =
    isChargeableAttendance &&
    payStatus === "due" &&
    Number(s?.dueSessions || 0) >= 3 &&
    !override;
   
  const manualPoints = Number(
  row.querySelector(".session-manual-points")?.value || 0
);

if (!Number.isFinite(manualPoints)) {
  showToast("أدخل قيمة صحيحة للنقاط");
  return;
}

const attendancePointDetails =
  status === "present"
    ? [
        {
          value: 3,
          reason: "attendance",
          reason_label: "الحضور"
        }
      ]
    : status === "very_late"
      ? [
          {
            value: -2,
            reason: "very_late",
            reason_label: "متأخر جدًا"
          }
        ]
      : status === "absent"
        ? [
            {
              value: -10,
              reason: "absence",
              reason_label: "الغياب"
            }
          ]
        : [];

const attendancePoints = attendancePointDetails.reduce(
  (sum, detail) => sum + Number(detail.value || 0),
  0
);

const sessionPoints = attendancePoints + manualPoints;

const pointsDetails = [
  ...attendancePointDetails,
  ...(manualPoints !== 0
    ? [
        {
          value: manualPoints,
          reason: "manual",
          reason_label: "النقاط"
        }
      ]
    : [])
];

    if (!s) return;

    if (existingAttendanceStudentIds.has(String(s.id))) {
      const existingAttendanceSaveResult = canEditAccount
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

      if (existingAttendanceSaveResult.error) {
        console.error(
          "Existing attendance update error:",
          existingAttendanceSaveResult.error
        );
        showToast("تعذر تحديث الحضور المحفوظ قبل إغلاق الحصة");
        return;
      }

      continue;
    }

    if(status==="present"){
      s.present += 1; s.points += 3;
    }else if(status==="late"){
      s.present += 1; s.late += 1;
    }else if(status==="very_late"){
      s.present += 1; s.late += 1; s.points -= 2;
    }else if(status==="absent"){
      s.absent += 1; s.points -= 10;
    }
    s.points += manualPoints;

    if(isChargeableAttendance && payStatus==="due"){
      if(dueBlocked){blocked += 1;}
      else {s.dueSessions += 1; s.dueAmount += group.price;}
    }
   if(isOwner && isChargeableAttendance && payStatus==="paid"){
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

  const safeAttendanceError =
    attendanceSaveResult.error;

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
attendance_status: persistedStatus,
payment_status: payStatus,
charge_amount:
  isChargeableAttendance && payStatus !== "free"
    ? (dueBlocked && payStatus === "due"
        ? 0
        : Number(group.price || 0))
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
  const pendingStatus = item.dataset.pendingStatus || "pending";

  if (pendingStatus === "approved") {
    continue;
  }

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

  if (points === 0) {
    item.remove();
  } else {
    item.dataset.pendingStatus = "approved";
    const input = item.querySelector(".pending-point-value");
    if (input) input.disabled = true;
  }
}

const freshPendingAfterReview =
  await syncPendingPointItemsFromServer(
    supabase,
    group,
    sessionDate
  );

if (freshPendingAfterReview.error) {
  showToast("تعذر التأكد من نقاط ولاء قبل إغلاق الحصة");
  return;
}

if (freshPendingAfterReview.orphan > 0) {
  showToast("توجد نقاط معلقة لطالب غير ظاهر — لن يتم إغلاق الحصة");
  return;
}

if (freshPendingAfterReview.added > 0) {
  showToast("وصلت نقاط جديدة أثناء الحفظ — راجعها ثم اضغط حفظ مرة أخرى");
  return;
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

  await refreshWalaaSessionAccessControl();

  if (
    String(completionError.message || "")
      .includes("PENDING_POINTS_REQUIRE_REVIEW")
  ) {
    await syncPendingPointItemsFromServer(
      supabase,
      group,
      sessionDate
    );
    showToast("وصلت نقاط جديدة وتحتاج مراجعة — اضغط حفظ مرة أخرى بعد مراجعتها");
  } else {
    showToast(
      "تم حفظ بيانات الحصة، لكن تعذر اعتماد وإغلاق الحصة"
    );
  }

  return;
}

await sendParentPushForSession(
  supabase,
  sessionRow.id
);

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

  const ownerToolsEnabled = currentAppRole === "owner";

  $("studentsGrid").innerHTML = list.map(s => `
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
      ${ownerToolsEnabled ? `
        <div class="student-owner-actions">
          <button
            type="button"
            class="primary-btn student-edit-btn"
            data-student-id="${escapeHtml(s.id)}"
          >عرض وتعديل البيانات</button>
          <button
            type="button"
            class="secondary-btn student-move-group-btn"
            data-student-id="${s.id}"
          >نقل لمجموعة أخرى</button>
          <button
            type="button"
            class="student-danger-btn student-delete-btn"
            data-student-id="${s.id}"
          >حذف الطالب</button>
        </div>
      ` : ""}
    </article>`).join("");

  if (!ownerToolsEnabled) return;

  $("studentsGrid")
    .querySelectorAll(".student-edit-btn")
    .forEach(button => {
      button.onclick = () =>
        openStudentEditDialog(button.dataset.studentId);
    });

  $("studentsGrid")
    .querySelectorAll(".student-move-group-btn")
    .forEach(button => {
      button.onclick = () => moveStudentToGroup(button.dataset.studentId);
    });

  $("studentsGrid")
    .querySelectorAll(".student-delete-btn")
    .forEach(button => {
      button.onclick = () => deleteStudentSafely(button.dataset.studentId);
    });
}

let editingStudentId = "";
let studentEditSaving = false;

function populateEditStudentGroupOptions(selectedGroupId = "") {
  const grade = $("editStudentGrade")?.value || "";
  const groupSelect = $("editStudentGroup");
  if (!groupSelect) return;

  const gradeGroups = groups.filter(
    group =>
      group?.dbId &&
      String(group.grade || "") === String(grade)
  );

  groupSelect.innerHTML = gradeGroups.length
    ? gradeGroups
        .map(group => `
          <option value="${escapeHtml(group.id)}">
            ${escapeHtml(group.name)}
          </option>
        `)
        .join("")
    : `<option value="">لا توجد مجموعات في هذا الصف</option>`;

  if (
    selectedGroupId &&
    gradeGroups.some(
      group => String(group.id) === String(selectedGroupId)
    )
  ) {
    groupSelect.value = String(selectedGroupId);
  }
}

function closeStudentEditDialog() {
  if (studentEditSaving) return;
  editingStudentId = "";
  $("studentEditDialog")?.close();
}

function openStudentEditDialog(studentId) {
  if (currentAppRole !== "owner") {
    showToast("تعديل بيانات الطالب متاح للمالك فقط");
    return;
  }

  const student = students.find(
    item => String(item.id) === String(studentId)
  );

  if (!student) {
    showToast("تعذر العثور على الطالب");
    return;
  }

  const currentGroup = groupById(student.group);
  const grades = [];
  const seenGrades = new Set();

  groups.forEach(group => {
    const grade = String(group.grade || "");
    if (!grade || seenGrades.has(grade)) return;
    seenGrades.add(grade);
    grades.push(grade);
  });

  if (
    currentGroup?.grade &&
    !seenGrades.has(String(currentGroup.grade))
  ) {
    grades.push(String(currentGroup.grade));
  }

  editingStudentId = String(student.id);

  $("editStudentName").value = student.name || "";
  $("editStudentSchool").value =
    student.school === "غير محدد" ? "" : (student.school || "");
  $("editStudentPhone").value = student.phone || "";

  $("editStudentGrade").innerHTML = grades
    .map(grade => `
      <option value="${escapeHtml(grade)}">
        ${escapeHtml(scheduleGradeName(grade))}
      </option>
    `)
    .join("");

  $("editStudentGrade").value =
    String(currentGroup?.grade || grades[0] || "");

  populateEditStudentGroupOptions(student.group);

  $("editStudentInfo").innerHTML = `
    <div>
      <span>المجموعة الحالية</span>
      <strong>${escapeHtml(currentGroup?.name || "غير محدد")}</strong>
    </div>
    <div>
      <span>الرصيد</span>
      <strong>${Number(student.points || 0)} نقطة</strong>
    </div>
    <div>
      <span>المستحق</span>
      <strong>${Number(student.dueAmount || 0).toFixed(2)} جنيه</strong>
    </div>
  `;

  $("studentEditDialog")?.showModal();
  requestAnimationFrame(() => $("editStudentName")?.focus());
}

function normalizeEgyptianParentPhone(value) {
  let phone = String(value || "").replace(/\D/g, "");

  if (phone.startsWith("0020") && phone.length === 14) {
    phone = "0" + phone.slice(4);
  } else if (phone.startsWith("20") && phone.length === 12) {
    phone = "0" + phone.slice(2);
  }

  return phone;
}

async function saveStudentEdits() {
  if (studentEditSaving) return;
  if (!(await confirmOwnerStudentAction())) return;

  const student = students.find(
    item => String(item.id) === String(editingStudentId)
  );

  if (!student) {
    showToast("تعذر العثور على الطالب");
    return;
  }

  const name = ($("editStudentName")?.value || "").trim();
  const school = ($("editStudentSchool")?.value || "").trim();
  const phone = normalizeEgyptianParentPhone(
    $("editStudentPhone")?.value
  );
  const targetGroup = groupById(
    $("editStudentGroup")?.value || ""
  );

  if (!name) {
    showToast("اسم الطالب مطلوب");
    return;
  }

  if (phone && !/^01[0125]\d{8}$/.test(phone)) {
    showToast("اكتب رقم ولي أمر مصري صحيح أو اتركه فارغًا");
    return;
  }

  if (!targetGroup?.dbId) {
    showToast("اختر مجموعة صحيحة للطالب");
    return;
  }

  const saveButton = $("saveStudentEditBtn");

  try {
    studentEditSaving = true;

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "جاري حفظ التعديل...";
    }

    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("students")
      .update({
        full_name: name,
        school_name: school || null,
        parent_phone: phone || null,
        group_id: targetGroup.dbId
      })
      .eq("id", student.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("لم يتم تحديث بيانات الطالب");

    await loadStudentsFromSupabase();

    editingStudentId = "";
    $("studentEditDialog")?.close();
    renderAll();

    showToast(`تم تحديث بيانات ${name} بنجاح`);
  } catch (error) {
    console.error("Student edit error:", error);
    showToast(error?.message || "تعذر تعديل بيانات الطالب");
  } finally {
    studentEditSaving = false;

    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "حفظ التعديلات";
    }
  }
}

async function confirmOwnerStudentAction() {
  if (currentAppRole !== "owner") {
    showToast("هذه العملية متاحة للمالك فقط");
    return false;
  }

  try {
    const supabase = await getSupabase();
    const { data: isOwner, error } = await supabase.rpc("is_owner");

    if (error || isOwner !== true) {
      if (error) console.error("Owner verification error:", error);
      showToast("تعذر التحقق من صلاحية المالك");
      return false;
    }

    return true;
  } catch (error) {
    console.error("Owner verification error:", error);
    showToast("تعذر التحقق من صلاحية المالك");
    return false;
  }
}

async function moveStudentToGroup(studentId) {
  if (!(await confirmOwnerStudentAction())) return;

  const student = students.find(
    item => String(item.id) === String(studentId)
  );

  if (!student) {
    showToast("تعذر العثور على الطالب");
    return;
  }

  const currentGroup = groupById(student.group);
  const availableGroups = groups.filter(group =>
    group?.dbId && String(group.id) !== String(student.group)
  );

  if (!availableGroups.length) {
    showToast("لا توجد مجموعة أخرى متاحة للنقل");
    return;
  }

  const choices = availableGroups
    .map((group, index) => `${index + 1} - ${group.name}`)
    .join("\n");

  const answer = window.prompt(
    `نقل الطالب: ${student.name}\n` +
    `من: ${currentGroup?.name || "غير محدد"}\n\n` +
    `اختر رقم المجموعة الجديدة:\n${choices}`
  );

  if (answer === null || String(answer).trim() === "") return;

  const selectedIndex = Number(String(answer).trim()) - 1;
  const targetGroup = availableGroups[selectedIndex];

  if (!targetGroup) {
    showToast("اختيار المجموعة غير صحيح");
    return;
  }

  const confirmed = window.confirm(
    `تأكيد نقل ${student.name}\n` +
    `إلى مجموعة: ${targetGroup.name}\n\n` +
    `لن يتم تغيير أي حضور أو نقاط أو حسابات سابقة.`
  );

  if (!confirmed) return;

  try {
    const supabase = await getSupabase();

    const { data, error } = await supabase
      .from("students")
      .update({ group_id: targetGroup.dbId })
      .eq("id", studentId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("لم يتم تحديث الطالب");

    await loadStudentsFromSupabase();
    renderAll();

    showToast(`تم نقل ${student.name} إلى ${targetGroup.name}`);
  } catch (error) {
    console.error("Move student error:", error);
    showToast(error?.message || "تعذر نقل الطالب");
  }
}

async function deleteStudentSafely(studentId) {
  if (!(await confirmOwnerStudentAction())) return;

  const student = students.find(
    item => String(item.id) === String(studentId)
  );

  if (!student) {
    showToast("تعذر العثور على الطالب");
    return;
  }

  if (
    Number(student.points || 0) !== 0 ||
    Number(student.dueSessions || 0) !== 0 ||
    Number(student.dueAmount || 0) !== 0
  ) {
    showToast("لا يمكن حذف الطالب لأنه لديه نقاط أو مستحقات مسجلة");
    return;
  }

  try {
    const supabase = await getSupabase();

    const historyChecks = [
      ["attendance", "سجل حضور"],
      ["payments", "مدفوعات"],
      ["point_transactions", "حركات نقاط"]
    ];

    for (const [table, label] of historyChecks) {
      const { count, error } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId);

      if (error) {
        console.error(`Student delete safety check failed (${table}):`, error);
        showToast("تعذر التحقق من سجل الطالب، لم يتم الحذف");
        return;
      }

      if (Number(count || 0) > 0) {
        showToast(`لا يمكن حذف الطالب لأنه لديه ${label}`);
        return;
      }
    }

    const confirmation = window.prompt(
      `سيتم حذف الطالب نهائيًا لأنه لا يملك أي سجل مسجل.\n\n` +
      `الطالب: ${student.name}\n\n` +
      `للتأكيد اكتب كلمة: حذف`
    );

    if (String(confirmation || "").trim() !== "حذف") {
      if (confirmation !== null) showToast("تم إلغاء الحذف");
      return;
    }

    const { data, error } = await supabase
      .from("students")
      .delete()
      .eq("id", studentId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("لم يتم حذف الطالب");

    await loadStudentsFromSupabase();
    renderAll();

    showToast(`تم حذف ${student.name} بنجاح`);
  } catch (error) {
    console.error("Delete student error:", error);
    showToast(error?.message || "تعذر حذف الطالب");
  }
}

async function addStudent(){
  const name=$("newStudentName").value.trim();
  const groupId=$("newGroup").value;
  const supabase = await getSupabase();
const rawGroupCode = String(groupId || "").trim();
const groupCode = /^[PMS]\d[AB]$/i.test(rawGroupCode)
  ? rawGroupCode.toUpperCase().replace(/^([PMS]\d)([AB])$/, "$1-$2")
  : rawGroupCode;
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
  createdAt: newStudent.created_at,
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

function dailyReportMoney(value) {
  return `${Number(value || 0).toFixed(2)} جنيه`;
}

function dailyReportMethodName(method) {
  return {
    cash: "نقدي",
    instapay: "انستاباي",
    vodafone_cash: "فودافون كاش",
    bank_transfer: "تحويل بنكي"
  }[method] || method || "";
}

function dailyReportStudentById(studentId) {
  return students.find(
    student => String(student.id) === String(studentId)
  );
}

function dailyReportGroupByDatabaseId(groupId) {
  return groups.find(
    group => String(group.dbId) === String(groupId)
  );
}

function dailyReportItemGroup(student, sessionGroup) {
  const group = sessionGroup || groupById(student?.group);

  return {
    gradeKey: group?.grade || group?.id || "unknown",
    gradeName:
      group?.grade
        ? scheduleGradeName(group.grade)
        : group?.name || "صف غير محدد",
    groupName: group?.name || "مجموعة غير محددة"
  };
}

function renderDailyAmountDetails(
  targetId,
  items,
  emptyText
) {
  const target = $(targetId);

  if (!target) return;

  if (!items.length) {
    target.innerHTML =
      `<div class="daily-report-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }

  const groupedItems = new Map();

  items.forEach(item => {
    const groupKey = item.gradeKey || "unknown";

    if (!groupedItems.has(groupKey)) {
      groupedItems.set(groupKey, {
        title: item.gradeName || "صف غير محدد",
        items: []
      });
    }

    groupedItems.get(groupKey).items.push(item);
  });

  target.innerHTML = [...groupedItems.values()]
    .map(group => {
      const groupTotal = group.items.reduce(
        (total, item) => total + Number(item.amount || 0),
        0
      );

      return `
        <section class="daily-report-grade">
          <div class="daily-report-grade-head">
            <strong>${escapeHtml(group.title)}</strong>
            <span>${dailyReportMoney(groupTotal)}</span>
          </div>

          <div class="daily-report-rows">
            ${group.items
              .map(item => `
                <div class="daily-report-row">
                  <div class="daily-report-student">
                    <strong>${escapeHtml(item.studentName)}</strong>
                    <small>
                      ${escapeHtml(item.groupName)}
                      ${item.note
                        ? ` — ${escapeHtml(item.note)}`
                        : ""}
                    </small>
                  </div>

                  <strong class="daily-report-amount">
                    ${dailyReportMoney(item.amount)}
                  </strong>
                </div>
              `)
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function renderDailyFreeStudents(freeStudents) {
  const target = $("dailyFreeStudents");

  if (!target) return;

  if (!freeStudents.length) {
    target.innerHTML =
      '<div class="daily-report-empty">لا يوجد طلاب معفيون اليوم</div>';
    return;
  }

  const groupedStudents = new Map();

  freeStudents.forEach(student => {
    const groupName =
      student.group_name || "مجموعة غير محددة";

    if (!groupedStudents.has(groupName)) {
      groupedStudents.set(groupName, []);
    }

    groupedStudents.get(groupName).push(student);
  });

  target.innerHTML = [...groupedStudents.entries()]
    .map(([groupName, groupStudents]) => `
      <section class="daily-report-grade">
        <div class="daily-report-grade-head">
          <strong>${escapeHtml(groupName)}</strong>
          <span>${groupStudents.length} طالب</span>
        </div>

        <div class="daily-report-name-list">
          ${groupStudents
            .map(student =>
              `<span>${escapeHtml(student.student_name || "طالب")}</span>`
            )
            .join("")}
        </div>
      </section>
    `)
    .join("");
}

function setDailyReportLoadingState() {
  [
    ["dailyPaidDetails", "جاري تحميل تفاصيل التحصيل..."],
    ["dailyDeferredDetails", "جاري تحميل بيانات الآجل..."],
    ["currentArrearsDetails", "جاري تحميل المتأخرات..."],
    ["dailyFreeStudents", "جاري تحميل أسماء المعفيين..."]
  ].forEach(([targetId, message]) => {
    const target = $(targetId);

    if (target) {
      target.innerHTML =
        `<div class="daily-report-empty">${message}</div>`;
    }
  });
}

async function loadDailyPaymentSummary() {
  if (
    !$("payments")?.classList.contains("active-page")
  ) {
    return;
  }

  setDailyReportLoadingState();

  const reportDate = localDateISO();
  const dayStart = new Date(`${reportDate}T00:00:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  try {
    const supabase = await getSupabase();

    const [
      reportResult,
      sessionsResult,
      paymentsResult
    ] = await Promise.all([
      supabase.rpc(
        "get_owner_daily_payment_report",
        { p_date: reportDate }
      ),
      supabase
        .from("sessions")
        .select("id, group_id")
        .eq("session_date", reportDate),
      supabase
        .from("payments")
        .select("student_id, amount, payment_method, paid_at")
        .gte("paid_at", dayStart.toISOString())
        .lt("paid_at", dayEnd.toISOString())
        .order("paid_at", { ascending: true })
    ]);

    if (reportResult.error) {
      console.error(
        "Daily payment report error:",
        reportResult.error
      );
    }

    const reportData = reportResult.data || {};

    $("dailyPaidTotal").textContent =
      reportResult.error
        ? "—"
        : dailyReportMoney(reportData.paid_total);

    $("dailyDeferredTotal").textContent =
      reportResult.error
        ? "—"
        : dailyReportMoney(reportData.deferred_total);

    $("dailyFreeCount").textContent =
      reportResult.error
        ? "—"
        : Number(reportData.free_count || 0);

    const freeStudents =
      Array.isArray(reportData.free_students)
        ? reportData.free_students
        : [];

    if (reportResult.error) {
      $("dailyFreeStudents").innerHTML =
        '<div class="daily-report-empty daily-report-error">تعذر تحميل أسماء المعفيين الآن</div>';
    } else {
      renderDailyFreeStudents(freeStudents);
    }

    const currentArrearsItems = students
      .filter(student => Number(student.dueAmount || 0) > 0)
      .map(student => {
        const groupInfo =
          dailyReportItemGroup(student);

        return {
          studentName: student.name || "طالب",
          amount: Number(student.dueAmount || 0),
          ...groupInfo
        };
      });

    const currentArrearsTotal = currentArrearsItems.reduce(
      (total, item) => total + Number(item.amount || 0),
      0
    );

    $("currentArrearsTotal").textContent =
      dailyReportMoney(currentArrearsTotal);

    $("currentArrearsStudentsCount").textContent =
      `${currentArrearsItems.length} طالب`;

    renderDailyAmountDetails(
      "currentArrearsDetails",
      currentArrearsItems,
      "لا توجد متأخرات حالية على الطلاب"
    );

    let paidItems = [];

    if (paymentsResult.error) {
      console.error(
        "Daily payments details error:",
        paymentsResult.error
      );
    } else {
      paidItems = (paymentsResult.data || [])
        .map(payment => {
          const student =
            dailyReportStudentById(payment.student_id);
          const groupInfo =
            dailyReportItemGroup(student);

          return {
            studentName: student?.name || "طالب غير ظاهر",
            amount: Number(payment.amount || 0),
            note: [
              dailyReportMethodName(
                payment.payment_method
              ),
              payment.paid_at
                ? new Date(payment.paid_at).toLocaleTimeString(
                    "ar-EG",
                    {
                      hour: "2-digit",
                      minute: "2-digit"
                    }
                  )
                : ""
            ].filter(Boolean).join(" — "),
            ...groupInfo
          };
        })
        .filter(item => item.amount > 0);
    }

    let attendanceRows = [];
    let attendanceDetailsFailed =
      Boolean(sessionsResult.error);
    const sessionRows = sessionsResult.data || [];

    if (sessionsResult.error) {
      console.error(
        "Daily sessions details error:",
        sessionsResult.error
      );
    } else if (sessionRows.length) {
      const attendanceResult = await supabase
        .from("attendance")
        .select(
          "student_id, session_id, payment_status, charge_amount, paid_amount"
        )
        .in(
          "session_id",
          sessionRows.map(session => session.id)
        );

      if (attendanceResult.error) {
        attendanceDetailsFailed = true;
        console.error(
          "Daily attendance details error:",
          attendanceResult.error
        );
      } else {
        attendanceRows = attendanceResult.data || [];
      }
    }

    const sessionById = new Map(
      sessionRows.map(session => [
        String(session.id),
        session
      ])
    );

    const attendancePaidItems = attendanceRows
      .filter(row => row.payment_status === "paid")
      .map(row => {
        const student =
          dailyReportStudentById(row.student_id);
        const session =
          sessionById.get(String(row.session_id));
        const sessionGroup =
          dailyReportGroupByDatabaseId(
            session?.group_id
          );
        const groupInfo =
          dailyReportItemGroup(
            student,
            sessionGroup
          );

        return {
          studentName: student?.name || "طالب غير ظاهر",
          amount: Number(row.charge_amount || 0),
          note: "حصة اليوم",
          ...groupInfo
        };
      })
      .filter(item => item.amount > 0);

    const paidTotalFromSummary =
      Number(reportData.paid_total || 0);
    const paidPaymentsTotal = paidItems.reduce(
      (total, item) => total + Number(item.amount || 0),
      0
    );
    const paidAttendanceTotal = attendancePaidItems.reduce(
      (total, item) => total + Number(item.amount || 0),
      0
    );

    if (
      attendancePaidItems.length &&
      !reportResult.error &&
      Math.abs(
        paidAttendanceTotal - paidTotalFromSummary
      ) < 0.01 &&
      Math.abs(
        paidPaymentsTotal - paidTotalFromSummary
      ) >= 0.01
    ) {
      paidItems = attendancePaidItems;
    } else if (
      !paidItems.length &&
      attendancePaidItems.length
    ) {
      paidItems = attendancePaidItems;
    }

    if (
      paymentsResult.error &&
      attendanceDetailsFailed
    ) {
      $("dailyPaidStudentsCount").textContent = "—";
      $("dailyPaidDetails").innerHTML =
        '<div class="daily-report-empty daily-report-error">تعذر تحميل تفاصيل التحصيل الآن</div>';
    } else {
      $("dailyPaidStudentsCount").textContent =
        `${paidItems.length} عملية`;

      renderDailyAmountDetails(
        "dailyPaidDetails",
        paidItems,
        "لا توجد عمليات تحصيل مسجلة اليوم"
      );
    }

    const deferredItems = attendanceRows
      .filter(row => row.payment_status === "due")
      .map(row => {
        const student =
          dailyReportStudentById(row.student_id);
        const session =
          sessionById.get(String(row.session_id));
        const sessionGroup =
          dailyReportGroupByDatabaseId(
            session?.group_id
          );
        const groupInfo =
          dailyReportItemGroup(
            student,
            sessionGroup
          );
        const dueAmount = Math.max(
          Number(row.charge_amount || 0) -
            Number(row.paid_amount || 0),
          0
        );

        return {
          studentName: student?.name || "طالب غير ظاهر",
          amount: dueAmount,
          ...groupInfo
        };
      })
      .filter(item => item.amount > 0);

    if (attendanceDetailsFailed) {
      $("dailyDeferredStudentsCount").textContent = "—";
      $("dailyDeferredDetails").innerHTML =
        '<div class="daily-report-empty daily-report-error">تعذر تحميل تفاصيل الآجل الآن</div>';
    } else {
      $("dailyDeferredStudentsCount").textContent =
        `${deferredItems.length} طالب`;

      renderDailyAmountDetails(
        "dailyDeferredDetails",
        deferredItems,
        "لا يوجد آجل مسجل اليوم"
      );
    }

  } catch (error) {
    console.error(
      "Daily payment details error:",
      error
    );

    [
      "dailyPaidDetails",
      "dailyDeferredDetails",
      "dailyFreeStudents"
    ].forEach(targetId => {
      const target = $(targetId);

      if (target) {
        target.innerHTML =
          '<div class="daily-report-empty daily-report-error">تعذر تحميل التفاصيل الآن</div>';
      }
    });
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

function selectedPointReasonMeta() {
  const reasonSelect = $("pointsReason");
  const selectedValue = String(reasonSelect?.value || "");
  const reasonText =
    reasonSelect?.options[reasonSelect.selectedIndex]?.text ||
    "نقاط";

  const reasonTypeByValue = {
    "3": "attendance",
    "-10": "absence",
    "-2": "very_late",
    "5": "homework",
    participation: "participation",
    exam: "exam"
  };

  return {
    reasonType: reasonTypeByValue[selectedValue] || "manual",
    reasonText
  };
}

async function applyPoints() {
  const studentId = $("pointsStudent")?.value || "";
  const student = students.find(
    item => String(item.id) === String(studentId)
  );

  if (!student) {
    showToast("اختر الطالب أولًا");
    return;
  }

  const manualInput = $("manualPointsValue");
  const manualText = String(manualInput?.value ?? "").trim();
  const value = manualText !== ""
    ? Number(manualText)
    : pointsValue();

  if (!Number.isFinite(value) || value === 0) {
    showToast("أدخل عدد نقاط صحيح، موجبًا أو سالبًا");
    return;
  }

  const { reasonType, reasonText } =
    selectedPointReasonMeta();

  const applyButton = $("applyPointsBtn");
  if (applyButton) applyButton.disabled = true;

  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc(
      "add_points_only",
      {
        p_student_id: student.id,
        p_points: value,
        p_reason_type: reasonType,
        p_reason_text: reasonText
      }
    );

    if (error) throw error;

    if (data?.ok === false) {
      showToast(data?.message || "تعذر تحديث النقاط");
      return;
    }

    await loadStudentsFromSupabase();
    renderAll();

    if ($("pointsStudent")) {
      $("pointsStudent").value = student.id;
    }

    if (manualInput) manualInput.value = "";

    showToast(
      `${value > 0 ? "تمت إضافة" : "تم خصم"} ${Math.abs(value)} نقطة — السبب: ${reasonText}`
    );
  } catch (error) {
    console.error("Apply points error:", error);
    showToast(error?.message || "تعذر تحديث النقاط");
  } finally {
    if (applyButton) applyButton.disabled = false;
  }
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
    primary_foundation_a: "تأسيس A",
    primary_foundation_b: "تأسيس B",
    primary_foundation_c: "تأسيس C",
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
      ["primary_foundation_a", "تأسيس A"],
      ["primary_foundation_b", "تأسيس B"],
      ["primary_foundation_c", "تأسيس C"],
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
  const title = dialog?.querySelector("h3");
  const confirmButton = $("confirmQuickScheduleBtn");

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

  dialog.dataset.mode = "add";
  dialog.dataset.scheduleId = "";
  dialog.dataset.day = day;
  dialog.dataset.minutes = String(currentMinutes);

  if (title) {
    title.textContent = "اختيار المجموعة";
  }

  if (confirmButton) {
    confirmButton.textContent = "حفظ الموعد";
  }

  if (slotText) {
    slotText.textContent =
      `${day} — ${scheduleMinutesToLabel(currentMinutes)}`;
  }

  dialog.showModal();
}

function openQuickScheduleEditDialog(scheduleId) {
  const schedule = groupSchedules.find(
    item => String(item.id) === String(scheduleId)
  );

  if (!schedule) {
    showToast("تعذر العثور على الموعد");
    return;
  }

  const dialog = $("quickScheduleDialog");
  const quickGroupSelect = $("quickScheduleGroupSelect");
  const originalGroupSelect = $("scheduleGroupSelect");
  const slotText = $("quickScheduleSlotText");
  const title = dialog?.querySelector("h3");
  const confirmButton = $("confirmQuickScheduleBtn");

  if (
    !dialog ||
    !quickGroupSelect ||
    !originalGroupSelect
  ) {
    showToast("تعذر فتح تعديل الموعد");
    return;
  }

  quickGroupSelect.innerHTML =
    originalGroupSelect.innerHTML;

  quickGroupSelect.value = schedule.group_id;

  dialog.dataset.mode = "edit";
  dialog.dataset.scheduleId = schedule.id;

  if (title) {
    title.textContent = "تعديل المجموعة";
  }

  if (confirmButton) {
    confirmButton.textContent = "حفظ التعديل";
  }

  if (slotText) {
    slotText.textContent =
      `${schedule.day_name} — ${scheduleFormatTime(schedule.start_time)}`;
  }

  dialog.showModal();
}

async function saveQuickSchedule() {
  const dialog = $("quickScheduleDialog");
  const quickGroupSelect = $("quickScheduleGroupSelect");

  if (!dialog || !quickGroupSelect) return;

  const groupId = quickGroupSelect.value;
  const mode = dialog.dataset.mode || "add";

  if (!groupId) {
    showToast("اختر المجموعة");
    return;
  }

  if (mode === "edit") {
    const scheduleId = dialog.dataset.scheduleId || "";

    if (!scheduleId) {
      showToast("تعذر تحديد الموعد");
      return;
    }

    try {
      const supabase = await getSupabase();

      const { error } = await supabase
        .from("group_schedules")
        .update({
          group_id: groupId
        })
        .eq("id", scheduleId);

      if (error) {
        throw error;
      }

      await loadScheduleDataFromSupabase();
      renderSchedule();

      dialog.close();
      showToast("تم تعديل المجموعة بنجاح");
    } catch (error) {
      console.error(
        "Quick schedule edit error:",
        error
      );

      if (error?.code === "23505") {
        showToast("هذا الموعد مسجل بالفعل لنفس المجموعة");
        return;
      }

      showToast(
        error?.message || "تعذر تعديل المجموعة"
      );
    }

    return;
  }

  const day = dialog.dataset.day || "";
  const totalMinutes = Number(dialog.dataset.minutes);

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

  const currentDayName = dayName();
  const currentDayIndex =
    visibleDays.indexOf(currentDayName);

  const mobileDays =
    !selectedDay && currentDayIndex > 0
      ? [
          ...visibleDays.slice(currentDayIndex),
          ...visibleDays.slice(0, currentDayIndex)
        ]
      : visibleDays;

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

  const schedulesForSlot = (day, currentMinutes) =>
    scheduleItems.filter(item => {
      if (item.day_name !== day) return false;

      return (
        scheduleTimeToMinutes(item.start_time) ===
        currentMinutes
      );
    });

  const sessionMarkup = item => `
    <div class="schedule-grid-session">
      <strong>${scheduleEscapeHtml(
        item.group?.name || ""
      )}</strong>
      <button
        type="button"
        class="schedule-grid-edit-btn"
        data-schedule-id="${scheduleEscapeHtml(item.id)}"
      >
        تعديل
      </button>
    </div>
  `;

  const header = `
    <thead>
      <tr>
        <th class="schedule-time-column">الوقت</th>
        ${visibleDays
          .map(
            day =>
              `<th>${scheduleEscapeHtml(day)}</th>`
          )
          .join("")}
      </tr>
    </thead>
  `;

  const body = timeRows
    .map(currentMinutes => {
      const cells = visibleDays
        .map(day => {
          const matchingSchedules =
            schedulesForSlot(
              day,
              currentMinutes
            );

          if (!matchingSchedules.length) {
            return `
              <td
                class="schedule-slot schedule-slot-free"
                data-day="${scheduleEscapeHtml(day)}"
                data-minutes="${currentMinutes}"
              >
                <span>متاح</span>
              </td>
            `;
          }

          return `
            <td class="schedule-slot schedule-slot-busy">
              ${matchingSchedules
                .map(sessionMarkup)
                .join("")}
            </td>
          `;
        })
        .join("");

      return `
        <tr>
          <th class="schedule-time-column">
            ${scheduleMinutesToLabel(
              currentMinutes
            )}
          </th>
          ${cells}
        </tr>
      `;
    })
    .join("");

  const mobileSchedule = mobileDays
    .map((day, dayIndex) => {
      const dayScheduleCount = scheduleItems.filter(
        item => item.day_name === day
      ).length;
      const isCurrentDay = day === currentDayName;
      const shouldOpen =
        selectedDay ||
        isCurrentDay ||
        (
          currentDayIndex === -1 &&
          dayIndex === 0
        );

      const slots = timeRows
        .map(currentMinutes => {
          const matchingSchedules =
            schedulesForSlot(
              day,
              currentMinutes
            );
          const timeLabel =
            scheduleMinutesToLabel(
              currentMinutes
            );

          if (!matchingSchedules.length) {
            return `
              <div
                class="schedule-mobile-slot schedule-slot-free"
                data-day="${scheduleEscapeHtml(day)}"
                data-minutes="${currentMinutes}"
              >
                <strong class="schedule-mobile-time">
                  ${timeLabel}
                </strong>
                <span class="schedule-mobile-available">
                  متاح
                </span>
              </div>
            `;
          }

          return `
            <div class="schedule-mobile-slot schedule-mobile-slot-busy">
              <strong class="schedule-mobile-time">
                ${timeLabel}
              </strong>
              <div class="schedule-mobile-sessions">
                ${matchingSchedules
                  .map(sessionMarkup)
                  .join("")}
              </div>
            </div>
          `;
        })
        .join("");

      return `
        <details
          class="schedule-mobile-day"
          ${shouldOpen ? "open" : ""}
        >
          <summary>
            <span class="schedule-mobile-day-name">
              ${scheduleEscapeHtml(day)}
              ${isCurrentDay
                ? '<small>اليوم</small>'
                : ""}
            </span>
            <strong>
              ${dayScheduleCount
                ? `${dayScheduleCount} موعد`
                : "لا توجد مواعيد"}
            </strong>
          </summary>

          <div class="schedule-mobile-slots">
            ${slots}
          </div>
        </details>
      `;
    })
    .join("");

  grid.innerHTML = `
    <div class="schedule-desktop-week">
      <div class="table-wrap schedule-week-table-wrap">
        <table class="schedule-week-table">
          ${header}
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>

    <div class="schedule-mobile-week">
      ${mobileSchedule}
    </div>
  `;

  const isScheduleReadonly =
    $("schedule")?.classList.contains(
      "schedule-readonly"
    );

  grid
    .querySelectorAll(".schedule-grid-edit-btn")
    .forEach(button => {
      if (isScheduleReadonly) {
        button.remove();
        return;
      }

      button.onclick = event => {
        event.stopPropagation();
        openQuickScheduleEditDialog(
          button.dataset.scheduleId
        );
      };
    });

  grid
    .querySelectorAll(".schedule-slot-free")
    .forEach(cell => {
      if (isScheduleReadonly) {
        cell.onclick = null;

        if (cell.classList.contains(
          "schedule-mobile-slot"
        )) {
          cell.removeAttribute("role");
          cell.removeAttribute("tabindex");
        }

        return;
      }

      if (cell.classList.contains(
        "schedule-mobile-slot"
      )) {
        cell.setAttribute("role", "button");
        cell.setAttribute("tabindex", "0");
      }

      const openSlot = () => {
        openQuickScheduleDialog(
          cell.dataset.day,
          Number(cell.dataset.minutes)
        );
      };

      cell.onclick = openSlot;

      cell.onkeydown = event => {
        if (
          event.key === "Enter" ||
          event.key === " "
        ) {
          event.preventDefault();
          openSlot();
        }
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
async function changePassword() {
  const currentPassword = $("currentPassword").value;
  const newPassword = $("newPassword").value;
  const confirmNewPassword = $("confirmNewPassword").value;

  if (!currentPassword || !newPassword || !confirmNewPassword) {
    showToast("من فضلك أكمل جميع خانات كلمة المرور");
    return;
  }

  if (newPassword !== confirmNewPassword) {
    showToast("كلمة المرور الجديدة وتأكيدها غير متطابقين");
    return;
  }

  if (currentPassword === newPassword) {
    showToast("كلمة المرور الجديدة يجب أن تكون مختلفة عن الحالية");
    return;
  }

  try {
    const supabase = await getSupabase();

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) throw userError || new Error("لا يوجد مستخدم مسجل");

    const user = userData.user;

    const credentials = user.email
      ? { email: user.email, password: currentPassword }
      : { phone: user.phone, password: currentPassword };

    const { error: verifyError } = await supabase.auth.signInWithPassword(credentials);

    if (verifyError) {
      showToast("كلمة المرور الحالية غير صحيحة");
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (updateError) throw updateError;

    $("currentPassword").value = "";
    $("newPassword").value = "";
    $("confirmNewPassword").value = "";

    showToast("تم تغيير كلمة المرور بنجاح");
  } catch (error) {
    console.error("Change password error:", error);
    showToast("تعذر تغيير كلمة المرور");
  }
}
async function adminResetPassword() {
  let phone = $("resetPasswordPhone")?.value.trim().replace(/\D/g, "") || "";
  const newPassword = $("resetPasswordNew")?.value || "";
  const confirmPassword = $("resetPasswordConfirm")?.value || "";

  if (phone.startsWith("20") && phone.length === 12) {
    phone = "0" + phone.slice(2);
  }

  if (!/^01[0125]\d{8}$/.test(phone)) {
    showToast("اكتب رقم هاتف مصري صحيح");
    return;
  }

  if (newPassword.length < 6) {
    showToast("كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف");
    return;
  }

  if (newPassword !== confirmPassword) {
    showToast("كلمة المرور الجديدة وتأكيدها غير متطابقين");
    return;
  }

  const button = $("adminResetPasswordBtn");

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "جاري إعادة التعيين...";
    }

    const supabase = await getSupabase();

    const { data, error } = await supabase.functions.invoke(
      "admin-password-reset",
      {
        body: {
          phone,
          new_password: newPassword
        }
      }
    );

    if (error) {
  let errorBody = null;

  try {
    errorBody = await error.context?.json();
  } catch {}

  if (errorBody?.error === "User not found") {
    showToast("لم يتم العثور على حساب بهذا الرقم");
    return;
  }

  if (errorBody?.error === "Owner only") {
    showToast("إعادة تعيين كلمة المرور متاحة للمالك فقط");
    return;
  }

  if (errorBody?.error === "Unauthorized") {
    showToast("انتهت الجلسة، سجل الدخول مرة أخرى");
    return;
  }

  throw error;
}

    if (!data?.ok) {
      if (data?.error === "User not found") {
        showToast("لم يتم العثور على حساب بهذا الرقم");
        return;
      }

      if (data?.error === "Owner only") {
        showToast("إعادة تعيين كلمة المرور متاحة للمالك فقط");
        return;
      }

      throw new Error(data?.error || "Password reset failed");
    }

    $("resetPasswordPhone").value = "";
    $("resetPasswordNew").value = "";
    $("resetPasswordConfirm").value = "";

    showToast("تم إعادة تعيين كلمة المرور بنجاح");
  } catch (error) {
    console.error("Admin reset password error:", error);
    showToast("تعذر إعادة تعيين كلمة المرور");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "إعادة تعيين كلمة المرور";
    }
  }
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
  
.eq("id", groupById(groupCode)?.dbId);
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
    .select("id, day_name, start_time")
    .eq("group_id", group.dbId)
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
          <strong>${dayNames[schedule.day_name] || schedule.day_name}</strong>
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
$("saveAttendanceBtn").addEventListener("click",saveAttendance);
$("walaaSessionAccessBtn")?.addEventListener("click", toggleWalaaSessionAccess);
$("sendHomeworkBtn")?.addEventListener("click", sendHomework);
$("homeworkGrade")?.addEventListener("change", loadHomeworkAdmin);
$("homeworkCameraInput")?.addEventListener("change", event => {
  addHomeworkFiles(event.target.files);
  event.target.value = "";
});
$("homeworkFileInput")?.addEventListener("change", event => {
  addHomeworkFiles(event.target.files);
  event.target.value = "";
});
$("studentSearch").addEventListener("input",e=>renderStudents(e.target.value));
$("studentGroupFilter").addEventListener("change", renderStudents);
$("addStudentBtn").addEventListener("click",()=>$("studentDialog").showModal());
$("addStudentFromAttendanceBtn").addEventListener("click", () => $("studentDialog").showModal());
$("saveStudentBtn").addEventListener("click",e=>{e.preventDefault();addStudent();});
$("studentEditForm")?.addEventListener("submit", event => {
  event.preventDefault();
  saveStudentEdits();
});
$("editStudentGrade")?.addEventListener("change", () => {
  populateEditStudentGroupOptions();
});
$("studentEditCancelBtn")?.addEventListener(
  "click",
  closeStudentEditDialog
);
$("registerPaymentBtn").addEventListener("click",registerPayment);
$("paymentStudent")?.addEventListener("change", loadSelectedStudentDue);
$("attendancePaymentGrade")?.addEventListener("change", () => {
  filterAttendancePaymentStudents();
  loadAttendanceStudentDue();
});
$("attendancePaymentStudent")?.addEventListener("change", loadAttendanceStudentDue);
$("attendanceRegisterPaymentBtn")?.addEventListener("click", registerAttendancePayment);
$("attendanceArrearsForm")?.addEventListener("submit", event => {
  event.preventDefault();
  registerAttendanceRowArrearsPayment();
});
$("attendanceArrearsCancelBtn")?.addEventListener(
  "click",
  closeAttendanceArrearsDialog
);
$("pointsReason").addEventListener("change",togglePointsFields);
$("applyPointsBtn").addEventListener("click",applyPoints);
$("parentStudent").addEventListener("change",renderParent);
$("parentChildSelect")?.addEventListener("change", (e) => {
  parentScheduleSessionVersion += 1;
  renderParentChild(e.target.value);
});
$("saveSettingsBtn").addEventListener("click",saveSettings);
$("changePasswordBtn")?.addEventListener("click", changePassword);
$("adminResetPasswordBtn")?.addEventListener("click", adminResetPassword);
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
$("sessionDate")?.addEventListener("change", loadAttendance);
if ($("homeworkDate")) $("homeworkDate").value = localDateISO();
renderHomeworkSelectedFiles();
loadAttendance();
togglePointsFields();
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js").catch(()=>{}));}

checkSession();
