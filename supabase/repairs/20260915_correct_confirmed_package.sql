-- Authorized correction: 8 sessions / EGP 120, one consumed on 2026-09-13.
-- Run the WHOLE script. Any failed check rolls back all changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.manual_data_repair_audit (
  repair_key text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user,
  before_value jsonb NOT NULL,
  after_value jsonb NOT NULL
);
ALTER TABLE public.manual_data_repair_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_data_repair_audit FROM PUBLIC, anon, authenticated;

DO $repair$
DECLARE
  sid constant uuid := 'b5dcde49-7cc8-44ed-bf8f-85d7f0158149';
  pid constant uuid := '247d41fe-4843-4e97-a92f-fe0af32fb899';
  aid constant uuid := 'c5bae6ef-d6e3-4375-b766-65186dac4190';
  payid constant uuid := 'c2a8b0bb-133b-4c11-90af-2e8719d8e19f';
  rkey constant text := '20260915_mohamed_package_8_120_one_consumed';
  p public.student_session_packages%ROWTYPE;
  a public.attendance%ROWTYPE;
  m public.payments%ROWTYPE;
  student_before jsonb;
  snapshot_before jsonb;
  snapshot_after jsonb;
  desired_details jsonb;
BEGIN
  SELECT jsonb_build_object('points', points_balance, 'due', due_amount,
    'due_sessions', due_sessions_count)
  INTO student_before FROM public.students WHERE id = sid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student missing'; END IF;

  SELECT * INTO p FROM public.student_session_packages WHERE id = pid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Package missing'; END IF;
  SELECT * INTO a FROM public.attendance WHERE id = aid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance missing'; END IF;
  SELECT * INTO m FROM public.payments WHERE id = payid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment missing'; END IF;

  IF EXISTS (SELECT 1 FROM public.manual_data_repair_audit WHERE repair_key = rkey) THEN
    RAISE NOTICE 'This correction was already applied. No additional changes.';
    RETURN;
  END IF;

  IF p.student_id IS DISTINCT FROM sid OR p.sessions_total IS DISTINCT FROM 70
    OR p.sessions_remaining IS DISTINCT FROM 70 OR p.amount_paid IS DISTINCT FROM 1050
    OR p.unit_price IS DISTINCT FROM 15 OR p.status IS DISTINCT FROM 'active'
    OR p.starts_on IS DISTINCT FROM DATE '2026-09-13' THEN
    RAISE EXCEPTION 'Package changed since inspection; stop and inspect again';
  END IF;
  IF m.student_id IS DISTINCT FROM sid OR m.package_id IS DISTINCT FROM pid
    OR m.amount IS DISTINCT FROM 1050 OR m.package_sessions IS DISTINCT FROM 70
    OR m.payment_source IS DISTINCT FROM 'session_package' THEN
    RAISE EXCEPTION 'Payment changed since inspection';
  END IF;
  IF (SELECT count(*) FROM public.payments WHERE package_id = pid) <> 1 THEN
    RAISE EXCEPTION 'Unexpected additional package payments';
  END IF;
  IF a.student_id IS DISTINCT FROM sid OR a.package_id IS NOT NULL
    OR a.package_consumed IS DISTINCT FROM false OR a.paid_amount IS DISTINCT FROM 0
    OR a.charge_amount IS DISTINCT FROM 15 OR a.payment_status IS DISTINCT FROM 'paid'
    OR a.attendance_status IS DISTINCT FROM 'present'
    OR a.points_change IS DISTINCT FROM 10
    OR a.session_id IS DISTINCT FROM 'aac08532-d9a3-4649-900c-116af0547382'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.sessions
      WHERE id = a.session_id AND session_date = DATE '2026-09-13') THEN
    RAISE EXCEPTION 'Attendance changed since inspection';
  END IF;
  IF EXISTS (SELECT 1 FROM public.attendance WHERE package_id = pid)
    OR EXISTS (SELECT 1 FROM public.attendance
      WHERE student_id = sid AND session_id = a.session_id AND id <> aid) THEN
    RAISE EXCEPTION 'Unexpected package consumption or duplicate attendance';
  END IF;
  IF jsonb_typeof(a.points_details) IS DISTINCT FROM 'array'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(a.points_details) d
      WHERE d->>'reason' = 'package_payment') THEN
    RAISE EXCEPTION 'Unexpected attendance point details';
  END IF;

  snapshot_before := jsonb_build_object('package', to_jsonb(p),
    'attendance', to_jsonb(a), 'payment', to_jsonb(m), 'student_totals', student_before);
  desired_details := a.points_details || jsonb_build_array(jsonb_build_object(
    'value', 0, 'reason', 'package_payment', 'reason_label', 'من الباقة'));

  UPDATE public.student_session_packages
  SET sessions_total = 8, sessions_remaining = 7, amount_paid = 120
  WHERE id = pid;
  UPDATE public.payments SET amount = 120, package_sessions = 8 WHERE id = payid;
  -- paid_amount is coverage from the existing package, not a new cash receipt.
  UPDATE public.attendance
  SET package_id = pid, package_consumed = true, paid_amount = 15,
      points_details = desired_details
  WHERE id = aid;

  SELECT * INTO p FROM public.student_session_packages WHERE id = pid;
  SELECT * INTO a FROM public.attendance WHERE id = aid;
  SELECT * INTO m FROM public.payments WHERE id = payid;
  IF p.sessions_total IS DISTINCT FROM 8 OR p.sessions_remaining IS DISTINCT FROM 7
    OR p.amount_paid IS DISTINCT FROM 120 OR m.amount IS DISTINCT FROM 120
    OR m.package_sessions IS DISTINCT FROM 8 OR a.package_id IS DISTINCT FROM pid
    OR a.package_consumed IS DISTINCT FROM true OR a.paid_amount IS DISTINCT FROM 15
    OR a.points_change IS DISTINCT FROM 10 OR a.points_details IS DISTINCT FROM desired_details
    OR (SELECT count(*) FROM public.attendance WHERE package_id = pid AND package_consumed) <> 1 THEN
    RAISE EXCEPTION 'Post-correction validation failed; all changes rolled back';
  END IF;
  IF student_before IS DISTINCT FROM (
    SELECT jsonb_build_object('points', points_balance, 'due', due_amount,
      'due_sessions', due_sessions_count) FROM public.students WHERE id = sid
  ) THEN RAISE EXCEPTION 'Unexpected student points or arrears change; rolled back'; END IF;

  snapshot_after := jsonb_build_object('package', to_jsonb(p),
    'attendance', to_jsonb(a), 'payment', to_jsonb(m), 'student_totals', student_before);
  INSERT INTO public.manual_data_repair_audit(repair_key, before_value, after_value)
  VALUES (rkey, snapshot_before, snapshot_after);
END;
$repair$;

SELECT 'CORRECTION_RECORDED' AS result,
  p.sessions_total, p.sessions_remaining, p.amount_paid,
  m.amount AS receipt_amount, a.package_consumed, a.points_change,
  audit.applied_at
FROM public.manual_data_repair_audit audit
JOIN public.student_session_packages p
  ON p.id = '247d41fe-4843-4e97-a92f-fe0af32fb899'::uuid
JOIN public.payments m ON m.id = 'c2a8b0bb-133b-4c11-90af-2e8719d8e19f'::uuid
JOIN public.attendance a ON a.id = 'c5bae6ef-d6e3-4375-b766-65186dac4190'::uuid
WHERE audit.repair_key = '20260915_mohamed_package_8_120_one_consumed';
COMMIT;
