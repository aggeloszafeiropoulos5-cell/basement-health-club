# V42 — AUTH / CALENDAR FIX

- Protected Supabase requests can no longer silently fall back to the `anon` role when a token is temporarily missing.
- Any caller that passes the auth-token argument now forces `accessToken()` validation/refresh before the request is sent.
- Calendar session expiry clears the stale local session and redirects to `/login?tab=calendar` instead of showing a backend permission error.
- Public website requests remain anonymous by omitting the token argument.
