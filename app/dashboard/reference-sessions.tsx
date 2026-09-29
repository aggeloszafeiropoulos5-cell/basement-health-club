"use client";
import {useEffect,useState} from "react";
import {api} from "../../lib/supabase-rest";
import {athensDay,shiftDay} from "../../lib/reference-calendar";
import type {ServiceConfig} from "./reference-settings";

type Member={id:string;auth_user_id:string;full_name:string;phone:string|null;email:string|null;active:boolean};
type Template={id:string;name:string;sessions_total:number|null;validity_days:number};
type Subscription={id:string;starts_on:string;expires_on:string;sessions_remaining:number|null;status:string;package_templates:{name:string}|null};
type Booking={id:number;status:string;basement_slots:{service:string;starts_at:string}|null};
const statusNames:Record<string,string>={booked:"Προγραμματισμένο",pending:"Αναμονή επιβεβαίωσης",completed:"Ήρθε · Check-in",no_show:"Δεν ήρθε",cancelled:"Ακυρωμένο"};

export default function ReferenceSessions({owner,onOpenMember}:{owner:boolean;onOpenMember:(id:string)=>void}){
 const [members,setMembers]=useState<Member[]>([]),[services,setServices]=useState<ServiceConfig[]>([]),[templates,setTemplates]=useState<Template[]>([]);
 const [selected,setSelected]=useState(""),[search,setSearch]=useState(""),[subscriptions,setSubscriptions]=useState<Subscription[]>([]),[history,setHistory]=useState<Booking[]>([]);
 const [templateId,setTemplateId]=useState(""),[start,setStart]=useState(athensDay()),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[message,setMessage]=useState("");
 const member=members.find(m=>m.id===selected);
 const token=()=>localStorage.getItem("basement_access_token")||"";
 async function request(path:string,body?:unknown,method=body?"POST":"GET"){
  const r=await api("/rest/v1/"+path,token(),{method,...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.message||"Δεν ολοκληρώθηκε η ενέργεια.")}
  return r.status===204?null:r.json().catch(()=>null);
 }
 async function all(path:string){const result=[];for(let offset=0;;offset+=1000){const page=await request(path+`&limit=1000&offset=${offset}`);result.push(...page);if(page.length<1000)return result;}}
 useEffect(()=>{let live=true;void Promise.all([
  all("members?select=id,auth_user_id,full_name,phone,email,active&order=full_name"),
  request("services?select=*&order=created_at"),
  request("package_templates?select=id,name,sessions_total,validity_days&active=eq.true&order=name")
 ]).then(([m,s,t])=>{if(live){setMembers(m);setServices(s);setTemplates(t)}}).catch(e=>{if(live)setMessage(String(e))});return()=>{live=false}},[]);
 async function details(m:Member){const [p,b]=await Promise.all([
  request(`member_packages?member_id=eq.${m.id}&select=id,starts_on,expires_on,sessions_remaining,status,package_templates(name)&order=created_at.desc`),
  m.auth_user_id?request(`basement_bookings?member_id=eq.${m.auth_user_id}&select=id,status,basement_slots(service,starts_at)&order=created_at.desc&limit=100`):Promise.resolve([])
 ]);return {p,b};}
 useEffect(()=>{let live=true;setSubscriptions([]);setHistory([]);if(!member)return;setLoading(true);void details(member).then(({p,b})=>{if(live){setSubscriptions(p);setHistory(b)}}).catch(e=>{if(live)setMessage(String(e))}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[selected,members]);
 async function run(work:()=>Promise<unknown>,success="Αποθηκεύτηκε."){
  setBusy(true);setMessage("");try{await work();if(member){const {p,b}=await details(member);setSubscriptions(p);setHistory(b)}setMessage(success)}catch(e){setMessage(e instanceof Error?e.message:"Δεν ολοκληρώθηκε η ενέργεια.")}finally{setBusy(false)}
 }
 function assign(){const plan=templates.find(t=>t.id===templateId);if(!member||!plan)return;return run(()=>request("member_packages",{member_id:member.id,package_template_id:plan.id,starts_on:start,expires_on:shiftDay(start,plan.validity_days-1),sessions_total:plan.sessions_total,sessions_remaining:plan.sessions_total,status:"active"}),"Το πακέτο προστέθηκε στο μέλος.")}
 async function capacity(id:string,value:number){await run(async()=>{
  const [config,settings,current]=await Promise.all([request("rpc/basement_brand_config",{}),request("app_settings?key=eq.control_center_settings&select=value"),request("services?select=*&order=created_at")]);
  const updated=current.map((s:ServiceConfig)=>s.id===id?{...s,default_capacity:value}:s);
  await request("rpc/basement_save_reference_settings",{p_config:config,p_rules:{openingTime:"08:00",closingTime:"22:00",bookingMinHours:0,bookingMaxDays:365,maxActiveBookings:0,...settings[0]?.value},p_services:updated});
  setServices(updated);window.dispatchEvent(new Event("basement-settings-changed"));
 },"Η χωρητικότητα ενημερώθηκε στο ημερολόγιο.")}
 const visible=members.filter(m=>`${m.full_name} ${m.phone||""} ${m.email||""}`.toLocaleLowerCase("el").includes(search.toLocaleLowerCase("el")));
 return <section><div className="reference-heading"><div><div className="eyebrow">ΜΕΛΗ & ΤΜΗΜΑΤΑ</div><h1>Συνεδρίες & ρυθμίσεις<span>.</span></h1></div></div>
  {message&&<p className="notice" role="status">{message}</p>}
  <div className="reference-settings-grid"><section className="reference-panel reference-settings-card">
   <h2>Καρτέλα μέλους</h2><label>Αναζήτηση μέλους<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Όνομα, τηλέφωνο ή email"/></label>
   <label>Μέλος<select value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);setMessage("")}}><option value="">Επίλεξε μέλος</option>{member&&!visible.some(m=>m.id===member.id)&&<option value={member.id}>{member.full_name}</option>}{visible.map(m=><option key={m.id} value={m.id}>{m.full_name}</option>)}</select></label>
   {loading?<p>Φόρτωση καρτέλας…</p>:member&&<><div className="reference-list-row"><span><b>{member.full_name}</b><small>{member.phone||"Χωρίς τηλέφωνο"} · {member.email||"Χωρίς email"}</small><small>{member.active?"Ενεργό μέλος":"Ανενεργό μέλος"}</small></span>{member.auth_user_id&&<button onClick={()=>onOpenMember(member.auth_user_id)}>Πλήρης καρτέλα ↗</button>}</div>
    <h3>Υπόλοιπα συνδρομών</h3>{subscriptions.length?subscriptions.map(p=><div className="reference-list-row" key={p.id}><span><b>{p.package_templates?.name||"Πακέτο"}</b><small>{p.starts_on} – {p.expires_on} · {p.status}</small></span><span><b>{p.sessions_remaining??"∞"} συνεδρίες</b>{owner&&p.sessions_remaining!==null&&<span className="reference-credit-adjust">{[-1,1].map(n=><button key={n} disabled={busy} aria-label={n>0?"Προσθήκη συνεδρίας":"Αφαίρεση συνεδρίας"} onClick={()=>void run(()=>request("rpc/basement_adjust_sessions",{p_member_package_id:p.id,p_change:n,p_reason:"Χειροκίνητη διόρθωση από Συνεδρίες"}))}>{n>0?"+":"−"}</button>)}</span>}</span></div>):<p>Δεν έχει καταχωριστεί πακέτο.</p>}
    {owner&&<form onSubmit={e=>{e.preventDefault();void assign()}}><h3>Προσθήκη πακέτου</h3><label>Πακέτο<select value={templateId} onChange={e=>setTemplateId(e.target.value)} required><option value="">Επίλεξε πακέτο</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name} · {t.sessions_total??"∞"} συνεδρίες</option>)}</select></label><label>Έναρξη<input type="date" value={start} onChange={e=>setStart(e.target.value)} required/></label><button className="primary" disabled={busy||!templateId}>Προσθήκη πακέτου</button></form>}
    <h3>Ιστορικό ραντεβού</h3><div className="reference-session-history">{history.length?history.map(b=><div className="reference-list-row" key={b.id}><span><b>{b.basement_slots?.service||"Ραντεβού"}</b><small>{b.basement_slots?new Date(b.basement_slots.starts_at).toLocaleString("el-GR",{timeZone:"Europe/Athens"}):"—"}</small></span><span>{statusNames[b.status]||b.status}</span></div>):<p>Δεν υπάρχουν ραντεβού.</p>}</div><p className="form-help">Εμφανίζονται τα 100 πιο πρόσφατα ραντεβού. Το πλήρες ιστορικό ημερομηνιών είναι στο ημερολόγιο.</p>
   </>}
  </section><section className="reference-panel reference-settings-card"><h2>Θέσεις ανά υπηρεσία</h2><p>Τα όρια εφαρμόζονται στις διαθέσιμες ώρες του ημερολογίου.</p>{services.map(s=><form key={s.id+":"+s.default_capacity} className="reference-capacity-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void capacity(s.id,Number(f.get("capacity")))}}><label>{s.name}<input name="capacity" type="number" min="1" max="30" defaultValue={s.default_capacity} disabled={!owner} required/></label>{owner&&<button disabled={busy}>Αποθήκευση</button>}</form>)}<p className="form-help">Η μείωση ορίου δεν ακυρώνει υπάρχουσες κρατήσεις. Οι ειδικές χωρητικότητες ρυθμίζονται από το Settings Center.</p><h2>Κρατήσεις & υπενθυμίσεις</h2><p>Η συνεδρία δεσμεύεται με την κράτηση και επιστρέφεται όταν ακυρωθεί πριν την έναρξη. Το check-in δεν αφαιρεί δεύτερη συνεδρία.</p><p>Τα μέλη βλέπουν μόνο τα δικά τους προγράμματα και ενεργοποιούν τις ειδοποιήσεις από «Εφαρμογή & ειδοποιήσεις».</p></section></div>
 </section>
}
