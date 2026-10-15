-- Personal training portal. All helpers are SECURITY INVOKER; access is enforced by RLS.
create schema fitness_private;
revoke all on schema fitness_private from public,anon;
grant usage on schema fitness_private to authenticated;
create function fitness_private.owner() returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and active and role::text in ('owner','admin'));
$$;
create table public.member_training_access(
 member_id uuid primary key references public.members(id) on delete cascade,
 training_type text not null default 'other' check(training_type in ('other','cross','weights')),
 show_programs boolean not null default true,show_measurements boolean not null default true,show_nutrition boolean not null default true
);
alter table public.member_training_access enable row level security;
revoke all on public.member_training_access from public,anon,authenticated;
grant select,insert,update on public.member_training_access to authenticated;
create policy fitness_access_read on public.member_training_access for select to authenticated using(fitness_private.owner() or exists(select 1 from public.members m join public.profiles p on p.id=m.auth_user_id where m.id=member_id and m.auth_user_id=(select auth.uid()) and m.active and p.active and p.role::text='customer'));
create policy fitness_access_insert on public.member_training_access for insert to authenticated with check(fitness_private.owner());
create policy fitness_access_update on public.member_training_access for update to authenticated using(fitness_private.owner()) with check(fitness_private.owner());
create function fitness_private.allowed(mid uuid,kind text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.members m join public.profiles p on p.id=m.auth_user_id left join public.member_training_access a on a.member_id=m.id
 where m.id=mid and m.auth_user_id=(select auth.uid()) and m.active and p.active and p.role::text='customer' and case kind
 when 'programs' then coalesce(a.show_programs,true) when 'measurements' then coalesce(a.show_measurements,true)
 when 'nutrition' then coalesce(a.show_nutrition,true) when 'weights' then coalesce(a.show_programs,true) and a.training_type in ('cross','weights') else false end);
