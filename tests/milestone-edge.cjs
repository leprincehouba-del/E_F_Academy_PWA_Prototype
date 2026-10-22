// Exercise the actual Edge handler with injected provider/database outcomes.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
(async()=>{
 let handler,role='owner',active=true,unauthorized=false,claimFail=false,ackFail=false;const calls=[],sent=[];
 const jobs=[1,2,3].map(i=>({student_id:'s',milestone_points:i*200,subscription_id:'device'+i,lease_token:'lease'+i,notification_id:'notice'+i,subscription:{id:i},title:'Congratulations',body:'Award'}));
 const ctx={supabase:{auth:{getUser:async()=>({data:{user:unauthorized?null:{id:'owner'}}})}},supabaseAdmin:{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role,is_active:active}})})})}),rpc:async(name,args)=>{calls.push({name,args});if(name==='claim_milestone_push')return claimFail?{error:Error('db outage')}:{data:jobs};if(name==='finish_milestone_push')return ackFail?{error:Error('ack outage')}:{data:true};return {data:null}}}};
 let text=fs.readFileSync('supabase/functions/send-milestone-push/index.ts','utf8').replace(/^import .*;\n/gm,'').replace('export default','globalThis.endpoint=');
 text=stripTypeScriptTypes(text,{mode:'strip'});
 const sandbox=vm.createContext({Response,Deno:{env:{get:()=> 'configured'}},withSupabase:(_opts,fn)=>{handler=fn;return fn},webpush:{setVapidDetails(){},sendNotification:async(sub,payload)=>{sent.push(JSON.parse(payload));if(sub.id===2)throw {statusCode:410};if(sub.id===3)throw {statusCode:503}}}});
 vm.runInContext(text,sandbox);
 let result=await handler(new Request('https://test.invalid',{method:'POST'}),ctx);assert.equal(result.status,200);assert.deepEqual((await result.json()),{ok:false,sent:1,failed:2});
 assert.deepEqual(calls.filter(c=>c.name==='finish_milestone_push').map(c=>c.args.p_result),['sent','expired','retry']);assert.equal(sent[0].tag,'milestone:s:200');assert.match(sent[0].url,/milestone=200/);
 role='parent';calls.length=0;assert.equal((await handler(new Request('https://test.invalid',{method:'POST'}),ctx)).status,403);assert.equal(calls.length,0);
 role='owner';active=false;assert.equal((await handler(new Request('https://test.invalid',{method:'POST'}),ctx)).status,403);
 active=true;unauthorized=true;assert.equal((await handler(new Request('https://test.invalid',{method:'POST'}),ctx)).status,401);
 unauthorized=false;claimFail=true;assert.equal((await handler(new Request('https://test.invalid',{method:'POST'}),ctx)).status,503);
 claimFail=false;ackFail=true;result=await handler(new Request('https://test.invalid',{method:'POST'}),ctx);assert.equal((await result.json()).sent,0,'never report accepted push as recorded sent after ack failure');
 console.log('PASS: actual Edge handler, partial provider failure, expired endpoint, transient retry, deterministic payload, parent/inactive/anonymous denial, claim/ack failure.');
})().catch(e=>{console.error(e);process.exit(1)});
