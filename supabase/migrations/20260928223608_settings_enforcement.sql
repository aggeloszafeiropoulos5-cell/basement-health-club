-- Enforce every operational setting shown by the Basement control center.
-- External email/SMS delivery remains provider-neutral: messages are queued in
-- outbound_notifications and can be sent when a provider is connected.

alter table public.basement_bookings
  add column if not exists moved_at timestamptz,
  add column if not exists moved_from_slot_id bigint references public.basement_slots(id) on delete set null,
  add column if not exists paid_at timestamptz;

-- PostgREST sees both slot_id and moved_from_slot_id as relationships to
-- basement_slots. Keep both foreign keys for integrity, while making the
-- legacy `basement_slots(...)` embed resolve to the active slot_id.
create or replace function public.basement_slots(b public.basement_bookings)
returns setof public.basement_slots
rows 1
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
  select s.*
  from public.basement_slots as s
  where s.id = b.slot_id
$function$;

revoke all on function public.basement_slots(public.basement_bookings) from public;
grant execute on function public.basement_slots(public.basement_bookings) to authenticated, service_role;

alter table public.outbound_notifications
  add column if not exists template_key text,
  add column if not exists booking_id bigint references public.basement_bookings(id) on delete cascade;

alter table public.basement_bookings drop constraint if exists basement_bookings_status_check;
alter table public.basement_bookings add constraint basement_bookings_status_check
  check(status in('pending','booked','cancelled','late_cancel','completed','no_show'));

drop index if exists public.basement_one_active_booking_per_slot;
create unique index if not exists basement_one_active_booking_per_slot
  on public.basement_bookings(slot_id,member_id) where status in('pending','booked');
create unique index if not exists outbound_notification_once
  on public.outbound_notifications(member_id,booking_id,template_key)
  where booking_id is not null and template_key is not null;
create index if not exists basement_bookings_slot_status_idx on public.basement_bookings(slot_id,status);
create index if not exists basement_bookings_member_status_created_idx on public.basement_bookings(member_id,status,created_at);

create or replace function public.basement_promote_waiting(p_slot_id bigint)
returns bigint language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_wait public.basement_waiting_list%rowtype; v_id bigint; v_capacity integer; v_count integer; v_cfg jsonb:='{}'; v_status text;
begin
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  if not coalesce((v_cfg->>'waitlistEnabled')::boolean,false) then return null; end if;
  select capacity into v_capacity from public.basement_slots where id=p_slot_id for update;
  select count(*) into v_count from public.basement_bookings where slot_id=p_slot_id and status in('pending','booked');
  if v_count>=coalesce(v_capacity,0) then return null; end if;
  select * into v_wait from public.basement_waiting_list
   where slot_id=p_slot_id and status='waiting' order by created_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  v_status:=case when coalesce((v_cfg->>'autoConfirmWaitlist')::boolean,true) then 'booked' else 'pending' end;
  insert into public.basement_bookings(slot_id,member_id,status)
  values(p_slot_id,v_wait.member_id,v_status) returning id into v_id;
  update public.basement_waiting_list set status='promoted' where id=v_wait.id;
  return v_id;
end $$;
revoke all on function public.basement_promote_waiting(bigint) from public,anon,authenticated;

create or replace function public.basement_book(p_slot_id bigint,p_member_id uuid default null::uuid)
returns bigint language plpgsql security definer set search_path='public','pg_temp' as $$
declare
  v_actor uuid:=auth.uid(); v_role text; v_target uuid; v_slot public.basement_slots%rowtype;
  v_cfg jsonb:='{}'; v_is_admin boolean; v_member uuid; v_member_active boolean;
  v_service public.services%rowtype; v_count integer; v_id bigint; v_status text;
  v_package public.member_packages%rowtype; v_template public.package_templates%rowtype;
  v_local_start timestamp; v_now_local timestamp:=now() at time zone 'Europe/Athens';
  v_wait_count integer; v_no_show_count integer; v_limit integer;
