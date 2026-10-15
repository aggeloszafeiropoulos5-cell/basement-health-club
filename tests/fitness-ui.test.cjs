const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,name)=>mod._compile(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,name);require.extensions['.css']=()=>{};
test('Owner assigns program and Cross access; member records exercise and body progress; other service has no weights UI',async()=>{
 const {JSDOM}=await import('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://www.basementhealthclub.gr/dashboard?tab=training'});
 for(const [k,v]of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,localStorage:dom.window.localStorage,location:dom.window.location,IS_REACT_ACT_ENVIRONMENT:true}))global[k]=v;Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true});const originalFD=global.FormData;global.FormData=dom.window.FormData;
 const member={id:'member-a',auth_user_id:'user-a',full_name:'Test Member',active:true};let access=null,plans=[],logs=[],body=[];
 const modulePath=path.resolve('lib/supabase-rest.ts'),mock=new Module(modulePath);mock.exports={api:async(p,t,init={})=>{const table=p.slice('/rest/v1/'.length).split('?')[0],payload=init.body?JSON.parse(init.body):null;let result=[];
  if(table==='members')result=[member];
  if(table==='member_training_access'){if(payload)access=payload;result=access?[access]:[];}
  if(table==='member_workout_plans'){if(payload){const saved={...payload,id:'plan-a',revision:1,updated_at:new Date().toISOString()};plans=[saved];}result=plans;}
  if(table==='member_exercise_logs'){if(payload)logs=[{...payload,id:'log-a',exercise_name:plans[0].content.days[0].exercises[0].name,created_at:new Date().toISOString()}];result=logs;}
  if(table==='member_measurements'){if(payload)body=[{...payload,id:1,created_by:'user-a'}];result=body;}
  return Response.json(result);
 }};require.cache[modulePath]=mock;
 const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),Panel=require('../app/dashboard/fitness-panel.tsx').default;let root=createRoot(document.getElementById('root'));
 const wait=()=>new Promise(r=>setTimeout(r,20));
 async function mount(owner){await act(async()=>{root.render(React.createElement(Panel,{owner,userId:owner?'owner':'user-a'}));await wait()});}
 async function choose(el,value){await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));await wait()})}
 async function click(text){const b=[...document.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(b,'Missing '+text);await act(async()=>{b.click();await wait()})}
 async function send(form){await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait()})}
 try{
  await mount(true);await choose(document.querySelector('[aria-label="Μέλος προγράμματος"]'),'member-a');
  const type=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Είδος προπόνησης')).querySelector('select');await choose(type,'cross');await click('Αποθήκευση πρόσβασης');assert.equal(access.training_type,'cross');
  await click('＋ Νέο πρόγραμμα για το μέλος');const form=document.querySelector('form');form.querySelector('[name="title"]').value='Strength A';form.querySelector('[name="category"]').value='weights';form.querySelector('[name="status"]').value='published';const name=[...form.querySelectorAll('label')].find(l=>l.textContent==='Άσκηση').querySelector('input');await choose(name,'Squat');await send(form);assert.equal(plans[0].status,'published');assert.equal(plans[0].content.days[0].exercises[0].name,'Squat');
  await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await mount(false);assert.ok(document.body.textContent.includes('Strength A'));
  await click('Κιλά & επιδόσεις');let f=document.querySelector('form');f.querySelector('[name="weight_kg"]').value='25';f.querySelector('[name="reps"]').value='10';await send(f);assert.equal(logs[0].member_id,'member-a');assert.equal(logs[0].weight_kg,25);assert.ok(document.body.textContent.includes('25 kg × 10'));
  await click('Σωματικές μετρήσεις');f=document.querySelector('form');f.querySelector('[name="weight_kg"]').value='84';f.querySelector('[name="waist_cm"]').value='90';await send(f);assert.equal(body[0].weight_kg,84);assert.equal(body[0].waist_cm,90);assert.ok(document.body.textContent.includes('Βάρος (kg): 84'));
  await act(async()=>root.unmount());access.training_type='other';root=createRoot(document.getElementById('root'));await mount(false);assert.ok(![...document.querySelectorAll('.fitness-tabs button')].some(b=>b.textContent==='Κιλά & επιδόσεις'));
 }finally{await act(async()=>root.unmount());global.FormData=originalFD;dom.window.close();delete require.cache[modulePath];}
});
