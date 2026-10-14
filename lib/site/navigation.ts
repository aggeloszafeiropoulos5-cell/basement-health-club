import type {SiteDocument,Button} from './model';
import {safeUrl} from './model';
const officialFacebook='https://www.facebook.com/Basementhealthclub/';
const officialInstagram='https://www.instagram.com/basement_health_club/';
export function socialUrl(platform:string,value:string){
 const v=value.trim();if(!v)return '';
 if(/^https:\/\//i.test(v))return safeUrl(v);
 const handle=v.replace(/^@/,'');
 if(platform==='instagram'&&/^[a-z\d._]+$/i.test(handle))return 'https://www.instagram.com/'+handle.toLowerCase()+'/';
 if(platform==='facebook'&&v.toUpperCase()==='BASEMENT HEALTH CLUB')return officialFacebook;
 if(platform==='facebook'&&/^[a-z\d.]+$/i.test(handle))return 'https://www.facebook.com/'+handle+'/';
 return '';
}
const labels:Record<string,string>={'ems-training':'EMS','cross-training':'Cross','personal-training':'Personal','vacu-power':'Vacu Power','ems-sculpting':'EMS Sculpting','boxing-kick-boxing':'Boxing','ultratech-ems':'UltraTech EMS','diatrofi':'Διατροφή','vibrosauna':'Vibrosauna'};
export function upgradeNavigation(d:SiteDocument){
 if(d.navigationVersion===60)return d;
 d.social.facebook=socialUrl('facebook',d.social.facebook||'')||officialFacebook;
 d.social.instagram=socialUrl('instagram',d.social.instagram||'')||officialInstagram;
 const serviceLinks=d.services.filter(s=>s.visible!==false).map(s=>{const p=d.pages.find(p=>p.serviceId===s.id&&p.visible);return p?{id:'nav-service-'+s.id,label:labels[s.slug||'']||s.title,url:'/'+p.slug}:null;}).filter((b):b is Button=>!!b);
 serviceLinks.sort((a,b)=>{const rank=(b:Button)=>b.url.endsWith('/ems-training')?0:b.url.endsWith('/cross-training')?1:2;return rank(a)-rank(b)});
 const extra=d.navigation.filter(b=>!['nav-services-59','nav-reviews-59','nav-trial-59'].includes(b.id)&&b.url!=='/'&&!serviceLinks.some(s=>s.url===b.url));
 d.navigation=[{id:'nav-home-60',label:'Αρχική',url:'/'},...serviceLinks,...extra,{id:'nav-contact-60',label:'Επικοινωνία',url:'/#contact'}];
 d.navigationVersion=60;return d;
}

export function upgradeBookingLinks(d:SiteDocument){
 if(d.bookingVersion===61)return d;
 d.bookup.label='Κλείσε ραντεβού';
 if(d.leadCapture)d.leadCapture.stickyLabel='Κλείσε ραντεβού';
 d.bookingVersion=61;return d;
}
