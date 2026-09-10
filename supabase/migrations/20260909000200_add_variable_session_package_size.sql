BEGIN;

CREATE OR REPLACE FUNCTION public.purchase_student_session_package_custom(
  p_student_id uuid,
  p_payment_method text,
  p_request_token uuid,
  p_sessions integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.purchase_student_session_package_custom(
  uuid, text, uuid, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_student_session_package_custom(
  uuid, text, uuid, integer
) TO authenticated, service_role;

COMMIT;
