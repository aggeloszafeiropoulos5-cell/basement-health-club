-- One held credit per booking. Existing history remains on the legacy policy;
-- eligible future bookings are converted individually at the end of this migration.
create schema if not exists basement_private;
revoke all on schema basement_private from public, anon, authenticated;
alter table public.basement_bookings add column if not exists credit_policy text not null default 'legacy';
alter table public.basement_bookings alter column credit_policy set default 'booking';
alter table public.basement_session_usage add column if not exists charged_at timestamptz not null default now();
alter table public.basement_session_usage add column if not exists refunded_at timestamptz;
alter table public.members add column if not exists next_payment_on date;

create or replace function basement_private.charge_booking(p_booking_id bigint, p_strict boolean default true)
returns boolean language plpgsql security definer set search_path='' as $$
declare b public.basement_bookings%rowtype; s public.basement_slots%rowtype;
  u public.basement_session_usage%rowtype; mp public.member_packages%rowtype;
  v_member uuid; v_day date; v_cfg jsonb; v_change integer;
begin
  select * into b from public.basement_bookings where id=p_booking_id for update;
  if not found then raise exception 'Η κράτηση δεν βρέθηκε.'; end if;
  select * into s from public.basement_slots where id=b.slot_id;
  v_day := (s.starts_at at time zone 'Europe/Athens')::date;
  select id into v_member from public.members where auth_user_id=b.member_id and active for update;
  select * into u from public.basement_session_usage where booking_id=b.id for update;
  -- Completion, no-show, confirmation and repeated calls never charge a held credit again.
  if found and u.refunded_at is null then return true; end if;
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  select p.* into mp from public.member_packages p
  where p.member_id=v_member and (auth.uid() is null or public.is_staff() or exists(select 1 from public.package_templates pt where pt.id=p.package_template_id and pt.online_booking_enabled)) and p.status::text in ('active','scheduled') and p.starts_on<=v_day
    and (not coalesce((v_cfg->>'blockAfterExpiry')::boolean,true)
      or p.expires_on+coalesce((v_cfg->>'maxAutoExtendDays')::integer,0)>=v_day)
    and (p.frozen_until is null or p.frozen_until<v_day)
    and (p.sessions_remaining is null or p.sessions_remaining>0)
    and (not exists(select 1 from public.package_template_services pts where pts.package_template_id=p.package_template_id)
      or exists(select 1 from public.package_template_services pts join public.services sv on sv.id=pts.service_id
        where pts.package_template_id=p.package_template_id and lower(sv.name)=lower(s.service)))
  order by p.expires_on,p.created_at,p.id limit 1 for update;
  if not found then
    if p_strict then raise exception using errcode='PBC01', message='Χρειάζεται διαθέσιμη συνεδρία σε πακέτο που καλύπτει την υπηρεσία και την ημερομηνία.'; end if;
    return false;
  end if;
  v_change:=case when mp.sessions_remaining is null then 0 else -1 end;
  update public.member_packages set sessions_remaining=sessions_remaining+v_change where id=mp.id;
  insert into public.basement_session_usage(booking_id,member_package_id,change,charged_at,refunded_at)
  values(b.id,mp.id,v_change,now(),null)
  on conflict(booking_id) do update set member_package_id=excluded.member_package_id,
    change=excluded.change,charged_at=excluded.charged_at,refunded_at=null;
  return true;
end $$;
revoke all on function basement_private.charge_booking(bigint,boolean) from public,anon,authenticated;

create or replace function basement_private.refund_booking(p_booking_id bigint)
returns void language plpgsql security definer set search_path='' as $$
declare u public.basement_session_usage%rowtype; v_cfg jsonb;
begin
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  select * into u from public.basement_session_usage where booking_id=p_booking_id for update;
  if not found or u.refunded_at is not null then return; end if;
  if u.change<0 and u.member_package_id is not null then
    update public.member_packages set sessions_remaining=sessions_remaining-u.change,
      status=case when status='completed' and (not coalesce((v_cfg->>'blockAfterExpiry')::boolean,true) or expires_on+coalesce((v_cfg->>'maxAutoExtendDays')::integer,0)>=(now() at time zone 'Europe/Athens')::date) then 'active'::public.package_status else status end
      where id=u.member_package_id;
  end if;
  update public.basement_session_usage set change=0,refunded_at=now() where id=u.id;
