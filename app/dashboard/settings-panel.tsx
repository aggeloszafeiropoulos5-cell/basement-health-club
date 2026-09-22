"use client";
import {useEffect,useState} from "react";
import {api} from "../../lib/supabase-rest";

type Service={id:string;name:string;duration_minutes:number;default_capacity:number;online_booking_enabled:boolean;waiting_list_enabled:boolean;active:boolean};
type Location={id:string;name:string;address:string|null;phone:string|null;timezone:string};

export default function SettingsPanel({owner,profile}:{owner:boolean;profile:{full_name:string|null;role:string}}){
  const [services,setServices]=useState<Service[]>([]),[locations,setLocations]=useState<Location[]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState("");
  const token=()=>localStorage.getItem("basement_access_token")||"";
  const load=async()=>{try{const [s,l]=await Promise.all([api("/rest/v1/services?select=id,name,duration_minutes,default_capacity,online_booking_enabled,waiting_list_enabled,active&order=name",token()),api("/rest/v1/locations?select=id,name,address,phone,timezone&active=eq.true",token())]);if(!s.ok||!l.ok)throw new Error();setServices(await s.json());setLocations(await l.json())}catch{setMessage("Δεν ήταν δυνατή η φόρτωση των ρυθμίσεων.")}};
  useEffect(()=>{void load()},[]);
  const update=(id:string,key:keyof Service,value:unknown)=>setServices(x=>x.map(s=>s.id===id?{...s,[key]:value}:s));
  async function save(service:Service){setBusy(service.id);setMessage("");const response=await api(`/rest/v1/services?id=eq.${service.id}`,token(),{method:"PATCH",body:JSON.stringify({duration_minutes:Number(service.duration_minutes),default_capacity:Number(service.default_capacity),online_booking_enabled:service.online_booking_enabled,waiting_list_enabled:service.waiting_list_enabled,active:service.active})});setBusy("");setMessage(response.ok?`Αποθηκεύτηκε: ${service.name}`:"Δεν αποθηκεύτηκε η αλλαγή.")}
  return <div className="section-stack"><div className="panel-title"><div><span className="kicker">ΡΥΘΜΙΣΕΙΣ</span><h2>Ρυθμίσεις Basement</h2><p>Λογαριασμός, χώρος και υπηρεσίες.</p></div></div>{message&&<p className="notice" role="status">{message}</p>}
    <div className="settings-grid"><article className="coming-panel"><h3>Ο λογαριασμός σου</h3><p><b>Όνομα:</b> {profile.full_name||"—"}</p><p><b>Ρόλος:</b> {profile.role}</p></article>{locations.map(location=><article className="coming-panel" key={location.id}><h3>{location.name}</h3><p><b>Διεύθυνση:</b> {location.address||"Δεν έχει οριστεί"}</p><p><b>Τηλέφωνο:</b> {location.phone||"Δεν έχει οριστεί"}</p><p><b>Ζώνη ώρας:</b> {location.timezone}</p></article>)}</div>
    {owner&&<div className="service-settings"><h3>Υπηρεσίες</h3>{services.map(service=><article key={service.id}><div><h4>{service.name}</h4><label className="check"><input type="checkbox" checked={service.active} onChange={e=>update(service.id,"active",e.target.checked)}/> Ενεργή</label></div><label>Διάρκεια (λεπτά)<input type="number" min="1" value={service.duration_minutes} onChange={e=>update(service.id,"duration_minutes",Number(e.target.value))}/></label><label>Θέσεις<input type="number" min="1" value={service.default_capacity} onChange={e=>update(service.id,"default_capacity",Number(e.target.value))}/></label><label className="check"><input type="checkbox" checked={service.online_booking_enabled} onChange={e=>update(service.id,"online_booking_enabled",e.target.checked)}/> Online κράτηση</label><label className="check"><input type="checkbox" checked={service.waiting_list_enabled} onChange={e=>update(service.id,"waiting_list_enabled",e.target.checked)}/> Λίστα αναμονής</label><button disabled={busy===service.id} onClick={()=>void save(service)}>{busy===service.id?"Αποθήκευση…":"Αποθήκευση"}</button></article>)}</div>}
  </div>;
}
