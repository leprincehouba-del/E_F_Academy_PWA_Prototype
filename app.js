const SUPABASE_URL = "sb_publishable_Tk7XuO4BCs9baofK6yjy0Q_LzOKTNVd";
const SUPABASE_KEY = "sb_publishable_Tk7Xu04BCs9baofK6yjy0Q_LzOKTNVd";

let supabaseClient;

async function getSupabase() {
  if (supabaseClient) return supabaseClient;

  const { createClient } = await import(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
  );

  supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  return supabaseClient;
}

const groups = [
  {id:"p1a", name:"أولى ابتدائي A", stage:"primary", days:["الأحد","الأربعاء","الجمعة"], time:"5:00 مساءً", price:15},
  {id:"p2a", name:"ثانية ابتدائي A", stage:"primary", days:["السبت","الاثنين","الخميس"], time:"3:00 مساءً", price:15},
  {id:"p3a", name:"ثالثة ابتدائي A", stage:"primary", days:["السبت","الاثنين","الخميس"], time:"4:00 مساءً", price:15},
  {id:"p4", name:"رابعة ابتدائي", stage:"primary", days:["السبت","الثلاثاء","الخميس"], time:"7:00 مساءً", price:15},
  {id:"p5", name:"خامسة ابتدائي", stage:"primary", days:["الأحد","الثلاثاء","الجمعة"], time:"4:00 مساءً", price:15},
  {id:"p6a", name:"سادسة ابتدائي A", stage:"primary", days:["الأحد","الثلاثاء","الجمعة"], time:"3:00 مساءً", price:15},
  {id:"m1a", name:"أولى إعدادي A", stage:"prep", days:["الأحد","الأربعاء"], time:"2:00 مساءً", price:20},
  {id:"m1b", name:"أولى إعدادي B", stage:"prep", days:["السبت","الثلاثاء"], time:"5:00 مساءً", price:20},
  {id:"m2", name:"ثانية إعدادي", stage:"prep", days:["الاثنين","الخميس"], time:"5:00 مساءً", price:20},
  {id:"m3", name:"ثالثة إعدادي", stage:"prep", days:["السبت","الثلاثاء"], time:"2:00 مساءً", price:20},
  {id:"s1", name:"أولى ثانوي", stage:"secondary", days:["السبت","الثلاثاء"], time:"6:00 مساءً", price:20},
  {id:"s2", name:"ثانية ثانوي", stage:"secondary", days:["الاثنين","الخميس"], time:"2:00 مساءً", price:20},
];

const seedStudents = [
  {id:1,name:"أحمد محمد علي",group:"m1a",school:"النصر الإعدادية",parent:"محمد علي",phone:"201000000001",points:92,dueSessions:2,dueAmount:40,present:8,absent:1,late:1},
  {id:2,name:"سارة محمود حسن",group:"m1a",school:"الشهيد الإعدادية",parent:"محمود حسن",phone:"201000000002",points:118,dueSessions:0,dueAmount:0,present:10,absent:0,late:0},
  {id:3,name:"يوسف أحمد سعيد",group:"p5",school:"الحرية الابتدائية",parent:"أحمد سعيد",phone:"201000000003",points:74,dueSessions:3,dueAmount:45,present:7,absent:2,late:1},
  {id:4,name:"مريم خالد إبراهيم",group:"p5",school:"الزهراء الابتدائية",parent:"خالد إبراهيم",phone:"201000000004",points:132,dueSessions:1,dueAmount:15,present:11,absent:0,late:1},
  {id:5,name:"عمر وائل عبد الله",group:"s1",school:"طه حسين الثانوية",parent:"وائل عبد الله",phone:"201000000005",points:66,dueSessions:2,dueAmount:40,present:6,absent:2,late:0},
  {id:6,name:"جنى سامح فتحي",group:"p2a",school:"الصفوة الابتدائية",parent:"سامح فتحي",phone:"201000000006",points:105,dueSessions:0,dueAmount:0,present:9,absent:0,late:1},
  {id:7,name:"زياد هاني إبراهيم",group:"m2",school:"المستقبل الإعدادية",parent:"هاني إبراهيم",phone:"201000000007",points:81,dueSessions:1,dueAmount:20,present:8,absent:1,late:0},
  {id:8,name:"ملك شريف أحمد",group:"s2",school:"النهضة الثانوية",parent:"شريف أحمد",phone:"201000000008",points:127,dueSessions:0,dueAmount:0,present:10,absent:0,late:0},
];

let students = JSON.parse(localStorage.getItem("ef_students") || "null") || seedStudents;
let payments = JSON.parse(localStorage.getItem("ef_payments") || "[]");
let sessionAttendance = {};
let deferredPrompt = null;

const $ = id => document.getElementById(id);
const stageName = s => ({primary:"ابتدائي",prep:"إعدادي",secondary:"ثانوي"})[s] || s;
const groupById = id => groups.find(g => g.id === id);
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

