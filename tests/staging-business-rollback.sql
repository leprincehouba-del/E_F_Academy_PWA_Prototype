-- STAGING ONLY: synthetic fixture marker required. All changes roll back.
BEGIN;
DO $test$
DECLARE owner_id uuid; gid uuid; sid uuid; a uuid; b uuid; c uuid; result jsonb; roster jsonb; before_snapshot jsonb; after_snapshot jsonb; token uuid:=gen_random_uuid();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_settings WHERE academy_name LIKE '%STAGING%') THEN RAISE EXCEPTION 'STAGING_MARKER_REQUIRED'; END IF;
 SELECT id INTO owner_id FROM public.user_profiles WHERE phone='01000000531' AND role='owner';
 IF owner_id IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_OWNER_REQUIRED'; END IF;
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 INSERT INTO public.groups(code,name,stage,grade,session_price) VALUES('rollback-'||gen_random_uuid(),'SYNTHETIC REGRESSION','prep','prep_1',20) RETURNING id INTO gid;
 INSERT INTO public.students(full_name,group_id,parent_phone,points_balance) VALUES('SYNTHETIC CASH',gid,'01000000534',199) RETURNING id INTO a;
 INSERT INTO public.students(full_name,group_id,parent_phone,points_balance) VALUES('SYNTHETIC DUE',gid,'01000000534',390) RETURNING id INTO b;
 INSERT INTO public.students(full_name,group_id,parent_phone,points_balance) VALUES('SYNTHETIC PACKAGE',gid,'01000000534',590) RETURNING id INTO c;
 PERFORM public.purchase_student_session_package_custom(c,'cash',token,8);
 PERFORM public.purchase_student_session_package_custom(c,'cash',token,8);
 IF (SELECT count(*) FROM public.payments WHERE student_id=c)<>1 THEN RAISE EXCEPTION 'PACKAGE_RETRY_DUPLICATED_RECEIPT'; END IF;
 INSERT INTO public.sessions(group_id,session_date,start_time,price) VALUES(gid,current_date+1,'16:00',20) RETURNING id INTO sid;
 roster:=jsonb_build_array(jsonb_build_object('student_id',a,'attendance_status','present','payment_status','paid','points_change',1,'points_details','[]'::jsonb),jsonb_build_object('student_id',b,'attendance_status','present','payment_status','due','points_change',10,'points_details','[]'::jsonb),jsonb_build_object('student_id',c,'attendance_status','present','payment_status','paid','points_change',10,'points_details','[]'::jsonb));
 result:=public.save_attendance_batch_atomic(sid,roster);
 IF NOT (result->>'completed')::boolean THEN RAISE EXCEPTION 'NOT_COMPLETED'; END IF;
 IF (SELECT count(*) FROM public.attendance WHERE session_id=sid)<>3 THEN RAISE EXCEPTION 'ROSTER_NOT_COMPLETE'; END IF;
 IF (SELECT points_balance FROM public.students WHERE id=a)<>200 OR (SELECT points_balance FROM public.students WHERE id=b)<>400 OR (SELECT points_balance FROM public.students WHERE id=c)<>600 THEN RAISE EXCEPTION 'POINTS_MISMATCH'; END IF;
 IF (SELECT sum(amount) FROM public.payments WHERE student_id IN(a,b,c))<>180 THEN RAISE EXCEPTION 'PAYMENT_TOTAL_MISMATCH'; END IF;
 IF (SELECT sessions_remaining FROM public.student_session_packages WHERE student_id=c)<>7 THEN RAISE EXCEPTION 'PACKAGE_CONSUMPTION_MISMATCH'; END IF;
 IF (SELECT count(*) FROM public.student_milestone_rewards WHERE student_id IN(a,b,c))<>6 THEN RAISE EXCEPTION 'MILESTONE_MISMATCH'; END IF;
 result:=public.save_attendance_batch_atomic(sid,roster);
 IF NOT (result->>'already_completed')::boolean THEN RAISE EXCEPTION 'RETRY_NOT_DETECTED'; END IF;
 IF (SELECT sum(amount) FROM public.payments WHERE student_id IN(a,b,c))<>180 OR (SELECT sessions_remaining FROM public.student_session_packages WHERE student_id=c)<>7 THEN RAISE EXCEPTION 'RETRY_FINANCIAL_DUPLICATION'; END IF;
 BEGIN
  PERFORM public.purchase_student_session_package_custom(b,'cash',gen_random_uuid(),8);
  RAISE EXCEPTION 'EXPECTED_ARREARS_REJECTION';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='EXPECTED_ARREARS_REJECTION' THEN RAISE; END IF;
 END;
 PERFORM public.pay_student_due_balance(b,10,'cash');
 IF (SELECT due_amount FROM public.students WHERE id=b)<>10 THEN RAISE EXCEPTION 'PARTIAL_PAYMENT_MISMATCH'; END IF;
 PERFORM public.pay_student_due_balance(b,10,'cash');
 IF (SELECT due_amount FROM public.students WHERE id=b)<>0 THEN RAISE EXCEPTION 'DUE_CLEAR_MISMATCH'; END IF;
 PERFORM public.purchase_student_session_package_custom(b,'cash',gen_random_uuid(),8);
 -- Award and backfill must leave business records byte-for-byte unchanged.
 SELECT jsonb_build_object('attendance',(SELECT jsonb_agg(t ORDER BY id) FROM public.attendance t WHERE student_id IN(a,b,c)),'payments',(SELECT jsonb_agg(t ORDER BY id) FROM public.payments t WHERE student_id IN(a,b,c)),'packages',(SELECT jsonb_agg(t ORDER BY id) FROM public.student_session_packages t WHERE student_id IN(a,b,c))) INTO before_snapshot;
 PERFORM public.add_points_only(a,-100,'manual','SYNTHETIC balance decline');PERFORM public.add_points_only(a,100,'manual','SYNTHETIC threshold restored');PERFORM public.backfill_student_milestones(true);PERFORM public.backfill_student_milestones(true);
 SELECT jsonb_build_object('attendance',(SELECT jsonb_agg(t ORDER BY id) FROM public.attendance t WHERE student_id IN(a,b,c)),'payments',(SELECT jsonb_agg(t ORDER BY id) FROM public.payments t WHERE student_id IN(a,b,c)),'packages',(SELECT jsonb_agg(t ORDER BY id) FROM public.student_session_packages t WHERE student_id IN(a,b,c))) INTO after_snapshot;
 IF before_snapshot IS DISTINCT FROM after_snapshot THEN RAISE EXCEPTION 'BUSINESS_DATA_CHANGED_BY_REWARDS'; END IF;
 IF (SELECT count(*) FROM public.student_milestone_rewards WHERE student_id=a)<>1 THEN RAISE EXCEPTION 'REPEATED_AWARD'; END IF;
 -- A bad later row must roll the entire new session's earlier writes back.
 INSERT INTO public.sessions(group_id,session_date,start_time,price) VALUES(gid,current_date+2,'16:00',20) RETURNING id INTO sid;
 BEGIN
  PERFORM public.save_attendance_batch_atomic(sid,jsonb_set(roster,'{1,attendance_status}','"invalid"'));
  RAISE EXCEPTION 'EXPECTED_INVALID_ROW_REJECTION';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='EXPECTED_INVALID_ROW_REJECTION' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.attendance WHERE session_id=sid) THEN RAISE EXCEPTION 'PARTIAL_ATOMIC_WRITE'; END IF;
 IF (SELECT points_balance FROM public.students WHERE id=a)<>200 THEN RAISE EXCEPTION 'FAILED_BATCH_CHANGED_POINTS'; END IF;
END $test$;
SELECT 'PASS: real deployed RPCs: cash/due/package, threshold awards, purchase/session retry, partial/full arrears, unchanged business snapshots, repeated backfill and invalid-row rollback' AS result;
ROLLBACK;
