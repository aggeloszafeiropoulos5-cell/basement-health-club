-- Keep the customer profile and the business member record in sync.
-- This lets package assignments and the member portal use the same account.
create or replace function public.sync_customer_profile_to_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  if new.role = 'customer' then
    select email into v_email from auth.users where id = new.id;

    insert into public.members (
      auth_user_id, home_location_id, full_name, email, phone, active
    ) values (
      new.id,
      new.location_id,
      coalesce(nullif(btrim(new.full_name), ''), v_email, 'Μέλος'),
      v_email,
      new.phone,
      new.active
    )
    on conflict (auth_user_id) do update set
      home_location_id = excluded.home_location_id,
      full_name = excluded.full_name,
      email = excluded.email,
      phone = excluded.phone,
      active = excluded.active;
  elsif tg_op = 'UPDATE' and old.role = 'customer' then
    update public.members set active = false where auth_user_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_customer_profile_to_member() from public, anon, authenticated;

drop trigger if exists sync_customer_profile_to_member on public.profiles;
create trigger sync_customer_profile_to_member
after insert or update of full_name, phone, role, location_id, active
on public.profiles
for each row execute function public.sync_customer_profile_to_member();

insert into public.members (
  auth_user_id, home_location_id, full_name, email, phone, active
)
select
  p.id,
  p.location_id,
  coalesce(nullif(btrim(p.full_name), ''), u.email, 'Μέλος'),
  u.email,
  p.phone,
  p.active
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'customer'
on conflict (auth_user_id) do update set
  home_location_id = excluded.home_location_id,
  full_name = excluded.full_name,
  email = excluded.email,
  phone = excluded.phone,
  active = excluded.active;
