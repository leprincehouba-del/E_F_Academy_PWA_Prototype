const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{stripTypeScriptTypes}=require('node:module');
(async()=>{
 let handler;const calls=[],env={SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'server-only',VAPID_PUBLIC_KEY:'public',VAPID_PRIVATE_KEY:'private'};
 const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/send-milestone-scheduled/index.ts','utf8').replace(/^import .*;\n/gm,''));
 const admin={rpc:async(name,args)=>{calls.push(name);if(name==='milestone_scheduler_token')return {data:'scheduler-secret'};if(name==='claim_milestone_push')return {data:[]};return {data:true}}};
 vm.runInNewContext(source,{Deno:{serve:f=>handler=f,env:{get:n=>env[n]}},createClient:()=>admin,webpush:{setVapidDetails:()=>{}},Response,console});
 const req=(token,body={},method='POST')=>new Request('https://test.invalid',{method,headers:token?{'x-milestone-scheduler':token}:{},...(method==='POST'?{body:JSON.stringify(body)}:{})});
 assert.equal((await handler(req(null,{},'GET'))).status,405);
 assert.equal((await handler(req(null))).status,403);assert.equal((await handler(req('wrong'))).status,403);assert.ok(!calls.includes('prepare_milestone_push'));
 let r=await handler(req('scheduler-secret',{dry_run:true,expected_public_key:'public'}));assert.equal(r.status,200);assert.equal((await r.json()).vapid_matches,true);assert.ok(!calls.includes('claim_milestone_push'));
 r=await handler(req('scheduler-secret',{dry_run:true,expected_public_key:'wrong'}));assert.equal((await r.json()).vapid_matches,false);
 delete env.VAPID_PRIVATE_KEY;assert.equal((await handler(req('scheduler-secret'))).status,503);env.VAPID_PRIVATE_KEY='private';
 r=await handler(req('scheduler-secret'));assert.equal(r.status,200);assert.ok(calls.includes('prepare_milestone_push'));assert.ok(calls.includes('claim_milestone_push'));
 console.log('PASS: scheduled dispatcher method/secret denial, VAPID absence, public-key verification, dry-run has no queue side effects and authorized dispatch.');
})().catch(e=>{console.error(e);process.exit(1)});
