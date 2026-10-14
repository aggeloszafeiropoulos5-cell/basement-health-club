import {publishedSite} from '../../../lib/site/public';
import {leadPayload} from '../../../lib/site/lead-request';
import {SUPABASE_URL,SUPABASE_ANON_KEY} from '../../../lib/supabase-rest';
export async function POST(request:Request){
 const reply=(body:object,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 const origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin)return reply({message:'Άνοιξε τη φόρμα μέσα από το site.'},403);
 if(Number(request.headers.get('content-length')||0)>8000)return reply({message:'Το αίτημα είναι πολύ μεγάλο.'},413);
 let input:Record<string,unknown>;
 try{const raw=await request.text();if(new TextEncoder().encode(raw).length>8000)return reply({message:'Το αίτημα είναι πολύ μεγάλο.'},413);input=JSON.parse(raw);}catch{return reply({message:'Δεν διαβάστηκαν τα στοιχεία.'},400);}
 if(!input||typeof input!=='object'||Array.isArray(input))return reply({message:'Συμπλήρωσε τα στοιχεία σου.'},400);
 if(input.website)return reply({ok:true});
 const doc=await publishedSite();
 if(doc.leadCapture?.enabled===false)return reply({message:'Η φόρμα είναι προσωρινά κλειστή. Κάλεσέ μας για πληροφορίες.'},503);
 let payload;try{payload=leadPayload(input,doc);}catch(e){return reply({message:e instanceof Error?e.message:'Έλεγξε τα στοιχεία σου.'},400);}
 try{
  const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/basement_guest_request`,{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!r.ok)return reply({message:'Δεν ολοκληρώθηκε η αποστολή. Δοκίμασε ξανά ή κάλεσέ μας.'},503);
  return reply({ok:true});
 }catch{return reply({message:'Δεν ολοκληρώθηκε η αποστολή. Δοκίμασε ξανά ή κάλεσέ μας.'},503);}
}
