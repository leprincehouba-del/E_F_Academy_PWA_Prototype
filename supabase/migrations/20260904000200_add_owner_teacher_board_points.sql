BEGIN;

-- Each board tap has its own event key. The partial unique index makes retrying
-- after a weak connection safe without preventing repeated taps for a student.
CREATE UNIQUE INDEX IF NOT EXISTS pending_session_points_teacher_board_event_unique
  ON public.pending_session_points (created_by, reason_key)
  WHERE left(reason_key, 14) = 'teacher_board_';

CREATE OR REPLACE FUNCTION public.queue_owner_teacher_board_point(
  p_student_id uuid,
  p_points numeric,
  p_event_key text,
  p_session_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_group_id uuid;
  v_pending_id uuid;
  v_reason_key text;
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = v_user_id
      AND up.role = 'owner'
      AND up.is_active = true
  ) THEN
    RAISE EXCEPTION 'TEACHER_BOARD_OWNER_REQUIRED';
  END IF;

  IF p_student_id IS NULL OR p_session_date IS NULL THEN
    RAISE EXCEPTION 'TEACHER_BOARD_STUDENT_AND_DATE_REQUIRED';
  END IF;

  IF p_points NOT IN (-1, 1) THEN
    RAISE EXCEPTION 'TEACHER_BOARD_POINT_MUST_BE_ONE';
  END IF;

  IF p_session_date <> v_today THEN
    RETURN jsonb_build_object(
      'success', false,
      'blocked', true,
      'message', 'يمكن تسجيل نقاط السبورة لحصة اليوم فقط'
    );
  END IF;

  IF p_event_key IS NULL
     OR p_event_key !~ '^teacher_board_[a-zA-Z0-9]{16,80}$' THEN
    RAISE EXCEPTION 'INVALID_TEACHER_BOARD_EVENT_KEY';
  END IF;

  v_reason_key := p_event_key;

  SELECT s.group_id
  INTO v_group_id
  FROM public.students s
  WHERE s.id = p_student_id
    AND COALESCE(s.is_active, true) = true;

  IF v_group_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'blocked', true,
      'message', 'الطالب غير موجود أو غير نشط'
    );
  END IF;

  SELECT psp.id
  INTO v_pending_id
  FROM public.pending_session_points psp
  WHERE psp.created_by = v_user_id
    AND psp.reason_key = v_reason_key
  LIMIT 1;

  IF v_pending_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'queued', true,
      'already_applied', true,
      'pending_id', v_pending_id
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sessions se
    WHERE se.group_id = v_group_id
      AND se.session_date = p_session_date
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'closed', true,
      'message', 'الحصة مسجلة أو بدأ إغلاقها بالفعل'
    );
  END IF;

  INSERT INTO public.pending_session_points (
    student_id,
    group_id,
    session_date,
    points,
    reason_key,
    reason_type,
    reason_text,
    status,
    created_by
  )
  VALUES (
    p_student_id,
    v_group_id,
    p_session_date,
    p_points,
    v_reason_key,
    'participation',
    CASE
      WHEN p_points > 0 THEN 'مشاركة أثناء الشرح على السبورة'
      ELSE 'تراجع عن نقطة مشاركة من السبورة'
    END,
    -- The authenticated owner created the event, so it is ready for the
    -- existing session-completion function without an extra approval click.
    'approved',
    v_user_id
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_pending_id;

  IF v_pending_id IS NULL THEN
    SELECT psp.id
    INTO v_pending_id
    FROM public.pending_session_points psp
    WHERE psp.created_by = v_user_id
      AND psp.reason_key = v_reason_key
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'queued', true,
    'already_applied', false,
    'pending_id', v_pending_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.queue_owner_teacher_board_point(
  uuid,
  numeric,
  text,
  date
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.queue_owner_teacher_board_point(
  uuid,
  numeric,
  text,
  date
) TO authenticated;

COMMIT;
