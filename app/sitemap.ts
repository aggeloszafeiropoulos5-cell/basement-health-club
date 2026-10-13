import {publishedSite} from '../lib/site/public';
export default async function sitemap(){const d=await publishedSite();return d.pages.filter(p=>p.visible).map(p=>({url:'https://www.basementhealthclub.gr/'+p.slug,lastModified:new Date()}))}
