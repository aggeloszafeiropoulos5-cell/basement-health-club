"use client";
import {FormEvent,useState} from "react";
import {useRouter} from "next/navigation";
import Image from "next/image";
import {api} from "../../lib/supabase-rest";
import {saveSession} from "../../lib/session";

export default function Login(){const router=useRouter(),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
async function submit(e:FormEvent){e.preventDefault();setBusy(true);setMessage("");try{const r=await api("/auth/v1/token?grant_type=password",undefined,{method:"POST",body:JSON.stringify({email:email.trim(),password})});const data=await r.json();if(!r.ok){setMessage(r.status===400?"Λάθος email ή κωδικός.":"Δεν ήταν δυνατή η σύνδεση. Δοκίμασε ξανά σε λίγο.");return}saveSession(data);router.replace("/dashboard")}catch{setMessage("Δεν ήταν δυνατή η σύνδεση. Δοκίμασε ξανά.")}finally{setBusy(false)}}
return <main className="auth-page"><a className="auth-brand" href="/"><Image src="/basement-logo.jpeg" width={74} height={74} alt="Basement"/><span><b>BASEMENT</b><small>MEMBER PORTAL</small></span></a><form className="auth-card" onSubmit={submit}><span className="kicker">ΑΣΦΑΛΗΣ ΠΡΟΣΒΑΣΗ</span><h1>Σύνδεση</h1><p>Χρησιμοποίησε τα στοιχεία που σου έδωσε το Basement Health Club.</p><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label><label>Κωδικός<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} autoComplete="current-password"/></label>{message&&<div className="form-error">{message}</div>}<button disabled={busy}>{busy?"Σύνδεση…":"Σύνδεση"}</button><a href="/">← Επιστροφή στην αρχική</a></form></main>}
