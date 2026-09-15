-- Read-only follow-up. Candidate names are NOT confirmed identities.
-- One result table; export all rows to CSV.
WITH candidates AS (
  SELECT s.*, g.code AS group_code
  FROM public.students s
  LEFT JOIN public.groups g ON g.id = s.group_id
  WHERE translate(s.full_name, 'ى', 'ي') LIKE '%سامي%'
    OR translate(s.full_name, 'ى', 'ي') LIKE '%زهراء%حجاز%'
), report AS (
  SELECT '1_candidates'::text AS section, s.full_name AS student_name,
    jsonb_build_object('student_id', s.id, 'group_code', s.group_code,
      'is_active', s.is_active, 'points_balance', s.points_balance) AS details
  FROM candidates s
  UNION ALL
  SELECT '2_september_5_attendance', s.full_name,
    to_jsonb(a) || jsonb_build_object('session_date', se.session_date, 'session_group_id', se.group_id)
  FROM candidates s
  JOIN public.attendance a ON a.student_id = s.id
  JOIN public.sessions se ON se.id = a.session_id
  WHERE se.session_date = DATE '2026-09-05'
  UNION ALL
  SELECT '3_september_5_pending', s.full_name, to_jsonb(p)
  FROM candidates s JOIN public.pending_session_points p ON p.student_id = s.id
  WHERE p.session_date = DATE '2026-09-05'
  UNION ALL
  SELECT '4_points_transactions', s.full_name, to_jsonb(t)
  FROM candidates s JOIN public.point_transactions t ON t.student_id = s.id
  WHERE t.created_at >= TIMESTAMPTZ '2026-09-05 00:00:00+03'
  UNION ALL
  SELECT '5_package_payment', s.full_name, to_jsonb(p)
  FROM public.payments p JOIN public.students s ON s.id = p.student_id
  WHERE translate(regexp_replace(trim(s.full_name), '\s+', ' ', 'g'), 'ى', 'ي') = 'محمد علي رجب'
    AND p.package_id IS NOT NULL
)
SELECT section, student_name, details FROM report
ORDER BY section, student_name, details::text;