$$;
create table public.member_workout_plans(
 id uuid primary key default gen_random_uuid(),member_id uuid not null references public.members(id) on delete restrict,
 title text not null check(length(btrim(title)) between 1 and 160),category text not null check(category in ('cross','weights','ems','general')),
 starts_on date not null,ends_on date check(ends_on is null or ends_on>=starts_on),status text not null default 'draft' check(status in ('draft','published','archived')),
 content jsonb not null,revision integer not null default 1,updated_at timestamptz not null default now()
);
create index workout_member_updated on public.member_workout_plans(member_id,updated_at desc);
alter table public.member_workout_plans enable row level security;
revoke all on public.member_workout_plans from public,anon,authenticated;
grant select on public.member_workout_plans to authenticated;
grant insert(member_id,title,category,starts_on,ends_on,status,content),update(title,category,starts_on,ends_on,status,content) on public.member_workout_plans to authenticated;
create policy workout_owner_read on public.member_workout_plans for select to authenticated using(fitness_private.owner());
create policy workout_member_read on public.member_workout_plans for select to authenticated using(status='published' and fitness_private.allowed(member_id,'programs'));
create policy workout_owner_insert on public.member_workout_plans for insert to authenticated with check(fitness_private.owner());
create policy workout_owner_update on public.member_workout_plans for update to authenticated using(fitness_private.owner()) with check(fitness_private.owner());
create function fitness_private.validate_plan() returns trigger language plpgsql security invoker set search_path='' as $$
 declare day_value jsonb;ex jsonb;v text;ids text[]:=array[]::text[];
 begin
  if jsonb_typeof(new.content) is distinct from 'object' or octet_length(new.content::text)>200000 then raise exception 'Μη έγκυρο πρόγραμμα.';end if;
  if jsonb_typeof(new.content->'notes') is distinct from 'string' or length(new.content->>'notes')>8000 or jsonb_typeof(new.content->'days') is distinct from 'array' then raise exception 'Έλεγξε τις ημέρες και τις οδηγίες.';end if;
  if jsonb_array_length(new.content->'days') not between 1 and 14 then raise exception 'Πρόσθεσε 1 έως 14 ημέρες.';end if;
  for day_value in select value from jsonb_array_elements(new.content->'days') loop
   if jsonb_typeof(day_value->'title') is distinct from 'string' or length(btrim(day_value->>'title')) not between 1 and 120 or jsonb_typeof(day_value->'exercises') is distinct from 'array' then raise exception 'Μη έγκυρη ημέρα.';end if;
   if jsonb_array_length(day_value->'exercises') not between 1 and 50 then raise exception 'Κάθε ημέρα χρειάζεται 1 έως 50 ασκήσεις.';end if;
   for ex in select value from jsonb_array_elements(day_value->'exercises') loop
    foreach v in array array['id','name','reps','video_url','notes'] loop
     if jsonb_typeof(ex->v) is distinct from 'string' or length(ex->>v)>2000 then raise exception 'Έλεγξε τα πεδία άσκησης.';end if;
    end loop;
    if length(btrim(ex->>'name')) not between 1 and 160 or length(ex->>'id') not between 1 and 100 or (ex->>'id')=any(ids) then raise exception 'Χρειάζεται όνομα και μοναδικός κωδικός άσκησης.';end if;
    ids:=array_append(ids,ex->>'id');
    if jsonb_typeof(ex->'sets') is distinct from 'number' or (ex->>'sets')!~'^[0-9]+$' or (ex->>'sets')::numeric not between 1 and 100 then raise exception 'Τα σετ πρέπει να είναι 1 έως 100.';end if;
    if jsonb_typeof(ex->'rest_seconds') is distinct from 'number' or (ex->>'rest_seconds')!~'^[0-9]+$' or (ex->>'rest_seconds')::numeric not between 0 and 3600 then raise exception 'Μη έγκυρο διάλειμμα.';end if;
    if ex->>'video_url'<>'' and (ex->>'video_url')!~'^https://[^[:space:]]+$' then raise exception 'Το βίντεο χρειάζεται ασφαλή σύνδεσμο HTTPS.';end if;
   end loop;
  end loop;
  if tg_op='UPDATE' then new.revision:=old.revision+1;else new.revision:=1;end if;new.updated_at:=now();return new;
 end;
$$;
create trigger fitness_plan_validate before insert or update on public.member_workout_plans for each row execute function fitness_private.validate_plan();
create table public.member_exercise_logs(
 id uuid primary key default gen_random_uuid(),member_id uuid not null references public.members(id) on delete restrict,
 plan_id uuid not null references public.member_workout_plans(id) on delete restrict,exercise_id text not null,exercise_name text not null default '',
 performed_on date not null default current_date,set_number integer not null check(set_number between 1 and 100),
 weight_kg numeric(7,2) not null check(weight_kg>=0 and weight_kg<=1500),reps integer not null check(reps between 0 and 10000),
 notes text not null default '' check(length(notes)<=2000),created_at timestamptz not null default now()
);
create index exercise_logs_member_date on public.member_exercise_logs(member_id,performed_on desc);
alter table public.member_exercise_logs enable row level security;
revoke all on public.member_exercise_logs from public,anon,authenticated;
grant select on public.member_exercise_logs to authenticated;
grant insert(member_id,plan_id,exercise_id,performed_on,set_number,weight_kg,reps,notes),update(performed_on,set_number,weight_kg,reps,notes) on public.member_exercise_logs to authenticated;
create policy exercise_owner_read on public.member_exercise_logs for select to authenticated using(fitness_private.owner());
create policy exercise_member_read on public.member_exercise_logs for select to authenticated using(fitness_private.allowed(member_id,'weights'));
create policy exercise_member_insert on public.member_exercise_logs for insert to authenticated with check(fitness_private.allowed(member_id,'weights') and exists(select 1 from public.member_workout_plans p where p.id=plan_id and p.member_id=member_exercise_logs.member_id and p.category in ('cross','weights') and p.status='published'));
create policy exercise_member_update on public.member_exercise_logs for update to authenticated using(fitness_private.allowed(member_id,'weights')) with check(fitness_private.allowed(member_id,'weights'));
create function fitness_private.validate_log() returns trigger language plpgsql security invoker set search_path='' as $$
 declare n text;
 begin
  if new.performed_on<'2000-01-01'::date or new.performed_on>(now() at time zone 'Europe/Athens')::date then raise exception 'Επίλεξε ημερομηνία έως σήμερα.';end if;
  if tg_op='INSERT' then
   select e->>'name' into n from public.member_workout_plans p cross join lateral jsonb_array_elements(p.content->'days') d cross join lateral jsonb_array_elements(d->'exercises') e where p.id=new.plan_id and p.member_id=new.member_id and e->>'id'=new.exercise_id and p.status='published' and p.category in ('cross','weights');
   if n is null then raise exception 'Η άσκηση δεν ανήκει σε διαθέσιμο πρόγραμμα Cross ή βαρών.';end if;new.exercise_name:=n;
  end if;
  return new;
 end;
