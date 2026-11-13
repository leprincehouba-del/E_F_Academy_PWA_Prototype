-- Synthetic only. No notifications are sent to a real parent; all data rolls back.
BEGIN;
DO $test$
DECLARE
 owner_id uuid; gid uuid; student uuid; sid uuid; history_sid uuid;
 r jsonb; pending_id uuid; roster jsonb; before_balance numeric; old_due numeric; i integer;
 day date:=(now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_settings WHERE academy_name LIKE '%STAGING%') THEN RAISE EXCEPTION 'STAGING_MARKER_REQUIRED'; END IF;
 SELECT id INTO owner_id FROM public.user_profiles WHERE phone='01000000531' AND role='owner';
 IF owner_id IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_OWNER_REQUIRED'; END IF;
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 INSERT INTO public.groups(code,name,stage,grade,session_price) VALUES('arrears-'||gen_random_uuid(),'SYNTHETIC ARREARS','prep','prep_1',20) RETURNING id INTO gid;
 INSERT INTO public.students(full_name,group_id,parent_phone,points_balance,created_at)
 VALUES('SYNTHETIC ARREARS STUDENT',gid,'01000000531',100,now()-interval '30 days') RETURNING id INTO student;
 -- Prior attendance/awards stay unchanged after the limit is reached.
 FOR i IN 1..3 LOOP
  INSERT INTO public.sessions(group_id,session_date,start_time,price) VALUES(gid,day-i,'16:00',20) RETURNING id INTO history_sid;
  PERFORM public.save_safe_attendance_with_account(history_sid,student,'present','due',3,'[{"value":3,"reason":"attendance"}]',NULL);
 END LOOP;
 IF (SELECT due_sessions_count FROM public.students WHERE id=student)<>3 THEN RAISE EXCEPTION 'fixture arrears'; END IF;
 SELECT points_balance,due_amount INTO before_balance,old_due FROM public.students WHERE id=student;
 r:=public.add_points_only(student,5,'manual','blocked');
 IF NOT (r->>'blocked')::boolean THEN RAISE EXCEPTION 'standalone award bypass'; END IF;
 r:=public.add_points_only(student,-2,'manual','deduction');
 IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'standalone deduction blocked'; END IF;
 before_balance:=before_balance-2;
 r:=public.queue_manager_points(student,5,'arrears-homework','homework','homework',day);
 IF NOT (r->>'blocked')::boolean THEN RAISE EXCEPTION 'manager positive bypass'; END IF;
 r:=public.queue_owner_teacher_board_point(student,1,'teacher_board_aaaaaaaaaaaaaaaa',day);
 IF NOT (r->>'blocked')::boolean THEN RAISE EXCEPTION 'legacy board bypass'; END IF;
 r:=public.queue_owner_teacher_board_point_with_reason(student,1,'teacher_board_bbbbbbbbbbbbbbbb',day,'homework');
 IF NOT (r->>'blocked')::boolean THEN RAISE EXCEPTION 'reason board bypass'; END IF;
 r:=public.queue_screen_teacher_board_point_with_reason(student,1,'teacher_board_cccccccccccccccc',day,'homework');
 IF NOT (r->>'blocked')::boolean THEN RAISE EXCEPTION 'screen bypass'; END IF;
 r:=public.queue_screen_teacher_board_point_with_reason(student,-1,'teacher_board_dddddddddddddddd',day,'homework');
 IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'board deduction blocked'; END IF;
 -- Approval of an older positive draft cancels it without blocking closure.
 INSERT INTO public.pending_session_points(student_id,group_id,session_date,points,reason_key,reason_type,status,created_by)
 VALUES(student,gid,day,9,'review-overdue','homework','pending',owner_id) RETURNING id INTO pending_id;
 r:=public.review_pending_session_point(pending_id,'approve',9);
 IF NOT (r->>'success')::boolean OR NOT (r->>'blocked')::boolean THEN RAISE EXCEPTION 'review positive bypass'; END IF;
 -- Simulate positive points queued before debt crossed the boundary.
 INSERT INTO public.pending_session_points(student_id,group_id,session_date,points,reason_key,reason_type,status,created_by)
 VALUES(student,gid,day,8,'earlier-homework','homework','approved',owner_id);
 INSERT INTO public.sessions(group_id,session_date,start_time,price) VALUES(gid,day,'16:00',20) RETURNING id INTO sid;
 roster:=jsonb_build_array(jsonb_build_object('student_id',student,'attendance_status','present','payment_status','due',
 'points_change',-1,'points_details','[{"value":3,"reason":"attendance"},{"value":-4,"reason":"manual"}]'::jsonb));
 r:=public.save_attendance_batch_atomic(sid,roster);
 IF NOT (r->>'completed')::boolean THEN RAISE EXCEPTION 'arrears prevented close: %',r; END IF;
 IF (SELECT points_balance FROM public.students WHERE id=student)<>before_balance-5 THEN RAISE EXCEPTION 'mixed attendance/manual/pending points wrong'; END IF;
 IF (SELECT points_change FROM public.attendance WHERE session_id=sid)<>-5 THEN RAISE EXCEPTION 'parent attendance detail wrong'; END IF;
 IF (SELECT due_amount FROM public.students WHERE id=student)<>old_due+20 THEN RAISE EXCEPTION 'debt not recorded'; END IF;
 IF (SELECT count(*) FROM public.attendance WHERE student_id=student AND session_id<>sid AND points_change=3)<>3 THEN RAISE EXCEPTION 'prior awards changed'; END IF;
 -- Lost response and another-device retry must retain the normalized result.
 r:=public.save_attendance_batch_atomic(sid,roster);
 IF NOT (r->>'already_completed')::boolean OR coalesce((r->>'conflict')::boolean,false) THEN RAISE EXCEPTION 'retry conflict: %',r; END IF;
 IF (SELECT points_balance FROM public.students WHERE id=student)<>before_balance-5 THEN RAISE EXCEPTION 'retry points duplicated'; END IF;
 IF (SELECT count(*) FROM public.attendance WHERE session_id=sid)<>1 THEN RAISE EXCEPTION 'retry attendance duplicated'; END IF;
 IF (SELECT count(*) FROM public.payments WHERE student_id=student)<>0 THEN RAISE EXCEPTION 'unexpected financial payment'; END IF;
 -- Existing historical positive components must survive a legacy resave.
 PERFORM public.save_safe_attendance(history_sid,student,'present',3,'[{"value":3,"reason":"attendance"}]',NULL);
 IF (SELECT points_balance FROM public.students WHERE id=student)<>before_balance-5 THEN RAISE EXCEPTION 'historical resave changed awards'; END IF;
 -- All payment statuses still block awards; cash receipts remain exactly once.
 INSERT INTO public.sessions(group_id,session_date,start_time,price) VALUES(gid,day+1,'16:00',20) RETURNING id INTO sid;
 roster:=jsonb_build_array(jsonb_build_object('student_id',student,'attendance_status','present','payment_status','paid',
 'points_change',8,'points_details','[{"value":3,"reason":"attendance"},{"value":5,"reason":"manual"}]'::jsonb));
 r:=public.save_attendance_batch_atomic(sid,roster);
 IF NOT (r->>'completed')::boolean THEN RAISE EXCEPTION 'paid blocked close'; END IF;
 r:=public.save_attendance_batch_atomic(sid,roster);
 IF NOT (r->>'already_completed')::boolean THEN RAISE EXCEPTION 'paid retry'; END IF;
 IF (SELECT count(*) FROM public.payments WHERE student_id=student)<>1 THEN RAISE EXCEPTION 'cash duplicate'; END IF;
 IF (SELECT points_balance FROM public.students WHERE id=student)<>before_balance-5 THEN RAISE EXCEPTION 'cash bypass points'; END IF;
 -- Settlement uses the actual existing payment RPC on this synthetic student.
 PERFORM public.pay_student_due_balance(student,old_due+20,'cash');
 IF (SELECT due_sessions_count FROM public.students WHERE id=student)<>0 THEN RAISE EXCEPTION 'settlement fixture failed'; END IF;
 r:=public.add_points_only(student,7,'manual','settled');
 IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'settlement did not restore awards'; END IF;
END;
$test$;
ROLLBACK;