function setToday(){
  const d = new Date();
  $("todayText").textContent = d.toLocaleDateString("ar-EG",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  $("sessionDate").value = d.toISOString().slice(0,10);
}

async function login() {
  const phone = $("loginPhone").value.trim();
  const password = $("loginPassword").value;

  if (!phone || !password) {
    showToast("أدخل رقم الهاتف وكلمة المرور");
    return;
  }

  try {
    const supabase = await getSupabase();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: phone,
      password
    });

    if (error) throw error;

    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("full_name, role, is_active")
      .eq("id", data.user.id)
      .single();

    if (profileError) throw profileError;

    if (!profile.is_active || profile.role !== "admin") {
      await supabase.auth.signOut();
      showToast("هذا الحساب غير مصرح له بالدخول");
      return;
    }

    $("loginScreen").classList.add("hidden");
    $("appShell").classList.remove("hidden");
    renderAll();
  } catch (error) {
    console.error(error);
  showToast(error.message);
  }
}


async function logout() {
  try {
    const supabase = await getSupabase();
    await supabase.auth.signOut();
  } catch (error) {
    console.error(error);
  }

  $("appShell").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  $("loginPassword").value = "";
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
  renderParent();
}

function dayName(){
  return ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][new Date().getDay()];
}

function renderDashboard(){
  const totalDueSessions = students.reduce((a,s)=>a+s.dueSessions,0);
  const totalPoints = students.reduce((a,s)=>a+s.points,0);
  const presentToday = Object.values(sessionAttendance).filter(x=>x.status==="present").length;
  const collectedToday = payments
    .filter(p=>new Date(p.date).toDateString()===new Date().toDateString())
    .reduce((a,p)=>a+p.amount,0);
  const todaysGroups = groups.filter(g=>g.days.includes(dayName()));
  const todayStudentCount = students.filter(s=>todaysGroups.some(g=>g.id===s.group)).length;

  $("statDueSessions").textContent = totalDueSessions;
  $("statPoints").textContent = totalPoints;
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
  ["groupSelect","newGroup"].forEach(id=>{
    if($(id)) $(id).innerHTML = groupOptions;
  });
  const studentOptions = students.map(s=>`<option value="${s.id}">${s.name} — ${groupById(s.group).name}</option>`).join("");
  ["paymentStudent","pointsStudent","parentStudent"].forEach(id=>{
    const el=$(id); if(el){const old=el.value; el.innerHTML=studentOptions; if(old) el.value=old;}
  });
}

