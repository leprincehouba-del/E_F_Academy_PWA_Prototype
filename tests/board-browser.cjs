const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const readerMarkup = fs.readFileSync("index.html", "utf8").match(/<section id="teacherReader"[\s\S]*?<section id="settings"/)[0].replace(/<section id="settings"$/, "");
const students = Array.from({length: 101}, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  name: `طالب اختبار ${index + 1}`,
  group: "group-1"
}));
const testHtml = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body>
${readerMarkup.replace('class="page teacher-reader-page"', 'class="page teacher-reader-page active-page"')}
<script>
window.currentAppRole="owner";
window.groups=[{id:"group-1",code:"g1",name:"مجموعة اختبار كبيرة"}];
window.students=${JSON.stringify(students)};
window.groupById=id=>window.groups.find(group=>String(group.id)===String(id)||String(group.code)===String(id));
window.showToast=message=>{window.lastToast=message};
window.getSupabase=async()=>({rpc:async()=>({data:{success:true,queued:true},error:null})});
</script><script src="/teacher-reader.js"></script></body></html>`;
const fakePdfModule = `
export const GlobalWorkerOptions={workerSrc:""};
export function getDocument(){
 const page=n=>({
  getViewport:({scale})=>({width:600*scale,height:800*scale}),
  render:({canvasContext,viewport})=>{canvasContext.fillStyle=n%2?'#fff':'#f5f8ff';canvasContext.fillRect(0,0,viewport.width,viewport.height);canvasContext.fillStyle='#123';canvasContext.font='32px sans-serif';canvasContext.fillText('Page '+n,30,55);return {promise:Promise.resolve(),cancel(){}}},
  cleanup(){}
 });
 return {promise:Promise.resolve({numPages:12,getPage:async n=>page(n),destroy(){}})};
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
    browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE || "/usr/bin/chromium", args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"]});
    const page = await browser.newPage({viewport:{width:1600,height:900}});
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs", route => route.fulfill({status:200,contentType:"application/javascript",body:fakePdfModule}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator("[data-reader-student]").nth(100).waitFor();
    assert.equal(await page.locator("[data-reader-student]").count(), 101, "all large-group students remain rendered");
    await page.locator("#teacherReaderStudentsLeft [data-reader-student]").last().scrollIntoViewIfNeeded();
    await page.locator("#teacherReaderStudentsLeft [data-reader-student]").last().click();
    assert.equal(await page.locator("#teacherReaderStudentsLeft [data-reader-student]").last().locator(".teacher-reader-student-count").innerText(), "1");

    await page.locator("#teacherReaderPdfInput").setInputFiles({name:"continuous-test.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-test")});
    await page.locator(".teacher-reader-page-wrap").nth(11).waitFor();
    assert.equal(await page.locator(".teacher-reader-page-wrap").count(), 12, "all page positions exist in one continuous document");
    const adjacent = await page.evaluate(() => {
      const viewport = document.getElementById("teacherReaderViewport");
      const pages = [...document.querySelectorAll(".teacher-reader-page-wrap")];
      viewport.scrollTop = pages[1].offsetTop - 180;
      const vr = viewport.getBoundingClientRect(), first = pages[0].getBoundingClientRect(), second = pages[1].getBoundingClientRect();
      return { firstVisible:first.bottom>vr.top&&first.top<vr.bottom, secondVisible:second.bottom>vr.top&&second.top<vr.bottom };
    });
    assert.deepEqual(adjacent, {firstVisible:true,secondVisible:true}, "bottom of one page and top of the next must be visible together");

    await page.locator("#teacherReaderPageNumber").fill("9");
    await page.locator("#teacherReaderGoPage").click();
    await page.waitForTimeout(700);
    const jump = await page.evaluate(() => ({
      scrollTop: document.getElementById("teacherReaderViewport").scrollTop,
      targetTop: document.querySelector('[data-page="9"]').offsetTop,
      handActive: document.querySelector('[data-reader-mode="hand"]').classList.contains("active")
    }));
    assert.ok(Math.abs(jump.scrollTop - jump.targetTop) < 60, "go-to-page reaches the requested page");
    assert.equal(jump.handActive, true, "jump must preserve the active viewer mode");
    assert.deepEqual(errors, [], "browser run has no JavaScript errors");
    console.log("PASS: Chromium continuous 12-page PDF, adjacent-page visibility, page jump, and 101-student touch list.");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exit(1); });