begin
  if v_actor is null then raise exception 'Απαιτείται σύνδεση.'; end if;
  select role::text into v_role from public.profiles where id=v_actor and active;
  v_is_admin:=coalesce(v_role,'') in ('owner','admin','reception');
  v_target:=coalesce(p_member_id,v_actor);
  if v_target<>v_actor and not v_is_admin then raise exception 'Δεν επιτρέπεται κράτηση για άλλο μέλος.'; end if;
  if not exists(select 1 from public.profiles where id=v_target and role='customer' and active) then raise exception 'Δεν βρέθηκε ενεργό μέλος.'; end if;
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  if not v_is_admin and coalesce((v_cfg->>'pauseBookings')::boolean,false) then raise exception 'Οι νέες κρατήσεις είναι προσωρινά κλειστές.'; end if;
  if not v_is_admin and not coalesce((v_cfg->>'existingCustomerBooking')::boolean,true) then raise exception 'Οι online κρατήσεις μελών είναι απενεργοποιημένες.'; end if;

  select * into v_slot from public.basement_slots where id=p_slot_id for update;
  if not found or not v_slot.enabled then raise exception 'Η ώρα δεν είναι διαθέσιμη.'; end if;
  v_local_start:=v_slot.starts_at at time zone 'Europe/Athens';
  if v_slot.starts_at<=now() then raise exception 'Η ώρα έχει ήδη ξεκινήσει.'; end if;
  if not v_is_admin and v_slot.starts_at<now()+make_interval(secs=>(coalesce((v_cfg->>'bookingMinHours')::numeric,0)*3600)::integer) then raise exception 'Η κράτηση πρέπει να γίνει νωρίτερα σύμφωνα με την πολιτική κρατήσεων.'; end if;
  if not v_is_admin and v_slot.starts_at>now()+make_interval(days=>coalesce((v_cfg->>'bookingMaxDays')::integer,14)) then raise exception 'Η ημερομηνία είναι έξω από το επιτρεπόμενο διάστημα κρατήσεων.'; end if;
  if nullif(v_cfg->>'maxAvailableDate','') is not null and v_local_start::date>(v_cfg->>'maxAvailableDate')::date then raise exception 'Η ημερομηνία δεν είναι διαθέσιμη.'; end if;
  if not v_is_admin and v_local_start::date=v_now_local::date+1 and v_now_local::time>coalesce(nullif(v_cfg->>'previousDayDeadline','')::time,'23:59') then raise exception 'Έληξε η προθεσμία κράτησης για την επόμενη ημέρα.'; end if;
  if v_local_start::time<coalesce(nullif(v_cfg->>'openingTime','')::time,'00:00') or v_local_start::time>coalesce(nullif(v_cfg->>'closingTime','')::time,'23:59') then raise exception 'Η ώρα είναι εκτός ωραρίου λειτουργίας.'; end if;

  select * into v_service from public.services where lower(name)=lower(v_slot.service) limit 1;
  if found and not v_is_admin and (not v_service.active or not v_service.online_booking_enabled) then raise exception 'Η υπηρεσία δεν δέχεται online κρατήσεις.'; end if;
  if coalesce((v_cfg->>'holidayRestrictions')::boolean,true) and exists(
    select 1 from public.closures c where c.closure_date=v_local_start::date
      and (c.service_id is null or c.service_id=v_service.id)
      and (c.starts_at is null or v_local_start::time>=c.starts_at)
      and (c.ends_at is null or v_local_start::time<c.ends_at)
  ) then raise exception 'Η επιλεγμένη ώρα είναι κλειστή λόγω αργίας ή ειδικού ωραρίου.'; end if;

  select id,active into v_member,v_member_active from public.members where auth_user_id=v_target;
  if v_member is null then raise exception 'Δεν βρέθηκε καρτέλα μέλους.'; end if;
  if not v_is_admin and coalesce((v_cfg->>'activeCustomersOnly')::boolean,true) and not coalesce(v_member_active,false) then raise exception 'Απαιτείται ενεργό μέλος.'; end if;
  if exists(select 1 from public.basement_bookings where slot_id=p_slot_id and member_id=v_target and status in('pending','booked')) then raise exception 'Το μέλος έχει ήδη κράτηση σε αυτή την ώρα.'; end if;
  if not coalesce((v_cfg->>'allowDoubleBooking')::boolean,false) or not coalesce((v_cfg->>'overlapAvailability')::boolean,true) then
    if exists(select 1 from public.basement_bookings b join public.basement_slots s on s.id=b.slot_id
      where b.member_id=v_target and b.status in('pending','booked') and s.starts_at<v_slot.ends_at and s.ends_at>v_slot.starts_at) then
      raise exception 'Υπάρχει ήδη κράτηση που επικαλύπτει αυτή την ώρα.';
    end if;
  end if;

  v_limit:=coalesce((v_cfg->>'noShowLimit')::integer,0);
  if not v_is_admin and v_limit>0 then
    select count(*) into v_no_show_count from public.basement_bookings where member_id=v_target and status='no_show';
    if v_no_show_count>=v_limit then raise exception 'Το όριο απουσιών έχει συμπληρωθεί. Επικοινώνησε με το γυμναστήριο.'; end if;
  end if;

  select mp.* into v_package from public.member_packages mp
   where mp.member_id=v_member and mp.status='active' and mp.starts_on<=v_local_start::date
     and (not coalesce((v_cfg->>'blockAfterExpiry')::boolean,true) or mp.expires_on+coalesce((v_cfg->>'maxAutoExtendDays')::integer,0)>=v_local_start::date)
     and (mp.frozen_until is null or mp.frozen_until<v_local_start::date)
     and (mp.sessions_remaining is null or mp.sessions_remaining>0)
   order by mp.expires_on,mp.created_at limit 1;
  if not v_is_admin and coalesce((v_cfg->>'creditsRequired')::boolean,true) and v_package.id is null then
    select count(*) into v_count from public.basement_bookings where member_id=v_target and status in('pending','booked') and created_at>=date_trunc('month',now());
    if v_count>=coalesce((v_cfg->>'bookingsWithoutCredits')::integer,0) then raise exception 'Δεν υπάρχουν διαθέσιμες συνεδρίες ή ενεργό πακέτο.'; end if;
  end if;
  if v_package.id is not null then
    select * into v_template from public.package_templates where id=v_package.package_template_id;
    if not v_is_admin or not coalesce((v_cfg->>'adminExceedsLimits')::boolean,true) then
      if coalesce(v_template.max_bookings_day,0)>0 and (select count(*) from public.basement_bookings b join public.basement_slots s on s.id=b.slot_id where b.member_id=v_target and b.status in('pending','booked') and (s.starts_at at time zone 'Europe/Athens')::date=v_local_start::date)>=v_template.max_bookings_day then raise exception 'Συμπληρώθηκε το ημερήσιο όριο κρατήσεων.'; end if;
      if coalesce(v_template.max_bookings_week,0)>0 and (select count(*) from public.basement_bookings b join public.basement_slots s on s.id=b.slot_id where b.member_id=v_target and b.status in('pending','booked') and date_trunc('week',s.starts_at at time zone 'Europe/Athens')=date_trunc('week',v_local_start))>=v_template.max_bookings_week then raise exception 'Συμπληρώθηκε το εβδομαδιαίο όριο κρατήσεων.'; end if;
    end if;
  end if;
  v_limit:=coalesce((v_cfg->>'maxBookingsPerPeriod')::integer,0);
  if not v_is_admin and v_limit>0 and (select count(*) from public.basement_bookings b join public.basement_slots s on s.id=b.slot_id where b.member_id=v_target and b.status in('pending','booked') and date_trunc('week',s.starts_at at time zone 'Europe/Athens')=date_trunc('week',v_local_start))>=v_limit then raise exception 'Συμπληρώθηκε το εβδομαδιαίο όριο κρατήσεων.'; end if;

  select count(*) into v_count from public.basement_bookings where slot_id=p_slot_id and status in('pending','booked');
  if v_count>=v_slot.capacity or (not coalesce((v_cfg->>'autoConfirm')::boolean,true) and coalesce((v_cfg->>'unconfirmedToWaitlist')::boolean,false)) then
    if not coalesce((v_cfg->>'waitlistEnabled')::boolean,false) or (v_service.id is not null and not v_service.waiting_list_enabled) then raise exception 'Οι θέσεις εξαντλήθηκαν.'; end if;
    select count(*) into v_wait_count from public.basement_waiting_list where member_id=v_target and status='waiting';
    if v_wait_count>=coalesce((v_cfg->>'waitlistLimit')::integer,2) then raise exception 'Συμπληρώθηκε το όριο λίστας αναμονής.'; end if;
    insert into public.basement_waiting_list(slot_id,member_id,status) values(p_slot_id,v_target,'waiting')
      on conflict(slot_id,member_id,status) do update set created_at=excluded.created_at returning id into v_id;
    return -v_id;
  end if;
  v_status:=case when coalesce((v_cfg->>'autoConfirm')::boolean,true) or (coalesce((v_cfg->>'autoConfirmExisting')::boolean,false) and v_package.id is not null) then 'booked' else 'pending' end;
  insert into public.basement_bookings(slot_id,member_id,status) values(p_slot_id,v_target,v_status) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.basement_book(bigint,uuid) from public,anon;
