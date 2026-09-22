import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../../../../lib/supabase-rest";

export async function POST(req: NextRequest) {
  let accountCreated = false;
  const profileFailure = () => NextResponse.json({
    error: "Ο λογαριασμός δημιουργήθηκε, αλλά δεν επιβεβαιώθηκε η αποθήκευση του προφίλ. Μην επαναλάβεις τη δημιουργία· χρειάζεται έλεγχος του υπάρχοντος λογαριασμού.",
    code: "MEMBER_PROFILE_FAILED",
    account_created: true,
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
    const create = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST", headers: serverHeaders,
      body: JSON.stringify({ email: body.email.trim().toLowerCase(), password: body.password, email_confirm: true, user_metadata: { full_name: fullName, phone } }),
    });
    const created = await create.json();
    if ([401, 403].includes(create.status)) return NextResponse.json({ error: "Το Supabase δεν αποδέχεται το κλειδί διαχείρισης. Έλεγξε το SUPABASE_SECRET_KEY του ίδιου project.", code: "SERVER_KEY_REJECTED" }, { status: 502 });
    if (!create.ok) return NextResponse.json({ error: created.msg || created.message || "Δεν δημιουργήθηκε ο λογαριασμός." }, { status: create.status });
    accountCreated = true;
    if (typeof created.id !== "string" || !created.id) return profileFailure();
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
    return NextResponse.json({ id: profile.id, full_name: profile.full_name, role: profile.role });
  } catch {
    if (accountCreated) return profileFailure();
    return NextResponse.json({ error: "Παρουσιάστηκε τεχνικό σφάλμα. Έλεγξε τη λίστα μελών πριν επαναλάβεις την ενέργεια." }, { status: 500 });
  }
}
