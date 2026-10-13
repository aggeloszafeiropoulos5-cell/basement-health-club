import SiteRenderer from './site-renderer';
import {publishedSite} from '../lib/site/public';
export const dynamic='force-dynamic';
export async function generateMetadata(){const d=await publishedSite();const p=d.pages.find(p=>p.slug==='')!;return {title:p.seo.title,description:p.seo.description,openGraph:{title:p.seo.title,description:p.seo.description,images:p.seo.image?[p.seo.image]:[]}}}
export default async function Home(){const d=await publishedSite();return <SiteRenderer document={d} page={d.pages.find(p=>p.slug==='')!}/>}
