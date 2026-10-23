// Execute deployed-schema business regressions in local PostgreSQL, no network.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE ROLE supabase_auth_admin;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
 const baseline=fs.readFileSync('tests/fixtures/schema-only-20261023.sql','utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;','');
 await db.exec(baseline);
 await db.exec(fs.readFileSync('supabase/migrations/20261022000100_student_milestone_rewards.sql','utf8'));
 const patch=fs.readFileSync('supabase/migrations/20261023001816_package_attendance_reentry_and_preserved_points.sql','utf8');await db.exec(patch);await db.exec(patch);
 await db.exec(`INSERT INTO auth.users VALUES('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222');
 INSERT INTO public.user_profiles(id,phone,full_name,role) VALUES('11111111-1111-1111-1111-111111111111','01000000531','Synthetic owner','owner'),('22222222-2222-2222-2222-222222222222','01000000532','Synthetic employee','manager');
 INSERT INTO public.manager_permissions(user_id,permissions) VALUES('22222222-2222-2222-2222-222222222222','{"attendance_edit":true,"points_edit":true}');
 INSERT INTO public.app_settings(id,academy_name) VALUES(1,'STAGING FIXTURE');INSERT INTO public.billing_settings(id) VALUES(1);`);
 for(const test of ['staging-business-rollback.sql','staging-employee-rollback.sql']){await db.exec(fs.readFileSync('tests/'+test,'utf8'));console.log('PASS: full deployed schema + '+test)}
 await db.close();
})().catch(e=>{console.error(e);process.exit(1)});
