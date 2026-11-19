-- Synthetic only: verify signed board points through the actual close pipeline.
BEGIN;
DO $test$
DECLARE owner_id uuid; gid uuid; student uuid; sid uuid; r jsonb; event_key text; day date:=(now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_settings WHERE academy_name LIKE '%STAGING%') THEN RAISE EXCEPTION 'STAGING_MARKER_REQUIRED'; END IF;
 SELECT id INTO STRICT owner_id FROM public.user_profiles WHERE phone='01000000531' AND role='owner';
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 INSERT INTO public.groups(code,name,stage,grade,session_price) VALUES('deduction-'||gen_random_uuid(),'SYNTHETIC NEGATIVE BOARD','prep','prep_1',0) RETURNING id INTO gid;
 INSERT INTO public.students(full_name,group_id,parent_phone,points_balance) VALUES('SYNTHETIC ZERO POINTS',gid,'01000000531',0) RETURNING id INTO student;
 event_key:='teacher_board_'||replace(gen_random_uuid()::text,'-','');
 r:=public.queue_screen_teacher_board_point_with_reason(student,-1,event_key,day,'participation');
 IF NOT coalesce((r->>'success')::boolean,false) THEN RAISE EXCEPTION 'zero-point deduction rejected: %',r; END IF;
 r:=public.queue_screen_teacher_board_point_with_reason(student,-1,event_key,day,'participation');
 IF NOT coalesce((r->>'already_applied')::boolean,false) THEN RAISE EXCEPTION 'deduction retry not deduplicated: %',r; END IF;
 r:=public.queue_screen_teacher_board_point_with_reason(student,-1,'teacher_board_'||replace(gen_random_uuid()::text,'-',''),day,'participation');
 IF NOT coalesce((r->>'success')::boolean,false) THEN RAISE EXCEPTION 'second deduction rejected'; END IF;
 IF (SELECT sum(points) FROM public.pending_session_points WHERE student_id=student)<>-2 THEN RAISE EXCEPTION 'employee pending total wrong'; END IF;
 INSERT INTO public.sessions(group_id,session_date,start_time,price) VALUES(gid,day,'16:00',0) RETURNING id INTO sid;
 r:=public.save_attendance_batch_atomic(sid,jsonb_build_array(jsonb_build_object('student_id',student,'attendance_status','present','payment_status','free','points_change',0,'points_details','[]'::jsonb)));
 IF NOT coalesce((r->>'completed')::boolean,false) THEN RAISE EXCEPTION 'negative points blocked closing: %',r; END IF;
 IF (SELECT points_balance FROM public.students WHERE id=student)<>-2 THEN RAISE EXCEPTION 'negative balance clamped'; END IF;
 IF (SELECT points_change FROM public.attendance WHERE session_id=sid AND student_id=student)<>-2 THEN RAISE EXCEPTION 'attendance deduction missing'; END IF;
 IF (SELECT sum((d->>'value')::numeric) FROM public.attendance a CROSS JOIN LATERAL jsonb_array_elements(a.points_details) d WHERE a.session_id=sid AND d->>'reason_label'='المشاركة')<>-2 THEN RAISE EXCEPTION 'parent reason total missing'; END IF;
 IF (SELECT sum(points) FROM public.point_transactions WHERE student_id=student)<>-2 THEN RAISE EXCEPTION 'audit total wrong'; END IF;
 IF (SELECT count(*) FROM public.payments WHERE student_id=student)<>0 THEN RAISE EXCEPTION 'unexpected financial mutation'; END IF;
END;
$test$;
ROLLBACK;
