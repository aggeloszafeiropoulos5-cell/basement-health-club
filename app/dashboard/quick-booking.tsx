"use client";
import {useEffect,useRef,useState} from "react";

type Candidate={id:string;name:string;contact:string;summary:string;unavailable:boolean};
export default function QuickBooking({title,members,busy,error,onBook,onClose,onBatch}:{title:string;members:Candidate[];busy:boolean;error:string;onBook:(id:string)=>Promise<boolean>;onClose:()=>void;onBatch?:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false);
  const [query,setQuery]=useState("");
  const normalize=(text:string)=>text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("el");
  const matches=members.filter(member=>normalize(`${member.name} ${member.contact}`).includes(normalize(query.trim())));
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close()},[]);
  async function choose(id:string){if(lock.current||busy)return;lock.current=true;try{if(await onBook(id))onClose()}finally{lock.current=false}}
  return <dialog ref={dialog} className="quick-booking-dialog" aria-labelledby="quick-booking-title" onCancel={event=>{event.preventDefault();if(!busy)onClose()}}>
    <header><h2 id="quick-booking-title">Επίλεξε μέλος</h2><button type="button" aria-label="Κλείσιμο αναζήτησης" disabled={busy} onClick={onClose}>×</button></header>
    {onBatch&&<button type="button" disabled={busy} onClick={onBatch}>Πολλά μέλη / εβδομαδιαία επανάληψη</button>}
    <p>{title}</p><label htmlFor="quick-booking-search">Όνομα, τηλέφωνο ή email</label>
    <input autoFocus id="quick-booking-search" type="search" autoComplete="off" placeholder="Αναζήτηση μέλους…" value={query} onChange={event=>setQuery(event.target.value)}/>
    <p>Πάτησε το μέλος για καταχώριση στη συγκεκριμένη ώρα.</p>
    {error&&<p role="alert" className="booking-error">{error}</p>}
    {busy&&<p role="status">Καταχώριση…</p>}
    <div className="quick-booking-results">{matches.map(member=><button type="button" key={member.id} disabled={busy||member.unavailable} onClick={()=>void choose(member.id)}><strong>{member.name}</strong><span>{member.contact}</span><span>{member.summary}</span>{member.unavailable&&<em>Έχει ήδη κράτηση ή αναμονή</em>}</button>)}{!matches.length&&<p>Δεν βρέθηκε μέλος.</p>}</div>
  </dialog>;
}