end $$;
revoke all on function basement_private.refund_booking(bigint) from public,anon,authenticated;

create or replace function basement_private.sync_booking_credit()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_start timestamptz; v_service text; v_day date; v_cfg jsonb; v_package uuid;
begin
  if tg_op='UPDATE' and new.status=old.status and new.slot_id=old.slot_id and new.credit_policy=old.credit_policy then return new; end if;
  select starts_at,service into v_start,v_service from public.basement_slots where id=new.slot_id;
  v_day:=(v_start at time zone 'Europe/Athens')::date;
  if tg_op='INSERT' and new.credit_policy='booking' and v_start<=now() then
    raise exception using errcode='PBC01',message='Η ώρα έχει ήδη ξεκινήσει.';
  end if;
  if tg_op='UPDATE' and new.slot_id<>old.slot_id then
    select member_package_id into v_package from public.basement_session_usage where booking_id=new.id and refunded_at is null;
    if v_package is not null then
      select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
      if not exists(select 1 from public.member_packages p where p.id=v_package
        and p.status::text in('active','scheduled','completed') and p.starts_on<=v_day
        and (not coalesce((v_cfg->>'blockAfterExpiry')::boolean,true) or p.expires_on+coalesce((v_cfg->>'maxAutoExtendDays')::integer,0)>=v_day)
        and (p.frozen_until is null or p.frozen_until<v_day)
        and (not exists(select 1 from public.package_template_services pts where pts.package_template_id=p.package_template_id)
          or exists(select 1 from public.package_template_services pts join public.services sv on sv.id=pts.service_id
            where pts.package_template_id=p.package_template_id and lower(sv.name)=lower(v_service)))) then
        raise exception using errcode='PBC01',message='Το πακέτο της κράτησης δεν καλύπτει τη νέα ώρα ή υπηρεσία. Ακύρωσε πριν την έναρξη και δημιούργησε νέα κράτηση με κατάλληλο πακέτο.';
      end if;
    end if;
  end if;
  if new.status in('pending','booked') and new.credit_policy='booking' then
    perform basement_private.charge_booking(new.id,true);
  elsif new.status in('completed','no_show') then
    perform basement_private.charge_booking(new.id,new.credit_policy='booking');
  elsif new.status in('cancelled','late_cancel') and v_start>now() then
    perform basement_private.refund_booking(new.id);
  end if;
  return new;
end $$;
revoke all on function basement_private.sync_booking_credit() from public,anon,authenticated;
drop trigger if exists sync_booking_credit on public.basement_bookings;
create trigger sync_booking_credit after insert or update of status,slot_id,credit_policy on public.basement_bookings
for each row execute function basement_private.sync_booking_credit();
drop trigger if exists audit_credit_changes on public.basement_session_usage;
create trigger audit_credit_changes after insert or update on public.basement_session_usage
for each row execute function public.basement_audit_changes();

create or replace function public.basement_cancel(p_booking_id bigint)
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
declare b public.basement_bookings%rowtype; v_role text; v_admin boolean; v_start timestamptz; v_slot bigint;
begin
  select role::text into v_role from public.profiles where id=auth.uid() and active;
  if v_role is null then raise exception 'Απαιτείται ενεργή σύνδεση.'; end if;
  v_admin:=v_role in('owner','admin','reception');
  select slot_id into v_slot from public.basement_bookings where id=p_booking_id;
  select starts_at into v_start from public.basement_slots where id=v_slot for update;
  select * into b from public.basement_bookings where id=p_booking_id for update;
  if not found then raise exception 'Η κράτηση δεν βρέθηκε.'; end if;
  if b.member_id<>auth.uid() and not v_admin then raise exception 'Δεν επιτρέπεται η ακύρωση.'; end if;
  if b.status in('cancelled','late_cancel') then return; end if;
  if b.status not in('pending','booked') then raise exception 'Η κράτηση δεν είναι ενεργή.'; end if;
  if b.slot_id<>v_slot then raise exception 'Η κράτηση μεταφέρθηκε. Ανανέωσε και δοκίμασε ξανά.'; end if;
  if v_start<=now() and not v_admin then raise exception 'Η προπόνηση έχει ήδη ξεκινήσει.'; end if;
  update public.basement_bookings set status=case when v_start>now() then 'cancelled' else 'late_cancel' end,cancelled_at=now() where id=b.id;
  perform public.basement_promote_waiting(v_slot);
