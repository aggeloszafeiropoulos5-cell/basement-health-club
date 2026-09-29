const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const context = {exports: {}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/calendar-time.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, context);
const {calendarNowPosition, calendarSlotPhase} = context.exports;
const at = time => Date.parse(`2026-09-29T${time}:00+03:00`);
const row = (start, end, top, bottom) => ({startsAt: at(start), endsAt: at(end), top, bottom});

test('19:00 dims the finished 18:00 class but keeps 18:40–19:20 current', () => {
  const phase = (start, end, now) => calendarSlotPhase(new Date(at(start)).toISOString(), new Date(at(end)).toISOString(), at(now));
  assert.equal(phase('18:00', '19:00', '19:00'), 'past');
  assert.equal(phase('18:40', '19:20', '19:00'), 'current');
  assert.equal(phase('19:00', '20:00', '19:00'), 'current');
  assert.equal(phase('19:20', '20:00', '19:00'), 'future');
});
test('the marker follows actual unequal row heights and advances at exact row starts', () => {
  const rows = [row('18:00', '19:00', 50, 250), row('18:40', '19:20', 250, 350), row('19:20', '20:00', 350, 600)];
  assert.equal(calendarNowPosition(rows, at('18:20')), 150);
  assert.equal(calendarNowPosition(rows, at('18:40')), 250);
  assert.equal(calendarNowPosition(rows, at('19:00')), 300);
  assert.equal(calendarNowPosition(rows, at('19:20')), 350);
  assert.equal(calendarNowPosition(rows, at('19:40')), 475);
});
test('breaks keep the marker at the boundary and out-of-hours has no misleading line', () => {
  const rows = [row('09:00', '10:00', 50, 250), row('16:00', '17:00', 250, 450)];
  assert.equal(calendarNowPosition(rows, at('12:00')), 250);
  assert.equal(calendarNowPosition(rows, at('08:59')), null);
  assert.equal(calendarNowPosition(rows, at('17:00')), null);
  assert.equal(calendarNowPosition([], at('12:00')), null);
});
test('ended state uses timestamps across dates and timezone offsets, not a bare hour', () => {
  const now = Date.parse('2026-09-29T19:00:00+03:00');
  assert.equal(calendarSlotPhase('2026-09-28T20:00:00+03:00', '2026-09-28T21:00:00+03:00', now), 'past');
  assert.equal(calendarSlotPhase('2026-09-30T09:00:00+03:00', '2026-09-30T10:00:00+03:00', now), 'future');
  assert.equal(calendarSlotPhase('2026-09-29T15:40:00Z', '2026-09-29T16:20:00Z', now), 'current');
});
