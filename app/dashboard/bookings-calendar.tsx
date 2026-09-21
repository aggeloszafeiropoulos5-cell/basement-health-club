"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {api} from "../../lib/supabase-rest";

type Slot={id:number;service:string;starts_at:string;ends_at:string;capacity:number;enabled:boolean;reserved:number};
type Booking={id:number;slot_id:number;member_id:string;status:string};
type Member={id:string;full_name:string|null};
const services=["Όλες","Cross Training","EMS Training","EMS Sculpting","Vacu Power"];
const greekDate=new Intl.DateTimeFormat("el-GR",{timeZone:"Europe/Athens",weekday:"long",day:"numeric",month:"long"});
const greekTime=new Intl.DateTimeFormat("el-GR",{timeZone:"Europe/Athens",hour:"2-digit",minute:"2-digit",hour12:false});
const dateParts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit",day:"2-digit"});
const dayKey=(d:string)=>{const p=Object.fromEntries(dateParts.formatToParts(new Date(d)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`};

export default function BookingsCalendar({userId,owner,members}:{userId:string;owner:boolean;members:Member[]}){
  const [slots,setSlots]=useState<Slot[]>([]),[bookings,setBookings]=useState<Booking[]>([]);
  const [selectedDay,setSelectedDay]=useState(""),[service,setService]=useState("Όλες");
  const [memberId,setMemberId]=useState(""),[pending,setPending]=useState<number|null>(null);
  const [error,setError]=useState(""),[ready,setReady]=useState(false);
  const token=()=>localStorage.getItem("basement_access_token")||"";
  async function bookingRows(path:string){
    const rows:Booking[]=[];
    for(let offset=0;;offset+=1000){
      const response=await api(`${path}&limit=1000&offset=${offset}`,token());
      if(!response.ok)throw new Error("Αδυναμία φόρτωσης κρατήσεων.");
      const page:Booking[]=await response.json();rows.push(...page);
      if(page.length<1000)return rows;
    }
  }

  const refresh=useCallback(async()=>{
    try {
    const now=new Date(),end=new Date(now.getTime()+14*86400000);
    const q="/rest/v1/rpc/basement_availability";
    const [s,rows]=await Promise.all([api(q,token()),bookingRows(`/rest/v1/basement_bookings?select=id,slot_id,member_id,status,basement_slots!inner(starts_at)&status=eq.booked&basement_slots.starts_at=gte.${encodeURIComponent(now.toISOString())}&basement_slots.starts_at=lt.${encodeURIComponent(end.toISOString())}&order=id.asc`)]);
    if(!s.ok){setError("Το ημερολόγιο δεν είναι ακόμη συνδεδεμένο. Χρειάζεται να εκτελεστεί το αρχείο SQL στο Supabase.");setReady(true);return}
    const slotRows=await s.json();
    setSlots(slotRows);setBookings(rows);setReady(true);setError("");
    } catch {setError("Δεν ήταν δυνατή η φόρτωση. Έλεγξε τη σύνδεση και δοκίμασε ξανά.");setReady(true)}
  },[]);
  useEffect(()=>{void refresh()},[refresh]);

  const days=useMemo(()=>[...new Set(slots.map(s=>dayKey(s.starts_at)))], [slots]);
  const activeDay=selectedDay&&days.includes(selectedDay)?selectedDay:days[0];
  const shown=slots.filter(s=>dayKey(s.starts_at)===activeDay&&(service==="Όλες"||s.service===service));
  const myBookings=bookings.filter(b=>b.member_id===userId);

  async function action(slotId:number,bookingId?:number){
    setError("");setPending(slotId);
    const path=bookingId?"basement_cancel":"basement_book";
    const body=bookingId?{p_booking_id:bookingId}:{p_slot_id:slotId,...(owner&&memberId?{p_member_id:memberId}:{})};
    try {
      const response=await api(`/rest/v1/rpc/${path}`,token(),{method:"POST",body:JSON.stringify(body)});
      if(!response.ok){const data=await response.json().catch(()=>({}));setError(data.message||"Η ενέργεια δεν ολοκληρώθηκε.")}
      else await refresh();
    } catch {setError("Δεν ήταν δυνατή η σύνδεση. Δοκίμασε ξανά.")}
    finally {setPending(null)}
  }

  async function toggle(slot:Slot){
    setPending(slot.id);setError("");
    try{
      const response=await api(`/rest/v1/basement_slots?id=eq.${slot.id}`,token(),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!slot.enabled})});
      if(!response.ok)throw new Error("Δεν αποθηκεύτηκε η αλλαγή διαθεσιμότητας.");
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Δεν ήταν δυνατή η σύνδεση.")}
    finally{setPending(null)}
  }

  return <div className="booking-panel">
    <h2>Ημερολόγιο κρατήσεων</h2>
    <p>Πρόγραμμα επόμενων 14 ημερών · Ώρα Ελλάδας. Το κλείσιμο ώρας εμποδίζει νέες κρατήσεις, χωρίς να ακυρώνει τις υπάρχουσες.</p>
    <button onClick={()=>void refresh()} disabled={pending!==null}>Ανανέωση θέσεων</button>
    {!ready&&<p>Φόρτωση προγράμματος…</p>}
    {error&&<p className="booking-error" role="alert">{error}</p>}
    {ready&&<>
      <div className="booking-controls">
        <label>Ημέρα<select value={activeDay||""} onChange={e=>setSelectedDay(e.target.value)}>{days.map(d=><option value={d} key={d}>{greekDate.format(new Date(`${d}T12:00:00+03:00`))}</option>)}</select></label>
        <label>Υπηρεσία<select value={service} onChange={e=>setService(e.target.value)}>{services.map(s=><option key={s}>{s}</option>)}</select></label>
        {owner&&<label>Κράτηση για μέλος<select value={memberId} onChange={e=>setMemberId(e.target.value)}><option value="">Επίλεξε μέλος</option>{members.map(m=><option value={m.id} key={m.id}>{m.full_name||m.id}</option>)}</select></label>}
      </div>
      {shown.length?<div className="booking-list">{shown.map(slot=>{
        const reserved=bookings.filter(b=>b.slot_id===slot.id),free=slot.capacity-Number(slot.reserved);
        const target=owner?memberId:userId;
        const existing=reserved.find(b=>b.member_id===target);
        return <article key={slot.id}>
          <div><strong>{greekTime.format(new Date(slot.starts_at))}–{greekTime.format(new Date(slot.ends_at))}</strong><span>{slot.service}</span></div>
          <div className="booking-meta">{slot.enabled?`${Math.max(0,free)} από ${slot.capacity} διαθέσιμες`:"Μη διαθέσιμη"}
            {owner&&reserved.length>0&&<small>{reserved.map(b=>members.find(m=>m.id===b.member_id)?.full_name||"Μέλος").join(", ")}</small>}
          </div>
          {existing?<button className="cancel-booking" disabled={pending!==null} onClick={()=>void action(slot.id,existing.id)}>Ακύρωση</button>:
            <button disabled={!slot.enabled||free<=0||pending!==null||(owner&&!memberId)} onClick={()=>void action(slot.id)}>{pending===slot.id?"Παρακαλώ περίμενε…":"Κράτηση"}</button>}
          {owner&&<button className="slot-toggle" disabled={pending!==null} onClick={()=>void toggle(slot)}>{slot.enabled?"Κλείσιμο ώρας":"Άνοιγμα ώρας"}</button>}
        </article>
      })}</div>:<p>Δεν υπάρχουν ώρες για την επιλεγμένη ημέρα και υπηρεσία.</p>}
      {!owner&&myBookings.length>0&&<p className="booking-footnote">Έχεις {myBookings.length} ενεργές κρατήσεις. Μπορείς να τις ακυρώσεις από την αντίστοιχη ημέρα.</p>}
    </>}
  </div>;
}