end $$;
revoke all on function public.basement_cancel(bigint) from public,anon;
grant execute on function public.basement_cancel(bigint) to authenticated;

create or replace function public.basement_admin_booking_action(p_booking_id bigint,p_action text)
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_role text; b public.basement_bookings%rowtype; v_member uuid; v_cfg jsonb; v_slot bigint; v_capacity integer;
begin
  select role::text into v_role from public.profiles where id=auth.uid() and active;
  if coalesce(v_role,'') not in('owner','admin','reception') then raise exception 'Δεν επιτρέπεται αυτή η ενέργεια.'; end if;
  select slot_id into v_slot from public.basement_bookings where id=p_booking_id;
  select capacity into v_capacity from public.basement_slots where id=v_slot for update;
  select * into b from public.basement_bookings where id=p_booking_id for update;
  if not found then raise exception 'Η κράτηση δεν βρέθηκε.'; end if;
  if b.slot_id<>v_slot then raise exception 'Η κράτηση μεταφέρθηκε. Ανανέωσε και δοκίμασε ξανά.'; end if;
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  select id into v_member from public.members where auth_user_id=b.member_id;
  if p_action in('complete','no_show') then
    if b.status not in('pending','booked','completed','no_show') then raise exception 'Κάνε πρώτα αναίρεση της ακύρωσης.'; end if;
    update public.basement_bookings set status=case when p_action='complete' then 'completed' else 'no_show' end,
      completed_at=coalesce(completed_at,now()),checked_in_at=case when p_action='complete' then coalesce(checked_in_at,now()) else null end where id=b.id;
    if p_action='complete' and v_member is not null and coalesce((v_cfg->>'checkIn')::boolean,true) then
      insert into public.gym_checkins(member_id,booking_id,method,notes) values(v_member,b.id,'automatic','Ολοκλήρωση ραντεβού') on conflict do nothing;
    elsif p_action='no_show' then delete from public.gym_checkins where booking_id=b.id; end if;
  elsif p_action='confirm' then update public.basement_bookings set status='booked' where id=b.id and status='pending';
  elsif p_action='pending' then update public.basement_bookings set status='pending' where id=b.id and status='booked';
  elsif p_action='paid' then update public.basement_bookings set payment_status='paid',paid_at=coalesce(paid_at,now()) where id=b.id;
  elsif p_action='unpaid' then update public.basement_bookings set payment_status='unpaid',paid_at=null where id=b.id;
  elsif p_action='undo' then
    if b.status in('pending','booked') then return; end if;
    if (select count(*) from public.basement_bookings where slot_id=b.slot_id and status in('pending','booked') and id<>b.id)>=v_capacity then
      raise exception 'Η ώρα είναι πλήρης. Δεν έγινε αναίρεση.';
    end if;
    update public.basement_bookings set status='booked',completed_at=null,checked_in_at=null,cancelled_at=null,
      credit_policy=case when (select starts_at>now() from public.basement_slots where id=b.slot_id) then 'booking' else credit_policy end where id=b.id;
    delete from public.gym_checkins where booking_id=b.id;
  else raise exception 'Άγνωστη ενέργεια.'; end if;
end $$;
revoke all on function public.basement_admin_booking_action(bigint,text) from public,anon;
grant execute on function public.basement_admin_booking_action(bigint,text) to authenticated;

