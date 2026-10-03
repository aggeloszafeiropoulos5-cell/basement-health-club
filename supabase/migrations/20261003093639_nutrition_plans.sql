-- Nutrition plans: owners edit; members read only their own published plans.
create table public.nutrition_plans (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.members(id) on delete restrict,
 title text not null check(length(btrim(title)) between 1 and 160),
 starts_on date not null,
 ends_on date check(ends_on is null or ends_on>=starts_on),
 status text not null default 'draft' check(status in ('draft','published','archived')),
 content jsonb not null,
 revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index nutrition_plans_member_updated on public.nutrition_plans(member_id,updated_at desc);
alter table public.nutrition_plans enable row level security;
revoke all on public.nutrition_plans from anon,authenticated;
grant select on public.nutrition_plans to authenticated;
grant insert(member_id,title,starts_on,ends_on,status,content), update(member_id,title,starts_on,ends_on,status,content) on public.nutrition_plans to authenticated;
create policy nutrition_owner_read on public.nutrition_plans for select to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and active and role::text in ('owner','admin')));
create policy nutrition_member_read on public.nutrition_plans for select to authenticated using(status='published' and exists(select 1 from public.members where id=member_id and auth_user_id=(select auth.uid())));
create policy nutrition_owner_insert on public.nutrition_plans for insert to authenticated with check(exists(select 1 from public.profiles where id=(select auth.uid()) and active and role::text in ('owner','admin')));
create policy nutrition_owner_update on public.nutrition_plans for update to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and active and role::text in ('owner','admin'))) with check(exists(select 1 from public.profiles where id=(select auth.uid()) and active and role::text in ('owner','admin')));
create function basement_private.validate_nutrition_plan() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare day_value jsonb; meal_value jsonb; field_name text; filled boolean:=false; amount numeric;
begin
 if jsonb_typeof(new.content) is distinct from 'object' or octet_length(new.content::text)>500000 then raise exception 'Μη έγκυρο πλάνο διατροφής.';end if;
 foreach field_name in array array['goal','preferences','notes'] loop
  if jsonb_typeof(new.content->field_name) is distinct from 'string' or length(new.content->>field_name)>8000 then raise exception 'Μη έγκυρες οδηγίες πλάνου.';end if;
 end loop;
 if jsonb_typeof(new.content->'days') is distinct from 'array' then raise exception 'Το πλάνο χρειάζεται επτά ημέρες.';end if;
 if jsonb_array_length(new.content->'days')<>7 then raise exception 'Το πλάνο χρειάζεται επτά ημέρες.';end if;
 for day_value in select value from jsonb_array_elements(new.content->'days') loop
  if jsonb_typeof(day_value) is distinct from 'array' then raise exception 'Μη έγκυρη ημέρα.';end if;
  if jsonb_array_length(day_value)>20 then raise exception 'Έως 20 γεύματα ανά ημέρα.';end if;
  for meal_value in select value from jsonb_array_elements(day_value) loop
   if jsonb_typeof(meal_value) is distinct from 'object' then raise exception 'Μη έγκυρο γεύμα.';end if;
   foreach field_name in array array['name','time','food','quantity','alternative','kcal','protein','carbs','fat'] loop
    if jsonb_typeof(meal_value->field_name) is distinct from 'string' or length(meal_value->>field_name)>4000 then raise exception 'Μη έγκυρο πεδίο γεύματος.';end if;
   end loop;
   if length(meal_value->>'name')>120 or ((meal_value->>'time')<>'' and (meal_value->>'time')!~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Έλεγξε το όνομα και την ώρα γεύματος.';end if;
   if length(btrim(meal_value->>'food'))>0 then filled:=true;end if;
   foreach field_name in array array['kcal','protein','carbs','fat'] loop
    if meal_value->>field_name<>'' then
     begin amount:=(meal_value->>field_name)::numeric;exception when others then raise exception 'Μη έγκυρη διατροφική τιμή.';end;
     if amount<0 or amount>100000 or amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Μη έγκυρη διατροφική τιμή.';end if;
    end if;
   end loop;
  end loop;
 end loop;
 if new.status='published' and not filled then raise exception 'Πρόσθεσε τρόφιμα πριν δημοσιεύσεις το πλάνο.';end if;
 if tg_op='UPDATE' then new.revision:=old.revision+1;new.created_at:=old.created_at;else new.revision:=1;end if;
 new.updated_at:=now();return new;
end $$;
revoke all on function basement_private.validate_nutrition_plan() from public,anon,authenticated;
create trigger nutrition_plan_validate before insert or update on public.nutrition_plans for each row execute function basement_private.validate_nutrition_plan();
notify pgrst,'reload schema';
