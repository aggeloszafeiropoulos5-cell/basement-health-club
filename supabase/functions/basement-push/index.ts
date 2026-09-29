import webpush from 'npm:web-push@3.6.7';
import { createHandler, validEndpoint } from './core.ts';
const projectUrl=Deno.env.get('SUPABASE_URL')!;
const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const serverKey=secretKeys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const adminHeaders={apikey:serverKey,...(serverKey.startsWith('eyJ')?{Authorization:`Bearer ${serverKey}`}:{}) ,'Content-Type':'application/json'};
Deno.serve(createHandler({
  projectUrl,
  generateKeys:()=>webpush.generateVAPIDKeys(),
  selfTest(config) {
    const deviceKeys=webpush.generateVAPIDKeys();
    const auth=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const details=webpush.generateRequestDetails({endpoint:'https://web.push.apple.com/verification-only',keys:{p256dh:deviceKeys.publicKey,auth}},'Verification only; never transmitted',{
      vapidDetails:{subject:'https://www.basementhealthclub.gr',publicKey:config.publicKey,privateKey:config.privateKey},TTL:60,contentEncoding:'aes128gcm',
    });
    if(!details.body?.length||!details.headers.Authorization)throw new Error('Encryption self-test failed');
  },
  async user(token) {
    const response=await fetch(`${projectUrl}/auth/v1/user`,{headers:{apikey:serverKey,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
    if(response.status===401||response.status===403)return null;
    if(!response.ok)throw new Error('Auth unavailable');
    return response.json();
  },
  async db(path,init={}) {
    const response=await fetch(`${projectUrl}/rest/v1${path}`,{...init,headers:{...adminHeaders,...init.headers},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Database unavailable');
    const text=await response.text();return text?JSON.parse(text):null;
  },
  async send(subscription,payload,config,ttl) {
    if(!validEndpoint(subscription.endpoint))return 400;
    const details=webpush.generateRequestDetails(subscription,JSON.stringify(payload),{
      vapidDetails:{subject:'https://www.basementhealthclub.gr',publicKey:config.publicKey,privateKey:config.privateKey},
      TTL:ttl,urgency:'normal',contentEncoding:'aes128gcm',
    });
    const response=await fetch(details.endpoint,{method:'POST',headers:details.headers,body:details.body,redirect:'error',signal:AbortSignal.timeout(7000)});
    await response.body?.cancel();return response.status;
  },
}));
