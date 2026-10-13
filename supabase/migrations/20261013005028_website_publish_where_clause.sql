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
