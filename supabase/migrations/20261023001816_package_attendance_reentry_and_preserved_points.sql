-- Preserve one attendance row, cash receipts and approved employee points through package re-entry.
CREATE OR REPLACE FUNCTION public.save_package_attendance_if_available(p_session_id uuid, p_student_id uuid, p_attendance_status text, p_requested_payment_status text, p_points_change integer, p_points_details jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_date date;
  v_session_group_id uuid;
  v_session_start_time time;
  v_attendance public.attendance%ROWTYPE;
  v_package public.student_session_packages%ROWTYPE;
  v_chargeable boolean;
  v_old_points numeric := 0;
  v_preserved_points numeric := 0;
  v_effective_points numeric := 0;
  v_preserved_details jsonb := '[]'::jsonb;
  v_remaining integer := 0;
  v_details jsonb := COALESCE(p_points_details, '[]'::jsonb);
BEGIN
 PERFORM 1 FROM public.sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;

  IF NOT public.can_manage_session_packages() THEN RAISE EXCEPTION 'PACKAGE_PERMISSION_DENIED'; END IF;
  IF p_attendance_status NOT IN ('present','late','absent','excused') THEN RAISE EXCEPTION 'INVALID_ATTENDANCE_STATUS'; END IF;
  IF p_requested_payment_status NOT IN ('paid','due','free') THEN RAISE EXCEPTION 'INVALID_PAYMENT_STATUS'; END IF;

  SELECT se.session_date,se.group_id,se.start_time INTO v_session_date,v_session_group_id,v_session_start_time
  FROM public.sessions se WHERE se.id=p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;

  IF NOT public.session_accepts_student(p_session_id,p_student_id) THEN
    RAISE EXCEPTION 'STUDENT_NOT_IN_SESSION_GROUP';
  END IF;

  SELECT * INTO v_attendance FROM public.attendance a
  WHERE a.session_id=p_session_id AND a.student_id=p_student_id FOR UPDATE;
  IF FOUND THEN
    v_old_points:=COALESCE(v_attendance.points_change,0);
    SELECT coalesce(jsonb_agg(x.detail ORDER BY x.ord),'[]'::jsonb),
      coalesce(sum(CASE WHEN jsonb_typeof(x.detail->'value')='number' THEN (x.detail->>'value')::numeric ELSE 0 END),0)
    INTO v_preserved_details,v_preserved_points
    FROM jsonb_array_elements(coalesce(v_attendance.points_details,'[]'::jsonb)) WITH ORDINALITY x(detail,ord)
    WHERE coalesce(x.detail->>'source','')='manager_pending';
  END IF;
  SELECT coalesce(jsonb_agg(x.detail ORDER BY x.ord),'[]'::jsonb) INTO v_details
  FROM jsonb_array_elements(v_details) WITH ORDINALITY x(detail,ord)
  WHERE coalesce(x.detail->>'source','')<>'manager_pending' AND coalesce(x.detail->>'reason','')<>'package_payment';
  v_details:=v_details||v_preserved_details;
  v_effective_points:=coalesce(p_points_change,0)+v_preserved_points;

  v_chargeable:=p_attendance_status IN ('present','late');

  IF COALESCE(v_attendance.package_consumed,false) THEN
    IF v_chargeable AND p_requested_payment_status<>'free' THEN
      v_details:=v_details||jsonb_build_array(jsonb_build_object('value',0,'reason','package_payment','reason_label','من الباقة'));
      UPDATE public.attendance SET attendance_status=p_attendance_status,payment_status='paid',
        charge_amount=COALESCE(v_attendance.charge_amount,0),paid_amount=COALESCE(v_attendance.charge_amount,0),
        points_change=v_effective_points,points_details=v_details,notes=p_notes,package_consumed=true
      WHERE id=v_attendance.id;
      UPDATE public.students SET points_balance=COALESCE(points_balance,0)+v_effective_points-v_old_points,updated_at=now() WHERE id=p_student_id;
      PERFORM public.sync_student_due_totals(p_student_id);
      SELECT COALESCE(SUM(sessions_remaining),0)::integer INTO v_remaining FROM public.student_session_packages WHERE student_id=p_student_id AND status<>'cancelled';
      RETURN jsonb_build_object('handled',true,'used_package',true,'restored_package',false,'remaining_sessions',v_remaining);
    END IF;
    UPDATE public.student_session_packages SET sessions_remaining=sessions_remaining+1,status='active' WHERE id=v_attendance.package_id;
    UPDATE public.attendance SET attendance_status=p_attendance_status,
      payment_status=CASE WHEN v_chargeable THEN p_requested_payment_status ELSE 'free' END,
      charge_amount=CASE WHEN v_chargeable AND p_requested_payment_status<>'free' THEN COALESCE(v_attendance.charge_amount,0) ELSE 0 END,
      paid_amount=0,points_change=v_effective_points,points_details=v_details,notes=p_notes,package_id=NULL,package_consumed=false
    WHERE id=v_attendance.id;
    UPDATE public.students SET points_balance=COALESCE(points_balance,0)+v_effective_points-v_old_points,updated_at=now() WHERE id=p_student_id;
    PERFORM public.sync_student_due_totals(p_student_id);
    SELECT COALESCE(SUM(sessions_remaining),0)::integer INTO v_remaining FROM public.student_session_packages WHERE student_id=p_student_id AND status<>'cancelled';
    RETURN jsonb_build_object('handled',true,'used_package',false,'restored_package',true,'remaining_sessions',v_remaining);
  END IF;

  IF NOT v_chargeable OR p_requested_payment_status='free' THEN
    RETURN jsonb_build_object('handled',false,'used_package',false,'remaining_sessions',0);
  END IF;

  -- Existing cash/partial payments must not be charged again through a package.
  IF v_attendance.id IS NOT NULL AND (
    coalesce(v_attendance.paid_amount,0)>0
    OR (v_attendance.payment_status='paid' AND coalesce(v_attendance.charge_amount,0)>0)
    OR EXISTS(SELECT 1 FROM public.payments cash_receipt WHERE cash_receipt.attendance_id=v_attendance.id)
  ) THEN RETURN jsonb_build_object('handled',false,'used_package',false,'remaining_sessions',0); END IF;

  SELECT p.* INTO v_package FROM public.student_session_packages p
  WHERE p.student_id=p_student_id AND p.status='active' AND p.sessions_remaining>0
    AND (p.starts_on<v_session_date OR (p.starts_on=v_session_date AND p.purchased_at<((v_session_date+COALESCE(v_session_start_time,time '00:00')+interval '1 hour') AT TIME ZONE 'Africa/Cairo')))
  ORDER BY p.starts_on,p.purchased_at,p.id LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('handled',false,'used_package',false,'remaining_sessions',0); END IF;

  UPDATE public.student_session_packages SET sessions_remaining=sessions_remaining-1,
    status=CASE WHEN sessions_remaining-1=0 THEN 'depleted' ELSE 'active' END WHERE id=v_package.id;
  v_details:=v_details||jsonb_build_array(jsonb_build_object('value',0,'reason','package_payment','reason_label','من الباقة'));

  IF v_attendance.id IS NULL THEN
    INSERT INTO public.attendance(session_id,student_id,attendance_status,payment_status,charge_amount,paid_amount,points_change,points_details,notes,package_id,package_consumed)
    VALUES(p_session_id,p_student_id,p_attendance_status,'paid',v_package.unit_price,v_package.unit_price,v_effective_points,v_details,p_notes,v_package.id,true);
  ELSE
    -- A restored/previously free attendance row already owns the unique session/student key.
    UPDATE public.attendance SET attendance_status=p_attendance_status,payment_status='paid',
      charge_amount=v_package.unit_price,paid_amount=v_package.unit_price,
      points_change=v_effective_points,points_details=v_details,notes=p_notes,
      package_id=v_package.id,package_consumed=true WHERE id=v_attendance.id;
  END IF;

  UPDATE public.students SET points_balance=COALESCE(points_balance,0)+v_effective_points-v_old_points,updated_at=now() WHERE id=p_student_id;
  PERFORM public.sync_student_due_totals(p_student_id);
  SELECT COALESCE(SUM(sessions_remaining),0)::integer INTO v_remaining FROM public.student_session_packages WHERE student_id=p_student_id AND status<>'cancelled';
  RETURN jsonb_build_object('handled',true,'used_package',true,'restored_package',false,'remaining_sessions',v_remaining,'package_id',v_package.id);
END;
$function$;
