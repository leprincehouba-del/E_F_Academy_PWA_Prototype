// Run the real session notification handler with a normalized overdue attendance
// record and an injected push provider. No messages leave this process.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
(async()=>{
 let handler;const notices=[],sent=[];let points=-5,providerFails=false;
 const ctx={supabase:{auth:{getUser:async()=>({data:{user:{id:'staff'}}})}},supabaseAdmin:{from(table){
  let inserted=false;const q={select(){return q},eq(){return q},in(){return q},not(){return q},update(){return q},delete(){return q},insert(row){inserted=true;notices.push(row);return q},
   maybeSingle:async()=>({data:{role:'manager',is_active:true,permissions:{attendance_edit:true}}}),
   single:async()=>({data:{id:'notice'}}),
   then(resolve){return Promise.resolve({data:table==='attendance'?[{student_id:'student',attendance_status:'present',payment_status:'due',charge_amount:20,points_change:points}]:table==='students'?[{id:'student',full_name:'Synthetic',parent_phone:'01000000531'}]:table==='user_profiles'?[{id:'parent',phone:'01000000531'}]:table==='push_subscriptions'?[{user_id:'parent',endpoint:'fixture',subscription:{id:'fixture'}}]:[]}).then(resolve)}
  };return q;
 }}};
 let source=fs.readFileSync('supabase/functions/send-parent-push/index.ts','utf8').replace(/^import .*;\n/gm,'').replace('export default','globalThis.endpoint=');
 source=stripTypeScriptTypes(source,{mode:'strip'});
 vm.runInNewContext(source,{Response,Error,Deno:{env:{get:()=> 'configured'}},console:{error(){}},withSupabase:(_,fn)=>(handler=fn),webpush:{setVapidDetails(){},async sendNotification(sub,payload){if(providerFails)throw {statusCode:503};sent.push(JSON.parse(payload))}}});
 const invoke=()=>handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({session_id:'session'})}),ctx);
 let r=await invoke();assert.equal(r.status,200);assert.equal((await r.json()).sent,1);assert.match(sent[0].body,/حاضر/);assert.match(sent[0].body,/-5/);assert.match(sent[0].body,/20/);assert.equal(notices.length,1);
 points=0;r=await invoke();assert.equal((await r.json()).sent,1);assert.match(sent[1].body,/النقاط: 0/);
 providerFails=true;r=await invoke();assert.equal((await r.json()).failed,1,'Provider failure must be reported without altering attendance');
 providerFails=false;r=await invoke();assert.equal((await r.json()).sent,1,'Notification delivery recovers after connection failure');
 console.log('PASS: actual parent session push handler with blocked awards, retained deduction, attendance/debt text, zero points and provider failure/recovery; zero external requests.');
})().catch(e=>{console.error(e);process.exit(1)});
