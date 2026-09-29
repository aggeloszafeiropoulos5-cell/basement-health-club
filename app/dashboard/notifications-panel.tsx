"use client";
import { useEffect, useState } from "react";
import AppInstall from "../app-install";
import { applicationServerKey, defaultPushPreferences, disableDevicePush, pushOwnerKey, pushRegistration, pushRequest, PushPreferences } from "../../lib/push-client";
export default function NotificationsPanel({ userId }: { userId: string }) {
  const [supported, setSupported] = useState(false), [needsInstall, setNeedsInstall] = useState(false);
  const [preferences, setPreferences] = useState<PushPreferences>(defaultPushPreferences);
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(true), [message, setMessage] = useState("");
  const [key, setKey] = useState(""), [permission, setPermission] = useState<NotificationPermission>("default");
  useEffect(() => { let live = true; void (async () => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const installed = matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & { standalone?: boolean }).standalone;
    setNeedsInstall(ios && !installed);
    const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(capable);
    if (!capable || (ios && !installed)) { setBusy(false); return; }
    setPermission(Notification.permission);
    try {
      const reg = await pushRegistration(), oldOwner = localStorage.getItem(pushOwnerKey);
      if (oldOwner !== userId) await disableDevicePush();
      const sub = await reg.pushManager.getSubscription(), result = await pushRequest("status", { endpoint: sub?.endpoint });
      if (!live) return;
      setKey(result.publicKey); setEnabled(!!sub && !!result.device?.enabled && Notification.permission === "granted");
      if (result.device) setPreferences({ training: result.device.training, subscriptions: result.device.subscriptions, payments: result.device.payments });
    } catch (error) { if (live) setMessage(error instanceof Error ? error.message : "Δεν φορτώθηκαν οι ειδοποιήσεις."); }
    finally { if (live) setBusy(false); }
  })(); return () => { live = false; }; }, [userId]);
  async function enableOrSave() {
    setBusy(true); setMessage("");
    // iOS requires the permission request to start directly in the click gesture.
    try {
      const grant = Notification.permission === "granted" ? Promise.resolve("granted") : Notification.requestPermission();
      const allowed = await grant; setPermission(allowed as NotificationPermission);
      if (allowed !== "granted") { setMessage("Δεν δόθηκε άδεια. Μπορείς να την αλλάξεις από τις ρυθμίσεις ειδοποιήσεων της συσκευής."); return; }
      const reg = await pushRegistration();
      const subscription = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(key) });
      localStorage.setItem(pushOwnerKey, userId);
      await pushRequest("subscribe", { subscription: subscription.toJSON(), preferences });
      setEnabled(true); setMessage("Οι προτιμήσεις αποθηκεύτηκαν. Οι ειδοποιήσεις είναι ενεργές σε αυτή τη συσκευή.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Δεν ενεργοποιήθηκαν οι ειδοποιήσεις."); }
    finally { setBusy(false); }
  }
  async function disable() { setBusy(true); setMessage(""); try { await disableDevicePush(); setEnabled(false); setMessage("Οι ειδοποιήσεις απενεργοποιήθηκαν σε αυτή τη συσκευή."); } catch (error) { setMessage(error instanceof Error ? error.message : "Δοκίμασε ξανά."); } finally { setBusy(false); } }
  async function test() { setBusy(true); setMessage(""); try {
    const reg = await pushRegistration(), sub = await reg.pushManager.getSubscription();
    if (!sub) throw new Error("Ενεργοποίησε πρώτα τις ειδοποιήσεις.");
    await pushRequest("test", { endpoint: sub.endpoint });
    setMessage("Η δοκιμαστική ειδοποίηση στάλθηκε. Αν δεν εμφανιστεί, έλεγξε τις ρυθμίσεις ειδοποιήσεων και τη Συγκέντρωση του κινητού.");
  } catch (error) { setMessage(error instanceof Error ? error.message : "Δεν στάλθηκε η δοκιμή."); } finally { setBusy(false); } }
  return <div className="notifications-panel"><h2>Εφαρμογή & ειδοποιήσεις</h2><AppInstall/><section className="notification-card"><h3>Οι υπενθυμίσεις μου</h3><p>Επίλεξε τι θέλεις να λαμβάνεις σε αυτή τη συσκευή, ακόμη και με κλειστή την εφαρμογή.</p>
    {needsInstall ? <p className="notice">Στο iPhone/iPad οι ειδοποιήσεις λειτουργούν από την εγκατεστημένη εφαρμογή, με iOS 16.4 ή νεότερο. Πρόσθεσέ την στην αρχική οθόνη και άνοιξέ την από εκεί.</p> : !supported ? <p className="notice">Αυτός ο browser δεν υποστηρίζει ειδοποιήσεις εφαρμογής.</p> : <>
    <p className="push-state">{enabled ? "● Ενεργές σε αυτή τη συσκευή" : "○ Δεν είναι ενεργές σε αυτή τη συσκευή"}</p>
    <fieldset disabled={busy}><legend>Τύποι ειδοποιήσεων</legend>{([['training','Προπονήσεις','Υπενθύμιση πριν από το ραντεβού σου.'],['subscriptions','Συνδρομή & συνεδρίες','Όταν πλησιάζει η λήξη ή απομένουν λίγες συνεδρίες.'],['payments','Εκκρεμής πληρωμή','Για οφειλή που έχει καταχωρίσει το Basement.']] as const).map(([id,title,help])=><label className="push-choice" key={id}><input type="checkbox" checked={preferences[id]} onChange={event=>setPreferences(value=>({...value,[id]:event.target.checked}))}/><span><b>{title}</b><small>{help}</small></span></label>)}</fieldset>
    {permission === "denied" && <p className="notice">Η άδεια είναι αποκλεισμένη. Άνοιξε Ρυθμίσεις συσκευής → Ειδοποιήσεις → Basement ή τις άδειες του site στον browser.</p>}
    <div className="push-actions"><button disabled={busy || !key || permission === "denied"} onClick={()=>void enableOrSave()}>{busy ? "Παρακαλώ περίμενε…" : enabled ? "Αποθήκευση προτιμήσεων" : "Ενεργοποίηση ειδοποιήσεων"}</button>{enabled && <><button disabled={busy} onClick={()=>void test()}>Δοκιμαστική ειδοποίηση</button></>}{(enabled || permission==="granted")&&<button className="secondary" disabled={busy} onClick={()=>void disable()}>Απενεργοποίηση</button>}</div>
    {!key && !busy && <button onClick={()=>window.location.reload()}>Επανάληψη φόρτωσης</button>}</>}
    {message && <p role="status" className="notice">{message}</p>}<p className="push-help">Η αποσύνδεση απενεργοποιεί τις ειδοποιήσεις στη συσκευή. Τα μηνύματα δεν εμφανίζουν όνομα μέλους ή ποσό οφειλής. Η εμφάνιση και ο ήχος εξαρτώνται από τις ρυθμίσεις του κινητού.</p></section></div>;
}
