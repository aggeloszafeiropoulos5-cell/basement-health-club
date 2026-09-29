const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname,'..');
const migration = fs.readFileSync(path.join(root,'supabase/migrations/20260929083619_web_push_reminders.sql'),'utf8');
const user='00000000-0000-0000-0000-000000000001', other='00000000-0000-0000-0000-000000000002';
async function fixture(){
 const db=new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema vault;create schema net;create schema cron;
 create table auth.users(id uuid primary key);
 create table vault.decrypted_secrets(id uuid default gen_random_uuid(),name text, decrypted_secret text);
 create function vault.create_secret(s text,n text,d text default '') returns uuid language plpgsql as $$declare v uuid;begin insert into vault.decrypted_secrets(name,decrypted_secret)values(n,s)returning id into v;return v;end$$;
 create function vault.update_secret(i uuid,s text) returns void language sql as $$update vault.decrypted_secrets set decrypted_secret=s where id=i$$;
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as $$select 1::bigint$$;
 create function cron.schedule(n text,s text,c text) returns bigint language sql as $$select 1::bigint$$;
 create table test_clock(value timestamptz);insert into test_clock values('2026-09-29 08:00:00+00');
 create function public.test_now() returns timestamptz language sql stable as $$select value from public.test_clock$$;
 create table public.app_settings(key text primary key,value jsonb);
 create table public.profiles(id uuid primary key,active boolean default true);
 create table public.members(id uuid primary key,auth_user_id uuid,active boolean default true,debt numeric default 0);
 create table public.basement_slots(id bigint primary key,starts_at timestamptz,ends_at timestamptz,enabled boolean default true);
 create table public.basement_bookings(id bigint primary key,member_id uuid,slot_id bigint,status text);
 create table public.member_packages(id uuid primary key,member_id uuid,package_template_id uuid,starts_on date,expires_on date,status text,sessions_remaining integer,frozen_until date);
 insert into auth.users values('${user}'),('${other}');insert into profiles values('${user}',true),('${other}',true);
 insert into members(id,auth_user_id)values('${user}','${user}'),('${other}','${other}');
 insert into app_settings values('control_center_settings','{"oneReminderPerDay":false}');
 `);
 // Only infrastructure stubs and the clock are replaced; all candidate and claim SQL is real.
 await db.exec(migration.replace('create extension if not exists pg_net with schema extensions;','').replaceAll('now()','public.test_now()'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260929084817_push_active_member_guard.sql'),'utf8').replaceAll('now()','public.test_now()'));
 await db.query('insert into basement_push_devices(user_id,endpoint,keys)values($1,$2,$3)',[user,'https://web.push.apple.com/test','{}']);
 return db;
}
const claim=async db=>(await db.query('select public.basement_push_claim() as jobs')).rows[0].jobs;
test('push only claims upcoming active bookings, deduplicates, rechecks cancellations and preferences',async()=>{
 const db=await fixture();try{
 await db.exec(`insert into basement_slots values(1,test_now()+interval '2 hours',test_now()+interval '3 hours',true),(2,test_now()-interval '1 hour',test_now(),true),(3,test_now()+interval '2 hours',test_now()+interval '3 hours',false),(4,test_now()+interval '8 hours',test_now()+interval '9 hours',true);
 insert into basement_bookings values(1,'${user}',1,'booked'),(2,'${user}',2,'booked'),(3,'${user}',3,'booked'),(4,'${user}',4,'booked'),(5,'${other}',1,'booked'),(6,'${user}',1,'cancelled');`);
 let jobs=await claim(db);assert.equal(jobs.length,1);assert.match(jobs[0].event_key,/^training:1:/);
 assert.equal((await claim(db)).length,0,'parallel worker cannot claim leased delivery');
 const due=()=>db.query('select basement_push_still_due($1,$2) as due',[jobs[0].id,jobs[0].lease]);
 assert.equal((await due()).rows[0].due,true);
 await db.exec("update basement_bookings set status='cancelled' where id=1");assert.equal((await due()).rows[0].due,false);
 await db.exec("update basement_bookings set status='booked' where id=1;update basement_push_devices set training=false");assert.equal((await due()).rows[0].due,false);
 await db.exec("update basement_push_devices set training=true;update profiles set active=false");assert.equal((await due()).rows[0].due,false);
 await db.exec("update profiles set active=true;update members set active=false");assert.equal((await due()).rows[0].due,false);
 }finally{await db.close()}
});
test('expiry, credits and recorded debt reminders respect renewal, settings, quiet hours and payment clearing',async()=>{
 const db=await fixture();try{
 await db.exec(`insert into member_packages values('10000000-0000-0000-0000-000000000001','${user}','20000000-0000-0000-0000-000000000001','2026-09-01','2026-09-30','active',3,null),('10000000-0000-0000-0000-000000000002','${user}','20000000-0000-0000-0000-000000000002','2026-09-01','2026-10-20','active',1,null),('10000000-0000-0000-0000-000000000003','${user}','20000000-0000-0000-0000-000000000003','2026-09-01','2026-10-20','active',null,null);
 update members set debt=40 where id='${user}';`);
 let jobs=await claim(db);assert.equal(jobs.length,3);assert.deepEqual(new Set(jobs.map(j=>j.event_key.split(':')[0])),new Set(['expiry','credits','debt']));
 const debt=jobs.find(j=>j.event_key.startsWith('debt:'));
 await db.query("update basement_push_deliveries set status='sent',sent_at=test_now() where id=$1",[debt.id]);
 await db.exec("update test_clock set value=value+interval '1 day'");
 assert.equal((await claim(db)).filter(j=>j.event_key.startsWith('debt:')).length,0,'no daily debt spam');
 await db.exec("update test_clock set value='2026-10-07 08:00+00'");jobs=await claim(db);assert.equal(jobs.filter(j=>j.event_key.startsWith('debt:')).length,1);
 await db.exec("update members set debt=0;update basement_push_deliveries set status='failed';update test_clock set value='2026-09-29 08:00+00'");
 assert.equal((await db.query("select count(*)::int as n from basement_push_private.candidates where kind='payments'")).rows[0].n,0);
 await db.exec(`insert into member_packages values('10000000-0000-0000-0000-000000000004','${user}','20000000-0000-0000-0000-000000000001','2026-10-01','2026-10-30','active',8,null)`);
 assert.equal((await db.query("select count(*)::int as n from basement_push_private.candidates where event_key like 'expiry:%'")).rows[0].n,0,'already renewed package does not prompt renewal');
 await db.exec("update test_clock set value='2026-09-29 19:00+00'");assert.equal((await db.query('select count(*)::int as n from basement_push_private.candidates')).rows[0].n,0,'22:00 Athens is quiet');
 await db.exec("update test_clock set value='2026-09-29 08:00+00';update app_settings set value='{\"remindersEnabled\":false}'");assert.equal((await db.query('select count(*)::int as n from basement_push_private.candidates')).rows[0].n,0);
 }finally{await db.close()}
});
test('one daily training reminder, retry lease recovery and private server-only grants',async()=>{
 const db=await fixture();try{
 await db.exec(`update app_settings set value='{"oneReminderPerDay":true}';insert into basement_slots values(1,test_now()+interval '1 hour',test_now()+interval '2 hours',true),(2,test_now()+interval '2 hours',test_now()+interval '3 hours',true);insert into basement_bookings values(1,'${user}',1,'booked'),(2,'${user}',2,'booked');`);
 const first=await claim(db);assert.equal(first.length,1);assert.match(first[0].event_key,/^training-day:/);
 await db.exec("update test_clock set value=value+interval '4 minutes'");const retried=await claim(db);assert.equal(retried.length,1);assert.equal(retried[0].attempts,2);assert.notEqual(retried[0].lease,first[0].lease);
 assert.equal((await db.query('select basement_push_still_due($1,$2) as due',[first[0].id,first[0].lease])).rows[0].due,false);
 await db.exec("update basement_push_deliveries set status='sent'");assert.equal((await claim(db)).length,0);
 const funcs=['basement_push_config(jsonb)','basement_push_claim(integer)','basement_push_still_due(uuid,uuid)','basement_push_test_claim(uuid,text)','basement_push_subscribe(uuid,text,jsonb,jsonb)'];
 for(const f of funcs){for(const role of ['anon','authenticated'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') as allowed',[role,'public.'+f])).rows[0].allowed,false);}
 await db.exec('set role authenticated');await assert.rejects(db.query('select * from public.basement_push_devices'),/permission denied/);await assert.rejects(db.query('select * from basement_push_private.candidates'),/permission denied/);
 }finally{await db.close()}
});
test('device ownership cannot be reassigned; own opt-out and test rate limit are enforced',async()=>{
 const db=await fixture();try{
 const prefs={training:true,subscriptions:true,payments:false};
 await assert.rejects(db.query('select basement_push_subscribe($1,$2,$3,$4)',[other,'https://web.push.apple.com/test','{}',prefs]),/another account/);
 await db.query('select basement_push_subscribe($1,$2,$3,$4)',[user,'https://web.push.apple.com/test','{}',prefs]);
 const trial=()=>db.query('select basement_push_test_claim($1,$2) as device',[user,'https://web.push.apple.com/test']);
 assert.ok((await trial()).rows[0].device);assert.equal((await trial()).rows[0].device,null);
 }finally{await db.close()}
});
