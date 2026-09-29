-- Port the original Control Center configuration to the existing club database.
-- No member, subscription or booking is deleted by this migration.
create or replace function basement_private.require_owner() returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin if not exists(select 1 from profiles where id=auth.uid() and active and role::text in('owner','admin')) then raise exception 'Απαιτείται πρόσβαση ιδιοκτήτη.'; end if; end $$;
revoke all on function basement_private.require_owner() from public,anon,authenticated;

create or replace function public.basement_brand_config() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select value from app_settings where key='reference_control_config'),'{}'::jsonb)
 where auth.uid() is not null
$$;
revoke all on function public.basement_brand_config() from public,anon;
grant execute on function public.basement_brand_config() to authenticated;

alter table basement_slots add column if not exists source_rule_id uuid references availability_rules(id) on delete set null;
alter table basement_slots add column if not exists manually_closed boolean not null default false;
update basement_slots set manually_closed=true where not enabled and source_rule_id is null;
-- The previous fixed service list prevented adding or renaming services.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.basement_slots'::regclass and contype='c' and pg_get_constraintdef(oid) like '%service = ANY%' loop
 execute format('alter table public.basement_slots drop constraint %I',c.conname); end loop;
end $$;

create or replace function basement_private.refresh_availability() returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg jsonb; horizon integer; n integer; today date:=(now() at time zone 'Europe/Athens')::date;
begin
 perform pg_advisory_xact_lock(90351235);
 select coalesce(value,'{}') into cfg from app_settings where key='control_center_settings';
 horizon:=least(730,greatest(14,coalesce((cfg->>'bookingMaxDays')::integer,365)));
 -- Link existing generated slots by their exact rule. History remains untouched.
 update basement_slots sl set source_rule_id=r.id from availability_rules r join services sv on sv.id=r.service_id
 where sl.source_rule_id is null and sl.starts_at>now() and sl.service=sv.name
 and extract(isodow from sl.starts_at at time zone 'Europe/Athens')=r.weekday
 and (sl.starts_at at time zone 'Europe/Athens')::time=r.start_time
 and (sl.starts_at at time zone 'Europe/Athens')::date>=r.valid_from
 and (r.valid_until is null or (sl.starts_at at time zone 'Europe/Athens')::date<=r.valid_until);
 update basement_slots sl set enabled=false where sl.source_rule_id is not null and sl.starts_at>now() and not exists(
  select 1 from availability_rules r join services sv on sv.id=r.service_id where r.id=sl.source_rule_id and r.active and sv.active
  and sl.service=sv.name and extract(isodow from sl.starts_at at time zone 'Europe/Athens')=r.weekday
  and (sl.starts_at at time zone 'Europe/Athens')::time=r.start_time
  and (sl.starts_at at time zone 'Europe/Athens')::date>=r.valid_from and (r.valid_until is null or (sl.starts_at at time zone 'Europe/Athens')::date<=r.valid_until)
  and r.start_time>=coalesce(nullif(cfg->>'openingTime','')::time,'00:00')
  and r.start_time+make_interval(mins=>r.duration_minutes)<=coalesce(nullif(cfg->>'closingTime','')::time,'23:59:59'));
 insert into basement_slots(service,starts_at,ends_at,capacity,enabled,source_rule_id)
 select distinct on(sv.name,d.slot_day+r.start_time) sv.name,(d.slot_day+r.start_time) at time zone 'Europe/Athens',
  ((d.slot_day+r.start_time) at time zone 'Europe/Athens')+make_interval(mins=>r.duration_minutes),least(30,sv.default_capacity),true,r.id
 from generate_series(today::timestamp,(today+horizon)::timestamp,interval '1 day') g(value)
 cross join lateral(select g.value::date as slot_day)d join availability_rules r on r.weekday=extract(isodow from d.slot_day)
 join services sv on sv.id=r.service_id
 where r.active and sv.active and d.slot_day>=r.valid_from and (r.valid_until is null or d.slot_day<=r.valid_until)
 and (d.slot_day+r.start_time) at time zone 'Europe/Athens'>now()
 and r.start_time>=coalesce(nullif(cfg->>'openingTime','')::time,'00:00')
 and r.start_time+make_interval(mins=>r.duration_minutes)<=coalesce(nullif(cfg->>'closingTime','')::time,'23:59:59')
 order by sv.name,d.slot_day+r.start_time,r.id
 on conflict(service,starts_at) do update set source_rule_id=excluded.source_rule_id,
 enabled=not basement_slots.manually_closed,
 capacity=excluded.capacity,
 ends_at=case when exists(select 1 from basement_bookings b where b.slot_id=basement_slots.id) then basement_slots.ends_at else excluded.ends_at end;
 get diagnostics n=row_count;
 update basement_slots sl set capacity=ov.capacity from (
  select distinct on(s.id) s.id,c.capacity from basement_slots s join services sv on sv.name=s.service join capacity_overrides c on c.service_id=sv.id and c.active
  where s.starts_at>now() and (c.specific_date is null or c.specific_date=(s.starts_at at time zone 'Europe/Athens')::date)
  and (c.weekday is null or c.weekday=extract(isodow from s.starts_at at time zone 'Europe/Athens'))
  and (c.start_time is null or c.start_time=(s.starts_at at time zone 'Europe/Athens')::time)
  order by s.id,c.specific_date desc nulls last,c.start_time desc nulls last,c.id
 )ov where sl.id=ov.id and sl.capacity<>ov.capacity;
 return n;
