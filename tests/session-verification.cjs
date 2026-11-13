// Exercise the actual completed-session recovery path with RPC-only pending
// points. Any direct pending-table read or business write is a test failure.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),acorn=require('acorn'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('app.js','utf8'),ast=acorn.parse(source,{ecmaVersion:'latest'});
const functions=Object.fromEntries(ast.body.filter(n=>n.type==='FunctionDeclaration').map(n=>[n.id.name,source.slice(n.start,n.end)]));
assert.doesNotMatch(source,/\.from\(\s*["']pending_session_points["']\s*\)/,'Pending points must remain RPC-only in every save path');
assert.equal((source.match(/await verifySavedSessionCompletion\(/g)||[]).length,3,'Fresh, legacy and completed-session paths all verify');
function fixture(){
 const dom=new JSDOM('<table><tbody id="attendanceBody"><tr data-id="student"></tr></tbody></table><input id="sessionDate" value="2026-11-13"><input id="adminOverride" type="checkbox"><select id="groupSelect"><option value="group">Group</option></select>');
 const calls=[],toasts=[];const state={status:'completed',pending:[],pointsError:null,sessionError:null,delivery:{ok:true},invokeError:null};
 const api={from(table){assert.ok(['groups','sessions'].includes(table),'Forbidden direct table access: '+table);calls.push({table});const q={select(){return q},eq(){return q},async single(){return table==='groups'?{data:{id:'group'}}:{data:{status:state.status},error:state.sessionError}}};return q},async rpc(name,args){calls.push({name,args});assert.equal(name,'get_owner_pending_session_points');return {data:state.pending,error:state.pointsError}},functions:{async invoke(name,args){calls.push({name,args});return {data:state.delivery,error:state.invokeError}}}};
 const ctx=vm.createContext({document:dom.window.document,window:dom.window,console:{error(){},log(){}},showToast:m=>toasts.push(m),getSupabase:async()=>api,localDateISO:()=> '2026-11-13',groupById:()=>({dbId:'group',price:20}),$:id=>dom.window.document.getElementById(id),normalizeSessionStartTime:x=>x,groupSessionStartTime:()=> '16:00',findSessionForGroupDate:async()=>({session:{id:'session',status:'completed'}}),refreshWalaaSessionAccessControl:async()=>{}});
 vm.runInContext(`let currentAppRole='manager',attendanceAccountEditAllowed=true,attendanceCloseInProgress=false;${['verifySavedSessionCompletion','sendParentPushForSession','saveAttendance'].map(n=>functions[n]).join('\n')}`,ctx);
 return {state,calls,toasts,run:s=>vm.runInContext(s,ctx),dom};
}
(async()=>{
 for(const role of ['owner','manager']){
  const h=fixture();h.run(`currentAppRole='${role}'`);await h.run('saveAttendance()');
  assert.equal(h.calls.filter(c=>c.name==='send-parent-push').length,1,'Completed-session recovery reaches notifications');
  assert.equal(h.calls.filter(c=>c.name==='get_owner_pending_session_points').length,1);
  assert.match(h.toasts.at(-1),/دون إعادة التحصيل/);assert.equal(h.run('attendanceCloseInProgress'),false);h.dom.window.close();
 }
 for(const bad of [{status:'scheduled'},{pending:[{id:'pending',status:'approved'}]},{pending:null},{pointsError:{code:'42501'}},{sessionError:{message:'offline'}}]){
  const h=fixture();Object.assign(h.state,bad);await h.run('saveAttendance()');assert.equal(h.calls.filter(c=>c.name==='send-parent-push').length,0,'No delivery after unverified state');assert.match(h.toasts.at(-1),/تعذر التحقق/);h.dom.window.close();
 }
 const h=fixture();h.state.invokeError={message:'network response lost'};await h.run('saveAttendance()');assert.match(h.toasts.at(-1),/إعادة الإرسال فقط/);h.state.invokeError=null;await h.run('saveAttendance()');assert.match(h.toasts.at(-1),/دون إعادة التحصيل/);h.dom.window.close();
 console.log('PASS: owner/employee completed-session verification through RPC-only API, denied direct-table path removed, notification recovery without business writes, pending/malformed/permission/offline failures stop safely, retry after lost notification response.');
})().catch(e=>{console.error(e);process.exit(1)});
