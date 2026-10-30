const fs = require("node:fs");
const assert = require("node:assert/strict");
const acorn = require("acorn");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("index.html", "utf8");
const source = fs.readFileSync("teacher-reader.js", "utf8");
const appSource = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("styles.css", "utf8");
const worker = fs.readFileSync("service-worker.js", "utf8");
const screenMigration = fs.readFileSync("supabase/migrations/20261030002000_screen_board_account.sql", "utf8");

const readerAst = acorn.parse(source, { ecmaVersion: "latest", sourceType: "script" });
acorn.parse(appSource, { ecmaVersion: "latest", sourceType: "script" });
const dom = new JSDOM(html);
const document = dom.window.document;

[
  "teacherReader", "teacherReaderGroup", "teacherReaderDate", "teacherReaderBook",
  "teacherReaderPdfInput", "teacherReaderViewport", "teacherReaderPages",
  "teacherReaderStudentsLeft", "teacherReaderStudentsRight", "teacherReaderStatus",
  "teacherReaderReason", "teacherReaderUndoPoint", "teacherReaderScreenLogout"
].forEach(id => assert.ok(document.getElementById(id), `missing #${id}`));

assert.ok(document.querySelector('#navMenu [data-page="teacherReader"]'), "missing reader navigation");
assert.ok(html.indexOf("app.js") < html.indexOf("teacher-reader.js"), "reader must load after app globals");
assert.match(source, /queue_screen_teacher_board_point_with_reason/, "screen-safe point RPC must remain connected");
assert.match(source, /\["owner", "screen"\]\.includes\(currentAppRole\)/, "owner and isolated screen account must use the reader");
assert.match(source, /undoLastPoint/, "screen reader must support point undo");
assert.match(source, /teacher_board_\$\{String\(event\.id\)/, "point event key must satisfy the database contract");
assert.match(source, /String\(item\.reasonKey \|\| "participation"\) === String\(reasonKey\)/, "student counters must be isolated by the selected reason");
assert.match(source, /teacherReaderReason[\s\S]*addEventListener\("change"[\s\S]*renderStudents\(\)/, "changing reason must refresh every student counter immediately");
assert.match(source, /IntersectionObserver/, "continuous viewer must lazily render nearby pages");
assert.match(source, /getCoalescedEvents/, "pen must consume high-frequency pointer samples");
assert.match(source, /pointerrawupdate/, "supported screens must use the lowest-latency pointer stream");
assert.match(source, /cachedRect/, "pen coordinates must reuse one layout measurement per stroke");
assert.match(source, /renderQueue/, "PDF pages must use a deduplicated render scheduler");
assert.match(source, /queuePageNeighborhood/, "nearby pages must be prepared before navigation");
assert.match(source, /ensureStrokes/, "annotations must load lazily near the visible page");
assert.doesNotMatch(source, /state\.pages\.set\(number, info\);\s*bindInk\(info\);\s*loadStrokes/, "annotations for every page must not load during book opening");
assert.match(source, /pausePdfForInk/, "background PDF work must pause while writing");
assert.match(source, /putAnnotation/, "annotations must persist per book and page");
assert.match(source, /releasePageBitmap/, "off-screen page bitmaps must be released");
assert.doesNotMatch(source, /state\.pages\.set\(number, info\);\s*resizeInk\(info\)/, "all page ink bitmaps must not be allocated up front");
assert.match(source, /eraseStrokePart/, "eraser must split strokes instead of deleting the whole stroke");
assert.match(source, /standardFontDataUrl/, "PDF standard fonts must be available for complete rendering");
assert.match(css, /grid-template-columns:\s*var\(--reader-rail\).*var\(--reader-rail\)/s, "student rails must stay on both sides");
assert.match(css, /body\.screen-board-account \.sidebar[\s\S]*display:\s*none/s, "screen account must hide the administration shell");
assert.match(worker, /teacher-reader\.js/, "service worker must update the reader asset");
assert.match(appSource, /profile\.role === "screen"[\s\S]*openScreenBoard/, "screen login must route straight to the board");
assert.match(appSource, /loadScreenBoardData/, "screen login must load only board data");
assert.match(screenMigration, /01113565398/, "the requested screen account must be promoted explicitly");
assert.match(screenMigration, /role IN \('owner', 'screen'\)/, "screen RPC authorization must remain isolated from parent and manager accounts");
assert.match(screenMigration, /REVOKE ALL ON FUNCTION public\.queue_screen_teacher_board_point_with_reason[\s\S]*FROM anon/, "point RPC must remain unavailable anonymously");

const readerBody = readerAst.body[0].expression.callee.body.body;
const functionSource = name => {
  const node = readerBody.find(item => item.type === "FunctionDeclaration" && item.id?.name === name);
  assert.ok(node, `missing production function ${name}`);
  return source.slice(node.start, node.end);
};
const reasonCounterResult = vm.runInNewContext(`
  const state = { selectedReason: "participation" };
  const reasonControl = { value: "participation" };
  const el = id => id === "teacherReaderReason" ? reasonControl : null;
  const events = [
    { studentId: "student-a", points: 1, reasonKey: "participation" },
    { studentId: "student-a", points: 1 },
    { studentId: "student-a", points: 1, reasonKey: "homework" },
    { studentId: "student-b", points: 1, reasonKey: "participation" }
  ];
  const currentPointEvents = () => events;
  ${functionSource("selectedPointReason")}
  ${functionSource("pointCount")}
  const participationBefore = pointCount("student-a");
  reasonControl.value = "homework";
  const homework = pointCount("student-a");
  reasonControl.value = "quiz";
  const newReason = pointCount("student-a");
  reasonControl.value = "participation";
  const participationAfter = pointCount("student-a");
  ({ participationBefore, homework, newReason, participationAfter, storedEvents: events.length });
`);
assert.deepEqual(
  JSON.parse(JSON.stringify(reasonCounterResult)),
  { participationBefore: 2, homework: 1, newReason: 0, participationAfter: 2, storedEvents: 4 },
  "reason switching must show only the selected reason and must preserve every previous event"
);

console.log("PASS: fresh reader markup, navigation, continuous lazy PDF, fast ink, persistence, student rails and point sync wiring.");