grant execute on function public.basement_book(bigint,uuid) to authenticated;

create or replace function public.basement_cancel(p_booking_id bigint)
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_booking public.basement_bookings%rowtype; v_start timestamptz; v_role text; v_cfg jsonb:='{}'; v_is_admin boolean; v_late boolean; v_count integer; v_member uuid; v_package uuid;
begin
  if auth.uid() is null then raise exception 'Απαιτείται σύνδεση.'; end if;
  select role::text into v_role from public.profiles where id=auth.uid(); v_is_admin:=coalesce(v_role,'') in ('owner','admin','reception');
  select * into v_booking from public.basement_bookings where id=p_booking_id for update;
  if not found or v_booking.status not in('pending','booked') then raise exception 'Η κράτηση δεν βρέθηκε.'; end if;
  if v_booking.member_id<>auth.uid() and not v_is_admin then raise exception 'Δεν επιτρέπεται η ακύρωση.'; end if;
  select starts_at into v_start from public.basement_slots where id=v_booking.slot_id;
  if v_start<=now() and not v_is_admin then raise exception 'Η προπόνηση έχει ήδη ξεκινήσει.'; end if;
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  v_late:=v_start<now()+make_interval(mins=>coalesce((v_cfg->>'cancelMinMinutes')::integer,0));
  if v_late and not v_is_admin then
    select count(*) into v_count from public.basement_bookings where member_id=v_booking.member_id and status='late_cancel' and cancelled_at>=date_trunc('month',now());
    if coalesce((v_cfg->>'lateCancelAllowedCount')::integer,0)<=v_count then raise exception 'Έληξε η προθεσμία ακύρωσης.'; end if;
  end if;
  update public.basement_bookings set status=case when v_late then 'late_cancel' else 'cancelled' end,cancelled_at=now() where id=p_booking_id;
  if v_late and coalesce((v_cfg->>'lateCancelNoCredit')::boolean,false) then
    select id into v_member from public.members where auth_user_id=v_booking.member_id;
    select count(*) into v_count from public.basement_bookings where member_id=v_booking.member_id and status in('late_cancel','no_show');
    if v_count>coalesce((v_cfg->>'freeAbsences')::integer,0) and not exists(select 1 from public.basement_session_usage where booking_id=p_booking_id) then
      select id into v_package from public.member_packages where member_id=v_member and status='active' and coalesce(sessions_remaining,0)>0 order by expires_on limit 1 for update;
      if v_package is not null then update public.member_packages set sessions_remaining=sessions_remaining-1 where id=v_package; insert into public.basement_session_usage(booking_id,member_package_id,change) values(p_booking_id,v_package,-1); end if;
    end if;
  end if;
  perform public.basement_promote_waiting(v_booking.slot_id);