$$;
create trigger fitness_log_validate before insert or update on public.member_exercise_logs for each row execute function fitness_private.validate_log();
alter table public.member_measurements add column hips_cm numeric(6,2),add column chest_cm numeric(6,2),add column thigh_cm numeric(6,2),add column arm_cm numeric(6,2);
alter policy member_read_measurements on public.member_measurements using(fitness_private.allowed(member_id,'measurements'));
create policy fitness_measure_insert on public.member_measurements for insert to authenticated with check(fitness_private.allowed(member_id,'measurements') and created_by=(select auth.uid()));
create policy fitness_measure_update on public.member_measurements for update to authenticated using(fitness_private.allowed(member_id,'measurements') and created_by=(select auth.uid())) with check(fitness_private.allowed(member_id,'measurements') and created_by=(select auth.uid()));
create function fitness_private.validate_measurement() returns trigger language plpgsql security invoker set search_path='' as $$
 declare key text;amount numeric;filled boolean:=false;
 begin
  if public.is_staff() then return new;end if;
  if not fitness_private.allowed(new.member_id,'measurements') then raise exception 'Δεν επιτρέπεται η καταχώριση.';end if;
  if tg_op='UPDATE' and (new.member_id is distinct from old.member_id or new.created_by is distinct from old.created_by or old.created_by is distinct from auth.uid()) then raise exception 'Μπορείς να διορθώσεις μόνο δική σου καταχώριση.';end if;
  if tg_op='INSERT' then new.created_by:=auth.uid();end if;
  if new.measured_on<'2000-01-01'::date or new.measured_on>(now() at time zone 'Europe/Athens')::date then raise exception 'Επίλεξε ημερομηνία έως σήμερα.';end if;
  foreach key in array array['weight_kg','body_fat_percent','waist_cm','hips_cm','chest_cm','thigh_cm','arm_cm'] loop
   if to_jsonb(new)->>key is not null then
    amount:=(to_jsonb(new)->>key)::numeric;filled:=true;
    if amount::text in ('NaN','Infinity','-Infinity') or amount<0 or amount>1000 or (key='body_fat_percent' and amount>100) then raise exception 'Έλεγξε τις τιμές των μετρήσεων.';end if;
   end if;
  end loop;
  if not filled or length(coalesce(new.notes,''))>2000 then raise exception 'Συμπλήρωσε τουλάχιστον μία μέτρηση.';end if;
  return new;
 end;
$$;
create trigger fitness_measure_validate before insert or update on public.member_measurements for each row execute function fitness_private.validate_measurement();
alter policy nutrition_member_read on public.nutrition_plans using(status='published' and fitness_private.allowed(member_id,'nutrition'));
revoke all on all functions in schema fitness_private from public,anon,authenticated;
grant execute on function fitness_private.owner(),fitness_private.allowed(uuid,text) to authenticated;
notify pgrst,'reload schema';
