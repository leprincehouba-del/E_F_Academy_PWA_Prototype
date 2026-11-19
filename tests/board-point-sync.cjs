const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const src = fs.readFileSync('teacher-reader.js','utf8');
const body = acorn.parse(src,{ecmaVersion:'latest'}).body[0].expression.callee.body.body;
const node = body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='syncPoints');
const fn = src.slice(node.start,node.end);
const event = id => ({id,studentId:'student',sessionDate:'2026-11-19',points:1,status:'pending',lastError:'',reasonKey:'participation'});
async function harness(rpc,online=true) {
 const state={pointSyncing:false,pointEvents:[event('a')]};
 const context={state,currentAppRole:'screen',navigator:{onLine:online},getSupabase:async()=>({rpc}),pointStatus(){},persistPointEvents(){},renderStudents(){},Date};
 vm.createContext(context);vm.runInContext(fn+';this.sync=syncPoints',context);
 return {state,context};
}
(async()=>{
 let release,entered;
 const started=new Promise(r=>entered=r), gate=new Promise(r=>release=r),calls=[];
 const {state,context}=await harness(async(name,args)=>{calls.push(args.p_event_key);if(calls.length===1){entered();await gate;}return {data:{success:true,queued:true}};});
 const running=context.sync();await started;
 state.pointEvents.push(event('b'),event('c'));
 await context.sync(); // Real addPoint calls sync while the first RPC is still in flight.
 release();await running;
 assert.equal(calls.length,3,'three board taps must reach the server without a fourth tap or reopening');
 assert.ok(state.pointEvents.every(e=>e.status==='synced'));
 await context.sync();assert.equal(calls.length,3,'confirmed events must not be sent again');
 let attempts=0;const retry=await harness(async()=>{attempts++;return attempts===1?{error:{message:'connection lost'}}:{data:{success:true,already_applied:true}};});
 await retry.context.sync();assert.equal(retry.state.pointEvents[0].status,'pending');
 await retry.context.sync();assert.equal(attempts,1,'failed events wait for an explicit retry');
 await retry.context.sync(true);assert.equal(retry.state.pointEvents[0].status,'synced');
 const blocked=await harness(async()=>({data:{success:false,closed:true,message:'closed'}}));
 await blocked.context.sync();assert.equal(blocked.state.pointEvents[0].status,'pending');assert.equal(blocked.state.pointEvents[0].lastError,'closed');
 const offline=await harness(async()=>{throw Error('must not call offline')},false);
 await offline.context.sync();assert.equal(offline.state.pointEvents[0].status,'pending');
 console.log('PASS: taps during in-flight upload drain completely; no duplicate sends; connection-loss retry; closed-session refusal; offline retention.');
})().catch(e=>{console.error(e);process.exit(1)});
