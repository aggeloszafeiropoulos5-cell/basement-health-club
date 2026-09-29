"use client";
import {FormEvent,useEffect,useMemo,useState} from "react";
import {api} from "../../lib/supabase-rest";

type PackageTemplate={id:string;name:string;sessions_total:number|null;validity_days:number;price:number|string;max_bookings_day:number|null;max_bookings_week:number|null;cancellation_hours:number;online_booking_enabled:boolean;waiting_list_enabled:boolean;active:boolean};
type Member={id:string;full_name:string};
type Service={id:string;name:string};
type MemberPackage={id:string;member_id:string;package_template_id:string;starts_on:string;expires_on:string;sessions_total:number|null;sessions_remaining:number|null;status:string};

export default function PackagesPanel({owner,userId}:{owner:boolean;userId:string}){
  const [templates,setTemplates]=useState<PackageTemplate[]>([]),[members,setMembers]=useState<Member[]>([]),[services,setServices]=useState<Service[]>([]),[assigned,setAssigned]=useState<MemberPackage[]>([]);
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[memberId,setMemberId]=useState(""),[templateId,setTemplateId]=useState("");
  const token=()=>localStorage.getItem("basement_access_token")||"";
  const load=async()=>{
    setMessage("");
    try{
      const memberQuery=owner?"/rest/v1/members?select=id,full_name&active=eq.true&order=full_name":`/rest/v1/members?select=id,full_name&auth_user_id=eq.${userId}`;
      const [t,m,s,a]=await Promise.all([
        api("/rest/v1/package_templates?select=id,name,sessions_total,validity_days,price,max_bookings_day,max_bookings_week,cancellation_hours,online_booking_enabled,waiting_list_enabled,active&order=name",token()),
        api(memberQuery,token()),
        api("/rest/v1/services?select=id,name&active=eq.true&order=name",token()),
        api("/rest/v1/member_packages?select=id,member_id,package_template_id,starts_on,expires_on,sessions_total,sessions_remaining,status&order=created_at.desc",token()),
      ]);
      if(!t.ok||!m.ok||!s.ok||!a.ok)throw new Error("Δεν ήταν δυνατή η φόρτωση των πακέτων.");
      setTemplates(await t.json());setMembers(await m.json());setServices(await s.json());setAssigned(await a.json());
    }catch(error){setMessage(error instanceof Error?error.message:"Δεν ήταν δυνατή η φόρτωση.")}
  };
  useEffect(()=>{void load()},[]);
  const templateMap=useMemo(()=>Object.fromEntries(templates.map(x=>[x.id,x])),[templates]);
  const memberMap=useMemo(()=>Object.fromEntries(members.map(x=>[x.id,x])),[members]);

  async function createTemplate(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setMessage("");
    const formElement=e.currentTarget,form=new FormData(formElement),serviceId=String(form.get("service_id")||"");
    const sessions=String(form.get("sessions_total")||"").trim();
    const payload={name:String(form.get("name")||"").trim(),sessions_total:sessions?Number(sessions):null,validity_days:Number(form.get("validity_days")),price:Number(form.get("price")||0),max_bookings_day:Number(form.get("max_bookings_day")||0)||null,max_bookings_week:Number(form.get("max_bookings_week")||0)||null,cancellation_hours:0,online_booking_enabled:true,waiting_list_enabled:true,active:true};
    try{
      const response=await api("/rest/v1/package_templates?select=id",token(),{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(payload)});
      const rows=await response.json().catch(()=>[]);if(!response.ok||!rows[0]?.id)throw new Error("Δεν αποθηκεύτηκε το πακέτο.");
      if(serviceId){const link=await api("/rest/v1/package_template_services",token(),{method:"POST",body:JSON.stringify({package_template_id:rows[0].id,service_id:serviceId})});if(!link.ok)throw new Error("Το πακέτο δημιουργήθηκε, αλλά δεν συνδέθηκε με την υπηρεσία.")}
      formElement.reset();await load();setMessage("Το πακέτο δημιουργήθηκε.");
    }catch(error){setMessage(error instanceof Error?error.message:"Δεν ολοκληρώθηκε η ενέργεια.")}finally{setBusy(false)}
  }

  async function assignPackage(){
    const plan=templates.find(x=>x.id===templateId);if(!memberId||!plan){setMessage("Επίλεξε μέλος και πακέτο.");return}
    const start=new Date(),end=new Date(start);end.setDate(end.getDate()+plan.validity_days-1);
    const date=(d:Date)=>d.toISOString().slice(0,10);
    setBusy(true);setMessage("");
    try{const response=await api("/rest/v1/member_packages",token(),{method:"POST",body:JSON.stringify({member_id:memberId,package_template_id:plan.id,starts_on:date(start),expires_on:date(end),sessions_total:plan.sessions_total,sessions_remaining:plan.sessions_total,status:"active"})});if(!response.ok)throw new Error("Δεν ενεργοποιήθηκε το πακέτο.");setMessage("Το πακέτο ενεργοποιήθηκε στο μέλος.");await load()}catch(error){setMessage(error instanceof Error?error.message:"Δεν ολοκληρώθηκε η ενέργεια.")}finally{setBusy(false)}
  }

  async function toggleTemplate(plan:PackageTemplate){
    setBusy(true);const response=await api(`/rest/v1/package_templates?id=eq.${plan.id}`,token(),{method:"PATCH",body:JSON.stringify({active:!plan.active})});setBusy(false);if(response.ok)await load();else setMessage("Δεν αποθηκεύτηκε η αλλαγή.")
  }
  const updateTemplate=(id:string,key:keyof PackageTemplate,value:unknown)=>setTemplates(x=>x.map(p=>p.id===id?{...p,[key]:value}:p));
  async function saveTemplate(plan:PackageTemplate){
    setBusy(true);setMessage("");const payload={name:plan.name,sessions_total:plan.sessions_total,validity_days:+plan.validity_days,price:+plan.price,max_bookings_day:plan.max_bookings_day?+plan.max_bookings_day:null,max_bookings_week:plan.max_bookings_week?+plan.max_bookings_week:null,cancellation_hours:+plan.cancellation_hours,online_booking_enabled:plan.online_booking_enabled,waiting_list_enabled:plan.waiting_list_enabled,active:plan.active};const response=await api(`/rest/v1/package_templates?id=eq.${plan.id}`,token(),{method:"PATCH",body:JSON.stringify(payload)});setBusy(false);setMessage(response.ok?`Αποθηκεύτηκε: ${plan.name}`:"Δεν αποθηκεύτηκαν οι κανόνες του πακέτου.");if(response.ok)await load()
  }

  return <div className="section-stack"><div className="panel-title"><div><span className="kicker">ΠΑΚΕΤΑ</span><h2>Πακέτα και συνδρομές</h2><p>{owner?"Δημιούργησε πακέτα και ενεργοποίησέ τα στα μέλη.":"Δες τις ενεργές συνδρομές και το υπόλοιπό σου."}</p></div></div>
    {message&&<p className="notice" role="status">{message}</p>}
    {owner&&<div className="two-col"><form className="admin-form" onSubmit={createTemplate}><h3>Νέο πακέτο</h3><label>Όνομα<input name="name" placeholder="π.χ. EMS 8 συνεδρίες / 30 ημέρες" required/></label><label>Υπηρεσία<select name="service_id" required><option value="">Επίλεξε υπηρεσία</option>{services.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><div className="form-row"><label>Συνεδρίες (κενό = unlimited)<input name="sessions_total" type="number" min="1"/></label><label>Διάρκεια (ημέρες)<input name="validity_days" type="number" min="1" defaultValue="30" required/></label></div><div className="form-row"><label>Μέγιστο/ημέρα<input name="max_bookings_day" type="number" min="0" defaultValue="0"/></label><label>Μέγιστο/εβδομάδα<input name="max_bookings_week" type="number" min="0" defaultValue="0"/></label></div><p className="form-help">Ακύρωση πριν την έναρξη επιστρέφει τη συνεδρία.</p><label>Τιμή (€)<input name="price" type="number" min="0" step="0.01" defaultValue="0"/></label><button disabled={busy}>Δημιουργία πακέτου</button></form><div className="admin-form"><h3>Ενεργοποίηση σε μέλος</h3><label>Μέλος<select value={memberId} onChange={e=>setMemberId(e.target.value)}><option value="">Επίλεξε μέλος</option>{members.map(x=><option value={x.id} key={x.id}>{x.full_name}</option>)}</select></label><label>Πακέτο<select value={templateId} onChange={e=>setTemplateId(e.target.value)}><option value="">Επίλεξε πακέτο</option>{templates.filter(x=>x.active).map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><button type="button" disabled={busy||!members.length} onClick={()=>void assignPackage()}>Ενεργοποίηση πακέτου</button>{!members.length&&<p className="muted-copy">Τα νέα μέλη θα εμφανίζονται εδώ αυτόματα.</p>}</div></div>}
    <div className="package-grid">{templates.map(plan=><article key={plan.id} className={!plan.active?"inactive-card":""}><span>{plan.active?"ΕΝΕΡΓΟ":"ΑΝΕΝΕΡΓΟ"}</span>{owner?<div className="package-editor"><label>Όνομα<input value={plan.name} onChange={e=>updateTemplate(plan.id,"name",e.target.value)}/></label><div><label>Συνεδρίες<input type="number" min="1" value={plan.sessions_total??""} placeholder="∞" onChange={e=>updateTemplate(plan.id,"sessions_total",e.target.value?Number(e.target.value):null)}/></label><label>Ημέρες<input type="number" min="1" value={plan.validity_days} onChange={e=>updateTemplate(plan.id,"validity_days",Number(e.target.value))}/></label></div><div><label>Max/ημέρα<input type="number" min="0" value={plan.max_bookings_day??0} onChange={e=>updateTemplate(plan.id,"max_bookings_day",Number(e.target.value)||null)}/></label><label>Max/εβδομάδα<input type="number" min="0" value={plan.max_bookings_week??0} onChange={e=>updateTemplate(plan.id,"max_bookings_week",Number(e.target.value)||null)}/></label></div><p className="form-help">Επιστροφή συνεδρίας όταν ακυρωθεί πριν την έναρξη.</p><div className="package-checks"><label><input type="checkbox" checked={plan.online_booking_enabled} onChange={e=>updateTemplate(plan.id,"online_booking_enabled",e.target.checked)}/> Online</label><label><input type="checkbox" checked={plan.waiting_list_enabled} onChange={e=>updateTemplate(plan.id,"waiting_list_enabled",e.target.checked)}/> Αναμονή</label></div><button disabled={busy} onClick={()=>void saveTemplate(plan)}>Αποθήκευση κανόνων</button><button disabled={busy} onClick={()=>void toggleTemplate(plan)}>{plan.active?"Απενεργοποίηση":"Ενεργοποίηση"}</button></div>:<><h3>{plan.name}</h3><strong>{plan.sessions_total??"∞"} συνεδρίες</strong><p>{plan.validity_days} ημέρες · {Number(plan.price).toFixed(2)} €</p></>}</article>)}</div>
    <div className="member-list subscriptions"><h3>{owner?"Ενεργές συνδρομές":"Οι συνδρομές μου"}</h3>{assigned.length?assigned.map(item=><div key={item.id}><span><b>{owner?(memberMap[item.member_id]?.full_name||"Μέλος"):(templateMap[item.package_template_id]?.name||"Πακέτο")}</b><small>{owner?(templateMap[item.package_template_id]?.name||"Πακέτο"):`Λήξη ${item.expires_on}`}</small></span><span>{item.sessions_remaining??"∞"} υπόλοιπο</span></div>):<p>Δεν υπάρχουν ενεργές συνδρομές.</p>}</div>
  </div>;
}
