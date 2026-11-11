const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");

// Simulate the reported failure: HTML is available, but neither external CSS
// nor application JavaScript can load. Inline CSS must still hide private pages.
const dom = new JSDOM(html, { runScripts: "outside-only" });
const { document } = dom.window;

assert.ok(document.querySelector("#critical-app-visibility"), "missing inline critical guard");
assert.equal(dom.window.getComputedStyle(document.querySelector("#appShell")).display, "none");
assert.equal(dom.window.getComputedStyle(document.querySelector("#parentPortal")).display, "none");
assert.equal(dom.window.getComputedStyle(document.querySelector("#attendance")).display, "none");
assert.equal(dom.window.getComputedStyle(document.querySelector("#payments")).display, "none");
assert.equal(dom.window.getComputedStyle(document.querySelector("#points")).display, "none");
assert.notEqual(dom.window.getComputedStyle(document.querySelector("#loginScreen")).display, "none");

const versionedAssets = [...html.matchAll(/(?:href|src)="((?:styles|app|teacher-reader)\.\w+\?v=[^"]+)"/g)]
  .map(match => match[1]);
assert.deepEqual(versionedAssets.length, 3, "expected three versioned shell assets");
for (const asset of versionedAssets) {
  assert.ok(sw.includes(JSON.stringify(asset)), `service worker does not precache ${asset}`);
}
assert.match(sw, /caches\.match\(e\.request,\s*\{\s*ignoreSearch:\s*true\s*\}\)/);

console.log("offline style/privacy guard tests passed");
