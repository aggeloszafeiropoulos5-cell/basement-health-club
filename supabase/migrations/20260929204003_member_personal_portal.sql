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

create or replace function public.basement_member_portal()
returns jsonb language plpgsql stable security definer set search_path='public','pg_temp' as $$
declare v_member uuid; v_cfg jsonb; v_today date:=(now() at time zone 'Europe/Athens')::date;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role='customer') then raise exception 'Απαιτείται ενεργός λογαριασμός μέλους.'; end if;
 select id into v_member from public.members where auth_user_id=auth.uid() and active;
 if v_member is null then raise exception 'Δεν βρέθηκε ενεργή καρτέλα μέλους.'; end if;
 select coalesce(value,'{}') into v_cfg from public.app_settings where key='control_center_settings';
 return jsonb_build_object(
  'packages',coalesce((select jsonb_agg(jsonb_build_object('id',mp.id,'name',pt.name,'status',mp.status,
    'starts_on',mp.starts_on,'expires_on',mp.expires_on,'sessions_remaining',mp.sessions_remaining,'frozen_until',mp.frozen_until,
    'services',coalesce((select jsonb_agg(s.name order by s.name) from public.services s where s.active and s.online_booking_enabled and pt.online_booking_enabled
      and (not exists(select 1 from public.package_template_services pts where pts.package_template_id=pt.id)
        or exists(select 1 from public.package_template_services pts where pts.package_template_id=pt.id and pts.service_id=s.id))),'[]'::jsonb)
    ) order by mp.expires_on,mp.id) from public.member_packages mp join public.package_templates pt on pt.id=mp.package_template_id where mp.member_id=v_member),'[]'::jsonb),
  'services',coalesce((select jsonb_agg(s.name order by s.name) from public.services s where s.active and s.online_booking_enabled and exists(
    select 1 from public.member_packages mp join public.package_templates pt on pt.id=mp.package_template_id
    where mp.member_id=v_member and mp.status::text in('active','scheduled') and (mp.expires_on+coalesce((v_cfg->>'maxAutoExtendDays')::integer,0)>=v_today or not coalesce((v_cfg->>'blockAfterExpiry')::boolean,true)) and pt.online_booking_enabled
    and (not exists(select 1 from public.package_template_services pts where pts.package_template_id=pt.id)
      or exists(select 1 from public.package_template_services pts where pts.package_template_id=pt.id and pts.service_id=s.id)))),'[]'::jsonb),
  'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'slot_id',s.id,'service',s.service,'starts_at',s.starts_at,'ends_at',s.ends_at,'status',b.status,'paid_at',b.paid_at) order by s.starts_at,b.id)
    from public.basement_bookings b join public.basement_slots s on s.id=b.slot_id
    where b.member_id=auth.uid() and s.starts_at>=now()-interval '24 months'),'[]'::jsonb),
  'block_after_expiry',coalesce((v_cfg->>'blockAfterExpiry')::boolean,true),
  'grace_days',coalesce((v_cfg->>'maxAutoExtendDays')::integer,0),
  'completed_count',(select count(*) from public.basement_bookings where member_id=auth.uid() and status='completed'),
  'next_payment_on',(select next_payment_on from public.members where id=v_member),
  'last_payment_on',(select max(occurred_on) from public.financial_entries where member_id=v_member and kind='income' and occurred_on<=v_today),
  'terms_required',coalesce((v_cfg->>'termsPage')::boolean,false),
  'booking_paused',coalesce((v_cfg->>'pauseBookings')::boolean,false) or not coalesce((v_cfg->>'existingCustomerBooking')::boolean,true),
  'show_available_spots',coalesce((v_cfg->>'showAvailableSpots')::boolean,true)
 );
end $$;
revoke all on function public.basement_member_portal() from public,anon;
grant execute on function public.basement_member_portal() to authenticated;

CREATE OR REPLACE FUNCTION public.basement_availability()
 RETURNS TABLE(id bigint, service text, starts_at timestamptz, ends_at timestamptz, capacity integer, enabled boolean, reserved bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
 with cfg as(select coalesce(value,'{}') v from public.app_settings where key='control_center_settings')
 select s.id,s.service,s.starts_at,
 case when (select v->>'slotDurationMode' from cfg) ~ '^[0-9]+' then s.starts_at+make_interval(mins=>substring((select v->>'slotDurationMode' from cfg) from '^[0-9]+')::integer) else s.ends_at end,
 s.capacity,
 s.enabled and not(coalesce(((select v->>'holidayRestrictions' from cfg))::boolean,true) and exists(
  select 1 from public.closures c left join public.services sv on sv.id=c.service_id
  where c.closure_date=(s.starts_at at time zone 'Europe/Athens')::date and(c.service_id is null or lower(sv.name)=lower(s.service))
  and(c.starts_at is null or (s.starts_at at time zone 'Europe/Athens')::time>=c.starts_at)
  and(c.ends_at is null or (s.starts_at at time zone 'Europe/Athens')::time<c.ends_at))),
 (select count(*) from public.basement_bookings b where b.slot_id=s.id and b.status in('pending','booked'))
 from public.basement_slots s left join public.services sv on lower(sv.name)=lower(s.service)
 where auth.uid() is not null
 and s.starts_at>=case when public.is_staff() then (now()-make_interval(days=>coalesce(((select v->>'adminVisibilityDays' from cfg))::integer,730))) else now() end
 and s.starts_at<case when nullif((select v->>'maxAvailableDate' from cfg),'') is not null then (((select v->>'maxAvailableDate' from cfg))::date+1)::timestamp at time zone 'Europe/Athens' else now()+make_interval(days=>coalesce(((select v->>'bookingMaxDays' from cfg))::integer,14)) end
 and (s.starts_at at time zone 'Europe/Athens')::time>=coalesce(nullif((select v->>'openingTime' from cfg),'')::time,'00:00')
 and (s.starts_at at time zone 'Europe/Athens')::time<=coalesce(nullif((select v->>'closingTime' from cfg),'')::time,'23:59')
 and (public.is_staff() or (
   sv.active and sv.online_booking_enabled
   and basement_private.member_service_allowed(s.service,(s.starts_at at time zone 'Europe/Athens')::date)
   and not coalesce((select (v->>'pauseBookings')::boolean from cfg),false)
   and coalesce((select (v->>'existingCustomerBooking')::boolean from cfg),true)
   and s.starts_at>=now()+make_interval(secs=>(coalesce((select (v->>'bookingMinHours')::numeric from cfg),0)*3600)::integer)
   and s.starts_at<=now()+make_interval(days=>coalesce((select (v->>'bookingMaxDays')::integer from cfg),14))
   and not ((s.starts_at at time zone 'Europe/Athens')::date=(now() at time zone 'Europe/Athens')::date+1
     and (now() at time zone 'Europe/Athens')::time>coalesce(nullif((select v->>'previousDayDeadline' from cfg),'')::time,'23:59'))
 ))
 order by s.starts_at,s.service;
$function$;
revoke all on function public.basement_availability() from public,anon;
grant execute on function public.basement_availability() to authenticated;
notify pgrst,'reload schema';
