import Image from "next/image";
import HomeLogin from "./home-login";

const services=["Cross Training","EMS Training","EMS Sculpting","Vacu Power"];
const sampleSchedule=[
  {time:"17:00",name:"Cross Training",detail:"6 διαθέσιμες θέσεις"},
  {time:"18:00",name:"EMS Training",detail:"3 διαθέσιμες θέσεις",active:true},
  {time:"19:00",name:"Vacu Power",detail:"1 διαθέσιμη θέση"},
];

export default function Home(){return <main>
  <nav><div className="brand"><Image src="/basement-logo.jpeg" width={62} height={62} alt="Basement Health Club"/><span><b>BASEMENT</b><small>HEALTH CLUB · EST. 2015</small></span></div><HomeLogin className="login" label="Σύνδεση μέλους"/></nav>
  <section className="hero"><div><span className="kicker">BASEMENT HEALTH CLUB</span><h1>Η προπόνησή σου.<br/><em>Στο δικό σου πρόγραμμα.</em></h1><p>Δες τις διαθέσιμες προπονήσεις, κλείσε τη θέση σου και διαχειρίσου τις κρατήσεις σου εύκολα από το κινητό.</p><div className="actions"><HomeLogin label="Κλείσε προπόνηση →"/><a href="#services">Δες τις υπηρεσίες</a></div></div><section className="schedule-card" aria-label="Ενδεικτικό πρόγραμμα"><header>ΤΟ ΠΡΟΓΡΑΜΜΑ ΣΟΥ <span>● ONLINE</span></header>{sampleSchedule.map(item=><article className={item.active?"active":""} key={item.time}><time>{item.time}</time><div><b>{item.name}</b><small>{item.detail}</small></div><HomeLogin label="Κράτηση"/></article>)}<p>Συνδέσου για το πραγματικό πρόγραμμα και τις διαθέσιμες θέσεις.</p></section></section>
  <section id="services" className="services"><span className="kicker">ΟΙ ΥΠΗΡΕΣΙΕΣ ΜΑΣ</span><h2>Βρες την προπόνηση που σου ταιριάζει</h2><div className="grid">{services.map((s,i)=><article key={s}><small>0{i+1}</small><i>⌁</i><h3>{s}</h3><p>Εξειδικευμένη προπόνηση με την καθοδήγηση της ομάδας του Basement.</p><a href="/login">Διαθέσιμα ραντεβού →</a></article>)}</div></section>
  <section id="portal" className="portal"><div><span>ONLINE BOOKING</span><h2>Το Basement πάντα μαζί σου.</h2><p>Προσωπική σύνδεση, ζωντανές διαθέσιμες θέσεις και κρατήσεις για κάθε μέλος.</p></div><HomeLogin className="login" label="Είσοδος στο Portal"/></section><footer><div className="brand"><Image src="/basement-logo.jpeg" width={50} height={50} alt=""/><span><b>BASEMENT</b><small>HEALTH CLUB</small></span></div><p>© 2015–2026 Basement Health Club</p></footer>
</main>}
