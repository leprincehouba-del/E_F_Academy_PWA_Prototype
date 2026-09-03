BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_package_sessions integer NOT NULL DEFAULT 8
    CHECK (default_package_sessions BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.billing_settings (id, default_package_sessions)
VALUES (1, 8)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.student_session_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  sessions_total integer NOT NULL CHECK (sessions_total > 0),
  sessions_remaining integer NOT NULL
    CHECK (sessions_remaining >= 0 AND sessions_remaining <= sessions_total),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  amount_paid numeric(12,2) NOT NULL CHECK (amount_paid >= 0),
  payment_method text NOT NULL,
  starts_on date NOT NULL,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  purchase_token uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'depleted', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS student_session_packages_active_idx
  ON public.student_session_packages (student_id, starts_on, purchased_at)
  WHERE sessions_remaining > 0 AND status = 'active';

ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS package_id uuid
    REFERENCES public.student_session_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_consumed boolean NOT NULL DEFAULT false;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_source text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS package_id uuid
    REFERENCES public.student_session_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_sessions integer;

CREATE INDEX IF NOT EXISTS attendance_package_id_idx
  ON public.attendance (package_id)
  WHERE package_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_package_id_idx
  ON public.payments (package_id)
  WHERE package_id IS NOT NULL;

ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_session_packages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.billing_settings FROM anon, authenticated;
REVOKE ALL ON TABLE public.student_session_packages FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_session_packages()
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
        AND COALESCE(mp.permissions ->> 'attendance_edit', 'false') = 'true'
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_session_packages() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_session_packages() TO service_role;

CREATE OR REPLACE FUNCTION public.get_session_package_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.get_session_package_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_session_package_settings() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_default_session_package_size(
  p_default_package_sessions integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.set_default_session_package_size(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_default_session_package_size(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_academy_billing_settings(
  p_default_package_sessions integer,
  p_primary_price numeric,
  p_prep_price numeric,
  p_secondary_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.set_academy_billing_settings(
  integer, numeric, numeric, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_academy_billing_settings(
  integer, numeric, numeric, numeric
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_student_session_package_balances(
  p_student_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.get_student_session_package_balances(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_session_package_balances(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.purchase_student_session_package(
  p_student_id uuid,
  p_payment_method text,
  p_request_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.purchase_student_session_package(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_student_session_package(uuid, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_package_attendance_if_available(
  p_session_id uuid,
  p_student_id uuid,
  p_attendance_status text,
  p_requested_payment_status text,
  p_points_change integer,
  p_points_details jsonb,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  IF NOT public.can_manage_session_packages() THEN
    RAISE EXCEPTION 'PACKAGE_PERMISSION_DENIED';
  END IF;

  IF p_attendance_status NOT IN ('present', 'late', 'absent', 'excused') THEN
    RAISE EXCEPTION 'INVALID_ATTENDANCE_STATUS';
  END IF;

  IF p_requested_payment_status NOT IN ('paid', 'due', 'free') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_STATUS';
  END IF;

  SELECT se.session_date, se.group_id, se.start_time
  INTO v_session_date, v_session_group_id, v_session_start_time
  FROM public.sessions se
  WHERE se.id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = p_student_id
      AND s.is_active = true
      AND s.group_id = v_session_group_id
  ) THEN
    RAISE EXCEPTION 'STUDENT_NOT_IN_SESSION_GROUP';
  END IF;

  SELECT *
  INTO v_attendance
  FROM public.attendance a
  WHERE a.session_id = p_session_id
    AND a.student_id = p_student_id
  FOR UPDATE;

  IF FOUND THEN
    v_old_points := COALESCE(v_attendance.points_change, 0);
  END IF;

  v_chargeable := p_attendance_status IN ('present', 'late');

  IF COALESCE(v_attendance.package_consumed, false) THEN
    IF v_chargeable AND p_requested_payment_status <> 'free' THEN
      v_details := v_details || jsonb_build_array(
        jsonb_build_object(
          'value', 0,
          'reason', 'package_payment',
          'reason_label', 'من الباقة'
        )
      );

      UPDATE public.attendance
      SET attendance_status = p_attendance_status,
          payment_status = 'paid',
          charge_amount = COALESCE(v_attendance.charge_amount, 0),
          paid_amount = COALESCE(v_attendance.charge_amount, 0),
          points_change = COALESCE(p_points_change, 0),
          points_details = v_details,
          notes = p_notes,
          package_consumed = true
      WHERE id = v_attendance.id;

      UPDATE public.students
      SET points_balance = COALESCE(points_balance, 0)
            + COALESCE(p_points_change, 0) - v_old_points,
          updated_at = now()
      WHERE id = p_student_id;

      PERFORM public.sync_student_due_totals(p_student_id);

      SELECT COALESCE(SUM(sessions_remaining), 0)::integer
      INTO v_remaining
      FROM public.student_session_packages
      WHERE student_id = p_student_id
        AND status <> 'cancelled';

      RETURN jsonb_build_object(
        'handled', true,
        'used_package', true,
        'restored_package', false,
        'remaining_sessions', v_remaining
      );
    END IF;

    UPDATE public.student_session_packages
    SET sessions_remaining = sessions_remaining + 1,
        status = 'active'
    WHERE id = v_attendance.package_id;

    UPDATE public.attendance
    SET attendance_status = p_attendance_status,
        payment_status = CASE
          WHEN v_chargeable THEN p_requested_payment_status
          ELSE 'free'
        END,
        charge_amount = CASE
          WHEN v_chargeable AND p_requested_payment_status <> 'free'
            THEN COALESCE(v_attendance.charge_amount, 0)
          ELSE 0
        END,
        paid_amount = 0,
        points_change = COALESCE(p_points_change, 0),
        points_details = v_details,
        notes = p_notes,
        package_id = NULL,
        package_consumed = false
    WHERE id = v_attendance.id;

    UPDATE public.students
    SET points_balance = COALESCE(points_balance, 0)
          + COALESCE(p_points_change, 0) - v_old_points,
        updated_at = now()
    WHERE id = p_student_id;

    PERFORM public.sync_student_due_totals(p_student_id);

    SELECT COALESCE(SUM(sessions_remaining), 0)::integer
    INTO v_remaining
    FROM public.student_session_packages
    WHERE student_id = p_student_id
      AND status <> 'cancelled';

    RETURN jsonb_build_object(
      'handled', true,
      'used_package', false,
      'restored_package', true,
      'remaining_sessions', v_remaining
    );
  END IF;

  IF NOT v_chargeable OR p_requested_payment_status = 'free' THEN
    RETURN jsonb_build_object(
      'handled', false,
      'used_package', false,
      'remaining_sessions', 0
    );
  END IF;

  IF v_attendance.id IS NOT NULL
     AND v_attendance.payment_status = 'paid' THEN
    RETURN jsonb_build_object(
      'handled', false,
      'used_package', false,
      'remaining_sessions', 0
    );
  END IF;

  SELECT p.*
  INTO v_package
  FROM public.student_session_packages p
  WHERE p.student_id = p_student_id
    AND p.status = 'active'
    AND p.sessions_remaining > 0
    AND (
      p.starts_on < v_session_date
      OR (
        p.starts_on = v_session_date
        AND p.purchased_at < (
          (
            v_session_date
            + COALESCE(v_session_start_time, time '00:00')
            + interval '1 hour'
          ) AT TIME ZONE 'Africa/Cairo'
        )
      )
  )
  ORDER BY p.starts_on, p.purchased_at, p.id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'handled', false,
      'used_package', false,
      'remaining_sessions', 0
    );
  END IF;

  UPDATE public.student_session_packages
  SET sessions_remaining = sessions_remaining - 1,
      status = CASE
        WHEN sessions_remaining - 1 = 0 THEN 'depleted'
        ELSE 'active'
      END
  WHERE id = v_package.id;

  v_details := v_details || jsonb_build_array(
    jsonb_build_object(
      'value', 0,
      'reason', 'package_payment',
      'reason_label', 'من الباقة'
    )
  );

  IF v_attendance.id IS NULL THEN
    INSERT INTO public.attendance (
      session_id,
      student_id,
      attendance_status,
      payment_status,
      charge_amount,
      paid_amount,
      points_change,
      points_details,
      notes,
      package_id,
      package_consumed
    )
    VALUES (
      p_session_id,
      p_student_id,
      p_attendance_status,
      'paid',
      v_package.unit_price,
      v_package.unit_price,
      COALESCE(p_points_change, 0),
      v_details,
      p_notes,
      v_package.id,
      true
    );
  ELSE
    UPDATE public.attendance
    SET attendance_status = p_attendance_status,
        payment_status = 'paid',
        charge_amount = v_package.unit_price,
        paid_amount = v_package.unit_price,
        points_change = COALESCE(p_points_change, 0),
        points_details = v_details,
        notes = p_notes,
        package_id = v_package.id,
        package_consumed = true
    WHERE id = v_attendance.id;
  END IF;

  UPDATE public.students
  SET points_balance = COALESCE(points_balance, 0)
        + COALESCE(p_points_change, 0) - v_old_points,
      updated_at = now()
  WHERE id = p_student_id;

  PERFORM public.sync_student_due_totals(p_student_id);

  SELECT COALESCE(SUM(sessions_remaining), 0)::integer
  INTO v_remaining
  FROM public.student_session_packages
  WHERE student_id = p_student_id
    AND status <> 'cancelled';

  RETURN jsonb_build_object(
    'handled', true,
    'used_package', true,
    'restored_package', false,
    'remaining_sessions', v_remaining,
    'package_id', v_package.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_package_attendance_if_available(
  uuid, uuid, text, text, integer, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_package_attendance_if_available(
  uuid, uuid, text, text, integer, jsonb, text
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_owner_daily_payment_report_v2(
  p_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.get_owner_daily_payment_report_v2(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_daily_payment_report_v2(date) TO authenticated, service_role;

COMMIT;
