import Image from "next/image";
import HomeLogin from "./home-login";
import AppInstall from "./app-install";
import PublicSiteDynamic from "./public-site-dynamic";

const services=[
  {name:"Cross Training",tag:"Δύναμη · αντοχή · ομάδα",what:"Ομαδική λειτουργική προπόνηση με βάρη, ασκήσεις ενδυνάμωσης και conditioning, με καθοδήγηση προπονητή.",benefits:["Βελτίωση δύναμης και φυσικής κατάστασης","Μικρά τμήματα και επίβλεψη","Ποικιλία στην προπόνηση"]},
  {name:"EMS Training",tag:"Ολόσωμη ηλεκτρομυοδιέγερση",what:"Προπόνηση με ηλεκτρομυοδιέγερση και ταυτόχρονη εκτέλεση ασκήσεων, σε μικρά group έως 3 ατόμων.",benefits:["Σύντομη και οργανωμένη συνεδρία","Ελεγχόμενη ένταση ανά μυϊκή ομάδα","Προσωπική καθοδήγηση"]},
  {name:"Personal Training",tag:"1 προς 1 προπόνηση",what:"Ατομικό πρόγραμμα προπόνησης σχεδιασμένο γύρω από τον στόχο, το επίπεδο και την πρόοδό σου.",benefits:["100% προσωπική επίβλεψη","Πρόγραμμα προσαρμοσμένο σε εσένα","Συστηματική παρακολούθηση προόδου"]},
  {name:"Boxing / Kick Boxing",tag:"Τεχνική · φυσική κατάσταση",what:"Προπόνηση τεχνικής πυγμαχίας και kick boxing με έμφαση στον συντονισμό, την αντοχή και τη φυσική κατάσταση.",benefits:["Cardio και αντοχή","Συντονισμός και τεχνική","Δυναμική προπόνηση"]},
  {name:"Vacu Power",tag:"Cardio σε ειδικό εξοπλισμό",what:"Αερόβια άσκηση σε ειδικό μηχάνημα Vacu Power, ως συμπληρωματική επιλογή στο πρόγραμμα άσκησής σου.",benefits:["Αερόβια δραστηριότητα","Εύκολη ένταξη στο εβδομαδιαίο πρόγραμμα","Καθοδηγούμενη χρήση"]},
  {name:"EMS Sculpting",tag:"HIFEM μυϊκή διέγερση",what:"Συνεδρία μυϊκής διέγερσης HIFEM για επιλεγμένες περιοχές, ως συμπληρωματική υπηρεσία και όχι υποκατάστατο άσκησης.",benefits:["Στοχευμένη εφαρμογή","Μη επεμβατική συνεδρία","Συνδυάζεται με πρόγραμμα άσκησης"]},
];

const reviews=[
  {text:"Πολύ καθαρός χώρος, φιλικό και καταρτισμένο προσωπικό.",name:"Βασιλική",source:"Google"},
  {text:"Φιλικό περιβάλλον και σωστή δουλειά στα EMS groups.",name:"Μαρία",source:"Google"},
  {text:"Οι γυμναστές δείχνουν ενδιαφέρον, δίνουν σωστές οδηγίες και σε κάνουν να νιώθεις άνετα.",name:"Φρύνη",source:"Google"},
];

