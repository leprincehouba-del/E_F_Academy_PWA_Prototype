BEGIN;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'parent'::text, 'screen'::text]));

UPDATE public.user_profiles
SET role = 'screen', full_name = 'حساب الشاشة'
WHERE regexp_replace(coalesce(phone, ''), '\D', '', 'g') = '01113565398';

CREATE OR REPLACE FUNCTION public.is_screen_board_account()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = (SELECT auth.uid())
      AND role IN ('owner', 'screen')
      AND is_active = true
  );
$function$;

REVOKE ALL ON FUNCTION public.is_screen_board_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_screen_board_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_screen_board_account() TO authenticated;

DROP POLICY IF EXISTS screen_board_read_groups ON public.groups;
CREATE POLICY screen_board_read_groups ON public.groups
FOR SELECT TO authenticated
USING ((SELECT public.is_screen_board_account()));

DROP POLICY IF EXISTS screen_board_read_students ON public.students;
CREATE POLICY screen_board_read_students ON public.students
FOR SELECT TO authenticated
USING ((SELECT public.is_screen_board_account()));

CREATE OR REPLACE FUNCTION public.queue_screen_teacher_board_point_with_reason(
  p_student_id uuid,
  p_points numeric,
  p_event_key text,
  p_session_date date,
  p_reason_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_group_id uuid;
  v_pending_id uuid;
  v_reason_type text;
  v_reason_text text;
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_screen_board_account() THEN
    RAISE EXCEPTION 'TEACHER_BOARD_ACCOUNT_REQUIRED';
  END IF;
  IF p_student_id IS NULL OR p_session_date IS NULL THEN
    RAISE EXCEPTION 'TEACHER_BOARD_STUDENT_AND_DATE_REQUIRED';
  END IF;
  IF p_points NOT IN (-1, 1) THEN
    RAISE EXCEPTION 'TEACHER_BOARD_POINT_MUST_BE_ONE';
  END IF;
  IF p_session_date <> v_today THEN
    RETURN jsonb_build_object('success', false, 'blocked', true, 'message', 'يمكن تسجيل نقاط السبورة لحصة اليوم فقط');
  END IF;
  IF p_event_key IS NULL OR p_event_key !~ '^teacher_board_[a-zA-Z0-9]{16,80}$' THEN
    RAISE EXCEPTION 'INVALID_TEACHER_BOARD_EVENT_KEY';
  END IF;

  v_reason_text := CASE p_reason_key
    WHEN 'oral_recitation' THEN 'التسميع الشفوي'
    WHEN 'written_recitation' THEN 'التسميع التحريري'
    WHEN 'homework' THEN 'الواجب'
    WHEN 'participation' THEN 'المشاركة'
    WHEN 'activity' THEN 'النشاط'
    WHEN 'quiz' THEN 'الاختبار'
    WHEN 'exam' THEN 'الامتحان'
    WHEN 'behavior' THEN 'السلوك'
    ELSE NULL
  END;
  IF v_reason_text IS NULL THEN
    RAISE EXCEPTION 'INVALID_TEACHER_BOARD_REASON';
  END IF;
  v_reason_type := CASE
    WHEN p_reason_key = 'homework' THEN 'homework'
    WHEN p_reason_key = 'participation' THEN 'participation'
    ELSE 'manual'
  END;

  SELECT s.group_id INTO v_group_id
  FROM public.students s
  WHERE s.id = p_student_id AND coalesce(s.is_active, true) = true;
  IF v_group_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'blocked', true, 'message', 'الطالب غير موجود أو غير نشط');
  END IF;

  SELECT psp.id INTO v_pending_id
  FROM public.pending_session_points psp
  WHERE psp.created_by = v_user_id AND psp.reason_key = p_event_key
  LIMIT 1;
  IF v_pending_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'queued', true, 'already_applied', true, 'pending_id', v_pending_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sessions se
    WHERE se.group_id = v_group_id AND se.session_date = p_session_date
  ) THEN
    RETURN jsonb_build_object('success', false, 'closed', true, 'message', 'الحصة مسجلة أو بدأ إغلاقها بالفعل');
  END IF;

  INSERT INTO public.pending_session_points (
    student_id, group_id, session_date, points, reason_key,
    reason_type, reason_text, status, created_by
  ) VALUES (
    p_student_id, v_group_id, p_session_date, p_points, p_event_key,
    v_reason_type,
    CASE WHEN p_points > 0 THEN v_reason_text ELSE 'تراجع عن: ' || v_reason_text END,
    'approved', v_user_id
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_pending_id;

  IF v_pending_id IS NULL THEN
    SELECT psp.id INTO v_pending_id
    FROM public.pending_session_points psp
    WHERE psp.created_by = v_user_id AND psp.reason_key = p_event_key
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'queued', true, 'already_applied', false,
    'pending_id', v_pending_id, 'reason', v_reason_text
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.queue_screen_teacher_board_point_with_reason(uuid, numeric, text, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.queue_screen_teacher_board_point_with_reason(uuid, numeric, text, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.queue_screen_teacher_board_point_with_reason(uuid, numeric, text, date, text) TO authenticated;

COMMIT;
