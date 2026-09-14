-- Read-only investigation. No points, payments, attendance or balances are changed.
-- Review these results before any historical repair.
SELECT s.id, s.name, to_jsonb(s) - 'parent_phone' AS student
FROM public.students s
WHERE s.name IN ('زهراء حجازى محمد', 'زهراء حجازي محمد', 'سامية حسن محمد', 'محمد على رجب', 'محمد علي رجب');

SELECT s.name, to_jsonb(a) AS attendance
FROM public.attendance a JOIN public.students s ON s.id = a.student_id
WHERE s.name IN ('زهراء حجازى محمد', 'زهراء حجازي محمد', 'سامية حسن محمد');

SELECT s.name, to_jsonb(t) AS points_transaction
FROM public.point_transactions t JOIN public.students s ON s.id = t.student_id
WHERE s.name IN ('زهراء حجازى محمد', 'زهراء حجازي محمد', 'سامية حسن محمد');

SELECT s.id AS student_id, s.name, to_jsonb(p) AS package
FROM public.student_session_packages p JOIN public.students s ON s.id = p.student_id
WHERE s.name IN ('محمد على رجب', 'محمد علي رجب')
ORDER BY p.purchased_at DESC;

-- Locate pending-points tables and their date/status columns before querying them.
SELECT table_name, column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND (table_name ILIKE '%pending%' OR table_name ILIKE '%point%')
ORDER BY table_name, ordinal_position;
