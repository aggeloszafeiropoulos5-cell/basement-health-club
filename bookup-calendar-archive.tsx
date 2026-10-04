"use client";
import {useEffect,useState} from "react";
import {api} from "../../lib/supabase-rest";
import {shiftDay} from "../../lib/reference-calendar";
export type ArchiveRow={id:string|number;member_id:string;starts_at:string;ends_at:string;service:string;source_status?:string;status?:string;members:{full_name:string}|null;external_booking_id?:string};
const athens=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit",day:"2-digit"});
const dayOf=(iso:string)=>athens.format(new Date(iso));
const time=(iso:string)=>new Date(iso).toLocaleTimeString("el-GR",{timeZone:"Europe/Athens",hour:"2-digit",minute:"2-digit"});
export default function BookupCalendarArchive({day,onOpenMember,onRows}:{day:string;onOpenMember?:(id:string)=>void;onRows?:(day:string,rows:ArchiveRow[],loaded:boolean)=>void}){
 const [rows,setRows]=useState<ArchiveRow[]>([]),[error,setError]=useState("");
 useEffect(()=>{let active=true;const token=localStorage.getItem("basement_access_token")||"";const range=`starts_at=gte.${encodeURIComponent(shiftDay(day,-1)+"T00:00:00Z")}&starts_at=lt.${encodeURIComponent(shiftDay(day,2)+"T00:00:00Z")}`;
  void Promise.all([api(`/rest/v1/bookup_bookings?select=id,member_id,starts_at,ends_at,service,source_status,external_booking_id,members(full_name)&${range}&order=starts_at.asc&limit=1000`,token),api(`/rest/v1/member_appointments?select=id,member_id,starts_at,ends_at,service,status,members(full_name)&${range}&order=starts_at.asc&limit=1000`,token)]).then(async([a,b])=>{if(!a.ok||!b.ok)throw Error();const first:ArchiveRow[]=await a.json(),second:ArchiveRow[]=await b.json();if(active){const next=[...first,...second].filter(row=>dayOf(row.starts_at)===day).sort((x,y)=>x.starts_at.localeCompare(y.starts_at));setRows(next);onRows?.(day,next,true);setError("")}}).catch(()=>{if(active){onRows?.(day,[],false);setError("Δεν φορτώθηκε το ιστορικό BookUp.")}});return()=>{active=false}
 },[day,onRows]);
 return <section className="bookup-calendar-archive"><h3>Ραντεβού μελών · {day} <small>{rows.length}</small></h3>{error&&<p role="alert">{error}</p>}{rows.length>0?<div className="bookup-calendar-rows">{rows.map(row=><div key={`${row.external_booking_id||"manual"}-${row.id}`}><time>{time(row.starts_at)}–{time(row.ends_at)}</time><b>{row.service}</b><button onClick={()=>onOpenMember?.(row.member_id)}>{row.members?.full_name||"Μέλος"}</button><span>{row.source_status||row.status}</span></div>)}</div>:<p>Δεν υπάρχουν εισαγόμενα ραντεβού για αυτή την ημέρα.</p>}</section>
}
