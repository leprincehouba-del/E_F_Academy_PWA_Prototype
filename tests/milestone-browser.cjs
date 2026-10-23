// Full, unchanged application bundle in Chromium; all backend calls are fixtures.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const mock=`(() => {
 const seen=new Set();const child={id:'11111111-1111-1111-1111-111111111111',name:'طالب تجريبي',points:75,grade:'Prep 1',group_name:'Test Group',sessions:[],point_history:[],due_amount:0};
 window.fixtureCalls=[];
 const query=(table)=>{const q=new Proxy({}, {get:(_,key)=>key==='then'?resolve=>resolve({data:table==='user_profiles'?{role:'parent',is_active:true,full_name:'ولي أمر تجريبي'}:[]}):()=>q});return q};
 const channel={on(){return this},subscribe(){return this},unsubscribe:async()=>{}};
 window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'test-parent'}}}}),signOut:async()=>({})},from:query,channel:()=>channel,removeChannel:async()=>{},rpc:async(name,args)=>{
  window.fixtureCalls.push({name,args});
  if(name==='get_parent_dashboard')return {data:{children:[child]}};
  if(name==='get_parent_milestone_rewards')return {data:[200,400,600].map(n=>({milestone_points:n,opened_at:seen.has(n)?'today':null}))};
  if(name==='open_parent_milestone'){const first=!seen.has(args.p_milestone);seen.add(args.p_milestone);return {data:first}};
  return {data:[]};
 }})};
})()`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/supabase.js'){res.setHeader('Content-Type','application/javascript');return res.end(mock)}
  const file=path.resolve('.','.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(process.cwd()+path.sep)){res.writeHead(403);return res.end()}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file))}catch{res.writeHead(404);res.end()}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try{
  browser=await chromium.launch({headless:true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']} : {})});const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});const page=await context.newPage();const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.origin);return route.abort()}return route.continue()});
  await page.goto('http://127.0.0.1:'+server.address().port+'/?milestone=400&student_id=11111111-1111-1111-1111-111111111111');
  await page.locator('#parentPortal:not(.hidden)').waitFor();await page.locator('#parentMilestoneRewards .milestone-earned-star').nth(2).waitFor();assert.equal(await page.locator('#parentMilestoneRewards .milestone-earned-star').count(),3);assert.equal(await page.locator('#parentMilestoneRewards').innerText(),'');assert.equal(await page.locator('#parentMilestoneRewards button').count(),0);
  await page.locator('#studentMilestoneCelebration').waitFor();assert.match(await page.locator('#studentMilestoneCelebration').innerText(),/400 POINTS/);
  const box=await page.locator('.milestone-celebration-panel').boundingBox();assert.ok(box.width<=390,'mobile dialog fits');
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/parent-celebration-mobile.png',fullPage:true});
  await page.locator('#studentMilestoneCelebration').waitFor({state:'detached',timeout:10000});
  await page.evaluate(()=>openParentMilestone('11111111-1111-1111-1111-111111111111',400));assert.equal(await page.locator('#studentMilestoneCelebration').count(),0);
  await page.evaluate(()=>openParentMilestone('11111111-1111-1111-1111-111111111111',600));await page.locator('#studentMilestoneCelebration').waitFor();await page.keyboard.press('Escape');
  await page.screenshot({path:'test-results/parent-stars-mobile.png',fullPage:true});
  assert.deepEqual(errors,[],'no full-bundle JavaScript errors');assert.deepEqual(external,[],'no live/external requests');
  console.log('PASS: full application in mobile Chromium, parent portal, retained 3 stars at 75 points, push link to 400 celebration, seen-open suppression, automatic dismissal, stars-only display, Escape and zero live requests.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exit(1)});
