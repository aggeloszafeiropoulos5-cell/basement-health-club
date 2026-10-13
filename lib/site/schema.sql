-- Additive CMS schema; does not alter members, appointments or existing settings.
create schema if not exists private;
create or replace function private.site_can_manage() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
 and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role::text='owner')
 and exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
 and (coalesce(auth.jwt()->>'aal','aal1')='aal2' or not exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status::text='verified'));
$$;
revoke all on function private.site_can_manage() from public;
grant usage on schema private to authenticated;
grant execute on function private.site_can_manage() to authenticated;
create table if not exists public.site_drafts(id int primary key check(id=1),document jsonb not null,revision bigint not null default 1,updated_at timestamptz not null default now(),updated_by uuid);
create table if not exists public.site_publications(id int primary key check(id=1),document jsonb not null,revision bigint not null default 1,published_at timestamptz not null default now());
create table if not exists public.site_versions(id bigint generated always as identity primary key,document jsonb not null,kind text not null check(kind in('draft','published','restored','initial')),created_at timestamptz not null default now(),created_by uuid);
create table if not exists public.site_public_media(path text primary key);
create table if not exists public.site_backups(day date primary key default current_date,document jsonb not null,created_at timestamptz not null default now());
alter table public.site_drafts enable row level security;
alter table public.site_publications enable row level security;
alter table public.site_versions enable row level security;
alter table public.site_public_media enable row level security;
alter table public.site_backups enable row level security;
create policy site_drafts_owner on public.site_drafts for all to authenticated using((select private.site_can_manage())) with check((select private.site_can_manage()));
create policy site_publications_read on public.site_publications for select to anon,authenticated using(true);
create policy site_publications_owner on public.site_publications for all to authenticated using((select private.site_can_manage())) with check((select private.site_can_manage()));
create policy site_versions_owner_read on public.site_versions for select to authenticated using((select private.site_can_manage()));
create policy site_versions_owner_insert on public.site_versions for insert to authenticated with check((select private.site_can_manage()));
create policy site_media_read on public.site_public_media for select to anon,authenticated using(true);
create policy site_media_owner on public.site_public_media for all to authenticated using((select private.site_can_manage())) with check((select private.site_can_manage()));
create policy site_backups_owner_read on public.site_backups for select to authenticated using((select private.site_can_manage()));
revoke all on public.site_drafts,public.site_versions,public.site_backups from anon;
grant select,insert,update on public.site_drafts,public.site_publications to authenticated;
grant select,insert on public.site_versions to authenticated;
grant select on public.site_backups to authenticated;
grant select on public.site_publications,public.site_public_media to anon;
grant select,insert,delete on public.site_public_media to authenticated;
grant usage,select on sequence public.site_versions_id_seq to authenticated;
create or replace function private.site_validate(d jsonb) returns void language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(d)<>'object' or (d->>'schemaVersion') is distinct from '1' or jsonb_typeof(d->'pages')<>'array' or octet_length(d::text)>1500000 then raise exception 'Μη έγκυρο περιεχόμενο site';end if;
 if not exists(select 1 from jsonb_array_elements(d->'pages') p where p->>'slug'='') then raise exception 'Η αρχική σελίδα είναι υποχρεωτική';end if;
 if exists(select 1 from jsonb_array_elements(d->'pages') p where (p->>'slug')<>'' and ((p->>'slug')!~'^[a-z0-9]+([-\/][a-z0-9]+)*$' or (p->>'slug')~'^(admin|api|dashboard|login)(/|$)')) then raise exception 'Μη έγκυρο URL';end if;
 if exists(select 1 from jsonb_array_elements(d->'pages') p group by p->>'slug' having count(*)>1) then raise exception 'Διπλό URL';end if;
