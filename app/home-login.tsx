"use client";
import {FormEvent,useState} from "react";
import {useRouter} from "next/navigation";
import {api} from "../lib/supabase-rest";
import {saveSession} from "../lib/session";

export default function HomeLogin({label,className=""}:{label:string;className?:string}){
  const router=useRouter();
  const [open,setOpen]=useState(false),[email,setEmail]=useState(""),[password,setPassword]=useState("");
  const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[resetMode,setResetMode]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setMessage("");try{
    if(resetMode){const response=await api("/auth/v1/recover",undefined,{method:"POST",body:JSON.stringify({email:email.trim()})});setMessage(response.ok?"Σου στείλαμε email επαναφοράς κωδικού.":"Δεν ήταν δυνατή η αποστολή του email.");return}
    const response=await api("/auth/v1/token?grant_type=password",undefined,{method:"POST",body:JSON.stringify({email:email.trim(),password})});
    const data=await response.json();if(!response.ok){setMessage(response.status===400?"Λάθος email ή κωδικός.":"Δεν ήταν δυνατή η σύνδεση.");return}
    saveSession(data);router.push("/dashboard");
  }catch{setMessage("Δεν ήταν δυνατή η σύνδεση. Δοκίμασε ξανά.")}finally{setBusy(false)}}
  return <><button className={`home-login-trigger ${className}`} onClick={()=>setOpen(true)}>{label}</button>{open&&<div className="login-overlay" role="dialog" aria-modal="true" aria-label="Σύνδεση μέλους" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><form className="home-login-card" onSubmit={submit}><button className="modal-close" type="button" aria-label="Κλείσιμο" onClick={()=>setOpen(false)}>×</button><span className="kicker">ΑΣΦΑΛΗΣ ΠΡΟΣΒΑΣΗ</span><h2>{resetMode?"Νέος κωδικός":"Σύνδεση μέλους"}</h2><p>{resetMode?"Γράψε το email σου για σύνδεσμο επαναφοράς.":"Χρησιμοποίησε τα στοιχεία που σου έδωσε το Basement."}</p><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label>{!resetMode&&<label>Κωδικός<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} autoComplete="current-password"/></label>}{message&&<div className={message.startsWith("Σου στείλαμε")?"form-success":"form-error"} role="status">{message}</div>}<button className="modal-submit" disabled={busy}>{busy?"Παρακαλώ περίμενε…":resetMode?"Αποστολή email":"Σύνδεση"}</button><button className="modal-reset" type="button" onClick={()=>{setResetMode(x=>!x);setMessage("")}}>{resetMode?"Επιστροφή στη σύνδεση":"Ξέχασα τον κωδικό μου"}</button></form></div>}</>;
}
