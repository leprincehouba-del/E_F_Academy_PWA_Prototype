-- Schema-only snapshot for isolated regression tests. No student/account rows, passwords or keys.
SET check_function_bodies=false;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SEQUENCE public.students_student_number_seq INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;
CREATE SEQUENCE public.payments_receipt_number_seq INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;
CREATE TABLE public.app_settings (id smallint DEFAULT 1 NOT NULL,academy_name text DEFAULT 'E. F Academy'::text NOT NULL,teacher_name text DEFAULT 'Mr Mohamed Mahmoud'::text NOT NULL,primary_session_price numeric(10,2) DEFAULT 15 NOT NULL,prep_session_price numeric(10,2) DEFAULT 20 NOT NULL,secondary_session_price numeric(10,2) DEFAULT 20 NOT NULL,max_due_sessions smallint DEFAULT 3 NOT NULL,session_duration_minutes smallint DEFAULT 60 NOT NULL,max_students_per_group smallint DEFAULT 50 NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL); ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.attendance (id uuid DEFAULT gen_random_uuid() NOT NULL,session_id uuid NOT NULL,student_id uuid NOT NULL,attendance_status text NOT NULL,payment_status text DEFAULT 'due'::text NOT NULL,charge_amount numeric(10,2) DEFAULT 0 NOT NULL,points_change numeric(10,2) DEFAULT 0 NOT NULL,admin_override boolean DEFAULT false NOT NULL,notes text,created_at timestamp with time zone DEFAULT now() NOT NULL,points_details jsonb DEFAULT '[]'::jsonb NOT NULL,paid_amount numeric DEFAULT 0 NOT NULL,package_id uuid,package_consumed boolean DEFAULT false NOT NULL); ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.backup_attendance_points_20260826 (backup_created_at timestamp with time zone,id uuid,session_id uuid,student_id uuid,attendance_status text,payment_status text,charge_amount numeric(10,2),points_change numeric(10,2),admin_override boolean,notes text,created_at timestamp with time zone,points_details jsonb,paid_amount numeric); ALTER TABLE public.backup_attendance_points_20260826 ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.backup_pending_points_20260826 (backup_created_at timestamp with time zone,id uuid,student_id uuid,group_id uuid,session_date date,points numeric(10,2),reason_key text,reason_type text,reason_text text,status text,created_by uuid,applied_session_id uuid,created_at timestamp with time zone,updated_at timestamp with time zone,applied_at timestamp with time zone); ALTER TABLE public.backup_pending_points_20260826 ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.backup_students_points_20260826 (backup_created_at timestamp with time zone,id uuid,student_number bigint,full_name text,group_id uuid,school_name text,parent_phone text,alternate_phone text,photo_url text,date_of_birth date,joined_on date,allow_accumulation boolean,due_sessions_count smallint,due_amount numeric(10,2),points_balance numeric(10,2),is_active boolean,notes text,created_at timestamp with time zone,updated_at timestamp with time zone); ALTER TABLE public.backup_students_points_20260826 ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.billing_settings (id smallint DEFAULT 1 NOT NULL,default_package_sessions integer DEFAULT 8 NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL,updated_by uuid); ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.group_schedules (id uuid DEFAULT gen_random_uuid() NOT NULL,group_id uuid NOT NULL,day_name text NOT NULL,start_time time without time zone NOT NULL,is_active boolean DEFAULT true NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL); ALTER TABLE public.group_schedules ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.groups (id uuid DEFAULT gen_random_uuid() NOT NULL,code text NOT NULL,name text NOT NULL,stage text NOT NULL,meeting_days text[] DEFAULT '{}'::text[],start_time time without time zone,session_price numeric(10,2) NOT NULL,duration_minutes smallint DEFAULT 60 NOT NULL,max_students smallint DEFAULT 50 NOT NULL,is_active boolean DEFAULT true NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL,grade text NOT NULL); ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.homework_assignments (id uuid DEFAULT gen_random_uuid() NOT NULL,grade_key text,group_id uuid,title text DEFAULT 'واجب'::text NOT NULL,notes text,homework_date date DEFAULT CURRENT_DATE NOT NULL,created_by uuid DEFAULT auth.uid() NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,is_active boolean DEFAULT true NOT NULL); ALTER TABLE public.homework_assignments ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.homework_files (id uuid DEFAULT gen_random_uuid() NOT NULL,assignment_id uuid NOT NULL,storage_path text NOT NULL,file_name text NOT NULL,mime_type text,file_size bigint,created_at timestamp with time zone DEFAULT now() NOT NULL); ALTER TABLE public.homework_files ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.lesson_contents (id uuid DEFAULT gen_random_uuid() NOT NULL,group_id uuid NOT NULL,lesson_date date NOT NULL,title text NOT NULL,vocabulary jsonb DEFAULT '[]'::jsonb NOT NULL,reading_text text,notes text,is_active boolean DEFAULT true NOT NULL,created_by uuid DEFAULT auth.uid() NOT NULL,updated_by uuid DEFAULT auth.uid() NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL); ALTER TABLE public.lesson_contents ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.manager_permissions (user_id uuid NOT NULL,permissions jsonb DEFAULT '{"parent_view": false, "points_edit": false, "points_view": false, "ranking_view": false, "payments_edit": false, "payments_view": false, "schedule_edit": false, "schedule_view": false, "students_edit": false, "students_view": false, "dashboard_view": false, "attendance_edit": false, "attendance_view": false}'::jsonb NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL); ALTER TABLE public.manager_permissions ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.manager_points_session_access (group_id uuid NOT NULL,session_date date NOT NULL,is_open boolean DEFAULT false NOT NULL,opened_by uuid,opened_at timestamp with time zone,closed_at timestamp with time zone,updated_at timestamp with time zone DEFAULT now() NOT NULL); ALTER TABLE public.manager_points_session_access ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.manual_data_repair_audit (repair_key text NOT NULL,applied_at timestamp with time zone DEFAULT now() NOT NULL,applied_by text DEFAULT CURRENT_USER NOT NULL,before_value jsonb NOT NULL,after_value jsonb NOT NULL); ALTER TABLE public.manual_data_repair_audit ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.notifications (id uuid DEFAULT gen_random_uuid() NOT NULL,student_id uuid,parent_phone text,channel text NOT NULL,title text NOT NULL,body text NOT NULL,status text DEFAULT 'pending'::text NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,sent_at timestamp with time zone,read_at timestamp with time zone,session_id uuid,homework_assignment_id uuid); ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.payments (id uuid DEFAULT gen_random_uuid() NOT NULL,student_id uuid NOT NULL,amount numeric(10,2) NOT NULL,payment_method text DEFAULT 'cash'::text NOT NULL,paid_at timestamp with time zone DEFAULT now() NOT NULL,receipt_number bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,notes text,created_at timestamp with time zone DEFAULT now() NOT NULL,payment_source text DEFAULT 'standard'::text NOT NULL,package_id uuid,package_sessions integer,attendance_id uuid); ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.pending_session_points (id uuid DEFAULT gen_random_uuid() NOT NULL,student_id uuid NOT NULL,group_id uuid NOT NULL,session_date date NOT NULL,points numeric(10,2) NOT NULL,reason_key text NOT NULL,reason_type text NOT NULL,reason_text text,status text DEFAULT 'pending'::text NOT NULL,created_by uuid,applied_session_id uuid,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL,applied_at timestamp with time zone); ALTER TABLE public.pending_session_points ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.point_rules (rule_key text NOT NULL,label_ar text NOT NULL,minimum_points numeric(10,2) NOT NULL,maximum_points numeric(10,2) NOT NULL,is_active boolean DEFAULT true NOT NULL); ALTER TABLE public.point_rules ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.point_transactions (id uuid DEFAULT gen_random_uuid() NOT NULL,student_id uuid NOT NULL,points numeric(10,2) NOT NULL,reason_type text NOT NULL,reason_text text,exam_score numeric(10,2),exam_max_score numeric(10,2),created_at timestamp with time zone DEFAULT now() NOT NULL,source text); ALTER TABLE public.point_transactions ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.push_subscriptions (id uuid DEFAULT gen_random_uuid() NOT NULL,user_id uuid NOT NULL,endpoint text NOT NULL,subscription jsonb NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL); ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.session_package_corrections (id uuid DEFAULT gen_random_uuid() NOT NULL,package_id uuid NOT NULL,corrected_by uuid NOT NULL,corrected_at timestamp with time zone DEFAULT now() NOT NULL,reason text NOT NULL,before_value jsonb NOT NULL,after_value jsonb NOT NULL); ALTER TABLE public.session_package_corrections ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.sessions (id uuid DEFAULT gen_random_uuid() NOT NULL,group_id uuid NOT NULL,session_date date NOT NULL,start_time time without time zone NOT NULL,price numeric(10,2) NOT NULL,status text DEFAULT 'scheduled'::text NOT NULL,notes text,created_at timestamp with time zone DEFAULT now() NOT NULL); ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.student_session_packages (id uuid DEFAULT gen_random_uuid() NOT NULL,student_id uuid NOT NULL,sessions_total integer NOT NULL,sessions_remaining integer NOT NULL,unit_price numeric(12,2) NOT NULL,amount_paid numeric(12,2) NOT NULL,payment_method text NOT NULL,starts_on date NOT NULL,purchased_at timestamp with time zone DEFAULT now() NOT NULL,created_by uuid,purchase_token uuid NOT NULL,status text DEFAULT 'active'::text NOT NULL); ALTER TABLE public.student_session_packages ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.students (id uuid DEFAULT gen_random_uuid() NOT NULL,student_number bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,full_name text NOT NULL,group_id uuid NOT NULL,school_name text,parent_phone text NOT NULL,alternate_phone text,photo_url text,date_of_birth date,joined_on date DEFAULT CURRENT_DATE NOT NULL,allow_accumulation boolean DEFAULT true NOT NULL,due_sessions_count smallint DEFAULT 0 NOT NULL,due_amount numeric(10,2) DEFAULT 0 NOT NULL,points_balance numeric(10,2) DEFAULT 0 NOT NULL,is_active boolean DEFAULT true NOT NULL,notes text,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL); ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.user_profiles (id uuid NOT NULL,phone text NOT NULL,full_name text NOT NULL,role text DEFAULT 'parent'::text NOT NULL,is_active boolean DEFAULT true NOT NULL,created_at timestamp with time zone DEFAULT now() NOT NULL,updated_at timestamp with time zone DEFAULT now() NOT NULL); ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_id_check CHECK ((id = 1));
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_max_due_sessions_check CHECK (((max_due_sessions >= 0) AND (max_due_sessions <= 20)));
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_max_students_per_group_check CHECK ((max_students_per_group > 0));
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_prep_session_price_check CHECK ((prep_session_price >= (0)::numeric));
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_primary_session_price_check CHECK ((primary_session_price >= (0)::numeric));
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_secondary_session_price_check CHECK ((secondary_session_price >= (0)::numeric));
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_session_duration_minutes_check CHECK ((session_duration_minutes > 0));
ALTER TABLE public.attendance ADD CONSTRAINT attendance_attendance_status_check CHECK ((attendance_status = ANY (ARRAY['present'::text, 'late'::text, 'absent'::text, 'excused'::text])));
ALTER TABLE public.attendance ADD CONSTRAINT attendance_charge_amount_check CHECK ((charge_amount >= (0)::numeric));
ALTER TABLE public.attendance ADD CONSTRAINT attendance_payment_status_check CHECK ((payment_status = ANY (ARRAY['paid'::text, 'due'::text, 'free'::text, 'not_applicable'::text])));
ALTER TABLE public.attendance ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);
ALTER TABLE public.attendance ADD CONSTRAINT attendance_session_id_student_id_key UNIQUE (session_id, student_id);
ALTER TABLE public.billing_settings ADD CONSTRAINT billing_settings_default_package_sessions_check CHECK (((default_package_sessions >= 1) AND (default_package_sessions <= 100)));
ALTER TABLE public.billing_settings ADD CONSTRAINT billing_settings_id_check CHECK ((id = 1));
ALTER TABLE public.billing_settings ADD CONSTRAINT billing_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.group_schedules ADD CONSTRAINT group_schedules_day_name_check CHECK ((day_name = ANY (ARRAY['السبت'::text, 'الأحد'::text, 'الاثنين'::text, 'الثلاثاء'::text, 'الأربعاء'::text, 'الخميس'::text, 'الجمعة'::text])));
ALTER TABLE public.group_schedules ADD CONSTRAINT group_schedules_group_id_day_name_start_time_key UNIQUE (group_id, day_name, start_time);
ALTER TABLE public.group_schedules ADD CONSTRAINT group_schedules_pkey PRIMARY KEY (id);
ALTER TABLE public.groups ADD CONSTRAINT groups_code_key UNIQUE (code);
ALTER TABLE public.groups ADD CONSTRAINT groups_duration_minutes_check CHECK ((duration_minutes > 0));
ALTER TABLE public.groups ADD CONSTRAINT groups_grade_check CHECK ((grade = ANY (ARRAY['kg'::text, 'primary_foundation_a'::text, 'primary_foundation_b'::text, 'primary_foundation_c'::text, 'primary_1'::text, 'primary_2'::text, 'primary_3'::text, 'primary_4'::text, 'primary_5'::text, 'primary_6'::text, 'prep_1'::text, 'prep_2'::text, 'prep_3'::text, 'secondary_1'::text, 'secondary_2'::text, 'secondary_3'::text])));
ALTER TABLE public.groups ADD CONSTRAINT groups_max_students_check CHECK ((max_students > 0));
ALTER TABLE public.groups ADD CONSTRAINT groups_pkey PRIMARY KEY (id);
ALTER TABLE public.groups ADD CONSTRAINT groups_session_price_check CHECK ((session_price >= (0)::numeric));
ALTER TABLE public.groups ADD CONSTRAINT groups_stage_check CHECK ((stage = ANY (ARRAY['primary'::text, 'prep'::text, 'secondary'::text])));
ALTER TABLE public.groups ADD CONSTRAINT groups_stage_grade_check CHECK ((((stage = 'primary'::text) AND (grade = ANY (ARRAY['kg'::text, 'primary_foundation_a'::text, 'primary_foundation_b'::text, 'primary_foundation_c'::text, 'primary_1'::text, 'primary_2'::text, 'primary_3'::text, 'primary_4'::text, 'primary_5'::text, 'primary_6'::text]))) OR ((stage = 'prep'::text) AND (grade = ANY (ARRAY['prep_1'::text, 'prep_2'::text, 'prep_3'::text]))) OR ((stage = 'secondary'::text) AND (grade = ANY (ARRAY['secondary_1'::text, 'secondary_2'::text, 'secondary_3'::text])))));
ALTER TABLE public.homework_assignments ADD CONSTRAINT homework_assignments_pkey PRIMARY KEY (id);
ALTER TABLE public.homework_files ADD CONSTRAINT homework_files_pkey PRIMARY KEY (id);
ALTER TABLE public.homework_files ADD CONSTRAINT homework_files_storage_path_key UNIQUE (storage_path);
ALTER TABLE public.lesson_contents ADD CONSTRAINT lesson_contents_notes_length_check CHECK (((notes IS NULL) OR (char_length(notes) <= 1000)));
ALTER TABLE public.lesson_contents ADD CONSTRAINT lesson_contents_pkey PRIMARY KEY (id);
ALTER TABLE public.lesson_contents ADD CONSTRAINT lesson_contents_reading_length_check CHECK (((reading_text IS NULL) OR (char_length(reading_text) <= 50000)));
ALTER TABLE public.lesson_contents ADD CONSTRAINT lesson_contents_title_length_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 160)));
ALTER TABLE public.lesson_contents ADD CONSTRAINT lesson_contents_vocabulary_array_check CHECK ((jsonb_typeof(vocabulary) = 'array'::text));
ALTER TABLE public.manager_permissions ADD CONSTRAINT manager_permissions_permissions_check CHECK ((jsonb_typeof(permissions) = 'object'::text));
ALTER TABLE public.manager_permissions ADD CONSTRAINT manager_permissions_pkey PRIMARY KEY (user_id);
ALTER TABLE public.manager_points_session_access ADD CONSTRAINT manager_points_session_access_pkey PRIMARY KEY (group_id, session_date);
ALTER TABLE public.manual_data_repair_audit ADD CONSTRAINT manual_data_repair_audit_pkey PRIMARY KEY (repair_key);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_channel_check CHECK ((channel = ANY (ARRAY['in_app'::text, 'whatsapp'::text])));
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'read'::text])));
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_check CHECK ((amount > (0)::numeric));
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'instapay'::text, 'vodafone_cash'::text, 'bank_transfer'::text, 'other'::text])));
ALTER TABLE public.payments ADD CONSTRAINT payments_pkey PRIMARY KEY (id);
ALTER TABLE public.payments ADD CONSTRAINT payments_receipt_number_key UNIQUE (receipt_number);
ALTER TABLE public.pending_session_points ADD CONSTRAINT pending_session_points_pkey PRIMARY KEY (id);
ALTER TABLE public.pending_session_points ADD CONSTRAINT pending_session_points_points_check CHECK ((points <> (0)::numeric));
ALTER TABLE public.pending_session_points ADD CONSTRAINT pending_session_points_reason_key_check CHECK ((btrim(reason_key) <> ''::text));
ALTER TABLE public.pending_session_points ADD CONSTRAINT pending_session_points_reason_type_check CHECK ((reason_type = ANY (ARRAY['homework'::text, 'participation'::text, 'manual'::text])));
ALTER TABLE public.pending_session_points ADD CONSTRAINT pending_session_points_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'applied'::text, 'cancelled'::text])));
ALTER TABLE public.pending_session_points ADD CONSTRAINT pending_session_points_student_id_session_date_reason_key_key UNIQUE (student_id, session_date, reason_key);
ALTER TABLE public.point_rules ADD CONSTRAINT point_rules_check CHECK ((minimum_points <= maximum_points));
ALTER TABLE public.point_rules ADD CONSTRAINT point_rules_pkey PRIMARY KEY (rule_key);
ALTER TABLE public.point_transactions ADD CONSTRAINT point_transactions_check CHECK (((reason_type <> 'exam'::text) OR ((exam_score IS NOT NULL) AND (exam_max_score IS NOT NULL) AND (exam_max_score > (0)::numeric) AND ((exam_score >= (0)::numeric) AND (exam_score <= exam_max_score)))));
ALTER TABLE public.point_transactions ADD CONSTRAINT point_transactions_pkey PRIMARY KEY (id);
ALTER TABLE public.point_transactions ADD CONSTRAINT point_transactions_reason_type_check CHECK ((reason_type = ANY (ARRAY['attendance'::text, 'absence'::text, 'late'::text, 'homework'::text, 'participation'::text, 'exam'::text, 'manual'::text])));
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.session_package_corrections ADD CONSTRAINT session_package_corrections_pkey PRIMARY KEY (id);
ALTER TABLE public.sessions ADD CONSTRAINT sessions_group_id_session_date_start_time_key UNIQUE (group_id, session_date, start_time);
ALTER TABLE public.sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.sessions ADD CONSTRAINT sessions_price_check CHECK ((price >= (0)::numeric));
ALTER TABLE public.sessions ADD CONSTRAINT sessions_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE public.student_session_packages ADD CONSTRAINT student_session_packages_amount_paid_check CHECK ((amount_paid >= (0)::numeric));
ALTER TABLE public.student_session_packages ADD CONSTRAINT student_session_packages_check CHECK (((sessions_remaining >= 0) AND (sessions_remaining <= sessions_total)));
ALTER TABLE public.student_session_packages ADD CONSTRAINT student_session_packages_pkey PRIMARY KEY (id);
ALTER TABLE public.student_session_packages ADD CONSTRAINT student_session_packages_purchase_token_key UNIQUE (purchase_token);
ALTER TABLE public.student_session_packages ADD CONSTRAINT student_session_packages_sessions_total_check CHECK ((sessions_total > 0));
ALTER TABLE public.student_session_packages ADD CONSTRAINT student_session_packages_status_check CHECK ((status = ANY (ARRAY['active'::text, 'depleted'::text, 'cancelled'::text])));
ALTER TABLE public.student_session_packages ADD CONSTRAINT student_session_packages_unit_price_check CHECK ((unit_price >= (0)::numeric));
ALTER TABLE public.students ADD CONSTRAINT students_due_amount_check CHECK ((due_amount >= (0)::numeric));
ALTER TABLE public.students ADD CONSTRAINT students_due_sessions_count_check CHECK ((due_sessions_count >= 0));
ALTER TABLE public.students ADD CONSTRAINT students_pkey PRIMARY KEY (id);
ALTER TABLE public.students ADD CONSTRAINT students_student_number_key UNIQUE (student_number);
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_phone_key UNIQUE (phone);
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'parent'::text])));
ALTER TABLE public.attendance ADD CONSTRAINT attendance_package_id_fkey FOREIGN KEY (package_id) REFERENCES student_session_packages(id) ON DELETE SET NULL;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;
ALTER TABLE public.billing_settings ADD CONSTRAINT billing_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.group_schedules ADD CONSTRAINT group_schedules_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
ALTER TABLE public.homework_assignments ADD CONSTRAINT homework_assignments_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL;
ALTER TABLE public.homework_files ADD CONSTRAINT homework_files_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES homework_assignments(id) ON DELETE CASCADE;
ALTER TABLE public.lesson_contents ADD CONSTRAINT lesson_contents_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
ALTER TABLE public.manager_permissions ADD CONSTRAINT manager_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.manager_points_session_access ADD CONSTRAINT manager_points_session_access_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_homework_assignment_id_fkey FOREIGN KEY (homework_assignment_id) REFERENCES homework_assignments(id) ON DELETE SET NULL;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
ALTER TABLE public.payments ADD CONSTRAINT payments_attendance_id_fkey FOREIGN KEY (attendance_id) REFERENCES attendance(id);
ALTER TABLE public.payments ADD CONSTRAINT payments_package_id_fkey FOREIGN KEY (package_id) REFERENCES student_session_packages(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD CONSTRAINT payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;
ALTER TABLE public.pending_session_points ADD CONSTRAINT pending_session_points_applied_session_id_fkey FOREIGN KEY (applied_session_id) REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE public.pending_session_points ADD CONSTRAINT pending_session_points_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
ALTER TABLE public.pending_session_points ADD CONSTRAINT pending_session_points_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
ALTER TABLE public.point_transactions ADD CONSTRAINT point_transactions_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.session_package_corrections ADD CONSTRAINT session_package_corrections_corrected_by_fkey FOREIGN KEY (corrected_by) REFERENCES auth.users(id);
ALTER TABLE public.session_package_corrections ADD CONSTRAINT session_package_corrections_package_id_fkey FOREIGN KEY (package_id) REFERENCES student_session_packages(id);
ALTER TABLE public.sessions ADD CONSTRAINT sessions_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE RESTRICT;
ALTER TABLE public.student_session_packages ADD CONSTRAINT student_session_packages_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.student_session_packages ADD CONSTRAINT student_session_packages_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;
ALTER TABLE public.students ADD CONSTRAINT students_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON UPDATE CASCADE;
ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION public.add_points_only(p_student_id uuid, p_points numeric, p_reason_type text, p_reason_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_active boolean;
  v_can_edit boolean := false;
  v_due_sessions integer := 0;
  v_new_balance numeric := 0;
begin
  select role, is_active
  into v_role, v_active
  from public.user_profiles
  where id = auth.uid();

  if coalesce(v_active, false) = false then
    raise exception 'الحساب غير مفعل';
  end if;

  if v_role = 'owner' then
    v_can_edit := true;
  elsif v_role = 'manager' then
    select coalesce(
      (permissions ->> 'points_edit')::boolean,
      false
    )
    into v_can_edit
    from public.manager_permissions
    where user_id = auth.uid();
  end if;

  if not coalesce(v_can_edit, false) then
    raise exception 'لا توجد صلاحية لإضافة النقاط';
  end if;

  if p_points is null or p_points = 0 then
    raise exception 'عدد النقاط غير صحيح';
  end if;

  if nullif(trim(p_reason_type), '') is null then
    raise exception 'يجب اختيار سبب النقاط';
  end if;

  select
    coalesce(due_sessions_count, 0),
    coalesce(points_balance, 0)
  into
    v_due_sessions,
    v_new_balance
  from public.students
  where id = p_student_id
    and is_active = true
  for update;

  if not found then
    raise exception 'الطالب غير موجود';
  end if;

  if v_due_sessions >= 3 then
    return jsonb_build_object(
      'ok', false,
      'blocked', true,
      'message', 'تسجيل النقاط متوقف بسبب الحصص غير المدفوعة'
    );
  end if;

  insert into public.point_transactions (
    student_id,
    points,
    reason_type,
    reason_text,
    source
  )
  values (
    p_student_id,
    p_points,
    trim(p_reason_type),
    nullif(trim(p_reason_text), ''),
    'standalone'
  );

  v_new_balance := v_new_balance + p_points;

  update public.students
  set points_balance = v_new_balance
  where id = p_student_id;

  return jsonb_build_object(
    'ok', true,
    'blocked', false,
    'new_balance', v_new_balance
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.can_manage_homework()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_is_active boolean := false;
begin
  if v_user_id is null then
    return false;
  end if;

  select up.role, up.is_active
  into v_role, v_is_active
  from public.user_profiles up
  where up.id = v_user_id;

  if not coalesce(v_is_active, false) then
    return false;
  end if;

  if v_role = 'owner' then
    return true;
  end if;

  return v_role = 'manager'
    and (
      public.has_permission('attendance_edit')
      or public.has_permission('points_edit')
    );
end;
$function$;
CREATE OR REPLACE FUNCTION public.can_manage_lesson_content()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.can_manage_session_packages()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        AND COALESCE(mp.permissions ->> 'attendance_edit', 'false') = 'true'
    );
  END IF;

  RETURN false;
END;
$function$;
CREATE OR REPLACE FUNCTION public.check_package_purchase_arrears()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM 1 FROM public.students WHERE id = NEW.student_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.attendance
    WHERE student_id = NEW.student_id AND payment_status = 'due'
      AND GREATEST(COALESCE(charge_amount,0) - COALESCE(paid_amount,0),0) > 0
  ) THEN
    RAISE EXCEPTION 'يجب سداد المتأخرات أولًا قبل شراء الباقة';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.close_manager_points_access_on_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(new.status, '') <> 'cancelled' then
    insert into public.manager_points_session_access (
      group_id,
      session_date,
      is_open,
      closed_at,
      updated_at
    ) values (
      new.group_id,
      new.session_date,
      false,
      now(),
      now()
    )
    on conflict (group_id, session_date)
    do update set
      is_open = false,
      closed_at = now(),
      updated_at = now();
  end if;

  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.complete_session_with_pending_points(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_is_active boolean := false;

  v_session public.sessions%rowtype;

  v_student record;
  v_details jsonb;
  v_total numeric(10,2);

  v_applied_count integer := 0;
  v_total_points numeric(10,2) := 0;

  v_pending_count integer := 0;
  v_unmatched_approved_count integer := 0;

begin

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;


  select
    up.role,
    up.is_active
  into
    v_role,
    v_is_active
  from public.user_profiles up
  where up.id = v_user_id;


  
if
  not coalesce(v_is_active, false)
  or not (
    v_role = 'owner'
    or (
      v_role = 'manager'
      and public.has_permission('attendance_edit')
    )
  )
then
  raise exception 'Attendance edit permission required';
end if;



  select *
  into v_session
  from public.sessions s
  where s.id = p_session_id
  for update;


  if v_session.id is null then
    raise exception 'Session not found';
  end if;


  if v_session.status = 'cancelled' then
    raise exception 'Cancelled session cannot be completed';
  end if;


  if v_session.status = 'completed' then
    return jsonb_build_object(
      'completed', true,
      'already_completed', true,
      'applied_count', 0,
      'total_points', 0
    );
  end if;


  /*
    ممنوع إغلاق الحصة
    إذا كان هناك أي نقاط من ولاء
    لم يراجعها المالك بعد
  */
  select count(*)::integer
  into v_pending_count
  from public.pending_session_points p
  where p.group_id = v_session.group_id
    and p.session_date = v_session.session_date
    and p.status = 'pending';


  if v_pending_count > 0 then
    raise exception
      'PENDING_POINTS_REQUIRE_REVIEW:%',
      v_pending_count;
  end if;


  /*
    حماية إضافية:
    أي نقطة approved يجب أن يكون
    للطالب Attendance داخل نفس الحصة
  */
  select count(*)::integer
  into v_unmatched_approved_count
  from public.pending_session_points p
  where p.group_id = v_session.group_id
    and p.session_date = v_session.session_date
    and p.status = 'approved'
    and not exists (
      select 1
      from public.attendance a
      where a.session_id = v_session.id
        and a.student_id = p.student_id
    );


  if v_unmatched_approved_count > 0 then
    raise exception
      'APPROVED_POINTS_WITHOUT_ATTENDANCE:%',
      v_unmatched_approved_count;
  end if;


  /*
    اعتماد النقاط المؤكدة فقط
  */
  for v_student in

    select
      p.student_id,
      sum(p.points)::numeric(10,2)
        as total_points

    from public.pending_session_points p

    where p.group_id = v_session.group_id
      and p.session_date = v_session.session_date
      and p.status = 'approved'

    group by p.student_id

  loop

    v_total :=
      v_student.total_points;


    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'value',
              p.points,

            'reason',
              p.reason_key,

            'reason_label',
              coalesce(
                p.reason_text,
                p.reason_key
              ),

            'source',
              'manager_pending'
          )
          order by
            p.created_at,
            p.id
        ),
        '[]'::jsonb
      )

    into v_details

    from public.pending_session_points p

    where p.group_id = v_session.group_id
      and p.session_date = v_session.session_date
      and p.status = 'approved'
      and p.student_id =
        v_student.student_id;


    update public.students s
    set
      points_balance =
        coalesce(
          s.points_balance,
          0
        )
        + v_total

    where s.id =
      v_student.student_id;


    update public.attendance a
    set

      points_change =
        coalesce(
          a.points_change,
          0
        )
        + v_total,

      points_details =
        coalesce(
          a.points_details,
          '[]'::jsonb
        )
        ||
        coalesce(
          v_details,
          '[]'::jsonb
        )

    where a.session_id =
      v_session.id

      and a.student_id =
        v_student.student_id;

  end loop;


  /*
    عدد وقيمة النقاط التي سيتم اعتمادها
  */
  select

    count(*)::integer,

    coalesce(
      sum(p.points),
      0
    )::numeric(10,2)

  into
    v_applied_count,
    v_total_points

  from public.pending_session_points p

  where p.group_id = v_session.group_id
    and p.session_date = v_session.session_date
    and p.status = 'approved';


  /*
    تسجيلها في سجل النقاط
  */
  insert into public.point_transactions (
    student_id,
    points,
    reason_type,
    reason_text
  )

  select
    p.student_id,
    p.points,
    p.reason_type,
    p.reason_text

  from public.pending_session_points p

  where p.group_id = v_session.group_id
    and p.session_date = v_session.session_date
    and p.status = 'approved';


  /*
    تحويل النقاط المؤكدة إلى applied
  */
  update public.pending_session_points p

  set
    status = 'applied',
    applied_session_id =
      v_session.id,
    applied_at = now(),
    updated_at = now()

  where p.group_id =
      v_session.group_id

    and p.session_date =
      v_session.session_date

    and p.status =
      'approved';


  /*
    إغلاق الحصة بعد نجاح كل شيء
  */
  update public.sessions
  set status = 'completed'
  where id = v_session.id;


  return jsonb_build_object(
    'completed', true,
    'already_completed', false,
    'applied_count', v_applied_count,
    'total_points', v_total_points
  );

