-- Idempotent Bookup member import support.
-- The source-specific fields preserve the exported data without turning
-- placeholder Bookup addresses into login emails.

alter table public.members
  add column if not exists external_source text,
  add column if not exists external_id text,
  add column if not exists source_email text,
  add column if not exists source_row integer,
  add column if not exists source_import_status text,
  add column if not exists source_review_notes text,
  add column if not exists source_sessions_remaining integer,
  add column if not exists source_unlimited boolean,
  add column if not exists source_subscription_expires_on date,
  add column if not exists source_future_appointments_count integer not null default 0,
  add column if not exists source_total_bookings integer not null default 0,
  add column if not exists source_out_of_subscription integer not null default 0,
  add column if not exists source_payment_code text;

create unique index if not exists members_external_source_id_uidx
  on public.members(external_source, external_id);

alter table public.member_packages
  add column if not exists external_source text,
  add column if not exists external_id text;

create unique index if not exists member_packages_external_source_id_uidx
  on public.member_packages(external_source, external_id);

comment on column public.members.external_source is
  'Origin system for an imported member record, for example bookup.';
comment on column public.members.external_id is
  'Stable identifier from the origin system; used to make imports idempotent.';
comment on column public.members.source_email is
  'Email exactly as exported by the origin system, including non-login placeholders.';
comment on column public.member_packages.external_id is
  'Stable source package key used to prevent duplicate imported packages.';
