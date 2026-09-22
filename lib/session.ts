import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-rest";

const ACCESS = "basement_access_token";
const REFRESH = "basement_refresh_token";
let refreshPending: Promise<string> | null = null;

export class SessionExpiredError extends Error {
  constructor() { super("Η σύνδεση έληξε. Συνδέσου ξανά στον λογαριασμό σου."); }
}

export function clearSession() {
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
}

export function saveSession(session: { access_token: string; refresh_token: string }) {
  if (!session.access_token || !session.refresh_token) throw new Error("Δεν ολοκληρώθηκε η σύνδεση.");
  localStorage.setItem(ACCESS, session.access_token);
  localStorage.setItem(REFRESH, session.refresh_token);
}

function isFresh(token: string) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(payload));
    // Expiry is only a refresh hint. Supabase still verifies every request.
    return typeof exp === "number" && exp * 1000 > Date.now() + 60000;
  } catch { return false; }
}

export async function accessToken(rejectedToken?: string): Promise<string> {
  const current = localStorage.getItem(ACCESS);
  if (!current) throw new SessionExpiredError();
  if (isFresh(current) && current !== rejectedToken) return current;
  if (refreshPending) return refreshPending;

  const refresh = async () => {
    const access = localStorage.getItem(ACCESS);
    const refreshToken = localStorage.getItem(REFRESH);
    if (!access || !refreshToken) throw new SessionExpiredError();
    // Another tab may have refreshed while this tab waited for the lock.
    if (isFresh(access) && access !== rejectedToken) return access;
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST", cache: "no-store",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await response.json().catch(() => ({}));
    if (localStorage.getItem(ACCESS) !== access || localStorage.getItem(REFRESH) !== refreshToken) {
      throw new Error("Η σύνδεση άλλαξε. Ανανέωσε τη σελίδα.");
    }
    if (!response.ok) {
      const code = data.error_code || data.code || data.error;
      if (["refresh_token_not_found", "refresh_token_already_used", "session_not_found", "session_expired", "invalid_grant"].includes(code)) {
        clearSession();
        throw new SessionExpiredError();
      }
      throw new Error(`Δεν ήταν δυνατή η ανανέωση σύνδεσης (HTTP ${response.status}). Δοκίμασε ξανά σε λίγο.`);
    }
    saveSession(data);
    return data.access_token as string;
  };

  const pending = (async () => {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request("basement-session-refresh", refresh);
    }
    return await refresh();
  })().finally(() => { refreshPending = null; });
  refreshPending = pending;
  return pending;
}

export async function memberRequest(init: RequestInit): Promise<Response> {
  let token = await accessToken();
  const send = () => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch("/api/admin/create-member", { ...init, headers, cache: "no-store" });
  };
  const response = await send();
  if (response.status !== 401) return response;
  const data = await response.clone().json().catch(() => ({}));
  // Retry only a rejection before member creation, never an uncertain POST.
  if (data.code !== "SESSION_EXPIRED") return response;
  token = await accessToken(token);
  return send();
}