function loadAttendance(){
  const groupId = $("groupSelect").value;
  const group = groupById(groupId);
  $("selectedPrice").innerHTML = `سعر الحصة: <b>${group.price} جنيه</b>`;
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
      <td>
        <select class="payment-status">
          <option value="paid">دفع الآن</option>
          <option value="due">إضافة للحساب</option>
          <option value="free">حصة مجانية</option>
        </select>
      </td>
      <td><span class="badge ${s.dueSessions>=3?"red":""}">${s.dueSessions} / 3</span></td>
      <td><b>${s.points}</b></td>
      <td><button class="whatsapp-btn" onclick="sendWhatsApp(${s.id})">واتساب</button></td>
    </tr>`).join("") : `<tr><td colspan="6">لا يوجد طلاب في هذه المجموعة بعد.</td></tr>`;
}

function saveAttendance(){
  const rows = [...document.querySelectorAll("#attendanceBody tr[data-id]")];
  if(!rows.length){showToast("اختر مجموعة بها طلاب أولًا");return;}
  const override = $("adminOverride").checked;
  const group = groupById($("groupSelect").value);
  let blocked = 0;
  rows.forEach(row=>{
    const s = students.find(x=>x.id===Number(row.dataset.id));
    const status = row.querySelector(".attendance-status").value;
    const payStatus = row.querySelector(".payment-status").value;

    if(status==="present"){
      s.present += 1; s.points += 3;
    }else if(status==="late"){
      s.present += 1; s.late += 1; s.points += 1; // +3 حضور و -2 تأخير
    }else if(status==="absent"){
      s.absent += 1; s.points -= 10;
    }

    if((status==="present"||status==="late") && payStatus==="due"){
      if(s.dueSessions>=3 && !override){blocked += 1;}
      else {s.dueSessions += 1; s.dueAmount += group.price;}
    }
    if((status==="present"||status==="late") && payStatus==="paid"){
      payments.unshift({studentId:s.id,amount:group.price,method:"نقدي",date:new Date().toISOString()});
    }

    sessionAttendance[s.id]={status,payStatus,date:$("sessionDate").value};
  });
  save();
  renderAll();
  loadAttendance();
  showToast(blocked?`تم الحفظ، وتم منع تراكم إضافي لـ ${blocked} طالب`:"تم حفظ الحصة وتحديث الحسابات والنقاط");
}

function renderStudents(filter=""){
  const q=filter.trim().toLowerCase();
  const list=students.filter(s=>`${s.name} ${groupById(s.group).name}`.toLowerCase().includes(q));
  $("studentsGrid").innerHTML=list.map(s=>`
    <article class="student-card">
      <div class="student-card-head">
        <div class="avatar">${s.name.trim()[0]}</div>
        <div><h4>${s.name}</h4><p>${groupById(s.group).name} — ${s.school}</p></div>
      </div>
      <div class="student-metrics">
        <div class="metric"><strong>${s.points}</strong><span>Points</span></div>
        <div class="metric"><strong>${s.dueSessions}</strong><span>حصص متراكمة</span></div>
        <div class="metric"><strong>${s.dueAmount} ج</strong><span>المستحق</span></div>
      </div>
    </article>`).join("");
}

function addStudent(){
  const name=$("newStudentName").value.trim();
  const groupId=$("newGroup").value;
  if(!name){showToast("أدخل اسم الطالب");return false;}
  const nextId=Math.max(0,...students.map(s=>s.id))+1;
  students.push({
    id:nextId,name,group:groupId,school:$("newSchool").value.trim()||"غير محدد",
    parent:$("newParent").value.trim()||"ولي الأمر",
    phone:$("newPhone").value.trim()||"201000000000",
    points:0,dueSessions:0,dueAmount:0,present:0,absent:0,late:0
  });
  save(); renderAll(); showToast("تمت إضافة الطالب بنجاح");
  $("studentDialog").close();
  $("studentForm").reset();
  return true;
}

function registerPayment(){
  const id=Number($("paymentStudent").value);
  const amount=Number($("paymentAmount").value);
  if(!amount||amount<=0){showToast("أدخل مبلغًا صحيحًا");return;}
  const s=students.find(x=>x.id===id);
  const group=groupById(s.group);
  payments.unshift({studentId:id,amount,method:$("paymentMethod").value,date:new Date().toISOString()});
  s.dueAmount=Math.max(0,s.dueAmount-amount);
  s.dueSessions=Math.ceil(s.dueAmount/group.price);
  save(); renderAll(); $("paymentAmount").value="";
  showToast(`تم تسجيل ${amount} جنيه وإعداد إيصال لولي الأمر`);
}

function renderPayments(){
  $("paymentLog").innerHTML=payments.length?payments.slice(0,8).map(p=>{
    const s=students.find(x=>x.id===p.studentId);
    return `<div class="list-item"><div><strong>${s?s.name:"طالب"}</strong><span>${p.method} — ${new Date(p.date).toLocaleString("ar-EG")}</span></div><span class="badge">${p.amount} ج</span></div>`;
  }).join(""):`<div class="list-item"><div><strong>لا توجد مدفوعات بعد</strong><span>سجل أول عملية دفع من النموذج</span></div></div>`;
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

function applyPoints(){
  const s=students.find(x=>x.id===Number($("pointsStudent").value));
  const value=pointsValue();
  s.points=Math.round((s.points+value)*10)/10;
  save(); renderAll();
  showToast(`تم ${value>=0?"إضافة":"خصم"} ${Math.abs(value)} Point للطالب`);
}

function renderLeaderboard(){
  const sorted=[...students].sort((a,b)=>b.points-a.points).slice(0,8);
  $("leaderboard").innerHTML=sorted.map((s,i)=>`
    <div class="list-item">
      <div><strong>${i+1}. ${s.name}</strong><span>${groupById(s.group).name}</span></div>
      <span class="badge gold">${s.points} نقطة</span>
    </div>`).join("");
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

window.addEventListener("beforeinstallprompt",e=>{
  e.preventDefault(); deferredPrompt=e; $("installBtn").classList.remove("hidden");
});
$("installBtn").addEventListener("click",async()=>{
  if(!deferredPrompt)return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $("installBtn").classList.add("hidden");
});

$("loginBtn").addEventListener("click",login);
$("logoutBtn").addEventListener("click",logout);
$("togglePassword").addEventListener("click",()=>{
  const p=$("loginPassword");p.type=p.type==="password"?"text":"password";
});
$("menuBtn").addEventListener("click",()=>document.querySelector(".sidebar").classList.toggle("open"));
document.querySelectorAll("#navMenu button").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
$("loadGroupBtn").addEventListener("click",loadAttendance);
$("groupSelect").addEventListener("change",loadAttendance);
$("saveAttendanceBtn").addEventListener("click",saveAttendance);
$("studentSearch").addEventListener("input",e=>renderStudents(e.target.value));
$("addStudentBtn").addEventListener("click",()=>$("studentDialog").showModal());
$("saveStudentBtn").addEventListener("click",e=>{e.preventDefault();addStudent();});
$("registerPaymentBtn").addEventListener("click",registerPayment);
$("pointsReason").addEventListener("change",togglePointsFields);
$("applyPointsBtn").addEventListener("click",applyPoints);
$("parentStudent").addEventListener("change",renderParent);
$("saveSettingsBtn").addEventListener("click",saveSettings);
$("newStage").addEventListener("change",()=>{
  const stage=$("newStage").value;
  $("newGroup").innerHTML=groups.filter(g=>g.stage===stage).map(g=>`<option value="${g.id}">${g.name}</option>`).join("");
});

setToday();
populateSelects();
loadAttendance();
togglePointsFields();
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js").catch(()=>{}));}
checkSession();
