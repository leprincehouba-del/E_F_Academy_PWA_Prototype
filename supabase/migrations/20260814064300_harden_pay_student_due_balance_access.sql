REVOKE ALL ON FUNCTION public.pay_student_due_balance(uuid,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_student_due_balance(uuid,numeric,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.pay_student_due_balance(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_student_due_balance(uuid,numeric,text) TO service_role;
