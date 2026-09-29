const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const vm=require('node:vm');
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/calendar-counts.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
const {calendarCounts,calendarCountDetails}=context.exports;
const states=(...status)=>status.map(status=>({status}));

test('the screenshot retains two completed visits and separates absent/cancelled records',()=>{
  const counts=calendarCounts(states('cancelled','no_show','completed','no_show','completed'));
  assert.equal(counts.total,2);
  assert.equal(counts.completed,2);
  assert.equal(counts.noShow,2);
  assert.equal(counts.cancelled,1);
  assert.equal(calendarCountDetails(counts),'2 check-in · 2 no-show · 1 ακυρώσεις');
});
test('check-in does not reduce the displayed booking total',()=>{
  assert.equal(calendarCounts(states('pending','booked','booked')).total,3);
  assert.equal(calendarCounts(states('pending','completed','booked')).total,3);
  assert.equal(calendarCounts(states('completed','completed','completed')).total,3);
});
test('late cancellation, cancellation, waiting and no-show never count as attendance',()=>{
  const counts=calendarCounts(states('late_cancel','cancelled','waiting','no_show'));
  assert.equal(counts.total,0);
  assert.equal(counts.cancelled,2);
  assert.equal(counts.noShow,1);
});
test('empty slots have no detail text and overbooked history is not capped',()=>{
  assert.equal(calendarCounts([]).total,0);
  assert.equal(calendarCountDetails(calendarCounts([])),'');
  assert.equal(calendarCounts(states(...Array(7).fill('completed'))).total,7);
});
