import {notFound} from 'next/navigation';
import SiteRenderer from '../site-renderer';
import {publishedSite} from '../../lib/site/public';
export const dynamic='force-dynamic';
export async function generateMetadata({params}:{params:Promise<{slug:string[]}>}){const {slug}=await params;const d=await publishedSite();const p=d.pages.find(p=>p.slug===slug.join('/')&&p.visible);return p?{title:p.seo.title,description:p.seo.description,openGraph:{images:p.seo.image?[p.seo.image]:[]}}:{};}
export default async function ContentPage({params}:{params:Promise<{slug:string[]}>}){const {slug}=await params,d=await publishedSite();const p=d.pages.find(p=>p.slug===slug.join('/')&&p.visible);if(!p)notFound();return <SiteRenderer document={d} page={p}/>}
