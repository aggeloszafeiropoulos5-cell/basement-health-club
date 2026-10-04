-- Staff can reserve a current slot for a migrated member without an Auth login.
-- Historical BookUp rows remain read-only and no package credit is deducted here.
create or replace function public.basement_book_imported_member(p_slot_id bigint,p_member_id uuid)
returns uuid language plpgsql security invoker set search_path='public','pg_temp' as $$
declare
 v_slot public.basement_slots%rowtype;
 v_auth_user_id uuid;
 v_occupied integer;
 v_new_id uuid;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active and role in ('owner','admin','reception')) then
  raise exception 'Δεν επιτρέπεται η καταχώριση ραντεβού.';
 end if;
 select * into v_slot from public.basement_slots where id=p_slot_id for update;
 if not found or not v_slot.enabled or v_slot.starts_at<=now() then
  raise exception 'Η ώρα δεν είναι διαθέσιμη.';
 end if;
 select auth_user_id into v_auth_user_id from public.members where id=p_member_id;
 if not found then raise exception 'Το μέλος δεν βρέθηκε.'; end if;
 if v_auth_user_id is not null then raise exception 'Για αυτό το μέλος χρησιμοποίησε την κανονική κράτηση.'; end if;
 if exists(select 1 from public.bookup_bookings b where b.member_id=p_member_id and b.starts_at=v_slot.starts_at and b.source_status='CONFIRMED')
  or exists(select 1 from public.member_appointments a where a.member_id=p_member_id and a.starts_at=v_slot.starts_at and a.status='booked') then
  raise exception 'Το μέλος έχει ήδη ραντεβού αυτή την ώρα.';
 end if;
 select
  (select count(*) from public.basement_bookings b where b.slot_id=p_slot_id and b.status in ('pending','booked'))+
  (select count(*) from public.bookup_bookings b where b.starts_at=v_slot.starts_at and b.source_status='CONFIRMED' and (
    upper(btrim(b.service))=upper(btrim(v_slot.service)) or
    (v_slot.service='EMS Training' and upper(b.service) like 'EMS TRAINING%') or
    (v_slot.service='EMS Sculpting' and upper(b.service)='EMSCULPTING')
  ))+
  (select count(*) from public.member_appointments a where a.starts_at=v_slot.starts_at and a.status='booked' and a.service=v_slot.service)
 into v_occupied;
 if v_occupied>=v_slot.capacity then raise exception 'Η ώρα είναι πλήρης.'; end if;
 insert into public.member_appointments(member_id,starts_at,ends_at,service,status,created_by)
 values(p_member_id,v_slot.starts_at,v_slot.ends_at,v_slot.service,'booked',auth.uid()) returning id into v_new_id;
 return v_new_id;
end $$;
revoke all on function public.basement_book_imported_member(bigint,uuid) from public,anon;
grant execute on function public.basement_book_imported_member(bigint,uuid) to authenticated;
