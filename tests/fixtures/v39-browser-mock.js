// Local-only fictional members. No production service or network request.
window.testMembers=Array.from({length:8},(_,i)=>({id:`member-${i+1}`,member_record_id:`record-${i+1}`,full_name:['Μέλος Άλφα','Μέλος Βήτα','Μέλος Γάμμα','Μέλος Δέλτα','Μέλος Έψιλον','Μέλος Ζήτα','Μέλος Ήτα','Μέλος Θήτα'][i],phone:'',email:`member${i+1}@example.test`,active:true}));
const makeSlot=(id,service,time,capacity,reserved=0,enabled=true)=>({id,service,starts_at:`2026-09-30T${time}:00+03:00`,ends_at:`2026-09-30T${String(Number(time.slice(0,2))+1).padStart(2,'0')}:${time.slice(3)}:00+03:00`,capacity,reserved,enabled});
window.testSlots=[makeSlot(101,'EMS Training','16:00',3,2),makeSlot(102,'Cross Training','16:00',6),makeSlot(103,'EMS Training','16:40',3),makeSlot(104,'EMS Training','17:20',3,0,false),makeSlot(105,'EMS Training','18:00',3,3),makeSlot(106,'EMS Training','09:00',3),makeSlot(107,'Cross Training','17:00',6)];
const booked=(id,slot_id,member_id)=>({id,slot_id,member_id,status:'booked',payment_status:'unpaid',notes:null,paid_at:null,credit_policy:'booking',moved_at:null,moved_from_slot_id:null,checked_in_at:null,completed_at:null});
window.testBookings=[booked(1,101,'member-1'),booked(2,101,'member-2'),booked(3,105,'member-1'),booked(4,105,'member-2'),booked(5,105,'member-3')];
window.testWaiting=[];window.calls=[];window.failNext=false;
window.testSettings={openingTime:'15:00',closingTime:'19:00',showAvailableSpots:true,showEndTime:true,colorPerService:true,waitlistEnabled:false,pauseBookings:false};
window.testServiceFlags={waitlist:false,overbook:false};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
window.mockApi=async(path,token,init={})=>{
 window.calls.push({path,method:init.method||'GET',body:init.body?JSON.parse(init.body):null});
 const p=path.split('?')[0];
 if(p.endsWith('/basement_brand_config'))return json({step:60,defaultView:'day'});
 if(p==='/rest/v1/services')return json(['Cross Training','EMS Training'].map((name,i)=>({id:`service-${i}`,name,duration_minutes:i?40:60,color:'#0774d1',active:true,overbooking_enabled:window.testServiceFlags.overbook,waiting_list_enabled:window.testServiceFlags.waitlist})));
 if(p.endsWith('/basement_auto_complete_due'))return json(0);
 if(p.endsWith('/basement_availability'))return json(window.testSlots);
 if(p==='/rest/v1/basement_bookings')return json(window.testBookings);
 if(p==='/rest/v1/app_settings')return json([{value:window.testSettings}]);
 if(p==='/rest/v1/basement_waiting_list')return json(window.testWaiting);
 if(p==='/rest/v1/basement_session_usage')return json([]);
 if(p.endsWith('/basement_calendar_member_finances'))return json([]);
 if(p==='/rest/v1/member_packages')return json(window.testMembers.map(m=>({id:`package-${m.id}`,member_id:m.member_record_id,starts_on:'2026-09-01',expires_on:'2026-10-30',sessions_total:8,sessions_remaining:8,status:'active',frozen_until:null,package_templates:{name:'Δοκιμαστικό πακέτο',package_template_services:[]}})));
 if(p.endsWith('/basement_book')||p.endsWith('/basement_owner_overbook')){
  await new Promise(r=>setTimeout(r,220));
  if(window.failNext){window.failNext=false;return json({message:'Δοκιμή: ανεπαρκές υπόλοιπο πακέτου.'},400)}
  const {p_slot_id,p_member_id}=JSON.parse(init.body),slot=window.testSlots.find(s=>s.id===p_slot_id);
  if(!slot||!slot.enabled||Date.parse(slot.starts_at)<=Date.now())return json({message:'Μη διαθέσιμη ώρα.'},400);
  if(!p_member_id)return json({message:'Λείπει το μέλος.'},400);
  if(window.testBookings.some(b=>b.slot_id===p_slot_id&&b.member_id===p_member_id&&['pending','booked'].includes(b.status)))return json({message:'Υπάρχει ήδη κράτηση.'},400);
  if(slot.reserved>=slot.capacity&&!p.endsWith('/basement_owner_overbook')){
   if(!window.testSettings.waitlistEnabled)return json({message:'Πλήρης ώρα.'},400);
   window.testWaiting.push({id:100,slot_id:p_slot_id,member_id:p_member_id,status:'waiting',created_at:new Date().toISOString()});return json(-100);
  }
  const id=window.testBookings.length+1;window.testBookings.push(booked(id,p_slot_id,p_member_id));slot.reserved++;return json(id);
 }
 if(p==='/rest/v1/basement_slots'&&init.method==='PATCH'){
  const id=Number(new URLSearchParams(path.split('?')[1]).get('id').replace('eq.',''));Object.assign(window.testSlots.find(s=>s.id===id),JSON.parse(init.body));return json(null);
 }
 throw Error('Unexpected mock API '+path);
};
