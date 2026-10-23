// Concurrent authenticated HTTP calls to the isolated database, using synthetic fixtures.
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
(async()=>{
 const s=JSON.parse(fs.readFileSync(process.env.STAGING_TEST_CONFIG || (()=>{throw Error('STAGING_TEST_CONFIG required')})()));assert.equal(s.project,'ahvmvimruxtprukmhvgh');
 const login=await fetch(s.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:s.key,'Content-Type':'application/json'},body:JSON.stringify({email:'01000000531@efacademy.local',password:s.staffPassword})});const auth=await login.json();assert.equal(login.status,200);
 const headers={apikey:s.key,Authorization:'Bearer '+auth.access_token,'Content-Type':'application/json',Prefer:'return=representation'};
 const request=async(path,body,method='POST')=>{const r=await fetch(s.url+'/rest/v1/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data};
 const [group]=await request('groups',{code:'net-'+randomUUID(),name:'SYNTHETIC CONCURRENCY',stage:'prep',grade:'prep_1',session_price:20});
 const students=await request('students',[{full_name:'SYNTHETIC NETWORK CASH',group_id:group.id,parent_phone:'01000000531',points_balance:199,notes:'SYNTHETIC CONCURRENCY FIXTURE'},{full_name:'SYNTHETIC NETWORK PACKAGE',group_id:group.id,parent_phone:'01000000531',points_balance:190,notes:'SYNTHETIC CONCURRENCY FIXTURE'}]);
 const token=randomUUID();await Promise.all([request('rpc/purchase_student_session_package_custom',{p_student_id:students[1].id,p_payment_method:'cash',p_request_token:token,p_sessions:8}),request('rpc/purchase_student_session_package_custom',{p_student_id:students[1].id,p_payment_method:'cash',p_request_token:token,p_sessions:8})]);
 const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);const [session]=await request('sessions',{group_id:group.id,session_date:date,start_time:'16:00',price:20});
 const body={p_session_id:session.id,p_rows:students.map((st,i)=>({student_id:st.id,attendance_status:'present',payment_status:'paid',points_change:i?10:1,points_details:[]}))};
 const results=await Promise.all([request('rpc/save_attendance_batch_atomic',body),request('rpc/save_attendance_batch_atomic',body)]);
 assert.equal(results.filter(r=>r.already_completed===false).length,1);assert.equal(results.filter(r=>r.already_completed===true).length,1);
 // Treat the first response as lost: reconcile the committed session, then retry.
 const state=await request('sessions?id=eq.'+session.id+'&select=status',undefined,'GET');assert.equal(state[0].status,'completed');assert.equal((await request('rpc/save_attendance_batch_atomic',body)).already_completed,true);
 const ids=students.map(x=>x.id).join(',');const payments=await request('payments?student_id=in.('+ids+')&select=amount',undefined,'GET');assert.equal(payments.length,2);assert.equal(payments.reduce((a,p)=>a+Number(p.amount),0),180);
 // Package tables are intentionally RPC-only for authenticated callers.
 const balances=await request('rpc/get_student_session_package_balances',{p_student_ids:[students[1].id]});assert.equal(Number(balances[0].remaining_sessions),7);
 const rewards=await request('student_milestone_rewards?student_id=in.('+ids+')&select=student_id,milestone_points',undefined,'GET');assert.equal(rewards.length,2);
 console.log('PASS: simultaneous real HTTP package purchases and full-session submissions, one receipt per purchase, one completion, no repeated points/award/cash/package consumption, and retry after discarded response.');
})().catch(e=>{console.error(e);process.exit(1)});
