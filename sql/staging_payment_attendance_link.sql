-- STAGING-ONLY CANDIDATE. Do not apply directly to live production.
-- Historical payments remain untouched; new payments are tied to attendance.
BEGIN;
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS attendance_id uuid REFERENCES public.attendance(id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_receipt_per_attendance
  ON public.payments (attendance_id)
  WHERE attendance_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.save_safe_attendance_with_account(
 p_session_id uuid, p_student_id uuid, p_attendance_status text,
 p_payment_status text, p_points_change numeric DEFAULT 0,
 p_points_details jsonb DEFAULT '[]'::jsonb, p_notes text DEFAULT NULL::text
) RETURNS public.attendance
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 saved_attendance public.attendance;
 effective_payment_status text;
 charge_to_remove numeric := 0;
BEGIN
 effective_payment_status := CASE
   WHEN p_attendance_status IN ('absent','excused') THEN 'free'
   ELSE p_payment_status END;
 IF effective_payment_status NOT IN ('paid','due','free') THEN
   RAISE EXCEPTION 'حالة الحساب غير صحيحة';
 END IF;
 saved_attendance := public.save_safe_attendance(
   p_session_id,p_student_id,p_attendance_status,
   p_points_change,p_points_details,p_notes);
 IF saved_attendance.payment_status = effective_payment_status THEN
   RETURN saved_attendance;
 END IF;
 IF saved_attendance.payment_status <> 'due' THEN
   RAISE EXCEPTION 'حالة الحساب مسجلة بالفعل';
 END IF;
 charge_to_remove := coalesce(saved_attendance.charge_amount,0);
 IF effective_payment_status = 'paid' THEN
   UPDATE public.attendance SET payment_status='paid'
   WHERE id=saved_attendance.id RETURNING * INTO saved_attendance;
   IF charge_to_remove > 0 THEN
     INSERT INTO public.payments
       (student_id,amount,payment_method,notes,attendance_id)
     VALUES (p_student_id,charge_to_remove,'cash','سداد الحصة',saved_attendance.id);
   END IF;
 ELSIF effective_payment_status = 'free' THEN
   UPDATE public.attendance SET payment_status='free',charge_amount=0
   WHERE id=saved_attendance.id RETURNING * INTO saved_attendance;
 END IF;
 RETURN saved_attendance;
END;
$function$;
COMMIT;
