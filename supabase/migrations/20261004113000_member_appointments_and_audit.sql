create table if not exists public.member_appointments(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.members(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 service text not null,
 trainer_name text,
 status text not null default 'booked' check(status in('booked','completed','cancelled','late_cancel','no_show')),
 notes text,
 created_at timestamptz not null default now(),
 created_by uuid default auth.uid()
);
create index if not exists member_appointments_member_time_idx on public.member_appointments(member_id,starts_at desc);
create index if not exists member_appointments_time_idx on public.member_appointments(starts_at);
alter table public.member_appointments enable row level security;
create policy member_appointments_staff on public.member_appointments for all to authenticated using(public.is_staff()) with check(public.is_staff());
create policy member_appointments_self on public.member_appointments for select to authenticated using(exists(select 1 from public.members m where m.id=member_id and m.auth_user_id=(select auth.uid())));
grant select,insert,update on public.member_appointments to authenticated;

-- Exact, reasoned balance changes; the existing audit table records actor and delta.
create or replace function public.basement_adjust_sessions(p_member_package_id uuid,p_change integer,p_reason text default null)
returns integer language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_role text;v_remaining integer;
begin
 select role into v_role from public.profiles where id=auth.uid() and active;
 if coalesce(v_role,'') not in ('owner','admin','reception') then raise exception 'Δεν επιτρέπεται η αλλαγή συνεδριών.'; end if;
 if p_change=0 or nullif(btrim(p_reason),'') is null then raise exception 'Απαιτείται μεταβολή και αιτιολογία.'; end if;
 select sessions_remaining into v_remaining from public.member_packages where id=p_member_package_id for update;
 if not found then raise exception 'Το πακέτο δεν βρέθηκε.'; end if;
 if v_remaining is null then raise exception 'Το απεριόριστο πακέτο δεν έχει αριθμητικό υπόλοιπο.'; end if;
 if v_remaining+p_change<0 then raise exception 'Το υπόλοιπο δεν μπορεί να γίνει αρνητικό.'; end if;
 update public.member_packages set sessions_remaining=v_remaining+p_change where id=p_member_package_id;
 insert into public.manual_session_adjustments(member_package_id,change,reason,actor_id) values(p_member_package_id,p_change,btrim(p_reason),auth.uid());
 return v_remaining+p_change;
end $$;
