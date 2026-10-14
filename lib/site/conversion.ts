import type {SiteDocument, Section} from './model';

export const defaultLeadCapture = {
 enabled: true, stickyEnabled: true, stickyLabel: 'Κλείσε δοκιμαστικό',
 title: 'Το πρώτο βήμα ξεκινά εδώ.',
 body: 'Πες μας ποια υπηρεσία σε ενδιαφέρει. Θα σε καλέσουμε για να συζητήσουμε τον στόχο σου και να βρούμε ημέρα και ώρα.',
 submitLabel: 'Ζήτησε δοκιμαστικό',
 successMessage: 'Το αίτημά σου καταχωρίστηκε. Θα σε καλέσουμε για να επιβεβαιώσουμε ημέρα και ώρα.'
};
const base = (id:string,type:string,title:string,eyebrow:string):Section => ({id,type,title,eyebrow,body:'',accent:'',hidden:false,media:[],buttons:[],items:[],style:{background:'',color:'',align:'left',padding:0,fontSize:0,columns:0,maxWidth:0}});
const audience:Record<string,string>={
 'cross-training':'Για εσένα που θέλεις ποικιλία, δύναμη και αντοχή, με το κίνητρο μιας μικρής ομάδας.',
 'ems-training':'Για εσένα που θέλεις να γνωρίσεις την προπόνηση EMS με εξατομικευμένη ένταση και επίβλεψη.',
 'personal-training':'Για εσένα που θέλεις προσωπικό πλάνο και καθοδήγηση με βάση το δικό σου επίπεδο και στόχο.',
 'vacu-power':'Για εσένα που προτιμάς το περπάτημα και θέλεις μια οργανωμένη εμπειρία cardio σε ειδικό εξοπλισμό.',
 'ems-sculpting':'Για εσένα που θέλεις να ενημερωθείς για τη στοχευμένη μυϊκή ενεργοποίηση με τεχνολογία HIFEM.'
};
/** One-time additions. Owner changes, hidden sections and replacement videos survive. */
export function upgradeConversion(d:SiteDocument):SiteDocument {
 if(d.conversionVersion===59)return d;
 d.leadCapture ??= {...defaultLeadCapture};
 const home=d.pages.find(p=>p.slug==='');
 if(home){
  if(!home.sections.some(s=>s.type==='offers')){
   const offers=base('offers','offers','Περισσότερο κίνητρο για την αρχή σου.','ΟΙ ΠΡΟΣΦΟΡΕΣ ΜΑΣ');
   offers.body='Δες τα διαθέσιμα πακέτα και ζήτησε να σε ενημερώσουμε.';
   const index=home.sections.findIndex(s=>s.type==='reviews');home.sections.splice(index<0?home.sections.length:index,0,offers);
  }
  if(!home.sections.some(s=>s.type==='lead')){
   const lead=base('trial','lead','Το πρώτο βήμα ξεκινά εδώ.','ΓΝΩΡΙΣΕ ΤΟ BASEMENT');
   const index=home.sections.findIndex(s=>s.type==='bookup'||s.type==='contact');home.sections.splice(index<0?home.sections.length:index,0,lead);
  }
  const faq=home.sections.find(s=>s.type==='faq');
  if(faq&&!faq.items.some(i=>i.id==='faq-trial-59'))faq.items.push({id:'faq-trial-59',title:'Το αίτημα δοκιμαστικού κλείνει αυτόματα ραντεβού;',body:'Όχι. Μας στέλνεις το ενδιαφέρον σου και επικοινωνούμε μαζί σου για να επιβεβαιώσουμε ημέρα, ώρα και τις πληροφορίες της υπηρεσίας.'});
  if(!d.navigation.length)d.navigation=[{id:'nav-services-59',label:'Υπηρεσίες',url:'/#services'},{id:'nav-reviews-59',label:'Αξιολογήσεις',url:'/#reviews'},{id:'nav-trial-59',label:'Δοκιμαστικό',url:'/#trial'}];
 }
 for(const p of d.pages.filter(p=>p.serviceId)){
  const service=d.services.find(s=>s.id===p.serviceId);if(!service)continue;
  if(!p.sections.some(s=>s.id===p.id+'-details-59')){
   const details=base(p.id+'-details-59','text','Μια εμπειρία με τον δικό σου στόχο.','ΓΝΩΡΙΣΕ ΤΗΝ ΥΠΗΡΕΣΙΑ');
   details.items=[{id:p.id+'-audience',title:'Σε ποιον ταιριάζει',body:audience[service.slug||'']||'Για εσένα που θέλεις να γνωρίσεις τη συγκεκριμένη υπηρεσία και να συζητήσεις με την ομάδα μας πώς εντάσσεται στον στόχο σου.'},{id:p.id+'-includes',title:'Τι περιλαμβάνει',body:(service.bullets||[]).join(' · ')},{id:p.id+'-first',title:'Στην πρώτη σου επίσκεψη',body:'Συζητάμε τον στόχο και την εμπειρία σου, γνωρίζεις τον εξοπλισμό και ενημερώνεσαι για τη διαδικασία και τα διαθέσιμα πακέτα.'}];
   p.sections.unshift(details);
  }
  if(!p.sections.some(s=>s.type==='lead'))p.sections.push(base(p.id+'-trial','lead','Ζήτησε πληροφορίες για '+service.title,'ΤΟ ΕΠΟΜΕΝΟ ΒΗΜΑ'));
 }
 // Existing template summaries are replaced with short, attributable excerpts.
 const excerpts=[['review-0','Πολύ καθαρός χώρος, φιλικό και καταρτισμένο προσωπικό.','Ειναι πολυ καθαρός ο χώρος','Vassiliki Z.'],['review-1','Φιλικό περιβάλλον και σωστή δουλειά στα EMS groups.','Πολύ φιλικό περιβάλλον','Maria L.'],['review-2','Οι γυμναστές δείχνουν ενδιαφέρον, δίνουν σωστές οδηγίες και σε κάνουν να νιώθεις άνετα.','Οι γυμναστές δείχνουν ενδιαφέρον, δίνουν σωστές οδηγίες','Φρύνη']];
 for(const p of d.pages)for(const s of p.sections.filter(s=>s.type==='reviews')){
  if(s.accent==='5.0')s.accent='';
  for(const [id,old,body,title] of excerpts){const item=s.items.find(i=>i.id===id&&i.body===old);if(item)Object.assign(item,{body,title,tag:'Απόσπασμα αξιολόγησης Google',rating:5,sourceUrl:'https://www.top-rated.online/cities/%CE%A0%CE%B5%CF%84%CF%81%CE%BF%CF%8D%CF%80%CE%BF%CE%BB%CE%B7/place/p/7326951/BASEMENT%2BHEALTH%2BCLUB'});}
 }
 d.conversionVersion=59;return d;
}
