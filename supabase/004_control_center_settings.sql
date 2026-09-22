-- Basement Control Center: configurable business and booking rules.
insert into public.app_settings(key,value,updated_at)
values ('control_center_settings', jsonb_build_object(
  'businessName','BASEMENT HEALTH CLUB','currency','Συνεδρίες','timeFormat','24 ώρες',
  'bookingMinHours',2.5,'bookingMaxDays',14,'cancelMinMinutes',30,'moveMinHours',3,
  'openingTime','08:30','closingTime','22:30','pauseBookings',false,
  'showEndTime',true,'showAvailableSpots',true,'colorPerService',true,
  'hideZeroCustomer',true,'hideZeroAdmin',false,'adminNotes',true,'checkIn',true,
  'autoComplete',true,'autoConfirm',true,'remindersEnabled',true,
  'waitlistEnabled',true,'autoConfirmWaitlist',true,'waitlistConfirmationHours',3,
  'waitlistLimit',2,'creditsRequired',true,'bookingsWithoutCredits',0,
  'blockAfterExpiry',true,'adminExceedsLimits',true
),now()) on conflict (key) do nothing;

create or replace function public.basement_availability()
returns table(id bigint,service text,starts_at timestamptz,ends_at timestamptz,capacity integer,enabled boolean,reserved bigint)
language sql security definer set search_path to 'public','pg_temp' as $$
  with cfg as (select coalesce((value->>'bookingMaxDays')::integer,14) days,nullif(value->>'maxAvailableDate','')::date max_date,coalesce(nullif(value->>'openingTime','')::time,'00:00') opening_time,coalesce(nullif(value->>'closingTime','')::time,'23:59') closing_time from public.app_settings where key='control_center_settings')
  select s.id,s.service,s.starts_at,s.ends_at,s.capacity,s.enabled,
    (select count(*) from public.basement_bookings b where b.slot_id=s.id and b.status='booked')
  from public.basement_slots s
  where auth.uid() is not null and s.starts_at>now()
    and s.starts_at<case when (select max_date from cfg) is not null then ((select max_date from cfg)+1)::timestamp at time zone 'Europe/Athens' else now()+make_interval(days=>coalesce((select days from cfg),14)) end
    and (s.starts_at at time zone 'Europe/Athens')::time>=(select opening_time from cfg)
    and (s.starts_at at time zone 'Europe/Athens')::time<=(select closing_time from cfg)
  order by s.starts_at,s.service;
$$;

create or replace function public.basement_book(p_slot_id bigint,p_member_id uuid default null::uuid)
returns bigint language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_actor uuid:=auth.uid();v_role text;v_target uuid;v_slot public.basement_slots%rowtype;v_count integer;v_id bigint;v_cfg jsonb:='{}';v_is_admin boolean;
begin
  if v_actor is null then raise exception 'Απαιτείται σύνδεση.';end if;
  select role into v_role from public.profiles where id=v_actor;v_is_admin:=coalesce(v_role,'') in ('owner','admin');v_target:=coalesce(p_member_id,v_actor);
  if v_target<>v_actor and not v_is_admin then raise exception 'Δεν επιτρέπεται κράτηση για άλλο μέλος.';end if;
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  if not v_is_admin and coalesce((v_cfg->>'pauseBookings')::boolean,false) then raise exception 'Οι νέες κρατήσεις είναι προσωρινά κλειστές.';end if;
  if not exists(select 1 from public.profiles where id=v_target and role='customer') then raise exception 'Δεν βρέθηκε ενεργό μέλος.';end if;
  if not v_is_admin and coalesce((v_cfg->>'activeCustomersOnly')::boolean,false) and not exists(select 1 from public.members where (id=v_target or auth_user_id=v_target) and active) then raise exception 'Απαιτείται ενεργή συνδρομή μέλους.';end if;
  select * into v_slot from public.basement_slots where id=p_slot_id for update;
  if not found or not v_slot.enabled or v_slot.starts_at<=now() then raise exception 'Η ώρα δεν είναι διαθέσιμη.';end if;
  if not v_is_admin and v_slot.starts_at<now()+make_interval(secs=>(coalesce((v_cfg->>'bookingMinHours')::numeric,0)*3600)::integer) then raise exception 'Η κράτηση πρέπει να γίνει νωρίτερα σύμφωνα με την πολιτική κρατήσεων.';end if;
  if exists(select 1 from public.basement_bookings where slot_id=p_slot_id and member_id=v_target and status='booked') then raise exception 'Το μέλος έχει ήδη κράτηση σε αυτή την ώρα.';end if;
  select count(*) into v_count from public.basement_bookings where slot_id=p_slot_id and status='booked';if v_count>=v_slot.capacity then raise exception 'Οι θέσεις εξαντλήθηκαν.';end if;
  insert into public.basement_bookings(slot_id,member_id) values(p_slot_id,v_target) returning id into v_id;return v_id;
end;$$;

create or replace function public.basement_cancel(p_booking_id bigint)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_booking public.basement_bookings%rowtype;v_start timestamptz;v_role text;v_cfg jsonb:='{}';v_is_admin boolean;
begin
  if auth.uid() is null then raise exception 'Απαιτείται σύνδεση.';end if;
  select role into v_role from public.profiles where id=auth.uid();v_is_admin:=coalesce(v_role,'') in ('owner','admin');
  select * into v_booking from public.basement_bookings where id=p_booking_id for update;
  if not found or v_booking.status<>'booked' then raise exception 'Η κράτηση δεν βρέθηκε.';end if;
  if v_booking.member_id<>auth.uid() and not v_is_admin then raise exception 'Δεν επιτρέπεται η ακύρωση.';end if;
  select starts_at into v_start from public.basement_slots where id=v_booking.slot_id;if v_start<=now() then raise exception 'Η προπόνηση έχει ήδη ξεκινήσει.';end if;
  select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
  if not v_is_admin and v_start<now()+make_interval(mins=>coalesce((v_cfg->>'cancelMinMinutes')::integer,0)) then raise exception 'Έληξε η προθεσμία ακύρωσης.';end if;
  update public.basement_bookings set status='cancelled',cancelled_at=now() where id=p_booking_id;
end;$$;

revoke execute on function public.basement_availability() from public,anon;
revoke execute on function public.basement_book(bigint,uuid) from public,anon;
revoke execute on function public.basement_cancel(bigint) from public,anon;
grant execute on function public.basement_availability() to authenticated;
grant execute on function public.basement_book(bigint,uuid) to authenticated;
grant execute on function public.basement_cancel(bigint) to authenticated;
