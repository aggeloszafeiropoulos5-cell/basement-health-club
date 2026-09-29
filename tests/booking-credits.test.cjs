// Real PostgreSQL in memory; no production data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {database,uid}=require('./helpers/credit-database.cjs');
const fs=require('node:fs');
const path=require('node:path');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260929202931_booking_credit_reservation.sql'),'utf8');
const portalMigration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260929204003_member_personal_portal.sql'),'utf8');
test('booking credit lifecycle and access controls',async t=>{
 const db=await database();
 const q=async(sql,params=[]) => {
  await db.exec('savepoint rpc_call');
  try{const rows=(await db.query(sql,params)).rows;await db.exec('release savepoint rpc_call');return rows}
  catch(error){await db.exec('rollback to savepoint rpc_call;release savepoint rpc_call');throw error}
 };
 const remaining=async(id=401)=>(await q('select sessions_remaining as n from member_packages where id=$1',[uid(id)]))[0].n;
 const book=async(slot=1,member=2)=>(await q('select basement_book($1,$2) as id',[slot,uid(member)]))[0].id;
 const action=(id,act)=>q('select basement_admin_booking_action($1,$2)',[id,act]);
 const cancel=id=>q('select basement_cancel($1)',[id]);
 const scenario=async(name,run)=>t.test(name,async()=>{await db.exec('begin');try{await run()}finally{await db.exec('rollback')}});
 try{
 await scenario('book debits once; check-in, repeat check-in and undo keep the same single debit',async()=>{
  const id=await book();assert.equal(await remaining(),7);
  await action(id,'complete');await action(id,'complete');assert.equal(await remaining(),7);
  await action(id,'undo');assert.equal(await remaining(),7);
  await cancel(id);await cancel(id);assert.equal(await remaining(),8);
  await action(id,'undo');assert.equal(await remaining(),7);
  const [usage]=await q('select change,refunded_at from basement_session_usage where booking_id=$1',[id]);assert.equal(usage.change,-1);assert.equal(usage.refunded_at,null);
 });
 await scenario('cancellation ten minutes before start refunds despite the former 30-minute setting',async()=>{
  await db.exec("update basement_slots set starts_at=now()+interval '10 minutes',ends_at=now()+interval '50 minutes' where id=1");
  const id=await book();await q("select set_config('request.jwt.claim.sub',$1,true)",[uid(2)]);
  await cancel(id);assert.equal(await remaining(),8);
 });
 await scenario('no-show and cancellation after start do not refund or charge again',async()=>{
  const id=await book();await action(id,'no_show');assert.equal(await remaining(),7);
  await action(id,'undo');await db.exec("update basement_slots set starts_at=now()-interval '1 minute' where id=1");
  await cancel(id);assert.equal(await remaining(),7);
 });
 await scenario('unfunded, wrong-service and out-of-date reservations roll back without partial bookings',async()=>{
  await assert.rejects(book(1,4),/διαθέσιμη συνεδρία/);
  await assert.rejects(book(3),/διαθέσιμη συνεδρία/);
  await assert.rejects(book(4),/διαθέσιμη συνεδρία/);
  assert.equal((await q('select count(*)::int as n from basement_bookings'))[0].n,0);assert.equal(await remaining(),8);
 });
 await scenario('only the last available credit can be reserved',async()=>{
  await q('update member_packages set sessions_remaining=1 where id=$1',[uid(401)]);
  await book();assert.equal(await remaining(),0);await assert.rejects(book(2),/διαθέσιμη συνεδρία/);
  assert.equal(await remaining(),0);
 });
 await scenario('moving retains the credit and invalid destinations leave the booking unchanged',async()=>{
  const id=await book();await q('select basement_move_booking($1,2)',[id]);assert.equal(await remaining(),7);
  await assert.rejects(q('select basement_move_booking($1,4)',[id]),/πακέτο/);
  assert.equal((await q('select slot_id from basement_bookings where id=$1',[id]))[0].slot_id,2);assert.equal(await remaining(),7);
 });
 await scenario('auto completion uses the held credit and repeated runs are harmless',async()=>{
  const id=await book();await db.exec("update basement_slots set starts_at=now()-interval '1 hour',ends_at=now()-interval '1 minute' where id=1");
  await q('select basement_auto_complete_due()');await q('select basement_auto_complete_due()');assert.equal(await remaining(),7);
  assert.equal((await q('select status from basement_bookings where id=$1',[id]))[0].status,'completed');
 });
 await scenario('unlimited subscriptions stay unlimited on booking, completion and refund',async()=>{
  await q('update member_packages set sessions_remaining=null,sessions_total=null where id=$1',[uid(401)]);
  const id=await book();await action(id,'complete');await action(id,'undo');await cancel(id);assert.equal(await remaining(),null);
 });
 await scenario('another member cannot cancel, read member finance totals or charge an existing booking',async()=>{
  const id=await book();await q("select set_config('request.jwt.claim.sub',$1,true)",[uid(3)]);
  await assert.rejects(cancel(id),/επιτρέπεται/);await assert.rejects(q('select basement_calendar_member_finances()'),/επιτρέπεται/);
  await assert.rejects(q('select basement_charge_existing_booking($1)',[id]),/επιτρέπεται/);assert.equal(await remaining(),7);
 });
 await scenario('payment dates are actual receipts; marking paid twice preserves the original timestamp',async()=>{
  const id=await book();await action(id,'paid');const before=(await q('select paid_at from basement_bookings where id=$1',[id]))[0].paid_at;
  await action(id,'paid');assert.deepEqual((await q('select paid_at from basement_bookings where id=$1',[id]))[0].paid_at,before);
  await q("insert into financial_entries(member_id,kind,category,amount,occurred_on) values($1,'income','Συνδρομή',60,current_date-2),($1,'expense','Άλλο',5,current_date),($1,'income','Συνδρομή',60,current_date+3)",[uid(102)]);
  const [finance]=await q('select f.last_payment_on=current_date-2 as correct from basement_calendar_member_finances() f where auth_user_id=$1',[uid(2)]);assert.equal(finance.correct,true);
 });
 await scenario('waitlist promotion charges only promoted members and skips an unfunded first entry',async()=>{
  await db.exec("update basement_slots set capacity=1 where id=1;update app_settings set value=value||'{\"waitlistEnabled\":true}'::jsonb");
  const id=await book();await q("insert into basement_waiting_list(slot_id,member_id,created_at) values(1,$1,now()-interval '1 minute'),(1,$2,now())",[uid(4),uid(3)]);
  await cancel(id);assert.equal(await remaining(),8);assert.equal(await remaining(402),7);
  assert.equal((await q("select status from basement_waiting_list where member_id=$1",[uid(4)]))[0].status,'waiting');
 });
 await scenario('legacy appointments and migration replay never fabricate refunds or double charge',async()=>{
  await q("insert into basement_bookings(slot_id,member_id,credit_policy) values(1,$1,'legacy'),(2,$2,'legacy')",[uid(2),uid(4)]);
  await db.exec(migration);assert.equal(await remaining(),7);await db.exec(migration);assert.equal(await remaining(),7);
  const old=(await q('select id from basement_bookings where member_id=$1',[uid(4)]))[0].id;await cancel(old);assert.equal(await remaining(),7);
 });
 await scenario('personal portal only exposes own bookings, packages and subscribed service',async()=>{
  const own=await book(1,2);await book(2,3);
  await q("select set_config('request.jwt.claim.sub',$1,true)",[uid(2)]);
  const [{data}]=await q('select basement_member_portal() as data');
  assert.deepEqual(data.services,['EMS Training']);assert.equal(data.packages.length,1);assert.equal(data.packages[0].id,uid(401));
  assert.equal(data.bookings.length,1);assert.equal(data.bookings[0].id,own);
  const slots=await q('select * from basement_availability()');assert.ok(slots.length>0);assert.ok(slots.every(s=>s.service==='EMS Training'));assert.ok(!slots.some(s=>s.id===4));
  await assert.rejects(book(3,2),/συνδρομή/);
 });
 await scenario('members without subscriptions, disabled accounts and anonymous callers get no available slots',async()=>{
  await q("select set_config('request.jwt.claim.sub',$1,true)",[uid(4)]);assert.deepEqual(await q('select * from basement_availability()'),[]);
  await q('update profiles set active=false where id=$1',[uid(2)]);await q("select set_config('request.jwt.claim.sub',$1,true)",[uid(2)]);
  assert.deepEqual(await q('select * from basement_availability()'),[]);await assert.rejects(q('select basement_member_portal()'),/ενεργός/);
  await q("select set_config('request.jwt.claim.sub','',true)");assert.deepEqual(await q('select * from basement_availability()'),[]);await assert.rejects(q('select basement_member_portal()'),/ενεργός/);
 });
 await scenario('self-service respects frozen subscriptions and online package/service settings',async()=>{
  await q("select set_config('request.jwt.claim.sub',$1,true)",[uid(2)]);
  await q('update member_packages set frozen_until=current_date+20 where id=$1',[uid(401)]);
  assert.deepEqual(await q('select * from basement_availability()'),[]);await assert.rejects(book(1,2),/συνδρομή/);
  await q('update member_packages set frozen_until=null where id=$1',[uid(401)]);
  await q('update package_templates set online_booking_enabled=false where id=$1',[uid(301)]);
  assert.deepEqual(await q('select * from basement_availability()'),[]);await assert.rejects(book(1,2),/συνδρομή/);
 });
 await scenario('booking windows and paused bookings filter member slots while staff keeps the full schedule',async()=>{
  const staff=await q('select * from basement_availability()');assert.ok(staff.some(s=>s.service==='Cross Training'));
  await q("select set_config('request.jwt.claim.sub',$1,true)",[uid(2)]);
  await q("update app_settings set value=value||'{\"bookingMinHours\":100}'::jsonb");assert.deepEqual(await q('select * from basement_availability()'),[]);
  await q("update app_settings set value=value||'{\"bookingMinHours\":0,\"pauseBookings\":true}'::jsonb");assert.deepEqual(await q('select * from basement_availability()'),[]);
 });
 await scenario('reserving the last credit keeps the package usable for moves and refunds',async()=>{
  await q('update member_packages set sessions_remaining=1 where id=$1',[uid(401)]);
  const id=await book();await q('select basement_refresh_packages_and_renewals()');
  assert.equal((await q('select status from member_packages where id=$1',[uid(401)]))[0].status,'active');
  await q('select basement_move_booking($1,2)',[id]);await cancel(id);assert.equal(await remaining(),1);
  await book(1);assert.equal(await remaining(),0);
 });
 await scenario('grace period is consistent in portal availability and actual booking',async()=>{
  await q("update app_settings set value=value||'{\"maxAutoExtendDays\":5}'::jsonb");
  await q('update member_packages set expires_on=current_date+1 where id=$1',[uid(401)]);
  await q("select set_config('request.jwt.claim.sub',$1,true)",[uid(2)]);
  assert.ok((await q('select * from basement_availability()')).some(s=>s.id===1));await book(1,2);assert.equal(await remaining(),7);
 });
 await scenario('private credit helpers cannot be executed by API roles',async()=>{
  for(const role of ['anon','authenticated']){
   const [access]=await q(`select has_schema_privilege('${role}','basement_private','usage') as schema,has_function_privilege('${role}','basement_private.charge_booking(bigint,boolean)','execute') as charge,has_function_privilege('${role}','public.basement_promote_waiting(bigint)','execute') as promote`);
   assert.deepEqual(access,{schema:false,charge:false,promote:false});
  }
 });
 }finally{await db.close()}
});
