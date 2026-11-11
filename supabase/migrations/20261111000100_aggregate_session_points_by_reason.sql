-- Keep every pending/transaction event for auditability, but store the
-- attendance summary consumed by employee and parent screens as one net row
-- per student + reason for the session.
CREATE OR REPLACE FUNCTION public.complete_session_with_pending_points(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_is_active boolean := false;
  v_session public.sessions%rowtype;
  v_student record;
  v_details jsonb;
  v_total numeric(10,2);
  v_applied_count integer := 0;
  v_total_points numeric(10,2) := 0;
  v_pending_count integer := 0;
  v_unmatched_approved_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT up.role, up.is_active
  INTO v_role, v_is_active
  FROM public.user_profiles up
  WHERE up.id = v_user_id;

  IF NOT coalesce(v_is_active, false)
     OR NOT (
       v_role = 'owner'
       OR (v_role = 'manager' AND public.has_permission('attendance_edit'))
     ) THEN
    RAISE EXCEPTION 'Attendance edit permission required';
  END IF;

  SELECT *
  INTO v_session
  FROM public.sessions s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_session.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled session cannot be completed';
  END IF;
  IF v_session.status = 'completed' THEN
    RETURN jsonb_build_object(
      'completed', true,
      'already_completed', true,
      'applied_count', 0,
      'total_points', 0
    );
  END IF;

  SELECT count(*)::integer
  INTO v_pending_count
  FROM public.pending_session_points p
  WHERE p.group_id = v_session.group_id
    AND p.session_date = v_session.session_date
    AND p.status = 'pending';

  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'PENDING_POINTS_REQUIRE_REVIEW:%', v_pending_count;
  END IF;

  SELECT count(*)::integer
  INTO v_unmatched_approved_count
  FROM public.pending_session_points p
  WHERE p.group_id = v_session.group_id
    AND p.session_date = v_session.session_date
    AND p.status = 'approved'
    AND NOT EXISTS (
      SELECT 1
      FROM public.attendance a
      WHERE a.session_id = v_session.id
        AND a.student_id = p.student_id
    );

  IF v_unmatched_approved_count > 0 THEN
    RAISE EXCEPTION 'APPROVED_POINTS_WITHOUT_ATTENDANCE:%', v_unmatched_approved_count;
  END IF;

  FOR v_student IN
    SELECT p.student_id, sum(p.points)::numeric(10,2) AS total_points
    FROM public.pending_session_points p
    WHERE p.group_id = v_session.group_id
      AND p.session_date = v_session.session_date
      AND p.status = 'approved'
    GROUP BY p.student_id
  LOOP
    v_total := v_student.total_points;

    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'value', detail.total_points,
          'reason', detail.summary_reason,
          'reason_label', detail.reason_label,
          'source', 'manager_pending',
          'record_count', detail.record_count
        )
        ORDER BY detail.first_created_at, detail.reason_label
      ),
      '[]'::jsonb
    )
    INTO v_details
    FROM (
      SELECT
        sum(p.points)::numeric(10,2) AS total_points,
        min(p.created_at) AS first_created_at,
        count(*)::integer AS record_count,
        regexp_replace(
          coalesce(p.reason_text, p.reason_key, 'نقاط'),
          '^تراجع عن:\s*',
          '',
          'g'
        ) AS reason_label,
        CASE
          WHEN bool_or(p.reason_key LIKE 'teacher_board_%') THEN
            'teacher_board_reason:' || md5(
              regexp_replace(
                coalesce(p.reason_text, p.reason_key, 'نقاط'),
                '^تراجع عن:\s*',
                '',
                'g'
              )
            )
          ELSE min(p.reason_key)
        END AS summary_reason
      FROM public.pending_session_points p
      WHERE p.group_id = v_session.group_id
        AND p.session_date = v_session.session_date
        AND p.status = 'approved'
        AND p.student_id = v_student.student_id
      GROUP BY
        coalesce(p.reason_type, 'manual'),
        regexp_replace(
          coalesce(p.reason_text, p.reason_key, 'نقاط'),
          '^تراجع عن:\s*',
          '',
          'g'
        )
      HAVING sum(p.points) <> 0
    ) detail;

    UPDATE public.students s
    SET points_balance = coalesce(s.points_balance, 0) + v_total
    WHERE s.id = v_student.student_id;

    UPDATE public.attendance a
    SET
      points_change = coalesce(a.points_change, 0) + v_total,
      points_details = coalesce(a.points_details, '[]'::jsonb)
        || coalesce(v_details, '[]'::jsonb)
    WHERE a.session_id = v_session.id
      AND a.student_id = v_student.student_id;
  END LOOP;

  SELECT count(*)::integer, coalesce(sum(p.points), 0)::numeric(10,2)
  INTO v_applied_count, v_total_points
  FROM public.pending_session_points p
  WHERE p.group_id = v_session.group_id
    AND p.session_date = v_session.session_date
    AND p.status = 'approved';

  -- Preserve each original record in the immutable transaction history.
  INSERT INTO public.point_transactions (
    student_id,
    points,
    reason_type,
    reason_text
  )
  SELECT p.student_id, p.points, p.reason_type, p.reason_text
  FROM public.pending_session_points p
  WHERE p.group_id = v_session.group_id
    AND p.session_date = v_session.session_date
    AND p.status = 'approved';

  UPDATE public.pending_session_points p
  SET
    status = 'applied',
    applied_session_id = v_session.id,
    applied_at = now(),
    updated_at = now()
  WHERE p.group_id = v_session.group_id
    AND p.session_date = v_session.session_date
    AND p.status = 'approved';

  UPDATE public.sessions
  SET status = 'completed'
  WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'completed', true,
    'already_completed', false,
    'applied_count', v_applied_count,
    'total_points', v_total_points
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_session_with_pending_points(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_session_with_pending_points(uuid) TO authenticated, service_role;
