"use client";
import {useEffect,useState} from "react";
import {api} from "../../lib/supabase-rest";
type Row={id:string|number;member_id:string;starts_at:string;service:string;members:{full_name:string}|null};
export default function UpcomingAppointments({onOpenMember}:{onOpenMember:(id:string)=>void}){
 const [rows,setRows]=useState<Row[]>([]);
 useEffect(()=>{let active=true;const token=localStorage.getItem("basement_access_token")||"",after=encodeURIComponent(new Date().toISOString());void Promise.all([
  api(`/rest/v1/bookup_bookings?select=id,member_id,starts_at,service,members(full_name)&source_status=eq.CONFIRMED&starts_at=gte.${after}&order=starts_at.asc&limit=25`,token),
  api(`/rest/v1/member_appointments?select=id,member_id,starts_at,service,members(full_name)&status=eq.booked&starts_at=gte.${after}&order=starts_at.asc&limit=25`,token)
 ]).then(async([a,b])=>{if(!a.ok||!b.ok)return;const first:Row[]=await a.json(),second:Row[]=await b.json();if(active)setRows([...first,...second].sort((x,y)=>x.starts_at.localeCompare(y.starts_at)).slice(0,25))}).catch(()=>{});return()=>{active=false}},[]);
 return <article className="member-appointments"><h2>Upcoming Appointments</h2>{rows.length?rows.map(row=><div className="detail-line" key={`${row.member_id}-${row.id}`}><span><b>{row.service}</b><small>{new Date(row.starts_at).toLocaleString("el-GR",{timeZone:"Europe/Athens",dateStyle:"medium",timeStyle:"short"})}</small></span><button onClick={()=>onOpenMember(row.member_id)}>{row.members?.full_name||"Μέλος"} ↗</button></div>):<p>Δεν υπάρχουν προγραμματισμένα ραντεβού.</p>}</article>
}
