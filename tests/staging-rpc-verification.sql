-- Test with the actual authenticated database role, not a superuser bypass.
BEGIN;
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
 IF has_table_privilege(current_user,'public.pending_session_points','SELECT') THEN RAISE EXCEPTION 'Pending table must remain private'; END IF;
 BEGIN
  PERFORM count(*) FROM public.pending_session_points;
  RAISE EXCEPTION 'Direct read unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(*) FROM public.get_owner_pending_session_points('00000000-0000-0000-0000-000000000001',current_date))<>0 THEN RAISE EXCEPTION 'Unexpected fixture points'; END IF;
END $test$;
SELECT set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.get_owner_pending_session_points('00000000-0000-0000-0000-000000000001',current_date))<>0 THEN RAISE EXCEPTION 'Unexpected fixture points'; END IF;
END $test$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $test$
BEGIN
 BEGIN
  PERFORM * FROM public.get_owner_pending_session_points('00000000-0000-0000-0000-000000000001',current_date);
  RAISE EXCEPTION 'Anonymous RPC unexpectedly succeeded';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Anonymous RPC unexpectedly succeeded' THEN RAISE; END IF;
 END;
END $test$;
ROLLBACK;
