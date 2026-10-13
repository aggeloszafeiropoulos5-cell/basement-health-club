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
 delete from public.site_public_media;
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

insert into public.site_drafts(id,document) values(1,$site_seed${
  "schemaVersion": 1,
  "branding": {
    "name": "BASEMENT",
    "subtitle": "HEALTH CLUB · EST. 2015",
    "logo": {
      "id": "logo",
      "url": "/basement-logo.jpeg",
      "type": "image",
      "alt": "Basement Health Club",
      "fit": "cover",
      "position": "50% 50%"
    },
    "footerSubtitle": "HEALTH CLUB",
    "copyright": "© 2015–2026 Basement Health Club · Πετρούπολη"
  },
  "theme": {
    "accent": "#8a43ef",
    "background": "#080a0e",
    "text": "#f6f5f8",
    "font": "Arial",
    "buttonRadius": 8
  },
  "contact": {
    "name": "BASEMENT HEALTH CLUB",
    "phone": "6983389353",
    "email": "",
    "address": "Ι. Ξενίδη 5, Πετρούπολη 132 31",
    "maps": "https://www.google.com/maps/search/?api=1&query=THE%20BASEMENT%20HEALTH%20CLUB%20Petroupoli"
  },
  "bookup": {
    "url": "https://www.basementhealthclub.bookup.gr/",
    "ios": "https://apps.apple.com/app/id6621263567",
    "android": "https://play.google.com/store/apps/details?id=gr.bookup.basementhealthclub.www.twa",
    "label": "ΚΛΕΙΣΕ ΡΑΝΤΕΒΟΥ"
  },
  "navigation": [],
  "footerLinks": [],
  "social": {
    "instagram": "",
    "facebook": "",
    "tiktok": "",
    "youtube": "",
    "whatsapp": ""
  },
  "pages": [
    {
      "id": "home",
      "slug": "",
      "title": "Αρχική σελίδα",
      "visible": true,
      "seo": {
        "title": "Basement Health Club",
        "description": "Online κρατήσεις και υπηρεσίες του Basement Health Club.",
        "image": "/basement-logo.jpeg"
      },
      "sections": [
        {
          "id": "hero",
          "type": "hero",
          "title": "Προπόνηση με",
          "body": "Μικρά group, προσωπική επίβλεψη και διαφορετικοί τρόποι προπόνησης σε έναν χώρο που σε γνωρίζει με το όνομά σου.",
          "eyebrow": "BASEMENT HEALTH CLUB · ΠΕΤΡΟΥΠΟΛΗ",
          "accent": "καθοδήγηση.",
          "hidden": false,
          "buttons": [
            {
              "id": "b61d929f-4ecc-4fdb-80c4-00a2f36ca742",
              "label": "Γνώρισε τις υπηρεσίες →",
              "url": "#services",
              "variant": "primary",
              "position": "left"
            },
            {
              "id": "2700aeeb-81ed-4246-a489-0fd377a40d4e",
              "label": "Κάλεσέ μας",
              "url": "tel:+306983389353",
              "variant": "primary",
              "position": "left"
            }
          ],
          "media": [
            {
              "id": "logo",
              "url": "/basement-logo.jpeg",
              "type": "image",
              "alt": "Basement Health Club",
              "fit": "cover",
              "position": "50% 50%"
            }
          ],
          "items": [
            {
              "id": "caption",
              "title": "Ι. Ξενίδη 5 · Πετρούπολη"
            }
          ],
          "style": {
            "background": "",
            "color": "",
            "align": "left",
            "padding": 0,
            "fontSize": 0,
            "columns": 0,
            "maxWidth": 0
          }
        },
        {
          "id": "strip",
          "type": "strip",
          "title": "EST. 2015",
          "body": "",
          "eyebrow": "",
          "accent": "",
          "hidden": false,
          "buttons": [],
          "media": [],
          "items": [
            {
              "id": "strip-0",
              "title": "Μικρά group"
            },
            {
              "id": "strip-1",
              "title": "Προσωπική καθοδήγηση"
            },
            {
              "id": "strip-2",
              "title": "Πολλαπλές υπηρεσίες"
            }
          ],
          "style": {
            "background": "",
            "color": "",
            "align": "left",
            "padding": 0,
            "fontSize": 0,
            "columns": 0,
            "maxWidth": 0
          }
        },
        {
          "id": "services",
          "type": "services",
          "title": "Βρες αυτό που ταιριάζει στον στόχο σου",
          "body": "Δες τι είναι κάθε υπηρεσία και τι μπορεί να σου προσφέρει. Η ομάδα του Basement σε βοηθά να επιλέξεις με βάση το επίπεδο και τον στόχο σου.",
          "eyebrow": "ΟΙ ΥΠΗΡΕΣΙΕΣ ΜΑΣ",
          "accent": "",
          "hidden": false,
          "buttons": [],
          "media": [],
          "items": [],
          "style": {
            "background": "",
            "color": "",
            "align": "left",
            "padding": 0,
            "fontSize": 0,
            "columns": 0,
            "maxWidth": 0
          }
        },
        {
          "id": "reviews",
          "type": "reviews",
          "title": "Τι λένε τα μέλη μας",
          "body": "",
          "eyebrow": "ΑΞΙΟΛΟΓΗΣΕΙΣ",
          "accent": "5.0",
          "hidden": false,
          "buttons": [
            {
              "id": "820a0653-d4a3-476f-8e4e-88337b59c842",
              "label": "Δες όλες τις αξιολογήσεις",
              "url": "https://www.google.com/maps/search/?api=1&query=THE%20BASEMENT%20HEALTH%20CLUB%20Petroupoli",
              "variant": "primary",
              "position": "left"
            },
            {
              "id": "9709e8bb-783a-4ba8-973f-d7c4bdecc289",
              "label": "Γράψε αξιολόγηση →",
              "url": "https://www.google.com/maps/search/?api=1&query=THE%20BASEMENT%20HEALTH%20CLUB%20Petroupoli",
              "variant": "primary",
              "position": "left"
            }
          ],
          "media": [],
          "items": [
            {
              "id": "review-0",
              "title": "Βασιλική",
              "body": "Πολύ καθαρός χώρος, φιλικό και καταρτισμένο προσωπικό.",
              "tag": "Google"
            },
            {
              "id": "review-1",
              "title": "Μαρία",
              "body": "Φιλικό περιβάλλον και σωστή δουλειά στα EMS groups.",
              "tag": "Google"
            },
            {
              "id": "review-2",
              "title": "Φρύνη",
              "body": "Οι γυμναστές δείχνουν ενδιαφέρον, δίνουν σωστές οδηγίες και σε κάνουν να νιώθεις άνετα.",
              "tag": "Google"
            }
          ],
          "style": {
            "background": "",
            "color": "",
            "align": "left",
            "padding": 0,
            "fontSize": 0,
            "columns": 0,
            "maxWidth": 0
          }
        },
        {
          "id": "contact",
          "type": "contact",
          "title": "BASEMENT HEALTH CLUB",
          "body": "",
          "eyebrow": "ΒΡΕΣ ΜΑΣ",
          "accent": "",
          "hidden": false,
          "buttons": [],
          "media": [],
          "items": [],
          "style": {
            "background": "",
            "color": "",
            "align": "left",
            "padding": 0,
            "fontSize": 0,
            "columns": 0,
            "maxWidth": 0
          }
        },
        {
          "id": "portal",
          "type": "bookup",
          "title": "Οι κρατήσεις σου σε ένα σημείο.",
          "body": "Κλείσε και διαχειρίσου τα ραντεβού σου στην εφαρμογή Basement Health Club ή στη διαδικτυακή πλατφόρμα Bookup.",
          "eyebrow": "ΓΙΑ ΤΑ ΜΕΛΗ",
          "accent": "",
          "hidden": false,
          "buttons": [],
          "media": [],
          "items": [],
          "style": {
            "background": "",
            "color": "",
            "align": "left",
            "padding": 0,
            "fontSize": 0,
            "columns": 0,
            "maxWidth": 0
          }
        }
      ]
    },
    {
      "id": "service-0",
      "slug": "services/cross-training",
      "title": "Cross Training",
      "visible": true,
      "serviceId": "service-0",
      "seo": {
        "title": "Cross Training | Basement Health Club",
        "description": "Ομαδική λειτουργική προπόνηση με βάρη, ασκήσεις ενδυνάμωσης και conditioning, με καθοδήγηση προπονητή.",
        "image": ""
      },
      "sections": []
    },
    {
      "id": "service-1",
      "slug": "services/ems-training",
      "title": "EMS Training",
      "visible": true,
      "serviceId": "service-1",
      "seo": {
        "title": "EMS Training | Basement Health Club",
        "description": "Προπόνηση με ηλεκτρομυοδιέγερση και ταυτόχρονη εκτέλεση ασκήσεων, σε μικρά group έως 3 ατόμων.",
        "image": ""
      },
      "sections": []
    },
    {
      "id": "service-2",
      "slug": "services/personal-training",
      "title": "Personal Training",
      "visible": true,
      "serviceId": "service-2",
      "seo": {
        "title": "Personal Training | Basement Health Club",
        "description": "Ατομικό πρόγραμμα προπόνησης σχεδιασμένο γύρω από τον στόχο, το επίπεδο και την πρόοδό σου.",
        "image": ""
      },
      "sections": []
    },
    {
      "id": "service-3",
      "slug": "services/boxing-kick-boxing",
      "title": "Boxing / Kick Boxing",
      "visible": true,
      "serviceId": "service-3",
      "seo": {
        "title": "Boxing / Kick Boxing | Basement Health Club",
        "description": "Προπόνηση τεχνικής πυγμαχίας και kick boxing με έμφαση στον συντονισμό, την αντοχή και τη φυσική κατάσταση.",
        "image": ""
      },
      "sections": []
    },
    {
      "id": "service-4",
      "slug": "services/vacu-power",
      "title": "Vacu Power",
      "visible": true,
      "serviceId": "service-4",
      "seo": {
        "title": "Vacu Power | Basement Health Club",
        "description": "Αερόβια άσκηση σε ειδικό μηχάνημα Vacu Power, ως συμπληρωματική επιλογή στο πρόγραμμα άσκησής σου.",
        "image": ""
      },
      "sections": []
    },
    {
      "id": "service-5",
      "slug": "services/ems-sculpting",
      "title": "EMS Sculpting",
      "visible": true,
      "serviceId": "service-5",
      "seo": {
        "title": "EMS Sculpting | Basement Health Club",
        "description": "Συνεδρία μυϊκής διέγερσης HIFEM για επιλεγμένες περιοχές, ως συμπληρωματική υπηρεσία και όχι υποκατάστατο άσκησης.",
        "image": ""
      },
      "sections": []
    },
    {
      "id": "ultratech-ems",
      "slug": "services/ultratech-ems",
      "title": "UltraTech EMS",
      "visible": true,
      "serviceId": "ultratech-ems",
      "seo": {
        "title": "UltraTech EMS | Basement Health Club",
        "description": "",
        "image": ""
      },
      "sections": []
    },
    {
      "id": "vibrosauna",
      "slug": "services/vibrosauna",
      "title": "Vibrosauna",
      "visible": true,
      "serviceId": "vibrosauna",
      "seo": {
        "title": "Vibrosauna | Basement Health Club",
        "description": "",
        "image": ""
      },
      "sections": []
    },
    {
      "id": "diatrofi",
      "slug": "services/diatrofi",
      "title": "Διατροφή",
      "visible": true,
      "serviceId": "diatrofi",
      "seo": {
        "title": "Διατροφή | Basement Health Club",
        "description": "",
        "image": ""
      },
      "sections": []
    }
  ],
  "services": [
    {
      "id": "service-0",
      "slug": "cross-training",
      "title": "Cross Training",
      "tag": "Δύναμη · αντοχή · ομάδα",
      "body": "Ομαδική λειτουργική προπόνηση με βάρη, ασκήσεις ενδυνάμωσης και conditioning, με καθοδήγηση προπονητή.",
      "bullets": [
        "Βελτίωση δύναμης και φυσικής κατάστασης",
        "Μικρά τμήματα και επίβλεψη",
        "Ποικιλία στην προπόνηση"
      ],
      "media": [],
      "buttons": [],
      "visible": true,
      "price": "",
      "offer": ""
    },
    {
      "id": "service-1",
      "slug": "ems-training",
      "title": "EMS Training",
      "tag": "Ολόσωμη ηλεκτρομυοδιέγερση",
      "body": "Προπόνηση με ηλεκτρομυοδιέγερση και ταυτόχρονη εκτέλεση ασκήσεων, σε μικρά group έως 3 ατόμων.",
      "bullets": [
        "Σύντομη και οργανωμένη συνεδρία",
        "Ελεγχόμενη ένταση ανά μυϊκή ομάδα",
        "Προσωπική καθοδήγηση"
      ],
      "media": [],
      "buttons": [],
      "visible": true,
      "price": "",
      "offer": ""
    },
    {
      "id": "service-2",
      "slug": "personal-training",
      "title": "Personal Training",
      "tag": "1 προς 1 προπόνηση",
      "body": "Ατομικό πρόγραμμα προπόνησης σχεδιασμένο γύρω από τον στόχο, το επίπεδο και την πρόοδό σου.",
      "bullets": [
        "100% προσωπική επίβλεψη",
        "Πρόγραμμα προσαρμοσμένο σε εσένα",
        "Συστηματική παρακολούθηση προόδου"
      ],
      "media": [],
      "buttons": [],
      "visible": true,
      "price": "",
      "offer": ""
    },
    {
      "id": "service-3",
      "slug": "boxing-kick-boxing",
      "title": "Boxing / Kick Boxing",
      "tag": "Τεχνική · φυσική κατάσταση",
      "body": "Προπόνηση τεχνικής πυγμαχίας και kick boxing με έμφαση στον συντονισμό, την αντοχή και τη φυσική κατάσταση.",
      "bullets": [
        "Cardio και αντοχή",
        "Συντονισμός και τεχνική",
        "Δυναμική προπόνηση"
      ],
      "media": [],
      "buttons": [],
      "visible": true,
      "price": "",
      "offer": ""
    },
    {
      "id": "service-4",
      "slug": "vacu-power",
      "title": "Vacu Power",
      "tag": "Cardio σε ειδικό εξοπλισμό",
      "body": "Αερόβια άσκηση σε ειδικό μηχάνημα Vacu Power, ως συμπληρωματική επιλογή στο πρόγραμμα άσκησής σου.",
      "bullets": [
        "Αερόβια δραστηριότητα",
        "Εύκολη ένταξη στο εβδομαδιαίο πρόγραμμα",
        "Καθοδηγούμενη χρήση"
      ],
      "media": [],
      "buttons": [],
      "visible": true,
      "price": "",
      "offer": ""
    },
    {
      "id": "service-5",
      "slug": "ems-sculpting",
      "title": "EMS Sculpting",
      "tag": "HIFEM μυϊκή διέγερση",
      "body": "Συνεδρία μυϊκής διέγερσης HIFEM για επιλεγμένες περιοχές, ως συμπληρωματική υπηρεσία και όχι υποκατάστατο άσκησης.",
      "bullets": [
        "Στοχευμένη εφαρμογή",
        "Μη επεμβατική συνεδρία",
        "Συνδυάζεται με πρόγραμμα άσκησης"
      ],
      "media": [],
      "buttons": [],
      "visible": true,
      "price": "",
      "offer": ""
    },
    {
      "id": "ultratech-ems",
      "slug": "ultratech-ems",
      "title": "UltraTech EMS",
      "tag": "",
      "body": "",
      "bullets": [],
      "media": [],
      "buttons": [],
      "visible": false,
      "price": "",
      "offer": ""
    },
    {
      "id": "vibrosauna",
      "slug": "vibrosauna",
      "title": "Vibrosauna",
      "tag": "",
      "body": "",
      "bullets": [],
      "media": [],
      "buttons": [],
      "visible": false,
      "price": "",
      "offer": ""
    },
    {
      "id": "diatrofi",
      "slug": "diatrofi",
      "title": "Διατροφή",
      "tag": "",
      "body": "",
      "bullets": [],
      "media": [],
      "buttons": [],
      "visible": false,
      "price": "",
      "offer": ""
    }
  ],
  "offers": [],
  "media": [
    {
      "id": "logo",
      "url": "/basement-logo.jpeg",
      "type": "image",
      "alt": "Basement Health Club",
      "fit": "cover",
      "position": "50% 50%"
    }
  ]
}$site_seed$::jsonb) on conflict(id) do nothing;
insert into public.site_publications(id,document) select id,document from public.site_drafts where id=1 on conflict(id) do nothing;
insert into public.site_versions(document,kind) select document,'initial' from public.site_publications where id=1 and not exists(select 1 from public.site_versions);
select private.site_daily_backup();
select cron.schedule('basement-site-content-backup','0 2 * * *','select private.site_daily_backup()');
