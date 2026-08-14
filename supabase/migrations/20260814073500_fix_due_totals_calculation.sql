CREATE OR REPLACE FUNCTION public.sync_student_due_totals(p_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_due_amount numeric := 0;
  v_due_sessions integer := 0;
BEGIN
  SELECT
    COALESCE(
      SUM(
        GREATEST(
          COALESCE(charge_amount, 0) - COALESCE(paid_amount, 0),
          0
        )
      ) FILTER (
        WHERE payment_status = 'due'
      ),
      0
    ),
    COUNT(*) FILTER (
      WHERE payment_status = 'due'
        AND GREATEST(
          COALESCE(charge_amount, 0) - COALESCE(paid_amount, 0),
          0
        ) > 0
    )::integer
  INTO
    v_due_amount,
    v_due_sessions
  FROM public.attendance
  WHERE student_id = p_student_id;

  UPDATE public.students
  SET
    due_amount = v_due_amount,
    due_sessions_count = v_due_sessions,
    updated_at = now()
  WHERE id = p_student_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_student_due_totals(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_student_due_totals(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.sync_student_due_totals(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_student_due_totals(uuid) TO service_role;

DO $$
DECLARE
  v_student record;
BEGIN
  FOR v_student IN
    SELECT s.id
    FROM public.students s
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          SUM(
            GREATEST(
              COALESCE(a.charge_amount, 0) - COALESCE(a.paid_amount, 0),
              0
            )
          ) FILTER (
            WHERE a.payment_status = 'due'
          ),
          0
        ) AS real_due_amount,
        COUNT(*) FILTER (
          WHERE a.payment_status = 'due'
            AND GREATEST(
              COALESCE(a.charge_amount, 0) - COALESCE(a.paid_amount, 0),
              0
            ) > 0
        )::integer AS real_due_sessions
      FROM public.attendance a
      WHERE a.student_id = s.id
    ) x ON true
    WHERE
      s.due_amount IS DISTINCT FROM x.real_due_amount
      OR s.due_sessions_count IS DISTINCT FROM x.real_due_sessions
  LOOP
    PERFORM public.sync_student_due_totals(v_student.id);
  END LOOP;
END;
$$;
