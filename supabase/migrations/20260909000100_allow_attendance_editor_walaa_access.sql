BEGIN;

CREATE OR REPLACE FUNCTION public.set_manager_points_session_access_for_attendance_editor(
  p_group_id uuid,
  p_session_date date,
  p_is_open boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text;
  v_active boolean;
  v_allowed boolean := false;
  v_session_exists boolean := false;
  v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  SELECT role, is_active
  INTO v_role, v_active
  FROM public.user_profiles
  WHERE id = auth.uid();

  IF COALESCE(v_active, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ATTENDANCE_EDIT_PERMISSION_REQUIRED';
  END IF;

  IF v_role = 'owner' THEN
    v_allowed := true;
  ELSIF v_role = 'manager' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.manager_permissions mp
      WHERE mp.user_id = auth.uid()
        AND COALESCE(mp.permissions ->> 'attendance_edit', 'false') = 'true'
    ) INTO v_allowed;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'ATTENDANCE_EDIT_PERMISSION_REQUIRED';
  END IF;

  IF p_group_id IS NULL OR p_session_date IS NULL OR p_is_open IS NULL THEN
    RAISE EXCEPTION 'INVALID_MANAGER_POINTS_ACCESS_REQUEST';
  END IF;

  IF p_session_date <> v_today THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'فتح الحصة عند ولاء متاح لحصة اليوم فقط',
      'is_open', false
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.group_id = p_group_id
      AND s.session_date = p_session_date
      AND COALESCE(s.status, '') <> 'cancelled'
  ) INTO v_session_exists;

  IF p_is_open AND v_session_exists THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'الحصة مسجلة بالفعل ولا يمكن فتحها عند ولاء',
      'is_open', false,
      'session_exists', true
    );
  END IF;

  UPDATE public.manager_points_session_access
  SET is_open = p_is_open,
      opened_by = CASE
        WHEN p_is_open THEN auth.uid()
        ELSE opened_by
      END,
      opened_at = CASE
        WHEN p_is_open THEN COALESCE(opened_at, v_now)
        ELSE opened_at
      END,
      closed_at = CASE
        WHEN p_is_open THEN NULL
        ELSE v_now
      END,
      updated_at = v_now
  WHERE group_id = p_group_id
    AND session_date = p_session_date;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.manager_points_session_access (
        group_id,
        session_date,
        is_open,
        opened_by,
        opened_at,
        closed_at,
        updated_at
      )
      VALUES (
        p_group_id,
        p_session_date,
        p_is_open,
        CASE WHEN p_is_open THEN auth.uid() ELSE NULL END,
        CASE WHEN p_is_open THEN v_now ELSE NULL END,
        CASE WHEN p_is_open THEN NULL ELSE v_now END,
        v_now
      );
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.manager_points_session_access
      SET is_open = p_is_open,
          opened_by = CASE
            WHEN p_is_open THEN auth.uid()
            ELSE opened_by
          END,
          opened_at = CASE
            WHEN p_is_open THEN COALESCE(opened_at, v_now)
            ELSE opened_at
          END,
          closed_at = CASE
            WHEN p_is_open THEN NULL
            ELSE v_now
          END,
          updated_at = v_now
      WHERE group_id = p_group_id
        AND session_date = p_session_date;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'is_open', p_is_open,
    'session_exists', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_manager_points_session_access_for_attendance_editor(uuid, date, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_manager_points_session_access_for_attendance_editor(uuid, date, boolean)
  TO authenticated, service_role;

COMMIT;
