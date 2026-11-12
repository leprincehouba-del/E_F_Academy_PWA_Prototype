-- Preserve the existing vetted function body; change only the initial permission gate.
-- Authorized managers require active user_profiles and attendance_edit permission.
DO $migration$
DECLARE old_definition text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO old_definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='save_attendance_batch_atomic'
   AND pg_get_function_identity_arguments(p.oid)='p_session_id uuid, p_rows jsonb';
 IF old_definition IS NULL OR position('IF NOT public.is_owner() THEN' IN old_definition)=0 THEN
   RAISE EXCEPTION 'Unexpected atomic attendance function definition: migration stopped';
 END IF;
 EXECUTE replace(old_definition,'IF NOT public.is_owner() THEN','IF NOT public.can_manage_session_packages() THEN');
END;
$migration$;
