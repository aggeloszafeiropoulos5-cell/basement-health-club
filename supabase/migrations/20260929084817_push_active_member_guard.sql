create or replace view basement_push_private.candidates as
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
where d.enabled and p.active
and exists(select 1 from public.members active_member where active_member.auth_user_id=d.user_id and active_member.active)
and case e.kind when 'training' then d.training when 'subscriptions' then d.subscriptions else d.payments end
and (e.kind<>'payments' or not exists(select 1 from public.basement_push_deliveries sent
 where sent.device_id=d.id and sent.event_key like 'debt:%' and sent.status='sent'
 and sent.sent_at>now()-make_interval(days=>greatest(1,basement_push_private.setting_number(s.v,'debtReminderDays',7,30)::int))))
order by d.id,e.event_key,e.expires_at;

notify pgrst,'reload schema';
