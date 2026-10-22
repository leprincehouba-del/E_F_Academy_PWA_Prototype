// Real PostgreSQL (WASM), synthetic schema and accounts only. No network.
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite(); let checks=0;
 const check=(v,m)=>{assert.ok(v,m);checks++};
 const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222',parent='33333333-3333-3333-3333-333333333333',owner='44444444-4444-4444-4444-444444444444',other='55555555-5555-5555-5555-555555555555',sub='66666666-6666-6666-6666-666666666666';
 const q=async sql=>(await db.query(sql)).rows;
 const n=async sql=>Number(Object.values((await q(sql))[0])[0]);
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,role text,is_active boolean,phone text);
 CREATE TABLE public.students(id uuid PRIMARY KEY,full_name text,parent_phone text,points_balance numeric,is_active boolean);
 CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),student_id uuid,parent_phone text,channel text NOT NULL,title text NOT NULL,body text NOT NULL,status text NOT NULL DEFAULT 'pending',created_at timestamptz DEFAULT now(),read_at timestamptz,sent_at timestamptz);
 CREATE TABLE public.push_subscriptions(id uuid PRIMARY KEY,user_id uuid,endpoint text,subscription jsonb);
 INSERT INTO user_profiles VALUES('${parent}','parent',true,'01012345678'),('${owner}','owner',true,''),('${other}','parent',true,'01099999999');
 INSERT INTO students VALUES('${a}','Test A','01012345678',199,true),('${b}','Test B','01099999999',0,true);
 INSERT INTO push_subscriptions VALUES('${sub}','${parent}','https://test.invalid/device','{}');
 GRANT USAGE ON SCHEMA public,auth TO authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
 const migration=fs.readFileSync('supabase/migrations/20261022000100_student_milestone_rewards.sql','utf8');
 await db.exec(migration);await db.exec(migration);check(true,'migration repeat');
 await db.exec(`UPDATE students SET points_balance=200 WHERE id='${a}'`);
 check(await n('SELECT count(*) FROM student_milestone_rewards')===1,'200 first award');
 await db.exec(`UPDATE students SET points_balance=199 WHERE id='${a}';UPDATE students SET points_balance=200 WHERE id='${a}';UPDATE students SET points_balance=650 WHERE id='${a}';UPDATE students SET points_balance=0 WHERE id='${a}';UPDATE students SET points_balance=650 WHERE id='${a}'`);
 check(await n('SELECT count(*) FROM student_milestone_rewards')===3,'200/400/600 retained exactly once');
 check(await n('SELECT count(*) FROM notifications')===3,'one notification per milestone');
 await db.exec(`SELECT record_student_milestone_rewards('${a}',650)`);check(await n('SELECT count(*) FROM notifications')===3,'retry no extra notification');
 // Simulate unavailable notifications and then repair after points dropped.
 await db.exec(`CREATE FUNCTION fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected outage';END $$;CREATE TRIGGER fail_notification BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_notification();UPDATE students SET points_balance=800 WHERE id='${a}'`);
 check(await n(`SELECT count(*) FROM student_milestone_rewards WHERE milestone_points=800`)===1,'award survives notification outage');
 check(await n(`SELECT count(*) FROM student_milestone_rewards WHERE notification_id IS NULL`)===1,'repair remains identifiable');
 await db.exec(`UPDATE students SET points_balance=100 WHERE id='${a}';DROP TRIGGER fail_notification ON notifications;SELECT prepare_milestone_push()`);
 check(await n('SELECT count(*) FROM notifications')===4,'notification repaired below threshold');
 check(await n('SELECT count(*) FROM rewards_private.push_deliveries')===4,'per device queue');
 await db.exec('SELECT prepare_milestone_push()');check(await n('SELECT count(*) FROM rewards_private.push_deliveries')===4,'queue unique');
 let jobs=await q('SELECT * FROM claim_milestone_push(2)');check(jobs.length===2,'bounded claim');
 const second=await q('SELECT * FROM claim_milestone_push(100)');check(second.length===2,'leases exclude existing worker');
 const j=jobs[0];const finish=(lease,result)=>`SELECT finish_milestone_push('${j.student_id}',${j.milestone_points},'${j.subscription_id}','${lease}','${result}')`;
 check(!(await q(finish(crypto.randomUUID(),'sent')))[0].finish_milestone_push,'stale ack rejected');
 check((await q(finish(j.lease_token,'sent')))[0].finish_milestone_push,'valid ack');
 check(!(await q(finish(j.lease_token,'retry')))[0].finish_milestone_push,'ack cannot revert sent');
 check((await q('SELECT * FROM claim_milestone_push(100)')).length===0,'sent/inflight cannot resend');
 await db.exec("UPDATE rewards_private.push_deliveries SET lease_until=now()-interval '1 minute' WHERE state='sending'");
 check((await q('SELECT * FROM claim_milestone_push(100)')).length===3,'crashed worker recoverable');
 // Current relationship checked when claiming, not a stale phone snapshot.
 await db.exec(`UPDATE rewards_private.push_deliveries SET state='pending';UPDATE user_profiles SET phone='01000000000' WHERE id='${parent}'`);
 check((await q('SELECT * FROM claim_milestone_push(100)')).length===0,'former parent not delivered');
 await db.exec(`UPDATE user_profiles SET phone='01012345678' WHERE id='${parent}'`);
 // Auth and row isolation using actual PostgreSQL roles, not a mock predicate.
 await db.exec(`SELECT set_config('test.uid','${parent}',false);SET ROLE authenticated`);
 check(await n('SELECT count(*) FROM student_milestone_rewards')===4,'parent sees own awards');
 check((await q(`SELECT * FROM get_parent_milestone_rewards('${a}')`)).length===4,'parent inbox');
 check((await q(`SELECT open_parent_milestone('${a}',200)`))[0].open_parent_milestone,'first open accepted');
 check(!(await q(`SELECT open_parent_milestone('${a}',200)`))[0].open_parent_milestone,'second device/open suppressed');
 check(!(await q(`SELECT open_parent_milestone('${a}',1000)`))[0].open_parent_milestone,'unearned link rejected');
 async function denied(sql){try{await db.exec(sql);assert.fail('Expected forbidden')}catch(e){check(/FORBIDDEN|permission denied/.test(e.message),'authorization '+e.message)}}
 await denied(`SELECT open_parent_milestone('${b}',200)`);await denied('SELECT prepare_milestone_push()');await denied(`INSERT INTO student_milestone_rewards(student_id,milestone_points) VALUES('${a}',1000)`);
 await db.exec(`RESET ROLE;UPDATE user_profiles SET is_active=false WHERE id='${parent}';SET ROLE authenticated`);
 check(await n('SELECT count(*) FROM student_milestone_rewards')===0,'inactive parent no read');await denied(`SELECT * FROM get_parent_milestone_rewards('${a}')`);
 await db.exec(`RESET ROLE;SELECT set_config('test.uid','${owner}',false);SET ROLE authenticated`);
 check(await n('SELECT count(*) FROM student_milestone_rewards')===4,'owner read');await db.exec('RESET ROLE');
 // Award subsystem failure must preserve durable high water and normal points write.
 await db.exec(`CREATE FUNCTION fail_award() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'award outage';END $$;CREATE TRIGGER fail_award BEFORE INSERT ON student_milestone_rewards FOR EACH ROW EXECUTE FUNCTION fail_award();UPDATE students SET points_balance=1000 WHERE id='${a}';UPDATE students SET points_balance=50 WHERE id='${a}';DROP TRIGGER fail_award ON student_milestone_rewards;SELECT prepare_milestone_push()`);
 check(await n(`SELECT points_balance FROM students WHERE id='${a}'`)===50,'points write survives award outage');
 check(await n('SELECT count(*) FROM student_milestone_rewards')===5,'high water repairs dropped balance');
 // Explicit retrospective preview/apply, synthetic pre-existing student.
 await db.exec(`ALTER TABLE students DISABLE TRIGGER trg_student_milestone_rewards;UPDATE students SET points_balance=600 WHERE id='${b}';ALTER TABLE students ENABLE TRIGGER trg_student_milestone_rewards`);
 await db.exec('SELECT prepare_milestone_push()');
 check(await n(`SELECT count(*) FROM student_milestone_rewards WHERE student_id='${b}'`)===0,'dispatcher cannot silently backfill legacy students');
 check((await q('SELECT * FROM backfill_student_milestones(false)')).length===3,'backfill dry run');
 const before=await n('SELECT count(*) FROM notifications');
 await db.exec('SELECT backfill_student_milestones(true);SELECT backfill_student_milestones(true)');
 check(await n('SELECT count(*) FROM notifications')===before+3,'backfill repeat idempotent');
 check(await n(`SELECT points_balance FROM students WHERE id='${b}'`)===600,'backfill leaves points');
 check((await q('SELECT * FROM backfill_student_milestones(false)')).length===0,'backfill complete');
 // A broken optional marker must not block business points writes.
 await db.exec(`CREATE FUNCTION fail_peak() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'marker outage';END $$;CREATE TRIGGER fail_peak BEFORE INSERT OR UPDATE ON rewards_private.point_peaks FOR EACH ROW EXECUTE FUNCTION fail_peak();UPDATE students SET points_balance=1200 WHERE id='${a}';DROP TRIGGER fail_peak ON rewards_private.point_peaks`);
 check(await n(`SELECT points_balance FROM students WHERE id='${a}'`)===1200,'marker failure cannot prevent normal points save');
 await db.exec('SELECT prepare_milestone_push()');
 check(await n(`SELECT count(*) FROM student_milestone_rewards WHERE student_id='${a}'`)===6,'reconcile unmarked current balance');
 // Legacy backfill may have an award but no marker; notification repair still
 // has to work after a balance decrease below the first milestone.
 await db.exec(`DELETE FROM rewards_private.point_peaks WHERE student_id='${b}';UPDATE students SET points_balance=50 WHERE id='${b}';DELETE FROM notifications WHERE id=(SELECT notification_id FROM student_milestone_rewards WHERE student_id='${b}' AND milestone_points=600)`);
 check(await n(`SELECT count(*) FROM student_milestone_rewards WHERE student_id='${b}' AND notification_id IS NULL`)===1,'legacy orphan fixture');
 await db.exec('SELECT prepare_milestone_push()');
 check(await n(`SELECT count(*) FROM student_milestone_rewards WHERE student_id='${b}' AND notification_id IS NULL`)===0,'legacy orphan repaired below 200');
 const anon=await q("SELECT has_function_privilege('anon','public.open_parent_milestone(uuid,integer)','EXECUTE') allowed");check(!anon[0].allowed,'anonymous receipt access denied');
 console.log(`PASS: ${checks} milestone PostgreSQL assertions (awards, failures, repair, queue leasing, RLS, receipts, backfill).`);
 await db.close();
})().catch(e=>{console.error(e);process.exit(1)});
