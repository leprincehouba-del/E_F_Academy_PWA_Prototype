CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
SELECT vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'milestone_scheduler_token')
WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='milestone_scheduler_token');
CREATE OR REPLACE FUNCTION public.milestone_scheduler_token() RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='milestone_scheduler_token' LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.milestone_scheduler_token() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.milestone_scheduler_token() TO service_role;
