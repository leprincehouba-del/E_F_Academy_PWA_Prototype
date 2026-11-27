const fs = require("node:fs");
const assert = require("node:assert/strict");
const { JSDOM, VirtualConsole } = require("jsdom");

const markup = fs.readFileSync("index.html", "utf8");
const source = fs.readFileSync("app.js", "utf8");
const attendancePermissions = { attendance_view: true, attendance_edit: true, schedule_view: true };
const pointsPermissions = { points_view: true, points_edit: true, schedule_view: true };
const staffDenied = ["dashboard", "payments", "settings", "teacherReader", "parent"];
const tick = () => new Promise(resolve => setImmediate(resolve));

async function openApp({ role = "manager", permissionReply, restore = true, savedPage = "payments" }) {
  const dom = new JSDOM(markup, {
    url: "https://app.test.invalid/", runScripts: "outside-only", pretendToBeVisual: true,
    virtualConsole: new VirtualConsole()
  });
  const { window } = dom;
  window.scrollTo = () => {};
  window.fetch = () => assert.fail("test cannot make live requests");
  const user = { id: "test-user" };
  const calls = [];
  const resultFor = table => {
    if (table === "user_profiles") return { data: { role, is_active: true, full_name: "Test Account" } };
    if (table === "manager_permissions") return permissionReply;
    if (table === "payments") return { data: [{
      student_id: "test-student", amount: 25, paid_at: "2026-11-27T08:00:00Z", payment_method: "cash"
    }] };
    return { data: [] };
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: restore ? { user } : null } }),
      signInWithPassword: async () => ({ data: { user } }),
      signOut: async () => ({ error: null })
    },
    from(table) {
      calls.push(table);
      const query = new Proxy({}, { get: (_target, property) =>
        property === "then" ? (resolve, reject) => Promise.resolve(resultFor(table)).then(resolve, reject) : () => query
      });
      return query;
    },
    rpc: async name => { calls.push(name); return { data: [] }; }
  };
  window.supabase = { createClient: () => client };
  window.localStorage.setItem("ef_payments", JSON.stringify([{ studentId: "old-owner", amount: 98765 }]));
  window.localStorage.setItem("ef_workspace:1:test-user:" + role, JSON.stringify({ version: 1, activePage: savedPage }));
  window.eval(source);
  const el = id => window.document.getElementById(id);
  if (!restore) {
    await tick();
    el("loginPhone").value = "employee@example.test";
    el("loginPassword").value = "synthetic";
    el("loginBtn").click();
  }
  return {
    window, el, calls, close: () => window.close(),
    page: () => window.document.querySelector("#appShell .page.active-page")?.id,
    hidden: () => el("appShell").classList.contains("hidden")
  };
}

async function waitFor(test, message) {
  for (let i = 0; i < 70; i++) {
    if (test()) return;
    await tick();
  }
  assert.fail(message);
}

(async () => {
  let permit;
  const permissions = new Promise(resolve => { permit = resolve; });
  const staff = await openApp({ permissionReply: permissions, restore: false });
  await waitFor(() => staff.calls.includes("manager_permissions"), "permission request never started");
  assert.equal(staff.hidden(), true);
  assert.equal(staff.page(), undefined);
  assert.equal(staff.window.localStorage.getItem("ef_payments"), null);
  staff.window.navigate("payments");
  assert.equal(staff.page(), undefined);
  assert.ok(!staff.calls.includes("payments"));
  permit({ data: { permissions: attendancePermissions } });
  await waitFor(() => !staff.hidden(), "attendance staff never became ready");
  assert.equal(staff.page(), "attendance");
  for (const page of staffDenied) {
    const nav = staff.window.document.querySelector(`#navMenu [data-page="${page}"]`);
    assert.equal(nav.hidden, true);
    nav.click();
    staff.window.navigate(page);
    assert.equal(staff.page(), "attendance");
  }
  assert.equal(staff.el("paymentLog").textContent, "");
  assert.ok(!staff.calls.includes("get_owner_daily_payment_report_v2"));
  staff.close();

  const denied = await openApp({ permissionReply: { data: null, error: new Error("network") } });
  await waitFor(() => denied.calls.includes("manager_permissions"), "restore never checked staff permissions");
  await tick();
  assert.equal(denied.hidden(), true);
  assert.equal(denied.el("loginScreen").classList.contains("hidden"), false);
  denied.window.navigate("dashboard");
  assert.equal(denied.page(), undefined);
  denied.close();

  const points = await openApp({ permissionReply: { data: { permissions: pointsPermissions } } });
  await waitFor(() => !points.hidden(), "Walaa workspace never became ready");
  assert.equal(points.page(), "points");
  points.window.navigate("attendance");
  assert.equal(points.page(), "points");
  assert.ok(points.el("managerPointsWorkspace"));
  points.close();

  const owner = await openApp({ role: "owner" });
  await waitFor(() => owner.el("paymentLog").textContent.includes("25"), "owner receipts did not load from the server");
  assert.equal(owner.page(), "payments");
  assert.ok(owner.calls.includes("get_owner_daily_payment_report_v2"));
  assert.ok(!owner.el("paymentLog").textContent.includes("98765"));
  await owner.window.logout();
  assert.equal(owner.el("paymentLog").textContent, "");
  assert.equal(owner.hidden(), true);
  owner.close();
  console.log("PASS: failed or slow permission loading, stale admin navigation, shared receipt cache, staff attendance and Walaa points, owner reports and logout.");
})().catch(error => { console.error(error); process.exit(1); });
