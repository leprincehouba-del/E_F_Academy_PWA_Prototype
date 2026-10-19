-- Proposed atomic save: not applied to production until verified.
-- One PostgreSQL transaction per full roster, with session row locking.
CREATE OR REPLACE FUNCTION public.save_attendance_batch_atomic(
 p_session_id uuid, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
 v_session public.sessions%ROWTYPE;
 v_row jsonb;
 v_student uuid;
 v_status text;
 v_payment text;
 v_points numeric;
 v_details jsonb;
 v_result jsonb;
 v_count integer := 0;
 v_expected integer;
BEGIN
 IF NOT (public.is_owner() OR public.has_permission('attendance_edit')) THEN
   RAISE EXCEPTION 'ATTENDANCE_PERMISSION_DENIED';
 END IF;
 IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows)=0 THEN
   RAISE EXCEPTION 'INVALID_ROSTER';
 END IF;
 SELECT * INTO v_session FROM public.sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
 IF v_session.status='completed' THEN
   RETURN jsonb_build_object('completed',true,'already_completed',true);
 END IF;
 IF v_session.status='cancelled' THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;
 v_expected := jsonb_array_length(p_rows);
 IF (SELECT count(DISTINCT (x->>'student_id')) FROM jsonb_array_elements(p_rows) x)<>v_expected THEN
   RAISE EXCEPTION 'DUPLICATE_STUDENT_IN_ROSTER';
 END IF;
 FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
 LOOP
   v_student := (v_row->>'student_id')::uuid;
   v_status := v_row->>'attendance_status';
   v_payment := v_row->>'payment_status';
   v_points := (v_row->>'points_change')::numeric;
   v_details := coalesce(v_row->'points_details','[]'::jsonb);
   IF v_status NOT IN ('present','late','absent','excused')
      OR v_payment NOT IN ('paid','due','free')
      OR v_points IS NULL OR jsonb_typeof(v_details)<>'array' THEN
      RAISE EXCEPTION 'INVALID_ATTENDANCE_ROW';
   END IF;
   IF NOT public.session_accepts_student(p_session_id,v_student) THEN
      RAISE EXCEPTION 'STUDENT_NOT_IN_SESSION_GROUP';
   END IF;
   IF v_status IN ('absent','excused') THEN v_payment:='free'; END IF;
   -- Package accounting must remain within the same transaction.
   IF public.can_manage_session_packages() THEN
     v_result := public.save_package_attendance_if_available(
       p_session_id,v_student,v_status,v_payment,v_points::integer,v_details,NULL
     );
   ELSE
     v_result := jsonb_build_object('handled',false);
   END IF;
   IF NOT coalesce((v_result->>'handled')::boolean,false) THEN
     PERFORM public.save_safe_attendance_with_account(
       p_session_id,v_student,v_status,v_payment,v_points,v_details,NULL
     );
   END IF;
   v_count := v_count+1;
 END LOOP;
 -- Pending points must be reviewed before this call; this RPC will reject otherwise.
 v_result := public.complete_session_with_pending_points(p_session_id);
 RETURN jsonb_build_object('completed',true,'already_completed',false,
    'saved_count',v_count,'completion',v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.save_attendance_batch_atomic(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_attendance_batch_atomic(uuid,jsonb) TO authenticated;
