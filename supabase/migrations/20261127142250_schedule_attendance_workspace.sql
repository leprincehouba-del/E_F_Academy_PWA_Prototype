-- Allow attendance staff to read the saved roster of the selected session.
-- Keep the raw attendance and financial reporting policies unchanged.
CREATE OR REPLACE FUNCTION public.get_attendance_workspace_rows(p_session_id uuid)
RETURNS TABLE (
  student_id uuid,
  attendance_status text,
  payment_status text,
  points_change numeric,
  points_details jsonb,
  package_id uuid,
  package_consumed boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_owner() OR public.has_permission('attendance_view') OR public.has_permission('attendance_edit')
  ) THEN
    RAISE EXCEPTION 'ATTENDANCE_PERMISSION_DENIED' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT a.student_id, a.attendance_status, a.payment_status,
    a.points_change, a.points_details, a.package_id, a.package_consumed
  FROM public.attendance a
  WHERE a.session_id = p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_workspace_rows(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_workspace_rows(uuid) TO authenticated;

DROP POLICY IF EXISTS attendance_staff_read_group_schedules ON public.group_schedules;
CREATE POLICY attendance_staff_read_group_schedules ON public.group_schedules
FOR SELECT TO authenticated
USING (public.has_any_permission(ARRAY['attendance_view', 'attendance_edit']));

CREATE OR REPLACE FUNCTION public.require_staff_session_schedule()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_owner() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.group_id IS NOT DISTINCT FROM OLD.group_id
    AND NEW.session_date IS NOT DISTINCT FROM OLD.session_date
    AND NOT (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed') THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.group_schedules slot
    WHERE slot.group_id = NEW.group_id AND slot.is_active = true
      AND slot.day_name = (ARRAY[
        'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'
      ])[EXTRACT(ISODOW FROM NEW.session_date)::integer]
  ) THEN
    RAISE EXCEPTION 'SESSION_NOT_ON_SCHEDULE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.require_staff_session_schedule() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_require_staff_session_schedule ON public.sessions;
CREATE TRIGGER trg_require_staff_session_schedule
BEFORE INSERT OR UPDATE OF status, group_id, session_date ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.require_staff_session_schedule();
