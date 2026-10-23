-- PR53 is not deployed. All objects are additive; no financial/attendance writes.
CREATE SCHEMA IF NOT EXISTS rewards_private;
REVOKE ALL ON SCHEMA rewards_private FROM PUBLIC;
GRANT USAGE ON SCHEMA rewards_private TO authenticated, service_role;

-- Match get_parent_dashboard exactly: digits only, active child and active parent.
CREATE OR REPLACE FUNCTION rewards_private.can_read_student(p_student uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.user_profiles p JOIN public.students s ON s.id=p_student
  WHERE p.id=auth.uid() AND p.is_active=true AND (
   p.role IN ('owner','manager') OR (p.role='parent' AND s.is_active=true
    AND pg_catalog.regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')<>''
    AND pg_catalog.regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')=
        pg_catalog.regexp_replace(coalesce(s.parent_phone,''),'[^0-9]','','g'))))
$$;
REVOKE ALL ON FUNCTION rewards_private.can_read_student(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rewards_private.can_read_student(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.student_milestone_rewards (
 student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
 milestone_points integer NOT NULL CHECK (milestone_points>0 AND milestone_points%200=0),
 star_number integer GENERATED ALWAYS AS (milestone_points/200) STORED,
 awarded_at timestamptz NOT NULL DEFAULT now(),
 notification_id uuid UNIQUE REFERENCES public.notifications(id) ON DELETE SET NULL,
 PRIMARY KEY(student_id,milestone_points)
);
ALTER TABLE public.student_milestone_rewards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_milestone_rewards FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.student_milestone_rewards TO authenticated;
DROP POLICY IF EXISTS milestone_rewards_read ON public.student_milestone_rewards;
CREATE POLICY milestone_rewards_read ON public.student_milestone_rewards
 FOR SELECT TO authenticated USING(rewards_private.can_read_student(student_id));

-- Retain the high water mark if a noncritical award/notification operation fails.
CREATE TABLE IF NOT EXISTS rewards_private.point_peaks (
 student_id uuid PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,
 points numeric NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rewards_private.parent_receipts (
 student_id uuid NOT NULL, milestone_points integer NOT NULL,
 parent_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
 opened_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(student_id,milestone_points,parent_id),
 FOREIGN KEY(student_id,milestone_points) REFERENCES public.student_milestone_rewards ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS rewards_private.push_deliveries (
 student_id uuid NOT NULL, milestone_points integer NOT NULL,
 subscription_id uuid NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','expired')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_until timestamptz, sent_at timestamptz, last_error text,
 PRIMARY KEY(student_id,milestone_points,subscription_id),
 FOREIGN KEY(student_id,milestone_points) REFERENCES public.student_milestone_rewards ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS milestone_delivery_due ON rewards_private.push_deliveries(next_attempt_at)
 WHERE state IN ('pending','sending');
ALTER TABLE rewards_private.point_peaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards_private.parent_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards_private.push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA rewards_private FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.record_student_milestone_rewards(p_student_id uuid,p_points numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_reward record; v_student public.students%ROWTYPE; v_notification uuid;
BEGIN
 SELECT * INTO v_student FROM public.students WHERE id=p_student_id;
 IF NOT FOUND THEN RETURN; END IF;
 IF p_points IS NOT NULL AND p_points>=200 THEN
 INSERT INTO public.student_milestone_rewards(student_id,milestone_points)
 SELECT p_student_id,level*200 FROM pg_catalog.generate_series(1,LEAST(floor(p_points/200),10000)::integer) level
 ON CONFLICT DO NOTHING;
 END IF;
 -- Repair existing awards even when the current balance is below 200.
 -- Lock only unlinked awards. A retry repairs notification failure without re-awarding.
 FOR v_reward IN SELECT * FROM public.student_milestone_rewards
  WHERE student_id=p_student_id AND notification_id IS NULL ORDER BY milestone_points FOR UPDATE LOOP
  BEGIN
   INSERT INTO public.notifications(student_id,parent_phone,channel,title,body,status)
   VALUES(p_student_id,v_student.parent_phone,'in_app',
    '🎉 إنجاز جديد! '||v_reward.milestone_points||' نقطة',
    'مبروك يا '||coalesce(v_student.full_name,'الطالب')||'! استحققت جائزة '||v_reward.milestone_points||
    ' نقطة والنجمة رقم '||(v_reward.milestone_points/200)||' ⭐ — Mr Mohamed Mahmoud','pending')
   RETURNING id INTO v_notification;
   UPDATE public.student_milestone_rewards SET notification_id=v_notification
    WHERE student_id=p_student_id AND milestone_points=v_reward.milestone_points;
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'Milestone notification deferred: %', SQLSTATE;
  END;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.record_student_milestone_rewards(uuid,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.trg_student_milestone_rewards()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.points_balance IS DISTINCT FROM OLD.points_balance THEN
  -- This durable marker is outside the optional award subtransaction.
  INSERT INTO rewards_private.point_peaks(student_id,points) VALUES(NEW.id,coalesce(NEW.points_balance,0))
  ON CONFLICT(student_id) DO UPDATE SET points=greatest(rewards_private.point_peaks.points,excluded.points),updated_at=now();
  BEGIN
   PERFORM public.record_student_milestone_rewards(NEW.id,NEW.points_balance);
  EXCEPTION WHEN OTHERS THEN
   RAISE WARNING 'Milestone processing deferred: %',SQLSTATE;
  END;
 END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 -- Even failure of the deferred marker must not break daily staff work.
 RAISE WARNING 'Milestone marker unavailable; reconcile required: %',SQLSTATE;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_student_milestone_rewards() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_student_milestone_rewards ON public.students;
CREATE TRIGGER trg_student_milestone_rewards AFTER INSERT OR UPDATE OF points_balance ON public.students
 FOR EACH ROW EXECUTE FUNCTION public.trg_student_milestone_rewards();

-- Backfill is an explicit service-only action, never part of migration/parent login.
-- Preview reports only new awards. Apply is idempotent and does not change points.
CREATE OR REPLACE FUNCTION public.backfill_student_milestones(p_apply boolean DEFAULT false)
RETURNS TABLE(student_id uuid,milestone_points integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s record;
BEGIN
 IF p_apply THEN
  FOR s IN SELECT st.id,greatest(coalesce(st.points_balance,0),coalesce(pk.points,0)) points
   FROM public.students st LEFT JOIN rewards_private.point_peaks pk ON pk.student_id=st.id
   WHERE st.is_active=true ORDER BY st.id LOOP
   PERFORM public.record_student_milestone_rewards(s.id,s.points);
  END LOOP;
 END IF;
 RETURN QUERY SELECT st.id,level*200 FROM public.students st
 LEFT JOIN rewards_private.point_peaks pk ON pk.student_id=st.id
 CROSS JOIN LATERAL pg_catalog.generate_series(1,LEAST(floor(greatest(coalesce(st.points_balance,0),coalesce(pk.points,0))/200),10000)::integer) level
 WHERE st.is_active=true AND NOT EXISTS(SELECT 1 FROM public.student_milestone_rewards r WHERE r.student_id=st.id AND r.milestone_points=level*200);
END $$;
REVOKE ALL ON FUNCTION public.backfill_student_milestones(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_student_milestones(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_parent_milestone_rewards(p_student_id uuid)
RETURNS TABLE(milestone_points integer,notification_id uuid,opened_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT rewards_private.can_read_student(p_student_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 RETURN QUERY SELECT r.milestone_points,r.notification_id,c.opened_at FROM public.student_milestone_rewards r
 LEFT JOIN rewards_private.parent_receipts c ON c.student_id=r.student_id AND c.milestone_points=r.milestone_points AND c.parent_id=auth.uid()
 WHERE r.student_id=p_student_id ORDER BY r.milestone_points;
END $$;
CREATE OR REPLACE FUNCTION public.open_parent_milestone(p_student_id uuid,p_milestone integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT rewards_private.can_read_student(p_student_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.student_milestone_rewards r WHERE r.student_id=p_student_id AND r.milestone_points=p_milestone) THEN RETURN false; END IF;
 INSERT INTO rewards_private.parent_receipts(student_id,milestone_points,parent_id)
 VALUES(p_student_id,p_milestone,auth.uid()) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.get_parent_milestone_rewards(uuid),public.open_parent_milestone(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_parent_milestone_rewards(uuid),public.open_parent_milestone(uuid,integer) TO authenticated;

-- Repair deferred awards and queue a distinct job per registered device.
CREATE OR REPLACE FUNCTION public.prepare_milestone_push()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s record;
BEGIN
 FOR s IN SELECT st.id student_id,greatest(coalesce(st.points_balance,0),coalesce(pk.points,0)) points
 FROM public.students st LEFT JOIN rewards_private.point_peaks pk ON pk.student_id=st.id
 WHERE st.is_active=true AND (pk.student_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.student_milestone_rewards r WHERE r.student_id=st.id))
 AND (EXISTS(SELECT 1 FROM public.student_milestone_rewards r WHERE r.student_id=st.id AND r.notification_id IS NULL)
 OR (SELECT count(*) FROM public.student_milestone_rewards r WHERE r.student_id=st.id)<LEAST(floor(greatest(coalesce(st.points_balance,0),coalesce(pk.points,0))/200),10000))
 ORDER BY coalesce(pk.updated_at,'epoch'::timestamptz),st.id LIMIT 100 LOOP
  PERFORM public.record_student_milestone_rewards(s.student_id,s.points);
  INSERT INTO rewards_private.point_peaks(student_id,points) VALUES(s.student_id,s.points)
  ON CONFLICT(student_id) DO UPDATE SET points=greatest(rewards_private.point_peaks.points,excluded.points),updated_at=now();
 END LOOP;
 INSERT INTO rewards_private.push_deliveries(student_id,milestone_points,subscription_id)
 SELECT r.student_id,r.milestone_points,sub.id FROM public.student_milestone_rewards r
 JOIN public.students st ON st.id=r.student_id AND st.is_active=true
 JOIN public.user_profiles p ON p.role='parent' AND p.is_active=true
  AND pg_catalog.regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')<>''
  AND pg_catalog.regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')=pg_catalog.regexp_replace(coalesce(st.parent_phone,''),'[^0-9]','','g')
 JOIN public.push_subscriptions sub ON sub.user_id=p.id
 WHERE r.notification_id IS NOT NULL ON CONFLICT DO NOTHING;
END $$;
CREATE OR REPLACE FUNCTION public.claim_milestone_push(p_limit integer DEFAULT 20)
RETURNS TABLE(student_id uuid,milestone_points integer,subscription_id uuid,lease_token uuid,notification_id uuid,subscription jsonb,title text,body text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN QUERY WITH due AS (
  SELECT d.student_id,d.milestone_points,d.subscription_id FROM rewards_private.push_deliveries d
  JOIN public.students st ON st.id=d.student_id AND st.is_active=true
  JOIN public.push_subscriptions sub ON sub.id=d.subscription_id
  JOIN public.user_profiles p ON p.id=sub.user_id AND p.role='parent' AND p.is_active=true
   AND pg_catalog.regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')<>''
   AND pg_catalog.regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')=pg_catalog.regexp_replace(coalesce(st.parent_phone,''),'[^0-9]','','g')
  WHERE (d.state='pending' AND d.next_attempt_at<=now()) OR (d.state='sending' AND d.lease_until<now())
  ORDER BY d.next_attempt_at,d.student_id,d.milestone_points LIMIT greatest(1,least(p_limit,100)) FOR UPDATE OF d SKIP LOCKED
 ), claimed AS (
  UPDATE rewards_private.push_deliveries d SET state='sending',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=d.attempts+1
  FROM due WHERE (d.student_id,d.milestone_points,d.subscription_id)=(due.student_id,due.milestone_points,due.subscription_id) RETURNING d.*
 ) SELECT c.student_id,c.milestone_points,c.subscription_id,c.lease_token,r.notification_id,sub.subscription,n.title,n.body
 FROM claimed c JOIN public.student_milestone_rewards r ON (r.student_id,r.milestone_points)=(c.student_id,c.milestone_points)
 JOIN public.notifications n ON n.id=r.notification_id JOIN public.push_subscriptions sub ON sub.id=c.subscription_id;
END $$;
CREATE OR REPLACE FUNCTION public.finish_milestone_push(p_student_id uuid,p_milestone integer,p_subscription uuid,p_lease uuid,p_result text,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_result NOT IN ('sent','retry','expired') THEN RAISE EXCEPTION 'INVALID_RESULT'; END IF;
 UPDATE rewards_private.push_deliveries SET state=CASE WHEN p_result='retry' THEN 'pending' ELSE p_result END,
  sent_at=CASE WHEN p_result='sent' THEN now() ELSE NULL END,
  next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer),
  lease_token=NULL,lease_until=NULL,last_error=left(p_error,200)
 WHERE student_id=p_student_id AND milestone_points=p_milestone AND subscription_id=p_subscription AND lease_token=p_lease AND state='sending';
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.prepare_milestone_push(),public.claim_milestone_push(integer),public.finish_milestone_push(uuid,integer,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_milestone_push(),public.claim_milestone_push(integer),public.finish_milestone_push(uuid,integer,uuid,uuid,text,text) TO service_role;
