const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const src = fs.readFileSync('teacher-reader.js','utf8');
const body = acorn.parse(src,{ecmaVersion:'latest'}).body[0].expression.callee.body.body;
const fn = body.filter(n=>n.type==='FunctionDeclaration'&&['boardPointAuthFailed','syncPoints'].includes(n.id.name))
 .map(n=>src.slice(n.start,n.end)).join('\n');
const session = {data:{session:{user:{id:'screen-user'}}}};
const BOARD_ARREARS_MESSAGE='النقاط الموجبة متوقفة حتى تسوية المتأخرات';
const event = id => ({id,studentId:'student',sessionDate:'2026-11-19',points:1,status:'pending',lastError:'',reasonKey:'participation'});
async function harness(rpc,online=true,auth={getSession:async()=>session}) {
 const state={pointSyncing:false,pointEvents:[event('a')]};
 const context={state,currentAppRole:'screen',currentAuthenticatedUserId:'screen-user',navigator:{onLine:online},getSupabase:async()=>({rpc,auth}),pointStatus(){},persistPointEvents(){},renderStudents(){},showToast(){},BOARD_ARREARS_MESSAGE,BOARD_ARREARS_LIMIT:3,students:[{id:"student",dueSessions:2}],Date};
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
 let arrearsCalls=0;
 const arrears=await harness(async(_name,args)=>{
   arrearsCalls++;
   return {data:args.p_points>0?{success:false,blocked:true,message:BOARD_ARREARS_MESSAGE}:{success:true}};
 });
 arrears.state.pointEvents.push({...event('undo'),points:-1,undoOf:'a'},{...event('deduction'),points:-1});
 await arrears.context.sync();
 assert.equal(arrears.context.students[0].dueSessions,3);
 assert.deepEqual(arrears.state.pointEvents.map(e=>e.status),['rejected','rejected','synced']);
 await arrears.context.sync(true);
 assert.equal(arrearsCalls,2,'arrears refusals and their dependent undos must never be resent');
 let refreshes=0;
 const sentKeys=[];
 const expired=await harness(async(_name,args)=>{
   sentKeys.push(args.p_event_key);
   return sentKeys.length===1?{status:401}:{data:{success:true}};
 },true,{getSession:async()=>session,refreshSession:async()=>{refreshes++;return session;}});
 expired.state.pointEvents.push(event('b'));
 await expired.context.sync();
 assert.equal(refreshes,1);
 assert.deepEqual(sentKeys,['teacher_board_a','teacher_board_a','teacher_board_b']);
 assert.ok(expired.state.pointEvents.every(e=>e.status==='synced'));
 let login=null, loginSends=0;
 const missing=await harness(async()=>{loginSends++;return {data:{success:true}};},true,
   {getSession:async()=>({data:{session:login}})});
 missing.state.pointEvents.push(event('b'));
 await missing.context.sync();
 assert.equal(missing.state.pointSignInRequired,true);
 assert.equal(loginSends,0);
 assert.ok(missing.state.pointEvents.every(e=>e.status==='pending'));
 login=session.data.session;
 await missing.context.sync(true);
 assert.equal(loginSends,2);
 assert.equal(missing.state.pointSignInRequired,false);
 let deniedSends=0;
 const denied=await harness(async()=>{deniedSends++;return {status:401};},true,
   {getSession:async()=>session,refreshSession:async()=>({data:{session:null}})});
 denied.state.pointEvents.push(event('b'));
 await denied.context.sync(true);
 assert.equal(deniedSends,1,'lost sign-in stops the batch');
 assert.equal(denied.state.pointSignInRequired,true);
 assert.ok(denied.state.pointEvents.every(e=>e.status==='pending'));
 const offline=await harness(async()=>{throw Error('must not call offline')},false);
 await offline.context.sync();assert.equal(offline.state.pointEvents[0].status,'pending');
 console.log('PASS: taps during in-flight upload drain completely; no duplicate sends; connection-loss retry; closed-session refusal; offline retention.');
})().catch(e=>{console.error(e);process.exit(1)});
