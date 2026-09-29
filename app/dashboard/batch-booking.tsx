"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {api} from "../../lib/supabase-rest";
import {addDays,athensDate,localTime} from "../../lib/weekly-report";
import {bookingPlan,submitBookingPlan,type PlanSlot,type PlanMember,type PlanRow,type PlanResult} from "../../lib/booking-plan";
const labels=["Κυρ","Δευ","Τρι","Τετ","Πεμ","Παρ","Σαβ"];
export default function BatchBooking({seed,slots,members,bookings,waiting,onClose,onRefresh}:{seed:PlanSlot;slots:PlanSlot[];members:PlanMember[];bookings:{slot_id:number;member_id:string;status:string}[];waiting:{slot_id:number;member_id:string}[];onClose:()=>void;onRefresh:()=>Promise<void>}){
  const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false);
  const start=athensDate(seed.starts_at);
  const [query,setQuery]=useState(""),[chosen,setChosen]=useState<string[]>([]),[repeat,setRepeat]=useState(false);
  const [end,setEnd]=useState(addDays(start,28)),[weekdays,setWeekdays]=useState([new Date(`${start}T12:00:00Z`).getUTCDay()]);
  const [preview,setPreview]=useState<PlanRow[]|null>(null),[results,setResults]=useState<Record<string,PlanResult>>({});
  const [busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false);
  useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close()},[]);
  useEffect(()=>{if(!busy)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=""};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard)},[busy]);
  const normalize=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("el");
  const matches=useMemo(()=>members.filter(m=>normalize(`${m.name} ${m.contact}`).includes(normalize(query.trim()))),[members,query]);
  const eligible=preview?.filter(row=>!row.issue)||[];
  function prepare(){setResults({});setPreview(bookingPlan({seed,slots,members:members.filter(m=>chosen.includes(m.id)),bookings,waiting,repeat,end,weekdays}))}
  async function submit(){
    if(lock.current||!preview||submitted||!eligible.length||eligible.length>100)return;
    lock.current=true;setBusy(true);setSubmitted(true);
    try{await submitBookingPlan(preview,async(slotId,memberId)=>{
      const response=await api("/rest/v1/rpc/basement_book",localStorage.getItem("basement_access_token")||"",{method:"POST",body:JSON.stringify({p_slot_id:slotId,p_member_id:memberId})});
      const data=await response.json().catch(()=>null);
      if(!response.ok)return {state:response.status>=500?"unknown":"failed",message:response.status>=500?"Αβέβαιο αποτέλεσμα — έλεγξε το ημερολόγιο":data?.message||"Δεν καταχωρίστηκε"};
      if(typeof data!=="number"||data===0)return {state:"unknown",message:"Αβέβαιο αποτέλεσμα — έλεγξε το ημερολόγιο"};
      return {state:data<0?"waiting":"booked",message:data<0?"Στη λίστα αναμονής":"Καταχωρίστηκε"};
    },(row,result)=>setResults(current=>({...current,[row.key]:result})));await onRefresh()}
    finally{setBusy(false);lock.current=false}
  }
  return <dialog ref={dialog} className="quick-booking-dialog batch-booking-dialog" aria-labelledby="batch-title" onCancel={e=>{e.preventDefault();if(!busy)onClose()}}><header><h2 id="batch-title">Μαζικές / σταθερές κρατήσεις</h2><button disabled={busy} onClick={onClose} aria-label="Κλείσιμο">×</button></header><p><b>{seed.service}</b> · {start} · {localTime(seed.starts_at)}</p>
    {!preview?<><label htmlFor="batch-search">Αναζήτηση μελών<input autoFocus id="batch-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Όνομα, τηλέφωνο ή email"/></label><p>{chosen.length} επιλεγμένα μέλη</p><div className="batch-member-list">{matches.map(m=><label key={m.id}><input type="checkbox" checked={chosen.includes(m.id)} onChange={e=>setChosen(ids=>e.target.checked?[...ids,m.id]:ids.filter(id=>id!==m.id))}/><span><b>{m.name}</b><small>{m.contact}</small></span></label>)}{!matches.length&&<p>Δεν βρέθηκε μέλος.</p>}</div>
      <label className="batch-repeat"><input type="checkbox" checked={repeat} onChange={e=>setRepeat(e.target.checked)}/> Επανάληψη κάθε εβδομάδα</label>
      {repeat&&<><fieldset><legend>Ημέρες στην ίδια ώρα</legend><div className="batch-weekdays">{[1,2,3,4,5,6,0].map(day=><label key={day}><input type="checkbox" checked={weekdays.includes(day)} onChange={e=>setWeekdays(days=>e.target.checked?[...days,day]:days.filter(d=>d!==day))}/>{labels[day]}</label>)}</div></fieldset><label>Έως<input type="date" value={end} min={start} max={addDays(start,365)} onChange={e=>setEnd(e.target.value)}/></label><p>Δημιουργεί συγκεκριμένες κρατήσεις στο διαθέσιμο πρόγραμμα, μέχρι την ημερομηνία που ορίζεις και μόνο μέσα στη διάρκεια του ενεργού πακέτου κάθε μέλους. Οι ώρες εκτός του φορτωμένου προγράμματος θα επισημανθούν.</p></>}
      <button disabled={!chosen.length||(repeat&&(!weekdays.length||!end||end<start||end>addDays(start,365)))} onClick={prepare}>Προεπισκόπηση</button></>:<>
      <p>{eligible.length} προς καταχώριση · {preview.length-eligible.length} παραλείπονται</p><p>Οι εγγραφές καταχωρίζονται χωριστά. Οι επιτυχείς παραμένουν ακόμη κι αν κάποια άλλη απορριφθεί. Η βάση ελέγχει ξανά τους κανόνες και μπορεί να βάλει μια κράτηση σε αναμονή, αν αυτό προβλέπεται στις ρυθμίσεις.</p>
      <div className="batch-preview">{preview.map(row=><article key={row.key}><b>{row.day} · {row.memberName}</b><span>{row.issue||results[row.key]?.message||(submitted&&!busy?"Δεν επιχειρήθηκε":"Έτοιμη για καταχώριση")}</span></article>)}</div>
      {busy&&<p role="status">Καταχώριση… Κράτησε ανοιχτό το παράθυρο.</p>}{submitted&&!busy&&<p role="status">Ολοκληρώθηκε ο έλεγχος: {Object.values(results).filter(r=>r.state==="booked").length} κρατήσεις · {Object.values(results).filter(r=>r.state==="waiting").length} σε αναμονή. Δες το αποτέλεσμα κάθε γραμμής.</p>}
      {eligible.length>100&&<p role="alert">Επίλεξε μικρότερο διάστημα ή λιγότερα μέλη, έως 100 κρατήσεις ανά καταχώριση.</p>}
      {!submitted&&<div className="batch-buttons"><button onClick={()=>setPreview(null)}>Αλλαγή επιλογών</button><button disabled={!eligible.length||eligible.length>100||busy} onClick={()=>void submit()}>Καταχώριση {eligible.length} κρατήσεων</button></div>}
    </>}
  </dialog>;
}
