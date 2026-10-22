// Full app bundle and real HTML with an isolated in-memory backend fixture.
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom');
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
 const errors=[];const output=new VirtualConsole();output.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://test.invalid/?milestone=400&student_id=11111111-1111-1111-1111-111111111111',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:output});
 const w=dom.window;w.fetch=()=>assert.fail('Network forbidden');
 w.eval(mock);w.eval(fs.readFileSync('app.js','utf8'));
 for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));
 try {
  const doc=w.document;
  assert.equal(doc.getElementById('parentPortal').classList.contains('hidden'),false);
  assert.match(doc.getElementById('parentMilestoneRewards').textContent,/نجوم الإنجاز: 3/);
  assert.equal(doc.getElementById('parentPoints').textContent,'75');
  assert.match(doc.getElementById('studentMilestoneCelebration').textContent,/400 POINTS/);
  assert.equal(w.location.search,'');
  doc.querySelector('.milestone-celebration-close').click();
  await w.openParentMilestone('11111111-1111-1111-1111-111111111111',400);
  assert.equal(doc.getElementById('studentMilestoneCelebration'),null);
  assert.deepEqual(errors,[]);
  console.log('PASS: full app.js plus real index.html, parent login/session restoration, 3 permanent stars at 75 points, linked celebration, no repeated automatic celebration, zero network.');
 } finally {dom.window.close()}
})().catch(e=>{console.error(e);process.exit(1)});
