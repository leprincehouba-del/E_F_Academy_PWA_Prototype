REVOKE ALL ON FUNCTION public.sync_student_due_totals(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_student_due_totals(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.sync_student_due_totals(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_student_due_totals(uuid) TO service_role;
