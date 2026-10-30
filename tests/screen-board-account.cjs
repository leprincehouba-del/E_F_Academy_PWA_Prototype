const fs = require("node:fs");
const assert = require("node:assert/strict");
const { JSDOM, VirtualConsole } = require("jsdom");

const groups = [{
  id: "11111111-1111-1111-1111-111111111111",
  code: "1pr",
  name: "أولى ابتدائي",
  stage: "primary",
  grade: "primary_1",
  is_active: true
}];
const students = [{
  id: "22222222-2222-2222-2222-222222222222",
  full_name: "طالب الشاشة",
  group_id: groups[0].id,
  groups: { code: "1pr" }
}];

function query(table) {
  const result = table === "user_profiles"
    ? { full_name: "حساب الشاشة", role: "screen", is_active: true }
    : table === "groups" ? groups
    : table === "students" ? students
    : [];
  let proxy;
  proxy = new Proxy({}, {
    get(_target, key) {
      if (key === "then") return resolve => resolve({ data: result, error: null });
      return () => proxy;
    }
  });
  return proxy;
}

(async () => {
  const errors = [];
  const consoleOutput = new VirtualConsole();
  consoleOutput.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync("index.html", "utf8"), {
    url: "https://test.invalid/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: consoleOutput
  });
  const window = dom.window;
  window.fetch = () => assert.fail("screen-board test must not use the network");
  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "screen-user" } } }, error: null }),
      signOut: async () => ({ error: null })
    },
    from: query,
    channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe: async () => {} }),
    removeChannel: async () => {},
    rpc: async () => ({ data: [], error: null })
  }) };

  window.eval(fs.readFileSync("app.js", "utf8"));
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));

  try {
    const document = window.document;
    assert.equal(window.currentAppRole, undefined, "top-level let must not leak as a window property");
    assert.equal(document.body.classList.contains("screen-board-account"), true);
    assert.equal(document.getElementById("loginScreen").classList.contains("hidden"), true);
    assert.equal(document.getElementById("appShell").classList.contains("hidden"), false);
    assert.equal(document.getElementById("teacherReader").classList.contains("active-page"), true);
    assert.equal(document.getElementById("dashboard").classList.contains("active-page"), false);
    assert.deepEqual(errors, []);
    console.log("PASS: screen account restores directly into the isolated teacher board with no admin page or network fallback.");
  } finally {
    dom.window.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