end $$;
revoke all on function public.basement_cancel(bigint) from public,anon;
grant execute on function public.basement_cancel(bigint) to authenticated;

create or replace function public.basement_move_booking(p_booking_id bigint,p_new_slot_id bigint)
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_booking public.basement_bookings%rowtype; v_old public.basement_slots%rowtype; v_new public.basement_slots%rowtype; v_cfg jsonb:='{}'; v_role text; v_admin boolean; v_count integer; v_new_status text;
begin
  if auth.uid() is null then raise exception 'Απαιτείται σύνδεση.'; end if;
  select role::text into v_role from public.profiles where id=auth.uid(); v_admin:=coalesce(v_role,'') in('owner','admin','reception');
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  if not v_admin and coalesce((v_cfg->>'disableCustomerMove')::boolean,false) then raise exception 'Η μεταφορά από μέλη είναι απενεργοποιημένη.'; end if;
  select * into v_booking from public.basement_bookings where id=p_booking_id for update;
  if not found or v_booking.status not in('pending','booked') then raise exception 'Η κράτηση δεν είναι ενεργή.'; end if;
  if v_booking.member_id<>auth.uid() and not v_admin then raise exception 'Δεν επιτρέπεται η μεταφορά.'; end if;
  select * into v_old from public.basement_slots where id=v_booking.slot_id;
  select * into v_new from public.basement_slots where id=p_new_slot_id for update;
  if not found or not v_new.enabled then raise exception 'Η νέα ώρα δεν είναι διαθέσιμη.'; end if;
  if v_new.starts_at<=now() and not (v_admin and coalesce((v_cfg->>'moveToPastAdmin')::boolean,false)) then raise exception 'Δεν επιτρέπεται μεταφορά στο παρελθόν.'; end if;
  if not v_admin and v_old.starts_at<now()+make_interval(secs=>(coalesce((v_cfg->>'moveMinHours')::numeric,0)*3600)::integer) then raise exception 'Έληξε η προθεσμία μεταφοράς.'; end if;
  if not coalesce((v_cfg->>'changeServiceOnMove')::boolean,false) and v_new.service<>v_old.service then raise exception 'Δεν επιτρέπεται αλλαγή υπηρεσίας στη μεταφορά.'; end if;
  select count(*) into v_count from public.basement_bookings where slot_id=p_new_slot_id and status in('pending','booked');
  if v_count>=v_new.capacity then raise exception 'Η νέα ώρα είναι πλήρης.'; end if;
  if exists(select 1 from public.basement_bookings where slot_id=p_new_slot_id and member_id=v_booking.member_id and status in('pending','booked') and id<>p_booking_id) then raise exception 'Υπάρχει ήδη κράτηση στη νέα ώρα.'; end if;
  v_new_status:=case when coalesce((v_cfg->>'keepStatusOnMove')::boolean,true) then v_booking.status else 'booked' end;
  update public.basement_bookings set slot_id=p_new_slot_id,status=v_new_status,moved_at=now(),moved_from_slot_id=v_booking.slot_id where id=p_booking_id;
  perform public.basement_promote_waiting(v_booking.slot_id);
