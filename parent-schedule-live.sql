begin;

-- =========================================================
-- 1) هل ولي الأمر الحالي مسموح له بالاستماع لمجموعة معينة؟
--    لا يغير أي Policy أو Function موجودة حاليا.
-- =========================================================

create or replace function public.parent_can_receive_schedule_topic(
  p_topic text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles up
    join public.students s
      on regexp_replace(coalesce(s.parent_phone, ''), '[^0-9]', '', 'g')
       = regexp_replace(coalesce(up.phone, ''), '[^0-9]', '', 'g')
    where up.id = auth.uid()
      and up.is_active = true
      and up.role = 'parent'
      and s.is_active = true
      and p_topic = ('parent-schedule:' || s.group_id::text)
  );
$$;

revoke all
on function public.parent_can_receive_schedule_topic(text)
from public;

grant execute
on function public.parent_can_receive_schedule_topic(text)
to authenticated;


-- =========================================================
-- 2) RPC ترجع جدول ابن واحد فقط بعد التأكد أنه تابع
--    لولي الأمر المسجل حاليا.
-- =========================================================

create or replace function public.get_parent_child_schedule(
  p_child_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  schedule_result jsonb;
begin

  select jsonb_build_object(
    'child_id', s.id,
    'group_id', s.group_id,
    'group_name', g.name,
    'schedules',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', gs.id,
              'day_name', gs.day_name,
              'start_time', gs.start_time
            )
            order by gs.day_name, gs.start_time
          )
          from public.group_schedules gs
          where gs.group_id = s.group_id
            and gs.is_active = true
        ),
        '[]'::jsonb
      )
  )
  into schedule_result
  from public.students s
  join public.user_profiles up
    on up.id = auth.uid()
  left join public.groups g
    on g.id = s.group_id
  where s.id = p_child_id
    and s.is_active = true
    and up.is_active = true
    and up.role = 'parent'
    and regexp_replace(coalesce(s.parent_phone, ''), '[^0-9]', '', 'g')
      = regexp_replace(coalesce(up.phone, ''), '[^0-9]', '', 'g')
  limit 1;

  if schedule_result is null then
    raise exception 'Not authorized for this child'
      using errcode = '42501';
  end if;

  return schedule_result;
end;
$$;

revoke all
on function public.get_parent_child_schedule(uuid)
from public;

grant execute
on function public.get_parent_child_schedule(uuid)
to authenticated;


-- =========================================================
-- 3) إشعار Realtime صغير فقط عند تغير الجدول.
--    لا يرسل بيانات الحصة نفسها.
-- =========================================================

create or replace function public.notify_parent_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
begin

  if tg_op = 'INSERT' then

    perform realtime.send(
      jsonb_build_object('changed', true),
      'schedule_changed',
      'parent-schedule:' || new.group_id::text,
      true
    );

  elsif tg_op = 'DELETE' then

    perform realtime.send(
      jsonb_build_object('changed', true),
      'schedule_changed',
      'parent-schedule:' || old.group_id::text,
      true
    );

  elsif tg_op = 'UPDATE' then

    if old.group_id is distinct from new.group_id then

      perform realtime.send(
        jsonb_build_object('changed', true),
        'schedule_changed',
        'parent-schedule:' || old.group_id::text,
        true
      );

      perform realtime.send(
        jsonb_build_object('changed', true),
        'schedule_changed',
        'parent-schedule:' || new.group_id::text,
        true
      );

    else

      perform realtime.send(
        jsonb_build_object('changed', true),
        'schedule_changed',
        'parent-schedule:' || new.group_id::text,
        true
      );

    end if;

  end if;

  return null;
end;
$$;


-- =========================================================
-- 4) Trigger جديد مستقل.
-- =========================================================

create trigger parent_schedule_live_notify
after insert or update or delete
on public.group_schedules
for each row
execute function public.notify_parent_schedule_change();


-- =========================================================
-- 5) ولي الأمر يستقبل Broadcast لمجموعات أبنائه فقط.
--    لا نعدل أي Policy موجودة.
-- =========================================================

create policy "parent_receive_own_schedule_broadcast"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.parent_can_receive_schedule_topic(
    (select realtime.topic())
  )
);

commit;


-- =========================================================
-- ROLLBACK - لا يتم تشغيله الآن
-- =========================================================
--
-- drop policy if exists
--   "parent_receive_own_schedule_broadcast"
--   on realtime.messages;
--
-- drop trigger if exists
--   parent_schedule_live_notify
--   on public.group_schedules;
--
-- drop function if exists
--   public.notify_parent_schedule_change();
--
-- drop function if exists
--   public.get_parent_child_schedule(uuid);
--
-- drop function if exists
--   public.parent_can_receive_schedule_topic(text);