end;
$function$;
CREATE OR REPLACE FUNCTION public.correct_student_session_package(p_package_id uuid, p_expected_total integer, p_expected_remaining integer, p_sessions integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid;
  v_old public.student_session_packages%ROWTYPE;
  v_new public.student_session_packages%ROWTYPE;
  v_used integer;
  v_linked integer;
  v_payment_count integer;
  v_amount numeric(12,2);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'owner' AND is_active = true) THEN
    RAISE EXCEPTION 'OWNER_PERMISSION_REQUIRED';
  END IF;
  IF p_sessions IS NULL OR p_sessions NOT BETWEEN 1 AND 100
    OR NULLIF(btrim(p_reason),'') IS NULL OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'INVALID_CORRECTION';
  END IF;
  SELECT student_id INTO v_student_id FROM public.student_session_packages WHERE id = p_package_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  -- Match the student -> package lock order used by attendance/purchases.
  PERFORM 1 FROM public.students WHERE id = v_student_id FOR UPDATE;
  SELECT * INTO v_old FROM public.student_session_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND'; END IF;
  IF v_old.status = 'cancelled' THEN RAISE EXCEPTION 'PACKAGE_CANCELLED'; END IF;
  IF v_old.sessions_total IS DISTINCT FROM p_expected_total
    OR v_old.sessions_remaining IS DISTINCT FROM p_expected_remaining THEN
    RAISE EXCEPTION 'الباقة تغيرت؛ أعد فتحها قبل التصحيح';
  END IF;
  IF p_sessions = v_old.sessions_total THEN RETURN to_jsonb(v_old); END IF;
  v_used := v_old.sessions_total - v_old.sessions_remaining;
  SELECT COUNT(*) INTO v_linked FROM public.attendance
    WHERE package_id = p_package_id AND package_consumed = true;
  IF v_linked <> v_used THEN RAISE EXCEPTION 'PACKAGE_CONSUMPTION_REQUIRES_REVIEW'; END IF;
  IF p_sessions < v_used THEN RAISE EXCEPTION 'العدد أقل من الحصص المستهلكة'; END IF;
  PERFORM 1 FROM public.payments WHERE package_id = p_package_id FOR UPDATE;
  SELECT COUNT(*) INTO v_payment_count FROM public.payments
    WHERE package_id = p_package_id;
  IF v_payment_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.payments WHERE package_id = p_package_id
      AND student_id = v_old.student_id AND payment_source = 'session_package'
      AND amount = v_old.amount_paid AND package_sessions = v_old.sessions_total
  ) THEN RAISE EXCEPTION 'PACKAGE_PAYMENT_REQUIRES_REVIEW'; END IF;
  v_amount := round(p_sessions * v_old.unit_price, 2);
  UPDATE public.student_session_packages
    SET sessions_total = p_sessions, sessions_remaining = p_sessions - v_used,
      amount_paid = v_amount, status = CASE WHEN p_sessions = v_used THEN 'depleted' ELSE 'active' END
    WHERE id = p_package_id RETURNING * INTO v_new;
  UPDATE public.payments SET amount = v_amount, package_sessions = p_sessions
    WHERE package_id = p_package_id;
  INSERT INTO public.session_package_corrections(package_id, corrected_by, reason, before_value, after_value)
    VALUES(p_package_id, auth.uid(), btrim(p_reason), to_jsonb(v_old), to_jsonb(v_new));
  RETURN to_jsonb(v_new);
