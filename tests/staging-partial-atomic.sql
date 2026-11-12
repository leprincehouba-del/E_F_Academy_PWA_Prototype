-- STAGING ONLY: resume a legacy partial save and prove every business effect is
-- exactly-once. All synthetic changes are rolled back.
BEGIN;
DO $test$
#variable_conflict use_variable
DECLARE
  owner_id uuid; gid uuid; sid uuid; conflict_sid uuid;
  cash_student uuid; due_student uuid; package_student uuid;
  roster jsonb; result jsonb; cash_attendance uuid;
  cash_receipts_before integer; package_remaining_before integer;
  cash_points_before numeric; conflict_snapshot jsonb;
  test_date date := current_date + 20;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE academy_name LIKE '%STAGING%') THEN
    RAISE EXCEPTION 'STAGING_MARKER_REQUIRED';
  END IF;
  SELECT id INTO owner_id FROM public.user_profiles
    WHERE phone='01000000531' AND role='owner';
  IF owner_id IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_OWNER_REQUIRED'; END IF;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);

  INSERT INTO public.groups(code,name,stage,grade,session_price)
  VALUES('partial-'||gen_random_uuid(),'SYNTHETIC PARTIAL ATOMIC','prep','prep_1',20)
  RETURNING id INTO gid;
  INSERT INTO public.students(full_name,group_id,parent_phone,points_balance)
  VALUES('SYNTHETIC PARTIAL CASH',gid,'01000000534',100) RETURNING id INTO cash_student;
  INSERT INTO public.students(full_name,group_id,parent_phone,points_balance)
  VALUES('SYNTHETIC PARTIAL DUE',gid,'01000000534',200) RETURNING id INTO due_student;
  INSERT INTO public.students(full_name,group_id,parent_phone,points_balance)
  VALUES('SYNTHETIC PARTIAL PACKAGE',gid,'01000000534',300) RETURNING id INTO package_student;
  PERFORM public.purchase_student_session_package_custom(package_student,'cash',gen_random_uuid(),8);

  INSERT INTO public.sessions(group_id,session_date,start_time,price)
  VALUES(gid,test_date,'16:00',20) RETURNING id INTO sid;

  -- Simulate the legacy path losing connectivity after two of three students.
  PERFORM public.save_safe_attendance_with_account(
    sid,cash_student,'present','paid',1,'[]'::jsonb,NULL);
  PERFORM public.save_package_attendance_if_available(
    sid,package_student,'present','paid',10,'[]'::jsonb,NULL);
  INSERT INTO public.pending_session_points(
    student_id,group_id,session_date,points,reason_key,reason_type,
    reason_text,status,created_by)
  VALUES(cash_student,gid,test_date,1,'partial_board_participation',
    'participation','المشاركة','approved',owner_id);

  SELECT id INTO cash_attendance FROM public.attendance
    WHERE session_id=sid AND student_id=cash_student;
  SELECT count(*) INTO cash_receipts_before FROM public.payments
    WHERE attendance_id=cash_attendance;
  SELECT sessions_remaining INTO package_remaining_before
    FROM public.student_session_packages WHERE student_id=package_student;
  SELECT points_balance INTO cash_points_before FROM public.students WHERE id=cash_student;

  roster := jsonb_build_array(
    jsonb_build_object('student_id',cash_student,'attendance_status','present',
      'payment_status','paid','points_change',1,'points_details','[]'::jsonb),
    jsonb_build_object('student_id',due_student,'attendance_status','present',
      'payment_status','due','points_change',2,'points_details','[]'::jsonb),
    jsonb_build_object('student_id',package_student,'attendance_status','present',
      'payment_status','paid','points_change',10,'points_details','[]'::jsonb)
  );
  result := public.save_attendance_batch_atomic(sid,roster);

  IF NOT coalesce((result->>'completed')::boolean,false)
     OR NOT coalesce((result->>'resumed_partial')::boolean,false)
     OR (result->>'existing_count')::integer <> 2
     OR (result->>'inserted_count')::integer <> 1 THEN
    RAISE EXCEPTION 'PARTIAL_RESUME_RESULT_WRONG: %',result;
  END IF;
  IF (SELECT count(*) FROM public.attendance WHERE session_id=sid) <> 3 THEN
    RAISE EXCEPTION 'PARTIAL_RESUME_ROSTER_INCOMPLETE';
  END IF;
  IF (SELECT count(*) FROM public.payments WHERE attendance_id=cash_attendance)
       <> cash_receipts_before THEN RAISE EXCEPTION 'PARTIAL_RESUME_DUPLICATED_RECEIPT'; END IF;
  IF (SELECT sessions_remaining FROM public.student_session_packages
      WHERE student_id=package_student) <> package_remaining_before THEN
    RAISE EXCEPTION 'PARTIAL_RESUME_CONSUMED_PACKAGE_TWICE';
  END IF;
  IF (SELECT points_balance FROM public.students WHERE id=cash_student)
       <> cash_points_before + 1 THEN RAISE EXCEPTION 'BOARD_POINT_NOT_APPLIED_EXACTLY_ONCE'; END IF;
  IF (SELECT points_change FROM public.attendance
      WHERE session_id=sid AND student_id=cash_student) <> 2 THEN
    RAISE EXCEPTION 'ATTENDANCE_POINT_TOTAL_WRONG_AFTER_RESUME';
  END IF;
  IF (SELECT count(*) FROM public.pending_session_points
      WHERE student_id=cash_student AND status='applied') <> 1 THEN
    RAISE EXCEPTION 'PENDING_POINT_NOT_PRESERVED';
  END IF;

  -- Lost response / retry after commit must be an idempotent read of the same result.
  result := public.save_attendance_batch_atomic(sid,roster);
  IF NOT coalesce((result->>'already_completed')::boolean,false)
     OR NOT coalesce((result->>'same_payload')::boolean,false) THEN
    RAISE EXCEPTION 'COMPLETED_RETRY_NOT_IDEMPOTENT: %',result;
  END IF;
  IF (SELECT count(*) FROM public.payments WHERE attendance_id=cash_attendance)
       <> cash_receipts_before
     OR (SELECT sessions_remaining FROM public.student_session_packages
         WHERE student_id=package_student) <> package_remaining_before
     OR (SELECT points_balance FROM public.students WHERE id=cash_student)
         <> cash_points_before + 1 THEN
    RAISE EXCEPTION 'COMPLETED_RETRY_REPEATED_BUSINESS_EFFECT';
  END IF;

  -- A conflicting payload must stop before adding the missing students or money.
  INSERT INTO public.sessions(group_id,session_date,start_time,price)
  VALUES(gid,test_date+1,'16:00',20) RETURNING id INTO conflict_sid;
  PERFORM public.save_safe_attendance_with_account(
    conflict_sid,cash_student,'present','paid',1,'[]'::jsonb,NULL);
  SELECT jsonb_build_object(
    'attendance',(SELECT jsonb_agg(a ORDER BY a.id) FROM public.attendance a
      WHERE a.session_id=conflict_sid),
    'payments',(SELECT jsonb_agg(p ORDER BY p.id) FROM public.payments p
      WHERE p.attendance_id IN (SELECT id FROM public.attendance WHERE session_id=conflict_sid)),
    'cash_points',(SELECT points_balance FROM public.students WHERE id=cash_student),
    'package_remaining',(SELECT sessions_remaining FROM public.student_session_packages
      WHERE student_id=package_student)
  ) INTO conflict_snapshot;
  result := public.save_attendance_batch_atomic(conflict_sid,
    jsonb_set(roster,'{0,attendance_status}','"late"'::jsonb));
  IF NOT coalesce((result->>'conflict')::boolean,false)
     OR result->>'code' <> 'EXISTING_ATTENDANCE_CONFLICT' THEN
    RAISE EXCEPTION 'CONFLICT_NOT_REJECTED_SAFELY: %',result;
  END IF;
  IF conflict_snapshot IS DISTINCT FROM jsonb_build_object(
    'attendance',(SELECT jsonb_agg(a ORDER BY a.id) FROM public.attendance a
      WHERE a.session_id=conflict_sid),
    'payments',(SELECT jsonb_agg(p ORDER BY p.id) FROM public.payments p
      WHERE p.attendance_id IN (SELECT id FROM public.attendance WHERE session_id=conflict_sid)),
    'cash_points',(SELECT points_balance FROM public.students WHERE id=cash_student),
    'package_remaining',(SELECT sessions_remaining FROM public.student_session_packages
      WHERE student_id=package_student)
  ) THEN RAISE EXCEPTION 'CONFLICT_MUTATED_FINANCIAL_DATA'; END IF;
  IF (SELECT status FROM public.sessions WHERE id=conflict_sid) <> 'scheduled' THEN
    RAISE EXCEPTION 'CONFLICT_CLOSED_SESSION';
  END IF;
END $test$;
SELECT 'PASS: partial resume, lost-response retry, board points, cash/due/package and conflict safe-stop are exactly-once' AS result;
ROLLBACK;
