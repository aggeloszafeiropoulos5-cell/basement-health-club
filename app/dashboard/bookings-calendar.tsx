"use client";
import {useCallback,useEffect,useMemo,useState,type CSSProperties} from "react";
import {api} from "../../lib/supabase-rest";

type Slot={id:number;service:string;starts_at:string;ends_at:string;capacity:number;enabled:boolean;reserved:number};
type Booking={id:number;slot_id:number;member_id:string;status:string};
type Member={id:string;full_name:string|null};
type CalendarSettings={showEndTime?:boolean;hideZeroCustomer?:boolean;hideZeroAdmin?:boolean;showAvailableSpots?:boolean;pauseBookings?:boolean;colorPerService?:boolean};
const services=["Όλες","Cross Training","EMS Training","EMS Sculpting","Vacu Power"];
const greekDate=new Intl.DateTimeFormat("el-GR",{timeZone:"Europe/Athens",weekday:"long",day:"numeric",month:"long"});
const greekTime=new Intl.DateTimeFormat("el-GR",{timeZone:"Europe/Athens",hour:"2-digit",minute:"2-digit",hour12:false});
const dateParts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit",day:"2-digit"});
const dayKey=(d:string)=>{const p=Object.fromEntries(dateParts.formatToParts(new Date(d)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`};

export default function BookingsCalendar({userId,owner,members}:{userId:string;owner:boolean;members:Member[]}){
  const [slots,setSlots]=useState<Slot[]>([]),[bookings,setBookings]=useState<Booking[]>([]);
  const [selectedDay,setSelectedDay]=useState(""),[service,setService]=useState("Όλες");
  const [memberId,setMemberId]=useState(""),[pending,setPending]=useState<number|null>(null);
  const [settings,setSettings]=useState<CalendarSettings>({showEndTime:true,showAvailableSpots:true,colorPerService:true});
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
    const [s,rows,config]=await Promise.all([api(q,token()),bookingRows(`/rest/v1/basement_bookings?select=id,slot_id,member_id,status,basement_slots!inner(starts_at)&status=eq.booked&basement_slots.starts_at=gte.${encodeURIComponent(now.toISOString())}&basement_slots.starts_at=lt.${encodeURIComponent(end.toISOString())}&order=id.asc`),api("/rest/v1/app_settings?key=eq.control_center_settings&select=value",token())]);
    if(!s.ok){setError("Το ημερολόγιο δεν είναι ακόμη συνδεδεμένο. Χρειάζεται να εκτελεστεί το αρχείο SQL στο Supabase.");setReady(true);return}
    const slotRows=await s.json();
    if(config.ok){const configRows=await config.json();if(configRows[0]?.value)setSettings(configRows[0].value)}
    setSlots(slotRows);setBookings(rows);setReady(true);setError("");
    } catch {setError("Δεν ήταν δυνατή η φόρτωση. Έλεγξε τη σύνδεση και δοκίμασε ξανά.");setReady(true)}
  },[]);
  useEffect(()=>{void refresh()},[refresh]);

  const days=useMemo(()=>[...new Set(slots.map(s=>dayKey(s.starts_at)))], [slots]);
  const activeDay=selectedDay&&days.includes(selectedDay)?selectedDay:days[0];
  const shown=slots.filter(s=>dayKey(s.starts_at)===activeDay&&(service==="Όλες"||s.service===service)&&!(((owner&&settings.hideZeroAdmin)||(!owner&&settings.hideZeroCustomer))&&Number(s.reserved)>=s.capacity));
  const visibleServices=services.slice(1).filter(name=>service==="Όλες"||name===service);
  const rowTimes=useMemo(()=>[...new Set(shown.map(s=>s.starts_at))].sort((a,b)=>new Date(a).getTime()-new Date(b).getTime()),[shown]);
  const activeDayIndex=days.indexOf(activeDay);
  const myBookings=bookings.filter(b=>b.member_id===userId);

  function changeDay(step:number){
    const next=days[activeDayIndex+step];if(next)setSelectedDay(next);
  }

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

  return <div className="calendar-page">
    <div className="calendar-toolbar">
      <div className="day-nav"><button aria-label="Προηγούμενη ημέρα" disabled={activeDayIndex<=0} onClick={()=>changeDay(-1)}>‹</button><label><span>Ημερομηνία</span><select value={activeDay||""} onChange={e=>setSelectedDay(e.target.value)}>{days.map(d=><option value={d} key={d}>{greekDate.format(new Date(`${d}T12:00:00+03:00`))}</option>)}</select></label><button aria-label="Επόμενη ημέρα" disabled={activeDayIndex<0||activeDayIndex>=days.length-1} onClick={()=>changeDay(1)}>›</button></div>
      <label className="calendar-filter"><span>Φίλτρα</span><select value={service} onChange={e=>setService(e.target.value)}>{services.map(s=><option key={s}>{s}</option>)}</select></label>
      <button className="new-booking" onClick={()=>document.getElementById("calendar-member")?.focus()}>＋ {owner?"Νέο ραντεβού":"Νέα κράτηση"}</button>
      <button className="refresh-calendar" onClick={()=>void refresh()} disabled={pending!==null}>↻</button>
    </div>
    {!ready&&<p>Φόρτωση προγράμματος…</p>}
    {error&&<p className="booking-error" role="alert">{error}</p>}
    {ready&&<>
      {owner&&<div className="calendar-member-picker"><label htmlFor="calendar-member">Κράτηση για μέλος</label><select id="calendar-member" value={memberId} onChange={e=>setMemberId(e.target.value)}><option value="">Επίλεξε μέλος</option>{members.map(m=><option value={m.id} key={m.id}>{m.full_name||m.id}</option>)}</select></div>}
      {shown.length?<div className="calendar-scroll"><div className="calendar-board" style={{"--service-count":visibleServices.length} as CSSProperties}>
        <div className="calendar-head time-head">Ώρα</div>{visibleServices.map(name=>{const serviceSlots=shown.filter(s=>s.service===name),reserved=serviceSlots.reduce((sum,s)=>sum+Number(s.reserved),0),capacity=serviceSlots.reduce((sum,s)=>sum+s.capacity,0);return <div className="calendar-head" key={name}><strong>{name}</strong><small>{reserved}/{capacity}</small></div>})}
        {rowTimes.flatMap(time=>{const slotAtTime=shown.find(s=>s.starts_at===time),start=greekTime.format(new Date(time)),end=slotAtTime?greekTime.format(new Date(slotAtTime.ends_at)):"";return [<div className="calendar-time" key={`time-${time}`}>{settings.showEndTime&&end?`${start}–${end}`:start}</div>,...visibleServices.map(name=>{const slot=shown.find(s=>s.starts_at===time&&s.service===name);if(!slot)return <div className="calendar-empty" key={`${time}-${name}`}/>;const reserved=bookings.filter(b=>b.slot_id===slot.id),free=slot.capacity-Number(slot.reserved),target=owner?memberId:userId,existing=reserved.find(b=>b.member_id===target);const state=!slot.enabled?"closed":free<=0?"full":free<=Math.max(1,Math.floor(slot.capacity/3))?"limited":"available";return <article className={`calendar-slot ${state} ${settings.colorPerService===false?"single-color":""}`} key={slot.id}><header><strong>{slot.service}</strong><span>♟ {slot.reserved}/{slot.capacity}</span></header>{owner&&<ol>{reserved.map(b=><li key={b.id}>{members.find(m=>m.id===b.member_id)?.full_name||"Μέλος"}</li>)}</ol>}{settings.showAvailableSpots!==false&&<div className="slot-status">{!slot.enabled?"Κλειστή ώρα":free>0?`+${free} ${free===1?"θέση":"θέσεις"} διαθέσιμες`:"Πλήρες"}</div>}<div className="slot-actions">{existing?<button className="cancel-booking" disabled={pending!==null} onClick={()=>void action(slot.id,existing.id)}>Ακύρωση</button>:<button disabled={!slot.enabled||free<=0||pending!==null||(owner&&!memberId)||settings.pauseBookings} onClick={()=>void action(slot.id)}>{settings.pauseBookings?"Παύση":pending===slot.id?"…":"Κράτηση"}</button>}{owner&&<button className="slot-toggle" disabled={pending!==null} onClick={()=>void toggle(slot)}>{slot.enabled?"Κλείσιμο":"Άνοιγμα"}</button>}</div></article>})]})}
      </div></div>:<p>Δεν υπάρχουν ώρες για την επιλεγμένη ημέρα και υπηρεσία.</p>}
      {!owner&&myBookings.length>0&&<p className="booking-footnote">Έχεις {myBookings.length} ενεργές κρατήσεις. Μπορείς να τις ακυρώσεις από την αντίστοιχη ημέρα.</p>}
    </>}
  </div>;
}
