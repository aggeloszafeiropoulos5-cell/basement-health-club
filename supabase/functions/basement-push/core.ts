export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
export type Config = { publicKey: string; privateKey: string; cronSecret: string; projectUrl: string };
type Dependencies = {
  projectUrl: string;
  user(token: string): Promise<{ id: string } | null>;
  db(path: string, init?: RequestInit): Promise<any>;
  generateKeys(): { publicKey: string; privateKey: string };
  send(subscription: Subscription, payload: unknown, config: Config, ttl: number): Promise<number>;
  selfTest?(config: Config): void;
};
const origins = new Set(['https://basementhealthclub.gr','https://www.basementhealthclub.gr','http://localhost:3101','http://localhost:3000']);
export function validEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash && (
      u.hostname === 'fcm.googleapis.com' || u.hostname === 'web.push.apple.com' ||
      u.hostname === 'updates.push.services.mozilla.com' ||
      /^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(u.hostname) ||
      /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname)
    );
  } catch { return false; }
}
export function validSubscription(value: any): value is Subscription {
  if (!validEndpoint(value?.endpoint) || !/^[A-Za-z0-9_-]{87}$/.test(value?.keys?.p256dh || '') || !/^[A-Za-z0-9_-]{22}$/.test(value?.keys?.auth || '')) return false;
  try { return atob(value.keys.p256dh.replace(/-/g,'+').replace(/_/g,'/')+'=')[0].charCodeAt(0) === 4; } catch { return false; }
}
async function constantEqual(a: string,b: string) {
  const hash = async (s:string) => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [x,y] = await Promise.all([hash(a),hash(b)]); let result=0;
  for(let i=0;i<x.length;i++) result|=x[i]^y[i];
  return result===0;
}
export function createHandler(deps: Dependencies) {
  const rpc = (name: string,body: unknown = {}) => deps.db(`/rpc/${name}`,{method:'POST',body:JSON.stringify(body)});
  async function config(initialize = false): Promise<Config|null> {
    let cfg = await rpc('basement_push_config');
    if ((!cfg || !cfg.publicKey) && initialize) cfg = await rpc('basement_push_config',{p_initial:{...deps.generateKeys(),projectUrl:deps.projectUrl}});
    return cfg;
  }
  async function dispatch(cfg: Config) {
    const jobs = await rpc('basement_push_claim',{p_limit:40});
    let sent=0,failed=0,skipped=0;
    // Bounded concurrency keeps the scheduler below its 60s HTTP timeout.
    for(let offset=0;offset<jobs.length;offset+=8) await Promise.all(jobs.slice(offset,offset+8).map(async (job:any)=>{
      const path=`/basement_push_deliveries?id=eq.${job.id}&lease=eq.${job.lease}`;
      if (!await rpc('basement_push_still_due',{p_id:job.id,p_lease:job.lease})) {
        await deps.db(path,{method:'PATCH',body:JSON.stringify({status:'skipped'})}); skipped++; return;
      }
      let status=0;
      try {
        if (!validSubscription(job)) status=400;
        else status=await deps.send(job,job.payload,cfg,Math.max(1,Math.min(3600,Math.floor((new Date(job.expires_at).getTime()-Date.now())/1000))));
      } catch { status=0; }
      const ok=status>=200&&status<300, gone=status===404||status===410;
      if(gone) await deps.db(`/basement_push_devices?id=eq.${job.device_id}`,{method:'PATCH',body:JSON.stringify({enabled:false})});
      await deps.db(path,{method:'PATCH',body:JSON.stringify({
        status:ok?'sent':gone||status===400||job.attempts>=5?'failed':'retry',
        sent_at:ok?new Date().toISOString():null,error_code:status||null,
        retry_at:new Date(Date.now()+Math.min(60,Math.pow(2,job.attempts)*5)*60000).toISOString(),
      })});
      if(ok)sent++;else failed++;
    }));
    return {sent,failed,skipped};
  }
  return async (req:Request):Promise<Response> => {
    const origin=req.headers.get('origin');
    const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
    if(origin && origins.has(origin)) Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'});
    const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if(origin&&!origins.has(origin))return reply({error:'Origin not allowed'},403);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return reply({error:'Method not allowed'},405);
    try {
      if(Number(req.headers.get('content-length')||0)>16384)return reply({error:'Request too large'},413);
      const raw=await req.text(); if(raw.length>16384)return reply({error:'Request too large'},413);
      let body:any;try{body=JSON.parse(raw)}catch{return reply({error:'Invalid JSON'},400)}
      if(!body || typeof body!=='object')return reply({error:'Invalid request'},400);
      if(body.action==='dispatch'||body.action==='verify') {
        const secret=req.headers.get('x-basement-cron');
        if(!secret)return reply({error:'Unauthorized'},401);
        const cfg=await config();
        if(!cfg||!await constantEqual(secret,cfg.cronSecret))return reply({error:'Unauthorized'},401);
        const ready=cfg.publicKey?cfg:await config(true);
        if(!ready)throw new Error('Configuration unavailable');
        if(body.action==='verify'){deps.selfTest?.(ready);return reply({encryption_ready:true});}
        return reply(await dispatch(ready));
      }
      const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
      if(!token)return reply({error:'Απαιτείται σύνδεση.'},401);
      const user=await deps.user(token);
      if(!user)return reply({error:'Η σύνδεση έληξε.'},401);
      if(!['status','subscribe','unsubscribe','test'].includes(body.action))return reply({error:'Invalid action'},400);
      if(body.action==='unsubscribe') {
        if(!validEndpoint(body.endpoint))return reply({error:'Invalid endpoint'},400);
        await deps.db(`/basement_push_devices?user_id=eq.${user.id}&endpoint=eq.${encodeURIComponent(body.endpoint)}`,{method:'PATCH',body:JSON.stringify({enabled:false})});
        return reply({ok:true});
      }
      const profiles=await deps.db(`/profiles?id=eq.${user.id}&select=active`);
      if(!profiles[0]?.active)return reply({error:'Ο λογαριασμός δεν είναι ενεργός.'},403);
      const cfg=await config(true);if(!cfg)throw new Error('Configuration unavailable');
      if(body.action==='status') {
        const rows=validEndpoint(body.endpoint)?await deps.db(`/basement_push_devices?user_id=eq.${user.id}&endpoint=eq.${encodeURIComponent(body.endpoint)}&select=enabled,training,subscriptions,payments`):[];
        return reply({publicKey:cfg.publicKey,device:rows[0]||null});
      }
      if(body.action==='subscribe') {
        if(!validSubscription(body.subscription))return reply({error:'Δεν αναγνωρίστηκε η συσκευή ειδοποιήσεων.'},400);
        if(!['training','subscriptions','payments'].every(key=>typeof body.preferences?.[key]==='boolean'))return reply({error:'Επίλεξε τις προτιμήσεις ειδοποιήσεων.'},400);
        try {
          const device=await rpc('basement_push_subscribe',{p_user:user.id,p_endpoint:body.subscription.endpoint,p_keys:body.subscription.keys,p_preferences:body.preferences});
          return reply({device});
        } catch { return reply({error:'Δεν αποθηκεύτηκε η συσκευή. Απενεργοποίησε τις ειδοποιήσεις από τις άδειες του browser και ενεργοποίησέ τις ξανά. Επιτρέπονται έως 10 συσκευές.'},409); }
      }
      if(!validEndpoint(body.endpoint))return reply({error:'Invalid endpoint'},400);
      const device=await rpc('basement_push_test_claim',{p_user:user.id,p_endpoint:body.endpoint});
      if(!device)return reply({error:'Ενεργοποίησε τις ειδοποιήσεις ή περίμενε ένα λεπτό πριν την επόμενη δοκιμή.'},429);
      const status=await deps.send(device,{title:'Basement Health Club',body:'Οι ειδοποιήσεις σου λειτουργούν. Καλή προπόνηση!',tag:'basement-test',url:'/dashboard?tab=notifications'},cfg,120);
      if(status<200||status>=300)return reply({error:'Η υπηρεσία ειδοποιήσεων δεν δέχτηκε τη δοκιμή. Απενεργοποίησε και ενεργοποίησε ξανά τις ειδοποιήσεις.'},502);
      return reply({ok:true});
    } catch {
      // Never log or return endpoints, credentials, JWTs or database error details.
      return reply({error:'Η υπηρεσία ειδοποιήσεων δεν είναι διαθέσιμη προσωρινά. Δοκίμασε ξανά.'},503);
    }
  };
}
