"use client";
import {FormEvent,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import Image from "next/image";
import {api} from "../../lib/supabase-rest";

export default function Login(){const router=useRouter(),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
useEffect(()=>{if(localStorage.getItem("basement_access_token"))router.replace("/dashboard")},[router]);
async function submit(e:FormEvent){e.preventDefault();setBusy(true);setMessage("");const r=await api("/auth/v1/token?grant_type=password",undefined,{method:"POST",body:JSON.stringify({email,password})});const data=await r.json();setBusy(false);if(!r.ok){setMessage("Λάθος email ή κωδικός.");return}localStorage.setItem("basement_access_token",data.access_token);localStorage.setItem("basement_refresh_token",data.refresh_token);router.replace("/dashboard")}
return <main className="auth-page"><a className="auth-brand" href="/"><Image src="/basement-logo.jpeg" width={74} height={74} alt="Basement"/><span><b>BASEMENT</b><small>MEMBER PORTAL</small></span></a><form className="auth-card" onSubmit={submit}><span className="kicker">ΑΣΦΑΛΗΣ ΠΡΟΣΒΑΣΗ</span><h1>Σύνδεση</h1><p>Χρησιμοποίησε τα στοιχεία που σου έδωσε το Basement Health Club.</p><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label><label>Κωδικός<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} autoComplete="current-password"/></label>{message&&<div className="form-error">{message}</div>}<button disabled={busy}>{busy?"Σύνδεση…":"Σύνδεση"}</button><a href="/">← Επιστροφή στην αρχική</a></form></main>}
