-- Permanent 200-point milestone ledger; no change to student points, payments, or attendance.
CREATE TABLE IF NOT EXISTS public.student_milestone_rewards (
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  milestone_points integer NOT NULL CHECK (milestone_points > 0 AND milestone_points % 200 = 0),
  star_number integer GENERATED ALWAYS AS (milestone_points / 200) STORED,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  PRIMARY KEY (student_id, milestone_points)
);
ALTER TABLE public.student_milestone_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_milestone_rewards FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.student_milestone_rewards TO authenticated;
CREATE POLICY milestone_rewards_read ON public.student_milestone_rewards
 FOR SELECT TO authenticated
 USING (
  EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id=auth.uid() AND p.is_active=true AND p.role IN ('owner','manager'))
  OR EXISTS (
    SELECT 1 FROM public.students s
    JOIN public.user_profiles p ON p.id=auth.uid()
    WHERE s.id=student_id AND p.is_active=true AND p.role='parent'
      AND length(regexp_replace(coalesce(s.parent_phone,''),'[^0-9]','','g')) >= 10
      AND length(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')) >= 10
      AND right(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'),10)
        = right(regexp_replace(coalesce(s.parent_phone,''),'[^0-9]','','g'),10)
  )
 );
CREATE OR REPLACE FUNCTION public.record_student_milestone_rewards(p_student_id uuid, p_points numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_level integer; v_student public.students%ROWTYPE; v_notification_id uuid;
BEGIN
 SELECT * INTO v_student FROM public.students WHERE id=p_student_id;
 IF NOT FOUND OR p_points IS NULL OR p_points < 200 THEN RETURN; END IF;
 -- The unique (student_id, milestone_points) key serializes each award.
 -- Do not re-lock the student row from its own AFTER UPDATE trigger.
 FOR v_level IN 1..LEAST(floor(p_points / 200)::integer, 10000) LOOP
  INSERT INTO public.student_milestone_rewards(student_id,milestone_points)
   VALUES (p_student_id,v_level*200) ON CONFLICT DO NOTHING;
  IF FOUND THEN
   BEGIN
   INSERT INTO public.notifications(student_id,parent_phone,channel,title,body,status)
   VALUES (p_student_id,v_student.parent_phone,'in_app',
     '🎉 إنجاز جديد! ' || (v_level*200) || ' نقطة',
     'نهنئ ولي الأمر بوصول الطالب ' || v_student.full_name || ' إلى ' || (v_level*200) ||
     ' نقطة! ⭐ حصل على النجمة رقم ' || v_level || ' وأصبح مستحقًا لجائزة ' ||
     (v_level*200) || ' نقطة. Mr Mohamed Mahmoud','pending')
   RETURNING id INTO v_notification_id;
   UPDATE public.student_milestone_rewards SET notification_id=v_notification_id
    WHERE student_id=p_student_id AND milestone_points=v_level*200;
   EXCEPTION WHEN OTHERS THEN
    -- Notification is optional: preserve the award and normal points save.
    RAISE WARNING 'Milestone notification could not be queued for student %, milestone %: %', p_student_id, v_level*200, SQLERRM;
   END;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.record_student_milestone_rewards(uuid,numeric) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.trg_student_milestone_rewards()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.points_balance IS DISTINCT FROM OLD.points_balance THEN
  BEGIN
   PERFORM public.record_student_milestone_rewards(NEW.id,NEW.points_balance);
  EXCEPTION WHEN OTHERS THEN
   -- Rewards must never prevent staff from recording attendance or points.
   RAISE WARNING 'Reward processing deferred for student %: %', NEW.id, SQLERRM;
  END;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_student_milestone_rewards() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_student_milestone_rewards ON public.students;
CREATE TRIGGER trg_student_milestone_rewards AFTER INSERT OR UPDATE OF points_balance
 ON public.students FOR EACH ROW EXECUTE FUNCTION public.trg_student_milestone_rewards();
-- Backfill separately after release verification:
-- SELECT public.record_student_milestone_rewards(id,points_balance)
-- FROM public.students WHERE is_active=true AND points_balance>=200;
