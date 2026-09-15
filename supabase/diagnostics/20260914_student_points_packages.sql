-- Read-only: no data is changed. All sections appear in ONE result table.
-- students.full_name is the database column; app.js maps it to UI "name".
WITH targets AS (
  SELECT s.*
  FROM public.students s
  WHERE translate(regexp_replace(trim(s.full_name), '\s+', ' ', 'g'), 'ى', 'ي')
    IN ('زهراء حجازي محمد', 'سامية حسن محمد', 'محمد علي رجب')
), report AS (
  SELECT '1_student'::text AS section, s.full_name AS student_name,
    jsonb_build_object(
      'id', s.id, 'full_name', s.full_name, 'group_id', s.group_id,
      'points_balance', s.points_balance, 'due_amount', s.due_amount,
      'due_sessions_count', s.due_sessions_count
    ) AS details
  FROM targets s
  UNION ALL
  SELECT '2_attendance', s.full_name, to_jsonb(a)
  FROM public.attendance a JOIN targets s ON s.id = a.student_id
  WHERE s.full_name NOT LIKE 'محمد%'
  UNION ALL
  SELECT '3_points_transaction', s.full_name, to_jsonb(t)
  FROM public.point_transactions t JOIN targets s ON s.id = t.student_id
  WHERE s.full_name NOT LIKE 'محمد%'
  UNION ALL
  SELECT '4_package', s.full_name, to_jsonb(p)
  FROM public.student_session_packages p JOIN targets s ON s.id = p.student_id
  WHERE s.full_name LIKE 'محمد%'
  UNION ALL
  SELECT '5_points_schema', '', jsonb_build_object(
    'table_name', table_name, 'column_name', column_name, 'data_type', data_type
  )
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (table_name ILIKE '%pending%' OR table_name ILIKE '%point%')
  UNION ALL
  SELECT '0_match_count', '', jsonb_build_object('matched_students', count(*))
  FROM targets
)
SELECT section, student_name, details FROM report
ORDER BY section, student_name, details::text;
