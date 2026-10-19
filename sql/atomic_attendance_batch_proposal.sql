-- Proposed atomic save: not applied to production until verified.
-- One PostgreSQL transaction per supplied roster, with session row locking.
-- IMPORTANT: draft ONLY; full roster IDs are validated but historical/moved-student cases need testing,
-- manager permissions, pre-existing partial sessions, and package edge cases.
-- Never deploy this proposal without integration tests.
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
 v_existing_count integer;
 v_saved_count integer;
 v_completion_ok boolean;
 v_expected_ids uuid[];
 v_supplied_ids uuid[];
 v_pending_count integer;
BEGIN
 IF NOT public.is_owner() THEN
   RAISE EXCEPTION 'ATTENDANCE_PERMISSION_DENIED';
 END IF;
 IF NOT public.can_manage_session_packages() THEN
   RAISE EXCEPTION 'PACKAGE_PERMISSION_REQUIRED';
 END IF;
 IF p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)=0 THEN
   RAISE EXCEPTION 'INVALID_ROSTER';
 END IF;
 SELECT * INTO v_session FROM public.sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
 IF v_session.status='completed' THEN
   RETURN jsonb_build_object('completed',true,'already_completed',true);
 END IF;
 IF v_session.status='cancelled' THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;
 -- Never mix a new atomic request with rows left by the old multi-call workflow.
 SELECT count(*) INTO v_existing_count FROM public.attendance WHERE session_id=p_session_id;
 IF v_existing_count > 0 THEN
   RAISE EXCEPTION 'EXISTING_PARTIAL_SESSION_REQUIRES_MANUAL_REVIEW';
 END IF;
 v_expected := jsonb_array_length(p_rows);
 IF (SELECT count(DISTINCT (x->>'student_id')) FROM jsonb_array_elements(p_rows) x)<>v_expected THEN
   RAISE EXCEPTION 'DUPLICATE_STUDENT_IN_ROSTER';
 END IF;
 -- Snapshot the full eligible roster under the session lock. Do not complete
 -- a truncated request: equality checks IDs, not only counts.
 SELECT coalesce(array_agg(st.id ORDER BY st.id),ARRAY[]::uuid[])
 INTO v_expected_ids
 FROM public.students st
 WHERE st.group_id=v_session.group_id AND st.is_active=true;
 SELECT coalesce(array_agg((x->>'student_id')::uuid ORDER BY (x->>'student_id')::uuid),ARRAY[]::uuid[])
 INTO v_supplied_ids FROM jsonb_array_elements(p_rows) x;
 IF v_expected_ids IS DISTINCT FROM v_supplied_ids THEN
   RAISE EXCEPTION 'ROSTER_CHANGED_OR_INCOMPLETE';
 END IF;
 -- A pending Walaa entry must be reviewed before the batch starts;
 -- reject before any money, package or points mutation.
 SELECT count(*) INTO v_pending_count
 FROM public.pending_session_points p
 WHERE p.group_id=v_session.group_id AND p.session_date=v_session.session_date
   AND p.status='pending';
 IF v_pending_count > 0 THEN RAISE EXCEPTION 'PENDING_POINTS_REQUIRE_REVIEW'; END IF;
 FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
 LOOP
   v_student := (v_row->>'student_id')::uuid;
   v_status := v_row->>'attendance_status';
   v_payment := v_row->>'payment_status';
   v_points := (v_row->>'points_change')::numeric;
   v_details := coalesce(v_row->'points_details','[]'::jsonb);
   IF v_points IS NULL OR v_points <> trunc(v_points) THEN RAISE EXCEPTION 'NON_INTEGER_POINTS'; END IF;
   IF v_payment IS NULL OR v_status IS NULL THEN RAISE EXCEPTION 'MISSING_STATUS'; END IF;
   IF v_status NOT IN ('present','late','absent','excused')
      OR v_payment NOT IN ('paid','due','free')
      OR v_points IS NULL OR jsonb_typeof(v_details)<>'array' THEN
      RAISE EXCEPTION 'INVALID_ATTENDANCE_ROW';
   END IF;
   IF v_student IS NULL THEN RAISE EXCEPTION 'MISSING_STUDENT_ID'; END IF;
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
 SELECT count(*) INTO v_saved_count FROM public.attendance WHERE session_id=p_session_id;
 SELECT status = 'completed' INTO v_completion_ok FROM public.sessions WHERE id=p_session_id;
 IF v_saved_count <> v_expected OR NOT coalesce(v_completion_ok,false) THEN
   RAISE EXCEPTION 'ATOMIC_COMPLETION_INVARIANT_FAILED';
 END IF;
 RETURN jsonb_build_object('completed',true,'already_completed',false,
    'saved_count',v_count,'completion',v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.save_attendance_batch_atomic(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_attendance_batch_atomic(uuid,jsonb) TO authenticated;