end $$;
revoke all on function public.basement_move_booking(bigint,bigint) from public,anon;
grant execute on function public.basement_move_booking(bigint,bigint) to authenticated;

create or replace function public.basement_admin_booking_action(p_booking_id bigint,p_action text)
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_role text; v_booking public.basement_bookings%rowtype; v_member uuid; v_package uuid; v_used integer; v_cfg jsonb:='{}'; v_absences integer;
begin
  select role::text into v_role from public.profiles where id=auth.uid();
  if coalesce(v_role,'') not in('owner','admin','reception') then raise exception 'Δεν επιτρέπεται αυτή η ενέργεια.'; end if;
  select * into v_booking from public.basement_bookings where id=p_booking_id for update;
  if not found then raise exception 'Η κράτηση δεν βρέθηκε.'; end if;
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  select id into v_member from public.members where auth_user_id=v_booking.member_id;
  if p_action in('complete','no_show') then
    update public.basement_bookings set status=case when p_action='complete' then 'completed' else 'no_show' end,
      completed_at=now(),checked_in_at=case when p_action='complete' then coalesce(checked_in_at,now()) else checked_in_at end where id=p_booking_id;
    if p_action='complete' and v_member is not null and coalesce((v_cfg->>'checkIn')::boolean,true) then
      insert into public.gym_checkins(member_id,booking_id,method,notes) values(v_member,p_booking_id,'automatic','Ολοκλήρωση ραντεβού') on conflict do nothing;
    end if;
    select count(*) into v_absences from public.basement_bookings where member_id=v_booking.member_id and status='no_show';
    if v_member is not null and (p_action='complete' or v_absences>coalesce((v_cfg->>'freeAbsences')::integer,0)) and not exists(select 1 from public.basement_session_usage where booking_id=p_booking_id) then
      select id into v_package from public.member_packages where member_id=v_member and status='active' and starts_on<=current_date and expires_on>=current_date and (frozen_until is null or frozen_until<current_date) and (sessions_remaining is null or sessions_remaining>0) order by expires_on,id limit 1 for update;
      if v_package is not null then
        update public.member_packages set sessions_remaining=case when sessions_remaining is null then null else sessions_remaining-1 end where id=v_package;
        insert into public.basement_session_usage(booking_id,member_package_id,change) values(p_booking_id,v_package,-1);
      end if;
    end if;
  elsif p_action='confirm' then update public.basement_bookings set status='booked' where id=p_booking_id and status='pending';
  elsif p_action='pending' then update public.basement_bookings set status='pending' where id=p_booking_id and status='booked';
  elsif p_action='paid' then update public.basement_bookings set payment_status='paid',paid_at=now() where id=p_booking_id;
  elsif p_action='unpaid' then update public.basement_bookings set payment_status='unpaid',paid_at=null where id=p_booking_id;
  elsif p_action='undo' then
    select coalesce(sum(change),0),min(member_package_id) into v_used,v_package from public.basement_session_usage where booking_id=p_booking_id;
    if v_package is not null and v_used<0 then update public.member_packages set sessions_remaining=case when sessions_remaining is null then null else sessions_remaining-v_used end where id=v_package; end if;
    delete from public.basement_session_usage where booking_id=p_booking_id;
    delete from public.gym_checkins where booking_id=p_booking_id;
    update public.basement_bookings set status='booked',completed_at=null,checked_in_at=null,cancelled_at=null where id=p_booking_id;
  else raise exception 'Άγνωστη ενέργεια.'; end if;
