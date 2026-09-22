# Basement Health Club Control Center v3.

Independent public website, Member Portal and Owner Dashboard for the Basement Health Club.

## Vercel setting

Member creation is performed only by the owner through a protected server route. Add the Supabase server secret in Vercel as an environment variable named `SUPABASE_SECRET_KEY`. Never place this value in browser code or commit it to GitHub.

## Routes

- `/` public website
- `/login` independent member/owner login
- `/dashboard` role-aware Owner Dashboard or Member Portal
- `/api/admin/create-member` protected owner-only member creation

## Session repair

Access tokens refresh before expiry and after an explicit authentication rejection. Parallel refreshes share one request; browsers with Web Locks also coordinate tabs. Transient service errors preserve the saved session. Opening `/login` always allows a fresh sign-in. The owner-only member endpoint reports upstream authentication failures separately from expired sessions and rejected server keys. Member creation is retried only after an explicit pre-creation session rejection.

Validation: `node --test tests/auth-session.test.cjs`, `npx tsc --noEmit`, and `npm run build`. Live account creation still requires verification after deployment.
