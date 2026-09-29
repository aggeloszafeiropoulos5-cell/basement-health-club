-- Opt-in Web Push. No member is subscribed by this migration.
create schema if not exists basement_push_private;
revoke all on schema basement_push_private from public, anon, authenticated;

create table public.basement_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check(length(endpoint) between 20 and 2048),
  keys jsonb not null,
  enabled boolean not null default true,
  training boolean not null default true,
  subscriptions boolean not null default true,
  payments boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_test_at timestamptz
);
create index basement_push_devices_user_idx on public.basement_push_devices(user_id);
alter table public.basement_push_devices enable row level security;
revoke all on public.basement_push_devices from public,anon,authenticated;
grant all on public.basement_push_devices to service_role;

create table public.basement_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.basement_push_devices(id) on delete cascade,
  event_key text not null,
  status text not null check(status in ('sending','sent','retry','failed','skipped')),
  attempts integer not null default 1,
  lease uuid not null default gen_random_uuid(),
  retry_at timestamptz not null default now(),
  lease_until timestamptz not null default now()+interval '3 minutes',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error_code integer,
  unique(device_id,event_key)
);
alter table public.basement_push_deliveries enable row level security;
revoke all on public.basement_push_deliveries from public,anon,authenticated;
grant all on public.basement_push_deliveries to service_role;

-- The private VAPID key and scheduler credential are encrypted by Supabase Vault.
-- Only the server Edge Function can call this RPC; never expose its result to a client.
create function public.basement_push_config(p_initial jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; secret_id uuid;
begin
  perform pg_advisory_xact_lock(82391247);
  select decrypted_secret::jsonb into result from vault.decrypted_secrets where name='basement_push_config';
  if (result is null or result->>'publicKey' is null) and p_initial is not null then
    if p_initial->>'publicKey' !~ '^[A-Za-z0-9_-]{87}$'
       or p_initial->>'privateKey' !~ '^[A-Za-z0-9_-]{43}$'
       or p_initial->>'projectUrl' !~ '^https://[a-z0-9]+[.]supabase[.]co$' then
      raise exception 'Invalid push configuration';
    end if;
    result := coalesce(result,jsonb_build_object('cronSecret',gen_random_uuid()::text||gen_random_uuid()::text)) || p_initial;
    select id into secret_id from vault.decrypted_secrets where name='basement_push_config';
    if secret_id is null then
      perform vault.create_secret(result::text,'basement_push_config','Basement Web Push server credentials');
    else
      perform vault.update_secret(secret_id,result::text);
    end if;
  end if;
  return result;
end $$;
revoke all on function public.basement_push_config(jsonb) from public,anon,authenticated;
grant execute on function public.basement_push_config(jsonb) to service_role;

do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='basement_push_config') then
    perform vault.create_secret(jsonb_build_object('cronSecret',gen_random_uuid()::text||gen_random_uuid()::text,
      'projectUrl','https://nzuntubppzyegarujhak.supabase.co')::text,'basement_push_config','Basement Web Push server credentials');
  end if;
end $$;

create function basement_push_private.setting_number(settings jsonb, key text, fallback numeric, maximum numeric)
returns numeric language sql immutable set search_path='' as $$
 select case when settings->>key ~ '^[0-9]+([.][0-9]+)?$'
 then least(greatest((settings->>key)::numeric,0),maximum) else fallback end
$$;
revoke all on function basement_push_private.setting_number(jsonb,text,numeric,numeric) from public,anon,authenticated;

