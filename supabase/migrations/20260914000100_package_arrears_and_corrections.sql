BEGIN;

-- Enforce arrears checks for both legacy and custom purchase RPCs.
CREATE OR REPLACE FUNCTION public.check_package_purchase_arrears()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.check_package_purchase_arrears() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS check_package_purchase_arrears ON public.student_session_packages;
CREATE TRIGGER check_package_purchase_arrears BEFORE INSERT ON public.student_session_packages
FOR EACH ROW EXECUTE FUNCTION public.check_package_purchase_arrears();

CREATE TABLE IF NOT EXISTS public.session_package_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.student_session_packages(id),
  corrected_by uuid NOT NULL REFERENCES auth.users(id),
  corrected_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  before_value jsonb NOT NULL,
  after_value jsonb NOT NULL
);
ALTER TABLE public.session_package_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.session_package_corrections FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_student_package_purchase_history(p_student_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'owner' AND is_active = true) THEN
    RAISE EXCEPTION 'OWNER_PERMISSION_REQUIRED';
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.purchased_at DESC), '[]'::jsonb)
    FROM public.student_session_packages p WHERE p.student_id = p_student_id AND p.status <> 'cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.get_student_package_purchase_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_package_purchase_history(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.correct_student_session_package(
  p_package_id uuid, p_expected_total integer, p_expected_remaining integer,
  p_sessions integer, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.correct_student_session_package(uuid,integer,integer,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_student_session_package(uuid,integer,integer,integer,text) TO authenticated;
COMMIT;