export default function Home(){return <main>
  <AppInstall/>
  <nav><div className="brand"><Image src="/basement-logo.jpeg" width={62} height={62} alt="Basement Health Club"/><span><b>BASEMENT</b><small>HEALTH CLUB · EST. 2015</small></span></div><HomeLogin className="login" label="Σύνδεση μέλους"/></nav>

  <section className="hero public-hero"><div><span className="kicker">BASEMENT HEALTH CLUB · ΠΕΤΡΟΥΠΟΛΗ</span><h1>Προπόνηση με<br/><em>καθοδήγηση.</em></h1><p>Μικρά group, προσωπική επίβλεψη και διαφορετικοί τρόποι προπόνησης σε έναν χώρο που σε γνωρίζει με το όνομά σου.</p><div className="actions"><a className="primary-link" href="#services">Γνώρισε τις υπηρεσίες →</a><a href="tel:+306983389353">Κάλεσέ μας</a></div></div><div className="hero-photo"><Image src="/basement-logo.jpeg" width={340} height={340} alt="Basement Health Club Πετρούπολη" priority/><p>Ι. Ξενίδη 5 · Πετρούπολη</p></div></section>

  <section className="about-strip"><strong>EST. 2015</strong><span>Μικρά group</span><span>Προσωπική καθοδήγηση</span><span>Πολλαπλές υπηρεσίες</span></section>

  <section id="services" className="services"><span className="kicker">ΟΙ ΥΠΗΡΕΣΙΕΣ ΜΑΣ</span><h2>Βρες αυτό που ταιριάζει στον στόχο σου</h2><p className="section-lead">Δες τι είναι κάθε υπηρεσία και τι μπορεί να σου προσφέρει. Η ομάδα του Basement σε βοηθά να επιλέξεις με βάση το επίπεδο και τον στόχο σου.</p><div className="grid service-grid">{services.map((s,i)=><article key={s.name}><small>0{i+1}</small><span className="service-tag">{s.tag}</span><h3>{s.name}</h3><p>{s.what}</p><h4>Οφέλη</h4><ul>{s.benefits.map(x=><li key={x}>{x}</li>)}</ul></article>)}</div></section>

  <section className="gallery-section"><div className="section-heading"><div><span className="kicker">ΜΕΣΑ ΣΤΟ BASEMENT</span><h2>Ο χώρος, η ομάδα, η προπόνηση.</h2></div><p>Η gallery είναι έτοιμη για πραγματικές φωτογραφίες του χώρου, των μηχανημάτων και της προπόνησης.</p></div><div className="photo-grid"><div className="photo-placeholder big"><span>Φωτογραφία χώρου</span></div><div className="photo-placeholder"><span>EMS Training</span></div><div className="photo-placeholder"><span>Cross Training</span></div><div className="photo-placeholder"><span>Vacu / Sculpting</span></div><div className="photo-placeholder"><span>Η ομάδα μας</span></div></div></section>

  <section className="reviews-section"><div className="section-heading"><div><span className="kicker">ΑΞΙΟΛΟΓΗΣΕΙΣ</span><h2>Τι λένε τα μέλη μας</h2></div><div className="rating-badge"><strong>5.0</strong><span>★★★★★</span><small>Google reviews</small></div></div><div className="review-grid">{reviews.map(r=><article key={r.name}><div className="stars">★★★★★</div><p>“{r.text}”</p><footer><b>{r.name}</b><span>{r.source}</span></footer></article>)}</div><div className="review-actions"><a target="_blank" rel="noreferrer" href="https://www.google.com/maps/search/?api=1&query=THE%20BASEMENT%20HEALTH%20CLUB%20Petroupoli">Δες όλες τις αξιολογήσεις</a><a className="primary-link" target="_blank" rel="noreferrer" href="https://www.google.com/maps/search/?api=1&query=THE%20BASEMENT%20HEALTH%20CLUB%20Petroupoli">Γράψε αξιολόγηση →</a></div></section>

  <PublicSiteDynamic/>

  <section id="portal" className="portal"><div><span>ΓΙΑ ΤΑ ΜΕΛΗ</span><h2>Οι κρατήσεις σου σε ένα σημείο.</h2><p>Η δημόσια σελίδα δεν εμφανίζει live ώρες ή πληρότητα. Τα μέλη συνδέονται με τον λογαριασμό τους για κρατήσεις και διαχείριση ραντεβού.</p></div><HomeLogin className="login" label="Σύνδεση μέλους"/></section>
  <footer className="site-footer"><div className="brand"><Image src="/basement-logo.jpeg" width={50} height={50} alt=""/><span><b>BASEMENT</b><small>HEALTH CLUB</small></span></div><p>© 2015–2026 Basement Health Club · Πετρούπολη</p></footer>
</main>}
