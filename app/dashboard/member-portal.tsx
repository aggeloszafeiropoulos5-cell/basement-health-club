"use client";
import {useCallback,useEffect,useState} from "react";
import {api} from "../../lib/supabase-rest";

type Subscription={id:string;name:string;status:string;starts_on:string;expires_on:string;sessions_remaining:number|null;frozen_until:string|null;services:string[]};
type Appointment={id:number;slot_id:number;service:string;starts_at:string;ends_at:string;status:string;paid_at:string|null};
type Slot={id:number;service:string;starts_at:string;ends_at:string;capacity:number;reserved:number;enabled:boolean};
type Portal={packages:Subscription[];bookings:Appointment[];services:string[];completed_count:number;block_after_expiry:boolean;grace_days:number;next_payment_on:string|null;last_payment_on:string|null;terms_required:boolean;booking_paused:boolean;show_available_spots:boolean};
const zone="Europe/Athens";
const dateKey=(d=new Date())=>{const p=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`};
const date=(v:string)=>new Date(v.length===10?`${v}T12:00:00+03:00`:v).toLocaleDateString("el-GR",{timeZone:zone,day:"numeric",month:"long",year:"numeric"});
const time=(v:string)=>new Date(v).toLocaleTimeString("el-GR",{timeZone:zone,hour:"2-digit",minute:"2-digit"});
const labels:Record<string,string>={booked:"Επιβεβαιωμένο",pending:"Αναμονή επιβεβαίωσης",completed:"Ολοκληρωμένο · Check-in",cancelled:"Ακυρωμένο",late_cancel:"Εκπρόθεσμη ακύρωση",no_show:"Απουσία"};

export default function MemberPortal({mode,onCalendar}:{mode:"overview"|"calendar"|"packages";onCalendar:()=>void}){
 const [data,setData]=useState<Portal|null>(null),[slots,setSlots]=useState<Slot[]>([]),[day,setDay]=useState(()=>dateKey()),[service,setService]=useState("");
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[accepted,setAccepted]=useState(false),[historyLimit,setHistoryLimit]=useState(20);
 const [confirm,setConfirm]=useState<{kind:"book"|"cancel";id:number;title:string}|null>(null);
 const token=()=>localStorage.getItem("basement_access_token")||"";
 const refresh=useCallback(async()=>{
  try{
   const response=await api("/rest/v1/rpc/basement_member_portal",token());
   if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||"Δεν φορτώθηκε η προσωπική σου καρτέλα.")}
   const next:Portal=await response.json();const available:Slot[]=[];
   for(let offset=0;;offset+=1000){
    const r=await api(`/rest/v1/rpc/basement_availability?limit=1000&offset=${offset}`,token());
    if(!r.ok)throw new Error("Δεν φορτώθηκαν οι διαθέσιμες ώρες. Δοκίμασε ανανέωση.");
    const page:Slot[]=await r.json();available.push(...page);if(page.length<1000)break;
   }
   setData(next);setSlots(available);setError("");
   setService(current=>next.services.includes(current)?current:next.services[0]||"");return true;
  }catch(e){setError(e instanceof Error?e.message:"Δεν φορτώθηκαν τα στοιχεία σου.");return false}
 },[]);
 useEffect(()=>{void refresh();const id=window.setInterval(()=>void refresh(),60000);return()=>clearInterval(id)},[refresh]);
 async function submit(){
  if(!confirm)return;setBusy(true);setError("");setNotice("");
  try{
   const r=await api(`/rest/v1/rpc/${confirm.kind==="book"?"basement_book":"basement_cancel"}`,token(),{method:"POST",body:JSON.stringify(confirm.kind==="book"?{p_slot_id:confirm.id}:{p_booking_id:confirm.id})});
   const result=await r.json().catch(()=>null);if(!r.ok)throw new Error(result?.message||"Δεν ολοκληρώθηκε η ενέργεια.");
   setNotice(confirm.kind==="cancel"?"Η κράτηση ακυρώθηκε. Αν είχε χρεωθεί συνεδρία, επιστράφηκε στο πακέτο σου.":typeof result==="number"&&result<0?"Μπήκες στη λίστα αναμονής. Η συνεδρία θα αφαιρεθεί όταν επιβεβαιωθεί η θέση.":"Η κράτηση καταχωρίστηκε και δεσμεύτηκε μία συνεδρία.");
   setConfirm(null);setAccepted(false);await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Δεν ολοκληρώθηκε η ενέργεια.")}finally{setBusy(false)}
 }
 const today=dateKey(),now=Date.now();
 const coversDate=(p:Subscription,on:string)=>!data?.block_after_expiry||new Date(`${p.expires_on}T12:00:00Z`).getTime()+(data?.grace_days||0)*86400000>=new Date(`${on}T12:00:00Z`).getTime();
 const active=data?.packages.filter(p=>["active","scheduled"].includes(p.status)&&coversDate(p,today))||[];
 const upcoming=data?.bookings.filter(b=>["booked","pending"].includes(b.status)&&new Date(b.ends_at).getTime()>now)||[];
 const history=data?.bookings.filter(b=>!upcoming.some(u=>u.id===b.id)).slice().reverse()||[];
 const days=[...new Set([today,day,...slots.map(s=>dateKey(new Date(s.starts_at)))])].sort();
 const shown=slots.filter(s=>s.service===service&&dateKey(new Date(s.starts_at))===day&&s.enabled&&new Date(s.starts_at).getTime()>now&&Number(s.reserved)<s.capacity);
 const hasCredit=(s:Slot)=>active.some(p=>p.services.includes(s.service)&&p.starts_on<=dateKey(new Date(s.starts_at))&&coversDate(p,dateKey(new Date(s.starts_at)))&&(!p.frozen_until||p.frozen_until<dateKey(new Date(s.starts_at)))&&(p.sessions_remaining===null||p.sessions_remaining>0));
 function changeDay(step:number){const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+step);setDay(d.toISOString().slice(0,10))}
 function appointment(b:Appointment){return <article className="member-appointment" key={b.id}><div><strong>{b.service}</strong><p>{date(b.starts_at)} · {time(b.starts_at)}–{time(b.ends_at)}</p><small>{labels[b.status]||b.status}</small>{b.paid_at&&<small>Πληρωμή ραντεβού: {date(b.paid_at)}</small>}</div>{["booked","pending"].includes(b.status)&&new Date(b.starts_at).getTime()>now&&<button disabled={busy} onClick={()=>setConfirm({kind:"cancel",id:b.id,title:`${b.service} · ${date(b.starts_at)} ${time(b.starts_at)}`})}>Ακύρωση</button>}</article>}
 return <div className="member-portal" aria-busy={busy}><div className="member-portal-heading"><h2>{mode==="calendar"?"Κλείσε την προπόνησή σου":mode==="packages"?"Οι συνδρομές μου":"Το πρόγραμμά μου"}</h2><button disabled={busy} onClick={()=>void refresh()}>↻ Ανανέωση</button></div>{error&&<p className="booking-error" role="alert">{error}</p>}{notice&&<p className="booking-success" role="status">{notice}</p>}{!data&&!error&&<p>Φόρτωση προσωπικού προγράμματος…</p>}{data&&<>
 {mode!=="calendar"&&<><div className="member-personal-stats"><article><span>Επόμενες κρατήσεις</span><strong>{upcoming.length}</strong></article><article><span>Προπονήσεις που έκανα</span><strong>{data.completed_count}</strong></article>{data.next_payment_on&&<article><span>Επόμενη πληρωμή</span><strong>{date(data.next_payment_on)}</strong></article>}</div><h3>Οι συνδρομές σου</h3><div className="member-subscriptions">{active.length?active.map(p=><article key={p.id}><h3>{p.name}</h3><p>{p.services.join(" · ")||"Επικοινώνησε για ενεργοποίηση υπηρεσίας"}</p><strong>{p.sessions_remaining===null?"Απεριόριστες συνεδρίες":`${p.sessions_remaining} συνεδρίες διαθέσιμες`}</strong><p>Από {date(p.starts_on)} · Λήξη {date(p.expires_on)}</p>{p.frozen_until&&p.frozen_until>=today&&<p>Σε παύση έως {date(p.frozen_until)}</p>}</article>):<p>Δεν υπάρχει ενεργή συνδρομή. Επικοινώνησε με το Basement για ενεργοποίηση.</p>}</div>{data.last_payment_on&&<p>Τελευταία καταχωρισμένη πληρωμή: {date(data.last_payment_on)}</p>}<button className="member-primary" onClick={onCalendar}>Κλείσε προπόνηση →</button></>}
 {mode==="calendar"&&<>{!data.services.length?<p>Δεν έχεις διαθέσιμη υπηρεσία σε ενεργή συνδρομή. Επικοινώνησε με το Basement.</p>:<><div className="member-service-picker" role="group" aria-label="Υπηρεσίες συνδρομής">{data.services.map(s=><button className={service===s?"selected":""} aria-pressed={service===s} key={s} onClick={()=>setService(s)}>{s}</button>)}</div><div className="member-date-picker"><button aria-label="Προηγούμενη ημέρα" disabled={day<=today} onClick={()=>changeDay(-1)}>‹</button><label>Ημερομηνία<input type="date" value={day} min={today} max={days.at(-1)} onChange={e=>{if(e.target.value)setDay(e.target.value)}}/></label><button aria-label="Επόμενη ημέρα" disabled={day>=(days.at(-1)||today)} onClick={()=>changeDay(1)}>›</button><button onClick={()=>setDay(today)}>Σήμερα</button></div><p>Κάθε κράτηση δεσμεύει μία συνεδρία. Ακύρωση πριν από την έναρξη την επιστρέφει.</p>{data.booking_paused?<p>Οι online κρατήσεις είναι προσωρινά κλειστές.</p>:<div className="member-time-grid">{shown.length?shown.map(s=>{const mine=upcoming.some(b=>b.slot_id===s.id),credit=hasCredit(s);return <button key={s.id} className="member-time-tile" disabled={busy||mine||!credit} onClick={()=>setConfirm({kind:"book",id:s.id,title:`${s.service} · ${date(s.starts_at)} · ${time(s.starts_at)}–${time(s.ends_at)}`})}><strong>{time(s.starts_at)}–{time(s.ends_at)}</strong><span>{mine?"Έχεις κράτηση":!credit?"Χρειάζεται ανανέωση πακέτου":data.show_available_spots?`${s.capacity-Number(s.reserved)} διαθέσιμες θέσεις`:"Διαθέσιμη ώρα"}</span></button>}):<p>Δεν υπάρχουν διαθέσιμες ώρες για αυτή την ημέρα. Διάλεξε άλλη ημερομηνία.</p>}</div>}</>}</>}
 {mode!=="packages"&&<><h3>Οι επόμενες προπονήσεις μου</h3><div className="member-appointments">{upcoming.length?upcoming.map(appointment):<p>Δεν έχεις επόμενη κράτηση.</p>}</div><details className="member-history"><summary>Το ιστορικό μου · {history.length} ραντεβού</summary>{history.slice(0,historyLimit).map(appointment)}{history.length>historyLimit&&<button onClick={()=>setHistoryLimit(n=>n+20)}>Περισσότερα</button>}</details></>}
 </>}{confirm&&<div className="member-confirm-backdrop" onClick={()=>{if(!busy)setConfirm(null)}}><section role="dialog" aria-modal="true" aria-labelledby="member-confirm-title" className="member-confirm" onClick={e=>e.stopPropagation()}><h3 id="member-confirm-title">{confirm.kind==="book"?"Επιβεβαίωση κράτησης":"Ακύρωση προπόνησης"}</h3><p>{confirm.title}</p><p>{confirm.kind==="book"?"Θα αφαιρεθεί μία συνεδρία από το πακέτο σου.":"Η χρεωμένη συνεδρία επιστρέφεται εφόσον η προπόνηση δεν έχει ξεκινήσει."}</p>{confirm.kind==="book"&&data?.terms_required&&<label className="member-terms"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/> Αποδέχομαι την παραπάνω πολιτική κράτησης και ακύρωσης.</label>}{error&&<p role="alert">{error}</p>}<div><button disabled={busy||(confirm.kind==="book"&&data?.terms_required&&!accepted)} onClick={()=>void submit()}>{busy?"Αποθήκευση…":"Επιβεβαίωση"}</button><button disabled={busy} onClick={()=>setConfirm(null)}>Πίσω</button></div></section></div>}</div>;
}
