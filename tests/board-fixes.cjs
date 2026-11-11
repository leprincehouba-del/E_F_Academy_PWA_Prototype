const fs = require("node:fs");
const assert = require("node:assert/strict");
const acorn = require("acorn");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("index.html", "utf8");
const readerSource = fs.readFileSync("teacher-reader.js", "utf8");
const appSource = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("styles.css", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261111000100_aggregate_session_points_by_reason.sql", "utf8");

const dom = new JSDOM(html);
const document = dom.window.document;
[...document.querySelectorAll("#pointsGradeFilter option")]
  .find(option => option.value === "kg") || assert.fail("points grade filter must include KG");
["teacherReaderPageNumber", "teacherReaderPageTotal", "teacherReaderGoPage",
 "teacherReaderScreenPageNumber", "teacherReaderScreenPageTotal", "teacherReaderScreenGoPage"]
  .forEach(id => assert.ok(document.getElementById(id), `missing #${id}`));
assert.match(readerSource, /function goToPage[\s\S]*scrollTo\([\s\S]*behavior/, "go-to-page must scroll without changing viewer mode");
assert.match(readerSource, /entry\.isIntersecting[\s\S]*queuePdfPage\(info/, "every intersecting page must render immediately");
assert.match(css, /scroll-snap-type:\s*none/, "continuous reader must not snap page by page");
assert.match(css, /\.teacher-reader-students[\s\S]*overflow-y:\s*auto[\s\S]*touch-action:\s*pan-y/, "large student rails must scroll by touch");
assert.match(css, /\.teacher-reader-student-add/, "add-points target must remain visible");
assert.match(css, /body\.screen-board-account \.teacher-reader-screen-page-jump\s*\{\s*display:\s*inline-flex/, "screen account must expose direct page navigation");

const readerAst = acorn.parse(readerSource, { ecmaVersion: "latest", sourceType: "script" });
const readerBody = readerAst.body[0].expression.callee.body.body;
const readerFunction = name => {
  const node = readerBody.find(item => item.type === "FunctionDeclaration" && item.id?.name === name);
  assert.ok(node, `missing reader function ${name}`);
  return readerSource.slice(node.start, node.end);
};

const jumpResult = vm.runInNewContext(`
  const state = { currentPage: 1, pdfDocument: { numPages: 7 }, pages: new Map() };
  for (let i = 1; i <= 7; i++) state.pages.set(i, { number: i, wrap: { offsetTop: i * 100 } });
  const input = { value: "1", max: "", }; const totalText = { textContent: "" };
  const viewport = { scrollLeft: 23, calls: [], scrollTo(options) { this.calls.push(options); } };
  const document = { activeElement: null };
  const el = id => ({ teacherReaderPageNumber: input, teacherReaderPageTotal: totalText, teacherReaderViewport: viewport })[id];
  const ensureStrokes = info => info.prepared = true;
  const queuePageNeighborhood = page => state.queued = page;
  const messages = []; const showToast = message => messages.push(message);
  ${readerFunction("updatePageIndicator")}
  ${readerFunction("goToPage")}
  const valid = goToPage("6");
  const invalid = goToPage("9");
  ({ valid, invalid, currentPage: state.currentPage, total: totalText.textContent, max: input.max, queued: state.queued, calls: viewport.calls, messages });
`);
assert.deepEqual(JSON.parse(JSON.stringify(jumpResult)), {
  valid: true, invalid: false, currentPage: 6, total: "7", max: "7", queued: 6,
  calls: [{ top: 590, left: 23, behavior: "smooth" }], messages: ["اكتب رقم صفحة من 1 إلى 7"]
});

const retryResult = vm.runInNewContext(`
  const info = { number: 2, visibleRatio: 1, renderFailures: 0, retryTimer: 0 };
  const state = { pages: new Map([[2, info]]), zoom: 1, isDrawing: false, currentPage: 1 };
  const calls = [];
  const queuePdfPage = (page, priority, force) => calls.push({ number: page.number, priority, force });
  const clearTimeout = () => {};
  const setTimeout = callback => { callback(); return 1; };
  ${readerFunction("schedulePageRetry")}
  schedulePageRetry(info, 1);
  ({ failures: info.renderFailures, calls });
`);
assert.deepEqual(JSON.parse(JSON.stringify(retryResult)), {
  failures: 1,
  calls: [{ number: 2, priority: 0, force: true }]
}, "a transient visible-page failure must automatically requeue that page");

const appAst = acorn.parse(appSource, { ecmaVersion: "latest", sourceType: "script" });
const appFunction = name => {
  const node = appAst.body.find(item => item.type === "FunctionDeclaration" && item.id?.name === name);
  assert.ok(node, `missing app function ${name}`);
  return appSource.slice(node.start, node.end);
};
const kgFilterResult = vm.runInNewContext(`
  const groups = [{ id: "kg-group", grade: "kg" }];
  const groupById = id => groups.find(group => group.id === id);
  ${appFunction("pointsStudentGradeKey")}
  [
    pointsStudentGradeKey({ group: "kg-group" }),
    pointsStudentGradeKey({ group: "kg-legacy" })
  ];
`);
assert.deepEqual(JSON.parse(JSON.stringify(kgFilterResult)), ["kg", "kg"]);
const aggregateResult = vm.runInNewContext(`
  ${appFunction("canonicalPendingPointReason")}
  ${appFunction("aggregatePendingPointRows")}
  const rows = [
    {id:"p1",student_id:"s1",points:1,reason_key:"teacher_board_a",reason_text:"المشاركة",status:"pending"},
    {id:"p2",student_id:"s1",points:1,reason_key:"teacher_board_b",reason_text:"المشاركة",status:"pending"},
    {id:"p3",student_id:"s1",points:-1,reason_key:"teacher_board_c",reason_text:"تراجع عن: المشاركة",status:"pending"},
    {id:"h1",student_id:"s1",points:1,reason_key:"teacher_board_d",reason_text:"الواجب",status:"pending"},
    {id:"h2",student_id:"s1",points:1,reason_key:"teacher_board_e",reason_text:"الواجب",status:"pending"},
    {id:"s2",student_id:"s2",points:1,reason_key:"teacher_board_f",reason_text:"المشاركة",status:"approved"},
    {id:"manual",student_id:"s1",points:4,reason_key:"manual",reason_text:"مراجعة",status:"pending"}
  ];
  const output = aggregatePendingPointRows(rows);
  ({ sourceCount: rows.length, output: output.map(x => ({student:x.student_id, points:x.points, reason:x.reason_text, count:x.record_count || 1, aggregated:!!x.aggregated, id:x.id})) });
`);
assert.equal(aggregateResult.sourceCount, 7, "source point records must remain intact");
assert.deepEqual(
  JSON.parse(JSON.stringify(aggregateResult.output.map(({student, points, reason, count, aggregated}) => ({student, points, reason, count, aggregated})))),
  [
    {student:"s1",points:1,reason:"المشاركة",count:3,aggregated:true},
    {student:"s1",points:2,reason:"الواجب",count:2,aggregated:true},
    {student:"s2",points:1,reason:"المشاركة",count:1,aggregated:true},
    {student:"s1",points:4,reason:"مراجعة",count:1,aggregated:false}
  ]
);

const reviewPlanResult = vm.runInNewContext(`
  ${appFunction("pendingPointReviewPlan")}
  ({
    unchanged: pendingPointReviewPlan([
      {id:"p1",points:1,status:"pending"},
      {id:"p2",points:1,status:"pending"}
    ], 2),
    corrected: pendingPointReviewPlan([
      {id:"p1",points:1,status:"pending"},
      {id:"p2",points:1,status:"pending"}
    ], 3),
    mixed: pendingPointReviewPlan([
      {id:"p1",points:1,status:"approved"},
      {id:"p2",points:1,status:"pending"}
    ], 2)
  });
`);
assert.deepEqual(JSON.parse(JSON.stringify(reviewPlanResult)), {
  unchanged: [
    {id:"p1",action:"approve",points:1},
    {id:"p2",action:"approve",points:1}
  ],
  corrected: [
    {id:"p1",action:"approve",points:2},
    {id:"p2",action:"approve",points:1}
  ],
  mixed: [{id:"p2",action:"approve",points:1}]
});

const rosterResult = vm.runInNewContext(`
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM('<aside id="teacherReaderStudentsLeft"></aside><aside id="teacherReaderStudentsRight"></aside>');
  const document = dom.window.document;
  const el = id => document.getElementById(id);
  const studentsForGroup = () => Array.from({length:101}, (_,i) => ({id:"student-"+i,name:"طالب "+i}));
  const pointCount = () => 0; const safe = value => String(value); const pointStatus = () => {};
  const addPoint = () => {};
  ${readerFunction("renderStudents")}
  renderStudents();
  ({ total: document.querySelectorAll('[data-reader-student]').length,
     left: el('teacherReaderStudentsLeft').children.length,
     right: el('teacherReaderStudentsRight').children.length,
     addTargets: document.querySelectorAll('.teacher-reader-student-add').length });
`, { require });
assert.deepEqual(JSON.parse(JSON.stringify(rosterResult)), { total:101, left:51, right:50, addTargets:101 });

assert.match(migration, /GROUP BY[\s\S]*reason_type[\s\S]*regexp_replace/i, "session summary must group by reason");
assert.match(migration, /INSERT INTO public\.point_transactions[\s\S]*SELECT p\.student_id, p\.points/, "individual audit transactions must be preserved");
assert.match(migration, /HAVING sum\(p\.points\) <> 0/, "undone reasons must not create zero-value parent details");

console.log("PASS: continuous PDF scrolling, direct page jump, 101-student touch roster, point-reason aggregation and individual audit preservation.");