-- Candidates are recalculated on every run. No stale queue of cancelled bookings.
create view basement_push_private.candidates as
with settings as (
 select coalesce((select value from public.app_settings where key='control_center_settings'),'{}'::jsonb) as v,
 (now() at time zone 'Europe/Athens')::date as today,
 extract(hour from now() at time zone 'Europe/Athens') between 10 and 19 as daytime
), events as (
 select b.member_id as user_id,'training'::text as kind,
 case when coalesce(s.v->>'oneReminderPerDay','true')='true'
 then 'training-day:'||(sl.starts_at at time zone 'Europe/Athens')::date::text
 else 'training:'||b.id::text||':'||extract(epoch from sl.starts_at)::text end as event_key,
 'Υπενθύμιση προπόνησης'::text as title,
 'Έχεις προπόνηση '||to_char(sl.starts_at at time zone 'Europe/Athens','DD/MM "στις" HH24:MI')||'. Δες τις κρατήσεις σου.' as body,
 '/dashboard?tab=calendar'::text as url, sl.starts_at as expires_at
 from public.basement_bookings b join public.basement_slots sl on sl.id=b.slot_id cross join settings s
 where b.status='booked' and sl.enabled and sl.starts_at>now()+interval '1 minute'
 and sl.starts_at <= now()+make_interval(secs => (3600*basement_push_private.setting_number(s.v,'reminderHours',3.5,72))::double precision)
 and coalesce(s.v->>'remindersEnabled','true')='true'
 union all
 select m.auth_user_id,'subscriptions','expiry:'||mp.id::text||':'||mp.expires_on::text,
 'Η συνδρομή σου λήγει σύντομα',
 'Δες τη συνδρομή σου και επικοινώνησε με το Basement για ανανέωση.',
 '/dashboard?tab=packages', (mp.expires_on+1)::timestamp at time zone 'Europe/Athens'
 from public.member_packages mp join public.members m on m.id=mp.member_id cross join settings s
 where m.active and mp.status='active' and mp.starts_on<=s.today
 and (mp.frozen_until is null or mp.frozen_until<s.today)
 and mp.expires_on between s.today and s.today+basement_push_private.setting_number(s.v,'expiryReminderDays',2,30)::int
 and s.daytime and coalesce(s.v->>'remindersEnabled','true')='true'
 and not exists(select 1 from public.member_packages renewal where renewal.member_id=mp.member_id
   and renewal.package_template_id=mp.package_template_id and renewal.status='active'
   and renewal.starts_on<=mp.expires_on+1 and renewal.expires_on>mp.expires_on)
 union all
 select m.auth_user_id,'subscriptions','credits:'||mp.id::text,
 'Υπενθύμιση συνεδριών', 'Το υπόλοιπο συνεδριών σου είναι χαμηλό. Δες τη συνδρομή σου στην εφαρμογή.',
 '/dashboard?tab=packages',(mp.expires_on+1)::timestamp at time zone 'Europe/Athens'
 from public.member_packages mp join public.members m on m.id=mp.member_id cross join settings s
 where m.active and mp.status='active' and mp.starts_on<=s.today
 and (mp.frozen_until is null or mp.frozen_until<s.today)
 and mp.expires_on>s.today+basement_push_private.setting_number(s.v,'expiryReminderDays',2,30)::int
 and mp.sessions_remaining<=basement_push_private.setting_number(s.v,'creditsReminder',1,100)
 and s.daytime and coalesce(s.v->>'remindersEnabled','true')='true'
 and not exists(select 1 from public.member_packages renewal where renewal.member_id=mp.member_id
   and renewal.package_template_id=mp.package_template_id and renewal.status='active'
   and renewal.id<>mp.id and renewal.starts_on<=s.today and renewal.expires_on>=s.today
   and (renewal.sessions_remaining is null or renewal.sessions_remaining>0))
 union all
 select m.auth_user_id,'payments','debt:'||s.today::text,
 'Υπενθύμιση πληρωμής', 'Υπάρχει καταγεγραμμένη εκκρεμότητα πληρωμής. Επικοινώνησε με το Basement.',
 '/dashboard?tab=packages',(s.today+1)::timestamp at time zone 'Europe/Athens'
 from public.members m cross join settings s
 where m.active and m.debt>0 and s.daytime
 and coalesce(s.v->>'remindersEnabled','true')='true'
 and coalesce(s.v->>'paymentRemindersEnabled','true')='true'
)
select distinct on (d.id,e.event_key) d.id as device_id,d.user_id,d.endpoint,d.keys,e.event_key,e.kind,
 jsonb_build_object('title',e.title,'body',e.body,'url',e.url,'tag',e.event_key) as payload,e.expires_at
from public.basement_push_devices d join events e on e.user_id=d.user_id
join public.profiles p on p.id=d.user_id cross join settings s
where d.enabled and p.active and case e.kind when 'training' then d.training when 'subscriptions' then d.subscriptions else d.payments end
and (e.kind<>'payments' or not exists(select 1 from public.basement_push_deliveries sent
 where sent.device_id=d.id and sent.event_key like 'debt:%' and sent.status='sent'
 and sent.sent_at>now()-make_interval(days=>greatest(1,basement_push_private.setting_number(s.v,'debtReminderDays',7,30)::int))))
order by d.id,e.event_key,e.expires_at;
revoke all on basement_push_private.candidates from public,anon,authenticated;

