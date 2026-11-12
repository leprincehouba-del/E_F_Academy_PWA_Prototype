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
const nativeBoard = fs.readFileSync("android-teacher-board/app/src/main/java/com/mrmohamed/teacherboard/NativeScreenBoardActivity.java", "utf8");
const nativeBuild = fs.readFileSync("android-teacher-board/app/build.gradle", "utf8");

const readerAst = acorn.parse(source, { ecmaVersion: "latest", sourceType: "script" });
acorn.parse(appSource, { ecmaVersion: "latest", sourceType: "script" });
const dom = new JSDOM(html);
const document = dom.window.document;

[
  "teacherReader", "teacherReaderGroup", "teacherReaderDate", "teacherReaderBook",
  "teacherReaderPdfInput", "teacherReaderViewport", "teacherReaderPages",
  "teacherReaderStudentsLeft", "teacherReaderStudentsRight", "teacherReaderStatus",
  "teacherReaderReason", "teacherReaderUndoPoint", "teacherReaderScreenLogout",
  "teacherReaderScreenPageNumber", "teacherReaderScreenPageTotal", "teacherReaderScreenGoPage"
].forEach(id => assert.ok(document.getElementById(id), `missing #${id}`));

assert.ok(document.querySelector('#navMenu [data-page="teacherReader"]'), "missing reader navigation");
assert.ok(html.indexOf("app.js") < html.indexOf("teacher-reader.js"), "reader must load after app globals");
assert.match(source, /queue_screen_teacher_board_point_with_reason/, "screen-safe point RPC must remain connected");
assert.match(source, /\["owner", "screen"\]\.includes\(currentAppRole\)/, "owner and isolated screen account must use the reader");
assert.match(source, /undoLastPoint/, "screen reader must support point undo");
assert.match(source, /function removePoint\(studentId, button\)/, "every student must support an explicit point deduction");
assert.match(source, /points:\s*-1[\s\S]*undoOf:\s*latest\.id/, "student point deduction must preserve an auditable reversal record");
assert.match(source, /teacher_board_\$\{String\(event\.id\)/, "point event key must satisfy the database contract");
assert.match(source, /String\(item\.reasonKey \|\| "participation"\) === String\(reasonKey\)/, "student counters must be isolated by the selected reason");
assert.match(source, /teacherReaderReason[\s\S]*addEventListener\("change"[\s\S]*renderStudents\(\)/, "changing reason must refresh every student counter immediately");
assert.match(source, /IntersectionObserver/, "continuous viewer must lazily render nearby pages");
assert.match(source, /getCoalescedEvents/, "pen must consume high-frequency pointer samples");
assert.match(source, /pointerrawupdate/, "supported screens must use the lowest-latency pointer stream");
assert.match(source, /cachedRect/, "pen coordinates must reuse one layout measurement per stroke");
assert.match(source, /renderQueue/, "PDF pages must use a deduplicated render scheduler");
assert.match(source, /queuePageNeighborhood/, "nearby pages must be prepared before navigation");
assert.match(source, /schedulePageRetry/, "failed or cancelled nearby PDF pages must be retried");
assert.match(source, /renderPdfPagePreview/, "current and next PDF pages must receive a fast preview before full-quality rendering");
assert.match(source, /function goToPage\(rawPage, behavior = "auto"\)/, "direct page jumps must not animate through every intermediate page");
assert.match(source, /usesNativeBoardTools\(\)[\s\S]*info\.ink\.width = 1/, "screen account must not allocate an unused full-size ink canvas");
assert.match(source, /state\.bitmapCacheLimit = usesNativeBoardTools\(\) \? 3 : 8/, "Hikvision mode must keep only a small PDF bitmap working set");
assert.match(source, /nativeBoard[\s\S]*info\.renderedZoom = targetZoom/, "Hikvision preview must be its final balanced render instead of a second high-memory pass");
assert.match(source, /teacherReaderViewport[\s\S]*addEventListener\("scroll"/, "scrolling must provide an Android-safe rendering fallback");
assert.match(source, /ensureStrokes/, "annotations must load lazily near the visible page");
assert.doesNotMatch(source, /state\.pages\.set\(number, info\);\s*bindInk\(info\);\s*loadStrokes/, "annotations for every page must not load during book opening");
assert.match(source, /pausePdfForInk/, "background PDF work must pause while writing");
assert.match(source, /putAnnotation/, "annotations must persist per book and page");
assert.match(source, /READING_PROGRESS_PREFIX/, "reader must persist progress separately from PDF blobs");
assert.match(source, /readingProgressKey\(book = state\.book\)/, "progress must be scoped to group and book");
assert.match(source, /const resumePage = readBookPage\(book\)/, "opening a group's book must restore its last page");
assert.match(source, /goToPage\(Math\.min\(resumePage, state\.pdfDocument\.numPages\)\)/,
  "restored pages must be clamped to the current PDF length");
assert.match(source, /state\.openingBook = true[\s\S]*state\.openingBook = false[\s\S]*goToPage/,
  "building page one must not overwrite saved progress before restoration");
assert.match(source, /function deactivate\(\) \{ persistReadingProgress\(\)/,
  "leaving the board must save the last visible page");
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
assert.match(nativeBoard, /toolbarButton\("✎ قلم"\)/, "native fullscreen board must expose the pen");
assert.match(nativeBoard, /toolbarButton\("⌫ ممحاة"\)/, "native fullscreen board must expose the eraser");
assert.match(nativeBoard, /remove\.setText\("−"\)[\s\S]*remove\.setOnClickListener/, "each native student row must expose point deduction");
assert.match(nativeBoard, /toolbarButton\("⇧ إخفاء الشريط"\)[\s\S]*showToolbarButton\.setVisibility\(View\.VISIBLE\)/, "native board toolbar must collapse for maximum PDF space");
assert.match(nativeBoard, /floatingPageButton = toolbarButton\("⌗ صفحة"\)[\s\S]*showGoToPageDialog/, "native board must keep direct page navigation visible outside the toolbar");
assert.match(nativeBoard, /setTitle\("الانتقال إلى صفحة"\)[\s\S]*pdfView\.jumpTo\(requested - 1, true\)/, "native page dialog must validate and open the requested page");
assert.match(nativeBoard, /putInt\("pdf_page_" \+ currentGroup\.id, current\)/, "native board must remember the last page for each group");
assert.match(nativeBuild, /versionCode 38; versionName "0\.38-page-jump"/, "native screen APK version must be bumped");

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

const progressResult = vm.runInNewContext(`
  const READING_PROGRESS_PREFIX = "ef_teacher_reader_progress_v1";
  const values = new Map();
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  };
  const state = { currentPage: 1, book: null, openingBook: false, lastPersistedProgress: "" };
  ${functionSource("readingProgressKey")}
  ${functionSource("readBookPage")}
  ${functionSource("persistReadingProgress")}
  const bookA = { id: "book-a", groupId: "group-a" };
  const bookB = { id: "book-b", groupId: "group-b" };
  state.book = bookA; persistReadingProgress(83);
  state.book = bookB; persistReadingProgress(12);
  state.openingBook = true; persistReadingProgress(99, bookA);
  ({ pageA: readBookPage(bookA), pageB: readBookPage(bookB), records: values.size });
`);
assert.deepEqual(
  JSON.parse(JSON.stringify(progressResult)),
  { pageA: 83, pageB: 12, records: 2 },
  "each group/book must restore its own page and opening must not overwrite it with page one"
);

console.log("PASS: fresh reader markup, navigation, continuous lazy PDF, fast ink, persistence, student rails and point sync wiring.");
