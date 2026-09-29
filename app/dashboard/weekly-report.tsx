"use client";
import {useEffect,useMemo,useState} from "react";
import {api} from "../../lib/supabase-rest";
import {addDays,athensDate,weekStart,weeklySummary,type WeeklyBooking} from "../../lib/weekly-report";

const dateLabel=(day:string)=>new Intl.DateTimeFormat("el-GR",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${day}T12:00:00Z`));
export default function WeeklyReport(){
  const [start,setStart]=useState(()=>weekStart(athensDate(new Date())));
  const [records,setRecords]=useState<WeeklyBooking[]>([]),[services,setServices]=useState<string[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(""),[revision,setRevision]=useState(0),[loadedStart,setLoadedStart]=useState("");
  useEffect(()=>{
    const abort=new AbortController();setLoading(true);setError("");
    void(async()=>{try{
      const token=localStorage.getItem("basement_access_token")||"";
      // A padded UTC interval includes both Athens DST offsets. The aggregator
      // then applies the exact Monday-to-Sunday dates in Europe/Athens.
      const from=addDays(start,-1)+"T00:00:00Z",until=addDays(start,8)+"T00:00:00Z";
      const base=`/rest/v1/basement_bookings?select=id,member_id,status,slot:basement_slots!basement_bookings_slot_id_fkey!inner(service,starts_at)&slot.starts_at=gte.${encodeURIComponent(from)}&slot.starts_at=lt.${encodeURIComponent(until)}&order=id.asc`;
      const all:WeeklyBooking[]=[];
      for(let offset=0;;offset+=500){
        const response=await api(`${base}&limit=500&offset=${offset}`,token,{signal:abort.signal});
        if(!response.ok)throw new Error("Δεν φορτώθηκαν οι εβδομαδιαίες κρατήσεις. Πάτησε Ανανέωση.");
        const page:WeeklyBooking[]=await response.json();all.push(...page);if(page.length<500)break;
      }
      const response=await api("/rest/v1/services?select=name&order=name",token,{signal:abort.signal});
      if(!response.ok)throw new Error("Δεν φορτώθηκε η λίστα υπηρεσιών. Πάτησε Ανανέωση.");
      const names:{name:string}[]=await response.json();
      if(!abort.signal.aborted){setRecords(all);setServices(names.map(s=>s.name));setLoadedStart(start)}
    }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:"Δεν φορτώθηκε η αναφορά.")}
    finally{if(!abort.signal.aborted)setLoading(false)}})();
    return()=>abort.abort();
  },[start,revision]);
  const summary=useMemo(()=>weeklySummary(records,start,services),[records,start,services]);
  const available=!loading&&!error&&loadedStart===start;
  return <section className="weekly-report"><header><h2>Εβδομαδιαία ανά υπηρεσία</h2><p>Δευτέρα–Κυριακή · ώρα Ελλάδας</p></header>
    <div className="weekly-navigation"><button aria-label="Προηγούμενη εβδομάδα" onClick={()=>setStart(addDays(start,-7))}>‹</button><label>Εβδομάδα που περιέχει<input type="date" value={start} onChange={e=>{if(e.target.value)setStart(weekStart(e.target.value))}}/></label><button aria-label="Επόμενη εβδομάδα" onClick={()=>setStart(addDays(start,7))}>›</button><button onClick={()=>setStart(weekStart(athensDate(new Date())))}>Αυτή η εβδομάδα</button><button disabled={loading} onClick={()=>setRevision(n=>n+1)}>Ανανέωση</button></div>
    <h3>{dateLabel(start)} – {dateLabel(addDays(start,6))}</h3>
    <p>Άτομα = κάθε μέλος μία φορά ανά υπηρεσία. Κρατήσεις = ενεργές και ολοκληρωμένες. Παρόντες = διαφορετικά μέλη με check-in. Τα no-show και οι ακυρώσεις εμφανίζονται χωριστά.</p>
    {loading&&<p role="status">Φόρτωση εβδομάδας…</p>}{error&&<p className="booking-error" role="alert">{error}</p>}
    {available&&<><div className="weekly-totals"><article><small>Μοναδικά άτομα συνολικά</small><strong>{summary.total.people}</strong></article><article><small>Κρατήσεις εβδομάδας</small><strong>{summary.total.bookings}</strong></article><article><small>Μοναδικοί παρόντες</small><strong>{summary.total.attendees}</strong></article><article><small>Συνολικά check-in</small><strong>{summary.total.checkins}</strong></article></div>
    <div className="weekly-table-scroll" tabIndex={0} role="region" aria-label="Στατιστικά ανά υπηρεσία"><table><thead><tr><th scope="col">Υπηρεσία</th><th scope="col">Άτομα</th><th scope="col">Κρατήσεις</th><th scope="col">Παρόντες</th><th scope="col">Check-in</th><th scope="col">Ενεργές</th><th scope="col">No-show</th><th scope="col">Ακυρώσεις</th></tr></thead><tbody>{summary.services.map(row=><tr key={row.service}><th scope="row">{row.service}</th><td>{row.people}</td><td>{row.bookings}</td><td>{row.attendees}</td><td>{row.checkins}</td><td>{row.active}</td><td>{row.noShow}</td><td>{row.cancelled}</td></tr>)}</tbody></table></div>
    {!summary.services.length&&<p>Δεν υπάρχουν ακόμη υπηρεσίες ή κρατήσεις.</p>}<p>Το συνολικό πλήθος ατόμων μετρά κάθε μέλος μία φορά, ακόμη κι αν κάνει και EMS και Cross. Οι παρουσίες βασίζονται στα καταχωρισμένα check-in, μαζί με όσα ολοκληρώθηκαν αυτόματα.</p></>}
  </section>;
}