end;$$;
revoke all on function private.site_validate(jsonb) from public;
grant execute on function private.site_validate(jsonb) to authenticated;
create or replace function public.site_save_draft(p_document jsonb,p_expected bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r bigint;
begin
 if not private.site_can_manage() then raise insufficient_privilege using message='Πρόσβαση μόνο για τον ιδιοκτήτη. Ελέγξτε τη σύνδεση και το 2FA.';end if;
 perform private.site_validate(p_document);
 select revision into r from public.site_drafts where id=1 for update;
 if r is distinct from p_expected then raise exception 'Το πρόχειρο άλλαξε από άλλη συσκευή. Ανανέωσε πριν αποθηκεύσεις.';end if;
 update public.site_drafts set document=p_document,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=1 returning revision into r;
 insert into public.site_versions(document,kind,created_by) values(p_document,'draft',auth.uid());
 return jsonb_build_object('revision',r);
end;$$;
create or replace function public.site_publish(p_expected bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d jsonb;r bigint;
begin
 if not private.site_can_manage() then raise insufficient_privilege using message='Μη εξουσιοδοτημένη πρόσβαση';end if;
 select document,revision into d,r from public.site_drafts where id=1 for update;
 if r is distinct from p_expected then raise exception 'Το πρόχειρο άλλαξε. Ανανέωσε πριν δημοσιεύσεις.';end if;
 perform private.site_validate(d);
 insert into public.site_versions(document,kind,created_by) values(d,'published',auth.uid());
 update public.site_publications set document=d,revision=revision+1,published_at=now() where id=1 returning revision into r;
 delete from public.site_public_media where path is not null;
 insert into public.site_public_media(path) select distinct trim(both '"' from value::text) from jsonb_path_query(d-'media','$.**.path') value where trim(both '"' from value::text)~'^cms/[a-zA-Z0-9._-]+$' on conflict do nothing;
 insert into public.site_public_media(path) select distinct replace(trim(both '"' from value::text),'/api/site/media/','') from jsonb_path_query(d-'media','$.**') value where jsonb_typeof(value)='string' and trim(both '"' from value::text)~'^/api/site/media/cms/[a-zA-Z0-9._-]+$' on conflict do nothing;
 return jsonb_build_object('revision',r);
end;$$;
create or replace function public.site_restore(p_version bigint,p_expected bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d jsonb;r bigint;
begin
 if not private.site_can_manage() then raise insufficient_privilege using message='Μη εξουσιοδοτημένη πρόσβαση';end if;
 select document into d from public.site_versions where id=p_version;
 if d is null then raise exception 'Η έκδοση δεν βρέθηκε';end if;
 select revision into r from public.site_drafts where id=1 for update;
 if r is distinct from p_expected then raise exception 'Το πρόχειρο άλλαξε. Ανανέωσε πριν την επαναφορά.';end if;
 perform private.site_validate(d);
 update public.site_drafts set document=d,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=1 returning revision into r;
 insert into public.site_versions(document,kind,created_by) values(d,'restored',auth.uid());
 return jsonb_build_object('document',d,'revision',r);
end;$$;
revoke all on function public.site_save_draft(jsonb,bigint),public.site_publish(bigint),public.site_restore(bigint,bigint) from public,anon;
grant execute on function public.site_save_draft(jsonb,bigint),public.site_publish(bigint),public.site_restore(bigint,bigint) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('website-media','website-media',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime']) on conflict(id) do nothing;
create policy site_storage_owner_read on storage.objects for select to authenticated using(bucket_id='website-media' and (select private.site_can_manage()));
create policy site_storage_owner_insert on storage.objects for insert to authenticated with check(bucket_id='website-media' and name~'^cms/[a-zA-Z0-9._-]+$' and (select private.site_can_manage()));
-- Originals are immutable; replacement creates a new path. No delete policy: historical versions keep their files.
create policy site_storage_published_read on storage.objects for select to anon using(bucket_id='website-media' and exists(select 1 from public.site_public_media m where m.path=name));
create or replace function private.site_daily_backup() returns void language sql security definer set search_path='' as $$
 insert into public.site_backups(day,document) select current_date,jsonb_build_object('published',(select document from public.site_publications where id=1),'draft',(select document from public.site_drafts where id=1),'versions',(select jsonb_agg(to_jsonb(v)) from public.site_versions v)) on conflict(day) do update set document=excluded.document,created_at=now();
$$;
revoke all on function private.site_daily_backup() from public,anon,authenticated;
