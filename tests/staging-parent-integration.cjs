// Real staging authentication, REST/RLS/RPC and full application DOM. No mocks.
// Never run this against production. Credentials stay outside the repository.
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM,VirtualConsole}=require('jsdom');
const {createClient}=require('@supabase/supabase-js');
(async()=>{
 const s=JSON.parse(fs.readFileSync(process.env.STAGING_TEST_CONFIG || (()=>{throw Error('STAGING_TEST_CONFIG required')})()));
 assert.equal(s.project,'ahvmvimruxtprukmhvgh');assert.ok(!s.url.includes('bmnrltyodljgvrcssjhd'));
 const api=createClient(s.url,s.key,{auth:{persistSession:false}});
 const {data:auth,error:authError}=await api.auth.signInWithPassword({email:'01000000533@efacademy.local',password:s.parentPassword});assert.ifError(authError);assert.ok(auth.user);
 const {data:dashboard,error}=await api.rpc('get_parent_dashboard');assert.ifError(error);assert.equal(dashboard.children.length,3);
 const child=dashboard.children.find(x=>x.name==='طالب تجربة النجوم');assert.equal(child.points,75);
 let r=await api.rpc('get_parent_milestone_rewards',{p_student_id:child.id});assert.ifError(r.error);assert.deepEqual(r.data.map(x=>x.milestone_points),[200,400,600]);
 r=await api.rpc('staging_milestone_config');assert.ok(r.error,'Parent must never read VAPID private key/scheduler token');
 r=await api.rpc('prepare_milestone_push');assert.ok(r.error,'Parent cannot claim jobs');
 const opened=await api.rpc('open_parent_milestone',{p_student_id:child.id,p_milestone:200});assert.ifError(opened.error);
 r=await api.rpc('open_parent_milestone',{p_student_id:child.id,p_milestone:200});assert.ifError(r.error);assert.equal(r.data,false,'Repeated automatic celebration suppressed on server');
 const unrelated=createClient(s.url,s.key,{auth:{persistSession:false}});const u=await unrelated.auth.signInWithPassword({email:'01000000534@efacademy.local',password:s.parentPassword});assert.ifError(u.error);
 r=await unrelated.rpc('get_parent_milestone_rewards',{p_student_id:child.id});assert.ok(r.error,'Unrelated parent cannot read awards');
 r=await unrelated.from('student_milestone_rewards').select('*');assert.ifError(r.error);assert.equal(r.data.length,0,'Direct REST RLS also isolates awards');
 const logs=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>logs.push(e.message));vc.on('error',(...items)=>console.error('Staging app:',items.map(x=>x?.message||String(x)).join(' ')));
vc.on('warn',(...items)=>console.error('Staging warning:',items.map(x=>x?.message||String(x)).join(' ')));
 const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://staging-fixture.invalid/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
 const timerIds=[];const originalInterval=dom.window.setInterval.bind(dom.window);dom.window.setInterval=(...args)=>{const id=originalInterval(...args);timerIds.push(id);return id};
 dom.window.scrollTo=()=>{};
 dom.window.supabase={createClient:()=>api};dom.window.eval(fs.readFileSync('app.js','utf8').replace('\ncheckSession();\n','\nwindow.initialSessionReady = checkSession();\n'));
 try{
  await dom.window.initialSessionReady;
  const poll=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw Error('Staging interface timeout: '+dom.window.document.getElementById('parentMilestoneRewards').textContent+' selected='+dom.window.document.getElementById('parentChildSelect').value)};
  await poll(()=>!dom.window.document.getElementById('parentPortal').classList.contains('hidden'));
  const sel=dom.window.document.getElementById('parentChildSelect');sel.value=child.id;sel.dispatchEvent(new dom.window.Event('change'));
  await poll(()=>dom.window.document.getElementById('parentMilestoneRewards').textContent.includes('نجوم الإنجاز: 3'));
  assert.equal(dom.window.document.getElementById('parentPoints').textContent,'75');
  const button=[...dom.window.document.querySelectorAll('#parentMilestoneRewards button')].find(b=>b.textContent.includes('400'));
  await button.onclick();await poll(()=>!!dom.window.document.getElementById('studentMilestoneCelebration'));
  assert.match(dom.window.document.getElementById('studentMilestoneCelebration').textContent,/400 POINTS/);
  assert.deepEqual(logs,[]);
  console.log('PASS: real staging parent sign-in, dashboard, exact 200/400/600 rewards at 75 points, REST/RPC isolation, secret denial, server duplicate-open receipt, full app rendering and 400-point celebration using live staging RPCs.');
 }finally{for(const id of timerIds)dom.window.clearInterval(id);await api.removeAllChannels();await unrelated.removeAllChannels();await api.auth.signOut();await unrelated.auth.signOut();dom.window.close()}
})().catch(e=>{console.error(e);process.exit(1)});
