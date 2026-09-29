const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {database,uid}=require('./helpers/credit-database.cjs');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260929213000_reference_control_center.sql'),'utf8');
test('reference settings, availability and access operate on real PostgreSQL',async t=>{
 const db=await database();
 await db.exec(`alter table auth.users add column email text;
 create schema cron;create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
 create table if not exists locations(id uuid primary key default gen_random_uuid(),name text not null,timezone text default 'Europe/Athens',address text,active boolean default true,created_at timestamptz default now());
 create table if not exists availability_rules(id uuid primary key default gen_random_uuid(),location_id uuid not null,service_id uuid not null references services(id),weekday int check(weekday between 1 and 7),start_time time not null,duration_minutes integer not null,valid_from date not null,valid_until date,active boolean default true,unique(location_id,service_id,weekday,start_time,valid_from));
 create table if not exists capacity_overrides(id uuid primary key default gen_random_uuid(),location_id uuid,service_id uuid,specific_date date,weekday int,start_time time,trainer_id uuid,capacity int,active boolean default true);
 create unique index test_slot_unique on basement_slots(service,starts_at);
 create table if not exists member_measurements(id bigint);
 insert into locations(id,name) values('${uid(501)}','Test location');
 alter table basement_slots alter column id restart with 100;
 `);
 await db.exec(migration);
 await db.exec('create trigger sync_service_slots after update on services for each row execute function basement_sync_service_slots()');
 const q=async(sql,params=[])=>{await db.exec('savepoint call');try{const result=(await db.query(sql,params)).rows;await db.exec('release savepoint call');return result}catch(e){await db.exec('rollback to savepoint call;release savepoint call');throw e}};
 const scenario=(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{await fn()}finally{await db.exec('rollback')}});
 const rule=()=>q(`select basement_save_availability(p_rule:=jsonb_build_object('service_id',$1::text,'weekdays',jsonb_build_array(extract(isodow from current_date+2)::int),'start_time','11:00','duration_minutes',40,'valid_from',current_date+2,'valid_until',current_date+9))`,[uid(201)]);
 const config={name:'Test club',subtitle:'TEST',step:20,defaultView:'week',colors:{primary:'#7138dc'},lowSessions:1,expiryDays:7,inactiveDays:30};
 const rules={openingTime:'08:00',closingTime:'22:00',bookingMinHours:0,bookingMaxDays:14,maxActiveBookings:8};
 try{
 await scenario('rule opens real slots; disabling preserves booked appointments and consumed credit',async()=>{
  await rule();const [slot]=await q('select id,source_rule_id from basement_slots where source_rule_id is not null order by starts_at limit 1');assert.ok(slot);
  const [booking]=await q('select basement_book($1,$2) id',[slot.id,uid(2)]);
  await q("select basement_save_availability(p_delete:=$1,p_delete_kind:='rule')",[slot.source_rule_id]);
  assert.equal((await q('select enabled from basement_slots where id=$1',[slot.id]))[0].enabled,false);
  assert.equal((await q('select count(*)::int n from basement_bookings where id=$1',[booking.id]))[0].n,1);
  assert.equal((await q('select sessions_remaining from member_packages where id=$1',[uid(401)]))[0].sessions_remaining,7);
 });
 await scenario('all settings save atomically; service rename retains history; shortened hours close old slots',async()=>{
  await rule();const services=(await q('select * from services')).map(s=>({...s,name:s.id===uid(201)?'EMS Plus':s.name}));
  await q('select basement_save_reference_settings($1,$2,$3)',[config,{...rules,closingTime:'10:00'},services]);
  assert.equal((await q('select name from services where id=$1',[uid(201)]))[0].name,'EMS Plus');
  assert.equal((await q('select service from basement_slots where id=1'))[0].service,'EMS Plus');
  assert.equal((await q('select count(*)::int n from basement_slots where source_rule_id is not null and enabled'))[0].n,0);
  const invalid=services.map((s,i)=>i?{...s,default_capacity:0}:s);
  await assert.rejects(q('select basement_save_reference_settings($1,$2,$3)',[{...config,name:'Should rollback'},rules,invalid]));
  assert.equal((await q('select basement_brand_config() c'))[0].c.name,'Test club');
 });
 await scenario('manual closure survives regeneration and closed days are unavailable to members',async()=>{
  await rule();const [s]=await q('select id from basement_slots where source_rule_id is not null order by starts_at limit 1');
  await q('update basement_slots set enabled=false,manually_closed=true where id=$1',[s.id]);await q('select basement_private.refresh_availability()');
  assert.equal((await q('select enabled from basement_slots where id=$1',[s.id]))[0].enabled,false);
  await q("select basement_save_availability(p_closure:=jsonb_build_object('closure_date',current_date+2,'closure_type','holiday','reason','Test'))");
  await q("select set_config('request.jwt.claim.sub',$1,true)",[uid(2)]);
  assert.equal((await q("select count(*)::int n from basement_availability() where (starts_at at time zone 'Europe/Athens')::date=current_date+2 and enabled"))[0].n,0);
 });
 await scenario('members cannot change settings, schedules, staff or export; branding exposes no member data',async()=>{
  await q("select set_config('request.jwt.claim.sub',$1,true)",[uid(2)]);
  for(const statement of ["select basement_save_availability()","select basement_staff_directory()","select basement_business_export()","select basement_open_slot('"+uid(201)+"',current_date+1,'10:00',40)"]){await assert.rejects(q(statement),/ιδιοκτήτη/)}
  assert.ok(!(await q('select basement_brand_config() c'))[0].c.members);
 });
 await scenario('maximum active bookings is enforced on the server',async()=>{
  await q(`update app_settings set value=value||'{"maxActiveBookings":1}' where key='control_center_settings'`);
  await q("select set_config('request.jwt.claim.sub',$1,true)",[uid(2)]);await q('select basement_book(1)');
  await assert.rejects(q('select basement_book(2)'),/όριο ενεργών/);
 });
 await scenario('explicit owner overbooking still charges a matching credit and denies customer calls',async()=>{
  await q('update basement_slots set capacity=1 where id=1');await q('select basement_book(1,$1)',[uid(2)]);
  await q('select basement_owner_overbook(1,$1)',[uid(3)]);
  assert.equal((await q('select count(*)::int n from basement_bookings where slot_id=1'))[0].n,2);
  assert.equal((await q('select sessions_remaining from member_packages where id=$1',[uid(402)]))[0].sessions_remaining,7);
  await q("select set_config('request.jwt.claim.sub',$1,true)",[uid(2)]);await assert.rejects(q('select basement_owner_overbook(2,$1)',[uid(3)]),/ιδιοκτήτη/);
 });
 await scenario('one-off slot is idempotent and follows the Athens date across DST',async()=>{
  const a=(await q("select basement_open_slot($1,current_date+60,'09:00',40) id",[uid(201)]))[0].id;
  const b=(await q("select basement_open_slot($1,current_date+60,'09:00',40) id",[uid(201)]))[0].id;assert.equal(a,b);
  assert.equal((await q("select (starts_at at time zone 'Europe/Athens')::time::text t from basement_slots where id=$1",[a]))[0].t,'09:00:00');
 });
 await scenario('capacity override applies to the calendar and disabling restores the service capacity',async()=>{
  await rule();await q("select basement_save_capacity(jsonb_build_object('service_id',$1::text,'capacity',2))",[uid(201)]);
  assert.equal((await q('select capacity from basement_slots where source_rule_id is not null limit 1'))[0].capacity,2);
  const [override]=await q('select * from capacity_overrides limit 1');await q('select basement_save_capacity($1)',[{...override,active:false}]);
  assert.equal((await q('select capacity from basement_slots where source_rule_id is not null limit 1'))[0].capacity,3);
 });
 await scenario('staff promotion is owner-only and self-lockout is rejected',async()=>{
  await q("update auth.users set email='owner@example.test' where id=$1",[uid(1)]);await q("update auth.users set email='trainer@example.test' where id=$1",[uid(4)]);
  await q("select basement_save_staff('trainer@example.test','Test trainer','trainer',true)");
  assert.equal((await q('select role::text role from profiles where id=$1',[uid(4)]))[0].role,'trainer');
  await assert.rejects(q("select basement_save_staff('owner@example.test','Owner','customer',true)"),/δική σου πρόσβαση/);
 });
 await scenario('migration can be rerun without losing data',async()=>{await db.exec(migration);assert.equal((await q('select count(*)::int n from members'))[0].n,3)});
 }finally{await db.close()}
});
