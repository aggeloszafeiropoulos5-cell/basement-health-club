const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');const vm=require('node:vm');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,file);
const {createHandler,validEndpoint,validSubscription}=require('../supabase/functions/basement-push/core.ts');
const user='00000000-0000-0000-0000-000000000001';
const subscription={endpoint:'https://web.push.apple.com/test',keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}};
const config={publicKey:'public',privateKey:'never-return-this',cronSecret:'cron-only-secret',projectUrl:'https://example.supabase.co'};
const req=(body,headers={})=>new Request('https://example.supabase.co/functions/v1/basement-push',{method:'POST',headers:{authorization:'Bearer good',origin:'https://www.basementhealthclub.gr',...headers},body:JSON.stringify(body)});
function make(overrides={}){const calls=[],sends=[];return {calls,sends,handle:createHandler({projectUrl:config.projectUrl,generateKeys:()=>{throw Error('should retain existing keys')},user:async token=>token==='good'?{id:user}:null,db:async(path,init)=>{calls.push([path,init]);if(path.includes('config'))return config;if(path.startsWith('/profiles'))return [{active:true}];return []},send:async(...args)=>{sends.push(args);return 201},...overrides})}}
test('push endpoint allowlist prevents SSRF and malformed device keys',()=>{
 for(const url of ['http://web.push.apple.com/test','https://127.0.0.1/a','https://web.push.apple.com.evil.test/a','https://user:pass@web.push.apple.com/a','https://web.push.apple.com:8443/a','https://evil.test/?https://web.push.apple.com'])assert.equal(validEndpoint(url),false,url);
 assert.equal(validSubscription(subscription),true);assert.equal(validSubscription({...subscription,keys:{...subscription.keys,p256dh:'oops'}}),false);
});
test('status validates auth and returns only public config and own-device preferences',async()=>{
 const {handle,calls}=make();assert.equal((await handle(req({action:'status'},{authorization:'Bearer bad'}))).status,401);assert.equal(calls.length,0);
 const response=await handle(req({action:'status',endpoint:subscription.endpoint}));assert.equal(response.status,200);
 const text=await response.text();assert.doesNotMatch(text,/never-return|cron-only/);assert.match(calls.at(-1)[0],new RegExp('user_id=eq.'+user));
});
test('malicious origin and scheduler calls cannot send notifications',async()=>{
 const {handle,sends}=make();assert.equal((await handle(req({action:'subscribe'},{origin:'https://evil.test'}))).status,403);
 assert.equal((await handle(req({action:'dispatch'}))).status,401);assert.equal((await handle(req({action:'dispatch'},{'x-basement-cron':'wrong'}))).status,401);assert.equal(sends.length,0);
});
test('subscription and test ignore caller supplied user id',async()=>{
 const seen=[];const {handle}=make({db:async(path,init)=>{if(path.includes('config'))return config;if(path.startsWith('/profiles'))return [{active:true}];const body=JSON.parse(init.body);seen.push(body);if(path.includes('test_claim'))return subscription;return {enabled:true}}});
 assert.equal((await handle(req({action:'subscribe',user_id:'victim',subscription,preferences:{training:true,subscriptions:true,payments:false}}))).status,200);
 assert.equal((await handle(req({action:'test',user_id:'victim',endpoint:subscription.endpoint}))).status,200);
 assert.deepEqual(seen.map(x=>x.p_user),[user,user]);
});
test('dispatch rechecks changes, retries transient errors, retires expired devices and records accepted pushes',async()=>{
 const patches=[],sends=[];
 const jobs=[0,1,2,3].map(i=>({id:String(i),lease:'lease-'+i,device_id:'device-'+i,attempts:1,...subscription,payload:{title:'Reminder'},expires_at:new Date(Date.now()+60000).toISOString()}));
 const {handle}=make({db:async(path,init)=>{if(path.includes('config'))return config;if(path.includes('push_claim'))return jobs;if(path.includes('still_due'))return JSON.parse(init.body).p_id!=='0';patches.push([path,JSON.parse(init.body)]);return null},send:async(job)=>{sends.push(job.id);return {'1':201,'2':410,'3':503}[job.id]}});
 const response=await handle(req({action:'dispatch'},{'x-basement-cron':config.cronSecret}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{sent:1,failed:2,skipped:1});assert.equal(sends.includes('0'),false);
 assert.equal(patches.find(([p])=>p.includes('devices'))[1].enabled,false);
 assert.equal(patches.find(([p])=>p.includes('id=eq.3'))[1].status,'retry');
 assert.ok(patches.every(([p])=>p.includes('devices')||p.includes('&lease=eq.')));
});
test('service worker always displays a visible notification and only navigates within dashboard',async()=>{
 const listeners={},shown=[];let opened;
 const self={location:{origin:'https://www.basementhealthclub.gr'},addEventListener:(name,fn)=>listeners[name]=fn,registration:{showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[],openWindow:async url=>{opened=url}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/sw.js'),'utf8'),{self,URL,fetch(){throw Error('should not fetch')},caches:{}});
 let pending;listeners.push({data:{json:()=>({title:'Training',url:'https://evil.test'})},waitUntil:p=>{pending=p}});await pending;assert.equal(shown[0][1].data.url,'/dashboard');
 listeners.notificationclick({notification:{data:{url:'/dashboard?tab=calendar'},close(){}},waitUntil:p=>{pending=p}});await pending;assert.equal(opened,'https://www.basementhealthclub.gr/dashboard?tab=calendar');
 listeners.fetch({request:{mode:'cors',url:'https://www.basementhealthclub.gr/api/private',method:'GET'},respondWith(){throw Error('must not intercept API')}});
});
