"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../lib/supabase-rest";
import { memberRequest } from "../../lib/session";
import { athensToday, displaySubscriptionDate, SignupPackage, subscriptionEndDate } from "../../lib/member-subscription";

export type CreatedMember = {
  id: string; full_name: string; role: string; member_record_id?: string;
  email?: string; phone?: string | null;
  subscription?: { id: string; name: string; starts_on: string; expires_on: string; sessions_remaining: number | null };
};

export default function CreateMemberForm({ onCreated, onOpenPackages }: {
  onCreated: (member: CreatedMember) => void;
  onOpenPackages: () => void;
}) {
  const [templates, setTemplates] = useState<SignupPackage[]>([]);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [withSubscription, setWithSubscription] = useState(false), [templateId, setTemplateId] = useState("");
  const [startsOn, setStartsOn] = useState(athensToday);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [outcome, setOutcome] = useState<"success" | "warning" | "error">("error");
  const [finished, setFinished] = useState(false);
  const inFlight = useRef(false);

  async function loadTemplates() {
    setLoading(true); setLoadError("");
    try {
      const response = await api("/rest/v1/package_templates?select=id,name,sessions_total,validity_days,price&active=eq.true&order=name", localStorage.getItem("basement_access_token") || "");
      if (!response.ok) throw new Error("Δεν φορτώθηκαν τα πακέτα. Μπορείς να δοκιμάσεις ξανά ή να δημιουργήσεις το μέλος χωρίς συνδρομή.");
      setTemplates(await response.json());
    } catch {
      setLoadError("Δεν φορτώθηκαν τα πακέτα. Μπορείς να δοκιμάσεις ξανά ή να δημιουργήσεις το μέλος χωρίς συνδρομή.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void loadTemplates(); }, []);

  const plan = templates.find(item => item.id === templateId);
  const expiresOn = plan ? subscriptionEndDate(startsOn, plan.validity_days) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || finished) return;
    if (withSubscription && (!plan || !expiresOn || loading || loadError)) return;
    const form = event.currentTarget, values = new FormData(form);
    inFlight.current = true; setBusy(true); setNotice("");
    try {
      const payload = {
        full_name: values.get("full_name"), email: values.get("email"),
        password: values.get("password"), phone: values.get("phone"),
        ...(withSubscription ? { package_template_id: templateId, package_starts_on: startsOn } : {}),
      };
      const response = await memberRequest({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      const created = response.ok || data.account_created === true;
      setOutcome(response.ok ? "success" : created ? "warning" : "error");
      setNotice(response.ok
        ? data.subscription
          ? `Το μέλος δημιουργήθηκε με τη συνδρομή «${data.subscription.name}»: ${data.subscription.sessions_remaining ?? "απεριόριστες"} συνεδρίες, από ${displaySubscriptionDate(data.subscription.starts_on)} έως ${displaySubscriptionDate(data.subscription.expires_on)}.`
          : "Το μέλος δημιουργήθηκε χωρίς συνδρομή. Μπορείς να προσθέσεις πακέτο αργότερα."
        : data.error || "Δεν ολοκληρώθηκε η εγγραφή.");
      if (created) {
        form.reset(); setFinished(true);
        if (data.id && data.role === "customer") onCreated({ ...data, full_name: data.full_name, email: String(payload.email), phone: String(payload.phone || "") });
      }
    } catch {
      // A lost response may follow a successful creation. Require a deliberate new form.
      form.reset(); setFinished(true); setOutcome("warning");
      setNotice("Δεν επιβεβαιώθηκε η ενέργεια. Έλεγξε πρώτα τη λίστα μελών και τις συνδρομές πριν επαναλάβεις τη δημιουργία.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  function newMember() {
    setFinished(false); setNotice(""); setWithSubscription(false); setTemplateId(""); setStartsOn(athensToday());
    void loadTemplates();
  }

  return <form className="admin-form create-member-form" onSubmit={submit}>
    {!finished && <fieldset disabled={busy} className="member-create-fields">
      <label>Ονοματεπώνυμο<input name="full_name" autoComplete="name" required /></label>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Προσωρινός κωδικός<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
      <label>Τηλέφωνο<input name="phone" type="tel" autoComplete="tel" /></label>
      <div className="signup-subscription">
        <label className="signup-subscription-toggle"><input type="checkbox" checked={withSubscription} onChange={event => setWithSubscription(event.target.checked)} />Προσθήκη συνδρομής τώρα <small>Προαιρετικό</small></label>
        {withSubscription && <div className="signup-subscription-fields">
          {loading ? <p role="status">Φόρτωση πακέτων…</p> : loadError ? <div><p role="alert">{loadError}</p><button type="button" onClick={() => void loadTemplates()}>Δοκίμασε ξανά</button></div> : !templates.length ? <div><p>Δεν υπάρχουν ενεργά πακέτα. Δημιούργησε πρώτα ένα στην ενότητα «Πακέτα».</p><button type="button" onClick={onOpenPackages}>Άνοιγμα πακέτων</button></div> : <>
            <label>Πακέτο συνδρομής<select value={templateId} onChange={event => setTemplateId(event.target.value)} required><option value="">Επίλεξε πακέτο</option>{templates.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label>Ημερομηνία έναρξης<input type="date" value={startsOn} onChange={event => setStartsOn(event.target.value)} required /></label>
            {plan && <div className="signup-package-summary" aria-live="polite"><span>Συνεδρίες<strong>{plan.sessions_total ?? "Απεριόριστες"}</strong></span><span>Διάρκεια<strong>{plan.validity_days} ημέρες</strong></span><span>Λήξη<strong>{expiresOn ? displaySubscriptionDate(expiresOn) : "Επίλεξε ημερομηνία"}</strong></span><span>Τιμή πακέτου<strong>{new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" }).format(Number(plan.price))}</strong></span></div>}
            <p className="muted-copy">Η τιμή εμφανίζεται για ενημέρωση. Η πληρωμή καταχωρίζεται ξεχωριστά.</p>
          </>}
        </div>}
      </div>
      <button disabled={busy || (withSubscription && (!plan || !expiresOn || loading || !!loadError))}>{busy ? "Αποθήκευση…" : withSubscription ? "Δημιουργία μέλους & συνδρομής" : "Δημιουργία μέλους"}</button>
    </fieldset>}
    {notice && <p className={`creation-notice ${outcome}`} role={outcome === "success" ? "status" : "alert"}>{notice}</p>}
    {finished && <div className="creation-next-actions">{outcome !== "success" && <button type="button" onClick={onOpenPackages}>Έλεγχος συνδρομών</button>}<button type="button" onClick={newMember}>Δημιουργία άλλου μέλους</button></div>}
  </form>;
}
