# Basement Health Club Control Center

Independent public website, Member Portal and Owner Dashboard for the Basement Health Club.

## Vercel setting

Member creation is performed only by the owner through a protected server route. Add the Supabase server secret in Vercel as an environment variable named `SUPABASE_SECRET_KEY`. Never place this value in browser code or commit it to GitHub.

## Routes

- `/` public website
- `/login` independent member/owner login
- `/dashboard` role-aware Owner Dashboard or Member Portal
- `/api/admin/create-member` protected owner-only member creation

## Control Center

- Live overview for members, bookings, active packages and services.
- 14-day booking calendar with capacity locking and owner controls.
- Owner-only member creation, with automatic member-record synchronisation.
- Package templates, package assignment and remaining-session visibility.
- Service duration, capacity, booking and waiting-list settings.
- Public landing page and in-page secure login/recovery modal.

## Session repair

Access tokens refresh before expiry and after an explicit authentication rejection. Parallel refreshes share one request; browsers with Web Locks also coordinate tabs. Transient service errors preserve the saved session. Opening `/login` always allows a fresh sign-in. The owner-only member endpoint reports upstream authentication failures separately from expired sessions and rejected server keys. Member creation is retried only after an explicit pre-creation session rejection.

Validation: `node --test tests/auth-session.test.cjs`, `npx tsc --noEmit`, and `npm run build`. Live account creation still requires verification after deployment.

## Customer role compatibility

This project uses the existing `public.user_role` value `customer` for member accounts. Owner/admin permissions are unchanged. For an existing database, run `supabase/002_customer_role.sql` in the Supabase SQL Editor; it replaces only the member role check in the existing booking function, preserving its other logic, settings, and grants. It does not change existing profiles, enum values, slots, or bookings. New installations should use the updated `001_bookings.sql`. The member endpoint reports success only after Supabase returns the matching saved customer profile.

`supabase/003_sync_customer_members.sql` keeps `profiles` and `members` synchronised so every customer account can receive packages. It has already been applied to the connected production Supabase project and remains in source control for reproducible installations.

For the disposable PostgreSQL booking regression test, install `@electric-sql/pglite` outside the project and run:

```sh
npm install --prefix /tmp/basement-sql-test --no-save @electric-sql/pglite
BASEMENT_PGLITE_MODULE=/tmp/basement-sql-test/node_modules/@electric-sql/pglite node --test tests/bookings-role.test.cjs
```

This test recreates the unsupported enum error first, applies the migration twice, then checks customer/owner/admin reservations, capacity, cancellation, and denied roles. It never connects to the live Supabase database.
