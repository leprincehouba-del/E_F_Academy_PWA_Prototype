// Use the real parent markup and render/open functions. Backend calls are isolated fixtures.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),acorn=require('acorn');
const source=fs.readFileSync('app.js','utf8'),ast=acorn.parse(source,{ecmaVersion:'latest'});
const f=Object.fromEntries(ast.body.filter(n=>n.type==='FunctionDeclaration').map(n=>[n.id.name,source.slice(n.start,n.end)]));
(async()=>{
 const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://example.test/app/?milestone=400&student_id=a'});
 const messages=[],calls=[],opened=new Set();let fail=false,deferred=null;
 const awards={a:[200,400,600],b:[200]};
 const api={rpc:async(name,args)=>{
  calls.push({name,args});if(fail)throw Error('offline');if(deferred)await deferred;
  if(name==='get_parent_milestone_rewards')return {data:awards[args.p_student_id].map(n=>({milestone_points:n,opened_at:opened.has(args.p_student_id+':'+n)?'today':null}))};
  if(name==='open_parent_milestone'){const key=args.p_student_id+':'+args.p_milestone,first=!opened.has(key);opened.add(key);return {data:first}}
  return {data:[]};
 }};
 const ctx=vm.createContext({window:dom.window,document:dom.window.document,console,URL,Number,Map,Promise,showToast:m=>messages.push(m),getSupabase:async()=>api,$:id=>dom.window.document.getElementById(id),
 loadParentChildSchedule:()=>{},loadParentHomework:()=>{},loadParentLessonContent:()=>{},activateParentSessionCards:()=>{},closeParentSessionDetails:()=>{}});
 const names=['renderParentMilestoneRewards','openParentMilestone','openMilestoneFromNotification','showParentMilestoneCelebration','renderParentChild','parentPointReasonLabel'];
 vm.runInContext(`let currentAppRole='parent',parentDashboardData={children:[{id:'a',name:'Test A',points:50,sessions:[]},{id:'b',name:'Test B',points:199,sessions:[]}]};let parentMilestoneRenderVersion=0,milestoneLinkBusy=false;const milestoneOpenRequests=new Map();let parentHomeworkAssignments=[],parentLessonContents=[],parentHomeworkLoading=false,parentLessonContentLoading=false,parentHomeworkStudentId='',parentLessonContentStudentId='',parentHomeworkError='',parentLessonContentError='';${names.map(n=>f[n]).join('\n')}`,ctx);
 const run=s=>vm.runInContext(s,ctx),doc=dom.window.document;
 doc.getElementById('parentChildSelect').innerHTML='<option value="a">Test A</option><option value="b">Test B</option>';
 run("renderParentChild('a')");await new Promise(r=>setImmediate(r));assert.match(doc.getElementById('parentMilestoneRewards').textContent,/نجوم الإنجاز: 3/);assert.equal(doc.getElementById('parentPoints').textContent,'50','retained stars below threshold');
 await Promise.all([run('openMilestoneFromNotification()'),run('openMilestoneFromNotification()')]);assert.equal(calls.filter(c=>c.name==='open_parent_milestone').length,1);assert.equal(doc.querySelectorAll('[role=dialog]').length,1);assert.match(doc.querySelector('[role=dialog]').textContent,/400 POINTS/);assert.equal(doc.querySelectorAll('.milestone-confetti').length,30);assert.equal(dom.window.location.search,'');
 doc.querySelector('.milestone-celebration-close').click();assert.equal(doc.querySelector('[role=dialog]'),null);
 await run("openParentMilestone('a',400)");assert.equal(doc.querySelector('[role=dialog]'),null,'same account receipt suppresses automatic repeat');
 await run("openParentMilestone('a',400,true)");assert.ok(doc.querySelector('[role=dialog]'),'deliberate replay');doc.querySelector('.milestone-celebration-close').click();
 await run("openParentMilestone('a',800)");assert.equal(doc.querySelector('[role=dialog]'),null,'forged milestone');await run("openParentMilestone('stranger',200)");assert.equal(doc.querySelector('[role=dialog]'),null,'forged student');
 fail=true;await run("renderParentMilestoneRewards(parentDashboardData.children[0])");assert.match(doc.getElementById('parentMilestoneRewards').textContent,/إعادة المحاولة/);fail=false;await run("renderParentMilestoneRewards(parentDashboardData.children[0])");assert.match(doc.getElementById('parentMilestoneRewards').textContent,/نجوم الإنجاز: 3/);
 // Out-of-order responses and failure cannot replace the selected child's stars.
 let release;deferred=new Promise(r=>release=r);const stale=run("renderParentMilestoneRewards(parentDashboardData.children[0])");await new Promise(r=>setImmediate(r));deferred=null;doc.getElementById('parentChildSelect').value='b';await run("renderParentMilestoneRewards(parentDashboardData.children[1])");release();await stale;assert.match(doc.getElementById('parentMilestoneRewards').textContent,/نجوم الإنجاز: 1/);
 let finish;deferred=new Promise(r=>finish=r);const pending=run("openParentMilestone('b',200)");await new Promise(r=>setImmediate(r));run("currentAppRole='';parentDashboardData={children:[]}");deferred=null;finish();await pending;assert.equal(doc.querySelector('[role=dialog]'),null,'logout discards delayed celebration');
 console.log('PASS: real parent markup/render, permanent stars, notification link, double open, seen receipt, explicit replay, invalid links, offline recovery, child-switch race and logout.');
 dom.window.close();
})().catch(e=>{console.error(e);process.exit(1)});
