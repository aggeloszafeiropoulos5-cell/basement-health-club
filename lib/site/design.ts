import type {SiteDocument,Section} from './model';

/** Editable defaults applied once; subsequent owner edits and removals take priority. */
export function upgradeSiteDesign(input:SiteDocument):SiteDocument {
 const d=structuredClone(input);
 if(d.designVersion===53)return d;
 const applyVideo=()=>{
  const hero=d.pages.find(p=>p.slug==='')?.sections.find(s=>s.type==='hero'||s.id==='hero');
  if(hero){hero.type='hero';hero.media=[{id:'basement-hero-video-53',url:'/videos/basement-hero.mp4',type:'video',alt:'Βίντεο Basement Health Club',position:'50% 50%',fit:'cover',autoplay:true,poster:'/images/basement-video-poster.webp'}];if(!d.media.some(m=>m.id==='basement-hero-video-53'))d.media.push(hero.media[0]);}
  d.designVersion=53;
 };
 if(d.designVersion===52){applyVideo();return d;}
 d.designVersion=52;
 d.theme.buttonRadius=32;
 const home=d.pages.find(p=>p.slug==='');
 if(!home)return d;
 const hero=home.sections.find(s=>s.type==='hero'||s.id==='hero');
 if(hero){
  hero.type='hero';
  if(hero.title==='Προπόνηση με'){hero.title='Ο στόχος σου.';hero.accent='Η δική μας καθοδήγηση.'}
  if(!hero.media.length||hero.media.every(m=>m.id==='logo'||m.url==='/basement-logo.jpeg'))hero.media=[{id:'basement-hero-52',url:'/images/basement-hero.webp',type:'image',alt:'Προσωπική καθοδήγηση στην προπόνηση — δημιουργική εικόνα Basement',position:'65% 50%',fit:'cover'}];
 }
 const base=(id:string,type:string,title:string,eyebrow:string):Section=>({id,type,title,eyebrow,body:'',accent:'',hidden:false,media:[],buttons:[],items:[],style:{background:'',color:'',align:'left',padding:0,fontSize:0,columns:0,maxWidth:0}});
 if(!home.sections.some(s=>s.type==='steps')){
  const s=base('start','steps','Κάθε αρχή, πιο απλή.','ΠΩΣ ΞΕΚΙΝΑΣ');
  s.items=[{id:'start-1',title:'Μιλάμε για τον στόχο σου.',body:'Μας λες τι θέλεις να πετύχεις και ποια προπόνηση σου αρέσει.'},{id:'start-2',title:'Βρίσκουμε αυτό που σου ταιριάζει.',body:'Η ομάδα μας σε βοηθά να επιλέξεις υπηρεσία και πρόγραμμα.'},{id:'start-3',title:'Κλείνεις το ραντεβού σου.',body:'Επιλέγεις ημέρα και ώρα μέσα από την πλατφόρμα κρατήσεων.'},{id:'start-4',title:'Ξεκινάμε μαζί.',body:'Προπονείσαι με καθοδήγηση, στον δικό σου ρυθμό.'}];
  home.sections.push(s);
 }
 if(!home.sections.some(s=>s.type==='faq')){
  const s=base('questions','faq','Οι ερωτήσεις σου.','ΠΡΙΝ ΞΕΚΙΝΗΣΕΙΣ');
  s.items=[{id:'faq-1',title:'Χρειάζεται να έχω εμπειρία;',body:'Όχι. Η προπόνηση προσαρμόζεται στο επίπεδό σου και η ομάδα μας σε καθοδηγεί από την αρχή.'},{id:'faq-2',title:'Ποια υπηρεσία να επιλέξω;',body:'Επικοινώνησε μαζί μας για να συζητήσουμε τον στόχο, τις προτιμήσεις και τη διαθεσιμότητά σου.'},{id:'faq-3',title:'Πώς κλείνω ραντεβού;',body:'Πάτησε «Κλείσε ραντεβού» για να ανοίξεις την πλατφόρμα Bookup. Για πρώτη επικοινωνία μπορείς να μας καλέσεις.'},{id:'faq-4',title:'Πού βρίσκεται το Basement;',body:d.contact.address},{id:'faq-5',title:'Πού μπορώ να δω τις τιμές;',body:'Κάθε ενεργή προσφορά εμφανίζεται στο site. Για τα διαθέσιμα πακέτα της υπηρεσίας σου, επικοινώνησε μαζί μας.'}];
  home.sections.push(s);
 }
 const tail=home.sections.filter(s=>s.type==='bookup'||s.type==='contact');
 home.sections=[...home.sections.filter(s=>s.type!=='bookup'&&s.type!=='contact'),...tail];
 if(!d.media.some(m=>m.id==='basement-hero-52')&&hero?.media[0]?.id==='basement-hero-52')d.media.push(hero.media[0]);
 applyVideo();
 return d;
}
