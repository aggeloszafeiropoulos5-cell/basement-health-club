const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const cache={};
function load(name){
  if(cache[name])return cache[name];
  const context={exports:{},require:id=>load(path.basename(id))};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,`../lib/${name}.ts`),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return cache[name]=context.exports;
}
const {athensDate,weekStart,weeklySummary}=load('weekly-report');
const {bookingPlan,submitBookingPlan}=load('booking-plan');
const booking=(id,member_id,status,service='EMS Training',starts_at='2026-09-29T08:00:00Z')=>({id,member_id,status,slot:{service,starts_at}});
test('repeat visits count once as people, twice as sessions, and once across services in total',()=>{
  const rows=[booking(1,'a','completed'),booking(2,'a','completed'),booking(3,'a','booked','Cross Training'),booking(4,'b','no_show'),booking(5,'c','cancelled'),booking(6,'d','pending')];
  const stats=weeklySummary(rows,'2026-09-28',['EMS Sculpting']);
  const ems=stats.services.find(s=>s.service==='EMS Training');
  assert.equal(ems.people,2);assert.equal(ems.bookings,3);assert.equal(ems.attendees,1);assert.equal(ems.checkins,2);assert.equal(ems.noShow,1);assert.equal(ems.cancelled,1);
  assert.equal(stats.total.people,2);assert.equal(stats.total.bookings,4);
  assert.equal(stats.services.find(s=>s.service==='EMS Sculpting').people,0);
});
test('Athens week boundaries include Monday midnight and exclude the following Monday across DST',()=>{
  assert.equal(athensDate('2026-10-25T22:00:00Z'),'2026-10-26');
  assert.equal(weekStart('2026-10-25'),'2026-10-19');
  const rows=[booking(1,'a','booked','EMS','2026-10-18T20:59:59Z'),booking(2,'b','booked','EMS','2026-10-18T21:00:00Z'),booking(3,'c','completed','EMS','2026-10-25T21:59:59Z'),booking(4,'d','booked','EMS','2026-10-25T22:00:00Z')];
  assert.equal(weeklySummary(rows,'2026-10-19').total.people,2);
});
test('unknown states, absent-only members and duplicate page records do not inflate people',()=>{
  const b=booking(1,'a','completed');
  const stats=weeklySummary([b,b,booking(2,'b','late_cancel'),booking(3,'c','waiting')],'2026-09-28');
  assert.equal(stats.total.people,1);assert.equal(stats.total.checkins,1);assert.equal(stats.total.cancelled,1);
});
const slot=(id,date,extras={})=>({id,service:'EMS Training',starts_at:date+'T15:00:00Z',ends_at:date+'T15:40:00Z',capacity:3,reserved:0,enabled:true,...extras});
const member=(id,expires_on='2026-10-31')=>({id,name:id,contact:'',packages:[{starts_on:'2026-09-01',expires_on}]});
const seed=slot(1,'2026-09-28');
const base={seed,slots:[seed],members:[member('a')],bookings:[],waiting:[],repeat:false,end:'2026-10-05',weekdays:[1],now:Date.parse('2026-09-27T00:00:00Z')};
test('batch preview allocates only remaining places and skips duplicates before counting capacity',()=>{
  const rows=bookingPlan({...base,seed:{...seed,reserved:2},members:[member('a'),member('b'),member('c')],bookings:[{slot_id:1,member_id:'a',status:'booked'}]});
  assert.match(rows[0].issue,/ήδη/);assert.equal(rows[1].issue,'');assert.match(rows[2].issue,/θέση/);
});
test('weekly series marks missing hours and expired packages instead of silently booking them',()=>{
  const rows=bookingPlan({...base,repeat:true,members:[member('a','2026-09-30')],slots:[seed,slot(2,'2026-10-05')],weekdays:[1,4]});
  assert.equal(rows.length,3);assert.equal(rows[0].issue,'');assert.match(rows[1].issue,/πρόγραμμα/);assert.match(rows[2].issue,/πακέτου/);
});
test('weekly series uses local wall time after DST changes',()=>{
  const before=slot(1,'2026-10-19'),after={...slot(2,'2026-10-26'),starts_at:'2026-10-26T16:00:00Z',ends_at:'2026-10-26T16:40:00Z'};
  const rows=bookingPlan({...base,seed:before,slots:[before,after],repeat:true,end:'2026-10-26'});
  assert.equal(rows.length,2);assert.equal(rows[1].slotId,2);assert.equal(rows[1].issue,'');
});
test('batch submission never retries an uncertain write and stops before later rows',async()=>{
  const rows=bookingPlan({...base,members:[member('a'),member('b'),member('c')]});
  const calls=[],results=[];
  await submitBookingPlan(rows,async(slotId,memberId)=>{calls.push([slotId,memberId]);if(memberId==='b')throw new Error('network');return {state:'booked',message:'ok'}},(row,result)=>results.push(result.state));
  assert.deepEqual(calls,[[1,'a'],[1,'b']]);assert.deepEqual(results,['booked','unknown']);
});
test('closed, past and waiting bookings are blocked by the preview',()=>{
  assert.match(bookingPlan({...base,seed:{...seed,enabled:false}})[0].issue,/Κλειστή/);
  assert.match(bookingPlan({...base,now:Date.parse('2026-09-29T00:00:00Z')})[0].issue,/ξεκινήσει/);
  assert.match(bookingPlan({...base,waiting:[{slot_id:1,member_id:'a'}]})[0].issue,/αναμονή/);
});