create or replace function public.basement_promote_waiting(p_slot_id bigint)
returns bigint language plpgsql security definer set search_path='public','pg_temp' as $$
declare w public.basement_waiting_list%rowtype; v_id bigint; s public.basement_slots%rowtype; v_cfg jsonb; v_status text;
begin
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  if not coalesce((v_cfg->>'waitlistEnabled')::boolean,false) then return null; end if;
  select * into s from public.basement_slots where id=p_slot_id for update;
  if not found or not s.enabled or s.starts_at<=now() then return null; end if;
  if (select count(*) from public.basement_bookings where slot_id=s.id and status in('pending','booked'))>=s.capacity then return null; end if;
  v_status:=case when coalesce((v_cfg->>'autoConfirmWaitlist')::boolean,true) then 'booked' else 'pending' end;
  for w in select * from public.basement_waiting_list where slot_id=s.id and status='waiting' order by created_at,id for update skip locked loop
    if not exists(select 1 from public.profiles where id=w.member_id and role='customer' and active) then continue; end if;
    begin
      insert into public.basement_bookings(slot_id,member_id,status) values(s.id,w.member_id,v_status) returning id into v_id;
      update public.basement_waiting_list set status='promoted' where id=w.id;
      return v_id;
    exception when sqlstate 'PBC01' or unique_violation then
      -- Keep an ineligible entry waiting; never roll back somebody else's cancellation.
      continue;
    end;
  end loop;
  return null;
end $$;
revoke all on function public.basement_promote_waiting(bigint) from public,anon,authenticated;

create or replace function public.basement_charge_existing_booking(p_booking_id bigint)
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
declare b public.basement_bookings%rowtype;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role in('owner','admin','reception')) then raise exception 'Δεν επιτρέπεται αυτή η ενέργεια.'; end if;
  select * into b from public.basement_bookings where id=p_booking_id for update;
  if not found or b.status not in('pending','booked') then raise exception 'Η κράτηση δεν είναι ενεργή.'; end if;
  perform basement_private.charge_booking(b.id,true);
  update public.basement_bookings set credit_policy='booking' where id=b.id;
end $$;
revoke all on function public.basement_charge_existing_booking(bigint) from public,anon;
grant execute on function public.basement_charge_existing_booking(bigint) to authenticated;

create or replace function public.basement_calendar_member_finances()
returns table(auth_user_id uuid,last_payment_on date,next_payment_on date,debt numeric)
language plpgsql stable security definer set search_path='public','pg_temp' as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role in('owner','admin','reception')) then raise exception 'Δεν επιτρέπεται η προβολή πληρωμών.'; end if;
  return query select m.auth_user_id,
    (select max(f.occurred_on) from public.financial_entries f where f.member_id=m.id and f.kind='income' and f.occurred_on<=(now() at time zone 'Europe/Athens')::date),
    m.next_payment_on,m.debt from public.members m where m.auth_user_id is not null;
end $$;
revoke all on function public.basement_calendar_member_finances() from public,anon;
grant execute on function public.basement_calendar_member_finances() to authenticated;

-- Finalization updates attendance only; the trigger owns all credit mutations.
CREATE OR REPLACE FUNCTION public.basement_finalize_finished_appointments()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    update public.basement_bookings set status='completed',checked_in_at=case when coalesce((v_cfg->>'checkIn')::boolean,true) then coalesce(checked_in_at,v_booking.ends_at) else checked_in_at end,completed_at=now() where id=v_booking.id;
    v_done:=v_done+1;
  end loop;
  return v_done;
end $function$
;
revoke all on function public.basement_finalize_finished_appointments() from public,anon,authenticated;

-- Personal data is scoped from auth.uid(), never a caller-supplied member id.
create or replace function basement_private.member_service_allowed(p_service text,p_day date)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.profiles pr join public.members m on m.auth_user_id=pr.id
  join public.member_packages mp on mp.member_id=m.id
  join public.package_templates pt on pt.id=mp.package_template_id
  where pr.id=auth.uid() and pr.active and pr.role='customer' and m.active
  and mp.status::text in('active','scheduled') and mp.starts_on<=p_day
  and (mp.expires_on>=p_day or not coalesce((select (value->>'blockAfterExpiry')::boolean from public.app_settings where key='control_center_settings'),true)
    or mp.expires_on+coalesce((select (value->>'maxAutoExtendDays')::integer from public.app_settings where key='control_center_settings'),0)>=p_day)
  and (mp.frozen_until is null or mp.frozen_until<p_day) and pt.online_booking_enabled
  and exists(select 1 from public.services sv where lower(sv.name)=lower(p_service) and sv.active and sv.online_booking_enabled)
  and (not exists(select 1 from public.package_template_services pts where pts.package_template_id=pt.id)
    or exists(select 1 from public.package_template_services pts join public.services s on s.id=pts.service_id where pts.package_template_id=pt.id and lower(s.name)=lower(p_service)))
 );