END;
$function$;
CREATE OR REPLACE FUNCTION public.current_parent_can_access_grade(p_grade_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phone text;
begin
  select regexp_replace(coalesce(up.phone, ''), '[^0-9]', '', 'g')
  into v_phone
  from public.user_profiles up
  where up.id = auth.uid()
    and up.is_active = true
    and up.role = 'parent'
  limit 1;

  if coalesce(v_phone, '') = '' then
    return false;
  end if;

  return exists(
    select 1
    from public.students s
    join public.groups g on g.id = s.group_id
    where s.is_active = true
      and g.grade = p_grade_key
      and regexp_replace(coalesce(s.parent_phone, ''), '[^0-9]', '', 'g') = v_phone
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.current_parent_can_access_homework_path(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_assignment_id uuid;
begin
  begin
    v_assignment_id := split_part(coalesce(p_name, ''), '/', 1)::uuid;
  exception when others then
    return false;
  end;

  return exists(
    select 1
    from public.homework_assignments h
    where h.id = v_assignment_id
      and h.is_active = true
      and public.current_parent_can_access_grade(h.grade_key)
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.enforce_pending_points_session_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_is_active boolean := false;
  v_has_points_edit boolean := false;
  v_has_attendance_edit boolean := false;
  v_is_open boolean := false;
  v_session_exists boolean := false;
begin
  -- Service/admin SQL operations are not blocked by the client gate.
  if v_user_id is null then
    return new;
  end if;

  select up.role, up.is_active
  into v_role, v_is_active
  from public.user_profiles up
  where up.id = v_user_id;

  if v_role <> 'manager' or not coalesce(v_is_active, false) then
    return new;
  end if;

  v_has_points_edit := public.has_permission('points_edit');
  v_has_attendance_edit := public.has_permission('attendance_edit');

  -- Attendance editors (e.g. Om Walid) are not constrained by Walaa's gate.
  if v_has_attendance_edit or not v_has_points_edit then
    return new;
  end if;

  select exists(
    select 1
    from public.sessions s
    where s.group_id = new.group_id
      and s.session_date = new.session_date
      and coalesce(s.status, '') <> 'cancelled'
  ) into v_session_exists;

  if v_session_exists then
    raise exception 'MANAGER_POINTS_SESSION_CLOSED';
  end if;

  select coalesce(a.is_open, false)
  into v_is_open
  from public.manager_points_session_access a
  where a.group_id = new.group_id
    and a.session_date = new.session_date;

  if not coalesce(v_is_open, false) then
    raise exception 'MANAGER_POINTS_SESSION_NOT_OPEN';
  end if;

  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_attendance_pending_session_points(p_group_id uuid, p_session_date date)
 RETURNS TABLE(id uuid, student_id uuid, points numeric, reason_key text, reason_type text, reason_text text, session_date date, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_is_active boolean;
  v_can_edit boolean := false;
begin
  select up.role, coalesce(up.is_active, false)
    into v_role, v_is_active
  from public.user_profiles up
  where up.id = v_user_id;

  if v_is_active and v_role = 'owner' then
    v_can_edit := true;
  elsif v_is_active and v_role = 'manager' then
    select coalesce((mp.permissions ->> 'attendance_edit')::boolean, false)
      into v_can_edit
    from public.manager_permissions mp
    where mp.user_id = v_user_id;
  end if;

  if not coalesce(v_can_edit, false) then
    raise exception 'Attendance edit permission required';
  end if;

  return query
  select
    p.id,
    p.student_id,
    p.points,
    p.reason_key,
    p.reason_type,
    p.reason_text,
    p.session_date,
    p.status
  from public.pending_session_points p
  join public.students s on s.id = p.student_id
  where s.group_id = p_group_id
    and p.session_date = p_session_date
    and p.status = 'pending'
  order by p.created_at asc;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_lesson_contents_for_admin(p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.can_manage_lesson_content() THEN
    RAISE EXCEPTION 'LESSON_CONTENT_PERMISSION_DENIED';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(content_row)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      lc.id,
      lc.group_id,
      lc.lesson_date,
      lc.title,
      lc.vocabulary,
      lc.reading_text,
      lc.notes,
      lc.created_at,
      lc.updated_at
    FROM public.lesson_contents lc
    WHERE lc.group_id = p_group_id
      AND lc.is_active = true
    ORDER BY lc.lesson_date DESC, lc.updated_at DESC
    LIMIT 40
  ) content_row;

  RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_manager_points_session_access(p_group_id uuid, p_session_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_is_active boolean := false;
  v_allowed boolean := false;
  v_is_open boolean := false;
  v_session_exists boolean := false;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select up.role, up.is_active
  into v_role, v_is_active
  from public.user_profiles up
  where up.id = v_user_id;

  if not coalesce(v_is_active, false) then
    raise exception 'Account is not active';
  end if;

  v_allowed :=
    v_role = 'owner'
    or (
      v_role = 'manager'
      and (
        public.has_permission('attendance_edit')
        or public.has_permission('points_edit')
      )
    );

  if not v_allowed then
    raise exception 'Not allowed';
  end if;

  select exists(
    select 1
    from public.sessions s
    where s.group_id = p_group_id
      and s.session_date = p_session_date
      and coalesce(s.status, '') <> 'cancelled'
  ) into v_session_exists;

  select coalesce(a.is_open, false)
  into v_is_open
  from public.manager_points_session_access a
  where a.group_id = p_group_id
    and a.session_date = p_session_date;

  return jsonb_build_object(
    'ok', true,
    'is_open', coalesce(v_is_open, false) and not v_session_exists,
    'session_exists', v_session_exists
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_owner_daily_financial_summary(p_date date)
 RETURNS TABLE(paid_total numeric, deferred_total numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_owner() then
    raise exception 'غير مسموح بعرض البيانات المالية';
  end if;

  return query
  select
    coalesce(
      (
        select sum(payment.amount)
        from public.payments payment
        where payment.paid_at::date = p_date
      ),
      0
    )::numeric as paid_total,

    coalesce(
      (
        select sum(attendance_record.charge_amount)
        from public.attendance attendance_record
        join public.sessions session_record
          on session_record.id =
             attendance_record.session_id
        where session_record.session_date = p_date
          and attendance_record.payment_status = 'due'
      ),
      0
    )::numeric as deferred_total;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_owner_daily_payment_report(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
begin
  if not public.is_owner() then
    raise exception 'غير مسموح بعرض البيانات المالية';
  end if;

  select jsonb_build_object(

    'paid_total',
    coalesce(
      (
        select sum(p.amount)
        from public.payments p
        where p.paid_at::date = p_date
      ),
      0
    ),

    'deferred_total',
    coalesce(
      (
        select sum(a.charge_amount)
        from public.attendance a
        join public.sessions se
          on se.id = a.session_id
        where se.session_date = p_date
          and a.payment_status = 'due'
      ),
      0
    ),

    'free_count',
    coalesce(
      (
        select count(*)
        from public.attendance a
        join public.sessions se
          on se.id = a.session_id
        where se.session_date = p_date
          and a.payment_status = 'free'
          and a.attendance_status in ('present', 'late')
      ),
      0
    ),

    'free_students',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'student_name', s.full_name,
            'group_name', g.name
          )
          order by s.full_name
        )
        from public.attendance a
        join public.sessions se
          on se.id = a.session_id
        join public.students s
          on s.id = a.student_id
        left join public.groups g
          on g.id = s.group_id
        where se.session_date = p_date
          and a.payment_status = 'free'
          and a.attendance_status in ('present', 'late')
      ),
      '[]'::jsonb
    )

  )
  into result;

  return result;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_owner_daily_payment_report_v2(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_owner boolean;
  v_paid_total numeric := 0;
  v_deferred_total numeric := 0;
  v_free_count integer := 0;
  v_free_students jsonb := '[]'::jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'owner'
      AND up.is_active = true
  ) INTO v_is_owner;

  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'OWNER_PERMISSION_REQUIRED';
  END IF;

  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_paid_total
  FROM public.payments p
  WHERE (p.paid_at AT TIME ZONE 'Africa/Cairo')::date = p_date;

  SELECT COALESCE(
    SUM(
      GREATEST(
        COALESCE(a.charge_amount, 0) - COALESCE(a.paid_amount, 0),
        0
      )
    ) FILTER (WHERE a.payment_status = 'due'),
    0
  )
  INTO v_deferred_total
  FROM public.attendance a
  JOIN public.sessions se ON se.id = a.session_id
  WHERE se.session_date = p_date;

  WITH free_rows AS (
    SELECT
      s.full_name AS student_name,
      COALESCE(g.name, 'مجموعة غير محددة') AS group_name
    FROM public.attendance a
    JOIN public.sessions se ON se.id = a.session_id
    JOIN public.students s ON s.id = a.student_id
    LEFT JOIN public.groups g ON g.id = se.group_id
    WHERE se.session_date = p_date
      AND a.payment_status = 'free'
      AND COALESCE(a.package_consumed, false) = false
      AND a.attendance_status IN ('present', 'late')
  )
  SELECT
    COUNT(*)::integer,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'student_name', student_name,
          'group_name', group_name
        )
        ORDER BY group_name, student_name
      ),
      '[]'::jsonb
    )
  INTO v_free_count, v_free_students
  FROM free_rows;

  RETURN jsonb_build_object(
    'paid_total', v_paid_total,
    'deferred_total', v_deferred_total,
    'free_count', v_free_count,
    'free_students', v_free_students
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_owner_pending_session_points(p_group_id uuid, p_session_date date)
 RETURNS TABLE(id uuid, student_id uuid, points numeric, reason_key text, reason_text text, status text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_is_active boolean := false;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select
    up.role,
    up.is_active
  into
    v_role,
    v_is_active
  from public.user_profiles up
  where up.id = v_user_id;

  if
    not coalesce(v_is_active, false)
    or not (
      v_role = 'owner'
      or (
        v_role = 'manager'
        and public.has_permission('attendance_edit')
      )
    )
  then
    raise exception 'Attendance edit permission required';
  end if;

  return query
  select
    p.id,
    p.student_id,
    p.points,
    p.reason_key,
    p.reason_text,
    p.status,
    p.created_at
  from public.pending_session_points p
  where p.group_id = p_group_id
    and p.session_date = p_session_date
    and p.status in (
      'pending',
      'approved'
    )
  order by
    p.student_id,
    p.created_at,
    p.id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_parent_child_schedule(p_child_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  schedule_result jsonb;
begin

  select jsonb_build_object(
    'child_id', s.id,
    'group_id', s.group_id,
    'group_name', g.name,
    'schedules',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', gs.id,
              'day_name', gs.day_name,
              'start_time', gs.start_time
            )
            order by gs.day_name, gs.start_time
          )
          from public.group_schedules gs
          where gs.group_id = s.group_id
            and gs.is_active = true
        ),
        '[]'::jsonb
      )
  )
  into schedule_result
  from public.students s
  join public.user_profiles up
    on up.id = auth.uid()
  left join public.groups g
    on g.id = s.group_id
  where s.id = p_child_id
    and s.is_active = true
    and up.is_active = true
    and up.role = 'parent'
    and regexp_replace(coalesce(s.parent_phone, ''), '[^0-9]', '', 'g')
      = regexp_replace(coalesce(up.phone, ''), '[^0-9]', '', 'g')
  limit 1;

  if schedule_result is null then
    raise exception 'Not authorized for this child'
      using errcode = '42501';
  end if;

  return schedule_result;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_parent_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  parent_phone_value text;
  dashboard_result jsonb;
begin
  select regexp_replace(
    coalesce(phone, ''),
    '[^0-9]',
    '',
    'g'
  )
  into parent_phone_value
  from public.user_profiles
  where id = auth.uid()
    and is_active = true
    and role = 'parent'
  limit 1;

  if coalesce(parent_phone_value, '') = '' then
    raise exception 'هذا الحساب غير مصرح له بواجهة ولي الأمر';
  end if;

  select jsonb_build_object(
    'children',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', child_data.id,
          'name', child_data.full_name,
          'school', child_data.school_name,
          'group_name', child_data.group_name,
          'grade', child_data.grade,
          'points', child_data.points_balance,
          'due_amount', child_data.due_amount,
          'due_sessions', child_data.due_sessions_count,
          'grade_rank', child_data.grade_rank,
          'overall_rank', child_data.overall_rank,
          'point_history', child_data.point_history,
          'sessions', child_data.sessions
        )
        order by child_data.full_name
      ),
      '[]'::jsonb
    )
  )
  into dashboard_result
  from (
    select
      student.id,
      student.full_name,
      student.school_name,
      student.group_id,
      academy_group.name as group_name,
      academy_group.grade,
      coalesce(student.points_balance, 0) as points_balance,
      coalesce(student.due_amount, 0) as due_amount,
      coalesce(student.due_sessions_count, 0) as due_sessions_count,
      (
        1 + (
          select count(*)
          from public.students other_student
          join public.groups other_group
            on other_group.id = other_student.group_id
          where other_student.is_active = true
            and coalesce(other_group.grade, other_group.stage) =
                coalesce(academy_group.grade, academy_group.stage)
            and coalesce(other_student.points_balance, 0) >
                coalesce(student.points_balance, 0)
        )
      ) as grade_rank,
      (
        1 + (
          select count(*)
          from public.students other_student
          where other_student.is_active = true
            and coalesce(other_student.points_balance, 0) >
                coalesce(student.points_balance, 0)
        )
      ) as overall_rank,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', point_row.id,
              'points', point_row.points,
              'reason_type', point_row.reason_type,
              'reason_text', point_row.reason_text,
              'created_at', point_row.created_at
            )
            order by point_row.created_at desc
          ),
          '[]'::jsonb
        )
        from (
          select
            pt.id,
            pt.points,
            pt.reason_type,
            pt.reason_text,
            pt.created_at
          from public.point_transactions pt
          where pt.student_id = student.id
            and pt.source = 'standalone'
          order by pt.created_at desc
          limit 50
        ) point_row
      ) as point_history,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'session_id', academy_session.id,
              'session_date', academy_session.session_date,
              'start_time', academy_session.start_time,
              'attendance_status', attendance_row.attendance_status,
              'payment_status', attendance_row.payment_status,
              'charge_amount', attendance_row.charge_amount,
              'points_change', attendance_row.points_change,
              'points_details', attendance_row.points_details,
              'notes', attendance_row.notes
            )
            order by academy_session.session_date desc,
                     academy_session.start_time desc
          ),
          '[]'::jsonb
        )
        from public.attendance attendance_row
        join public.sessions academy_session
          on academy_session.id = attendance_row.session_id
        where attendance_row.student_id = student.id
      ) as sessions
    from public.students student
    left join public.groups academy_group
      on academy_group.id = student.group_id
    where student.is_active = true
      and regexp_replace(
        coalesce(student.parent_phone, ''),
        '[^0-9]',
        '',
        'g'
      ) = parent_phone_value
  ) child_data;

  return coalesce(
    dashboard_result,
    '{"children":[]}'::jsonb
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_parent_homework(p_student_id uuid)
 RETURNS TABLE(assignment_id uuid, title text, notes text, homework_date date, assignment_created_at timestamp with time zone, file_id uuid, file_name text, mime_type text, storage_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phone text;
  v_grade_key text;
begin
  select regexp_replace(coalesce(up.phone, ''), '[^0-9]', '', 'g')
  into v_phone
  from public.user_profiles up
  where up.id = auth.uid()
    and up.is_active = true
    and up.role = 'parent'
  limit 1;

  if coalesce(v_phone, '') = '' then
    raise exception 'هذا الحساب غير مصرح له بواجهة ولي الأمر';
  end if;

  select g.grade
  into v_grade_key
  from public.students s
  join public.groups g on g.id = s.group_id
  where s.id = p_student_id
    and s.is_active = true
    and regexp_replace(coalesce(s.parent_phone, ''), '[^0-9]', '', 'g') = v_phone;

  if coalesce(v_grade_key, '') = '' then
    raise exception 'الطالب غير مرتبط بهذا الحساب';
  end if;

  return query
  select
    h.id,
    h.title,
    h.notes,
    h.homework_date,
    h.created_at,
    f.id,
    f.file_name,
    f.mime_type,
    f.storage_path
  from public.homework_assignments h
  left join public.homework_files f
    on f.assignment_id = h.id
  where h.grade_key = v_grade_key
    and h.is_active = true
  order by h.homework_date desc, h.created_at desc, f.created_at asc
  limit 100;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_parent_lesson_contents(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone_tail text;
  v_group_id uuid;
  v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'parent'
      AND up.is_active = true
  ) THEN
    RAISE EXCEPTION 'PARENT_PERMISSION_REQUIRED';
  END IF;

  v_phone_tail := right(
    regexp_replace(
      split_part(COALESCE(auth.jwt() ->> 'email', ''), '@', 1),
      '\D',
      '',
      'g'
    ),
    10
  );

  IF length(v_phone_tail) < 10 THEN
    RAISE EXCEPTION 'PARENT_PHONE_NOT_AVAILABLE';
  END IF;

  SELECT s.group_id
  INTO v_group_id
  FROM public.students s
  WHERE s.id = p_student_id
    AND s.is_active = true
    AND right(
      regexp_replace(COALESCE(s.parent_phone, ''), '\D', '', 'g'),
      10
    ) = v_phone_tail;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARENT_STUDENT_ACCESS_DENIED';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(content_row)), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      lc.id,
      lc.lesson_date,
      lc.title,
      lc.vocabulary,
      lc.reading_text,
      lc.notes
    FROM public.lesson_contents lc
    WHERE lc.group_id = v_group_id
      AND lc.is_active = true
      AND lc.lesson_date <= (now() AT TIME ZONE 'Africa/Cairo')::date
    ORDER BY lc.lesson_date DESC, lc.updated_at DESC
    LIMIT 40
  ) content_row;

  RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_safe_attendance()
 RETURNS TABLE(id uuid, session_id uuid, student_id uuid, attendance_status text, points_change numeric, notes text, created_at timestamp with time zone, points_details jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    attendance.id,
    attendance.session_id,
    attendance.student_id,
    attendance.attendance_status,
    attendance.points_change,
    attendance.notes,
    attendance.created_at,
    attendance.points_details
  from public.attendance
  where
    public.is_owner()
    or public.has_any_permission(
      array[
        'attendance_view',
        'attendance_edit'
      ]
    );
$function$;
CREATE OR REPLACE FUNCTION public.get_session_package_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sessions integer;
BEGIN
  IF NOT public.can_manage_session_packages() THEN
    RAISE EXCEPTION 'PACKAGE_PERMISSION_DENIED';
  END IF;

  SELECT default_package_sessions
  INTO v_sessions
  FROM public.billing_settings
  WHERE id = 1;

  RETURN jsonb_build_object(
    'default_package_sessions', COALESCE(v_sessions, 8)
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_student_due_balance(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_due_amount numeric(10,2) := 0;
  v_due_sessions integer := 0;
begin

  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not (
    public.is_owner()
    or public.has_permission('attendance_edit')
  ) then
    raise exception 'Attendance edit permission required';
  end if;

  select
    count(*) filter (
      where greatest(
        coalesce(a.charge_amount, 0)
        - coalesce(a.paid_amount, 0),
        0
      ) > 0
    )::integer,

    coalesce(
      sum(
        greatest(
          coalesce(a.charge_amount, 0)
          - coalesce(a.paid_amount, 0),
          0
        )
      ),
      0
    )

  into
    v_due_sessions,
    v_due_amount

  from public.attendance a

  where a.student_id = p_student_id
    and a.payment_status = 'due';

  return jsonb_build_object(
    'student_id', p_student_id,
    'due_sessions', v_due_sessions,
    'due_amount', v_due_amount
  );

end;
$function$;
CREATE OR REPLACE FUNCTION public.get_student_package_purchase_history(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'owner' AND is_active = true) THEN
    RAISE EXCEPTION 'OWNER_PERMISSION_REQUIRED';
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.purchased_at DESC), '[]'::jsonb)
    FROM public.student_session_packages p WHERE p.student_id = p_student_id AND p.status <> 'cancelled');
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_student_session_package_balances(p_student_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_active boolean;
  v_phone_tail text;
  v_result jsonb;
BEGIN
  SELECT role, is_active
  INTO v_role, v_active
  FROM public.user_profiles
  WHERE id = auth.uid();

  IF COALESCE(v_active, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'PACKAGE_PERMISSION_DENIED';
  END IF;

  IF v_role IN ('owner', 'manager') THEN
    IF NOT public.can_manage_session_packages() THEN
      RAISE EXCEPTION 'PACKAGE_PERMISSION_DENIED';
    END IF;
  ELSIF v_role = 'parent' THEN
    v_phone_tail := right(
      regexp_replace(
        split_part(COALESCE(auth.jwt() ->> 'email', ''), '@', 1),
        '\D',
        '',
        'g'
      ),
      10
    );

    IF length(v_phone_tail) < 10 THEN
      RAISE EXCEPTION 'PARENT_PHONE_NOT_AVAILABLE';
    END IF;
  ELSE
    RAISE EXCEPTION 'PACKAGE_PERMISSION_DENIED';
  END IF;

  WITH permitted_students AS (
    SELECT s.id
    FROM public.students s
    WHERE (p_student_ids IS NULL OR s.id = ANY(p_student_ids))
      AND (
        v_role IN ('owner', 'manager')
        OR (
          v_role = 'parent'
          AND right(
            regexp_replace(COALESCE(s.parent_phone, ''), '\D', '', 'g'),
            10
          ) = v_phone_tail
        )
      )
  ), balances AS (
    SELECT
      ps.id AS student_id,
      COALESCE(SUM(p.sessions_remaining) FILTER (
        WHERE p.status <> 'cancelled'
      ), 0)::integer AS remaining_sessions,
      MIN(p.starts_on) FILTER (
        WHERE p.status = 'active' AND p.sessions_remaining > 0
      ) AS first_valid_date,
      MIN(p.purchased_at) FILTER (
        WHERE p.status = 'active' AND p.sessions_remaining > 0
      ) AS first_purchased_at
    FROM permitted_students ps
    LEFT JOIN public.student_session_packages p
      ON p.student_id = ps.id
    GROUP BY ps.id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'student_id', student_id,
        'remaining_sessions', remaining_sessions,
        'first_valid_date', first_valid_date,
        'first_purchased_at', first_purchased_at
      )
      ORDER BY student_id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM balances;

  RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.handle_parent_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_signup_type text;
  v_phone text;
  v_full_name text;
begin
  v_signup_type :=
    coalesce(
      new.raw_user_meta_data->>'signup_type',
      ''
    );

  -- لا نتدخل إلا في حسابات أولياء الأمور
  if v_signup_type <> 'parent' then
    return new;
  end if;

  v_phone :=
    regexp_replace(
      coalesce(
        new.raw_user_meta_data->>'phone',
        ''
      ),
      '[^0-9]',
      '',
      'g'
    );

  -- تحويل 20xxxxxxxxxx إلى 01xxxxxxxxx
  if left(v_phone, 2) = '20'
     and length(v_phone) = 12 then
    v_phone :=
      '0' || substring(v_phone from 3);
  end if;

  v_full_name :=
    nullif(
      trim(
        coalesce(
          new.raw_user_meta_data->>'full_name',
          ''
        )
      ),
      ''
    );

  if v_full_name is null then
    v_full_name := 'ولي أمر';
  end if;

  insert into public.user_profiles (
    id,
    phone,
    full_name,
    role,
    is_active
  )
  values (
    new.id,
    v_phone,
    v_full_name,
    'parent',
    true
  );

  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.has_any_permission(permission_keys text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    public.is_owner()
    or exists (
      select 1
      from public.user_profiles profile
      join public.manager_permissions manager_permission
        on manager_permission.user_id = profile.id
      where profile.id = (select auth.uid())
        and profile.role = 'manager'
        and profile.is_active = true
        and exists (
          select 1
          from unnest(permission_keys) permission_key
          where coalesce(
            (
              manager_permission.permissions
              ->> permission_key
            )::boolean,
            false
          )
        )
    );
$function$;
CREATE OR REPLACE FUNCTION public.has_permission(permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    public.is_owner()
    or exists (
      select 1
      from public.user_profiles profile
      join public.manager_permissions manager_permission
        on manager_permission.user_id = profile.id
      where profile.id = (select auth.uid())
        and profile.role = 'manager'
        and profile.is_active = true
        and coalesce(
          (
            manager_permission.permissions
            ->> permission_key
          )::boolean,
          false
        )
    );
$function$;
CREATE OR REPLACE FUNCTION public.hook_validate_parent_signup(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_signup_type text;
  v_phone text;
begin
  v_signup_type :=
    coalesce(
      event->'user'->'user_metadata'->>'signup_type',
      ''
    );

  -- الدالة تتدخل فقط في تسجيل ولي الأمر
  -- ولا تؤثر على إنشاء حسابات الإدارة مستقبلًا
  if v_signup_type <> 'parent' then
    return '{}'::jsonb;
  end if;

  v_phone :=
    regexp_replace(
      coalesce(
        event->'user'->'user_metadata'->>'phone',
        ''
      ),
      '[^0-9]',
      '',
      'g'
    );

  -- تحويل 20xxxxxxxxxx إلى 01xxxxxxxxx
  if left(v_phone, 2) = '20'
     and length(v_phone) = 12 then
    v_phone :=
      '0' || substring(v_phone from 3);
  end if;

  -- فحص شكل رقم الموبايل المصري
  if v_phone !~ '^01[0125][0-9]{8}$' then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 400,
        'message', 'رقم الهاتف غير صحيح'
      )
    );
  end if;

  -- الرقم لازم يكون مسجل عند طالب نشط
  if not exists (
    select 1
    from public.students s
    where s.is_active = true
      and (
        regexp_replace(
          s.parent_phone,
          '[^0-9]',
          '',
          'g'
        ) = v_phone

        or

        regexp_replace(
          s.parent_phone,
          '[^0-9]',
          '',
          'g'
        ) = '20' || substring(v_phone from 2)
      )
  ) then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 403,
        'message', 'رقم الهاتف غير مسجل في بيانات أي طالب'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$function$;
CREATE OR REPLACE FUNCTION public.is_active_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.user_profiles
    where id = (select auth.uid())
      and role = 'admin'
      and is_active = true
  );
$function$;
CREATE OR REPLACE FUNCTION public.is_active_manager()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.user_profiles
    where id = (select auth.uid())
      and role = 'manager'
      and is_active = true
  );
$function$;
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_owner();
$function$;
CREATE OR REPLACE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.user_profiles
    where id = (select auth.uid())
      and role = 'owner'
      and is_active = true
  );
$function$;
CREATE OR REPLACE FUNCTION public.limit_active_managers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  managers_count integer;
begin
  if new.role = 'manager'
     and new.is_active = true then

    select count(*)
    into managers_count
    from public.user_profiles
    where role = 'manager'
      and is_active = true
      and id <> new.id;

    if managers_count >= 2 then
      raise exception
        'لا يمكن إضافة أكثر من مسؤولين اثنين';
    end if;
  end if;

  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.notify_parent_schedule_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'realtime'
AS $function$
begin

  if tg_op = 'INSERT' then

    perform realtime.send(
      jsonb_build_object('changed', true),
      'schedule_changed',
      'parent-schedule:' || new.group_id::text,
      true
    );

  elsif tg_op = 'DELETE' then

    perform realtime.send(
      jsonb_build_object('changed', true),
      'schedule_changed',
      'parent-schedule:' || old.group_id::text,
      true
    );

  elsif tg_op = 'UPDATE' then

    if old.group_id is distinct from new.group_id then

      perform realtime.send(
        jsonb_build_object('changed', true),
        'schedule_changed',
        'parent-schedule:' || old.group_id::text,
        true
      );

      perform realtime.send(
        jsonb_build_object('changed', true),
        'schedule_changed',
        'parent-schedule:' || new.group_id::text,
        true
      );

    else

      perform realtime.send(
        jsonb_build_object('changed', true),
        'schedule_changed',
        'parent-schedule:' || new.group_id::text,
        true
      );

    end if;

  end if;

  return null;
end;
$function$;
CREATE OR REPLACE FUNCTION public.parent_can_receive_schedule_topic(p_topic text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.user_profiles up
    join public.students s
      on regexp_replace(coalesce(s.parent_phone, ''), '[^0-9]', '', 'g')
       = regexp_replace(coalesce(up.phone, ''), '[^0-9]', '', 'g')
    where up.id = auth.uid()
      and up.is_active = true
      and up.role = 'parent'
      and s.is_active = true
      and p_topic = ('parent-schedule:' || s.group_id::text)
  );
$function$;
CREATE OR REPLACE FUNCTION public.pay_student_due(p_student_id uuid, p_amount numeric, p_payment_method text DEFAULT 'cash'::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total_due numeric(10,2) := 0;
  v_remaining_payment numeric(10,2);
  v_row record;
  v_row_due numeric(10,2);
  v_apply numeric(10,2);
  v_remaining_due numeric(10,2) := 0;
  v_receipt_number bigint;
begin

  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_owner()
     and not public.has_permission('attendance_edit')
  then
    raise exception 'Attendance edit permission required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  select coalesce(
    sum(
      greatest(
        coalesce(a.charge_amount, 0)
        - coalesce(a.paid_amount, 0),
        0
      )
    ),
    0
  )
  into v_total_due
  from public.attendance a
  where a.student_id = p_student_id
    and a.payment_status = 'due';

  if v_total_due <= 0 then
    raise exception 'Student has no outstanding balance';
  end if;

  if p_amount > v_total_due then
    raise exception 'Payment exceeds outstanding balance';
  end if;

  v_remaining_payment := p_amount;

  for v_row in
    select
      a.id,
      a.charge_amount,
      a.paid_amount
    from public.attendance a
    join public.sessions s
      on s.id = a.session_id
    where a.student_id = p_student_id
      and a.payment_status = 'due'
      and coalesce(a.charge_amount, 0)
          > coalesce(a.paid_amount, 0)
    order by
      s.session_date asc,
      a.created_at asc
    for update of a
  loop

    exit when v_remaining_payment <= 0;

    v_row_due :=
      coalesce(v_row.charge_amount, 0)
      - coalesce(v_row.paid_amount, 0);

    v_apply :=
      least(v_remaining_payment, v_row_due);

    update public.attendance
    set
      paid_amount =
        coalesce(paid_amount, 0) + v_apply,

      payment_status =
        case
          when coalesce(paid_amount, 0) + v_apply
               >= coalesce(charge_amount, 0)
          then 'paid'
          else 'due'
        end

    where id = v_row.id;

    v_remaining_payment :=
      v_remaining_payment - v_apply;

  end loop;

  insert into public.payments (
    student_id,
    amount,
    payment_method,
    notes
  )
  values (
    p_student_id,
    p_amount,
    coalesce(
      nullif(trim(p_payment_method), ''),
      'cash'
    ),
    p_notes
  )
  returning receipt_number
  into v_receipt_number;

  select coalesce(
    sum(
      greatest(
        coalesce(a.charge_amount, 0)
        - coalesce(a.paid_amount, 0),
        0
      )
    ),
    0
  )
  into v_remaining_due
  from public.attendance a
  where a.student_id = p_student_id
    and a.payment_status = 'due';

  return jsonb_build_object(
    'success', true,
    'receipt_number', v_receipt_number,
    'paid_now', p_amount,
    'remaining_due', v_remaining_due
  );

end;
$function$;
CREATE OR REPLACE FUNCTION public.pay_student_due_balance(p_student_id uuid, p_amount numeric, p_payment_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_is_active boolean := false;

  v_due numeric := 0;
  v_left numeric := 0;

  v_row record;
  v_row_remaining numeric := 0;
  v_apply numeric := 0;

  v_receipt_number bigint;
begin

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select
    role,
    is_active
  into
    v_role,
    v_is_active
  from public.user_profiles
  where id = v_user_id;

  if
    not coalesce(v_is_active, false)
    or not (
      v_role = 'owner'
      or (
        v_role = 'manager'
        and public.has_permission('attendance_edit')
      )
    )
  then
    raise exception 'Attendance edit permission required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'المبلغ غير صحيح';
  end if;

  select
    coalesce(
      sum(
        greatest(
          coalesce(charge_amount, 0)
          - coalesce(paid_amount, 0),
          0
        )
      ),
      0
    )
  into v_due
  from public.attendance
  where student_id = p_student_id
    and payment_status = 'due';

  if v_due <= 0 then
    raise exception 'لا توجد متأخرات على الطالب';
  end if;

  if p_amount > v_due then
    raise exception 'المبلغ أكبر من المتأخر الحالي';
  end if;

  v_left := p_amount;

  for v_row in

    select
      a.id,
      a.charge_amount,
      a.paid_amount

    from public.attendance a
    join public.sessions s
      on s.id = a.session_id

    where a.student_id = p_student_id
      and a.payment_status = 'due'
      and coalesce(a.charge_amount, 0)
          > coalesce(a.paid_amount, 0)

    order by
      s.session_date,
      a.created_at,
      a.id

    for update of a

  loop

    exit when v_left <= 0;

    v_row_remaining :=
      coalesce(v_row.charge_amount, 0)
      - coalesce(v_row.paid_amount, 0);

    v_apply :=
      least(v_left, v_row_remaining);

    update public.attendance
    set
      paid_amount =
        coalesce(paid_amount, 0) + v_apply,

      payment_status =
        case
          when
            coalesce(paid_amount, 0) + v_apply
            >= coalesce(charge_amount, 0)
          then 'paid'
          else 'due'
        end

    where id = v_row.id;

    v_left := v_left - v_apply;

  end loop;

  insert into public.payments (
    student_id,
    amount,
    payment_method,
    notes
  )
  values (
    p_student_id,
    p_amount,
    p_payment_method,
    'سداد متأخرات'
  )
  returning receipt_number
  into v_receipt_number;

  return jsonb_build_object(
    'success', true,
    'paid_amount', p_amount,
    'remaining_due', v_due - p_amount,
    'receipt_number', v_receipt_number
  );

end;
$function$;
CREATE OR REPLACE FUNCTION public.protect_owner_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.role = 'owner' then

    if tg_op = 'DELETE' then
      raise exception
        'لا يمكن حذف حساب المالك الرئيسي';
    end if;

    if new.role <> 'owner'
       or new.is_active = false then
      raise exception
        'لا يمكن إلغاء أو تغيير دور المالك الرئيسي';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.purchase_student_session_package(p_student_id uuid, p_payment_method text, p_request_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.student_session_packages%ROWTYPE;
  v_package public.student_session_packages%ROWTYPE;
  v_sessions integer;
  v_unit_price numeric(12,2);
  v_amount numeric(12,2);
  v_total_remaining integer;
BEGIN
  IF NOT public.can_manage_session_packages() THEN
    RAISE EXCEPTION 'PACKAGE_PERMISSION_DENIED';
  END IF;

  IF p_student_id IS NULL OR p_request_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_PACKAGE_REQUEST';
  END IF;

  IF p_payment_method NOT IN (
    'cash',
    'instapay',
    'vodafone_cash',
    'bank_transfer'
  ) THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.student_session_packages
  WHERE purchase_token = p_request_token;

  IF FOUND THEN
    IF v_existing.student_id IS DISTINCT FROM p_student_id THEN
      RAISE EXCEPTION 'PACKAGE_REQUEST_TOKEN_MISMATCH';
    END IF;

    SELECT COALESCE(SUM(sessions_remaining), 0)::integer
    INTO v_total_remaining
    FROM public.student_session_packages
    WHERE student_id = p_student_id
      AND status <> 'cancelled';

    RETURN jsonb_build_object(
      'package_id', v_existing.id,
      'sessions_added', v_existing.sessions_total,
      'remaining_sessions', v_total_remaining,
      'unit_price', v_existing.unit_price,
      'amount_paid', v_existing.amount_paid,
      'duplicate_request', true
    );
  END IF;

  SELECT COALESCE(bs.default_package_sessions, 8)
  INTO v_sessions
  FROM public.billing_settings bs
  WHERE bs.id = 1;

  SELECT g.session_price
  INTO v_unit_price
  FROM public.students s
  JOIN public.groups g ON g.id = s.group_id
  WHERE s.id = p_student_id
    AND s.is_active = true
  FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STUDENT_OR_GROUP_NOT_FOUND';
  END IF;

  v_unit_price := COALESCE(v_unit_price, 0);

  IF v_unit_price <= 0 THEN
    RAISE EXCEPTION 'SESSION_PRICE_NOT_CONFIGURED';
  END IF;

  v_amount := round(v_sessions * v_unit_price, 2);

  INSERT INTO public.student_session_packages (
    student_id,
    sessions_total,
    sessions_remaining,
    unit_price,
    amount_paid,
    payment_method,
    starts_on,
    purchased_at,
    created_by,
    purchase_token,
    status
  )
  VALUES (
    p_student_id,
    v_sessions,
    v_sessions,
    v_unit_price,
    v_amount,
    p_payment_method,
    (now() AT TIME ZONE 'Africa/Cairo')::date,
    now(),
    auth.uid(),
    p_request_token,
    'active'
  )
  RETURNING * INTO v_package;

  INSERT INTO public.payments (
    student_id,
    amount,
    payment_method,
    paid_at,
    payment_source,
    package_id,
    package_sessions
  )
  VALUES (
    p_student_id,
    v_amount,
    p_payment_method,
    now(),
    'session_package',
    v_package.id,
    v_sessions
  );

  SELECT COALESCE(SUM(sessions_remaining), 0)::integer
  INTO v_total_remaining
  FROM public.student_session_packages
  WHERE student_id = p_student_id
    AND status <> 'cancelled';

  RETURN jsonb_build_object(
    'package_id', v_package.id,
    'sessions_added', v_sessions,
    'remaining_sessions', v_total_remaining,
    'unit_price', v_unit_price,
    'amount_paid', v_amount,
    'starts_on', v_package.starts_on,
    'duplicate_request', false
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.purchase_student_session_package_custom(p_student_id uuid, p_payment_method text, p_request_token uuid, p_sessions integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.student_session_packages%ROWTYPE;
  v_package public.student_session_packages%ROWTYPE;
  v_unit_price numeric(12,2);
  v_amount numeric(12,2);
  v_total_remaining integer;
BEGIN
  IF NOT public.can_manage_session_packages() THEN
    RAISE EXCEPTION 'PACKAGE_PERMISSION_DENIED';
  END IF;

  IF p_student_id IS NULL OR p_request_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_PACKAGE_REQUEST';
  END IF;

  IF p_sessions IS NULL OR p_sessions < 1 OR p_sessions > 100 THEN
    RAISE EXCEPTION 'INVALID_PACKAGE_SESSION_COUNT';
  END IF;

  IF p_payment_method NOT IN (
    'cash',
    'instapay',
    'vodafone_cash',
    'bank_transfer'
  ) THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.student_session_packages
  WHERE purchase_token = p_request_token;

  IF FOUND THEN
    IF v_existing.student_id IS DISTINCT FROM p_student_id
       OR v_existing.sessions_total IS DISTINCT FROM p_sessions
       OR v_existing.payment_method IS DISTINCT FROM p_payment_method THEN
      RAISE EXCEPTION 'PACKAGE_REQUEST_TOKEN_MISMATCH';
    END IF;

    SELECT COALESCE(SUM(sessions_remaining), 0)::integer
    INTO v_total_remaining
    FROM public.student_session_packages
    WHERE student_id = p_student_id
      AND status <> 'cancelled';

    RETURN jsonb_build_object(
      'package_id', v_existing.id,
      'sessions_added', v_existing.sessions_total,
      'remaining_sessions', v_total_remaining,
      'unit_price', v_existing.unit_price,
      'amount_paid', v_existing.amount_paid,
      'duplicate_request', true
    );
  END IF;

  SELECT g.session_price
  INTO v_unit_price
  FROM public.students s
  JOIN public.groups g ON g.id = s.group_id
  WHERE s.id = p_student_id
    AND s.is_active = true
  FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STUDENT_OR_GROUP_NOT_FOUND';
  END IF;

  v_unit_price := COALESCE(v_unit_price, 0);

  IF v_unit_price <= 0 THEN
    RAISE EXCEPTION 'SESSION_PRICE_NOT_CONFIGURED';
  END IF;

  v_amount := round(p_sessions * v_unit_price, 2);

  INSERT INTO public.student_session_packages (
    student_id,
    sessions_total,
    sessions_remaining,
    unit_price,
    amount_paid,
    payment_method,
    starts_on,
    purchased_at,
    created_by,
    purchase_token,
    status
  )
  VALUES (
    p_student_id,
    p_sessions,
    p_sessions,
    v_unit_price,
    v_amount,
    p_payment_method,
    (now() AT TIME ZONE 'Africa/Cairo')::date,
    now(),
    auth.uid(),
    p_request_token,
    'active'
  )
  RETURNING * INTO v_package;

  INSERT INTO public.payments (
    student_id,
    amount,
    payment_method,
    paid_at,
    payment_source,
    package_id,
    package_sessions
  )
  VALUES (
    p_student_id,
    v_amount,
    p_payment_method,
    now(),
    'session_package',
    v_package.id,
    p_sessions
  );

  SELECT COALESCE(SUM(sessions_remaining), 0)::integer
  INTO v_total_remaining
  FROM public.student_session_packages
  WHERE student_id = p_student_id
    AND status <> 'cancelled';

  RETURN jsonb_build_object(
    'package_id', v_package.id,
    'sessions_added', p_sessions,
    'remaining_sessions', v_total_remaining,
    'unit_price', v_unit_price,
    'amount_paid', v_amount,
    'starts_on', v_package.starts_on,
    'duplicate_request', false
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.queue_manager_points(p_student_id uuid, p_points numeric, p_reason_key text, p_reason_type text, p_reason_text text, p_session_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_is_active boolean := false;
  v_can_edit boolean := false;
  v_group_id uuid;
  v_due_sessions integer;
  v_student_active boolean;
  v_session_status text;
  v_reason_type text;
  v_pending_id uuid;
  v_existing_status text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select up.role, up.is_active
    into v_role, v_is_active
  from public.user_profiles up
  where up.id = v_user_id;

  if not coalesce(v_is_active, false) then
    raise exception 'Inactive account';
  end if;

  if v_role = 'owner' then
    v_can_edit := true;

  elsif v_role = 'manager' then
    select coalesce(
      (mp.permissions ->> 'points_edit')::boolean,
      false
    )
      into v_can_edit
    from public.manager_permissions mp
    where mp.user_id = v_user_id;
  end if;

  if not coalesce(v_can_edit, false) then
    raise exception 'Points permission denied';
  end if;

  if
    p_student_id is null
    or p_session_date is null
    or p_points is null
    or p_points = 0
    or nullif(btrim(coalesce(p_reason_key, '')), '') is null
  then
    raise exception 'Invalid points request';
  end if;

  select
    s.group_id,
    s.due_sessions_count,
    s.is_active
  into
    v_group_id,
    v_due_sessions,
    v_student_active
  from public.students s
  where s.id = p_student_id;

  if
    v_group_id is null
    or not coalesce(v_student_active, false)
  then
    raise exception 'Student not found or inactive';
  end if;

  if coalesce(v_due_sessions, 0) >= 3 then
    return jsonb_build_object(
      'queued', false,
      'blocked', true
    );
  end if;

  select s.status
    into v_session_status
  from public.sessions s
  where s.group_id = v_group_id
    and s.session_date = p_session_date
  order by s.created_at desc
  limit 1
  for share;

  -- المالك وموظف Points المصرح له يستطيعان تسجيل النقاط
  -- حتى لو الحصة أصبحت completed/cancelled.
  if
    v_session_status in ('completed', 'cancelled')
    and not v_can_edit
  then
    return jsonb_build_object(
      'queued', false,
      'closed', true,
      'session_status', v_session_status
    );
  end if;

  v_reason_type :=
    case
      when p_reason_type = 'homework'
        then 'homework'
      when p_reason_type = 'participation'
        then 'participation'
      else 'manual'
    end;

  insert into public.pending_session_points (
    student_id,
    group_id,
    session_date,
    points,
    reason_key,
    reason_type,
    reason_text,
    status,
    created_by,
    updated_at
  )
  values (
    p_student_id,
    v_group_id,
    p_session_date,
    p_points,
    btrim(p_reason_key),
    v_reason_type,
    nullif(btrim(coalesce(p_reason_text, '')), ''),
    'pending',
    v_user_id,
    now()
  )
  on conflict (
    student_id,
    session_date,
    reason_key
  )
  do update set
    group_id = excluded.group_id,
    points = excluded.points,
    reason_type = excluded.reason_type,
    reason_text = excluded.reason_text,
    created_by = excluded.created_by,
    updated_at = now()
  where public.pending_session_points.status = 'pending'
  returning id
  into v_pending_id;

  if v_pending_id is null then
    select p.status
      into v_existing_status
    from public.pending_session_points p
    where p.student_id = p_student_id
      and p.session_date = p_session_date
      and p.reason_key = btrim(p_reason_key);

    return jsonb_build_object(
      'queued', false,
      'already_applied', v_existing_status = 'applied',
      'status', v_existing_status
    );
  end if;

  return jsonb_build_object(
    'queued', true,
    'blocked', false,
    'pending_id', v_pending_id
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.queue_manager_points_authorized(p_student_id uuid, p_points numeric, p_reason_key text, p_reason_type text, p_reason_text text, p_session_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_is_active boolean := false;
  v_group_id uuid;
  v_is_open boolean := false;
  v_session_exists boolean := false;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select up.role, up.is_active
  into v_role, v_is_active
  from public.user_profiles up
  where up.id = v_user_id;

  if not coalesce(v_is_active, false) then
    raise exception 'الحساب غير مفعل';
  end if;

  if not (
    v_role = 'owner'
    or (
      v_role = 'manager'
      and public.has_permission('points_edit')
    )
  ) then
    raise exception 'لا توجد صلاحية لإضافة النقاط';
  end if;

  select s.group_id
  into v_group_id
  from public.students s
  where s.id = p_student_id
    and s.is_active = true;

  if v_group_id is null then
    raise exception 'الطالب غير موجود';
  end if;

  select exists(
    select 1
    from public.sessions sess
    where sess.group_id = v_group_id
      and sess.session_date = p_session_date
      and coalesce(sess.status, '') <> 'cancelled'
  ) into v_session_exists;

  if v_session_exists then
    return jsonb_build_object(
      'ok', false,
      'closed', true,
      'message', 'تم تسجيل الحصة وأغلقت عند ولاء'
    );
  end if;

  -- Owner is allowed; points-only managers need an explicit open gate.
  if v_role <> 'owner' then
    select coalesce(a.is_open, false)
    into v_is_open
    from public.manager_points_session_access a
    where a.group_id = v_group_id
      and a.session_date = p_session_date;

    if not coalesce(v_is_open, false) then
      return jsonb_build_object(
        'ok', false,
        'closed', true,
        'message', 'الحصة غير مفتوحة عند ولاء'
      );
    end if;
  end if;

  return public.queue_manager_points(
    p_student_id,
    p_points,
    p_reason_key,
    p_reason_type,
    p_reason_text,
    p_session_date
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.queue_owner_teacher_board_point(p_student_id uuid, p_points numeric, p_event_key text, p_session_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.restrict_manager_student_updates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_user_role text;
  allowed_columns text[] := array['updated_at'];
begin
  select role
  into current_user_role
  from public.user_profiles
  where id = (select auth.uid())
    and is_active = true;

  -- عمليات SQL الداخلية أو المالك لا تُقيّد
  if current_user_role is null
     or current_user_role = 'owner' then
    return new;
  end if;

  if current_user_role <> 'manager' then
    return new;
  end if;

  -- تعديل الطلاب بالكامل
  if public.has_permission('students_edit') then
    return new;
  end if;

  -- الحضور يسمح بتعديل المستحقات والنقاط
  if public.has_permission('attendance_edit') then
    allowed_columns :=
      allowed_columns
      || array[
        'due_sessions_count',
        'due_amount',
        'points_balance'
      ];
  end if;

  -- المدفوعات تسمح بتعديل المستحقات فقط
  if public.has_permission('payments_edit') then
    allowed_columns :=
      allowed_columns
      || array[
        'due_sessions_count',
        'due_amount'
      ];
  end if;

  -- النقاط تسمح بتعديل رصيد النقاط فقط
  if public.has_permission('points_edit') then
    allowed_columns :=
      allowed_columns
      || array[
        'points_balance'
      ];
  end if;

  if
    (
      to_jsonb(new) - allowed_columns
    )
    is distinct from
    (
      to_jsonb(old) - allowed_columns
    )
  then
    raise exception
      'ليس لديك صلاحية لتعديل هذه البيانات';
  end if;

  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.review_pending_session_point(p_pending_id uuid, p_action text, p_points numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_is_active boolean := false;

  v_row public.pending_session_points%rowtype;
  v_new_points numeric;
begin

  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select
    up.role,
    up.is_active
  into
    v_role,
    v_is_active
  from public.user_profiles up
  where up.id = v_user_id;

  
if
  not coalesce(v_is_active, false)
  or not (
    v_role = 'owner'
    or (
      v_role = 'manager'
      and public.has_permission('attendance_edit')
    )
  )
then
  raise exception 'Attendance edit permission required';
end if;


  select *
  into v_row
  from public.pending_session_points p
  where p.id = p_pending_id
  for update;

  if v_row.id is null then
    raise exception 'Pending point not found';
  end if;

  if v_row.status in (
    'applied',
    'cancelled'
  ) then
    raise exception
      'This point can no longer be changed';
  end if;


  if p_action = 'approve' then

    v_new_points :=
      coalesce(
        p_points,
        v_row.points
      );

    if
      v_new_points is null
      or v_new_points = 0
    then
      raise exception 'Points cannot be zero';
    end if;

    update public.pending_session_points
    set
      points = v_new_points,
      status = 'approved',
      updated_at = now()
    where id = p_pending_id;


  elsif p_action = 'edit' then

    if
      p_points is null
      or p_points = 0
    then
      raise exception 'Points cannot be zero';
    end if;

    update public.pending_session_points
    set
      points = p_points,
      status = 'pending',
      updated_at = now()
    where id = p_pending_id;


  elsif p_action = 'delete' then

    update public.pending_session_points
    set
      status = 'cancelled',
      updated_at = now()
    where id = p_pending_id;


  else
    raise exception 'Invalid review action';
  end if;


  return jsonb_build_object(
    'success', true,
    'id', p_pending_id,
    'action', p_action
  );

end;
$function$;
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
CREATE OR REPLACE FUNCTION public.save_attendance_batch_atomic(p_session_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_session public.sessions%ROWTYPE;
 v_row jsonb;
 v_student uuid;
 v_status text;
 v_payment text;
 v_points numeric;
 v_details jsonb;
 v_result jsonb;
 v_count integer := 0;
 v_expected integer;
 v_existing_count integer;
 v_saved_count integer;
 v_completion_ok boolean;
 v_expected_ids uuid[];
 v_supplied_ids uuid[];
 v_pending_count integer;
BEGIN
 IF NOT public.is_owner() THEN
   RAISE EXCEPTION 'ATTENDANCE_PERMISSION_DENIED';
 END IF;
 IF NOT public.can_manage_session_packages() THEN
   RAISE EXCEPTION 'PACKAGE_PERMISSION_REQUIRED';
 END IF;
 IF p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)=0 THEN
   RAISE EXCEPTION 'INVALID_ROSTER';
 END IF;
 SELECT * INTO v_session FROM public.sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
 IF v_session.status='completed' THEN
   RETURN jsonb_build_object('completed',true,'already_completed',true);
 END IF;
 IF v_session.status='cancelled' THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;
 -- Never mix a new atomic request with rows left by the old multi-call workflow.
 SELECT count(*) INTO v_existing_count FROM public.attendance WHERE session_id=p_session_id;
 IF v_existing_count > 0 THEN
   RAISE EXCEPTION 'EXISTING_PARTIAL_SESSION_REQUIRES_MANUAL_REVIEW';
 END IF;
 v_expected := jsonb_array_length(p_rows);
 IF (SELECT count(DISTINCT (x->>'student_id')) FROM jsonb_array_elements(p_rows) x)<>v_expected THEN
   RAISE EXCEPTION 'DUPLICATE_STUDENT_IN_ROSTER';
 END IF;
 -- Snapshot the full eligible roster under the session lock.
 -- IMPORTANT: legacy per-student RPCs do not lock this session row;
 -- deployment must add the same session-level lock to those paths
 -- or route all clients to the new endpoint before claiming cross-device safety. Do not complete
 -- a truncated request: equality checks IDs, not only counts.
 SELECT coalesce(array_agg(st.id ORDER BY st.id),ARRAY[]::uuid[])
 INTO v_expected_ids
 FROM public.students st
 WHERE st.group_id=v_session.group_id AND st.is_active=true;
 SELECT coalesce(array_agg((x->>'student_id')::uuid ORDER BY (x->>'student_id')::uuid),ARRAY[]::uuid[])
 INTO v_supplied_ids FROM jsonb_array_elements(p_rows) x;
 IF v_expected_ids IS DISTINCT FROM v_supplied_ids THEN
   RAISE EXCEPTION 'ROSTER_CHANGED_OR_INCOMPLETE';
 END IF;
 -- A pending Walaa entry must be reviewed before the batch starts;
 -- reject before any money, package or points mutation.
 SELECT count(*) INTO v_pending_count
 FROM public.pending_session_points p
 WHERE p.group_id=v_session.group_id AND p.session_date=v_session.session_date
   AND p.status='pending';
 IF v_pending_count > 0 THEN RAISE EXCEPTION 'PENDING_POINTS_REQUIRE_REVIEW'; END IF;
 FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
 LOOP
   v_student := (v_row->>'student_id')::uuid;
   v_status := v_row->>'attendance_status';
   v_payment := v_row->>'payment_status';
   v_points := (v_row->>'points_change')::numeric;
   v_details := coalesce(v_row->'points_details','[]'::jsonb);
   IF v_points IS NULL OR v_points <> trunc(v_points) THEN RAISE EXCEPTION 'NON_INTEGER_POINTS'; END IF;
   IF v_payment IS NULL OR v_status IS NULL THEN RAISE EXCEPTION 'MISSING_STATUS'; END IF;
   IF v_status NOT IN ('present','late','absent','excused')
      OR v_payment NOT IN ('paid','due','free')
      OR v_points IS NULL OR jsonb_typeof(v_details)<>'array' THEN
      RAISE EXCEPTION 'INVALID_ATTENDANCE_ROW';
   END IF;
   IF v_student IS NULL THEN RAISE EXCEPTION 'MISSING_STUDENT_ID'; END IF;
   IF NOT public.session_accepts_student(p_session_id,v_student) THEN
      RAISE EXCEPTION 'STUDENT_NOT_IN_SESSION_GROUP';
   END IF;
   IF v_status IN ('absent','excused') THEN v_payment:='free'; END IF;
   -- Package accounting must remain within the same transaction.
   IF v_status IN ('present','late') AND v_payment <> 'free' THEN
     v_result := public.save_package_attendance_if_available(
       p_session_id,v_student,v_status,v_payment,v_points::integer,v_details,NULL
     );
   ELSE
     v_result := jsonb_build_object('handled',false);
   END IF;
   IF NOT coalesce((v_result->>'handled')::boolean,false) THEN
     PERFORM public.save_safe_attendance_with_account(
       p_session_id,v_student,v_status,v_payment,v_points,v_details,NULL
     );
   END IF;
   v_count := v_count+1;
 END LOOP;
 -- Pending points must be reviewed before this call; this RPC will reject otherwise.
 v_result := public.complete_session_with_pending_points(p_session_id);
 SELECT count(*) INTO v_saved_count FROM public.attendance WHERE session_id=p_session_id;
 SELECT status = 'completed' INTO v_completion_ok FROM public.sessions WHERE id=p_session_id;
 IF v_saved_count <> v_expected OR NOT coalesce(v_completion_ok,false) THEN
   RAISE EXCEPTION 'ATOMIC_COMPLETION_INVARIANT_FAILED';
 END IF;
 RETURN jsonb_build_object('completed',true,'already_completed',false,
    'saved_count',v_count,'applied_count',coalesce((v_result->>'applied_count')::integer,0),'completion',v_result);
END;
$function$;
CREATE OR REPLACE FUNCTION public.save_lesson_content(p_content_id uuid, p_group_id uuid, p_lesson_date date, p_title text, p_vocabulary jsonb, p_reading_text text, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_content public.lesson_contents%ROWTYPE;
  v_vocabulary jsonb := COALESCE(p_vocabulary, '[]'::jsonb);
  v_reading_text text := NULLIF(btrim(COALESCE(p_reading_text, '')), '');
  v_notes text := NULLIF(btrim(COALESCE(p_notes, '')), '');
BEGIN
  IF NOT public.can_manage_lesson_content() THEN
    RAISE EXCEPTION 'LESSON_CONTENT_PERMISSION_DENIED';
  END IF;

  IF p_group_id IS NULL OR p_lesson_date IS NULL THEN
    RAISE EXCEPTION 'LESSON_GROUP_AND_DATE_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.groups g
    WHERE g.id = p_group_id
      AND g.is_active = true
  ) THEN
    RAISE EXCEPTION 'LESSON_GROUP_NOT_FOUND';
  END IF;

  IF char_length(btrim(COALESCE(p_title, ''))) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'INVALID_LESSON_TITLE';
  END IF;

  IF jsonb_typeof(v_vocabulary) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_LESSON_VOCABULARY';
  END IF;

  IF jsonb_array_length(v_vocabulary) > 300 THEN
    RAISE EXCEPTION 'TOO_MANY_LESSON_VOCABULARY_ITEMS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_vocabulary) item
    WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR char_length(btrim(COALESCE(item ->> 'english', ''))) NOT BETWEEN 1 AND 500
       OR char_length(COALESCE(item ->> 'arabic', '')) > 1000
  ) THEN
    RAISE EXCEPTION 'INVALID_LESSON_VOCABULARY_ITEM';
  END IF;

  IF v_reading_text IS NOT NULL AND char_length(v_reading_text) > 50000 THEN
    RAISE EXCEPTION 'LESSON_READING_TEXT_TOO_LONG';
  END IF;

  IF v_notes IS NOT NULL AND char_length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'LESSON_NOTES_TOO_LONG';
  END IF;

  IF jsonb_array_length(v_vocabulary) = 0 AND v_reading_text IS NULL THEN
    RAISE EXCEPTION 'LESSON_CONTENT_IS_EMPTY';
  END IF;

  IF p_content_id IS NULL THEN
    INSERT INTO public.lesson_contents (
      group_id,
      lesson_date,
      title,
      vocabulary,
      reading_text,
      notes,
      is_active,
      created_by,
      updated_by
    )
    VALUES (
      p_group_id,
      p_lesson_date,
      btrim(p_title),
      v_vocabulary,
      v_reading_text,
      v_notes,
      true,
      auth.uid(),
      auth.uid()
    )
    ON CONFLICT (group_id, lesson_date) DO UPDATE
    SET title = EXCLUDED.title,
        vocabulary = EXCLUDED.vocabulary,
        reading_text = EXCLUDED.reading_text,
        notes = EXCLUDED.notes,
        is_active = true,
        updated_by = auth.uid(),
        updated_at = now()
    RETURNING * INTO v_content;
  ELSE
    UPDATE public.lesson_contents
    SET group_id = p_group_id,
        lesson_date = p_lesson_date,
        title = btrim(p_title),
        vocabulary = v_vocabulary,
        reading_text = v_reading_text,
        notes = v_notes,
        is_active = true,
        updated_by = auth.uid(),
        updated_at = now()
    WHERE id = p_content_id
    RETURNING * INTO v_content;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'LESSON_CONTENT_NOT_FOUND';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_content.id,
    'group_id', v_content.group_id,
    'lesson_date', v_content.lesson_date,
    'updated_at', v_content.updated_at
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.save_package_attendance_if_available(p_session_id uuid, p_student_id uuid, p_attendance_status text, p_requested_payment_status text, p_points_change integer, p_points_details jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_date date;
  v_session_group_id uuid;
  v_session_start_time time;
  v_attendance public.attendance%ROWTYPE;
  v_package public.student_session_packages%ROWTYPE;
  v_chargeable boolean;
  v_old_points integer := 0;
  v_remaining integer := 0;
  v_details jsonb := COALESCE(p_points_details, '[]'::jsonb);
BEGIN
 PERFORM 1 FROM public.sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;

  IF NOT public.can_manage_session_packages() THEN RAISE EXCEPTION 'PACKAGE_PERMISSION_DENIED'; END IF;
  IF p_attendance_status NOT IN ('present','late','absent','excused') THEN RAISE EXCEPTION 'INVALID_ATTENDANCE_STATUS'; END IF;
  IF p_requested_payment_status NOT IN ('paid','due','free') THEN RAISE EXCEPTION 'INVALID_PAYMENT_STATUS'; END IF;

  SELECT se.session_date,se.group_id,se.start_time INTO v_session_date,v_session_group_id,v_session_start_time
  FROM public.sessions se WHERE se.id=p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;

  IF NOT public.session_accepts_student(p_session_id,p_student_id) THEN
    RAISE EXCEPTION 'STUDENT_NOT_IN_SESSION_GROUP';
  END IF;

  SELECT * INTO v_attendance FROM public.attendance a
  WHERE a.session_id=p_session_id AND a.student_id=p_student_id FOR UPDATE;
  IF FOUND THEN v_old_points:=COALESCE(v_attendance.points_change,0); END IF;

  v_chargeable:=p_attendance_status IN ('present','late');

  IF COALESCE(v_attendance.package_consumed,false) THEN
    IF v_chargeable AND p_requested_payment_status<>'free' THEN
      v_details:=v_details||jsonb_build_array(jsonb_build_object('value',0,'reason','package_payment','reason_label','من الباقة'));
      UPDATE public.attendance SET attendance_status=p_attendance_status,payment_status='paid',
        charge_amount=COALESCE(v_attendance.charge_amount,0),paid_amount=COALESCE(v_attendance.charge_amount,0),
        points_change=COALESCE(p_points_change,0),points_details=v_details,notes=p_notes,package_consumed=true
      WHERE id=v_attendance.id;
      UPDATE public.students SET points_balance=COALESCE(points_balance,0)+COALESCE(p_points_change,0)-v_old_points,updated_at=now() WHERE id=p_student_id;
      PERFORM public.sync_student_due_totals(p_student_id);
      SELECT COALESCE(SUM(sessions_remaining),0)::integer INTO v_remaining FROM public.student_session_packages WHERE student_id=p_student_id AND status<>'cancelled';
      RETURN jsonb_build_object('handled',true,'used_package',true,'restored_package',false,'remaining_sessions',v_remaining);
    END IF;
    UPDATE public.student_session_packages SET sessions_remaining=sessions_remaining+1,status='active' WHERE id=v_attendance.package_id;
    UPDATE public.attendance SET attendance_status=p_attendance_status,
      payment_status=CASE WHEN v_chargeable THEN p_requested_payment_status ELSE 'free' END,
      charge_amount=CASE WHEN v_chargeable AND p_requested_payment_status<>'free' THEN COALESCE(v_attendance.charge_amount,0) ELSE 0 END,
      paid_amount=0,points_change=COALESCE(p_points_change,0),points_details=v_details,notes=p_notes,package_id=NULL,package_consumed=false
    WHERE id=v_attendance.id;
    UPDATE public.students SET points_balance=COALESCE(points_balance,0)+COALESCE(p_points_change,0)-v_old_points,updated_at=now() WHERE id=p_student_id;
    PERFORM public.sync_student_due_totals(p_student_id);
    SELECT COALESCE(SUM(sessions_remaining),0)::integer INTO v_remaining FROM public.student_session_packages WHERE student_id=p_student_id AND status<>'cancelled';
    RETURN jsonb_build_object('handled',true,'used_package',false,'restored_package',true,'remaining_sessions',v_remaining);
  END IF;

  IF NOT v_chargeable OR p_requested_payment_status='free' THEN
    RETURN jsonb_build_object('handled',false,'used_package',false,'remaining_sessions',0);
  END IF;

  SELECT p.* INTO v_package FROM public.student_session_packages p
  WHERE p.student_id=p_student_id AND p.status='active' AND p.sessions_remaining>0
    AND (p.starts_on<v_session_date OR (p.starts_on=v_session_date AND p.purchased_at<((v_session_date+COALESCE(v_session_start_time,time '00:00')+interval '1 hour') AT TIME ZONE 'Africa/Cairo')))
  ORDER BY p.starts_on,p.purchased_at,p.id LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('handled',false,'used_package',false,'remaining_sessions',0); END IF;

  UPDATE public.student_session_packages SET sessions_remaining=sessions_remaining-1,
    status=CASE WHEN sessions_remaining-1=0 THEN 'depleted' ELSE 'active' END WHERE id=v_package.id;
  v_details:=v_details||jsonb_build_array(jsonb_build_object('value',0,'reason','package_payment','reason_label','من الباقة'));

  INSERT INTO public.attendance(session_id,student_id,attendance_status,payment_status,charge_amount,paid_amount,points_change,points_details,notes,package_id,package_consumed)
  VALUES(p_session_id,p_student_id,p_attendance_status,'paid',v_package.unit_price,v_package.unit_price,COALESCE(p_points_change,0),v_details,p_notes,v_package.id,true);

  UPDATE public.students SET points_balance=COALESCE(points_balance,0)+COALESCE(p_points_change,0)-v_old_points,updated_at=now() WHERE id=p_student_id;
  PERFORM public.sync_student_due_totals(p_student_id);
  SELECT COALESCE(SUM(sessions_remaining),0)::integer INTO v_remaining FROM public.student_session_packages WHERE student_id=p_student_id AND status<>'cancelled';
  RETURN jsonb_build_object('handled',true,'used_package',true,'restored_package',false,'remaining_sessions',v_remaining,'package_id',v_package.id);
END;
$function$;
CREATE OR REPLACE FUNCTION public.save_safe_attendance(p_session_id uuid, p_student_id uuid, p_attendance_status text, p_points_change numeric DEFAULT 0, p_points_details jsonb DEFAULT '[]'::jsonb, p_notes text DEFAULT NULL::text)
 RETURNS attendance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  old_attendance public.attendance;
  saved_attendance public.attendance;

  session_price numeric := 0;
  new_charge numeric := 0;

  preserved_manager_details jsonb := '[]'::jsonb;
  incoming_details jsonb := '[]'::jsonb;

  preserved_manager_points numeric := 0;
  effective_points_change numeric := 0;

begin
 PERFORM 1 FROM public.sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;


  if not public.is_owner()
     and not public.has_permission('attendance_edit') then
    raise exception 'ليس لديك صلاحية تسجيل الحضور';
  end if;


  if p_attendance_status not in (
    'present',
    'late',
    'absent',
    'excused'
  ) then
    raise exception 'حالة الحضور غير صحيحة';
  end if;


  select *
  into old_attendance
  from public.attendance
  where session_id = p_session_id
    and student_id = p_student_id
  for update;


  if found then

    /*
      الاحتفاظ بنقاط ولاء / المدير التي سبق
      اعتمادها وإضافتها للحصة.

      هذه النقاط يجب ألا تختفي عند إعادة
      حفظ الحضور.
    */
    select
      coalesce(
        jsonb_agg(
          x.detail
          order by x.ord
        ),
        '[]'::jsonb
      )
    into preserved_manager_details
    from jsonb_array_elements(
      coalesce(
        old_attendance.points_details,
        '[]'::jsonb
      )
    )
    with ordinality as x(detail, ord)
    where coalesce(
      x.detail ->> 'source',
      ''
    ) = 'manager_pending';


    /*
      حساب قيمة نقاط manager_pending
      الموجودة بالفعل في الحصة.
    */
    select
      coalesce(
        sum(
          case
            when jsonb_typeof(
              x.detail -> 'value'
            ) = 'number'
            then
              (x.detail ->> 'value')::numeric
            else 0
          end
        ),
        0
      )
    into preserved_manager_points
    from jsonb_array_elements(
      coalesce(
        old_attendance.points_details,
        '[]'::jsonb
      )
    ) as x(detail)
    where coalesce(
      x.detail ->> 'source',
      ''
    ) = 'manager_pending';


    /*
      بيانات النقاط الجديدة القادمة من شاشة الحضور.

      نستبعد manager_pending منها عمداً
      حتى لا تتكرر إذا وصلت من العميل
      لأي سبب.
    */
    select
      coalesce(
        jsonb_agg(
          x.detail
          order by x.ord
        ),
        '[]'::jsonb
      )
    into incoming_details
    from jsonb_array_elements(
      coalesce(
        p_points_details,
        '[]'::jsonb
      )
    )
    with ordinality as x(detail, ord)
    where coalesce(
      x.detail ->> 'source',
      ''
    ) <> 'manager_pending';


    /*
      إجمالي الحصة =
      نقاط الحضور الحالية
      +
      نقاط ولاء المعتمدة المحفوظة سابقاً
    */
    effective_points_change :=
      coalesce(p_points_change, 0)
      +
      coalesce(preserved_manager_points, 0);


    update public.attendance
    set
      attendance_status =
        p_attendance_status,

      points_change =
        effective_points_change,

      points_details =
        coalesce(
          incoming_details,
          '[]'::jsonb
        )
        ||
        coalesce(
          preserved_manager_details,
          '[]'::jsonb
        ),

      notes =
        p_notes

    where id =
      old_attendance.id

    returning *
    into saved_attendance;


    /*
      نلغي تأثير القيمة القديمة كاملة
      ثم نضيف القيمة الجديدة كاملة.

      وبما أن manager_pending تم الاحتفاظ بها،
      فلن تخصم من رصيد الطالب.
    */
    update public.students
    set
      points_balance =
        coalesce(points_balance, 0)
        -
        coalesce(
          old_attendance.points_change,
          0
        )
        +
        effective_points_change,

      updated_at = now()

    where id =
      p_student_id;


  else

    /*
      أول تسجيل حضور للطالب:
      لا توجد manager_pending قديمة
      نحتاج للاحتفاظ بها.
    */
    select
      coalesce(price, 0)
    into session_price
    from public.sessions
    where id = p_session_id;


    if not found then
      raise exception 'الحصة غير موجودة';
    end if;


    new_charge :=
      case
        when p_attendance_status in (
          'absent',
          'excused'
        )
        then 0
        else session_price
      end;


    insert into public.attendance (
      session_id,
      student_id,
      attendance_status,
      payment_status,
      charge_amount,
      points_change,
      admin_override,
      notes,
      points_details
    )
    values (
      p_session_id,
      p_student_id,
      p_attendance_status,

      case
        when p_attendance_status in (
          'absent',
          'excused'
        )
        then 'free'
        else 'due'
      end,

      new_charge,

      coalesce(
        p_points_change,
        0
      ),

      false,

      p_notes,

      coalesce(
        p_points_details,
        '[]'::jsonb
      )
    )

    returning *
    into saved_attendance;


    update public.students
    set
      points_balance =
        coalesce(points_balance, 0)
        +
        coalesce(
          p_points_change,
          0
        ),

      updated_at = now()

    where id =
      p_student_id;

  end if;


  return saved_attendance;

end;
$function$;
CREATE OR REPLACE FUNCTION public.save_safe_attendance_with_account(p_session_id uuid, p_student_id uuid, p_attendance_status text, p_payment_status text, p_points_change numeric DEFAULT 0, p_points_details jsonb DEFAULT '[]'::jsonb, p_notes text DEFAULT NULL::text)
 RETURNS attendance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ DECLARE saved_attendance public.attendance; effective_payment_status text; charge_to_remove numeric := 0; BEGIN PERFORM 1 FROM public.sessions WHERE id=p_session_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF; effective_payment_status := CASE WHEN p_attendance_status IN ('absent','excused') THEN 'free' ELSE p_payment_status END; IF effective_payment_status NOT IN ('paid','due','free') THEN RAISE EXCEPTION 'حالة الحساب غير صحيحة'; END IF; saved_attendance := public.save_safe_attendance(p_session_id,p_student_id,p_attendance_status,p_points_change,p_points_details,p_notes); IF saved_attendance.payment_status = effective_payment_status THEN RETURN saved_attendance; END IF; IF saved_attendance.payment_status <> 'due' THEN RAISE EXCEPTION 'حالة الحساب مسجلة بالفعل'; END IF; charge_to_remove := coalesce(saved_attendance.charge_amount,0); IF effective_payment_status = 'paid' THEN UPDATE public.attendance SET payment_status='paid' WHERE id=saved_attendance.id RETURNING * INTO saved_attendance; IF charge_to_remove > 0 THEN INSERT INTO public.payments (student_id,amount,payment_method,notes,attendance_id) VALUES (p_student_id,charge_to_remove,'cash','سداد الحصة',saved_attendance.id); END IF; ELSIF effective_payment_status = 'free' THEN UPDATE public.attendance SET payment_status='free',charge_amount=0 WHERE id=saved_attendance.id RETURNING * INTO saved_attendance; END IF; RETURN saved_attendance; END; $function$;
CREATE OR REPLACE FUNCTION public.session_accepts_student(p_session_id uuid, p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.sessions se
    JOIN public.students st ON st.id = p_student_id
    WHERE se.id = p_session_id
      AND st.is_active = true
      AND (
        st.group_id = se.group_id
        OR EXISTS (
          SELECT 1
          FROM public.attendance a
          WHERE a.session_id = se.id
            AND a.student_id = st.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.pending_session_points p
          WHERE p.group_id = se.group_id
            AND p.session_date = se.session_date
            AND p.student_id = st.id
            AND p.status IN ('pending','approved')
        )
      )
  );
$function$;
CREATE OR REPLACE FUNCTION public.set_academy_billing_settings(p_default_package_sessions integer, p_primary_price numeric, p_prep_price numeric, p_secondary_price numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_owner boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'owner'
      AND up.is_active = true
  ) INTO v_is_owner;

  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'OWNER_PERMISSION_REQUIRED';
  END IF;

  IF p_default_package_sessions IS NULL
     OR p_default_package_sessions < 1
     OR p_default_package_sessions > 100 THEN
    RAISE EXCEPTION 'INVALID_PACKAGE_SESSION_COUNT';
  END IF;

  IF p_primary_price IS NULL OR p_primary_price <= 0
     OR p_prep_price IS NULL OR p_prep_price <= 0
     OR p_secondary_price IS NULL OR p_secondary_price <= 0
     OR p_primary_price > 10000
     OR p_prep_price > 10000
     OR p_secondary_price > 10000 THEN
    RAISE EXCEPTION 'INVALID_SESSION_PRICE';
  END IF;

  INSERT INTO public.billing_settings (
    id,
    default_package_sessions,
    updated_at,
    updated_by
  )
  VALUES (
    1,
    p_default_package_sessions,
    now(),
    auth.uid()
  )
  ON CONFLICT (id) DO UPDATE
  SET default_package_sessions = EXCLUDED.default_package_sessions,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by;

  UPDATE public.groups
  SET session_price = CASE stage
    WHEN 'primary' THEN p_primary_price
    WHEN 'prep' THEN p_prep_price
    WHEN 'secondary' THEN p_secondary_price
    ELSE session_price
  END
  WHERE stage IN ('primary', 'prep', 'secondary')
    AND is_active = true;

  RETURN jsonb_build_object(
    'default_package_sessions', p_default_package_sessions,
    'primary_price', p_primary_price,
    'prep_price', p_prep_price,
    'secondary_price', p_secondary_price
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.set_default_session_package_size(p_default_package_sessions integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_owner boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'owner'
      AND up.is_active = true
  ) INTO v_is_owner;

  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'OWNER_PERMISSION_REQUIRED';
  END IF;

  IF p_default_package_sessions IS NULL
     OR p_default_package_sessions < 1
     OR p_default_package_sessions > 100 THEN
    RAISE EXCEPTION 'INVALID_PACKAGE_SESSION_COUNT';
  END IF;

  INSERT INTO public.billing_settings (
    id,
    default_package_sessions,
    updated_at,
    updated_by
  )
  VALUES (
    1,
    p_default_package_sessions,
    now(),
    auth.uid()
  )
  ON CONFLICT (id) DO UPDATE
  SET default_package_sessions = EXCLUDED.default_package_sessions,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by;

  RETURN jsonb_build_object(
    'default_package_sessions', p_default_package_sessions
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.set_lesson_content_active(p_content_id uuid, p_is_active boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_manage_lesson_content() THEN
    RAISE EXCEPTION 'LESSON_CONTENT_PERMISSION_DENIED';
  END IF;

  UPDATE public.lesson_contents
  SET is_active = COALESCE(p_is_active, false),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_content_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LESSON_CONTENT_NOT_FOUND';
  END IF;

  RETURN true;
END;
$function$;
CREATE OR REPLACE FUNCTION public.set_manager_points_session_access(p_group_id uuid, p_session_date date, p_is_open boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_is_active boolean := false;
  v_allowed boolean := false;
  v_session_exists boolean := false;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select up.role, up.is_active
  into v_role, v_is_active
  from public.user_profiles up
  where up.id = v_user_id;

  v_allowed :=
    coalesce(v_is_active, false)
    and (
      v_role = 'owner'
      or (
        v_role = 'manager'
        and public.has_permission('attendance_edit')
      )
    );

  if not v_allowed then
    raise exception 'Attendance edit permission required';
  end if;

  select exists(
    select 1
    from public.sessions s
    where s.group_id = p_group_id
      and s.session_date = p_session_date
      and coalesce(s.status, '') <> 'cancelled'
  ) into v_session_exists;

  if p_is_open and v_session_exists then
    return jsonb_build_object(
      'ok', false,
      'closed', true,
      'message', 'الحصة مسجلة بالفعل ولا يمكن فتحها عند ولاء'
    );
  end if;

  insert into public.manager_points_session_access (
    group_id,
    session_date,
    is_open,
    opened_by,
    opened_at,
    closed_at,
    updated_at
  ) values (
    p_group_id,
    p_session_date,
    coalesce(p_is_open, false),
    case when p_is_open then v_user_id else null end,
    case when p_is_open then now() else null end,
    case when not p_is_open then now() else null end,
    now()
  )
  on conflict (group_id, session_date)
  do update set
    is_open = excluded.is_open,
    opened_by = case when excluded.is_open then v_user_id else public.manager_points_session_access.opened_by end,
    opened_at = case when excluded.is_open then now() else public.manager_points_session_access.opened_at end,
    closed_at = case when not excluded.is_open then now() else null end,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'is_open', coalesce(p_is_open, false)
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.set_manager_points_session_access_for_attendance_editor(p_group_id uuid, p_session_date date, p_is_open boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.sync_student_due_totals(p_student_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_due_amount numeric := 0;
  v_due_sessions integer := 0;
BEGIN
  SELECT
    COALESCE(
      SUM(
        GREATEST(
          COALESCE(charge_amount, 0) - COALESCE(paid_amount, 0),
          0
        )
      ) FILTER (
        WHERE payment_status = 'due'
      ),
      0
    ),
    COUNT(*) FILTER (
      WHERE payment_status = 'due'
        AND GREATEST(
          COALESCE(charge_amount, 0) - COALESCE(paid_amount, 0),
          0
        ) > 0
    )::integer
  INTO
    v_due_amount,
    v_due_sessions
  FROM public.attendance
  WHERE student_id = p_student_id;

  UPDATE public.students
  SET
    due_amount = v_due_amount,
    due_sessions_count = v_due_sessions,
    updated_at = now()
  WHERE id = p_student_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.trg_sync_student_due_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin

  if tg_op = 'DELETE' then

    perform public.sync_student_due_totals(
      old.student_id
    );

    return old;

  end if;


  perform public.sync_student_due_totals(
    new.student_id
  );


  if tg_op = 'UPDATE'
     and old.student_id is distinct from new.student_id
  then

    perform public.sync_student_due_totals(
      old.student_id
    );

  end if;

  return new;

end;
$function$;
CREATE INDEX idx_payments_student_paid_at ON public.payments USING btree (student_id, paid_at DESC);
CREATE INDEX attendance_package_id_idx ON public.attendance USING btree (package_id) WHERE (package_id IS NOT NULL);
CREATE INDEX idx_point_transactions_student_source_created ON public.point_transactions USING btree (student_id, source, created_at DESC);
CREATE INDEX idx_pending_points_student_date ON public.pending_session_points USING btree (student_id, session_date);
CREATE INDEX idx_notifications_session_student ON public.notifications USING btree (session_id, student_id);
CREATE INDEX idx_homework_assignments_grade_date ON public.homework_assignments USING btree (grade_key, homework_date DESC, created_at DESC);
CREATE INDEX idx_groups_stage_grade ON public.groups USING btree (stage, grade);
CREATE INDEX idx_homework_files_assignment ON public.homework_files USING btree (assignment_id);
CREATE INDEX idx_students_group_id ON public.students USING btree (group_id);
CREATE UNIQUE INDEX sessions_unique_group_date ON public.sessions USING btree (group_id, session_date);
CREATE INDEX student_session_packages_active_idx ON public.student_session_packages USING btree (student_id, starts_on, purchased_at) WHERE ((sessions_remaining > 0) AND (status = 'active'::text));
CREATE INDEX lesson_contents_parent_lookup_idx ON public.lesson_contents USING btree (group_id, lesson_date DESC) WHERE (is_active = true);
CREATE UNIQUE INDEX pending_session_points_teacher_board_event_unique ON public.pending_session_points USING btree (created_by, reason_key) WHERE ("left"(reason_key, 14) = 'teacher_board_'::text);
CREATE INDEX idx_students_parent_phone ON public.students USING btree (parent_phone);
CREATE INDEX idx_sessions_group_date ON public.sessions USING btree (group_id, session_date);
CREATE INDEX payments_package_id_idx ON public.payments USING btree (package_id) WHERE (package_id IS NOT NULL);
CREATE UNIQUE INDEX payments_one_receipt_per_attendance ON public.payments USING btree (attendance_id) WHERE (attendance_id IS NOT NULL);
CREATE UNIQUE INDEX lesson_contents_group_date_unique ON public.lesson_contents USING btree (group_id, lesson_date);
CREATE INDEX idx_notifications_homework_student ON public.notifications USING btree (homework_assignment_id, student_id);
CREATE INDEX idx_attendance_student_id ON public.attendance USING btree (student_id);
CREATE INDEX idx_notifications_student_created_at ON public.notifications USING btree (student_id, created_at DESC);
CREATE INDEX idx_points_student_created_at ON public.point_transactions USING btree (student_id, created_at DESC);
CREATE INDEX idx_pending_points_group_date_status ON public.pending_session_points USING btree (group_id, session_date, status);
CREATE POLICY admin_full_access ON public.app_settings AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY manager_read_app_settings ON public.app_settings AS PERMISSIVE FOR SELECT TO authenticated USING (is_active_manager());
CREATE POLICY admin_full_access ON public.attendance AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admins can add group schedules" ON public.group_schedules AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "Admins can delete group schedules" ON public.group_schedules AS PERMISSIVE FOR DELETE TO authenticated USING (is_admin());
CREATE POLICY "Admins can read group schedules" ON public.group_schedules AS PERMISSIVE FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "Admins can update group schedules" ON public.group_schedules AS PERMISSIVE FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY manager_delete_group_schedules ON public.group_schedules AS PERMISSIVE FOR DELETE TO authenticated USING (has_permission('schedule_edit'::text));
CREATE POLICY manager_insert_group_schedules ON public.group_schedules AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_permission('schedule_edit'::text));
CREATE POLICY manager_read_group_schedules ON public.group_schedules AS PERMISSIVE FOR SELECT TO authenticated USING (has_any_permission(ARRAY['dashboard_view'::text, 'schedule_view'::text, 'schedule_edit'::text]));
CREATE POLICY manager_update_group_schedules ON public.group_schedules AS PERMISSIVE FOR UPDATE TO authenticated USING (has_permission('schedule_edit'::text)) WITH CHECK (has_permission('schedule_edit'::text));
CREATE POLICY admin_full_access ON public.groups AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY manager_insert_groups ON public.groups AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_permission('students_edit'::text));
CREATE POLICY manager_read_groups ON public.groups AS PERMISSIVE FOR SELECT TO authenticated USING (has_any_permission(ARRAY['dashboard_view'::text, 'attendance_view'::text, 'attendance_edit'::text, 'students_view'::text, 'students_edit'::text, 'payments_view'::text, 'payments_edit'::text, 'points_view'::text, 'points_edit'::text, 'ranking_view'::text, 'schedule_view'::text, 'schedule_edit'::text, 'parent_view'::text]));
CREATE POLICY manager_update_groups ON public.groups AS PERMISSIVE FOR UPDATE TO authenticated USING (has_permission('students_edit'::text)) WITH CHECK (has_permission('students_edit'::text));
CREATE POLICY homework_assignments_parent_select ON public.homework_assignments AS PERMISSIVE FOR SELECT TO authenticated USING (current_parent_can_access_grade(grade_key));
CREATE POLICY homework_assignments_staff_all ON public.homework_assignments AS PERMISSIVE FOR ALL TO authenticated USING (can_manage_homework()) WITH CHECK (can_manage_homework());
CREATE POLICY homework_files_parent_select ON public.homework_files AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM homework_assignments h
  WHERE ((h.id = homework_files.assignment_id) AND (h.is_active = true) AND current_parent_can_access_grade(h.grade_key)))));
CREATE POLICY homework_files_staff_all ON public.homework_files AS PERMISSIVE FOR ALL TO authenticated USING (can_manage_homework()) WITH CHECK (can_manage_homework());
CREATE POLICY manager_read_own_permissions ON public.manager_permissions AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY owner_manage_manager_permissions ON public.manager_permissions AS PERMISSIVE FOR ALL TO authenticated USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY admin_full_access ON public.notifications AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY manager_insert_notifications ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_permission('parent_view'::text));
CREATE POLICY manager_read_notifications ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated USING (has_any_permission(ARRAY['dashboard_view'::text, 'parent_view'::text]));
CREATE POLICY manager_update_notifications ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated USING (has_permission('parent_view'::text)) WITH CHECK (has_permission('parent_view'::text));
CREATE POLICY admin_full_access ON public.payments AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY manager_insert_payments ON public.payments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_permission('payments_edit'::text));
CREATE POLICY admin_full_access ON public.point_rules AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY manager_read_point_rules ON public.point_rules AS PERMISSIVE FOR SELECT TO authenticated USING (has_any_permission(ARRAY['dashboard_view'::text, 'points_view'::text, 'points_edit'::text, 'ranking_view'::text]));
CREATE POLICY admin_full_access ON public.point_transactions AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY manager_insert_point_transactions ON public.point_transactions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_permission('points_edit'::text));
CREATE POLICY manager_read_point_transactions ON public.point_transactions AS PERMISSIVE FOR SELECT TO authenticated USING (has_any_permission(ARRAY['dashboard_view'::text, 'points_view'::text, 'points_edit'::text, 'ranking_view'::text]));
CREATE POLICY push_delete_own ON public.push_subscriptions AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY push_insert_own ON public.push_subscriptions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
CREATE POLICY push_select_own ON public.push_subscriptions AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY push_update_own ON public.push_subscriptions AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY admin_full_access ON public.sessions AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY manager_delete_sessions ON public.sessions AS PERMISSIVE FOR DELETE TO authenticated USING (has_permission('attendance_edit'::text));
CREATE POLICY manager_insert_sessions ON public.sessions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_permission('attendance_edit'::text));
CREATE POLICY manager_read_sessions ON public.sessions AS PERMISSIVE FOR SELECT TO authenticated USING (has_any_permission(ARRAY['dashboard_view'::text, 'attendance_view'::text, 'attendance_edit'::text, 'schedule_view'::text, 'schedule_edit'::text]));
CREATE POLICY manager_update_sessions ON public.sessions AS PERMISSIVE FOR UPDATE TO authenticated USING (has_permission('attendance_edit'::text)) WITH CHECK (has_permission('attendance_edit'::text));
CREATE POLICY admin_full_access ON public.students AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY manager_insert_students ON public.students AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (has_any_permission(ARRAY['students_edit'::text, 'attendance_edit'::text]));
CREATE POLICY manager_read_students ON public.students AS PERMISSIVE FOR SELECT TO authenticated USING (has_any_permission(ARRAY['dashboard_view'::text, 'attendance_view'::text, 'attendance_edit'::text, 'students_view'::text, 'students_edit'::text, 'payments_view'::text, 'payments_edit'::text, 'points_view'::text, 'points_edit'::text, 'ranking_view'::text, 'parent_view'::text]));
CREATE POLICY manager_update_students ON public.students AS PERMISSIVE FOR UPDATE TO authenticated USING (has_any_permission(ARRAY['students_edit'::text, 'attendance_edit'::text, 'payments_edit'::text, 'points_edit'::text])) WITH CHECK (has_any_permission(ARRAY['students_edit'::text, 'attendance_edit'::text, 'payments_edit'::text, 'points_edit'::text]));
CREATE POLICY profile_admin_all ON public.user_profiles AS PERMISSIVE FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY profile_self_read ON public.user_profiles AS PERMISSIVE FOR SELECT TO authenticated USING (((id = ( SELECT auth.uid() AS uid)) OR is_admin()));
CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_attendance_sync_student_due AFTER INSERT OR DELETE OR UPDATE OF student_id, payment_status, charge_amount, paid_amount ON public.attendance FOR EACH ROW EXECUTE FUNCTION trg_sync_student_due_totals();
CREATE TRIGGER parent_schedule_live_notify AFTER INSERT OR DELETE OR UPDATE ON public.group_schedules FOR EACH ROW EXECUTE FUNCTION notify_parent_schedule_change();
CREATE TRIGGER trg_groups_updated_at BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_manager_permissions_updated_at BEFORE UPDATE ON public.manager_permissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_enforce_pending_points_session_gate BEFORE INSERT ON public.pending_session_points FOR EACH ROW EXECUTE FUNCTION enforce_pending_points_session_gate();
CREATE TRIGGER trg_close_manager_points_access_on_session AFTER INSERT OR UPDATE OF status ON public.sessions FOR EACH ROW EXECUTE FUNCTION close_manager_points_access_on_session();
CREATE TRIGGER check_package_purchase_arrears BEFORE INSERT ON public.student_session_packages FOR EACH ROW EXECUTE FUNCTION check_package_purchase_arrears();
CREATE TRIGGER trg_restrict_manager_student_updates BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION restrict_manager_student_updates();
CREATE TRIGGER trg_students_updated_at BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_limit_active_managers BEFORE INSERT OR UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION limit_active_managers();
CREATE TRIGGER trg_protect_owner_profile BEFORE DELETE OR UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION protect_owner_profile();
GRANT DELETE ON TABLE public.app_settings TO anon;
GRANT DELETE ON TABLE public.app_settings TO authenticated;
GRANT DELETE ON TABLE public.app_settings TO service_role;
GRANT DELETE ON TABLE public.attendance TO anon;
GRANT DELETE ON TABLE public.attendance TO authenticated;
GRANT DELETE ON TABLE public.attendance TO service_role;
GRANT DELETE ON TABLE public.backup_attendance_points_20260826 TO anon;
GRANT DELETE ON TABLE public.backup_attendance_points_20260826 TO authenticated;
GRANT DELETE ON TABLE public.backup_attendance_points_20260826 TO service_role;
GRANT DELETE ON TABLE public.backup_pending_points_20260826 TO anon;
GRANT DELETE ON TABLE public.backup_pending_points_20260826 TO authenticated;
GRANT DELETE ON TABLE public.backup_pending_points_20260826 TO service_role;
GRANT DELETE ON TABLE public.backup_students_points_20260826 TO anon;
GRANT DELETE ON TABLE public.backup_students_points_20260826 TO authenticated;
GRANT DELETE ON TABLE public.backup_students_points_20260826 TO service_role;
GRANT DELETE ON TABLE public.billing_settings TO service_role;
GRANT DELETE ON TABLE public.group_schedules TO anon;
GRANT DELETE ON TABLE public.group_schedules TO authenticated;
GRANT DELETE ON TABLE public.group_schedules TO service_role;
GRANT DELETE ON TABLE public.groups TO anon;
GRANT DELETE ON TABLE public.groups TO authenticated;
GRANT DELETE ON TABLE public.groups TO service_role;
GRANT DELETE ON TABLE public.homework_assignments TO anon;
GRANT DELETE ON TABLE public.homework_assignments TO authenticated;
GRANT DELETE ON TABLE public.homework_assignments TO service_role;
GRANT DELETE ON TABLE public.homework_files TO anon;
GRANT DELETE ON TABLE public.homework_files TO authenticated;
GRANT DELETE ON TABLE public.homework_files TO service_role;
GRANT DELETE ON TABLE public.lesson_contents TO service_role;
GRANT DELETE ON TABLE public.manager_permissions TO anon;
GRANT DELETE ON TABLE public.manager_permissions TO authenticated;
GRANT DELETE ON TABLE public.manager_permissions TO service_role;
GRANT DELETE ON TABLE public.manager_points_session_access TO anon;
GRANT DELETE ON TABLE public.manager_points_session_access TO authenticated;
GRANT DELETE ON TABLE public.manager_points_session_access TO service_role;
GRANT DELETE ON TABLE public.manual_data_repair_audit TO service_role;
GRANT DELETE ON TABLE public.notifications TO anon;
GRANT DELETE ON TABLE public.notifications TO authenticated;
GRANT DELETE ON TABLE public.notifications TO service_role;
GRANT DELETE ON TABLE public.payments TO anon;
GRANT DELETE ON TABLE public.payments TO authenticated;
GRANT DELETE ON TABLE public.payments TO service_role;
GRANT DELETE ON TABLE public.pending_session_points TO service_role;
GRANT DELETE ON TABLE public.point_rules TO anon;
GRANT DELETE ON TABLE public.point_rules TO authenticated;
GRANT DELETE ON TABLE public.point_rules TO service_role;
GRANT DELETE ON TABLE public.point_transactions TO anon;
GRANT DELETE ON TABLE public.point_transactions TO authenticated;
GRANT DELETE ON TABLE public.point_transactions TO service_role;
GRANT DELETE ON TABLE public.push_subscriptions TO anon;
GRANT DELETE ON TABLE public.push_subscriptions TO authenticated;
GRANT DELETE ON TABLE public.push_subscriptions TO service_role;
GRANT DELETE ON TABLE public.session_package_corrections TO service_role;
GRANT DELETE ON TABLE public.sessions TO anon;
GRANT DELETE ON TABLE public.sessions TO authenticated;
GRANT DELETE ON TABLE public.sessions TO service_role;
GRANT DELETE ON TABLE public.student_session_packages TO service_role;
GRANT DELETE ON TABLE public.students TO anon;
GRANT DELETE ON TABLE public.students TO authenticated;
GRANT DELETE ON TABLE public.students TO service_role;
GRANT DELETE ON TABLE public.user_profiles TO anon;
GRANT DELETE ON TABLE public.user_profiles TO authenticated;
GRANT DELETE ON TABLE public.user_profiles TO service_role;
GRANT INSERT ON TABLE public.app_settings TO anon;
GRANT INSERT ON TABLE public.app_settings TO authenticated;
GRANT INSERT ON TABLE public.app_settings TO service_role;
GRANT INSERT ON TABLE public.attendance TO anon;
GRANT INSERT ON TABLE public.attendance TO authenticated;
GRANT INSERT ON TABLE public.attendance TO service_role;
GRANT INSERT ON TABLE public.backup_attendance_points_20260826 TO anon;
GRANT INSERT ON TABLE public.backup_attendance_points_20260826 TO authenticated;
GRANT INSERT ON TABLE public.backup_attendance_points_20260826 TO service_role;
GRANT INSERT ON TABLE public.backup_pending_points_20260826 TO anon;
GRANT INSERT ON TABLE public.backup_pending_points_20260826 TO authenticated;
GRANT INSERT ON TABLE public.backup_pending_points_20260826 TO service_role;
GRANT INSERT ON TABLE public.backup_students_points_20260826 TO anon;
GRANT INSERT ON TABLE public.backup_students_points_20260826 TO authenticated;
GRANT INSERT ON TABLE public.backup_students_points_20260826 TO service_role;
GRANT INSERT ON TABLE public.billing_settings TO service_role;
GRANT INSERT ON TABLE public.group_schedules TO anon;
GRANT INSERT ON TABLE public.group_schedules TO authenticated;
GRANT INSERT ON TABLE public.group_schedules TO service_role;
GRANT INSERT ON TABLE public.groups TO anon;
GRANT INSERT ON TABLE public.groups TO authenticated;
GRANT INSERT ON TABLE public.groups TO service_role;
GRANT INSERT ON TABLE public.homework_assignments TO anon;
GRANT INSERT ON TABLE public.homework_assignments TO authenticated;
GRANT INSERT ON TABLE public.homework_assignments TO service_role;
GRANT INSERT ON TABLE public.homework_files TO anon;
GRANT INSERT ON TABLE public.homework_files TO authenticated;
GRANT INSERT ON TABLE public.homework_files TO service_role;
GRANT INSERT ON TABLE public.lesson_contents TO service_role;
GRANT INSERT ON TABLE public.manager_permissions TO anon;
GRANT INSERT ON TABLE public.manager_permissions TO authenticated;
GRANT INSERT ON TABLE public.manager_permissions TO service_role;
GRANT INSERT ON TABLE public.manager_points_session_access TO anon;
GRANT INSERT ON TABLE public.manager_points_session_access TO authenticated;
GRANT INSERT ON TABLE public.manager_points_session_access TO service_role;
GRANT INSERT ON TABLE public.manual_data_repair_audit TO service_role;
GRANT INSERT ON TABLE public.notifications TO anon;
GRANT INSERT ON TABLE public.notifications TO authenticated;
GRANT INSERT ON TABLE public.notifications TO service_role;
GRANT INSERT ON TABLE public.payments TO anon;
GRANT INSERT ON TABLE public.payments TO authenticated;
GRANT INSERT ON TABLE public.payments TO service_role;
GRANT INSERT ON TABLE public.pending_session_points TO service_role;
GRANT INSERT ON TABLE public.point_rules TO anon;
GRANT INSERT ON TABLE public.point_rules TO authenticated;
GRANT INSERT ON TABLE public.point_rules TO service_role;
GRANT INSERT ON TABLE public.point_transactions TO anon;
GRANT INSERT ON TABLE public.point_transactions TO authenticated;
GRANT INSERT ON TABLE public.point_transactions TO service_role;
GRANT INSERT ON TABLE public.push_subscriptions TO anon;
GRANT INSERT ON TABLE public.push_subscriptions TO authenticated;
GRANT INSERT ON TABLE public.push_subscriptions TO service_role;
GRANT INSERT ON TABLE public.session_package_corrections TO service_role;
GRANT INSERT ON TABLE public.sessions TO anon;
GRANT INSERT ON TABLE public.sessions TO authenticated;
GRANT INSERT ON TABLE public.sessions TO service_role;
GRANT INSERT ON TABLE public.student_session_packages TO service_role;
GRANT INSERT ON TABLE public.students TO anon;
GRANT INSERT ON TABLE public.students TO authenticated;
GRANT INSERT ON TABLE public.students TO service_role;
GRANT INSERT ON TABLE public.user_profiles TO anon;
GRANT INSERT ON TABLE public.user_profiles TO authenticated;
GRANT INSERT ON TABLE public.user_profiles TO service_role;
GRANT REFERENCES ON TABLE public.app_settings TO anon;
GRANT REFERENCES ON TABLE public.app_settings TO authenticated;
GRANT REFERENCES ON TABLE public.app_settings TO service_role;
GRANT REFERENCES ON TABLE public.attendance TO anon;
GRANT REFERENCES ON TABLE public.attendance TO authenticated;
GRANT REFERENCES ON TABLE public.attendance TO service_role;
GRANT REFERENCES ON TABLE public.backup_attendance_points_20260826 TO anon;
GRANT REFERENCES ON TABLE public.backup_attendance_points_20260826 TO authenticated;
GRANT REFERENCES ON TABLE public.backup_attendance_points_20260826 TO service_role;
GRANT REFERENCES ON TABLE public.backup_pending_points_20260826 TO anon;
GRANT REFERENCES ON TABLE public.backup_pending_points_20260826 TO authenticated;
GRANT REFERENCES ON TABLE public.backup_pending_points_20260826 TO service_role;
GRANT REFERENCES ON TABLE public.backup_students_points_20260826 TO anon;
GRANT REFERENCES ON TABLE public.backup_students_points_20260826 TO authenticated;
GRANT REFERENCES ON TABLE public.backup_students_points_20260826 TO service_role;
GRANT REFERENCES ON TABLE public.billing_settings TO service_role;
GRANT REFERENCES ON TABLE public.group_schedules TO anon;
GRANT REFERENCES ON TABLE public.group_schedules TO authenticated;
GRANT REFERENCES ON TABLE public.group_schedules TO service_role;
GRANT REFERENCES ON TABLE public.groups TO anon;
GRANT REFERENCES ON TABLE public.groups TO authenticated;
GRANT REFERENCES ON TABLE public.groups TO service_role;
GRANT REFERENCES ON TABLE public.homework_assignments TO anon;
GRANT REFERENCES ON TABLE public.homework_assignments TO authenticated;
GRANT REFERENCES ON TABLE public.homework_assignments TO service_role;
GRANT REFERENCES ON TABLE public.homework_files TO anon;
GRANT REFERENCES ON TABLE public.homework_files TO authenticated;
GRANT REFERENCES ON TABLE public.homework_files TO service_role;
GRANT REFERENCES ON TABLE public.lesson_contents TO service_role;
GRANT REFERENCES ON TABLE public.manager_permissions TO anon;
GRANT REFERENCES ON TABLE public.manager_permissions TO authenticated;
GRANT REFERENCES ON TABLE public.manager_permissions TO service_role;
GRANT REFERENCES ON TABLE public.manager_points_session_access TO anon;
GRANT REFERENCES ON TABLE public.manager_points_session_access TO authenticated;
GRANT REFERENCES ON TABLE public.manager_points_session_access TO service_role;
GRANT REFERENCES ON TABLE public.manual_data_repair_audit TO service_role;
GRANT REFERENCES ON TABLE public.notifications TO anon;
GRANT REFERENCES ON TABLE public.notifications TO authenticated;
GRANT REFERENCES ON TABLE public.notifications TO service_role;
GRANT REFERENCES ON TABLE public.payments TO anon;
GRANT REFERENCES ON TABLE public.payments TO authenticated;
GRANT REFERENCES ON TABLE public.payments TO service_role;
GRANT REFERENCES ON TABLE public.pending_session_points TO service_role;
GRANT REFERENCES ON TABLE public.point_rules TO anon;
GRANT REFERENCES ON TABLE public.point_rules TO authenticated;
GRANT REFERENCES ON TABLE public.point_rules TO service_role;
GRANT REFERENCES ON TABLE public.point_transactions TO anon;
GRANT REFERENCES ON TABLE public.point_transactions TO authenticated;
GRANT REFERENCES ON TABLE public.point_transactions TO service_role;
GRANT REFERENCES ON TABLE public.push_subscriptions TO anon;
GRANT REFERENCES ON TABLE public.push_subscriptions TO authenticated;
GRANT REFERENCES ON TABLE public.push_subscriptions TO service_role;
GRANT REFERENCES ON TABLE public.session_package_corrections TO service_role;
GRANT REFERENCES ON TABLE public.sessions TO anon;
GRANT REFERENCES ON TABLE public.sessions TO authenticated;
GRANT REFERENCES ON TABLE public.sessions TO service_role;
GRANT REFERENCES ON TABLE public.student_session_packages TO service_role;
GRANT REFERENCES ON TABLE public.students TO anon;
GRANT REFERENCES ON TABLE public.students TO authenticated;
GRANT REFERENCES ON TABLE public.students TO service_role;
GRANT REFERENCES ON TABLE public.user_profiles TO anon;
GRANT REFERENCES ON TABLE public.user_profiles TO authenticated;
GRANT REFERENCES ON TABLE public.user_profiles TO service_role;
GRANT SELECT ON TABLE public.app_settings TO anon;
GRANT SELECT ON TABLE public.app_settings TO authenticated;
GRANT SELECT ON TABLE public.app_settings TO service_role;
GRANT SELECT ON TABLE public.attendance TO anon;
GRANT SELECT ON TABLE public.attendance TO authenticated;
GRANT SELECT ON TABLE public.attendance TO service_role;
GRANT SELECT ON TABLE public.backup_attendance_points_20260826 TO anon;
GRANT SELECT ON TABLE public.backup_attendance_points_20260826 TO authenticated;
GRANT SELECT ON TABLE public.backup_attendance_points_20260826 TO service_role;
GRANT SELECT ON TABLE public.backup_pending_points_20260826 TO anon;
GRANT SELECT ON TABLE public.backup_pending_points_20260826 TO authenticated;
GRANT SELECT ON TABLE public.backup_pending_points_20260826 TO service_role;
GRANT SELECT ON TABLE public.backup_students_points_20260826 TO anon;
GRANT SELECT ON TABLE public.backup_students_points_20260826 TO authenticated;
GRANT SELECT ON TABLE public.backup_students_points_20260826 TO service_role;
GRANT SELECT ON TABLE public.billing_settings TO service_role;
GRANT SELECT ON TABLE public.group_schedules TO anon;
GRANT SELECT ON TABLE public.group_schedules TO authenticated;
GRANT SELECT ON TABLE public.group_schedules TO service_role;
GRANT SELECT ON TABLE public.groups TO anon;
GRANT SELECT ON TABLE public.groups TO authenticated;
GRANT SELECT ON TABLE public.groups TO service_role;
GRANT SELECT ON TABLE public.homework_assignments TO anon;
GRANT SELECT ON TABLE public.homework_assignments TO authenticated;
GRANT SELECT ON TABLE public.homework_assignments TO service_role;
GRANT SELECT ON TABLE public.homework_files TO anon;
GRANT SELECT ON TABLE public.homework_files TO authenticated;
GRANT SELECT ON TABLE public.homework_files TO service_role;
GRANT SELECT ON TABLE public.lesson_contents TO service_role;
GRANT SELECT ON TABLE public.manager_permissions TO anon;
GRANT SELECT ON TABLE public.manager_permissions TO authenticated;
GRANT SELECT ON TABLE public.manager_permissions TO service_role;
GRANT SELECT ON TABLE public.manager_points_session_access TO anon;
GRANT SELECT ON TABLE public.manager_points_session_access TO authenticated;
GRANT SELECT ON TABLE public.manager_points_session_access TO service_role;
GRANT SELECT ON TABLE public.manual_data_repair_audit TO service_role;
GRANT SELECT ON TABLE public.notifications TO anon;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT SELECT ON TABLE public.notifications TO service_role;
GRANT SELECT ON TABLE public.payments TO anon;
GRANT SELECT ON TABLE public.payments TO authenticated;
GRANT SELECT ON TABLE public.payments TO service_role;
GRANT SELECT ON TABLE public.pending_session_points TO service_role;
GRANT SELECT ON TABLE public.point_rules TO anon;
GRANT SELECT ON TABLE public.point_rules TO authenticated;
GRANT SELECT ON TABLE public.point_rules TO service_role;
GRANT SELECT ON TABLE public.point_transactions TO anon;
GRANT SELECT ON TABLE public.point_transactions TO authenticated;
GRANT SELECT ON TABLE public.point_transactions TO service_role;
GRANT SELECT ON TABLE public.push_subscriptions TO anon;
GRANT SELECT ON TABLE public.push_subscriptions TO authenticated;
GRANT SELECT ON TABLE public.push_subscriptions TO service_role;
GRANT SELECT ON TABLE public.session_package_corrections TO service_role;
GRANT SELECT ON TABLE public.sessions TO anon;
GRANT SELECT ON TABLE public.sessions TO authenticated;
GRANT SELECT ON TABLE public.sessions TO service_role;
GRANT SELECT ON TABLE public.student_session_packages TO service_role;
GRANT SELECT ON TABLE public.students TO anon;
GRANT SELECT ON TABLE public.students TO authenticated;
GRANT SELECT ON TABLE public.students TO service_role;
GRANT SELECT ON TABLE public.user_profiles TO anon;
GRANT SELECT ON TABLE public.user_profiles TO authenticated;
GRANT SELECT ON TABLE public.user_profiles TO service_role;
GRANT TRIGGER ON TABLE public.app_settings TO anon;
GRANT TRIGGER ON TABLE public.app_settings TO authenticated;
GRANT TRIGGER ON TABLE public.app_settings TO service_role;
GRANT TRIGGER ON TABLE public.attendance TO anon;
GRANT TRIGGER ON TABLE public.attendance TO authenticated;
GRANT TRIGGER ON TABLE public.attendance TO service_role;
GRANT TRIGGER ON TABLE public.backup_attendance_points_20260826 TO anon;
GRANT TRIGGER ON TABLE public.backup_attendance_points_20260826 TO authenticated;
GRANT TRIGGER ON TABLE public.backup_attendance_points_20260826 TO service_role;
GRANT TRIGGER ON TABLE public.backup_pending_points_20260826 TO anon;
GRANT TRIGGER ON TABLE public.backup_pending_points_20260826 TO authenticated;
GRANT TRIGGER ON TABLE public.backup_pending_points_20260826 TO service_role;
GRANT TRIGGER ON TABLE public.backup_students_points_20260826 TO anon;
GRANT TRIGGER ON TABLE public.backup_students_points_20260826 TO authenticated;
GRANT TRIGGER ON TABLE public.backup_students_points_20260826 TO service_role;
GRANT TRIGGER ON TABLE public.billing_settings TO service_role;
GRANT TRIGGER ON TABLE public.group_schedules TO anon;
GRANT TRIGGER ON TABLE public.group_schedules TO authenticated;
GRANT TRIGGER ON TABLE public.group_schedules TO service_role;
GRANT TRIGGER ON TABLE public.groups TO anon;
GRANT TRIGGER ON TABLE public.groups TO authenticated;
GRANT TRIGGER ON TABLE public.groups TO service_role;
GRANT TRIGGER ON TABLE public.homework_assignments TO anon;
GRANT TRIGGER ON TABLE public.homework_assignments TO authenticated;
GRANT TRIGGER ON TABLE public.homework_assignments TO service_role;
GRANT TRIGGER ON TABLE public.homework_files TO anon;
GRANT TRIGGER ON TABLE public.homework_files TO authenticated;
GRANT TRIGGER ON TABLE public.homework_files TO service_role;
GRANT TRIGGER ON TABLE public.lesson_contents TO service_role;
GRANT TRIGGER ON TABLE public.manager_permissions TO anon;
GRANT TRIGGER ON TABLE public.manager_permissions TO authenticated;
GRANT TRIGGER ON TABLE public.manager_permissions TO service_role;
GRANT TRIGGER ON TABLE public.manager_points_session_access TO anon;
GRANT TRIGGER ON TABLE public.manager_points_session_access TO authenticated;
GRANT TRIGGER ON TABLE public.manager_points_session_access TO service_role;
GRANT TRIGGER ON TABLE public.manual_data_repair_audit TO service_role;
GRANT TRIGGER ON TABLE public.notifications TO anon;
GRANT TRIGGER ON TABLE public.notifications TO authenticated;
GRANT TRIGGER ON TABLE public.notifications TO service_role;
GRANT TRIGGER ON TABLE public.payments TO anon;
GRANT TRIGGER ON TABLE public.payments TO authenticated;
GRANT TRIGGER ON TABLE public.payments TO service_role;
GRANT TRIGGER ON TABLE public.pending_session_points TO service_role;
GRANT TRIGGER ON TABLE public.point_rules TO anon;
GRANT TRIGGER ON TABLE public.point_rules TO authenticated;
GRANT TRIGGER ON TABLE public.point_rules TO service_role;
GRANT TRIGGER ON TABLE public.point_transactions TO anon;
GRANT TRIGGER ON TABLE public.point_transactions TO authenticated;
GRANT TRIGGER ON TABLE public.point_transactions TO service_role;
GRANT TRIGGER ON TABLE public.push_subscriptions TO anon;
GRANT TRIGGER ON TABLE public.push_subscriptions TO authenticated;
GRANT TRIGGER ON TABLE public.push_subscriptions TO service_role;
GRANT TRIGGER ON TABLE public.session_package_corrections TO service_role;
GRANT TRIGGER ON TABLE public.sessions TO anon;
GRANT TRIGGER ON TABLE public.sessions TO authenticated;
GRANT TRIGGER ON TABLE public.sessions TO service_role;
GRANT TRIGGER ON TABLE public.student_session_packages TO service_role;
GRANT TRIGGER ON TABLE public.students TO anon;
GRANT TRIGGER ON TABLE public.students TO authenticated;
GRANT TRIGGER ON TABLE public.students TO service_role;
GRANT TRIGGER ON TABLE public.user_profiles TO anon;
GRANT TRIGGER ON TABLE public.user_profiles TO authenticated;
GRANT TRIGGER ON TABLE public.user_profiles TO service_role;
GRANT TRUNCATE ON TABLE public.app_settings TO anon;
GRANT TRUNCATE ON TABLE public.app_settings TO authenticated;
GRANT TRUNCATE ON TABLE public.app_settings TO service_role;
GRANT TRUNCATE ON TABLE public.attendance TO anon;
GRANT TRUNCATE ON TABLE public.attendance TO authenticated;
GRANT TRUNCATE ON TABLE public.attendance TO service_role;
GRANT TRUNCATE ON TABLE public.backup_attendance_points_20260826 TO anon;
GRANT TRUNCATE ON TABLE public.backup_attendance_points_20260826 TO authenticated;
GRANT TRUNCATE ON TABLE public.backup_attendance_points_20260826 TO service_role;
GRANT TRUNCATE ON TABLE public.backup_pending_points_20260826 TO anon;
GRANT TRUNCATE ON TABLE public.backup_pending_points_20260826 TO authenticated;
GRANT TRUNCATE ON TABLE public.backup_pending_points_20260826 TO service_role;
GRANT TRUNCATE ON TABLE public.backup_students_points_20260826 TO anon;
GRANT TRUNCATE ON TABLE public.backup_students_points_20260826 TO authenticated;
GRANT TRUNCATE ON TABLE public.backup_students_points_20260826 TO service_role;
GRANT TRUNCATE ON TABLE public.billing_settings TO service_role;
GRANT TRUNCATE ON TABLE public.group_schedules TO anon;
GRANT TRUNCATE ON TABLE public.group_schedules TO authenticated;
GRANT TRUNCATE ON TABLE public.group_schedules TO service_role;
GRANT TRUNCATE ON TABLE public.groups TO anon;
GRANT TRUNCATE ON TABLE public.groups TO authenticated;
GRANT TRUNCATE ON TABLE public.groups TO service_role;
GRANT TRUNCATE ON TABLE public.homework_assignments TO anon;
GRANT TRUNCATE ON TABLE public.homework_assignments TO authenticated;
GRANT TRUNCATE ON TABLE public.homework_assignments TO service_role;
GRANT TRUNCATE ON TABLE public.homework_files TO anon;
GRANT TRUNCATE ON TABLE public.homework_files TO authenticated;
GRANT TRUNCATE ON TABLE public.homework_files TO service_role;
GRANT TRUNCATE ON TABLE public.lesson_contents TO service_role;
GRANT TRUNCATE ON TABLE public.manager_permissions TO anon;
GRANT TRUNCATE ON TABLE public.manager_permissions TO authenticated;
GRANT TRUNCATE ON TABLE public.manager_permissions TO service_role;
GRANT TRUNCATE ON TABLE public.manager_points_session_access TO anon;
GRANT TRUNCATE ON TABLE public.manager_points_session_access TO authenticated;
GRANT TRUNCATE ON TABLE public.manager_points_session_access TO service_role;
GRANT TRUNCATE ON TABLE public.manual_data_repair_audit TO service_role;
GRANT TRUNCATE ON TABLE public.notifications TO anon;
GRANT TRUNCATE ON TABLE public.notifications TO authenticated;
GRANT TRUNCATE ON TABLE public.notifications TO service_role;
GRANT TRUNCATE ON TABLE public.payments TO anon;
GRANT TRUNCATE ON TABLE public.payments TO authenticated;
GRANT TRUNCATE ON TABLE public.payments TO service_role;
GRANT TRUNCATE ON TABLE public.pending_session_points TO service_role;
GRANT TRUNCATE ON TABLE public.point_rules TO anon;
GRANT TRUNCATE ON TABLE public.point_rules TO authenticated;
GRANT TRUNCATE ON TABLE public.point_rules TO service_role;
GRANT TRUNCATE ON TABLE public.point_transactions TO anon;
GRANT TRUNCATE ON TABLE public.point_transactions TO authenticated;
GRANT TRUNCATE ON TABLE public.point_transactions TO service_role;
GRANT TRUNCATE ON TABLE public.push_subscriptions TO anon;
GRANT TRUNCATE ON TABLE public.push_subscriptions TO authenticated;
GRANT TRUNCATE ON TABLE public.push_subscriptions TO service_role;
GRANT TRUNCATE ON TABLE public.session_package_corrections TO service_role;
GRANT TRUNCATE ON TABLE public.sessions TO anon;
GRANT TRUNCATE ON TABLE public.sessions TO authenticated;
GRANT TRUNCATE ON TABLE public.sessions TO service_role;
GRANT TRUNCATE ON TABLE public.student_session_packages TO service_role;
GRANT TRUNCATE ON TABLE public.students TO anon;
GRANT TRUNCATE ON TABLE public.students TO authenticated;
GRANT TRUNCATE ON TABLE public.students TO service_role;
GRANT TRUNCATE ON TABLE public.user_profiles TO anon;
GRANT TRUNCATE ON TABLE public.user_profiles TO authenticated;
GRANT TRUNCATE ON TABLE public.user_profiles TO service_role;
GRANT UPDATE ON TABLE public.app_settings TO anon;
GRANT UPDATE ON TABLE public.app_settings TO authenticated;
GRANT UPDATE ON TABLE public.app_settings TO service_role;
GRANT UPDATE ON TABLE public.attendance TO anon;
GRANT UPDATE ON TABLE public.attendance TO authenticated;
GRANT UPDATE ON TABLE public.attendance TO service_role;
GRANT UPDATE ON TABLE public.backup_attendance_points_20260826 TO anon;
GRANT UPDATE ON TABLE public.backup_attendance_points_20260826 TO authenticated;
GRANT UPDATE ON TABLE public.backup_attendance_points_20260826 TO service_role;
GRANT UPDATE ON TABLE public.backup_pending_points_20260826 TO anon;
GRANT UPDATE ON TABLE public.backup_pending_points_20260826 TO authenticated;
GRANT UPDATE ON TABLE public.backup_pending_points_20260826 TO service_role;
GRANT UPDATE ON TABLE public.backup_students_points_20260826 TO anon;
GRANT UPDATE ON TABLE public.backup_students_points_20260826 TO authenticated;
GRANT UPDATE ON TABLE public.backup_students_points_20260826 TO service_role;
GRANT UPDATE ON TABLE public.billing_settings TO service_role;
GRANT UPDATE ON TABLE public.group_schedules TO anon;
GRANT UPDATE ON TABLE public.group_schedules TO authenticated;
GRANT UPDATE ON TABLE public.group_schedules TO service_role;
GRANT UPDATE ON TABLE public.groups TO anon;
GRANT UPDATE ON TABLE public.groups TO authenticated;
GRANT UPDATE ON TABLE public.groups TO service_role;
GRANT UPDATE ON TABLE public.homework_assignments TO anon;
GRANT UPDATE ON TABLE public.homework_assignments TO authenticated;
GRANT UPDATE ON TABLE public.homework_assignments TO service_role;
GRANT UPDATE ON TABLE public.homework_files TO anon;
GRANT UPDATE ON TABLE public.homework_files TO authenticated;
GRANT UPDATE ON TABLE public.homework_files TO service_role;
GRANT UPDATE ON TABLE public.lesson_contents TO service_role;
GRANT UPDATE ON TABLE public.manager_permissions TO anon;
GRANT UPDATE ON TABLE public.manager_permissions TO authenticated;
GRANT UPDATE ON TABLE public.manager_permissions TO service_role;
GRANT UPDATE ON TABLE public.manager_points_session_access TO anon;
GRANT UPDATE ON TABLE public.manager_points_session_access TO authenticated;
GRANT UPDATE ON TABLE public.manager_points_session_access TO service_role;
GRANT UPDATE ON TABLE public.manual_data_repair_audit TO service_role;
GRANT UPDATE ON TABLE public.notifications TO anon;
GRANT UPDATE ON TABLE public.notifications TO authenticated;
GRANT UPDATE ON TABLE public.notifications TO service_role;
GRANT UPDATE ON TABLE public.payments TO anon;
GRANT UPDATE ON TABLE public.payments TO authenticated;
GRANT UPDATE ON TABLE public.payments TO service_role;
GRANT UPDATE ON TABLE public.pending_session_points TO service_role;
GRANT UPDATE ON TABLE public.point_rules TO anon;
GRANT UPDATE ON TABLE public.point_rules TO authenticated;
GRANT UPDATE ON TABLE public.point_rules TO service_role;
GRANT UPDATE ON TABLE public.point_transactions TO anon;
GRANT UPDATE ON TABLE public.point_transactions TO authenticated;
GRANT UPDATE ON TABLE public.point_transactions TO service_role;
GRANT UPDATE ON TABLE public.push_subscriptions TO anon;
GRANT UPDATE ON TABLE public.push_subscriptions TO authenticated;
GRANT UPDATE ON TABLE public.push_subscriptions TO service_role;
GRANT UPDATE ON TABLE public.session_package_corrections TO service_role;
GRANT UPDATE ON TABLE public.sessions TO anon;
GRANT UPDATE ON TABLE public.sessions TO authenticated;
GRANT UPDATE ON TABLE public.sessions TO service_role;
GRANT UPDATE ON TABLE public.student_session_packages TO service_role;
GRANT UPDATE ON TABLE public.students TO anon;
GRANT UPDATE ON TABLE public.students TO authenticated;
GRANT UPDATE ON TABLE public.students TO service_role;
GRANT UPDATE ON TABLE public.user_profiles TO anon;
GRANT UPDATE ON TABLE public.user_profiles TO authenticated;
GRANT UPDATE ON TABLE public.user_profiles TO service_role;
SET check_function_bodies=true;