end $$;
revoke all on function public.basement_admin_booking_action(bigint,text) from public,anon;
grant execute on function public.basement_admin_booking_action(bigint,text) to authenticated;

-- Runs safely from pg_cron every five minutes. The existing
-- basement-auto-finalize job already calls this function.
create or replace function public.basement_finalize_finished_appointments()
returns integer language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_cfg jsonb:='{}'; v_booking record; v_member uuid; v_package uuid; v_done integer:=0;
begin
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  if not coalesce((v_cfg->>'autoComplete')::boolean,false) then return 0; end if;
  for v_booking in
    select b.id,b.member_id,s.ends_at from public.basement_bookings b
    join public.basement_slots s on s.id=b.slot_id
    where b.status='booked' and s.ends_at<=now()
      and s.ends_at>=coalesce((v_cfg->>'autoCheckinStartedAt')::timestamptz,'2026-09-01'::timestamptz)
    order by s.ends_at,b.id for update of b skip locked
  loop
    select id into v_member from public.members where auth_user_id=v_booking.member_id;
    if v_member is not null and coalesce((v_cfg->>'checkIn')::boolean,true) then
      insert into public.gym_checkins(member_id,booking_id,checked_in_at,method,notes)
      values(v_member,v_booking.id,v_booking.ends_at,'automatic','Αυτόματο check-in μετά την ολοκλήρωση') on conflict do nothing;
    end if;
    if v_member is not null and not exists(select 1 from public.basement_session_usage where booking_id=v_booking.id) then
      select id into v_package from public.member_packages
      where member_id=v_member and status='active' and starts_on<=current_date
        and expires_on+coalesce((v_cfg->>'maxAutoExtendDays')::integer,0)>=current_date
        and (frozen_until is null or frozen_until<current_date)
        and (sessions_remaining is null or sessions_remaining>0)
      order by expires_on,id limit 1 for update;
      if v_package is not null then
        update public.member_packages set sessions_remaining=case when sessions_remaining is null then null else greatest(0,sessions_remaining-1) end where id=v_package;
        insert into public.basement_session_usage(booking_id,member_package_id,change) values(v_booking.id,v_package,-1);
      end if;
    end if;
    update public.basement_bookings set status='completed',checked_in_at=case when coalesce((v_cfg->>'checkIn')::boolean,true) then coalesce(checked_in_at,v_booking.ends_at) else checked_in_at end,completed_at=now() where id=v_booking.id;
    v_done:=v_done+1;
  end loop;
  return v_done;