create function public.basement_push_claim(p_limit integer default 40)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  -- Serialize brief claim transactions. Network sends happen after commit.
  if not pg_try_advisory_xact_lock(82391248) then return '[]'::jsonb; end if;
  with due as (
    select c.* from basement_push_private.candidates c
    left join public.basement_push_deliveries d on d.device_id=c.device_id and d.event_key=c.event_key
    where d.id is null or (d.attempts<5 and ((d.status='retry' and d.retry_at<=now()) or (d.status='sending' and d.lease_until<=now())))
    order by c.expires_at limit least(greatest(p_limit,1),100)
  ), claimed as (
    insert into public.basement_push_deliveries(device_id,event_key,status)
    select device_id,event_key,'sending' from due
    on conflict(device_id,event_key) do update set status='sending',attempts=basement_push_deliveries.attempts+1,
      lease=gen_random_uuid(),lease_until=now()+interval '3 minutes'
    returning id,device_id,event_key,lease,attempts
  ) select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('endpoint',d.endpoint,'keys',d.keys,'payload',d.payload,'expires_at',d.expires_at)),'[]')
  into result from claimed c join due d on d.device_id=c.device_id and d.event_key=c.event_key;
  return result;
end $$;
revoke all on function public.basement_push_claim(integer) from public,anon,authenticated;
grant execute on function public.basement_push_claim(integer) to service_role;

create function public.basement_push_still_due(p_id uuid,p_lease uuid)
returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.basement_push_deliveries d join basement_push_private.candidates c
 on c.device_id=d.device_id and c.event_key=d.event_key
 where d.id=p_id and d.lease=p_lease and d.status='sending' and d.lease_until>now() and c.expires_at>now())
$$;
revoke all on function public.basement_push_still_due(uuid,uuid) from public,anon,authenticated;
grant execute on function public.basement_push_still_due(uuid,uuid) to service_role;

create function public.basement_push_test_claim(p_user uuid,p_endpoint text)
returns jsonb language sql security definer set search_path='' as $$
 with claimed as(update public.basement_push_devices set last_test_at=now()
 where user_id=p_user and endpoint=p_endpoint and enabled
 and (last_test_at is null or last_test_at<now()-interval '1 minute') returning endpoint,keys)
 select to_jsonb(claimed) from claimed
$$;
revoke all on function public.basement_push_test_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.basement_push_test_claim(uuid,text) to service_role;

create function public.basement_push_subscribe(p_user uuid,p_endpoint text,p_keys jsonb,p_preferences jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,82391249));
  if exists(select 1 from public.basement_push_devices where endpoint=p_endpoint and user_id<>p_user) then
    raise exception 'Device belongs to another account' using errcode='23505';
  end if;
  if not exists(select 1 from public.basement_push_devices where endpoint=p_endpoint)
  and (select count(*) from public.basement_push_devices where user_id=p_user and enabled)>=10 then
    raise exception 'Device limit' using errcode='23514';
  end if;
  insert into public.basement_push_devices(user_id,endpoint,keys,training,subscriptions,payments)
  values(p_user,p_endpoint,p_keys,(p_preferences->>'training')::boolean,(p_preferences->>'subscriptions')::boolean,(p_preferences->>'payments')::boolean)
  on conflict(endpoint) do update set keys=excluded.keys,enabled=true,training=excluded.training,
    subscriptions=excluded.subscriptions,payments=excluded.payments,updated_at=now()
  where basement_push_devices.user_id=p_user
  returning jsonb_build_object('enabled',enabled,'training',training,'subscriptions',subscriptions,'payments',payments) into result;
  if result is null then raise exception 'Device ownership conflict'; end if;
  return result;
end $$;
revoke all on function public.basement_push_subscribe(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.basement_push_subscribe(uuid,text,jsonb,jsonb) to service_role;

-- pg_net is asynchronous; credentials are read from Vault, never in the cron command.
create extension if not exists pg_net with schema extensions;
create function basement_push_private.tick()
returns bigint language plpgsql security definer set search_path='' as $$
declare cfg jsonb; request_id bigint;
begin
  select decrypted_secret::jsonb into cfg from vault.decrypted_secrets where name='basement_push_config';
  if cfg is null then return null; end if;
  -- Nothing to send until someone explicitly enables notifications.
  if not exists(select 1 from public.basement_push_devices where enabled) then return null; end if;
  select net.http_post(url:=(cfg->>'projectUrl')||'/functions/v1/basement-push',
    headers:=jsonb_build_object('Content-Type','application/json','x-basement-cron',cfg->>'cronSecret'),
    body:='{"action":"dispatch"}'::jsonb,timeout_milliseconds:=60000) into request_id;
  return request_id;
end $$;
revoke all on function basement_push_private.tick() from public,anon,authenticated;
select cron.schedule('basement-push-reminders','*/5 * * * *','select basement_push_private.tick();');
notify pgrst,'reload schema';
