BEGIN;
DO $test$
DECLARE
  owner_id uuid := '11111111-1111-1111-1111-111111111111';
  staff_id uuid := '22222222-2222-2222-2222-222222222222';
  gid uuid;
  student uuid;
  scheduled_session uuid;
  unscheduled_session uuid;
  roster jsonb;
  result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE academy_name LIKE '%STAGING%') THEN
    RAISE EXCEPTION 'STAGING_MARKER_REQUIRED';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  INSERT INTO public.groups(code,name,stage,grade,session_price)
    VALUES('synthetic-attendance-schedule','Synthetic schedule','prep','prep_1',20) RETURNING id INTO gid;
  INSERT INTO public.group_schedules(group_id,day_name,start_time,is_active)
    VALUES(gid,'الجمعة','16:00',true),(gid,'السبت','16:00',false);
  INSERT INTO public.students(full_name,group_id,parent_phone,created_at)
    VALUES('Synthetic attendance',gid,'01000000534','2026-11-01') RETURNING id INTO student;
  INSERT INTO public.sessions(group_id,session_date,start_time,price)
    VALUES(gid,'2026-11-28','16:00',20) RETURNING id INTO unscheduled_session;

  roster := jsonb_build_array(jsonb_build_object('student_id',student,'attendance_status','present',
    'payment_status','paid','points_change',3,'points_details','[{"reason":"attendance","value":3}]'::jsonb));
  PERFORM set_config('request.jwt.claim.sub', staff_id::text, true);
  SET LOCAL ROLE authenticated;
  IF NOT EXISTS (SELECT 1 FROM public.group_schedules WHERE group_id=gid AND is_active) THEN
    RAISE EXCEPTION 'attendance staff must see schedule even without schedule-view permission';
  END IF;
  BEGIN
    INSERT INTO public.sessions(group_id,session_date,start_time,price) VALUES(gid,'2026-11-29','16:00',20);
    RAISE EXCEPTION 'unscheduled insert passed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'SESSION_NOT_ON_SCHEDULE' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.save_attendance_batch_atomic(unscheduled_session,roster);
    RAISE EXCEPTION 'unscheduled atomic close passed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'SESSION_NOT_ON_SCHEDULE' THEN RAISE; END IF;
  END;

  INSERT INTO public.sessions(group_id,session_date,start_time,price)
    VALUES(gid,'2026-11-27','16:00',20) RETURNING id INTO scheduled_session;
  result := public.save_attendance_batch_atomic(scheduled_session,roster);
  IF result->>'completed' IS DISTINCT FROM 'true' OR
     NOT EXISTS (SELECT 1 FROM public.get_attendance_workspace_rows(scheduled_session) r
       WHERE r.student_id=student AND r.attendance_status='present' AND r.points_change=3) THEN
    RAISE EXCEPTION 'scheduled attendance must complete and restore without board or manager points';
  END IF;
  IF EXISTS (SELECT 1 FROM public.attendance WHERE session_id=scheduled_session) THEN
    RAISE EXCEPTION 'raw attendance unexpectedly visible to employee';
  END IF;

  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.attendance WHERE session_id=unscheduled_session) OR
     (SELECT count(*) FROM public.payments WHERE student_id=student) <> 1 THEN
    RAISE EXCEPTION 'rejected session left attendance or duplicate payment';
  END IF;
  UPDATE public.manager_permissions SET permissions='{"points_edit":true}' WHERE user_id=staff_id;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.get_attendance_workspace_rows(scheduled_session);
    RAISE EXCEPTION 'points-only account could see attendance';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'ATTENDANCE_PERMISSION_DENIED' THEN RAISE; END IF;
  END;
END;
$test$;
ROLLBACK;