end $$;
revoke all on function public.basement_finalize_finished_appointments() from public,anon,authenticated;

create or replace function public.basement_auto_complete_due()
returns integer language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_role text;
begin
  select role::text into v_role from public.profiles where id=auth.uid() and active;
  if coalesce(v_role,'') not in('owner','admin','reception') then raise exception 'Δεν επιτρέπεται αυτή η ενέργεια.'; end if;
  return public.basement_finalize_finished_appointments();
end $$;
revoke all on function public.basement_auto_complete_due() from public,anon;
grant execute on function public.basement_auto_complete_due() to authenticated;

create or replace function public.basement_availability()
returns table(id bigint,service text,starts_at timestamptz,ends_at timestamptz,capacity integer,enabled boolean,reserved bigint)
language sql security definer set search_path='public','pg_temp' as $$
  with cfg as(select coalesce(value,'{}') v from public.app_settings where key='control_center_settings')
  select s.id,s.service,s.starts_at,
    case when (select v->>'slotDurationMode' from cfg) ~ '^[0-9]+' then s.starts_at+make_interval(mins=>substring((select v->>'slotDurationMode' from cfg) from '^[0-9]+')::integer) else s.ends_at end,
    s.capacity,
    s.enabled and not(coalesce(((select v->>'holidayRestrictions' from cfg))::boolean,true) and exists(
      select 1 from public.closures c left join public.services sv on sv.id=c.service_id
       where c.closure_date=(s.starts_at at time zone 'Europe/Athens')::date and (c.service_id is null or lower(sv.name)=lower(s.service))
         and (c.starts_at is null or (s.starts_at at time zone 'Europe/Athens')::time>=c.starts_at)
         and (c.ends_at is null or (s.starts_at at time zone 'Europe/Athens')::time<c.ends_at))),
    (select count(*) from public.basement_bookings b where b.slot_id=s.id and b.status in('pending','booked'))
  from public.basement_slots s left join public.services sv on lower(sv.name)=lower(s.service)
  where auth.uid() is not null
    and s.starts_at>=case when public.is_staff() then (now()-make_interval(days=>coalesce(((select v->>'adminVisibilityDays' from cfg))::integer,730))) else now() end
    and s.starts_at<case when nullif((select v->>'maxAvailableDate' from cfg),'') is not null then (((select v->>'maxAvailableDate' from cfg))::date+1)::timestamp at time zone 'Europe/Athens' else now()+make_interval(days=>coalesce(((select v->>'bookingMaxDays' from cfg))::integer,14)) end
    and (s.starts_at at time zone 'Europe/Athens')::time>=coalesce(nullif((select v->>'openingTime' from cfg),'')::time,'00:00')
    and (s.starts_at at time zone 'Europe/Athens')::time<=coalesce(nullif((select v->>'closingTime' from cfg),'')::time,'23:59')
    and (public.is_staff() or sv.id is null or (sv.active and sv.online_booking_enabled))
  order by s.starts_at,s.service;