$$;
revoke all on function basement_private.member_service_allowed(text,date) from public,anon,authenticated;


CREATE OR REPLACE FUNCTION public.basement_book(p_slot_id bigint, p_member_id uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  if v_role is null then raise exception 'Απαιτείται ενεργή σύνδεση.'; end if;
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
  if not v_is_admin and not basement_private.member_service_allowed(v_slot.service,v_local_start::date) then raise exception 'Η υπηρεσία δεν καλύπτεται από ενεργή online συνδρομή σου.'; end if;
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
   where mp.member_id=v_member and mp.status::text in('active','scheduled') and mp.starts_on<=v_local_start::date
     and (not coalesce((v_cfg->>'blockAfterExpiry')::boolean,true) or mp.expires_on+coalesce((v_cfg->>'maxAutoExtendDays')::integer,0)>=v_local_start::date)
     and (mp.frozen_until is null or mp.frozen_until<v_local_start::date)
     and (mp.sessions_remaining is null or mp.sessions_remaining>0)
     and (not exists(select 1 from public.package_template_services pts where pts.package_template_id=mp.package_template_id)
       or exists(select 1 from public.package_template_services pts join public.services sv on sv.id=pts.service_id where pts.package_template_id=mp.package_template_id and lower(sv.name)=lower(v_slot.service)))
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
end $function$
;

-- Opt eligible future appointments into the new model. Missing / wrong-service
-- packages stay untouched and are explicitly flagged in the calendar for staff.
do $$
declare b record;
begin
  for b in select bk.id from public.basement_bookings bk join public.basement_slots s on s.id=bk.slot_id
    where bk.credit_policy='legacy' and bk.status in('pending','booked') and s.starts_at>now()
    order by s.starts_at,bk.id for update of bk
  loop
    begin
      update public.basement_bookings set credit_policy='booking' where id=b.id;
    exception when sqlstate 'PBC01' then
      raise notice 'Booking % needs an eligible package; left unchanged.',b.id;
    end;
  end loop;
end $$;
CREATE OR REPLACE FUNCTION public.basement_refresh_packages_and_renewals()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_cfg jsonb:='{}'; v_expiry integer; v_credits integer; v_count integer:=0;
begin
 select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
 v_expiry:=coalesce((v_cfg->>'expiryReminderDays')::integer,2);
 v_credits:=coalesce((v_cfg->>'creditsReminder')::integer,1);
 update public.member_packages set status='expired' where status='active'
   and coalesce((v_cfg->>'blockAfterExpiry')::boolean,true)
   and expires_on+coalesce((v_cfg->>'maxAutoExtendDays')::integer,0)<(now() at time zone 'Europe/Athens')::date;
 get diagnostics v_count=row_count;
 update public.member_packages mp set status='completed'
 where mp.status='active' and mp.sessions_remaining is not null and mp.sessions_remaining<=0
 and not exists(select 1 from public.basement_session_usage u join public.basement_bookings b on b.id=u.booking_id
   where u.member_package_id=mp.id and u.refunded_at is null and b.status in('pending','booked'));
 insert into public.outbound_notifications(member_id,member_package_id,channel,title,body,status,scheduled_at,template_key)
 select mp.member_id,mp.id,'email','Υπενθύμιση ανανέωσης',
 case when mp.sessions_remaining is not null and mp.sessions_remaining<=v_credits
 then 'Απομένουν '||greatest(mp.sessions_remaining,0)||' συνεδρίες στο πακέτο σου.'
 else 'Το πακέτο σου λήγει στις '||to_char(mp.expires_on,'DD/MM/YYYY')||'.' end,
 'queued',now(),'package_renewal'
 from public.member_packages mp
 where mp.status='active' and (mp.expires_on<=current_date+v_expiry or (mp.sessions_remaining is not null and mp.sessions_remaining<=v_credits))
 on conflict do nothing;
 return v_count;
end $function$;

revoke all on function public.basement_refresh_packages_and_renewals() from public,anon,authenticated;
notify pgrst, 'reload schema';
