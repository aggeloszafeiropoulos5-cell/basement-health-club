import type {SiteDocument} from './model';
import {offerActive} from './model';
export function leadPayload(input:unknown,d:SiteDocument){
 if(!input||typeof input!=='object')throw Error('Συμπλήρωσε τα στοιχεία σου.');
 const f=input as Record<string,unknown>;
 const field=(key:string,max:number)=>typeof f[key]==='string'?(f[key] as string).trim().slice(0,max):'';
 const name=field('name',120),phone=field('phone',60),digits=phone.replace(/\D/g,'');
 if(name.length<2)throw Error('Συμπλήρωσε το όνομά σου.');
 if(!/^[+\d\s().-]+$/.test(phone)||digits.length<8||digits.length>15)throw Error('Συμπλήρωσε έγκυρο τηλέφωνο.');
 if(f.consent!==true)throw Error('Επιβεβαίωσε ότι θέλεις να επικοινωνήσουμε μαζί σου.');
 const slug=field('service',100),service=d.services.find(s=>s.slug===slug&&s.visible!==false);
 if(slug&&!service)throw Error('Επίλεξε μία διαθέσιμη υπηρεσία.');
 const offer=d.offers.find(o=>o.id===field('offer',100)&&offerActive(o));
 const page=field('page',180);const validPage=d.pages.find(p=>p.visible&&('/'+p.slug===page));
 const context=[field('preferred',250),validPage?'Σελίδα: /'+validPage.slug:'',offer?'Προσφορά: '+offer.title:''];
 for(const k of ['utm_source','utm_medium','utm_campaign']){const v=field(k,100);if(v)context.push(k+': '+v.replace(/[\r\n]/g,' '));}
 return {p_name:name,p_phone:phone,p_email:'',p_service:service?.title||'',p_preferred:context.filter(Boolean).join(' · ').slice(0,1000)};
}
