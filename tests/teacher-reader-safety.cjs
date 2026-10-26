const fs = require("node:fs");
const assert = require("node:assert/strict");
const acorn = require("acorn");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("index.html", "utf8");
const source = fs.readFileSync("teacher-reader.js", "utf8");
const css = fs.readFileSync("styles.css", "utf8");
const worker = fs.readFileSync("service-worker.js", "utf8");

acorn.parse(source, { ecmaVersion: "latest", sourceType: "script" });
const dom = new JSDOM(html);
const document = dom.window.document;

[
  "teacherReader", "teacherReaderGroup", "teacherReaderDate", "teacherReaderBook",
  "teacherReaderPdfInput", "teacherReaderViewport", "teacherReaderPages",
  "teacherReaderStudentsLeft", "teacherReaderStudentsRight", "teacherReaderStatus"
].forEach(id => assert.ok(document.getElementById(id), `missing #${id}`));

assert.ok(document.querySelector('#navMenu [data-page="teacherReader"]'), "missing reader navigation");
assert.ok(html.indexOf("app.js") < html.indexOf("teacher-reader.js"), "reader must load after app globals");
assert.match(source, /queue_owner_teacher_board_point/, "point RPC must remain connected");
assert.match(source, /teacher_board_\$\{String\(event\.id\)/, "point event key must satisfy the database contract");
assert.match(source, /IntersectionObserver/, "continuous viewer must lazily render nearby pages");
assert.match(source, /getCoalescedEvents/, "pen must consume high-frequency pointer samples");
assert.match(source, /putAnnotation/, "annotations must persist per book and page");
assert.match(css, /grid-template-columns:\s*var\(--reader-rail\).*var\(--reader-rail\)/s, "student rails must stay on both sides");
assert.match(worker, /teacher-reader\.js/, "service worker must update the reader asset");

console.log("PASS: fresh reader markup, navigation, continuous lazy PDF, fast ink, persistence, student rails and point sync wiring.");
