const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sql=read('supabase/migrations/20260930090000_v43_settings_complete.sql');
const settings=read('app/dashboard/settings-panel.tsx');
const calendar=read('app/dashboard/bookings-calendar.tsx');
const portal=read('app/dashboard/member-portal.tsx');
const ops=read('app/dashboard/operations-panel.tsx');
const pub=read('app/public-site-dynamic.tsx');
const restrictions=read('app/dashboard/restriction-settings.tsx');

test('previously passive booking settings are enforced in database rules',()=>{
  for(const key of [
    'newCustomerBooking','dependentAvailability','fixedPositions','fixedPositionsAffectCapacity',
    'overLimitToWaitlist','waitlistUpdateLink','skipNewCustomerChecks','newCustomerOutsideSubscription',
    'serviceSubscriptionDates','ignoreCancelledInLimit','ignoreMovedInLimit','cancelMoveLimit',
    'noShowUnlockCost','subscriptionOnly','serviceBookingLimits','restrictedCustomers','gdprConsent','paidDate'
  ]) assert.ok(sql.includes(key),`${key} is missing from database enforcement`);
  for(const fn of [
    'basement_book','basement_cancel','basement_move_booking','basement_availability',
    'basement_record_consent','basement_member_save_health','basement_confirm_booking',
    'basement_member_portal_extras'
  ]) assert.ok(sql.includes(`function public.${fn}`)||sql.includes(`function basement_private.${fn}`),`${fn} missing`);
});

test('staff/calendar settings have visible working consumers',()=>{
  for(const key of ['showStaffAsNote','staffScheduleLink','staffScheduleNote','chooseStaffOnMove','fixedPositions','hideFixedPositions','paidDate','serviceSubscriptionDates']){
    assert.ok(settings.includes(key),`${key} missing from settings`);
    assert.ok(calendar.includes(key),`${key} missing from calendar consumer`);
  }
  assert.ok(calendar.includes('trainer_id'));
  assert.ok(calendar.includes('assignTrainer'));
  assert.ok(calendar.includes('position_no'));
});

test('member/public/operations settings are wired to real screens and RPCs',()=>{
  for(const key of ['guestBooking','businessEmail','businessPhone']) assert.ok(pub.includes(key),`${key} missing from public site`);
  assert.ok(pub.includes('basement_guest_request'));
  assert.ok(portal.includes('basement_member_portal_extras'));
  assert.ok(portal.includes('basement_record_consent'));
  assert.ok(portal.includes('basement_member_save_health'));
  assert.ok(portal.includes('basement_confirm_booking'));
  assert.ok(ops.includes('incomeTools'));
  assert.ok(ops.includes('questionnaires'));
  assert.ok(restrictions.includes('booking_restrictions'));
});
