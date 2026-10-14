"use client";
import {useEffect,useState} from "react";
import {api} from "../lib/supabase-rest";

type PublicSettings={businessName:string;businessEmail:string;businessPhone:string;guestBooking:boolean};
const fallback:PublicSettings={businessName:"BASEMENT HEALTH CLUB",businessEmail:"",businessPhone:"698 338 9353",guestBooking:false};

export default function PublicSiteDynamic({contact}:{contact?:{name:string;phone:string;email:string;address:string;maps:string}}={}){
 const [settings,setSettings]=useState<PublicSettings>(fallback);
 useEffect(()=>{void api("/rest/v1/rpc/basement_public_site_settings").then(async r=>{if(r.ok)setSettings({...fallback,...await r.json()})}).catch(()=>{})},[]);
 const displaySettings=contact?{...settings,businessName:contact.name,businessPhone:contact.phone,businessEmail:contact.email}:settings;
 const tel=(displaySettings.businessPhone||"").replace(/[^+0-9]/g,"");
 return <>
  <section className="contact-section"><div><span className="kicker">ΒΡΕΣ ΜΑΣ</span><h2>{displaySettings.businessName||"Basement Health Club"}</h2><p>{contact?.address||"Ι. Ξενίδη 5, Πετρούπολη 132 31"}</p>{displaySettings.businessPhone&&<p><a href={`tel:${tel}`}>{displaySettings.businessPhone}</a></p>}{displaySettings.businessEmail&&<p><a href={`mailto:${displaySettings.businessEmail}`}>{displaySettings.businessEmail}</a></p>}</div><div className="contact-links"><a target="_blank" rel="noreferrer" href={contact?.maps||"https://www.google.com/maps/search/?api=1&query=THE%20BASEMENT%20HEALTH%20CLUB%20Petroupoli"}>Google Maps</a></div></section>
 </>;
}
