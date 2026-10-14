const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,name)=>mod._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,name);require.extensions['.css']=()=>{};
const {upgradeSiteDesign}=require('../lib/site/design.ts'),{leadPayload}=require('../lib/site/lead-request.ts');const seed=()=>JSON.parse(fs.readFileSync('lib/site/seed.json'));
test('Conversion migration preserves owner changes and adds complete public routes once',()=>{
 const d=upgradeSiteDesign(seed());assert.equal(d.conversionVersion,59);assert.equal(d.pages[0].sections.filter(s=>s.type==='lead').length,0);assert.equal(d.pages[0].sections.filter(s=>s.type==='offers').length,1);
 for(const p of d.pages.filter(p=>p.serviceId)){assert.ok(!p.sections.some(s=>s.type==='lead'));assert.equal(p.sections[0].items.length,3);}
 d.pages[0].sections.find(s=>s.type==='hero').media[0].url='/owner.mp4';d.pages[0].sections.find(s=>s.type==='offers').hidden=true;d.leadCapture.stickyLabel='Μίλα μαζί μας';d.pages[1].sections=[];assert.deepEqual(upgradeSiteDesign(d),d);
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),Renderer=require('../app/site-renderer.tsx').default;
 let html=renderToStaticMarkup(React.createElement(Renderer,{document:d,page:d.pages[1]}));assert.match(html,/<h1[^>]*>Cross Training<\/h1>/);assert.ok(html.includes('href="'+d.bookup.url.replaceAll('&','&amp;')+'"'));assert.doesNotMatch(html,/Κλείσε δοκιμαστικό/);assert.ok(!html.slice(0,html.indexOf('</header>')).includes('site-social-button'));
 html=renderToStaticMarkup(React.createElement(Renderer,{document:d,page:d.pages[0]}));assert.doesNotMatch(html,/site-mobile-trial/);assert.match(html,/<summary>Κλείσε ραντεβού<\/summary>/);assert.ok(html.includes(d.bookup.ios));assert.ok(html.includes(d.bookup.android.replaceAll("&","&amp;")));assert.match(html,/href="#contact"[^>]*>Επικοινωνία/);assert.doesNotMatch(html,/Δεν υπάρχουν ενεργές προσφορές/);assert.match(html,/Πηγή αξιολόγησης/);assert.match(html,/<summary>Τα προγράμματα<\/summary>/);assert.doesNotMatch(html,/Το πρώτο βήμα ξεκινά εδώ/);assert.doesNotMatch(html,/<form/);
});
test('Only valid services and active offers enter the CRM payload; source context is bounded',()=>{
 const d=upgradeSiteDesign(seed());d.offers=[{id:'offer1',title:'Πακέτο EMS',price:'68€',enabled:true,home:true}];
 const payload=leadPayload({name:' Test ',phone:'+30 6900000000',consent:true,service:'ems-training',offer:'offer1',page:'/services/ems-training',preferred:'απόγευμα',utm_campaign:'trial'},d);
 assert.equal(payload.p_name,'Test');assert.equal(payload.p_service,'EMS Training');assert.match(payload.p_preferred,/Προσφορά: Πακέτο EMS/);assert.match(payload.p_preferred,/utm_campaign: trial/);
 d.offers[0].enabled=false;assert.doesNotMatch(leadPayload({name:'Test',phone:'6900000000',consent:true,offer:'offer1'},d).p_preferred,/Προσφορά/);
 for(const bad of [{phone:'abc'}, {phone:'123'}, {consent:false},{service:'hidden-service'}])assert.throws(()=>leadPayload({name:'Test',phone:'6900000000',consent:true,...bad},d));
 assert.throws(()=>leadPayload({name:'T',phone:'6900000000',consent:true},d));
});
test('Lead API reports success only after CRM accepts; rejects invalid, foreign-origin and disabled submissions',async()=>{
 let d=upgradeSiteDesign(seed()),calls=[];d.leadCapture.enabled=true;const full=path.resolve('lib/site/public.ts'),mock=new Module(full);mock.exports={publishedSite:async()=>d};require.cache[full]=mock;const {POST}=require('../app/api/site-lead/route.ts');const before=global.fetch;
 global.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return new Response('"test-id"',{status:200})};
 const request=body=>new Request('https://www.basementhealthclub.gr/api/site-lead',{method:'POST',headers:{origin:'https://www.basementhealthclub.gr','Content-Type':'application/json'},body:JSON.stringify(body)}),valid={name:'Test',phone:'6900000000',consent:true,service:'ems-training'};
 try{
  let r=await POST(request(valid));assert.equal(r.status,200);assert.equal((await r.json()).ok,true);assert.equal(calls.length,1);assert.equal(calls[0].p_service,'EMS Training');
  r=await POST(request({...valid,phone:'bad'}));assert.equal(r.status,400);assert.equal(calls.length,1);
  r=await POST(request({...valid,website:'bot'}));assert.equal(r.status,200);assert.equal(calls.length,1);
  r=await POST(new Request('https://www.basementhealthclub.gr/api/site-lead',{method:'POST',headers:{origin:'https://other.example'},body:JSON.stringify(valid)}));assert.equal(r.status,403);
  global.fetch=async()=>new Response('{}',{status:500});r=await POST(request(valid));assert.equal(r.status,503);assert.notEqual((await r.json()).ok,true);
  d.leadCapture.enabled=false;r=await POST(request(valid));assert.equal(r.status,503);
 }finally{global.fetch=before;delete require.cache[full];}
});
test('Public form carries service and offer context, keeps details on error, then confirms accepted request; preview never sends',async()=>{
 const {JSDOM}=await import('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://www.basementhealthclub.gr/?service=ems-training&offer=offer1&utm_source=instagram#trial'});
 for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,location:dom.window.location,IS_REACT_ACT_ENVIRONMENT:true}))global[k]=v;Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true});
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),Form=require('../app/site-lead-form.tsx').default;const root=createRoot(document.getElementById('root')),d=upgradeSiteDesign(seed());d.leadCapture.enabled=true;d.offers=[{id:'offer1',title:'Test offer',price:'68€',enabled:true}];const previousFetch=global.fetch,previousFormData=global.FormData;global.FormData=dom.window.FormData;let submissions=[],accept=false;
 global.fetch=async(url,init)=>{submissions.push(JSON.parse(init.body));return Response.json(accept?{ok:true}:{message:'Προσωρινό σφάλμα'},{status:accept?200:503})};
 try{
  await act(async()=>root.render(React.createElement(Form,{document:d})));assert.equal(document.querySelector('select').value,'ems-training');
  document.querySelector('[name="name"]').value='Test person';document.querySelector('[name="phone"]').value='6900000000';document.querySelector('[name="consent"]').checked=true;
  const send=()=>act(async()=>{document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,10))});
  await send();assert.match(document.querySelector('[role="alert"]').textContent,/Προσωρινό/);assert.equal(document.querySelector('[name="phone"]').value,'6900000000');assert.equal(submissions[0].offer,'offer1');assert.equal(submissions[0].utm_source,'instagram');
  accept=true;await send();assert.match(document.querySelector('[role="status"]').textContent,/Λάβαμε/);
  await act(async()=>document.querySelector('button').click());await act(async()=>root.render(React.createElement(Form,{document:d,preview:true})));const count=submissions.length;await send();assert.equal(submissions.length,count);
 }finally{await act(async()=>root.unmount());dom.window.close();global.fetch=previousFetch;global.FormData=previousFormData;}
});
