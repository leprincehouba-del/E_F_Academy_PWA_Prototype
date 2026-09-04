BEGIN;

-- Both existing editor roles may manage lesson content:
-- the attendance editor and the points editor.
CREATE OR REPLACE FUNCTION public.can_manage_lesson_content()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_role text;
  v_active boolean;
BEGIN
  SELECT role, is_active
  INTO v_role, v_active
  FROM public.user_profiles
  WHERE id = auth.uid();

  IF COALESCE(v_active, false) IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF v_role = 'owner' THEN
    RETURN true;
  END IF;

  IF v_role = 'manager' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.manager_permissions mp
      WHERE mp.user_id = auth.uid()
        AND (
          COALESCE(mp.permissions ->> 'attendance_edit', 'false') = 'true'
          OR COALESCE(mp.permissions ->> 'points_edit', 'false') = 'true'
        )
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_lesson_content()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_lesson_content()
  TO service_role;

COMMIT;
