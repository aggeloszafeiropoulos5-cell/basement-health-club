# Basement Health Club Control Center v3.

Independent public website, Member Portal and Owner Dashboard for the Basement Health Club.

## Vercel setting

Member creation is performed only by the owner through a protected server route. Add the Supabase server secret in Vercel as an environment variable named `SUPABASE_SECRET_KEY`. Never place this value in browser code or commit it to GitHub.

## Routes

- `/` public website
- `/login` independent member/owner login
- `/dashboard` role-aware Owner Dashboard or Member Portal
- `/api/admin/create-member` protected owner-only member creation
