-- Complete the operational booking core: durable statuses, staff access,
-- waiting-list actions, QR/code check-in and package renewal automation.

-- basement_waiting_list already owns a UNIQUE(slot_id,member_id,status)
-- constraint from 005_operations.sql. Do not duplicate that index.
create unique index if not exists gym_checkins_booking_unique
  on public.gym_checkins(booking_id) where booking_id is not null;
-- members.qr_token is already protected by its table-level UNIQUE constraint.

alter table public.outbound_notifications
  add column if not exists member_package_id uuid references public.member_packages(id) on delete cascade;
create unique index if not exists outbound_package_notification_once
  on public.outbound_notifications(member_id,member_package_id,template_key)
  where member_package_id is not null and template_key is not null;

drop policy if exists basement_bookings_read on public.basement_bookings;
create policy basement_bookings_read on public.basement_bookings
for select to authenticated
using(member_id=(select auth.uid()) or public.is_staff());

create or replace function public.basement_update_booking_notes(p_booking_id bigint,p_notes text)
returns void language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_role text;
begin
  select role::text into v_role from public.profiles where id=auth.uid() and active;
  if coalesce(v_role,'') not in('owner','admin','reception','trainer') then
    raise exception 'Δεν επιτρέπεται η αλλαγή σημειώσεων.';
  end if;
  update public.basement_bookings set notes=nullif(trim(p_notes),'') where id=p_booking_id;
  if not found then raise exception 'Η κράτηση δεν βρέθηκε.'; end if;
end $$;
revoke all on function public.basement_update_booking_notes(bigint,text) from public,anon;
grant execute on function public.basement_update_booking_notes(bigint,text) to authenticated;

create or replace function public.basement_admin_waitlist_action(p_waiting_id bigint,p_action text)
returns bigint language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_role text; v_wait public.basement_waiting_list%rowtype; v_capacity integer; v_count integer; v_booking bigint;
begin
  select role::text into v_role from public.profiles where id=auth.uid() and active;
  if coalesce(v_role,'') not in('owner','admin','reception') then raise exception 'Δεν επιτρέπεται αυτή η ενέργεια.'; end if;
  select * into v_wait from public.basement_waiting_list where id=p_waiting_id for update;
  if not found or v_wait.status<>'waiting' then raise exception 'Η θέση αναμονής δεν είναι ενεργή.'; end if;
  if p_action='cancel' then
    update public.basement_waiting_list set status='cancelled' where id=p_waiting_id;
    return null;
  elsif p_action<>'promote' then
    raise exception 'Άγνωστη ενέργεια.';
  end if;
  select capacity into v_capacity from public.basement_slots where id=v_wait.slot_id for update;
  select count(*) into v_count from public.basement_bookings where slot_id=v_wait.slot_id and status in('pending','booked');
  if v_count>=coalesce(v_capacity,0) then raise exception 'Η ώρα είναι πλήρης.'; end if;
  insert into public.basement_bookings(slot_id,member_id,status)
  values(v_wait.slot_id,v_wait.member_id,'booked')
  on conflict do nothing returning id into v_booking;
  if v_booking is null then raise exception 'Υπάρχει ήδη ενεργή κράτηση για το μέλος.'; end if;
  update public.basement_waiting_list set status='promoted' where id=p_waiting_id;
  return v_booking;
end $$;
revoke all on function public.basement_admin_waitlist_action(bigint,text) from public,anon;
grant execute on function public.basement_admin_waitlist_action(bigint,text) to authenticated;

create or replace function public.basement_checkin_by_code(p_code text)
returns bigint language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_role text; v_member uuid; v_auth uuid; v_matches integer; v_booking bigint; v_code text:=lower(trim(p_code));
begin
  select role::text into v_role from public.profiles where id=auth.uid() and active;
  if coalesce(v_role,'') not in('owner','admin','reception','trainer') then raise exception 'Δεν επιτρέπεται το check-in.'; end if;
  if length(v_code)<8 then raise exception 'Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.'; end if;
  select count(*),min(id),min(auth_user_id) into v_matches,v_member,v_auth
  from public.members
  where active and auth_user_id is not null
    and (lower(qr_token::text)=v_code or lower(left(qr_token::text,8))=left(v_code,8));
  if v_matches=0 then raise exception 'Δεν βρέθηκε ενεργό μέλος.'; end if;
  if v_matches>1 then raise exception 'Ο σύντομος κωδικός δεν είναι μοναδικός. Σκάναρε ολόκληρο το QR.'; end if;
  select b.id into v_booking
  from public.basement_bookings b join public.basement_slots s on s.id=b.slot_id
  where b.member_id=v_auth and b.status in('pending','booked')
    and s.starts_at<=now()+interval '2 hours' and s.ends_at>=now()-interval '6 hours'
  order by abs(extract(epoch from(s.starts_at-now()))),b.id limit 1 for update of b;
  if v_booking is null then raise exception 'Δεν υπάρχει ενεργό ραντεβού κοντά στην τρέχουσα ώρα.'; end if;
  perform public.basement_admin_booking_action(v_booking,'complete');
  return v_booking;
end $$;
revoke all on function public.basement_checkin_by_code(text) from public,anon;
grant execute on function public.basement_checkin_by_code(text) to authenticated;

create or replace function public.basement_refresh_packages_and_renewals()
returns integer language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_cfg jsonb:='{}'; v_expiry integer; v_credits integer; v_count integer:=0;
begin
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  v_expiry:=coalesce((v_cfg->>'expiryReminderDays')::integer,2);
  v_credits:=coalesce((v_cfg->>'creditsReminder')::integer,1);
  update public.member_packages set status='expired'
   where status='active' and expires_on<current_date;
  get diagnostics v_count=row_count;
  update public.member_packages set status='completed'
   where status='active' and sessions_remaining is not null and sessions_remaining<=0;
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
end $$;
revoke all on function public.basement_refresh_packages_and_renewals() from public,anon,authenticated;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='basement-package-renewals';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('basement-package-renewals','15 5 * * *','select public.basement_refresh_packages_and_renewals();');
end $$;
