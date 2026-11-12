-- Resume a legacy partial attendance save without repeating existing business effects.
-- The whole validation, missing-row save, pending-point application and close run
-- in one transaction under the session row lock.
CREATE OR REPLACE FUNCTION public.save_attendance_batch_atomic(
  p_session_id uuid,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_row jsonb;
  v_student uuid;
  v_status text;
  v_payment text;
  v_points numeric;
  v_details jsonb;
  v_requested_details jsonb;
  v_existing_details jsonb;
  v_manager_points numeric;
  v_existing public.attendance%ROWTYPE;
  v_result jsonb;
  v_expected integer;
  v_saved_count integer;
  v_existing_count integer := 0;
  v_inserted_count integer := 0;
  v_expected_ids uuid[];
  v_supplied_ids uuid[];
  v_pending_count integer;
  v_receipt_count integer;
  v_already_completed boolean;
BEGIN
  IF NOT public.can_manage_session_packages() THEN
    RAISE EXCEPTION 'ATTENDANCE_PERMISSION_DENIED';
  END IF;

  IF p_rows IS NULL
     OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID_ROSTER';
  END IF;

  -- All current and legacy attendance writers take this same lock. It is the
  -- serialization boundary for two devices saving the same session.
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF v_session.status = 'cancelled' THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;
  v_already_completed := v_session.status = 'completed';

  v_expected := jsonb_array_length(p_rows);
  IF (
    SELECT count(DISTINCT (x->>'student_id'))
    FROM jsonb_array_elements(p_rows) x
  ) <> v_expected THEN
    RAISE EXCEPTION 'DUPLICATE_STUDENT_IN_ROSTER';
  END IF;

  SELECT coalesce(
    array_agg((x->>'student_id')::uuid ORDER BY (x->>'student_id')::uuid),
    ARRAY[]::uuid[]
  ) INTO v_supplied_ids
  FROM jsonb_array_elements(p_rows) x;

  IF v_already_completed THEN
    -- Once closed, attendance is the immutable roster snapshot. Students added
    -- to the group later must not make an old retry look incomplete.
    SELECT coalesce(array_agg(a.student_id ORDER BY a.student_id), ARRAY[]::uuid[])
    INTO v_expected_ids
    FROM public.attendance a
    WHERE a.session_id = p_session_id;
  ELSE
    -- For a scheduled/partial session, include the historical group roster plus
    -- any already-saved or pending student retained by the session snapshot.
    SELECT coalesce(array_agg(ids.student_id ORDER BY ids.student_id), ARRAY[]::uuid[])
    INTO v_expected_ids
    FROM (
      SELECT st.id AS student_id
      FROM public.students st
      WHERE st.group_id = v_session.group_id
        AND st.is_active = true
        AND (
          st.created_at IS NULL
          OR st.created_at <= (
            v_session.session_date + coalesce(v_session.start_time, time '00:00')
          ) AT TIME ZONE 'Africa/Cairo'
        )
      UNION
      SELECT a.student_id
      FROM public.attendance a
      WHERE a.session_id = p_session_id
      UNION
      SELECT p.student_id
      FROM public.pending_session_points p
      WHERE p.group_id = v_session.group_id
        AND p.session_date = v_session.session_date
        AND p.status IN ('pending', 'approved')
    ) ids;
  END IF;

  IF v_expected_ids IS DISTINCT FROM v_supplied_ids THEN
    RETURN jsonb_build_object(
      'completed', v_already_completed,
      'already_completed', v_already_completed,
      'conflict', true,
      'code', 'ROSTER_CHANGED_OR_INCOMPLETE'
    );
  END IF;

  SELECT count(*)::integer INTO v_pending_count
  FROM public.pending_session_points p
  WHERE p.group_id = v_session.group_id
    AND p.session_date = v_session.session_date
    AND p.status IN ('pending', 'approved');

  IF v_already_completed AND v_pending_count > 0 THEN
    RETURN jsonb_build_object(
      'completed', true,
      'already_completed', true,
      'conflict', true,
      'code', 'COMPLETED_SESSION_HAS_UNAPPLIED_POINTS'
    );
  END IF;

  IF NOT v_already_completed AND EXISTS (
    SELECT 1
    FROM public.pending_session_points p
    WHERE p.group_id = v_session.group_id
      AND p.session_date = v_session.session_date
      AND p.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'PENDING_POINTS_REQUIRE_REVIEW';
  END IF;

  -- Preflight every requested and existing row before the first mutation.
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_student := (v_row->>'student_id')::uuid;
    v_status := v_row->>'attendance_status';
    v_payment := v_row->>'payment_status';
    v_points := (v_row->>'points_change')::numeric;
    v_details := coalesce(v_row->'points_details', '[]'::jsonb);

    IF v_student IS NULL THEN RAISE EXCEPTION 'MISSING_STUDENT_ID'; END IF;
    IF v_points IS NULL OR v_points <> trunc(v_points) THEN
      RAISE EXCEPTION 'NON_INTEGER_POINTS';
    END IF;
    IF v_status NOT IN ('present', 'late', 'absent', 'excused')
       OR v_payment NOT IN ('paid', 'due', 'free')
       OR jsonb_typeof(v_details) <> 'array' THEN
      RAISE EXCEPTION 'INVALID_ATTENDANCE_ROW';
    END IF;
    IF NOT public.session_accepts_student(p_session_id, v_student) THEN
      RAISE EXCEPTION 'STUDENT_NOT_IN_SESSION_GROUP';
    END IF;

    IF v_status IN ('absent', 'excused') THEN v_payment := 'free'; END IF;

    SELECT coalesce(jsonb_agg(d.detail ORDER BY d.ord), '[]'::jsonb)
    INTO v_requested_details
    FROM jsonb_array_elements(v_details) WITH ORDINALITY d(detail, ord)
    WHERE coalesce(d.detail->>'source', '') <> 'manager_pending'
      AND coalesce(d.detail->>'reason', '') <> 'package_payment';

    SELECT * INTO v_existing
    FROM public.attendance a
    WHERE a.session_id = p_session_id
      AND a.student_id = v_student
    FOR UPDATE;

    IF NOT FOUND THEN
      IF v_already_completed THEN
        RETURN jsonb_build_object(
          'completed', true,
          'already_completed', true,
          'conflict', true,
          'code', 'COMPLETED_SESSION_MISSING_ATTENDANCE',
          'student_id', v_student
        );
      END IF;
      CONTINUE;
    END IF;

    v_existing_count := v_existing_count + 1;

    SELECT
      coalesce(jsonb_agg(d.detail ORDER BY d.ord)
        FILTER (WHERE coalesce(d.detail->>'source', '') <> 'manager_pending'
          AND coalesce(d.detail->>'reason', '') <> 'package_payment'), '[]'::jsonb),
      coalesce(sum(
        CASE
          WHEN coalesce(d.detail->>'source', '') = 'manager_pending'
            AND jsonb_typeof(d.detail->'value') = 'number'
          THEN (d.detail->>'value')::numeric
          ELSE 0
        END
      ), 0)
    INTO v_existing_details, v_manager_points
    FROM jsonb_array_elements(coalesce(v_existing.points_details, '[]'::jsonb))
      WITH ORDINALITY d(detail, ord);

    IF v_existing.attendance_status IS DISTINCT FROM v_status
       OR (
         v_existing.payment_status IS DISTINCT FROM v_payment
         AND NOT (
           coalesce(v_existing.package_consumed, false)
           AND v_existing.payment_status = 'paid'
           AND v_payment = 'due'
         )
       )
       OR coalesce(v_existing.points_change, 0) - v_manager_points IS DISTINCT FROM v_points
       OR v_existing_details IS DISTINCT FROM v_requested_details THEN
      RETURN jsonb_build_object(
        'completed', v_already_completed,
        'already_completed', v_already_completed,
        'conflict', true,
        'code', 'EXISTING_ATTENDANCE_CONFLICT',
        'student_id', v_student
      );
    END IF;

    SELECT count(*)::integer INTO v_receipt_count
    FROM public.payments pay
    WHERE pay.attendance_id = v_existing.id;

    IF coalesce(v_existing.package_consumed, false) THEN
      IF v_existing.package_id IS NULL OR v_receipt_count <> 0 THEN
        RETURN jsonb_build_object(
          'completed', v_already_completed,
          'already_completed', v_already_completed,
          'conflict', true,
          'code', 'PACKAGE_FINANCIAL_STATE_CONFLICT',
          'student_id', v_student
        );
      END IF;
    ELSIF v_existing.payment_status = 'paid'
          AND coalesce(v_existing.charge_amount, 0) > 0 THEN
      IF v_receipt_count <> 1 THEN
        RETURN jsonb_build_object(
          'completed', v_already_completed,
          'already_completed', v_already_completed,
          'conflict', true,
          'code', 'PAYMENT_RECEIPT_STATE_CONFLICT',
          'student_id', v_student
        );
      END IF;
    ELSIF v_existing.payment_status IN ('due', 'free') THEN
      IF v_receipt_count <> 0
         OR coalesce(v_existing.package_consumed, false)
         OR (v_existing.payment_status = 'free' AND coalesce(v_existing.charge_amount, 0) <> 0) THEN
        RETURN jsonb_build_object(
          'completed', v_already_completed,
          'already_completed', v_already_completed,
          'conflict', true,
          'code', 'ATTENDANCE_FINANCIAL_STATE_CONFLICT',
          'student_id', v_student
        );
      END IF;
    END IF;
  END LOOP;

  IF v_already_completed THEN
    RETURN jsonb_build_object(
      'completed', true,
      'already_completed', true,
      'same_payload', true,
      'saved_count', v_existing_count
    );
  END IF;

  -- Validation succeeded. Write only missing students; existing rows and their
  -- receipts/package consumption/points remain byte-for-byte untouched.
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_student := (v_row->>'student_id')::uuid;

    IF EXISTS (
      SELECT 1 FROM public.attendance a
      WHERE a.session_id = p_session_id AND a.student_id = v_student
    ) THEN
      CONTINUE;
    END IF;

    v_status := v_row->>'attendance_status';
    v_payment := v_row->>'payment_status';
    v_points := (v_row->>'points_change')::numeric;
    v_details := coalesce(v_row->'points_details', '[]'::jsonb);
    IF v_status IN ('absent', 'excused') THEN v_payment := 'free'; END IF;

    IF v_status IN ('present', 'late') AND v_payment <> 'free' THEN
      v_result := public.save_package_attendance_if_available(
        p_session_id, v_student, v_status, v_payment,
        v_points::integer, v_details, NULL
      );
    ELSE
      v_result := jsonb_build_object('handled', false);
    END IF;

    IF NOT coalesce((v_result->>'handled')::boolean, false) THEN
      PERFORM public.save_safe_attendance_with_account(
        p_session_id, v_student, v_status, v_payment,
        v_points, v_details, NULL
      );
    END IF;

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  v_result := public.complete_session_with_pending_points(p_session_id);

  SELECT count(*)::integer INTO v_saved_count
  FROM public.attendance
  WHERE session_id = p_session_id;

  IF v_saved_count <> v_expected
     OR NOT EXISTS (
       SELECT 1 FROM public.sessions
       WHERE id = p_session_id AND status = 'completed'
     ) THEN
    RAISE EXCEPTION 'ATOMIC_COMPLETION_INVARIANT_FAILED';
  END IF;

  RETURN jsonb_build_object(
    'completed', true,
    'already_completed', false,
    'resumed_partial', v_existing_count > 0,
    'existing_count', v_existing_count,
    'inserted_count', v_inserted_count,
    'saved_count', v_saved_count,
    'applied_count', coalesce((v_result->>'applied_count')::integer, 0),
    'completion', v_result
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_attendance_batch_atomic(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_attendance_batch_atomic(uuid, jsonb)
  TO authenticated;
