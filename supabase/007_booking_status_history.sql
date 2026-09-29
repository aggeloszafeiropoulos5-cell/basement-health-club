-- Keep appointment history visible and make check-in idempotent.
create or replace function public.basement_admin_booking_action(p_booking_id bigint,p_action text)
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_role text; v_booking public.basement_bookings%rowtype; v_member uuid; v_package uuid; v_used integer;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if coalesce(v_role,'') not in ('owner','admin','reception') then raise exception 'Δεν επιτρέπεται αυτή η ενέργεια.'; end if;
  select * into v_booking from public.basement_bookings where id=p_booking_id for update;
  if not found then raise exception 'Η κράτηση δεν βρέθηκε.'; end if;
  select id into v_member from public.members where auth_user_id=v_booking.member_id;

  if p_action in ('complete','no_show') then
    update public.basement_bookings
       set status=case when p_action='complete' then 'completed' else 'no_show' end,
           completed_at=now(),
           checked_in_at=case when p_action='complete' then coalesce(checked_in_at,now()) else checked_in_at end
     where id=p_booking_id;
    if p_action='complete' and v_member is not null then
      insert into public.gym_checkins(member_id,booking_id,method,notes)
      values(v_member,p_booking_id,'automatic','Ολοκλήρωση από διαχειριστή')
      on conflict do nothing;
    end if;
    if v_member is not null and not exists(select 1 from public.basement_session_usage where booking_id=p_booking_id) then
      select id into v_package from public.member_packages
       where member_id=v_member and status='active' and starts_on<=current_date and expires_on>=current_date
         and (frozen_until is null or frozen_until<current_date) and coalesce(sessions_remaining,0)>0
       order by expires_on,id limit 1 for update;
      if v_package is not null then
        update public.member_packages set sessions_remaining=sessions_remaining-1 where id=v_package;
        insert into public.basement_session_usage(booking_id,member_package_id,change) values(p_booking_id,v_package,-1);
      end if;
    end if;
  elsif p_action='undo' then
    select coalesce(sum(change),0),min(member_package_id) into v_used,v_package
      from public.basement_session_usage where booking_id=p_booking_id;
    if v_package is not null and v_used<0 then
      update public.member_packages set sessions_remaining=sessions_remaining-v_used where id=v_package;
    end if;
    delete from public.basement_session_usage where booking_id=p_booking_id;
    delete from public.gym_checkins where booking_id=p_booking_id;
    update public.basement_bookings set status='booked',completed_at=null,checked_in_at=null,cancelled_at=null where id=p_booking_id;
  else
    raise exception 'Άγνωστη ενέργεια.';
  end if;
end $$;

revoke all on function public.basement_admin_booking_action(bigint,text) from public;
grant execute on function public.basement_admin_booking_action(bigint,text) to authenticated;
revoke execute on function public.basement_admin_booking_action(bigint,text) from anon;

-- Called by the owner calendar refresh. Past confirmed appointments are completed
-- only when the corresponding Bookup-style setting is enabled.
create or replace function public.basement_auto_complete_due()
returns integer language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_role text; v_enabled boolean; v_booking record; v_count integer:=0;
begin
  select role into v_role from public.profiles where id=auth.uid();
  if coalesce(v_role,'') not in ('owner','admin','reception') then raise exception 'Δεν επιτρέπεται αυτή η ενέργεια.'; end if;
  select coalesce((value->>'autoComplete')::boolean,false) into v_enabled
    from public.app_settings where key='control_center_settings';
  if not coalesce(v_enabled,false) then return 0; end if;
  for v_booking in
    select b.id from public.basement_bookings b
    join public.basement_slots s on s.id=b.slot_id
    where b.status='booked' and s.ends_at<=now()
    order by s.ends_at,b.id
  loop
    perform public.basement_admin_booking_action(v_booking.id,'complete');
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

revoke all on function public.basement_auto_complete_due() from public;
grant execute on function public.basement_auto_complete_due() to authenticated;
revoke execute on function public.basement_auto_complete_due() from anon;

-- Staff retain today's completed/cancelled/no-show appointments in the calendar.
create or replace function public.basement_availability()
returns table(id bigint,service text,starts_at timestamptz,ends_at timestamptz,capacity integer,enabled boolean,reserved bigint)
language sql security definer set search_path to 'public','pg_temp' as $$
  with cfg as (
    select coalesce((value->>'bookingMaxDays')::integer,14) days,
           nullif(value->>'maxAvailableDate','')::date max_date,
           coalesce(nullif(value->>'openingTime','')::time,'00:00') opening_time,
           coalesce(nullif(value->>'closingTime','')::time,'23:59') closing_time
      from public.app_settings where key='control_center_settings'
  )
  select s.id,s.service,s.starts_at,s.ends_at,s.capacity,s.enabled,
    (select count(*) from public.basement_bookings b where b.slot_id=s.id and b.status='booked')
  from public.basement_slots s
  where auth.uid() is not null
    and s.starts_at>=case when public.is_staff()
      then date_trunc('day',now() at time zone 'Europe/Athens') at time zone 'Europe/Athens'
      else now() end
    and s.starts_at<case when (select max_date from cfg) is not null
      then ((select max_date from cfg)+1)::timestamp at time zone 'Europe/Athens'
      else now()+make_interval(days=>coalesce((select days from cfg),14)) end
    and (s.starts_at at time zone 'Europe/Athens')::time>=(select opening_time from cfg)
    and (s.starts_at at time zone 'Europe/Athens')::time<=(select closing_time from cfg)
  order by s.starts_at,s.service;
$$;

revoke execute on function public.basement_availability() from public,anon;
grant execute on function public.basement_availability() to authenticated;
