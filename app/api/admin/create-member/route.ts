import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../../../../lib/supabase-rest";
import { subscriptionEndDate } from "../../../../lib/member-subscription";

type InitialSubscription = { id: string; name: string; sessions_total: number | null; starts_on: string; expires_on: string };

async function addInitialSubscription(profile: { id: string; full_name: string; role: string }, plan: InitialSubscription, headers: Record<string, string>) {
  let memberId: string | undefined;
  const incomplete = () => NextResponse.json({ ...profile, member_record_id: memberId, account_created: true,
    code: "MEMBER_SUBSCRIPTION_UNCONFIRMED",
    error: "Το μέλος δημιουργήθηκε, αλλά δεν επιβεβαιώθηκε η προσθήκη συνδρομής. Έλεγξε την καρτέλα του και τα «Πακέτα» πριν προσθέσεις συνδρομή. Μην ξαναδημιουργήσεις το μέλος.",
  }, { status: 502 });
  try {
    // The profile trigger links the Auth account to a distinct business member ID.
    const memberResponse = await fetch(`${SUPABASE_URL}/rest/v1/members?auth_user_id=eq.${encodeURIComponent(profile.id)}&select=id,auth_user_id`, { headers, cache: "no-store" });
    const members = await memberResponse.json().catch(() => null);
    if (!memberResponse.ok || !Array.isArray(members) || members.length !== 1 || members[0].auth_user_id !== profile.id || !members[0].id) return incomplete();
    memberId = members[0].id;
    const assignment = { id: randomUUID(), member_id: memberId, package_template_id: plan.id,
      starts_on: plan.starts_on, expires_on: plan.expires_on,
      sessions_total: plan.sessions_total, sessions_remaining: plan.sessions_total, status: "active" };
    const matches = (rows: unknown): boolean => Array.isArray(rows) && rows.length === 1 &&
      Object.entries(assignment).every(([key, value]) => rows[0]?.[key] === value);
    const success = () => NextResponse.json({ ...profile, member_record_id: memberId,
      subscription: { id: assignment.id, name: plan.name, starts_on: plan.starts_on, expires_on: plan.expires_on, sessions_remaining: plan.sessions_total } });
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/member_packages`, {
        method: "POST", cache: "no-store", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(assignment),
      });
      const rows = await response.json().catch(() => null);
      if (response.ok && matches(rows)) return success();
    } catch { /* A lost response may follow a committed insert. Read it back; never insert twice. */ }
    const check = await fetch(`${SUPABASE_URL}/rest/v1/member_packages?id=eq.${assignment.id}&select=id,member_id,package_template_id,starts_on,expires_on,sessions_total,sessions_remaining,status`, { headers, cache: "no-store" });
    const rows = await check.json().catch(() => null);
    return check.ok && matches(rows) ? success() : incomplete();
  } catch { return incomplete(); }
}

export async function POST(req: NextRequest) {
  let accountCreated = false;
  let createdAccountId: string | undefined;
  const profileFailure = () => NextResponse.json({
    error: "Ο λογαριασμός δημιουργήθηκε, αλλά δεν επιβεβαιώθηκε η αποθήκευση του προφίλ. Μην επαναλάβεις τη δημιουργία· χρειάζεται έλεγχος του υπάρχοντος λογαριασμού.",
    code: "MEMBER_PROFILE_FAILED",
    account_created: true,
    id: createdAccountId,
  }, { status: 502 });

  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Δεν υπάρχει σύνδεση.", code: "SESSION_EXPIRED" }, { status: 401 });
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      cache: "no-store", headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) {
      const detail = await userRes.json().catch(() => ({}));
      const rawCode = detail.error_code || detail.code;
      const code = typeof rawCode === "string" && /^[a-zA-Z0-9_]{1,64}$/.test(rawCode) ? rawCode : "unknown";
      console.error("Member creation auth check", { status: userRes.status, code });
      if (userRes.status === 401 && ["bad_jwt", "jwt_expired", "session_expired", "session_not_found", "user_not_found", "no_authorization"].includes(code)) {
        return NextResponse.json({ error: "Η σύνδεση έληξε. Συνδέσου ξανά.", code: "SESSION_EXPIRED" }, { status: 401 });
      }
      return NextResponse.json({ error: `Δεν ολοκληρώθηκε ο έλεγχος σύνδεσης (AUTH_CHECK ${userRes.status}/${code}).`, code: "AUTH_CHECK_FAILED" }, { status: 502 });
    }
    const owner = await userRes.json();
    const roleRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${owner.id}&select=role`, {
      cache: "no-store", headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!roleRes.ok) return NextResponse.json({ error: "Δεν ήταν δυνατός ο έλεγχος δικαιωμάτων.", code: "ROLE_CHECK_FAILED" }, { status: 502 });
    const roles = await roleRes.json();
    if (!["owner", "admin"].includes(roles?.[0]?.role)) {
      return NextResponse.json({ error: "Δεν έχεις δικαίωμα δημιουργίας μέλους." }, { status: 403 });
    }
    const secret = process.env.SUPABASE_SECRET_KEY?.trim();
    if (!secret) return NextResponse.json({ error: "Λείπει η ασφαλής ρύθμιση SUPABASE_SECRET_KEY στο Vercel." }, { status: 503 });
    const body = await req.json();
    if (typeof body?.email !== "string" || !body.email.trim() || typeof body.password !== "string" || !body.password || typeof body.full_name !== "string" || !body.full_name.trim()) {
      return NextResponse.json({ error: "Συμπλήρωσε όνομα, email και κωδικό." }, { status: 400 });
    }
    const fullName = body.full_name.trim();
    const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
    const serverHeaders = { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
    let subscription: InitialSubscription | null = null;
    if (body.package_template_id !== undefined && body.package_template_id !== null && body.package_template_id !== "") {
      if (typeof body.package_template_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.package_template_id) || typeof body.package_starts_on !== "string" || !subscriptionEndDate(body.package_starts_on, 1)) {
        return NextResponse.json({ error: "Επίλεξε έγκυρο πακέτο και ημερομηνία έναρξης." }, { status: 400 });
      }
      // Validate before creating the account and obtain the session allowance from the database.
      const templateResponse = await fetch(`${SUPABASE_URL}/rest/v1/package_templates?id=eq.${body.package_template_id}&active=eq.true&select=id,name,sessions_total,validity_days,active`, { headers: serverHeaders, cache: "no-store" });
      if (!templateResponse.ok) return NextResponse.json({ error: "Δεν ελέγχθηκε το πακέτο. Το μέλος δεν δημιουργήθηκε· δοκίμασε ξανά.", code: "PACKAGE_CHECK_FAILED" }, { status: 502 });
      const templates = await templateResponse.json();
      const template = Array.isArray(templates) && templates.length === 1 ? templates[0] : null;
      const expiresOn = template ? subscriptionEndDate(body.package_starts_on, template.validity_days) : null;
      if (!template || template.id !== body.package_template_id || template.active !== true || !expiresOn || (template.sessions_total !== null && (!Number.isInteger(template.sessions_total) || template.sessions_total < 1))) {
        return NextResponse.json({ error: "Το πακέτο δεν είναι διαθέσιμο ή δεν έχει έγκυρες ρυθμίσεις. Επίλεξε άλλο πακέτο." }, { status: 400 });
      }
      subscription = { id: template.id, name: template.name, sessions_total: template.sessions_total, starts_on: body.package_starts_on, expires_on: expiresOn };
    }
    const create = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST", headers: serverHeaders,
      body: JSON.stringify({ email: body.email.trim().toLowerCase(), password: body.password, email_confirm: true, user_metadata: { full_name: fullName, phone } }),
    });
    const created = await create.json();
    if ([401, 403].includes(create.status)) return NextResponse.json({ error: "Το Supabase δεν αποδέχεται το κλειδί διαχείρισης. Έλεγξε το SUPABASE_SECRET_KEY του ίδιου project.", code: "SERVER_KEY_REJECTED" }, { status: 502 });
    if (!create.ok) return NextResponse.json({ error: created.msg || created.message || "Δεν δημιουργήθηκε ο λογαριασμός." }, { status: create.status });
    accountCreated = true;
    if (typeof created.id !== "string" || !created.id) return profileFailure();
    createdAccountId = created.id;
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(created.id)}&select=id,full_name,role`, {
      method: "PATCH", cache: "no-store",
      headers: { ...serverHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ full_name: fullName, phone, role: "customer", active: true }),
    });
    const profiles = await profileRes.json().catch(() => null);
    const profile = Array.isArray(profiles) && profiles.length === 1 ? profiles[0] : null;
    if (!profileRes.ok || profile?.id !== created.id || profile?.role !== "customer" || profile?.full_name !== fullName) {
      console.error("Member profile save", { status: profileRes.status, matched: profile?.id === created.id });
      return profileFailure();
    }
    const member = { id: profile.id, full_name: profile.full_name, role: profile.role };
    if (subscription) return addInitialSubscription(member, subscription, serverHeaders);
    return NextResponse.json(member);
  } catch {
    if (accountCreated) return profileFailure();
    return NextResponse.json({ error: "Παρουσιάστηκε τεχνικό σφάλμα. Έλεγξε τη λίστα μελών πριν επαναλάβεις την ενέργεια." }, { status: 500 });
  }
}
