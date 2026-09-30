from playwright.sync_api import sync_playwright, expect
from pathlib import Path
import json,traceback,os,shutil
root=Path(__file__).resolve().parent.parent/'.calendar-smoke'
metadata=json.loads((root/'metadata.json').read_text())
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE_PATH') or shutil.which('chromium') or None,headless=True,args=['--no-sandbox'])
 def setup(width=390,height=844,focus=False,seed=''):
  page=browser.new_page(viewport={'width':width,'height':height},locale='el-GR',timezone_id='Europe/Athens',is_mobile=width<700,has_touch=width<700)
  page.set_default_timeout(3500)
  page.clock.set_fixed_time('2026-09-30T12:00:00Z')
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/*',lambda route:route.abort())
  page.set_content('<!doctype html><html lang="el"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div></body></html>')
  page.evaluate('Object.defineProperty(window,"localStorage",{value: {items:{}, getItem(k){return this.items[k]??null}, setItem(k,v){this.items[k]=String(v)},removeItem(k){delete this.items[k]}}})')
  page.evaluate('(focus)=>{localStorage.setItem("basement_calendar_controls_hidden","1");localStorage.setItem("basement_reference_calendar_focus",focus?"1":"0")}',focus)
  page.add_style_tag(content=(root/'styles.css').read_text())
  for file in ['runtime.js','mock-api.js']:page.add_script_tag(content=(root/file).read_text())
  if seed:page.evaluate(seed)
  page.add_script_tag(content=(root/'components.js').read_text())
  expect(page.locator('[data-slot-id]')).to_have_count(7)
  expect(page.locator('[data-slot-id="101"] .calendar-booking-name')).to_have_count(2)
  page.errors=errors
  return page
 def card(page,id=101):return page.locator(f'[data-slot-id="{id}"]')
 def book(page,id=101):return card(page,id).locator('.slot-booking-button')
 def chooser(page):return page.locator('dialog.quick-booking-dialog:not(.reference-launcher)')
 def candidate(page,name):return chooser(page).locator('.quick-booking-results button').filter(has_text=name)
 def calls(page):return page.evaluate('window.calls.filter(c=>c.path.endsWith("/basement_book")||c.path.endsWith("/basement_owner_overbook"))')
 def run(name,fn):
  try:fn();results.append({'test':name,'result':'PASS'});print('PASS',name,flush=True)
  except Exception as e:results.append({'test':name,'result':'FAIL','error':str(e)});print('FAIL',name,str(e),flush=True);traceback.print_exc()
 def direct():
  page=setup();expect(book(page)).to_be_visible();expect(book(page)).to_be_enabled()
  assert book(page).bounding_box()['height']>=44
  expect(card(page).locator('.calendar-booking-billing')).to_have_count(0)
  expect(card(page).locator('.slot-toggle')).not_to_be_visible()
  book(page).click();expect(chooser(page)).to_be_visible();expect(page.locator('.appointment-modal')).to_have_count(0)
  expect(chooser(page)).to_contain_text('16:00');expect(chooser(page)).to_contain_text('1 διαθέσιμη θέση')
  chooser(page).locator('input[type=search]').fill('γαμμα');expect(candidate(page,'Μέλος Γάμμα')).to_be_visible()
  candidate(page,'Μέλος Γάμμα').click();expect(chooser(page)).to_have_count(0)
  expect(card(page).locator('header')).to_contain_text('3/3');expect(book(page)).to_be_disabled()
  expect(card(page).locator('.calendar-booking-name')).to_have_count(2);expect(card(page)).to_contain_text('+1 ακόμη')
  assert len(calls(page))==1 and calls(page)[0]['body']=={'p_slot_id':101,'p_member_id':'member-3'}
  assert not page.errors,page.errors;page.close()
 run('mobile compact: visible 44px button → search → member → correct booking and capacity',direct)
 def duplicate():
  page=setup();book(page).click();expect(candidate(page,'Μέλος Άλφα')).to_be_disabled();expect(candidate(page,'Μέλος Βήτα')).to_be_disabled()
  chooser(page).get_by_role('button',name='Κλείσιμο αναζήτησης').click();assert calls(page)==[];page.close()
 run('existing members disabled; cancelling selection creates no booking',duplicate)
 def double():
  page=setup();book(page,103).click();candidate(page,'Μέλος Γάμμα').evaluate('(b)=>{b.click();b.click()}')
  expect(chooser(page)).to_have_count(0);assert len(calls(page))==1;assert calls(page)[0]['body']['p_slot_id']==103;page.close()
 run('rapid double click sends one booking request',double)
 def server_error():
  page=setup(seed='window.failNext=true');book(page,103).click();candidate(page,'Μέλος Δέλτα').click()
  expect(chooser(page).get_by_role('alert')).to_contain_text('ανεπαρκές υπόλοιπο');expect(chooser(page)).to_be_visible()
  assert page.evaluate('window.testSlots.find(s=>s.id===103).reserved')==0
  candidate(page,'Μέλος Δέλτα').click();expect(chooser(page)).to_have_count(0)
  assert len(calls(page))==2;page.close()
 run('server rejection stays visible in chooser; explicit retry works without false success',server_error)
 def sheet():
  page=setup();card(page).locator('header strong').click();sheet=page.locator('.appointment-modal')
  expect(sheet).to_be_visible();expect(sheet.locator('.appointment-member')).to_have_count(2)
  sheet.locator('.appointment-add-booking').click();expect(sheet).to_have_count(0);expect(chooser(page)).to_be_visible()
  candidate(page,'Μέλος Γάμμα').click();expect(chooser(page)).to_have_count(0);assert len(calls(page))==1;page.close()
 run('appointment details → add member: closes old sheet, opens chooser and books',sheet)
 def focus():
  page=setup(focus=True);expect(page.locator('.calendar-focus-actions .calendar-new-booking')).to_be_visible()
  page.locator('.calendar-focus-actions .calendar-new-booking').click();launcher=page.locator('.reference-launcher');expect(launcher).to_be_visible()
  launcher.locator('select').select_option('service-1');launcher.locator('.quick-booking-results button').filter(has_text='16:40').click()
  expect(launcher).to_have_count(0);expect(chooser(page)).to_be_visible();expect(chooser(page)).to_contain_text('16:40')
  candidate(page,'Μέλος Γάμμα').click();expect(chooser(page)).to_have_count(0)
  assert calls(page)[0]['body']=={'p_slot_id':103,'p_member_id':'member-3'}
  assert page.locator('.calendar-focus').count()==1
  book(page,103).scroll_into_view_if_needed();page.screenshot(path=str(root/'focus-mobile.png'));page.close()
 run('full-screen bottom booking shortcut → service/time → member',focus)
 def keyboard():
  page=setup(width=1440,height=1000);button=book(page,103);button.focus();page.keyboard.press('Enter')
  expect(chooser(page)).to_be_visible();expect(page.locator('.appointment-modal')).to_have_count(0);assert calls(page)==[];page.close()
 run('keyboard Enter on booking button does not also open the details sheet',keyboard)
 def disabled():
  page=setup();
  for id in [104,105,106]:expect(book(page,id)).to_be_disabled()
  assert calls(page)==[];page.close()
 run('closed, full and started slots show disabled booking actions',disabled)
 def toggle_closed():
  page=setup();card(page,104).locator('header strong').click();sheet=page.locator('.appointment-modal')
  expect(sheet.locator('.appointment-add-booking')).to_be_disabled()
  sheet.locator('footer').get_by_role('button',name='Άνοιγμα ώρας',exact=True).click()
  expect(sheet.locator('.appointment-add-booking')).to_be_enabled()
  expect(sheet.locator('footer').get_by_role('button',name='Κλείσιμο ώρας',exact=True)).to_be_visible()
  sheet.locator('.appointment-add-booking').click();expect(chooser(page)).to_be_visible();expect(chooser(page)).to_contain_text('17:20');page.close()
 run('reopening a closed slot refreshes the sheet and enables add-member',toggle_closed)
 def waitlist():
  page=setup(seed='window.testSettings.waitlistEnabled=true;window.testServiceFlags.waitlist=true')
  expect(book(page,105)).to_have_text('＋ Αναμονή');book(page,105).click();candidate(page,'Μέλος Δέλτα').click()
  expect(chooser(page)).to_have_count(0);expect(page.locator('.booking-success')).to_contain_text('λίστα αναμονής')
  assert page.evaluate('window.testWaiting.length')==1
  assert page.evaluate('window.testSlots.find(s=>s.id===105).reserved')==3;page.close()
 run('enabled waitlist receives member without increasing reserved capacity',waitlist)
 def paused():
  page=setup(seed='window.testSettings.pauseBookings=true');expect(book(page,103)).to_be_disabled();expect(book(page,103)).to_have_text('Παύση κρατήσεων');page.close()
 run('paused bookings remain disabled',paused)
 def picker_full():
  page=setup();page.locator('.calendar-view-bar .calendar-new-booking').click();launcher=page.locator('.reference-launcher')
  launcher.locator('select').select_option('service-1')
  expect(launcher.locator('.quick-booking-results button').filter(has_text='18:00')).to_be_disabled()
  expect(launcher.locator('.quick-booking-results button').filter(has_text='16:40')).to_be_enabled()
  assert calls(page)==[];page.close()
 run('time picker disables full slots instead of failing behind its dialog',picker_full)

 def expanded():
  page=setup();page.get_by_role('button',name='Άνοιγμα όλων',exact=True).click()
  expect(card(page).locator('.calendar-booking-billing')).to_have_count(2);expect(card(page).locator('.slot-toggle')).to_be_visible()
  expect(book(page)).to_be_visible();page.get_by_role('button',name='Κλείσιμο όλων',exact=True).click()
  expect(card(page).locator('.calendar-booking-billing')).to_have_count(0);expect(book(page)).to_be_visible();page.close()
 run('expand/collapse keeps booking action, toggles only secondary details',expanded)
 def persistent():
  page=setup();button=page.locator('.calendar-view-bar .calendar-new-booking');expect(button).to_be_visible()
  button.click();expect(page.locator('.reference-launcher')).to_be_visible();assert not page.errors;page.close()
 run('folded toolbar retains its top booking shortcut',persistent)
 def narrow():
  for width in [320,390,768,1440]:
   page=setup(width=width,height=900,focus=True)
   footer=page.locator('.calendar-focus-actions');bounds=footer.bounding_box()
   button=footer.locator('.calendar-new-booking');expect(button).to_be_visible();bb=button.bounding_box()
   assert bb['x']>=0 and bb['x']+bb['width']<=width+1,(width,bb)
   button.click();expect(page.locator('.reference-launcher')).to_be_visible();assert not page.errors,page.errors
   page.close()
 run('booking shortcut is reachable at 320, 390, 768 and 1440px widths',narrow)
 browser.close()
(root/'browser-results.json').write_text(json.dumps({'runtime':metadata['runtime'],'scope':metadata['scope'],'tests':results},ensure_ascii=False,indent=2))
print('TOTAL',len(results),'PASS',sum(r['result']=='PASS' for r in results),'FAIL',sum(r['result']=='FAIL' for r in results))
raise SystemExit(any(r['result']=='FAIL' for r in results))