end $$;
revoke all on function basement_private.refresh_availability() from public,anon,authenticated;

create or replace function public.basement_sync_service_slots() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.name<>new.name then update basement_slots set service=new.name where service=old.name; end if;
 update availability_rules set duration_minutes=new.duration_minutes where service_id=new.id and duration_minutes=old.duration_minutes;
 update basement_slots sl set capacity=least(30,new.default_capacity),
 ends_at=case when exists(select 1 from basement_bookings b where b.slot_id=sl.id) then sl.ends_at else sl.starts_at+make_interval(mins=>new.duration_minutes) end,
 enabled=case when new.active then sl.enabled else false end
 where sl.service=new.name and sl.starts_at>now(); return new;
end $$;

create or replace function public.basement_save_reference_settings(p_config jsonb,p_rules jsonb,p_services jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb; k text; v text; sid uuid;
begin
 perform basement_private.require_owner();
 if coalesce(length(trim(p_config->>'name')),0)=0 or length(p_config->>'name')>100 then raise exception 'Συμπλήρωσε όνομα επιχείρησης.'; end if;
 for k,v in select * from jsonb_each_text(p_config->'colors') loop if v !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Μη έγκυρο χρώμα.'; end if; end loop;
 if (p_config->>'step')::integer not in(10,15,20,30,40,60) or p_config->>'defaultView' not in('day','week') then raise exception 'Μη έγκυρη προβολή.'; end if;
 if coalesce((p_config->>'lowSessions')::integer,1) not between 0 and 500 or coalesce((p_config->>'expiryDays')::integer,7) not between 0 and 730 or coalesce((p_config->>'inactiveDays')::integer,30) not between 0 and 730 then raise exception 'Έλεγξε τα όρια ειδοποιήσεων.'; end if;
 if (p_rules->>'bookingMaxDays')::integer not between 1 and 730 or (p_rules->>'bookingMinHours')::numeric not between 0 and 168
 or (p_rules->>'maxActiveBookings')::integer not between 0 and 500 then raise exception 'Έλεγξε τα όρια κρατήσεων.'; end if;
 if (p_rules->>'openingTime')::time >= (p_rules->>'closingTime')::time then raise exception 'Η λήξη ωραρίου πρέπει να είναι μετά την έναρξη.'; end if;
 if jsonb_array_length(p_services)>50 then raise exception 'Πάρα πολλές υπηρεσίες.'; end if;
 for s in select * from jsonb_array_elements(p_services) loop
  if coalesce(length(trim(s->>'name')),0)=0 or (s->>'duration_minutes')::int not between 5 and 240 or (s->>'default_capacity')::int not between 1 and 30 or s->>'color' !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Έλεγξε όνομα, διάρκεια, χρώμα και θέσεις υπηρεσίας (1–30).'; end if;
  sid:=nullif(s->>'id','')::uuid;
  if exists(select 1 from services where lower(name)=lower(trim(s->>'name')) and (sid is null or id<>sid)) then raise exception 'Υπάρχει ήδη υπηρεσία με αυτό το όνομα.'; end if;
  if sid is null then
   insert into services(code,name,duration_minutes,default_capacity,color,active,waiting_list_enabled,overbooking_enabled,online_booking_enabled)
   values('custom_'||gen_random_uuid()::text,trim(s->>'name'),(s->>'duration_minutes')::int,(s->>'default_capacity')::int,s->>'color',(s->>'active')::boolean,(s->>'waiting_list_enabled')::boolean,(s->>'overbooking_enabled')::boolean,(s->>'online_booking_enabled')::boolean);
  else
   update services set name=trim(s->>'name'),duration_minutes=(s->>'duration_minutes')::int,default_capacity=(s->>'default_capacity')::int,color=s->>'color',active=(s->>'active')::boolean,waiting_list_enabled=(s->>'waiting_list_enabled')::boolean,overbooking_enabled=(s->>'overbooking_enabled')::boolean,online_booking_enabled=(s->>'online_booking_enabled')::boolean where id=sid;
   if not found then raise exception 'Δεν βρέθηκε υπηρεσία.'; end if;
  end if;
 end loop;
 insert into app_settings(key,value,updated_by) values('reference_control_config',p_config,auth.uid()) on conflict(key) do update set value=excluded.value,updated_by=auth.uid(),updated_at=now();
 insert into app_settings(key,value,updated_by) values('control_center_settings',p_rules,auth.uid()) on conflict(key) do update set value=app_settings.value||excluded.value,updated_by=auth.uid(),updated_at=now();
 perform basement_private.refresh_availability();
end $$;
revoke all on function public.basement_save_reference_settings(jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.basement_save_reference_settings(jsonb,jsonb,jsonb) to authenticated;

create or replace function public.basement_save_availability(p_rule jsonb default null,p_closure jsonb default null,p_delete uuid default null,p_delete_kind text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare loc uuid; sid uuid; rid uuid; wd integer; d date;
begin
 perform basement_private.require_owner();
 select id into loc from locations where active order by created_at limit 1;
 if loc is null then raise exception 'Δεν υπάρχει ενεργή τοποθεσία.'; end if;
 if p_delete is not null then
  if p_delete_kind='rule' then update availability_rules set active=false where id=p_delete;
  elsif p_delete_kind='closure' then delete from closures where id=p_delete;
  else raise exception 'Μη έγκυρη ενέργεια.'; end if;
 elsif p_rule is not null then
  sid:=(p_rule->>'service_id')::uuid;rid:=nullif(p_rule->>'id','')::uuid;
  if not exists(select 1 from services where id=sid) then raise exception 'Επίλεξε υπηρεσία.'; end if;
  if (p_rule->>'duration_minutes')::int not between 5 and 240 or nullif(p_rule->>'valid_until','')::date<(p_rule->>'valid_from')::date then raise exception 'Έλεγξε διάρκεια και ημερομηνίες.'; end if;
  if rid is not null then
   update availability_rules set service_id=sid,weekday=(p_rule->>'weekday')::int,start_time=(p_rule->>'start_time')::time,duration_minutes=(p_rule->>'duration_minutes')::int,valid_from=(p_rule->>'valid_from')::date,valid_until=nullif(p_rule->>'valid_until','')::date,active=coalesce((p_rule->>'active')::boolean,true) where id=rid;
  else
   for wd in select jsonb_array_elements_text(p_rule->'weekdays')::integer loop
    insert into availability_rules(location_id,service_id,weekday,start_time,duration_minutes,valid_from,valid_until,active)
    values(loc,sid,wd,(p_rule->>'start_time')::time,(p_rule->>'duration_minutes')::int,(p_rule->>'valid_from')::date,nullif(p_rule->>'valid_until','')::date,true)
    on conflict(location_id,service_id,weekday,start_time,valid_from) do update set duration_minutes=excluded.duration_minutes,valid_until=excluded.valid_until,active=true;
   end loop;
  end if;
 elsif p_closure is not null then
  d:=(p_closure->>'closure_date')::date;
  insert into closures(location_id,closure_date,closure_type,reason,service_id)
  values(loc,d,p_closure->>'closure_type',p_closure->>'reason',nullif(p_closure->>'service_id','')::uuid);
 end if;
 perform basement_private.refresh_availability();
end $$;
revoke all on function public.basement_save_availability(jsonb,jsonb,uuid,text) from public,anon;
grant execute on function public.basement_save_availability(jsonb,jsonb,uuid,text) to authenticated;

create or replace function public.basement_open_slot(p_service uuid,p_day date,p_time time,p_duration integer) returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare sv services%rowtype; ts timestamptz; result bigint;
begin
 perform basement_private.require_owner(); select * into sv from services where id=p_service and active;
 if not found or p_duration not between 5 and 240 then raise exception 'Έλεγξε υπηρεσία και διάρκεια.'; end if;
 ts:=(p_day+p_time) at time zone 'Europe/Athens';
 if ts<=now() or p_day>(now() at time zone 'Europe/Athens')::date+730 then raise exception 'Επίλεξε μελλοντική ώρα έως 24 μήνες.'; end if;
 insert into basement_slots(service,starts_at,ends_at,capacity,enabled) values(sv.name,ts,ts+make_interval(mins=>p_duration),least(30,sv.default_capacity),true)
 on conflict(service,starts_at) do update set enabled=true,manually_closed=false returning id into result;
 return result;
end $$;
revoke all on function public.basement_open_slot(uuid,date,time,integer) from public,anon;
grant execute on function public.basement_open_slot(uuid,date,time,integer) to authenticated;

-- Original maximum-active-bookings setting is enforced independently of weekly limits.
create or replace function basement_private.enforce_active_booking_limit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare lim integer;
begin
 if new.status not in('pending','booked') or auth.uid() is null or public.is_staff() then return new; end if;
 if tg_op='UPDATE' and old.status in('pending','booked') then return new; end if;
 select coalesce((value->>'maxActiveBookings')::int,0) into lim from app_settings where key='control_center_settings';
 perform 1 from members where auth_user_id=new.member_id for update;
 if lim>0 and (select count(*) from basement_bookings b join basement_slots s on s.id=b.slot_id where b.member_id=new.member_id and b.id<>new.id and b.status in('pending','booked') and s.ends_at>now())>=lim then raise exception 'Συμπληρώθηκε το όριο ενεργών κρατήσεων.'; end if;
 return new;
end $$;
revoke all on function basement_private.enforce_active_booking_limit() from public,anon,authenticated;
drop trigger if exists reference_active_booking_limit on basement_bookings;
create trigger reference_active_booking_limit before insert or update on basement_bookings for each row execute function basement_private.enforce_active_booking_limit();

insert into app_settings(key,value) values('reference_control_config','{"name":"BASEMENT","subtitle":"HEALTH CLUB","colors":{"primary":"#7138dc","header":"#202c43","background":"#f5f6fa","green":"#07864d","orange":"#c35a06","red":"#ce2949","blue":"#0774d1"},"step":60,"defaultView":"day","lowSessions":1,"expiryDays":7,"inactiveDays":30,"calendarColorMode":"status"}') on conflict(key) do nothing;
-- Refresh runs when settings are saved and daily; never replaces booking records.
select cron.schedule('basement-reference-availability','20 3 * * *','select basement_private.refresh_availability();');
notify pgrst,'reload schema';

create or replace function public.basement_save_capacity(p_data jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare loc uuid;
begin perform basement_private.require_owner();
 if (p_data->>'capacity')::integer not between 1 and 30 then raise exception 'Η χωρητικότητα πρέπει να είναι από 1 έως 30.'; end if;
 if nullif(p_data->>'id','') is not null then
 update capacity_overrides set active=coalesce((p_data->>'active')::boolean,true),capacity=(p_data->>'capacity')::int where id=(p_data->>'id')::uuid;
 perform basement_private.refresh_availability();return;end if;
 select id into loc from locations where active order by created_at limit 1;
 insert into capacity_overrides(location_id,service_id,specific_date,weekday,start_time,capacity,active)
 values(loc,(p_data->>'service_id')::uuid,nullif(p_data->>'specific_date','')::date,nullif(p_data->>'weekday','')::integer,nullif(p_data->>'start_time','')::time,(p_data->>'capacity')::integer,true);
 perform basement_private.refresh_availability();
end $$;
revoke all on function public.basement_save_capacity(jsonb) from public,anon;
grant execute on function public.basement_save_capacity(jsonb) to authenticated;

create or replace function public.basement_owner_overbook(p_slot_id bigint,p_member_id uuid) returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare sl basement_slots%rowtype; result bigint;
begin
 perform basement_private.require_owner();
 select * into sl from basement_slots where id=p_slot_id for update;
 if not found or not sl.enabled or sl.starts_at<=now() then raise exception 'Η ώρα δεν είναι διαθέσιμη.'; end if;
 if not exists(select 1 from services where name=sl.service and active and overbooking_enabled) then raise exception 'Το Owner overbooking είναι απενεργοποιημένο.'; end if;
 if not exists(select 1 from profiles p join members m on m.auth_user_id=p.id where p.id=p_member_id and p.active and m.active and p.role::text='customer') then raise exception 'Δεν βρέθηκε ενεργό μέλος.'; end if;
 if exists(select 1 from basement_bookings where slot_id=p_slot_id and member_id=p_member_id and status in('booked','pending')) then raise exception 'Υπάρχει ήδη κράτηση.'; end if;
 -- Credit trigger validates the exact service and charges the package once.
 insert into basement_bookings(slot_id,member_id,status,notes) values(p_slot_id,p_member_id,'booked','Owner overbooking') returning id into result;
 return result;
end $$;
revoke all on function public.basement_owner_overbook(bigint,uuid) from public,anon;
grant execute on function public.basement_owner_overbook(bigint,uuid) to authenticated;

create table if not exists basement_leads(
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name))>0),phone text not null default '',email text not null default '',service text not null default '',source text not null default 'Other',stage text not null default 'New Lead' check(stage in('New Lead','Contacted','Trial Booked','Trial Completed','Member','Renewal','Lost')),notes text not null default '',follow_up date,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
alter table basement_leads enable row level security;
drop policy if exists leads_staff on basement_leads;
create policy leads_staff on basement_leads for all to authenticated using(exists(select 1 from profiles where id=auth.uid() and active and role::text in('owner','admin','reception'))) with check(exists(select 1 from profiles where id=auth.uid() and active and role::text in('owner','admin','reception')));
grant select,insert,update on basement_leads to authenticated;
drop trigger if exists audit_leads on basement_leads;
create trigger audit_leads after insert or update on basement_leads for each row execute function basement_audit_changes();

create or replace function public.basement_staff_directory() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin perform basement_private.require_owner();return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'email',u.email,'phone',p.phone,'role',p.role,'active',p.active)) from profiles p join auth.users u on u.id=p.id where p.role::text in('owner','admin','reception','trainer')),'[]'::jsonb); end $$;
revoke all on function public.basement_staff_directory() from public,anon;
grant execute on function public.basement_staff_directory() to authenticated;
create or replace function public.basement_save_staff(p_email text,p_name text,p_role text,p_active boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;
begin
 perform basement_private.require_owner();
 if p_role not in('owner','admin','reception','trainer','customer') then raise exception 'Μη έγκυρος ρόλος.'; end if;
 select id into target from auth.users where lower(email)=lower(trim(p_email));
 if target is null then raise exception 'Δεν υπάρχει λογαριασμός με αυτό το email. Δημιούργησε πρώτα λογαριασμό από τα Μέλη.'; end if;
 if target=auth.uid() and (p_role not in('owner','admin') or not p_active) then raise exception 'Δεν μπορείς να αφαιρέσεις τη δική σου πρόσβαση ιδιοκτήτη.'; end if;
 update profiles set full_name=coalesce(nullif(trim(p_name),''),full_name),role=p_role::user_role,active=p_active where id=target;
 insert into audit_log(actor_id,action,table_name,record_id,new_value) values(auth.uid(),'update','profiles',target::text,jsonb_build_object('role',p_role,'active',p_active));
end $$;
revoke all on function public.basement_save_staff(text,text,text,boolean) from public,anon;
grant execute on function public.basement_save_staff(text,text,text,boolean) to authenticated;

create or replace function public.basement_business_export() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb:='{}'; t text; rows jsonb;
begin
 perform basement_private.require_owner();
 foreach t in array array['members','services','package_templates','package_template_services','member_packages','basement_slots','basement_bookings','basement_session_usage','gym_checkins','financial_entries','member_measurements','availability_rules','closures','capacity_overrides','locations','basement_leads','audit_log'] loop
 execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t',t) into rows;result:=result||jsonb_build_object(t,rows);
 end loop;
 return jsonb_build_object('format','basement-business-export-v1','created_at',now(),'data',result,'settings',(select jsonb_agg(to_jsonb(s)) from app_settings s where key in('control_center_settings','reference_control_config')));
end $$;
revoke all on function public.basement_business_export() from public,anon;
grant execute on function public.basement_business_export() to authenticated;
create or replace function basement_private.settings_schedule_changed() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.key='control_center_settings' and (tg_op='INSERT' or
 (new.value->>'openingTime',new.value->>'closingTime',new.value->>'bookingMaxDays') is distinct from (old.value->>'openingTime',old.value->>'closingTime',old.value->>'bookingMaxDays')) then
 perform basement_private.refresh_availability(); end if; return new;
end $$;
revoke all on function basement_private.settings_schedule_changed() from public,anon,authenticated;
drop trigger if exists reference_schedule_settings on app_settings;
create trigger reference_schedule_settings after insert or update on app_settings for each row execute function basement_private.settings_schedule_changed();
notify pgrst,'reload schema';
