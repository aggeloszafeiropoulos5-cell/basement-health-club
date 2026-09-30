// No network, production data, or database writes. Run with node --test.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'lib/slot-booking.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const {slotBookingState}=context.exports;
const now=Date.parse('2026-09-30T12:00:00Z');
const slot={starts_at:'2026-09-30T13:00:00Z',ends_at:'2026-09-30T13:40:00Z',enabled:true,capacity:3,reserved:1};
const opts={now,busy:false,paused:false,canWaitlist:false,canOverbook:false};

test('available slot has an explicit booking button and remaining places',()=>{
 const state=slotBookingState(slot,opts);
 assert.equal(state.disabled,false);assert.equal(state.label,'＋ Κράτηση');assert.equal(state.freePlaces,2);assert.equal(state.description,'2 διαθέσιμες θέσεις');
});
test('a full slot cannot create an ordinary booking',()=>{const state=slotBookingState({...slot,reserved:3},opts);assert.equal(state.disabled,true);assert.equal(state.label,'Πλήρες')});
test('a full slot can expose its enabled waiting list',()=>{const state=slotBookingState({...slot,reserved:3},{...opts,canWaitlist:true});assert.equal(state.disabled,false);assert.equal(state.label,'＋ Αναμονή')});
test('explicit owner overbooking has a distinct label',()=>{const state=slotBookingState({...slot,reserved:3},{...opts,canOverbook:true});assert.equal(state.disabled,false);assert.equal(state.label,'＋ Επιπλέον θέση')});
test('closed slots remain disabled despite waitlist and overbooking',()=>{const state=slotBookingState({...slot,enabled:false},{...opts,canWaitlist:true,canOverbook:true});assert.equal(state.disabled,true);assert.equal(state.label,'Κλειστή ώρα')});
test('a started slot is disabled, including the exact start boundary',()=>{for(const starts_at of ['2026-09-30T11:00:00Z','2026-09-30T12:00:00Z'])assert.equal(slotBookingState({...slot,starts_at},opts).disabled,true)});
test('invalid start time cannot open a booking',()=>assert.equal(slotBookingState({...slot,starts_at:'not-a-date'},opts).disabled,true));
test('paused and pending operations disable new entry points',()=>{assert.equal(slotBookingState(slot,{...opts,paused:true}).disabled,true);assert.equal(slotBookingState(slot,{...opts,busy:true}).disabled,true)});
test('remaining capacity never becomes negative',()=>assert.equal(slotBookingState({...slot,reserved:5},opts).freePlaces,0));
test('primary actions survive compact CSS while the close-slot action is hidden',()=>{
 const css=fs.readFileSync(path.join(root,'app/calendar-readability.css'),'utf8');
 assert.match(css,/\.calendar-compact-rows \.calendar-slot \.slot-actions\s*\{\s*display:\s*flex;/);
 assert.doesNotMatch(css,/\.calendar-compact-rows \.calendar-slot \.slot-actions\s*\{\s*display:\s*none;/);
 assert.match(css,/\.calendar-compact-rows \.calendar-slot \.slot-toggle\s*\{\s*display:\s*none;/);
});
test('card, appointment sheet and launcher share the booking entry point',()=>{
 const source=fs.readFileSync(path.join(root,'app/dashboard/bookings-calendar.tsx'),'utf8');
 assert.match(source,/className="slot-booking-button"/);
 assert.match(source,/className="appointment-add-booking"/);
 assert.match(source,/onChoose=\{startBooking\}/);
 assert.match(source,/e\.stopPropagation\(\);if\(owner\)startBooking\(slot\)/);
 assert.match(source,/setSelectedSlot\(null\);setMovingBooking\(null\)/);
 assert.match(source,/slotBookings\.slice\(0,compactRows\?2:slotBookings\.length\)/);
 assert.match(source,/!bookingId&&owner&&!targetMemberId/);
});

test('the time picker respects the same availability and uses 24-hour labels',()=>{
 const source=fs.readFileSync(path.join(root,'app/dashboard/appointment-launcher.tsx'),'utf8');
 assert.match(source,/disabled=\{state\?\.disabled\}/);
 assert.match(source,/hourCycle:"h23"/);
});
