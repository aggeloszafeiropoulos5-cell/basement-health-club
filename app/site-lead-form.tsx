"use client";
import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import type {SiteDocument} from '../lib/site/model';
import {safeUrl,offerActive} from '../lib/site/model';
import {defaultLeadCapture} from '../lib/site/conversion';
export default function SiteLeadForm({document:d,serviceSlug='',preview=false}:{document:SiteDocument;serviceSlug?:string;preview?:boolean}){
 const cfg=d.leadCapture||defaultLeadCapture;
 const [service,setService]=useState(serviceSlug),[offerId,setOfferId]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[success,setSuccess]=useState(false);
 const sending=useRef(false);
 const services=d.services.filter(s=>s.visible!==false),offer=d.offers.find(o=>o.id===offerId&&offerActive(o));
 useEffect(()=>{const q=new URLSearchParams(location.search),requested=q.get('service');if(requested&&d.services.some(s=>s.visible!==false&&s.slug===requested))setService(requested);const o=d.offers.find(o=>o.id===q.get('offer')&&offerActive(o));if(o){setOfferId(o.id);const s=d.services.find(s=>s.id===o.serviceId&&s.visible!==false);if(s)setService(s.slug||'');}},[d.services,d.offers]);
 if(!cfg.enabled)return null;
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(sending.current)return;
  if(preview){setMessage('Προεπισκόπηση: το αίτημα δεν αποστέλλεται στο CRM.');return;}
  const form=e.currentTarget,f=new FormData(form),q=new URLSearchParams(location.search);
  sending.current=true;setBusy(true);setMessage('');
  try{const r=await fetch('/api/site-lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.get('name'),phone:f.get('phone'),service,offer:offerId,preferred:f.get('preferred'),consent:f.get('consent')==='on',website:f.get('website'),page:location.pathname,utm_source:q.get('utm_source'),utm_medium:q.get('utm_medium'),utm_campaign:q.get('utm_campaign')})});const data=await r.json();if(!r.ok||!data.ok)throw Error(data.message||'Δεν ολοκληρώθηκε η αποστολή.');setSuccess(true);setMessage(cfg.successMessage);}
  catch(e){setMessage(e instanceof Error?e.message:'Δεν ολοκληρώθηκε η αποστολή.');}
  finally{sending.current=false;setBusy(false);}
 }
 return <div className="site-trial-layout"><div><span className="kicker">ΓΝΩΡΙΣΕ ΤΟ BASEMENT</span><h2>{cfg.title}</h2><p>{cfg.body}</p><ul><li>Επιλέγεις την υπηρεσία που σε ενδιαφέρει.</li><li>Μιλάμε για τον στόχο και τη διαθεσιμότητά σου.</li><li>Επιβεβαιώνουμε μαζί ημέρα και ώρα.</li></ul><a className="site-trial-phone" href={safeUrl('tel:'+d.contact.phone.replace(/[^+0-9]/g,''))}>Ή κάλεσέ μας: {d.contact.phone}</a></div>
 <div className="site-trial-card">{success?<div className="site-trial-success" role="status"><h3>Λάβαμε το ενδιαφέρον σου.</h3><p>{message}</p><button type="button" onClick={()=>{setSuccess(false);setMessage('')}}>Νέο αίτημα</button></div>:<form onSubmit={submit}><h3>{offer?offer.title:'Πες μας πώς να σε βρούμε'}</h3>{offer&&<p>Ενδιαφέρον για την προσφορά · {offer.price}</p>}<label>Όνομα<input name="name" autoComplete="name" minLength={2} maxLength={120} required/></label><label>Τηλέφωνο<input name="phone" type="tel" autoComplete="tel" inputMode="tel" minLength={8} maxLength={30} required/></label><label>Υπηρεσία<select name="service" value={service} onChange={e=>setService(e.target.value)}><option value="">Θέλω να με βοηθήσετε να επιλέξω</option>{services.map(s=><option key={s.id} value={s.slug}>{s.title}</option>)}</select></label><details><summary>Θέλεις να μας πεις πότε σε βολεύει;</summary><label>Προτίμηση ημέρας / ώρας<input name="preferred" maxLength={250} placeholder="π.χ. απογεύματα μετά τις 18:00"/></label></details><label className="site-trial-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off"/></label><label className="site-trial-consent"><input name="consent" type="checkbox" required/><span>Θέλω να επικοινωνήσει μαζί μου το Basement για το αίτημά μου.</span></label><p className="site-trial-note">Χρησιμοποιούμε τα στοιχεία σου για να απαντήσουμε στο αίτημά σου. Δεν δημιουργείται αυτόματα λογαριασμός ή κράτηση.</p><button className="primary-link" disabled={busy} type="submit">{busy?'Αποστολή…':cfg.submitLabel}</button>{message&&<p role="alert">{message} <a href={'tel:'+d.contact.phone.replace(/[^+0-9]/g,'')}>Κάλεσέ μας</a></p>}</form>}</div></div>;
}
