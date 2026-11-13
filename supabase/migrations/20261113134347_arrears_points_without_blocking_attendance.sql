-- No financial rows are repaired or backfilled by this migration.
-- Keep the established three unpaid-session boundary. Lock students so points
-- and settlement serialize; session writers acquire session locks first.
CREATE OR REPLACE FUNCTION public.arrears_points_blocked(p_student_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE n integer;
BEGIN
 SELECT due_sessions_count INTO n FROM public.students WHERE id=p_student_id FOR UPDATE;
 RETURN coalesce(n,0)>=3;
END; $$;
REVOKE ALL ON FUNCTION public.arrears_points_blocked(uuid) FROM PUBLIC, anon, authenticated;

-- Normalize components separately: a positive attendance award must never
-- cancel a legitimate negative manual deduction. Historical awards are retained.
CREATE OR REPLACE FUNCTION public.filter_arrears_attendance_points(
 p_session_id uuid, p_student_id uuid, p_points numeric, p_details jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE old_points numeric:=0; old_details jsonb:='[]'; details jsonb;
 requested_sum numeric; old_sum numeric; total numeric;
BEGIN
 IF NOT public.arrears_points_blocked(p_student_id) THEN
  RETURN jsonb_build_object('points',p_points,'details',p_details);
 END IF;
 SELECT coalesce(a.points_change,0),coalesce(a.points_details,'[]')
 INTO old_points,old_details FROM public.attendance a
 WHERE a.session_id=p_session_id AND a.student_id=p_student_id;
 old_points:=coalesce(old_points,0); old_details:=coalesce(old_details,'[]');
 -- Pending-manager components are preserved separately by existing writers.
 SELECT old_points-coalesce(sum((d->>'value')::numeric) FILTER (WHERE d->>'source'='manager_pending'),0),
 coalesce(jsonb_agg(d) FILTER (WHERE coalesce(d->>'source','')<>'manager_pending' AND coalesce(d->>'reason','')<>'package_payment'),'[]')
 INTO old_points,old_details FROM jsonb_array_elements(old_details) d;
 SELECT coalesce(sum((d->>'value')::numeric),0) INTO requested_sum FROM jsonb_array_elements(coalesce(p_details,'[]')) d;
 SELECT coalesce(sum((d->>'value')::numeric),0) INTO old_sum FROM jsonb_array_elements(old_details) d;
 SELECT coalesce(jsonb_agg(d),'[]') INTO details FROM (
  SELECT d FROM jsonb_array_elements(old_details) d WHERE (d->>'value')::numeric>0
  UNION ALL
  SELECT d FROM jsonb_array_elements(coalesce(p_details,'[]')) d WHERE (d->>'value')::numeric<=0
 ) parts;
 SELECT coalesce(sum((d->>'value')::numeric),0) INTO total FROM jsonb_array_elements(details) d;
 total:=total+greatest(old_points-old_sum,0)+least(coalesce(p_points,0)-requested_sum,0);
 RETURN jsonb_build_object('points',total,'details',details);
END; $$;
REVOKE ALL ON FUNCTION public.filter_arrears_attendance_points(uuid,uuid,numeric,jsonb) FROM PUBLIC, anon, authenticated;


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

  if p_points > 0 and public.arrears_points_blocked(p_student_id) then
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

  select s.status
    into v_session_status
  from public.sessions s
  where s.group_id = v_group_id
    and s.session_date = p_session_date
  order by s.created_at desc
  limit 1
  for share;

  if p_points > 0 and public.arrears_points_blocked(p_student_id) then
    return jsonb_build_object(
      'queued', false,
      'blocked', true
    );
  end if;

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

  IF p_points > 0 AND public.arrears_points_blocked(p_student_id) THEN
    RETURN jsonb_build_object('success',false,'blocked',true,
      'message','النقاط الموجبة متوقفة حتى تسوية المتأخرات');
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

CREATE OR REPLACE FUNCTION public.queue_owner_teacher_board_point_with_reason(p_student_id uuid, p_points numeric, p_event_key text, p_session_date date, p_reason_key text)
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
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = v_user_id AND up.role = 'owner' AND up.is_active = true
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
  WHERE s.id = p_student_id AND COALESCE(s.is_active, true) = true;
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

  IF p_points > 0 AND public.arrears_points_blocked(p_student_id) THEN
    RETURN jsonb_build_object('success',false,'blocked',true,
      'message','النقاط الموجبة متوقفة حتى تسوية المتأخرات');
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

CREATE OR REPLACE FUNCTION public.queue_screen_teacher_board_point_with_reason(p_student_id uuid, p_points numeric, p_event_key text, p_session_date date, p_reason_key text)
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

  IF p_points > 0 AND public.arrears_points_blocked(p_student_id) THEN
    RETURN jsonb_build_object('success',false,'blocked',true,
      'message','النقاط الموجبة متوقفة حتى تسوية المتأخرات');
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


  SELECT (f->>'points')::numeric, f->'details'
  INTO p_points_change,p_points_details
  FROM (SELECT public.filter_arrears_attendance_points(
    p_session_id,p_student_id,p_points_change,p_points_details) f) normalized;
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
  v_old_points numeric := 0;
  v_preserved_points numeric := 0;
  v_effective_points numeric := 0;
  v_preserved_details jsonb := '[]'::jsonb;
  v_remaining integer := 0;
  v_details jsonb := COALESCE(p_points_details, '[]'::jsonb);
BEGIN
 PERFORM 1 FROM public.sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;

  IF NOT public.can_manage_session_packages() THEN RAISE EXCEPTION 'PACKAGE_PERMISSION_DENIED'; END IF;
  IF p_attendance_status NOT IN ('present','late','absent','excused') THEN RAISE EXCEPTION 'INVALID_ATTENDANCE_STATUS'; END IF;
  IF p_requested_payment_status NOT IN ('paid','due','free') THEN RAISE EXCEPTION 'INVALID_PAYMENT_STATUS'; END IF;

  SELECT (f->>'points')::numeric, f->'details'
  INTO p_points_change,p_points_details
  FROM (SELECT public.filter_arrears_attendance_points(
    p_session_id,p_student_id,p_points_change,p_points_details) f) normalized;
  v_details:=p_points_details;
  SELECT se.session_date,se.group_id,se.start_time INTO v_session_date,v_session_group_id,v_session_start_time
  FROM public.sessions se WHERE se.id=p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;

  IF NOT public.session_accepts_student(p_session_id,p_student_id) THEN
    RAISE EXCEPTION 'STUDENT_NOT_IN_SESSION_GROUP';
  END IF;

  SELECT * INTO v_attendance FROM public.attendance a
  WHERE a.session_id=p_session_id AND a.student_id=p_student_id FOR UPDATE;
  IF FOUND THEN
    v_old_points:=COALESCE(v_attendance.points_change,0);
    SELECT coalesce(jsonb_agg(x.detail ORDER BY x.ord),'[]'::jsonb),
      coalesce(sum(CASE WHEN jsonb_typeof(x.detail->'value')='number' THEN (x.detail->>'value')::numeric ELSE 0 END),0)
    INTO v_preserved_details,v_preserved_points
    FROM jsonb_array_elements(coalesce(v_attendance.points_details,'[]'::jsonb)) WITH ORDINALITY x(detail,ord)
    WHERE coalesce(x.detail->>'source','')='manager_pending';
  END IF;
  SELECT coalesce(jsonb_agg(x.detail ORDER BY x.ord),'[]'::jsonb) INTO v_details
  FROM jsonb_array_elements(v_details) WITH ORDINALITY x(detail,ord)
  WHERE coalesce(x.detail->>'source','')<>'manager_pending' AND coalesce(x.detail->>'reason','')<>'package_payment';
  v_details:=v_details||v_preserved_details;
  v_effective_points:=coalesce(p_points_change,0)+v_preserved_points;

  v_chargeable:=p_attendance_status IN ('present','late');

  IF COALESCE(v_attendance.package_consumed,false) THEN
    IF v_chargeable AND p_requested_payment_status<>'free' THEN
      v_details:=v_details||jsonb_build_array(jsonb_build_object('value',0,'reason','package_payment','reason_label','من الباقة'));
      UPDATE public.attendance SET attendance_status=p_attendance_status,payment_status='paid',
        charge_amount=COALESCE(v_attendance.charge_amount,0),paid_amount=COALESCE(v_attendance.charge_amount,0),
        points_change=v_effective_points,points_details=v_details,notes=p_notes,package_consumed=true
      WHERE id=v_attendance.id;
      UPDATE public.students SET points_balance=COALESCE(points_balance,0)+v_effective_points-v_old_points,updated_at=now() WHERE id=p_student_id;
      PERFORM public.sync_student_due_totals(p_student_id);
      SELECT COALESCE(SUM(sessions_remaining),0)::integer INTO v_remaining FROM public.student_session_packages WHERE student_id=p_student_id AND status<>'cancelled';
      RETURN jsonb_build_object('handled',true,'used_package',true,'restored_package',false,'remaining_sessions',v_remaining);
    END IF;
    UPDATE public.student_session_packages SET sessions_remaining=sessions_remaining+1,status='active' WHERE id=v_attendance.package_id;
    UPDATE public.attendance SET attendance_status=p_attendance_status,
      payment_status=CASE WHEN v_chargeable THEN p_requested_payment_status ELSE 'free' END,
      charge_amount=CASE WHEN v_chargeable AND p_requested_payment_status<>'free' THEN COALESCE(v_attendance.charge_amount,0) ELSE 0 END,
      paid_amount=0,points_change=v_effective_points,points_details=v_details,notes=p_notes,package_id=NULL,package_consumed=false
    WHERE id=v_attendance.id;
    UPDATE public.students SET points_balance=COALESCE(points_balance,0)+v_effective_points-v_old_points,updated_at=now() WHERE id=p_student_id;
    PERFORM public.sync_student_due_totals(p_student_id);
    SELECT COALESCE(SUM(sessions_remaining),0)::integer INTO v_remaining FROM public.student_session_packages WHERE student_id=p_student_id AND status<>'cancelled';
    RETURN jsonb_build_object('handled',true,'used_package',false,'restored_package',true,'remaining_sessions',v_remaining);
  END IF;

  IF NOT v_chargeable OR p_requested_payment_status='free' THEN
    RETURN jsonb_build_object('handled',false,'used_package',false,'remaining_sessions',0);
  END IF;

  -- Existing cash/partial payments must not be charged again through a package.
  IF v_attendance.id IS NOT NULL AND (
    coalesce(v_attendance.paid_amount,0)>0
    OR (v_attendance.payment_status='paid' AND coalesce(v_attendance.charge_amount,0)>0)
    OR EXISTS(SELECT 1 FROM public.payments cash_receipt WHERE cash_receipt.attendance_id=v_attendance.id)
  ) THEN RETURN jsonb_build_object('handled',false,'used_package',false,'remaining_sessions',0); END IF;

  SELECT p.* INTO v_package FROM public.student_session_packages p
  WHERE p.student_id=p_student_id AND p.status='active' AND p.sessions_remaining>0
    AND (p.starts_on<v_session_date OR (p.starts_on=v_session_date AND p.purchased_at<((v_session_date+COALESCE(v_session_start_time,time '00:00')+interval '1 hour') AT TIME ZONE 'Africa/Cairo')))
  ORDER BY p.starts_on,p.purchased_at,p.id LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('handled',false,'used_package',false,'remaining_sessions',0); END IF;

  UPDATE public.student_session_packages SET sessions_remaining=sessions_remaining-1,
    status=CASE WHEN sessions_remaining-1=0 THEN 'depleted' ELSE 'active' END WHERE id=v_package.id;
  v_details:=v_details||jsonb_build_array(jsonb_build_object('value',0,'reason','package_payment','reason_label','من الباقة'));

  IF v_attendance.id IS NULL THEN
    INSERT INTO public.attendance(session_id,student_id,attendance_status,payment_status,charge_amount,paid_amount,points_change,points_details,notes,package_id,package_consumed)
    VALUES(p_session_id,p_student_id,p_attendance_status,'paid',v_package.unit_price,v_package.unit_price,v_effective_points,v_details,p_notes,v_package.id,true);
  ELSE
    -- A restored/previously free attendance row already owns the unique session/student key.
    UPDATE public.attendance SET attendance_status=p_attendance_status,payment_status='paid',
      charge_amount=v_package.unit_price,paid_amount=v_package.unit_price,
      points_change=v_effective_points,points_details=v_details,notes=p_notes,
      package_id=v_package.id,package_consumed=true WHERE id=v_attendance.id;
  END IF;

  UPDATE public.students SET points_balance=COALESCE(points_balance,0)+v_effective_points-v_old_points,updated_at=now() WHERE id=p_student_id;
  PERFORM public.sync_student_due_totals(p_student_id);
  SELECT COALESCE(SUM(sessions_remaining),0)::integer INTO v_remaining FROM public.student_session_packages WHERE student_id=p_student_id AND status<>'cancelled';
  RETURN jsonb_build_object('handled',true,'used_package',true,'restored_package',false,'remaining_sessions',v_remaining,'package_id',v_package.id);
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
  v_requested_details jsonb;
  v_existing_details jsonb;
  v_manager_points numeric;
  v_existing public.attendance%ROWTYPE;
  v_result jsonb;
  v_expected integer;
  v_saved_count integer;
  v_existing_count integer := 0;
  v_inserted_count integer := 0;
  v_expected_ids uuid[];
  v_supplied_ids uuid[];
  v_pending_count integer;
  v_receipt_count integer;
  v_already_completed boolean;
BEGIN
  IF NOT public.can_manage_session_packages() THEN
    RAISE EXCEPTION 'ATTENDANCE_PERMISSION_DENIED';
  END IF;

  IF p_rows IS NULL
     OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'INVALID_ROSTER';
  END IF;

  -- All current and legacy attendance writers take this same lock. It is the
  -- serialization boundary for two devices saving the same session.
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF v_session.status = 'cancelled' THEN RAISE EXCEPTION 'SESSION_CANCELLED'; END IF;
  v_already_completed := v_session.status = 'completed';

  v_expected := jsonb_array_length(p_rows);
  IF (
    SELECT count(DISTINCT (x->>'student_id'))
    FROM jsonb_array_elements(p_rows) x
  ) <> v_expected THEN
    RAISE EXCEPTION 'DUPLICATE_STUDENT_IN_ROSTER';
  END IF;

  SELECT coalesce(
    array_agg((x->>'student_id')::uuid ORDER BY (x->>'student_id')::uuid),
    ARRAY[]::uuid[]
  ) INTO v_supplied_ids
  FROM jsonb_array_elements(p_rows) x;

  IF v_already_completed THEN
    -- Once closed, attendance is the immutable roster snapshot. Students added
    -- to the group later must not make an old retry look incomplete.
    SELECT coalesce(array_agg(a.student_id ORDER BY a.student_id), ARRAY[]::uuid[])
    INTO v_expected_ids
    FROM public.attendance a
    WHERE a.session_id = p_session_id;
  ELSE
    -- For a scheduled/partial session, include the historical group roster plus
    -- any already-saved or pending student retained by the session snapshot.
    SELECT coalesce(array_agg(ids.student_id ORDER BY ids.student_id), ARRAY[]::uuid[])
    INTO v_expected_ids
    FROM (
      SELECT st.id AS student_id
      FROM public.students st
      WHERE st.group_id = v_session.group_id
        AND st.is_active = true
        AND (
          st.created_at IS NULL
          OR st.created_at <= (
            v_session.session_date + coalesce(v_session.start_time, time '00:00')
          ) AT TIME ZONE 'Africa/Cairo'
        )
      UNION
      SELECT a.student_id
      FROM public.attendance a
      WHERE a.session_id = p_session_id
      UNION
      SELECT p.student_id
      FROM public.pending_session_points p
      WHERE p.group_id = v_session.group_id
        AND p.session_date = v_session.session_date
        AND p.status IN ('pending', 'approved')
    ) ids;
  END IF;

  IF v_expected_ids IS DISTINCT FROM v_supplied_ids THEN
    RETURN jsonb_build_object(
      'completed', v_already_completed,
      'already_completed', v_already_completed,
      'conflict', true,
      'code', 'ROSTER_CHANGED_OR_INCOMPLETE'
    );
  END IF;

  SELECT count(*)::integer INTO v_pending_count
  FROM public.pending_session_points p
  WHERE p.group_id = v_session.group_id
    AND p.session_date = v_session.session_date
    AND p.status IN ('pending', 'approved');

  IF v_already_completed AND v_pending_count > 0 THEN
    RETURN jsonb_build_object(
      'completed', true,
      'already_completed', true,
      'conflict', true,
      'code', 'COMPLETED_SESSION_HAS_UNAPPLIED_POINTS'
    );
  END IF;

  IF NOT v_already_completed AND EXISTS (
    SELECT 1
    FROM public.pending_session_points p
    WHERE p.group_id = v_session.group_id
      AND p.session_date = v_session.session_date
      AND p.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'PENDING_POINTS_REQUIRE_REVIEW';
  END IF;

  -- Preflight every requested and existing row before the first mutation.
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_student := (v_row->>'student_id')::uuid;
    v_status := v_row->>'attendance_status';
    v_payment := v_row->>'payment_status';
    v_points := (v_row->>'points_change')::numeric;
    v_details := coalesce(v_row->'points_details', '[]'::jsonb);

    IF v_student IS NULL THEN RAISE EXCEPTION 'MISSING_STUDENT_ID'; END IF;
    IF v_points IS NULL OR v_points <> trunc(v_points) THEN
      RAISE EXCEPTION 'NON_INTEGER_POINTS';
    END IF;
    IF v_status NOT IN ('present', 'late', 'absent', 'excused')
       OR v_payment NOT IN ('paid', 'due', 'free')
       OR jsonb_typeof(v_details) <> 'array' THEN
      RAISE EXCEPTION 'INVALID_ATTENDANCE_ROW';
    END IF;
    IF NOT public.session_accepts_student(p_session_id, v_student) THEN
      RAISE EXCEPTION 'STUDENT_NOT_IN_SESSION_GROUP';
    END IF;

    SELECT (f->>'points')::numeric, f->'details' INTO v_points,v_details
    FROM (SELECT public.filter_arrears_attendance_points(
      p_session_id,v_student,v_points,v_details) f) normalized;
    IF v_status IN ('absent', 'excused') THEN v_payment := 'free'; END IF;

    SELECT coalesce(jsonb_agg(d.detail ORDER BY d.ord), '[]'::jsonb)
    INTO v_requested_details
    FROM jsonb_array_elements(v_details) WITH ORDINALITY d(detail, ord)
    WHERE coalesce(d.detail->>'source', '') <> 'manager_pending'
      AND coalesce(d.detail->>'reason', '') <> 'package_payment';

    SELECT * INTO v_existing
    FROM public.attendance a
    WHERE a.session_id = p_session_id
      AND a.student_id = v_student
    FOR UPDATE;

    IF NOT FOUND THEN
      IF v_already_completed THEN
        RETURN jsonb_build_object(
          'completed', true,
          'already_completed', true,
          'conflict', true,
          'code', 'COMPLETED_SESSION_MISSING_ATTENDANCE',
          'student_id', v_student
        );
      END IF;
      CONTINUE;
    END IF;

    v_existing_count := v_existing_count + 1;

    SELECT
      coalesce(jsonb_agg(d.detail ORDER BY d.ord)
        FILTER (WHERE coalesce(d.detail->>'source', '') <> 'manager_pending'
          AND coalesce(d.detail->>'reason', '') <> 'package_payment'), '[]'::jsonb),
      coalesce(sum(
        CASE
          WHEN coalesce(d.detail->>'source', '') = 'manager_pending'
            AND jsonb_typeof(d.detail->'value') = 'number'
          THEN (d.detail->>'value')::numeric
          ELSE 0
        END
      ), 0)
    INTO v_existing_details, v_manager_points
    FROM jsonb_array_elements(coalesce(v_existing.points_details, '[]'::jsonb))
      WITH ORDINALITY d(detail, ord);

    IF v_existing.attendance_status IS DISTINCT FROM v_status
       OR (
         v_existing.payment_status IS DISTINCT FROM v_payment
         AND NOT (
           coalesce(v_existing.package_consumed, false)
           AND v_existing.payment_status = 'paid'
           AND v_payment = 'due'
         )
       )
       OR coalesce(v_existing.points_change, 0) - v_manager_points IS DISTINCT FROM v_points
       OR v_existing_details IS DISTINCT FROM v_requested_details THEN
      RETURN jsonb_build_object(
        'completed', v_already_completed,
        'already_completed', v_already_completed,
        'conflict', true,
        'code', 'EXISTING_ATTENDANCE_CONFLICT',
        'student_id', v_student
      );
    END IF;

    SELECT count(*)::integer INTO v_receipt_count
    FROM public.payments pay
    WHERE pay.attendance_id = v_existing.id;

    IF coalesce(v_existing.package_consumed, false) THEN
      IF v_existing.package_id IS NULL OR v_receipt_count <> 0 THEN
        RETURN jsonb_build_object(
          'completed', v_already_completed,
          'already_completed', v_already_completed,
          'conflict', true,
          'code', 'PACKAGE_FINANCIAL_STATE_CONFLICT',
          'student_id', v_student
        );
      END IF;
    ELSIF v_existing.payment_status = 'paid'
          AND coalesce(v_existing.charge_amount, 0) > 0 THEN
      IF v_receipt_count <> 1 THEN
        RETURN jsonb_build_object(
          'completed', v_already_completed,
          'already_completed', v_already_completed,
          'conflict', true,
          'code', 'PAYMENT_RECEIPT_STATE_CONFLICT',
          'student_id', v_student
        );
      END IF;
    ELSIF v_existing.payment_status IN ('due', 'free') THEN
      IF v_receipt_count <> 0
         OR coalesce(v_existing.package_consumed, false)
         OR (v_existing.payment_status = 'free' AND coalesce(v_existing.charge_amount, 0) <> 0) THEN
        RETURN jsonb_build_object(
          'completed', v_already_completed,
          'already_completed', v_already_completed,
          'conflict', true,
          'code', 'ATTENDANCE_FINANCIAL_STATE_CONFLICT',
          'student_id', v_student
        );
      END IF;
    END IF;
  END LOOP;

  IF v_already_completed THEN
    RETURN jsonb_build_object(
      'completed', true,
      'already_completed', true,
      'same_payload', true,
      'saved_count', v_existing_count
    );
  END IF;

  -- Validation succeeded. Write only missing students; existing rows and their
  -- receipts/package consumption/points remain byte-for-byte untouched.
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_student := (v_row->>'student_id')::uuid;

    IF EXISTS (
      SELECT 1 FROM public.attendance a
      WHERE a.session_id = p_session_id AND a.student_id = v_student
    ) THEN
      CONTINUE;
    END IF;

    v_status := v_row->>'attendance_status';
    v_payment := v_row->>'payment_status';
    v_points := (v_row->>'points_change')::numeric;
    v_details := coalesce(v_row->'points_details', '[]'::jsonb);
    SELECT (f->>'points')::numeric, f->'details' INTO v_points,v_details
    FROM (SELECT public.filter_arrears_attendance_points(
      p_session_id,v_student,v_points,v_details) f) normalized;
    IF v_status IN ('absent', 'excused') THEN v_payment := 'free'; END IF;

    IF v_status IN ('present', 'late') AND v_payment <> 'free' THEN
      v_result := public.save_package_attendance_if_available(
        p_session_id, v_student, v_status, v_payment,
        v_points::integer, v_details, NULL
      );
    ELSE
      v_result := jsonb_build_object('handled', false);
    END IF;

    IF NOT coalesce((v_result->>'handled')::boolean, false) THEN
      PERFORM public.save_safe_attendance_with_account(
        p_session_id, v_student, v_status, v_payment,
        v_points, v_details, NULL
      );
    END IF;

    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  v_result := public.complete_session_with_pending_points(p_session_id);

  SELECT count(*)::integer INTO v_saved_count
  FROM public.attendance
  WHERE session_id = p_session_id;

  IF v_saved_count <> v_expected
     OR NOT EXISTS (
       SELECT 1 FROM public.sessions
       WHERE id = p_session_id AND status = 'completed'
     ) THEN
    RAISE EXCEPTION 'ATOMIC_COMPLETION_INVARIANT_FAILED';
  END IF;

  RETURN jsonb_build_object(
    'completed', true,
    'already_completed', false,
    'resumed_partial', v_existing_count > 0,
    'existing_count', v_existing_count,
    'inserted_count', v_inserted_count,
    'saved_count', v_saved_count,
    'applied_count', coalesce((v_result->>'applied_count')::integer, 0),
    'completion', v_result
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_session_with_pending_points(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT up.role, up.is_active
  INTO v_role, v_is_active
  FROM public.user_profiles up
  WHERE up.id = v_user_id;

  IF NOT coalesce(v_is_active, false)
     OR NOT (
       v_role = 'owner'
       OR (v_role = 'manager' AND public.has_permission('attendance_edit'))
     ) THEN
    RAISE EXCEPTION 'Attendance edit permission required';
  END IF;

  SELECT *
  INTO v_session
  FROM public.sessions s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_session.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled session cannot be completed';
  END IF;
  IF v_session.status = 'completed' THEN
    RETURN jsonb_build_object(
      'completed', true,
      'already_completed', true,
      'applied_count', 0,
      'total_points', 0
    );
  END IF;

  PERFORM 1 FROM public.students st
  WHERE st.id IN (SELECT p.student_id FROM public.pending_session_points p
    WHERE p.group_id=v_session.group_id AND p.session_date=v_session.session_date
      AND p.status IN ('pending','approved')) ORDER BY st.id FOR UPDATE;
  UPDATE public.pending_session_points p SET status='cancelled',updated_at=now()
  WHERE p.group_id=v_session.group_id AND p.session_date=v_session.session_date
    AND p.status IN ('pending','approved') AND p.points>0
    AND public.arrears_points_blocked(p.student_id);

  SELECT count(*)::integer
  INTO v_pending_count
  FROM public.pending_session_points p
  WHERE p.group_id = v_session.group_id
    AND p.session_date = v_session.session_date
    AND p.status = 'pending';

  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'PENDING_POINTS_REQUIRE_REVIEW:%', v_pending_count;
  END IF;

  SELECT count(*)::integer
  INTO v_unmatched_approved_count
  FROM public.pending_session_points p
  WHERE p.group_id = v_session.group_id
    AND p.session_date = v_session.session_date
    AND p.status = 'approved'
    AND NOT EXISTS (
      SELECT 1
      FROM public.attendance a
      WHERE a.session_id = v_session.id
        AND a.student_id = p.student_id
    );

  IF v_unmatched_approved_count > 0 THEN
    RAISE EXCEPTION 'APPROVED_POINTS_WITHOUT_ATTENDANCE:%', v_unmatched_approved_count;
  END IF;

  FOR v_student IN
    SELECT p.student_id, sum(p.points)::numeric(10,2) AS total_points
    FROM public.pending_session_points p
    WHERE p.group_id = v_session.group_id
      AND p.session_date = v_session.session_date
      AND p.status = 'approved'
    GROUP BY p.student_id
  LOOP
    v_total := v_student.total_points;

    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'value', detail.total_points,
          'reason', detail.summary_reason,
          'reason_label', detail.reason_label,
          'source', 'manager_pending',
          'record_count', detail.record_count
        )
        ORDER BY detail.first_created_at, detail.reason_label
      ),
      '[]'::jsonb
    )
    INTO v_details
    FROM (
      SELECT
        sum(p.points)::numeric(10,2) AS total_points,
        min(p.created_at) AS first_created_at,
        count(*)::integer AS record_count,
        regexp_replace(
          coalesce(p.reason_text, p.reason_key, 'نقاط'),
          '^تراجع عن:\s*',
          '',
          'g'
        ) AS reason_label,
        CASE
          WHEN bool_or(p.reason_key LIKE 'teacher_board_%') THEN
            'teacher_board_reason:' || md5(
              regexp_replace(
                coalesce(p.reason_text, p.reason_key, 'نقاط'),
                '^تراجع عن:\s*',
                '',
                'g'
              )
            )
          ELSE min(p.reason_key)
        END AS summary_reason
      FROM public.pending_session_points p
      WHERE p.group_id = v_session.group_id
        AND p.session_date = v_session.session_date
        AND p.status = 'approved'
        AND p.student_id = v_student.student_id
      GROUP BY
        coalesce(p.reason_type, 'manual'),
        regexp_replace(
          coalesce(p.reason_text, p.reason_key, 'نقاط'),
          '^تراجع عن:\s*',
          '',
          'g'
        )
      HAVING sum(p.points) <> 0
    ) detail;

    UPDATE public.students s
    SET points_balance = coalesce(s.points_balance, 0) + v_total
    WHERE s.id = v_student.student_id;

    UPDATE public.attendance a
    SET
      points_change = coalesce(a.points_change, 0) + v_total,
      points_details = coalesce(a.points_details, '[]'::jsonb)
        || coalesce(v_details, '[]'::jsonb)
    WHERE a.session_id = v_session.id
      AND a.student_id = v_student.student_id;
  END LOOP;

  SELECT count(*)::integer, coalesce(sum(p.points), 0)::numeric(10,2)
  INTO v_applied_count, v_total_points
  FROM public.pending_session_points p
  WHERE p.group_id = v_session.group_id
    AND p.session_date = v_session.session_date
    AND p.status = 'approved';

  -- Preserve each original record in the immutable transaction history.
  INSERT INTO public.point_transactions (
    student_id,
    points,
    reason_type,
    reason_text
  )
  SELECT p.student_id, p.points, p.reason_type, p.reason_text
  FROM public.pending_session_points p
  WHERE p.group_id = v_session.group_id
    AND p.session_date = v_session.session_date
    AND p.status = 'approved';

  UPDATE public.pending_session_points p
  SET
    status = 'applied',
    applied_session_id = v_session.id,
    applied_at = now(),
    updated_at = now()
  WHERE p.group_id = v_session.group_id
    AND p.session_date = v_session.session_date
    AND p.status = 'approved';

  UPDATE public.sessions
  SET status = 'completed'
  WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'completed', true,
    'already_completed', false,
    'applied_count', v_applied_count,
    'total_points', v_total_points
  );
END;
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


  IF p_action IN ('approve','edit') AND coalesce(p_points,v_row.points)>0
     AND public.arrears_points_blocked(v_row.student_id) THEN
    UPDATE public.pending_session_points SET status='cancelled',updated_at=now() WHERE id=p_pending_id;
    RETURN jsonb_build_object('success',true,'blocked',true,'id',p_pending_id,'action','delete');
  END IF;

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

-- Retain the existing authenticated API surface; helpers stay private.
DO $acl$
DECLARE f regprocedure;
BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN (
 'add_points_only','queue_manager_points','queue_owner_teacher_board_point',
 'queue_owner_teacher_board_point_with_reason','queue_screen_teacher_board_point_with_reason',
 'save_safe_attendance','save_package_attendance_if_available','save_attendance_batch_atomic',
 'complete_session_with_pending_points','review_pending_session_point')
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f);
 END LOOP;
END; $acl$;
