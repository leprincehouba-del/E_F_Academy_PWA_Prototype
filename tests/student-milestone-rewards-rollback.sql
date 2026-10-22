-- Run only AFTER applying the milestone migration, in a staging database.
-- Entire test is rolled back; no real notifications or point changes persist.
BEGIN;
DO $$
DECLARE sid uuid; original_points numeric; before_count integer; after_count integer;
BEGIN
 SELECT id,points_balance INTO sid,original_points FROM public.students
 WHERE is_active=true ORDER BY created_at LIMIT 1;
 IF sid IS NULL THEN RAISE EXCEPTION 'No test student found'; END IF;
 PERFORM public.record_student_milestone_rewards(sid,200);
 SELECT count(*) INTO before_count FROM public.student_milestone_rewards
  WHERE student_id=sid AND milestone_points=200;
 PERFORM public.record_student_milestone_rewards(sid,200);
 SELECT count(*) INTO after_count FROM public.student_milestone_rewards
  WHERE student_id=sid AND milestone_points=200;
 IF before_count<>1 OR after_count<>1 THEN
  RAISE EXCEPTION 'Duplicate milestone award detected';
 END IF;
 UPDATE public.students SET points_balance=0 WHERE id=sid;
 IF NOT EXISTS (SELECT 1 FROM public.student_milestone_rewards
                WHERE student_id=sid AND milestone_points=200) THEN
  RAISE EXCEPTION 'Earned award was lost when points fell';
 END IF;
 UPDATE public.students SET points_balance=200 WHERE id=sid;
 SELECT count(*) INTO after_count FROM public.student_milestone_rewards
  WHERE student_id=sid AND milestone_points=200;
 IF after_count<>1 THEN RAISE EXCEPTION 'Re-earned milestone created duplicate'; END IF;
 RAISE NOTICE 'Milestone idempotency and persistence passed';
END $$;
ROLLBACK;
