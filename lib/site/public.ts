import 'server-only';
import seed from './seed.json';
import {SUPABASE_URL,SUPABASE_ANON_KEY} from '../supabase-rest';
import type {SiteDocument} from './model';
export async function publishedSite():Promise<SiteDocument>{try{const r=await fetch(`${SUPABASE_URL}/rest/v1/site_publications?select=document&id=eq.1`,{headers:{apikey:SUPABASE_ANON_KEY},cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();return (d[0]?.document||seed) as SiteDocument}catch{return seed as SiteDocument}}