$$;
revoke all on function public.basement_availability() from public,anon;
grant execute on function public.basement_availability() to authenticated;

create or replace function public.basement_sync_service_slots()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
begin
  update public.basement_slots set capacity=new.default_capacity,
    ends_at=starts_at+make_interval(mins=>new.duration_minutes),
    enabled=case when new.active then enabled else false end
  where lower(service)=lower(new.name) and starts_at>now();
  return new;
end $$;
revoke all on function public.basement_sync_service_slots() from public,anon,authenticated;
drop trigger if exists sync_service_slots on public.services;
create trigger sync_service_slots after update of duration_minutes,default_capacity,active on public.services
for each row execute function public.basement_sync_service_slots();

create or replace function public.basement_queue_booking_notifications()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_cfg jsonb:='{}'; v_member uuid; v_start timestamptz; v_service text; v_hours numeric;
begin
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  if not coalesce((v_cfg->>'remindersEnabled')::boolean,true) then return new; end if;
  select id into v_member from public.members where auth_user_id=new.member_id;
  select starts_at,service into v_start,v_service from public.basement_slots where id=new.slot_id;
  if v_member is null then return new; end if;
  if tg_op='INSERT' then
    insert into public.outbound_notifications(member_id,channel,title,body,status,scheduled_at,template_key,booking_id)
    values(v_member,'email','Επιβεβαίωση κράτησης','Η κράτησή σου για '||v_service||' καταχωρίστηκε.','queued',now(),'booking_confirmation',new.id) on conflict do nothing;
    v_hours:=coalesce((v_cfg->>'reminderHours')::numeric,3.5);
    insert into public.outbound_notifications(member_id,channel,title,body,status,scheduled_at,template_key,booking_id)
    values(v_member,'email','Υπενθύμιση ραντεβού','Υπενθύμιση για το ραντεβού σου: '||v_service||'.','queued',greatest(now(),v_start-make_interval(secs=>(v_hours*3600)::integer)),'booking_reminder',new.id) on conflict do nothing;
  elsif old.status is distinct from new.status and new.status in('cancelled','late_cancel','no_show') then
    insert into public.outbound_notifications(member_id,channel,title,body,status,scheduled_at,template_key,booking_id)
    values(v_member,'email','Ενημέρωση ραντεβού','Η κατάσταση του ραντεβού σου άλλαξε σε '||new.status||'.','queued',now(),'booking_'||new.status,new.id) on conflict do nothing;
  elsif new.moved_at is distinct from old.moved_at and new.moved_at is not null then
    insert into public.outbound_notifications(member_id,channel,title,body,status,scheduled_at,template_key,booking_id)
    values(v_member,'email','Μεταφορά ραντεβού','Το ραντεβού σου μεταφέρθηκε.','queued',now(),'booking_moved',new.id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.basement_queue_booking_notifications() from public,anon,authenticated;
drop trigger if exists queue_booking_notifications on public.basement_bookings;
create trigger queue_booking_notifications after insert or update on public.basement_bookings
for each row execute function public.basement_queue_booking_notifications();

-- Public SECURITY DEFINER helpers are internal-only unless explicitly granted above.
revoke execute on function public.is_staff() from public,anon;
revoke execute on function public.handle_new_user() from public,anon,authenticated;
revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
