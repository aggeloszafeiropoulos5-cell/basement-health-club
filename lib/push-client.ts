import { accessToken } from "./session";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-rest";
export type PushPreferences = { training: boolean; subscriptions: boolean; payments: boolean };
export const defaultPushPreferences: PushPreferences = { training: true, subscriptions: true, payments: true };
export const pushOwnerKey = "basement_push_owner";
export async function pushRequest(action: string, values: Record<string, unknown> = {}) {
  let token = await accessToken();
  const send = () => fetch(`${SUPABASE_URL}/functions/v1/basement-push`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...values, action }),
  });
  let response = await send();
  if (response.status === 401) { token = await accessToken(token); response = await send(); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Δεν ολοκληρώθηκε η ρύθμιση ειδοποιήσεων. Δοκίμασε ξανά.");
  return data;
}
export async function pushRegistration() {
  if (!("serviceWorker" in navigator)) throw new Error("Ο browser δεν υποστηρίζει εγκατάσταση εφαρμογής.");
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return Promise.race([navigator.serviceWorker.ready,new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Η εφαρμογή δεν είναι ακόμη έτοιμη. Ανανέωσε τη σελίδα.")), 12000))]);
}
export function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
// Unsubscribe locally first, so a server outage cannot leave this device receiving pushes.
export async function disableDevicePush() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager?.getSubscription();
  if (subscription) {
    const endpoint = subscription.endpoint;
    if (!await subscription.unsubscribe()) throw new Error("Δεν απενεργοποιήθηκαν οι ειδοποιήσεις. Δοκίμασε ξανά πριν αποσυνδεθείς.");
    await pushRequest("unsubscribe", { endpoint }).catch(() => {});
  }
  if (registration && typeof registration.getNotifications === "function") {
    const notifications = await registration.getNotifications().catch(() => []);
    notifications.forEach(notification => notification.close());
  }
  localStorage.removeItem(pushOwnerKey);
}
