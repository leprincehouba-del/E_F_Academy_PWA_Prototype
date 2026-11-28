const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const readerMarkup = fs.readFileSync("index.html", "utf8").match(/<section id="teacherReader"[\s\S]*?<section id="settings"/)[0].replace(/<section id="settings"$/, "");
const appSource = fs.readFileSync("app.js", "utf8");
const rosterSorter = appSource.slice(appSource.indexOf("function rankStudentsByPoints("),
  appSource.indexOf("\nfunction renderStudents()", appSource.indexOf("function rankStudentsByPoints(")));
const students = Array.from({length: 101}, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  name: `طالب اختبار ${index + 1}`,
  group: "group-1",
  points: 101 - index,
  dueSessions: index === 0 ? 3 : 2
}));
const testHtml = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body>
${readerMarkup.replace('class="page teacher-reader-page"', 'class="page teacher-reader-page active-page"')}
<script>
window.currentAppRole="owner";
window.groups=[{id:"group-1",dbId:"test-id",code:"g1",name:"مجموعة اختبار كبيرة"}];
${rosterSorter}
window.students=${JSON.stringify([...students].reverse())};
window.groupById=id=>window.groups.find(group=>String(group.id)===String(id)||String(group.code)===String(id));
window.showToast=message=>{window.lastToast=message};
window.pointRequests=[];
window.boardSignedOut=false;
window.hangingPdfPage=0;
const originalTimeout=window.setTimeout.bind(window);
window.setTimeout=(callback,delay,...args)=>originalTimeout(callback,delay===8000?350:delay,...args);
window.boardSendGate=null;
window.getSupabase=async()=>({
  auth:{getSession:async()=>({data:{session:window.boardSignedOut?null:{user:{id:"screen-user"}}}})},
  rpc:async(_name,args)=>{
    window.pointRequests.push(args);
    if (window.boardSendGate) await window.boardSendGate;
    return window.testSessionClosed ? {data:{closed:true,success:false,message:"الحصة مسجلة أو بدأ إغلاقها بالفعل"}} : {data:{success:true,queued:true}};
  },
  from:()=>({select:()=>({eq:()=>({eq:async()=>({data:[{id:students.find(student=>student.dueSessions===3).id,due_sessions_count:window.settled?2:3}]})})})})
});
</script><script src="/teacher-reader.js"></script></body></html>`;
const fakePdfModule = `
export const GlobalWorkerOptions={workerSrc:""};
let pageTwoAttempts=0;
export function getDocument(){
 const page=n=>({
  getViewport:({scale})=>({width:600*scale,height:800*scale}),
  render:({canvasContext,viewport})=>{canvasContext.fillStyle=n%2?'#fff':'#f5f8ff';canvasContext.fillRect(0,0,viewport.width,viewport.height);canvasContext.fillStyle='#123';canvasContext.font='32px sans-serif';canvasContext.fillText('Page '+n,30,55);const fail=n===2&&pageTwoAttempts++===0;return {promise:fail?Promise.reject(new Error('transient page failure')):n===window.hangingPdfPage?new Promise(()=>{}):Promise.resolve(),cancel(){}}},
  cleanup(){}
 });
 return {promise:Promise.resolve({numPages:183,getPage:async n=>page(n),destroy(){}})};
}`;

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/") { res.setHeader("Content-Type", "text/html"); return res.end(testHtml); }
    const file = path.resolve(".", `.${pathname}`);
    if (!file.startsWith(`${process.cwd()}${path.sep}`)) { res.writeHead(403); return res.end(); }
    try {
      res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : "text/css");
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"]});
    const page = await browser.newPage({viewport:{width:1600,height:900}});
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs", route => route.fulfill({status:200,contentType:"application/javascript",body:fakePdfModule}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator("[data-reader-student]").nth(100).waitFor();
    assert.equal(await page.locator("[data-reader-student]").count(), 101, "all large-group students remain rendered");
    const firstStudent = page.locator("#teacherReaderStudentsLeft [data-reader-student]").first();
    assert.equal(await firstStudent.getAttribute("data-reader-student"), students[0].id);
    assert.equal(await page.locator("#teacherReaderStudentsRight [data-reader-student]").first().getAttribute("data-reader-student"), students[1].id);
    const firstAdd = firstStudent.locator('[data-reader-point="add"]');
    assert.equal(await firstAdd.isDisabled(), true, "at three overdue sessions the board disables adding");
    assert.match(await firstStudent.innerText(), /متأخرات/);
    await firstAdd.evaluate(button => button.dispatchEvent(new MouseEvent("click")));
    assert.equal(await page.evaluate(() => pointRequests.length), 0, "action guard rejects positives even with a forced click");
    await page.evaluate(() => {
      window.boardSendGate = new Promise(resolve => { window.confirmBoardSend = resolve; });
    });
    await firstStudent.locator('[data-reader-point="remove"]').click();
    await page.waitForFunction(() => pointRequests.length === 1);
    assert.equal(await page.locator("#teacherReaderExportPoints").isVisible(), false, "export is not shown while an ordinary request is awaiting acknowledgement");
    assert.equal(await firstStudent.locator(".teacher-reader-student-count").innerText(), "0", "pending deductions do not masquerade as confirmed");
    await page.evaluate(() => { window.confirmBoardSend(); window.boardSendGate = null; });
    await page.waitForFunction(() => document.querySelector("#teacherReaderStudentsLeft .teacher-reader-student-count").textContent === "-1");
    await page.evaluate(() => {
      window.settled = true;
      window.dispatchEvent(new Event("online"));
    });
    await firstAdd.click();
    await page.waitForFunction(() => document.querySelector("#teacherReaderStudentsLeft .teacher-reader-student-count").textContent === "0");
    await page.locator("#teacherReaderStudentsLeft [data-reader-student]").last().scrollIntoViewIfNeeded();
    await page.locator("#teacherReaderStudentsLeft [data-reader-student]").last().locator('[data-reader-point="add"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll("#teacherReaderStudentsLeft .teacher-reader-student-count")].at(-1).textContent === "1");

    await page.evaluate(() => { window.testSessionClosed = true; });
    await firstAdd.click();
    await page.waitForFunction(() => document.getElementById("teacherReaderStatus").textContent.includes("الحصة مقفولة"));
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#teacherReaderExportPoints").click();
    const report = JSON.parse(fs.readFileSync(await (await downloadPromise).path(), "utf8"));
    assert.equal(report.groupId, "test-id");
    assert.equal(report.events.length, 1, "export excludes successfully sent points");
    assert.equal(report.events[0].studentId, students[0].id);
    assert.equal(report.events[0].points, 1);
    await page.evaluate(() => { window.testSessionClosed = false; });
    await page.locator("#teacherReaderRetryPoints").click();
    await page.waitForFunction(() => document.getElementById("teacherReaderExportPoints").hidden);

    await page.evaluate(() => { window.boardSignedOut = true; window.dispatchEvent(new Event("online")); });
    await page.waitForFunction(() => document.getElementById("teacherReaderStatus").textContent.includes("سجّل الدخول"));
    assert.equal(await firstAdd.isDisabled(), true);
    assert.equal(await firstStudent.locator('[data-reader-point="remove"]').isDisabled(), true);
    await page.evaluate(() => { window.boardSignedOut = false; window.dispatchEvent(new Event("online")); });
    await page.waitForFunction(() => !document.querySelector("#teacherReaderStudentsLeft [data-reader-point=add]").disabled);

    await page.locator("#teacherReaderPdfInput").setInputFiles({name:"continuous-test.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-test")});
    await page.locator(".teacher-reader-page-wrap").nth(182).waitFor();
    assert.equal(await page.locator(".teacher-reader-page-wrap").count(), 183, "all long-book page positions exist in one continuous document");
    await page.locator('[data-page="2"].rendered').waitFor({timeout:4000});
    const adjacent = await page.evaluate(() => {
      const viewport = document.getElementById("teacherReaderViewport");
      const pages = [...document.querySelectorAll(".teacher-reader-page-wrap")];
      viewport.scrollTop = pages[1].offsetTop - 180;
      const vr = viewport.getBoundingClientRect(), first = pages[0].getBoundingClientRect(), second = pages[1].getBoundingClientRect();
      return { firstVisible:first.bottom>vr.top&&first.top<vr.bottom, secondVisible:second.bottom>vr.top&&second.top<vr.bottom };
    });
    assert.deepEqual(adjacent, {firstVisible:true,secondVisible:true}, "bottom of one page and top of the next must be visible together");

    await page.locator("#teacherReaderPageNumber").fill("150");
    await page.locator("#teacherReaderGoPage").click();
    await page.waitForTimeout(700);
    const jump = await page.evaluate(() => ({
      scrollTop: document.getElementById("teacherReaderViewport").scrollTop,
      targetTop: document.querySelector('[data-page="150"]').offsetTop,
      handActive: document.querySelector('[data-reader-mode="hand"]').classList.contains("active")
    }));
    assert.ok(Math.abs(jump.scrollTop - jump.targetTop) < 60, "go-to-page reaches the requested page");
    assert.equal(jump.handActive, true, "jump must preserve the active viewer mode");
    await page.evaluate(() => document.body.classList.add("screen-board-account"));
    await page.locator("#teacherReaderScreenPageNumber").fill("183");
    await page.locator("#teacherReaderScreenGoPage").click();
    await page.waitForTimeout(700);
    const screenJump = await page.evaluate(() => ({
      scrollTop: document.getElementById("teacherReaderViewport").scrollTop,
      targetTop: document.querySelector('[data-page="183"]').offsetTop,
      total: document.getElementById("teacherReaderScreenPageTotal").textContent
    }));
    assert.ok(Math.abs(screenJump.scrollTop - screenJump.targetTop) < 60, "screen-account go-to-page reaches the last page");
    assert.equal(screenJump.total, "183", "screen-account page control shows the complete long book");
    // Screen mode must retain working ink controls and page-local zoom anchors.
    assert.equal(await page.locator('[data-reader-mode="pen"]').isVisible(), true);
    assert.equal(await page.locator('[data-reader-mode="eraser"]').isVisible(), true);
    await page.locator("#teacherReaderScreenPageNumber").fill("150");
    await page.locator("#teacherReaderScreenGoPage").click();
    await page.waitForTimeout(350);
    const anchorPosition = () => page.evaluate(() => {
      const viewport = document.getElementById("teacherReaderViewport").getBoundingClientRect();
      const rect = document.querySelector('[data-page="150"]').getBoundingClientRect();
      return ((viewport.top + viewport.bottom) / 2 - rect.top) / rect.height;
    });
    const beforeZoom = await anchorPosition();
    await page.locator("#teacherReaderZoomIn").click();
    await page.waitForTimeout(400);
    assert.ok(Math.abs(await anchorPosition() - beforeZoom) < .01, "zoom preserves the same location on page 150, including preceding page gaps");
    const raster = page.locator('[data-page="150"] .teacher-reader-pdf-canvas');
    await page.waitForFunction(() => {
      const canvas = document.querySelector('[data-page="150"] .teacher-reader-pdf-canvas');
      return canvas.width >= 1.25 * canvas.clientWidth;
    });
    const pdfHandle = await raster.elementHandle();
    const ink = page.locator('[data-page="150"] .teacher-reader-ink-canvas');
    const pdfRect = await raster.boundingBox();
    const viewRect = await page.locator("#teacherReaderViewport").boundingBox();
    const clip = {x: Math.ceil(Math.max(pdfRect.x, viewRect.x) + 30),
      y: Math.ceil(Math.max(pdfRect.y, viewRect.y) + 30), width: 120, height: 60};
    const beforePen = await page.screenshot({clip});
    await page.locator('[data-reader-mode="pen"]').click();
    assert.equal(await ink.evaluate(canvas => canvas.width), 1, "selecting pen must not allocate a full-page ink bitmap");
    assert.equal(await raster.evaluate((canvas, original) => canvas === original, pdfHandle), true, "selecting pen preserves the rendered PDF");
    assert.deepEqual(await page.screenshot({clip}), beforePen, "switching to pen keeps the actual PDF pixels visible");
    const rect = await ink.boundingBox();
    const vr = await page.locator("#teacherReaderViewport").boundingBox();
    const x = Math.max(rect.x + 30, vr.x + 30), y = Math.max(rect.y + 100, vr.y + 100);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 100, y + 30, {steps:15}); await page.mouse.up();
    assert.ok(await ink.evaluate(canvas => canvas.width > 1 && canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>0)), "screen pen writes real persistent ink");
    await page.locator('[data-reader-mode="eraser"]').click();
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 100, y + 30, {steps:15}); await page.mouse.up();
    assert.equal(await ink.evaluate(canvas => canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>0)), false, "screen eraser removes the drawn stroke");
    await page.locator('[data-reader-mode="hand"]').click();
    await page.evaluate(() => { window.hangingPdfPage = 167; });
    await page.locator("#teacherReaderScreenPageNumber").fill("167");
    await page.locator("#teacherReaderScreenGoPage").click();
    await page.locator('[data-reader-mode="pen"]').click();
    assert.equal(await page.locator('[data-reader-mode="pen"]').evaluate(button => button.classList.contains("active")), true);
    await page.locator('[data-reader-mode="hand"]').click();
    await page.locator("#teacherReaderScreenPageNumber").fill("179");
    await page.locator("#teacherReaderScreenGoPage").click();
    await page.locator('[data-page="179"].rendered').waitFor({timeout:5000});
    assert.deepEqual(errors, [], "browser run has no JavaScript errors");
    console.log("PASS: Chromium continuous 183-page PDF, transient-page retry, both page jumps, and 101-student touch list.");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exit(1); });
