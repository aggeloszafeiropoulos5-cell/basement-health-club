"use client";
import {useEffect,useState} from "react";
import {api} from "../../lib/supabase-rest";

type Appointment={id:string|number;starts_at:string;ends_at:string;service:string;source_status:string;notes:string|null;trainer_name:string|null;payment_status?:string|null;external_booking_id?:string};
const label:Record<string,string>={COMPLETED:"Ολοκληρώθηκε",CONFIRMED:"Επιβεβαιωμένο","CANCELLED BY CUSTOMER":"Ακύρωση πελάτη","REJECTED BY YOU":"Ακύρωση επιχείρησης","NO SHOW":"No-show","RESCHEDULED BY YOU":"Μεταφέρθηκε","RESCHEDULED BY CUSTOMER":"Μεταφέρθηκε",booked:"Κρατημένο",completed:"Ολοκληρώθηκε",cancelled:"Ακυρωμένο",late_cancel:"Εκπρόθεσμη ακύρωση",no_show:"No-show"};
const dated=(value:string)=>new Date(value).toLocaleString("el-GR",{timeZone:"Europe/Athens",dateStyle:"medium",timeStyle:"short"});
export default function MemberAppointments({memberId}:{memberId:string}){
 const [rows,setRows]=useState<Appointment[]>([]),[error,setError]=useState(""),[creating,setCreating]=useState(false),[busy,setBusy]=useState(false),[showAll,setShowAll]=useState(false);
 const token=()=>localStorage.getItem("basement_access_token")||"";
 async function load(){try{const [a,m]=await Promise.all([
  api(`/rest/v1/bookup_bookings?member_id=eq.${memberId}&select=id,external_booking_id,starts_at,ends_at,service,source_status,notes,trainer_name,payment_status&order=starts_at.desc&limit=1000`,token()),
  api(`/rest/v1/member_appointments?member_id=eq.${memberId}&select=id,starts_at,ends_at,service,status,notes,trainer_name&order=starts_at.desc&limit=1000`,token())]);
  if(!a.ok||!m.ok)throw Error();const archived:Appointment[]=await a.json();const manual=(await m.json()).map((x:{status:string}&Omit<Appointment,"source_status">)=>({...x,source_status:x.status}));setRows([...archived,...manual].sort((x,y)=>y.starts_at.localeCompare(x.starts_at)));setError("")
 }catch{setError("Δεν φορτώθηκαν τα ραντεβού.")}}
 useEffect(()=>{void load()},[memberId]);
 async function create(e:React.FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,fd=new FormData(form);const start=new Date(String(fd.get("starts_at"))),minutes=Number(fd.get("duration")||40);if(!Number.isFinite(start.valueOf())||minutes<=0){setError("Έλεγξε την ημερομηνία και τη διάρκεια.");return}setBusy(true);const response=await api("/rest/v1/member_appointments",token(),{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({member_id:memberId,starts_at:start.toISOString(),ends_at:new Date(start.getTime()+minutes*60000).toISOString(),service:String(fd.get("service")||"").trim(),trainer_name:String(fd.get("trainer")||"").trim()||null,notes:String(fd.get("notes")||"").trim()||null})});setBusy(false);if(!response.ok){setError("Δεν αποθηκεύτηκε το ραντεβού.");return}form.reset();setCreating(false);await load()}
 const now=Date.now(),upcoming=rows.filter(x=>new Date(x.starts_at).valueOf()>=now&&["CONFIRMED","booked"].includes(x.source_status)).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
 const history=rows.filter(x=>!upcoming.includes(x));
 const count=(states:string[])=>rows.filter(x=>states.includes(x.source_status)).length;
 return <section className="member-appointments"><div className="member-appointments-head"><h3>Ραντεβού & ιστορικό</h3><button type="button" onClick={()=>setCreating(x=>!x)}>＋ Νέο ραντεβού</button></div>{error&&<p role="alert">{error}</p>}
  {creating&&<form className="member-edit-form" onSubmit={e=>void create(e)}><label>Υπηρεσία<input name="service" required/></label><label>Ημερομηνία και ώρα<input name="starts_at" type="datetime-local" required/></label><label>Διάρκεια (λεπτά)<input name="duration" type="number" min="1" defaultValue="40" required/></label><label>Γυμναστής<input name="trainer"/></label><label>Σημειώσεις<textarea name="notes"/></label><button disabled={busy}>Αποθήκευση ραντεβού</button></form>}
  <div className="status-counts"><span>Σύνολο <b>{rows.length}</b></span><span>Επόμενα <b>{upcoming.length}</b></span><span>Ολοκληρωμένα <b>{count(["COMPLETED","completed"])}</b></span><span>Ακυρώσεις <b>{count(["CANCELLED BY CUSTOMER","REJECTED BY YOU","cancelled"])}</b></span><span>Late cancellations <b>{count(["late_cancel"])}</b></span><span>No-shows <b>{count(["NO SHOW","no_show"])}</b></span></div>
  <h4>Επόμενα ραντεβού</h4>{upcoming.length?upcoming.map(row=><Entry key={`${row.external_booking_id||"manual"}-${row.id}`} row={row}/>):<p>Δεν υπάρχουν επόμενα ραντεβού.</p>}
  <h4>Ιστορικό ραντεβού</h4>{history.slice(0,showAll?history.length:25).map(row=><Entry key={`${row.external_booking_id||"manual"}-${row.id}`} row={row}/>)}{history.length>25&&<button onClick={()=>setShowAll(x=>!x)}>{showAll?"Λιγότερα":`Όλο το ιστορικό (${history.length})`}</button>}
 </section>
}
function Entry({row}:{row:Appointment}){return <div className="detail-line"><span><b>{row.service}</b><small>{dated(row.starts_at)} – {dated(row.ends_at)} · {label[row.source_status]||row.source_status}{row.trainer_name?` · ${row.trainer_name}`:""}{row.payment_status?` · ${row.payment_status}`:""}</small>{row.notes&&<small>{row.notes}</small>}</span><em>{row.external_booking_id?`BookUp #${row.external_booking_id}`:"Basement"}</em></div>}
