"use client";
import { useEffect, useState } from "react";
import { pushRegistration } from "../lib/push-client";
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
export default function AppInstall() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false), [ios, setIos] = useState(false), [help, setHelp] = useState(false);
  useEffect(() => {
    const display = matchMedia("(display-mode: standalone)");
    const update = () => setInstalled(display.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
    update(); display.addEventListener("change", update);
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const available = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent); };
    const done = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", available); window.addEventListener("appinstalled", done);
    void pushRegistration().catch(() => {});
    return () => { display.removeEventListener("change", update); window.removeEventListener("beforeinstallprompt", available); window.removeEventListener("appinstalled", done); };
  }, []);
  async function install() { if (!prompt) { setHelp(x => !x); return; } try { await prompt.prompt(); await prompt.userChoice; setPrompt(null); } catch { setHelp(true); } }
  return <section className="app-install" aria-label="Εγκατάσταση εφαρμογής"><div><b>Το Basement στο κινητό σου</b><p>{installed ? "Η εφαρμογή είναι εγκατεστημένη. Ενεργοποίησε τις ειδοποιήσεις από τον λογαριασμό σου." : "Κρατήσεις, συνδρομή και υπενθυμίσεις από το εικονίδιο στην αρχική σου οθόνη."}</p></div>
    {!installed && <button type="button" onClick={() => void install()} aria-expanded={help}>Εγκατάσταση εφαρμογής</button>}
    {help && !installed && <div className="install-help" role="status">{ios ? <ol><li>Άνοιξε αυτό το site στο Safari.</li><li>Πάτησε <b>Κοινοποίηση</b> → <b>Προσθήκη στην αρχική οθόνη</b> → <b>Προσθήκη</b>.</li><li>Άνοιξε το εικονίδιο Basement, συνδέσου και επίλεξε <b>Εφαρμογή & ειδοποιήσεις</b>.</li></ol> : <p>Από το μενού του browser επίλεξε <b>Εγκατάσταση εφαρμογής</b> ή <b>Προσθήκη στην αρχική οθόνη</b>. Αν δεν εμφανίζεται, άνοιξε το site σε Chrome ή Edge από ασφαλή σύνδεση HTTPS.</p>}</div>}
  </section>;
}
