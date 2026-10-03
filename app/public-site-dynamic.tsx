"use client";
import {FormEvent,useEffect,useState} from "react";
import {api} from "../lib/supabase-rest";

type PublicSettings={businessName:string;businessEmail:string;businessPhone:string;guestBooking:boolean};
const fallback:PublicSettings={businessName:"BASEMENT HEALTH CLUB",businessEmail:"",businessPhone:"698 338 9353",guestBooking:false};

export default function PublicSiteDynamic(){
 const [settings,setSettings]=useState<PublicSettings>(fallback),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{void api("/rest/v1/rpc/basement_public_site_settings").then(async r=>{if(r.ok)setSettings({...fallback,...await r.json()})}).catch(()=>{})},[]);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;const f=new FormData(form);setBusy(true);setMessage("");try{const r=await api("/rest/v1/rpc/basement_guest_request",undefined,{method:"POST",body:JSON.stringify({p_name:f.get("name"),p_phone:f.get("phone"),p_email:f.get("email")||"",p_service:f.get("service")||"",p_preferred:f.get("preferred")||""})});const d=await r.json().catch(()=>null);if(!r.ok)throw new Error(d?.message||"Δεν στάλθηκε το αίτημα.");form.reset();setMessage("Το αίτημά σου καταχωρίστηκε. Θα επικοινωνήσουμε μαζί σου.")}catch(err){setMessage(err instanceof Error?err.message:"Δεν στάλθηκε το αίτημα.")}finally{setBusy(false)}}
 const tel=(settings.businessPhone||"").replace(/[^+0-9]/g,"");
 return <>
  <section className="contact-section"><div><span className="kicker">ΒΡΕΣ ΜΑΣ</span><h2>{settings.businessName||"Basement Health Club"}</h2><p>Ι. Ξενίδη 5, Πετρούπολη 132 31</p>{settings.businessPhone&&<p><a href={`tel:${tel}`}>{settings.businessPhone}</a></p>}{settings.businessEmail&&<p><a href={`mailto:${settings.businessEmail}`}>{settings.businessEmail}</a></p>}</div><div className="contact-links"><a target="_blank" rel="noreferrer" href="https://www.google.com/maps/search/?api=1&query=THE%20BASEMENT%20HEALTH%20CLUB%20Petroupoli">Google Maps ↗</a></div></section>
  {settings.guestBooking&&<section className="guest-request-section"><div><span className="kicker">ΠΡΩΤΗ ΕΠΑΦΗ</span><h2>Ζήτησε δοκιμαστικό χωρίς λογαριασμό</h2><p>Στείλε τα στοιχεία σου και η ομάδα του Basement θα επικοινωνήσει μαζί σου για ημέρα και ώρα.</p></div><form onSubmit={submit}><label>Όνομα<input name="name" required/></label><label>Τηλέφωνο<input name="phone" inputMode="tel" required/></label><label>Email<input name="email" type="email"/></label><label>Υπηρεσία<select name="service"><option value="">Δεν έχω αποφασίσει</option><option>EMS Training</option><option>Cross Training</option><option>Personal Training</option><option>Boxing / Kick Boxing</option><option>Vacu Power</option><option>EMS Sculpting</option></select></label><label>Προτίμηση ημέρας / ώρας<input name="preferred" placeholder="π.χ. Δευτέρα μετά τις 18:00"/></label><button disabled={busy}>{busy?"Αποστολή…":"Στείλε αίτημα"}</button>{message&&<p role="status">{message}</p>}</form></section>}
 </>;
}
