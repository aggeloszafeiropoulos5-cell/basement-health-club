"use client";
import {useCallback,useEffect,useMemo,useState,type CSSProperties} from "react";
import {api} from "../../lib/supabase-rest";
import {SessionExpiredError,clearSession} from "../../lib/session";
import {useControlTheme} from "../../lib/control-theme";
import {appointmentColor,shiftDay} from "../../lib/reference-calendar";
import AppointmentLauncher from "./appointment-launcher";
import BatchBooking from "./batch-booking";
import QuickBooking from "./quick-booking";
import CalendarNowLine,{useCalendarClock} from "./calendar-now-line";
import {calendarSlotPhase} from "../../lib/calendar-time";
import {calendarCounts,calendarCountDetails} from "../../lib/calendar-counts";
import {slotBookingState} from "../../lib/slot-booking";
import {useDisplayPreference} from "../../lib/use-display-preference";

type Slot={id:number;service:string;starts_at:string;ends_at:string;capacity:number;enabled:boolean;reserved:number;trainer_id?:string|null};
type Booking={id:number;slot_id:number;member_id:string;status:string;payment_status:string;paid_at:string|null;credit_policy:string;moved_at:string|null;moved_from_slot_id:number|null;notes:string|null;checked_in_at:string|null;completed_at:string|null;position_no:number|null};
type Waiting={id:number;slot_id:number;member_id:string;status:string;created_at:string};
type Member={id:string;member_record_id?:string;full_name:string|null;phone?:string|null;email?:string|null;active?:boolean};
type MemberPackage={id:string;member_id:string;starts_on:string;expires_on:string;sessions_total:number|null;sessions_remaining:number|null;status:string;frozen_until:string|null;package_templates:{name:string;package_template_services:{services:{name:string}|null}[]}|null};
type CreditUsage={booking_id:number;member_package_id:string|null;change:number;refunded_at:string|null};
type MemberFinance={auth_user_id:string;last_payment_on:string|null;next_payment_on:string|null};
type Trainer={id:string;full_name:string|null};
type CalendarSettings={openingTime?:string;closingTime?:string;showEndTime?:boolean;hideZeroCustomer?:boolean;hideZeroAdmin?:boolean;showAvailableSpots?:boolean;pauseBookings?:boolean;colorPerService?:boolean;showServiceName?:boolean;lastNameFirst?:boolean;hatchUnavailable?:boolean;hatchAvailable?:boolean;customCalendar?:boolean;timeFormat?:string;waitlistEnabled?:boolean;termsPage?:boolean;bookingMessages?:boolean;checkIn?:boolean;paidColor?:boolean;customEditedColor?:boolean;changeServiceOnMove?:boolean;showStaffAsNote?:boolean;staffScheduleNote?:boolean;staffScheduleLink?:boolean;chooseStaffOnMove?:boolean;fixedPositions?:boolean;hideFixedPositions?:boolean;paidDate?:boolean;serviceSubscriptionDates?:boolean;adminNotes?:boolean};
const preferredServices=["Cross Training","EMS Training","EMS Sculpting","Vacu Power"];
const greekDate=new Intl.DateTimeFormat("el-GR",{timeZone:"Europe/Athens",weekday:"long",day:"numeric",month:"long",year:"numeric"});
const dateParts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit",day:"2-digit"});
const dayKey=(d:string)=>{const p=Object.fromEntries(dateParts.formatToParts(new Date(d)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`};
const statusLabel:Record<string,string>={pending:"Σε αναμονή επιβεβαίωσης",booked:"Επιβεβαιωμένο",completed:"Ολοκληρωμένο · Check-in",no_show:"No-show",late_cancel:"Εκπρόθεσμη ακύρωση",cancelled:"Ακυρωμένο"};

export default function BookingsCalendar({userId,owner,members,onOpenMember,onOpenReports}:{userId:string;owner:boolean;members:Member[];onOpenMember?:(authUserId:string)=>void;onOpenReports?:()=>void}){
  const now=useCalendarClock();
  const {config}=useControlTheme();
  const [launcherSeed,setLauncherSeed]=useState<{service?:string;time?:string}>({});
  const [view,setView]=useState("day"),[launcher,setLauncher]=useState<"book"|"slot"|null>(null);
  const [serviceConfig,setServiceConfig]=useState<{id:string;name:string;duration_minutes:number;color:string;active:boolean;overbooking_enabled:boolean;waiting_list_enabled?:boolean}[]>([]);
  const [trainers,setTrainers]=useState<Trainer[]>([]),[trainerFilter,setTrainerFilter]=useState(""),[moveTrainerId,setMoveTrainerId]=useState("");
  useEffect(()=>{setView(config.defaultView)},[config.defaultView]);
  useEffect(()=>{void api("/rest/v1/services?select=id,name,duration_minutes,color,active,overbooking_enabled,waiting_list_enabled&order=created_at",localStorage.getItem("basement_access_token")||"").then(async r=>{if(r.ok)setServiceConfig(await r.json())})},[]);
  useEffect(()=>{if(!owner)return;void api("/rest/v1/profiles?select=id,full_name&role=eq.trainer&active=eq.true&order=full_name",localStorage.getItem("basement_access_token")||"").then(async r=>{if(r.ok)setTrainers(await r.json())}).catch(()=>{})},[owner]);
  const [focusMode,setFocusMode]=useDisplayPreference("basement_reference_calendar_focus",0,0,1);
  const [batchSlot,setBatchSlot]=useState<Slot|null>(null);
  const [bookingSlot,setBookingSlot]=useState<Slot|null>(null);
  const [focusTools,setFocusTools]=useState(false);
  const [controlsHidden,setControlsHidden]=useDisplayPreference("basement_calendar_controls_hidden",0,0,1);
  const [compactRows,setCompactRows]=useDisplayPreference("basement_reference_compact_rows",1,0,1);
  const [calendarSize,setCalendarSize]=useDisplayPreference("basement_calendar_size",80,70,150);
  const [slots,setSlots]=useState<Slot[]>([]),[bookings,setBookings]=useState<Booking[]>([]),[waiting,setWaiting]=useState<Waiting[]>([]),[packages,setPackages]=useState<MemberPackage[]>([]);
  const [usage,setUsage]=useState<CreditUsage[]>([]),[finances,setFinances]=useState<MemberFinance[]>([]),[billingReady,setBillingReady]=useState(false);
  const [selectedDay,setSelectedDay]=useState(""),[service,setService]=useState("Όλες"),[memberId,setMemberId]=useState(""),[memberSearch,setMemberSearch]=useState(""),[memberSearchOpen,setMemberSearchOpen]=useState(false);
  const [pending,setPending]=useState<number|null>(null),[selectedSlotSnapshot,setSelectedSlot]=useState<Slot|null>(null);
  const [movingBooking,setMovingBooking]=useState<Booking|null>(null),[moveSlotId,setMoveSlotId]=useState("");
  const [noteDraft,setNoteDraft]=useState<Record<number,string>>({}),[acceptedTerms,setAcceptedTerms]=useState(false);
  const [success,setSuccess]=useState(""),[error,setError]=useState(""),[ready,setReady]=useState(false);
  const [settings,setSettings]=useState<CalendarSettings>({showEndTime:true,showAvailableSpots:true,colorPerService:true});
  const token=()=>localStorage.getItem("basement_access_token")||"";
  useEffect(()=>{if(!focusMode)return;const previous=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.body.style.overflow=previous}},[focusMode]);
  const toolsHidden=focusMode?!focusTools:!!controlsHidden;
  const toggleTools=()=>focusMode?setFocusTools(!focusTools):setControlsHidden(controlsHidden?0:1);


  async function paged<T>(path:string){
    const rows:T[]=[];
    for(let offset=0;;offset+=1000){
      const separator=path.includes("?")?"&":"?";
      const response=await api(`${path}${separator}limit=1000&offset=${offset}`,token(),{headers:{Range:`${offset}-${offset+999}`}});
      if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.message||"Δεν φορτώθηκαν τα δεδομένα.")}
      const page:T[]=await response.json();rows.push(...page);if(page.length<1000)return rows;
    }
  }

  const refresh=useCallback(async()=>{
    // V41 performance: render the calendar as soon as slots + current bookings arrive.
    // Billing/CRM metadata is deliberately loaded afterwards and must never block the grid.
    setBillingReady(false);
    try{
      void api("/rest/v1/rpc/basement_expire_waitlist_confirmations",token(),{method:"POST",body:"{}"}).catch(()=>{});
      if(owner)void api("/rest/v1/rpc/basement_auto_complete_due",token(),{method:"POST",body:"{}"}).catch(()=>{});
      const historyStart=new Date();historyStart.setUTCDate(historyStart.getUTCDate()-45);
      const [slotResult,configResult]=await Promise.allSettled([
        paged<Slot>("/rest/v1/rpc/basement_availability"),
        api("/rest/v1/app_settings?key=eq.control_center_settings&select=value",token())
      ]);
      if(slotResult.status!=="fulfilled")throw slotResult.reason;
      setSlots(slotResult.value);setReady(true);setError("");
      if(owner)void paged<{id:number;trainer_id:string|null}>(`/rest/v1/basement_slots?select=id,trainer_id&starts_at=gte.${encodeURIComponent(new Date(Date.now()-730*86400000).toISOString())}`).then(rows=>{const byId=new Map(rows.map(row=>[row.id,row.trainer_id]));setSlots(current=>current.map(slot=>({...slot,trainer_id:byId.get(slot.id)??null}))) }).catch(()=>{});
      if(configResult.status==="fulfilled"){const response=configResult.value as Response;if(response.ok){const rows=await response.json();if(rows[0]?.value)setSettings(rows[0].value)}}

      const bookingResult=await Promise.allSettled([
        paged<Booking>(`/rest/v1/basement_bookings?select=id,slot_id,member_id,status,payment_status,paid_at,credit_policy,moved_at,moved_from_slot_id,notes,checked_in_at,completed_at,position_no,slot:basement_slots!basement_bookings_slot_id_fkey!inner(starts_at)&status=in.(pending,booked,cancelled,late_cancel,completed,no_show)&slot.starts_at=gte.${encodeURIComponent(historyStart.toISOString())}&order=id.asc`),
        owner?paged<Waiting>("/rest/v1/basement_waiting_list?select=id,slot_id,member_id,status,created_at&status=eq.waiting&order=created_at.asc"):Promise.resolve([])
      ]);
      if(bookingResult[0].status==="fulfilled")setBookings(bookingResult[0].value);else setError("Το ημερολόγιο άνοιξε, αλλά οι κρατήσεις δεν ανανεώθηκαν. Πάτησε ανανέωση.");
      if(bookingResult[1].status==="fulfilled")setWaiting(bookingResult[1].value);

      if(owner){
        void Promise.allSettled([
          paged<MemberPackage>("/rest/v1/member_packages?select=id,member_id,starts_on,expires_on,sessions_total,sessions_remaining,status,frozen_until,package_templates(name,package_template_services(services(name)))&status=in.(active,scheduled)&order=expires_on.asc"),
          paged<CreditUsage>(`/rest/v1/basement_session_usage?select=booking_id,member_package_id,change,refunded_at,booking:basement_bookings!inner(slot:basement_slots!inner(starts_at))&booking.slot.starts_at=gte.${encodeURIComponent(historyStart.toISOString())}&order=id.asc`),
          paged<MemberFinance>("/rest/v1/rpc/basement_calendar_member_finances")
        ]).then(([packageResult,usageResult,financeResult])=>{
          if(packageResult.status==="fulfilled")setPackages(packageResult.value);
          if(usageResult.status==="fulfilled")setUsage(usageResult.value);
          if(financeResult.status==="fulfilled")setFinances(financeResult.value);
          setBillingReady([packageResult,usageResult,financeResult].every(r=>r.status==="fulfilled"));
        });
      }else setBillingReady(true);
    }catch(e){
      if(e instanceof SessionExpiredError){
        clearSession();
        const target=encodeURIComponent("calendar");
        window.location.assign(`/login?tab=${target}`);
        return;
      }
      setError(e instanceof Error?e.message:"Δεν φορτώθηκε το ημερολόγιο. Πάτησε ανανέωση.");setReady(true)
    }
  },[owner]);
  useEffect(()=>{void refresh();const changed=()=>void refresh();window.addEventListener("basement-settings-changed",changed);const interval=window.setInterval(()=>void refresh(),180_000);return()=>{window.clearInterval(interval);window.removeEventListener("basement-settings-changed",changed)}},[refresh]);

  const today=dayKey(new Date(now).toISOString());
  const days=useMemo(()=>[...new Set([today,...slots.map(s=>dayKey(s.starts_at))])].sort(),[slots,today]);
  const activeDay=selectedDay||today;
  const serviceNames=useMemo(()=>{const live=[...new Set([...serviceConfig.filter(s=>s.active).map(s=>s.name),...slots.map(s=>s.service)])];return [...preferredServices.filter(s=>live.includes(s)),...live.filter(s=>!preferredServices.includes(s))]},[slots,serviceConfig]);
  const shown=slots.filter(s=>dayKey(s.starts_at)===activeDay&&(service==="Όλες"||s.service===service)&&(!owner||!trainerFilter||s.trainer_id===trainerFilter)&&!(((owner&&settings.hideZeroAdmin)||(!owner&&settings.hideZeroCustomer))&&Number(s.reserved)>=s.capacity));
  const visibleServices=serviceNames.filter(name=>service==="Όλες"||name===service);
  const rowTimes=useMemo(()=>{const offset=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Athens",timeZoneName:"longOffset"}).formatToParts(new Date(activeDay+"T12:00:00Z")).find(p=>p.type==="timeZoneName")?.value.replace("GMT","")||"+02:00";const minutes=(t:string)=>{const [h,m]=t.split(":").map(Number);return h*60+m};const start=minutes(settings.openingTime||"08:00"),end=minutes(settings.closingTime||"22:00"),base:string[]=[];for(let n=start;n<end;n+=Math.max(10,config.step)){base.push(new Date(`${activeDay}T${String(Math.floor(n/60)).padStart(2,"0")}:${String(n%60).padStart(2,"0")}:00${offset}`).toISOString())}return [...new Set([...base,...shown.map(s=>new Date(s.starts_at).toISOString())])].sort()},[activeDay,shown,settings.openingTime,settings.closingTime,config.step]);
  const activeDayIndex=days.indexOf(activeDay),myBookings=bookings.filter(b=>b.member_id===userId&&["pending","booked"].includes(b.status));
  const normalizedSearch=memberSearch.trim().toLocaleLowerCase("el");
  const filteredMembers=members.filter(m=>m.active!==false&&(!normalizedSearch||`${m.full_name||""} ${m.phone||""} ${m.email||""}`.toLocaleLowerCase("el").includes(normalizedSearch))).slice(0,10);
  const selectedMember=members.find(m=>m.id===memberId);
  const packagesFor=(authUserId:string)=>{const member=members.find(m=>m.id===authUserId);return member?.member_record_id?packages.filter(p=>p.member_id===member.member_record_id):[]};
  const packageSummary=(authUserId:string,slot?:Slot,booking?:Booking)=>{
    if(!billingReady)return null;
    const held=booking?usage.find(u=>u.booking_id===booking.id&&!u.refunded_at):null;
    const bound=held?packages.find(p=>p.id===held.member_package_id):null;
    const on=slot?dayKey(slot.starts_at):today;
    const eligible=packagesFor(authUserId).filter(p=>["active","scheduled"].includes(p.status)&&p.starts_on<=on&&p.expires_on>=on&&(!p.frozen_until||p.frozen_until<on)&&(!slot||settings.serviceSubscriptionDates===false||!p.package_templates?.package_template_services.length||p.package_templates.package_template_services.some(link=>link.services?.name.toLowerCase()===slot.service.toLowerCase())));
    const rows=bound?[bound]:eligible,active=rows[0];if(!active)return null;
    const remaining=rows.some(p=>p.sessions_remaining===null)?null:rows.reduce((sum,p)=>sum+Number(p.sessions_remaining||0),0);
    const daysLeft=Math.ceil((new Date(`${active.expires_on}T12:00:00Z`).getTime()-new Date(`${today}T12:00:00Z`).getTime())/86400000);
    return {name:active.package_templates?.name||"Πακέτο",remaining,total:active.sessions_total,expiresOn:active.expires_on,daysLeft,status:active.status,warning:(remaining!==null&&remaining<=config.lowSessions)||daysLeft<=config.expiryDays};
  };
  const formatDate=(value:string)=>new Intl.DateTimeFormat("el-GR",{timeZone:"Europe/Athens",day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(`${value}T12:00:00+03:00`));
  const formatMemberName=(name:string|null|undefined)=>{if(!name)return "Μέλος";const parts=name.trim().split(/\s+/);return settings.lastNameFirst&&parts.length>1?`${parts.at(-1)} ${parts.slice(0,-1).join(" ")}`:name};
  const displayName=(name:string|null|undefined)=>{if(!name)return "Μέλος";const member=members.find(m=>m.full_name===name),summary=member?packageSummary(member.id):null,shownName=formatMemberName(name);return summary?`${shownName} · ${summary.remaining===null?"∞":summary.remaining} συν. · ${formatDate(summary.expiresOn)}`:shownName};
  const trainerName=(id:string|null|undefined)=>trainers.find(t=>t.id===id)?.full_name||"Χωρίς γυμναστή";
  const bookingDetails=(booking:Booking,slot:Slot)=>{
    if(!billingReady)return <small className="calendar-booking-billing">Υπόλοιπα / πληρωμές: αναμονή ανανέωσης</small>;
    const summary=packageSummary(booking.member_id,slot,booking),credit=usage.find(u=>u.booking_id===booking.id),finance=finances.find(f=>f.auth_user_id===booking.member_id);
    return <small className="calendar-booking-billing">{summary&&<><span>{summary.name}: {summary.remaining===null?"∞":summary.remaining} συνεδρίες ακόμη</span><span>Λήξη {formatDate(summary.expiresOn)}</span></>}{settings.fixedPositions&&!settings.hideFixedPositions&&booking.position_no&&<span>Σταθερή θέση: {booking.position_no}</span>}{credit?.refunded_at?<span>✓ Επιστροφή συνεδρίας</span>:!credit&&["pending","booked"].includes(booking.status)?<span className="credit-review">Χωρίς χρεωμένη συνεδρία · Έλεγχος πακέτου</span>:null}{settings.paidDate!==false&&(booking.paid_at?<span>Πληρωμή ραντεβού: {formatDate(dayKey(booking.paid_at))}</span>:finance?.last_payment_on?<span>Τελ. πληρωμή μέλους: {formatDate(finance.last_payment_on)}</span>:<span>Τελ. πληρωμή: δεν έχει καταχωριστεί</span>)}{settings.paidDate!==false&&finance?.next_payment_on&&<span>Επόμενη πληρωμή: {formatDate(finance.next_payment_on)}</span>}</small>;
  };
  const calendarMemberLabel=(booking:Booking,slot:Slot)=>{const member=members.find(m=>m.id===booking.member_id);return <><span className="calendar-booking-name">{formatMemberName(member?.full_name)}</span>{!compactRows&&bookingDetails(booking,slot)}</>};
  const serviceClass=(name:string)=>name.toLocaleLowerCase("en").replace(/[^a-z]+/g,"-").replace(/(^-|-$)/g,"");
  const formatTime=(value:string)=>new Intl.DateTimeFormat("el-GR",{timeZone:"Europe/Athens",hour:"2-digit",minute:"2-digit",hour12:settings.timeFormat==="12 ώρες"}).format(new Date(value));
  const changeDay=(step:number)=>setSelectedDay(shiftDay(activeDay,step));

  // Every entry point uses the same availability rules. The database remains
  // authoritative for capacity, permissions and session deductions.
  const bookingStateFor=(slot:Slot)=>{
    const current=slots.find(item=>item.id===slot.id)||slot;
    const service=serviceConfig.find(item=>item.name===current.service);
    return slotBookingState(current,{
      now,busy:pending!==null,paused:!!settings.pauseBookings,
      canWaitlist:!!settings.waitlistEnabled&&service?.waiting_list_enabled!==false,
      canOverbook:owner&&!!service?.overbooking_enabled,
    });
  };
  function startBooking(slot:Slot){
    const current=slots.find(item=>item.id===slot.id)||slot;
    const state=bookingStateFor(current);
    if(state.disabled){setError(state.description);return}
    setError("");setSuccess("");setSelectedSlot(null);setMovingBooking(null);
    setLauncher(null);setLauncherSeed({});setBookingSlot(current);
  }
  function startAppointment(){
    setError("");setSuccess("");setLauncherSeed({});setLauncher("book");
  }

  async function rpc(path:string,body:Record<string,unknown>){
    const response=await api(`/rest/v1/rpc/${path}`,token(),{method:"POST",body:JSON.stringify(body)});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.message||"Η ενέργεια δεν ολοκληρώθηκε.")}
    return response;
  }
  async function action(slotId:number,bookingId?:number,targetMemberId=memberId){
    setError("");setSuccess("");
    if(!bookingId&&owner&&!targetMemberId){setError("Επίλεξε πρώτα το μέλος για την κράτηση.");return false}
    setPending(slotId);
    if(!bookingId&&!owner&&settings.termsPage&&!acceptedTerms){setError("Πρέπει πρώτα να αποδεχθείς τους όρους κράτησης.");setPending(null);return false}
    const isFull=slots.some(s=>s.id===slotId&&Number(s.reserved)>=s.capacity);
    const explicitOverbook=!bookingId&&owner&&isFull&&serviceConfig.some(s=>s.name===slots.find(x=>x.id===slotId)?.service&&s.overbooking_enabled)&&window.confirm("Η ώρα είναι πλήρης. Να καταχωριστεί επιπλέον θέση ως ιδιοκτήτης;");
    try{const response=await rpc(explicitOverbook?"basement_owner_overbook":bookingId?"basement_cancel":"basement_book",bookingId?{p_booking_id:bookingId}:{p_slot_id:slotId,...(owner&&targetMemberId?{p_member_id:targetMemberId}:{})});const result=bookingId?null:await response.json().catch(()=>null);setSuccess(typeof result==="number"&&result<0?"Το μέλος μπήκε στη λίστα αναμονής.":bookingId?"Η κράτηση ακυρώθηκε και παραμένει στο ιστορικό.":"Η κράτηση καταχωρίστηκε.");await refresh();return true}catch(e){setError(e instanceof Error?e.message:"Δεν ήταν δυνατή η σύνδεση.");return false}finally{setPending(null)}
  }
  async function moveBooking(){
    if(!movingBooking||!moveSlotId)return;setPending(movingBooking.id);setError("");
    try{await rpc("basement_move_booking",{p_booking_id:movingBooking.id,p_new_slot_id:Number(moveSlotId)});setSuccess("Το ραντεβού μεταφέρθηκε και κρατήθηκε στο ιστορικό.");setMovingBooking(null);setMoveSlotId("");setMoveTrainerId("");await refresh()}catch(e){setError(e instanceof Error?e.message:"Η μεταφορά δεν ολοκληρώθηκε.")}finally{setPending(null)}
  }
  async function toggle(slot:Slot){
    setPending(slot.id);setError("");try{const response=await api(`/rest/v1/basement_slots?id=eq.${slot.id}`,token(),{method:"PATCH",body:JSON.stringify({enabled:!slot.enabled,manually_closed:slot.enabled})});if(!response.ok)throw new Error("Δεν αποθηκεύτηκε η αλλαγή διαθεσιμότητας.");await refresh()}catch(e){setError(e instanceof Error?e.message:"Δεν ήταν δυνατή η σύνδεση.")}finally{setPending(null)}
  }
  async function assignTrainer(slot:Slot,trainerId:string){
    setPending(slot.id);setError("");try{const response=await api(`/rest/v1/basement_slots?id=eq.${slot.id}`,token(),{method:"PATCH",body:JSON.stringify({trainer_id:trainerId||null})});if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.message||"Δεν αποθηκεύτηκε ο γυμναστής.")}setSlots(rows=>rows.map(row=>row.id===slot.id?{...row,trainer_id:trainerId||null}:row));setSelectedSlot(current=>current?.id===slot.id?{...current,trainer_id:trainerId||null}:current);setSuccess("Ο γυμναστής της ώρας αποθηκεύτηκε.")}catch(e){setError(e instanceof Error?e.message:"Δεν αποθηκεύτηκε ο γυμναστής.")}finally{setPending(null)}
  }
  async function bookingAction(bookingId:number,bookingAction:"complete"|"no_show"|"undo"|"confirm"|"pending"|"paid"|"unpaid"){
    setPending(bookingId);setError("");try{await rpc("basement_admin_booking_action",{p_booking_id:bookingId,p_action:bookingAction});await refresh()}catch(e){setError(e instanceof Error?e.message:"Η ενέργεια δεν ολοκληρώθηκε.")}finally{setPending(null)}
  }
  async function chargeExisting(id:number){setPending(id);setError("");try{await rpc("basement_charge_existing_booking",{p_booking_id:id});await refresh();setSuccess("Χρεώθηκε μία συνεδρία στο κατάλληλο πακέτο.")}catch(e){setError(e instanceof Error?e.message:"Δεν έγινε η χρέωση.")}finally{setPending(null)}}
  async function saveNote(booking:Booking){
    setPending(booking.id);setError("");try{await rpc("basement_update_booking_notes",{p_booking_id:booking.id,p_notes:noteDraft[booking.id]??booking.notes??""});setSuccess("Η σημείωση αποθηκεύτηκε.");await refresh()}catch(e){setError(e instanceof Error?e.message:"Δεν αποθηκεύτηκε η σημείωση.")}finally{setPending(null)}
  }
  async function waitingAction(id:number,waitingAction:"promote"|"cancel"){
    setPending(id);setError("");try{await rpc("basement_admin_waitlist_action",{p_waiting_id:id,p_action:waitingAction});setSuccess(waitingAction==="promote"?"Το μέλος πέρασε στις κρατήσεις.":"Η αναμονή ακυρώθηκε.");await refresh()}catch(e){setError(e instanceof Error?e.message:"Δεν ολοκληρώθηκε η ενέργεια.")}finally{setPending(null)}
  }

  const selectedSlot=selectedSlotSnapshot?(slots.find(slot=>slot.id===selectedSlotSnapshot.id)||selectedSlotSnapshot):null;
  const selectedBookings=selectedSlot?bookings.filter(b=>b.slot_id===selectedSlot.id):[];
  const selectedCounts=calendarCounts(selectedBookings);
  const selectedWaiting=selectedSlot?waiting.filter(w=>w.slot_id===selectedSlot.id):[];
  const selectedBookingState=selectedSlot?bookingStateFor(selectedSlot):null;
  return <div className={`calendar-page ${settings.customCalendar?"custom-calendar":"simple-calendar"} ${toolsHidden?"calendar-controls-hidden":""} ${focusMode?"calendar-focus":""} ${focusMode&&focusTools?"calendar-focus-tools":""} ${compactRows?"calendar-compact-rows":""}`} style={{"--calendar-scale":calendarSize/100} as CSSProperties}>
    <div className="calendar-view-bar"><button type="button" aria-expanded={!toolsHidden} aria-label={toolsHidden?"Εμφάνιση εργαλείων ημερολογίου":"Απόκρυψη εργαλείων ημερολογίου"} onClick={toggleTools}>{toolsHidden?"▾ Εργαλεία":"▴ Απόκρυψη μπάρας"}</button><span className="calendar-view-context">{activeDay?greekDate.format(new Date(`${activeDay}T12:00:00+03:00`)):"Ημερολόγιο"}{service!=="Όλες"&&<small>{service}</small>}{owner&&selectedMember&&<small>Κράτηση για: {selectedMember.full_name||selectedMember.phone||"Μέλος"}</small>}</span>{owner&&toolsHidden&&<button type="button" className="calendar-new-booking" disabled={pending!==null} onClick={startAppointment}>＋ Κράτηση</button>}<button type="button" aria-pressed={!!compactRows} onClick={()=>setCompactRows(compactRows?0:1)}>{compactRows?"Άνοιγμα όλων":"Κλείσιμο όλων"}</button><button type="button" onClick={()=>{setFocusTools(false);setFocusMode(focusMode?0:1)}}>{focusMode?"Επιστροφή":"⛶ Πλήρης προβολή"}</button></div>
    {owner&&onOpenReports&&<button className="weekly-report-shortcut" onClick={onOpenReports}>Εβδομαδιαία άτομα & προπονήσεις →</button>}
    <div className="calendar-size-controls" role="group" aria-label="Μέγεθος ημερολογίου"><strong>Μέγεθος ημερολογίου</strong><button type="button" aria-label="Μίκρυνση ημερολογίου" disabled={calendarSize<=70} onClick={()=>setCalendarSize(calendarSize-10)}>−</button><output aria-live="polite">{calendarSize}%</output><button type="button" aria-label="Μεγέθυνση ημερολογίου" disabled={calendarSize>=150} onClick={()=>setCalendarSize(calendarSize+10)}>＋</button><button type="button" className="calendar-size-reset" onClick={()=>setCalendarSize(100)}>Επαναφορά</button></div>
    <div className="calendar-toolbar">
      <div className="day-nav"><button aria-label="Προηγούμενη ημέρα" disabled={activeDay<=shiftDay(today,-730)} onClick={()=>changeDay(-1)}>‹</button><label><span>Ημερομηνία</span><input aria-label="Ημερομηνία προβολής" type="date" min={shiftDay(today,-730)} max={shiftDay(today,730)} value={activeDay} onChange={e=>{if(e.target.value)setSelectedDay(e.target.value)}}/></label><button aria-label="Επόμενη ημέρα" disabled={activeDay>=shiftDay(today,730)} onClick={()=>changeDay(1)}>›</button><button type="button" className="calendar-today" onClick={()=>setSelectedDay(dayKey(new Date().toISOString()))}>Σήμερα</button><button onClick={()=>setView(view==="day"?"week":"day")}>{view==="day"?"Εβδομάδα":"Ημέρα"}</button></div>
      <label className="calendar-filter"><span>Φίλτρα</span><select value={service} onChange={e=>setService(e.target.value)}><option>Όλες</option>{serviceNames.map(s=><option key={s}>{s}</option>)}</select></label>
      {owner&&settings.staffScheduleLink&&<label className="calendar-filter"><span>Γυμναστής</span><select value={trainerFilter} onChange={e=>setTrainerFilter(e.target.value)}><option value="">Όλοι</option>{trainers.map(t=><option value={t.id} key={t.id}>{t.full_name||"Γυμναστής"}</option>)}</select></label>}
      <button onClick={()=>setLauncher("slot")}>Άνοιγμα ώρας</button><button type="button" className="new-booking" disabled={pending!==null} onClick={startAppointment}>＋ {owner?"Νέο ραντεβού":"Νέα κράτηση"}</button>
      <button className="refresh-calendar" onClick={()=>void refresh()} disabled={pending!==null}>↻</button>
    </div>
    {!ready&&<p>Φόρτωση προγράμματος…</p>}{error&&<p className="booking-error" role="alert">{error}</p>}{success&&<p className="booking-success" role="status">{success}</p>}
    {ready&&<>{owner&&<div className="calendar-member-picker"><div className="calendar-member-search"><label htmlFor="calendar-member">Κράτηση για μέλος</label><div className="member-search-box"><span aria-hidden="true">⌕</span><input id="calendar-member" value={memberSearch} onFocus={()=>setMemberSearchOpen(true)} onChange={e=>{setMemberSearch(e.target.value);setMemberSearchOpen(true);if(memberId)setMemberId("")}} placeholder="Γράψε όνομα, τηλέφωνο ή email…" autoComplete="off"/>{memberId&&<button type="button" aria-label="Καθαρισμός μέλους" onClick={()=>{setMemberId("");setMemberSearch("");setMemberSearchOpen(true)}}>×</button>}</div>{memberSearchOpen&&!memberId&&<div className="member-search-results">{filteredMembers.length?filteredMembers.map(member=>{const summary=packageSummary(member.id);return <button type="button" key={member.id} onClick={()=>{setMemberId(member.id);setMemberSearch(member.full_name||member.phone||member.email||"");setMemberSearchOpen(false)}}><span><b>{member.full_name||"Μέλος"}</b><small>{member.phone||member.email||"Χωρίς στοιχεία επικοινωνίας"}</small></span><em className={summary?.warning?"warning":""}>{summary?`${summary.remaining===null?"∞":summary.remaining} συνεδρίες · λήξη ${formatDate(summary.expiresOn)}`:"Χωρίς ενεργό πακέτο"}</em></button>}):<p>Δεν βρέθηκε μέλος.</p>}</div>}</div>{selectedMember&&(()=>{const summary=packageSummary(selectedMember.id);return <aside className={`selected-member-summary ${summary?.warning?"warning":""}`}><span><small>ΕΠΙΛΕΓΜΕΝΟ ΜΕΛΟΣ</small><b>{selectedMember.full_name}</b><em>{selectedMember.phone||selectedMember.email||"Χωρίς στοιχεία επικοινωνίας"}</em></span>{summary?<><span><small>ΠΑΚΕΤΟ</small><b>{summary.name}</b><em>{summary.status==="scheduled"?"Προγραμματισμένο":"Ενεργό"}</em></span><span><small>ΥΠΟΛΟΙΠΟ</small><strong>{summary.remaining===null?"∞":summary.remaining}</strong><em>από {summary.total??"∞"} συνεδρίες</em></span><span><small>ΛΗΞΗ</small><b>{formatDate(summary.expiresOn)}</b><em>{summary.daysLeft<0?`Έληξε πριν ${Math.abs(summary.daysLeft)} ημέρες`:summary.daysLeft===0?"Λήγει σήμερα":`Σε ${summary.daysLeft} ημέρες`}</em></span></>:<span className="no-package"><small>ΣΥΝΔΡΟΜΗ</small><b>Χωρίς ενεργό πακέτο</b><em>Η κράτηση μπορεί να περιοριστεί από τις ρυθμίσεις.</em></span>}</aside>})()}</div>}{!owner&&settings.bookingMessages&&<p className="booking-policy">Οι χρόνοι κράτησης, ακύρωσης, μεταφοράς, συνδρομής και αναμονής ελέγχονται αυτόματα.</p>}{!owner&&settings.termsPage&&<label className="booking-terms"><input type="checkbox" checked={acceptedTerms} onChange={e=>setAcceptedTerms(e.target.checked)}/> Αποδέχομαι τους όρους κράτησης και ακύρωσης.</label>}
      {view==="week"?<div className="reference-week-board">{Array.from({length:7},(_,i)=>shiftDay(activeDay,i)).map(day=><section key={day}><h3>{greekDate.format(new Date(day+"T12:00:00Z"))}</h3>{slots.filter(s=>dayKey(s.starts_at)===day&&(service==="Όλες"||s.service===service)).map(slot=><button key={slot.id} onClick={()=>setSelectedSlot(slot)}><b>{formatTime(slot.starts_at)} · {slot.service}</b>{bookings.filter(b=>b.slot_id===slot.id).map(b=><span key={b.id}>{formatMemberName(members.find(m=>m.id===b.member_id)?.full_name)} · {statusLabel[b.status]}</span>)}<span>{slot.reserved}/{slot.capacity} θέσεις</span></button>)}</section>)}</div>:visibleServices.length?<div className="calendar-scroll" tabIndex={0} role="region" aria-label="Πρόγραμμα ραντεβού — κύλιση για ώρες και υπηρεσίες"><div className="calendar-board" style={{"--service-count":visibleServices.length} as CSSProperties}>
        <div className="calendar-head time-head">Ώρα</div>{visibleServices.map(name=>{const serviceSlots=shown.filter(s=>s.service===name),reserved=serviceSlots.reduce((sum,s)=>sum+(owner?calendarCounts(bookings.filter(b=>b.slot_id===s.id)).total:Number(s.reserved)),0),capacity=serviceSlots.reduce((sum,s)=>sum+s.capacity,0);return <div className="calendar-head" key={name}><strong>{name}</strong><small title={owner?"Ενεργές κρατήσεις + check-in / συνολική χωρητικότητα":"Κρατημένες θέσεις / χωρητικότητα"}>{reserved}/{capacity}</small></div>})}
        {rowTimes.flatMap(time=>{const rowSlots=shown.filter(s=>Date.parse(s.starts_at)===Date.parse(time)),rowEnd=rowSlots.length?Math.max(...rowSlots.map(s=>Date.parse(s.ends_at))):Date.parse(time)+config.step*60000,slotAtTime=rowSlots[0],start=formatTime(time),end=slotAtTime?formatTime(slotAtTime.ends_at):"",rowEnded=rowEnd<=now;return [<div className={`calendar-time ${rowEnded?"calendar-time-past":""}`} data-calendar-start={time} data-calendar-end={rowEnd} key={`time-${time}`}><span className="calendar-time-range"><time dateTime={time}>{start}</time>{settings.showEndTime&&end&&<span className="calendar-time-end">– {end}</span>}</span></div>,...visibleServices.map(name=>{const slot=shown.find(s=>Date.parse(s.starts_at)===Date.parse(time)&&s.service===name);if(!slot)return <div className={`calendar-empty ${rowEnded?"calendar-empty-past":""} ${settings.hatchUnavailable?"hatched":""}`} key={`${time}-${name}`}><button className="reference-empty-slot" onClick={()=>{setLauncherSeed({service:name,time:new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Athens",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(time))});setLauncher("slot")}} aria-label={`Άνοιγμα ${name} ${start}`}>＋ Άνοιγμα ώρας</button></div>;const slotBookings=bookings.filter(b=>b.slot_id===slot.id),reserved=slotBookings.filter(b=>["pending","booked"].includes(b.status)),counts=calendarCounts(slotBookings),countDetails=calendarCountDetails(counts),phase=calendarSlotPhase(slot.starts_at,slot.ends_at,now),ended=phase==="past",free=slot.capacity-reserved.length,target=owner?memberId:userId,existing=reserved.find(b=>b.member_id===target),queue=waiting.filter(w=>w.slot_id===slot.id).length,canWaitlist=settings.waitlistEnabled&&slot.enabled&&free<=0,state=!slot.enabled?"closed":free<=0?"full":free<=Math.max(1,Math.floor(slot.capacity/3))?"limited":"available";const bookingState=bookingStateFor(slot);const color=appointmentColor(slotBookings.map(b=>b.status),slot.capacity,slotBookings.some(b=>["pending","booked","completed"].includes(b.status)&&packageSummary(b.member_id,slot,b)?.warning));return <article style={{"--slot-color":config.calendarColorMode==="service"?serviceConfig.find(s=>s.name===slot.service)?.color:config.colors[color]} as CSSProperties} className={`calendar-slot calendar-slot-${phase} ${state} service-${serviceClass(slot.service)} ${settings.colorPerService===false?"single-color":""} ${settings.hatchAvailable&&slot.enabled&&free>0?"hatched":""} ${owner?"clickable":""}`} key={slot.id} data-slot-id={slot.id} role={owner?"button":undefined} tabIndex={owner?0:undefined} onClick={owner?()=>setSelectedSlot(slot):undefined} onKeyDown={owner?e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();setSelectedSlot(slot)}}:undefined}><header>{settings.showServiceName!==false&&<strong>{slot.service}</strong>}<span title={owner?"Ενεργές κρατήσεις + check-in / χωρητικότητα":"Κρατημένες θέσεις / χωρητικότητα"}>♟ {owner?counts.total:Number(slot.reserved)}/{slot.capacity}</span></header>{owner&&settings.staffScheduleNote&&<div className="calendar-slot-trainer">👤 {trainerName(slot.trainer_id)}</div>}{owner&&countDetails&&!compactRows&&<div className="calendar-count-details">{countDetails}</div>}{owner&&<ol>{slotBookings.slice(0,compactRows?2:slotBookings.length).map(b=><li className={`booking-status-${b.status} ${settings.paidColor&&b.payment_status==="paid"?"paid":""} ${settings.customEditedColor&&b.moved_at?"moved":""}`} key={b.id}>{calendarMemberLabel(b,slot)}{!compactRows&&(b.status!=="booked"||b.payment_status==="paid"||b.moved_at)&&<em>{[statusLabel[b.status]||b.status,b.payment_status==="paid"?"Πληρωμένο":"",b.moved_at?"Μεταφέρθηκε":""].filter(Boolean).join(" · ")}</em>}</li>)}{!!compactRows&&slotBookings.length>2&&<li className="calendar-more-members">+{slotBookings.length-2} ακόμη · πάτησε για όλους</li>}</ol>}{settings.showAvailableSpots!==false&&<div className="slot-status">{ended?"Η ώρα πέρασε":!slot.enabled?"Κλειστή ώρα":free>0?`+${free} ${free===1?"θέση":"θέσεις"} διαθέσιμες`:canWaitlist?`Πλήρες · αναμονή ${queue}`:"Πλήρες"}</div>}<div className="slot-actions">{existing&&!owner?<button className="cancel-booking" disabled={pending!==null} onClick={e=>{e.stopPropagation();void action(slot.id,existing.id)}}>Ακύρωση</button>:<button type="button" className="slot-booking-button" disabled={bookingState.disabled} title={bookingState.description} aria-label={`${bookingState.label} · ${slot.service} · ${formatTime(slot.starts_at)}`} onClick={e=>{e.stopPropagation();if(owner)startBooking(slot);else void action(slot.id)}}>{bookingState.label}</button>}{owner&&<button className="slot-toggle" disabled={pending!==null} onClick={e=>{e.stopPropagation();void toggle(slot)}}>{slot.enabled?"Κλείσιμο":"Άνοιγμα"}</button>}</div></article>})]})}
        {activeDay===today&&<CalendarNowLine key={activeDay} now={now} label={formatTime(new Date(now).toISOString())} layoutKey={`${service}|${calendarSize}|${compactRows}|${focusMode}|${rowTimes.join(",")}|${shown.map(s=>s.ends_at).join(",")}`}/>}
      </div></div>:<p>Δεν υπάρχουν ώρες για την επιλεγμένη ημέρα και υπηρεσία.</p>}{!owner&&myBookings.length>0&&<p className="booking-footnote">Έχεις {myBookings.length} ενεργές κρατήσεις.</p>}</>}
    <div className="reference-legend">{([["green","Πλήρες / παρουσίες"],["orange","Έλεγχος συνδρομής"],["red","Απουσία / ακύρωση"],["blue","Διαθέσιμες θέσεις"]] as const).map(([color,label])=><span key={color}><i style={{background:config.colors[color]}}/>{label}</span>)}<b>{bookings.filter(b=>shown.some(s=>s.id===b.slot_id)&&!["cancelled","late_cancel"].includes(b.status)).length} κρατήσεις</b></div>
    {launcher&&<AppointmentLauncher getBookingState={bookingStateFor} seed={launcherSeed} mode={launcher} day={activeDay} slots={slots} services={serviceConfig.filter(s=>s.active)} onChoose={startBooking} onOpened={refresh} onClose={()=>{setLauncher(null);setLauncherSeed({})}}/>}
    {!!focusMode&&<div className="calendar-focus-actions" aria-label="Χειριστήρια πλήρους προβολής"><div className="focus-day-navigation"><button type="button" aria-label="Προηγούμενη ημέρα" disabled={activeDay<=shiftDay(today,-730)} onClick={()=>changeDay(-1)}>‹</button><input aria-label="Ημερομηνία πλήρους προβολής" type="date" min={shiftDay(today,-730)} max={shiftDay(today,730)} value={activeDay} onChange={e=>{if(e.target.value)setSelectedDay(e.target.value)}}/><button type="button" aria-label="Επόμενη ημέρα" disabled={activeDay>=shiftDay(today,730)} onClick={()=>changeDay(1)}>›</button><button type="button" className="calendar-today" onClick={()=>setSelectedDay(dayKey(new Date().toISOString()))}>Σήμερα</button></div>{owner&&<button type="button" className="calendar-new-booking" disabled={pending!==null} onClick={startAppointment}>＋ Κράτηση</button>}<button type="button" aria-expanded={focusTools} onClick={()=>setFocusTools(!focusTools)}>{focusTools?"▴ Κλείσιμο εργαλείων":"⚙ Εργαλεία"}</button><button type="button" onClick={()=>{setFocusMode(0);setFocusTools(false)}}>↩ Μενού</button></div>}
    {owner&&bookingSlot&&<QuickBooking availability={bookingStateFor(bookingSlot).description} title={`${bookingSlot.service} · ${greekDate.format(new Date(bookingSlot.starts_at))} · ${formatTime(bookingSlot.starts_at)}–${formatTime(bookingSlot.ends_at)}`} busy={pending!==null} error={error} members={members.filter(member=>member.active!==false).map(member=>{const summary=packageSummary(member.id,bookingSlot);return {id:member.id,name:formatMemberName(member.full_name),contact:[member.phone,member.email].filter(Boolean).join(" · "),summary:summary?`${summary.remaining===null?"∞":summary.remaining} συνεδρίες · Λήξη ${formatDate(summary.expiresOn)}`:"Χωρίς ενεργό πακέτο",unavailable:bookings.some(booking=>booking.slot_id===bookingSlot.id&&booking.member_id===member.id&&["pending","booked"].includes(booking.status))||waiting.some(entry=>entry.slot_id===bookingSlot.id&&entry.member_id===member.id)}})} onBatch={()=>{setBatchSlot(bookingSlot);setBookingSlot(null)}} onBook={id=>action(bookingSlot.id,undefined,id)} onClose={()=>setBookingSlot(null)}/>}
    {owner&&batchSlot&&<BatchBooking seed={batchSlot} slots={slots} members={members.filter(m=>m.active!==false).map(m=>({id:m.id,name:formatMemberName(m.full_name),contact:[m.phone,m.email].filter(Boolean).join(" · "),packages:packagesFor(m.id).filter(p=>p.status==="active").map(p=>({starts_on:p.starts_on,expires_on:p.expires_on}))}))} bookings={bookings} waiting={waiting} onRefresh={refresh} onClose={()=>setBatchSlot(null)}/>}
    {owner&&selectedSlot&&<div className="appointment-modal-backdrop" onClick={()=>setSelectedSlot(null)}><section className="appointment-modal" role="dialog" aria-modal="true" aria-label="Διαχείριση ραντεβού" onClick={e=>e.stopPropagation()}><button className="appointment-modal-close" onClick={()=>setSelectedSlot(null)} aria-label="Κλείσιμο">×</button><header><small>ΚΑΡΤΕΛΑ ΡΑΝΤΕΒΟΥ</small><h2>{selectedSlot.service}</h2><p>{greekDate.format(new Date(selectedSlot.starts_at))} · {formatTime(selectedSlot.starts_at)}–{formatTime(selectedSlot.ends_at)}</p>{settings.showStaffAsNote&&<p className="appointment-trainer-note">Γυμναστής: <b>{trainerName(selectedSlot.trainer_id)}</b></p>}<strong>{selectedCounts.total}/{selectedSlot.capacity} κρατήσεις & check-in · {selectedWaiting.length} αναμονή</strong><p>{calendarCountDetails(selectedCounts)}</p></header>
      {(settings.showStaffAsNote||settings.staffScheduleLink||settings.staffScheduleNote)&&<label className="appointment-trainer-select"><span>Γυμναστής ώρας</span><select value={selectedSlot.trainer_id||""} disabled={pending!==null} onChange={e=>void assignTrainer(selectedSlot,e.target.value)}><option value="">Χωρίς ανάθεση</option>{trainers.map(t=><option key={t.id} value={t.id}>{t.full_name||"Γυμναστής"}</option>)}</select></label>}
      <div className="appointment-member-list">{selectedBookings.length?selectedBookings.map(booking=>{const member=members.find(m=>m.id===booking.member_id),active=["pending","booked"].includes(booking.status);return <article className={`appointment-member status-${booking.status} ${booking.payment_status==="paid"?"is-paid":""} ${booking.moved_at?"is-moved":""}`} key={booking.id}><div><span className={`appointment-status status-${booking.status}`}>{statusLabel[booking.status]||booking.status}</span><h3>{formatMemberName(member?.full_name)}</h3>{bookingDetails(booking,selectedSlot)}<p>{member?.phone||"Δεν έχει τηλέφωνο"}</p><small>{member?.email||"Δεν έχει email"}</small><small>{booking.payment_status==="paid"?"● Πληρωμένο":"○ Απλήρωτο"}{booking.moved_at?" · Μεταφερμένο":""}</small></div><div className="appointment-member-actions">{member?.phone&&<a href={`tel:${member.phone}`}>☎ Κλήση</a>}{onOpenMember&&<button onClick={()=>onOpenMember(booking.member_id)}>Καρτέλα μέλους</button>}{active?<>{billingReady&&!usage.some(u=>u.booking_id===booking.id&&!u.refunded_at)&&<button disabled={pending!==null} onClick={()=>void chargeExisting(booking.id)}>Χρέωση από πακέτο</button>}{booking.status==="pending"&&<button disabled={pending!==null} onClick={()=>void bookingAction(booking.id,"confirm")}>✓ Επιβεβαίωση</button>}{booking.status==="booked"&&settings.checkIn!==false&&<button disabled={pending!==null} onClick={()=>void bookingAction(booking.id,"complete")}>✓ Check-in</button>}<button className="no-show-action" disabled={pending!==null} onClick={()=>void bookingAction(booking.id,"no_show")}>No-show</button><button disabled={pending!==null} onClick={()=>{setMovingBooking(booking);setMoveSlotId("");setMoveTrainerId("")}}>Μεταφορά</button><button disabled={pending!==null} onClick={()=>void bookingAction(booking.id,booking.payment_status==="paid"?"unpaid":"paid")}>{booking.payment_status==="paid"?"Απλήρωτο":"Πληρωμένο"}</button><button className="cancel-action" disabled={pending!==null} onClick={()=>void action(selectedSlot.id,booking.id)}>Ακύρωση</button></>:<button className="undo-action" disabled={pending!==null} onClick={()=>void bookingAction(booking.id,"undo")}>↶ Αναίρεση</button>}</div>{settings.adminNotes!==false&&<div className="appointment-notes"><textarea value={noteDraft[booking.id]??booking.notes??""} onChange={e=>setNoteDraft(x=>({...x,[booking.id]:e.target.value}))} placeholder="Εσωτερική σημείωση για την κράτηση…"/><button disabled={pending!==null} onClick={()=>void saveNote(booking)}>Αποθήκευση σημείωσης</button></div>}{movingBooking?.id===booking.id&&<div className="appointment-move">{settings.chooseStaffOnMove&&<select value={moveTrainerId} onChange={e=>setMoveTrainerId(e.target.value)}><option value="">Όλοι οι γυμναστές</option>{trainers.map(t=><option key={t.id} value={t.id}>{t.full_name||"Γυμναστής"}</option>)}</select>}<select value={moveSlotId} onChange={e=>setMoveSlotId(e.target.value)}><option value="">Επίλεξε νέα ημέρα και ώρα</option>{slots.filter(s=>s.enabled&&new Date(s.starts_at)>new Date()&&(settings.changeServiceOnMove||s.service===selectedSlot.service)&&s.id!==selectedSlot.id&&Number(s.reserved)<s.capacity&&(!settings.chooseStaffOnMove||!moveTrainerId||s.trainer_id===moveTrainerId)).map(s=><option key={s.id} value={s.id}>{greekDate.format(new Date(s.starts_at))} · {formatTime(s.starts_at)} · {s.service}{settings.chooseStaffOnMove?` · ${trainerName(s.trainer_id)}`:""}</option>)}</select><button disabled={!moveSlotId||pending!==null} onClick={()=>void moveBooking()}>Ολοκλήρωση μεταφοράς</button><button onClick={()=>{setMovingBooking(null);setMoveTrainerId("")}}>Άκυρο</button></div>}</article>}):<p className="appointment-empty">Δεν υπάρχει κράτηση σε αυτή την ώρα.</p>}</div>
      {selectedWaiting.length>0&&<section className="waiting-admin"><h3>Λίστα αναμονής</h3>{selectedWaiting.map((item,index)=>{const member=members.find(m=>m.id===item.member_id);return <div key={item.id}><span><b>{index+1}. {displayName(member?.full_name)}</b><small>{member?.phone||"Χωρίς τηλέφωνο"}</small></span><span><button disabled={pending!==null} onClick={()=>void waitingAction(item.id,"promote")}>Μεταφορά στις κρατήσεις</button><button disabled={pending!==null} onClick={()=>void waitingAction(item.id,"cancel")}>Ακύρωση αναμονής</button></span></div>})}</section>}
      {selectedBookingState&&<div className="appointment-booking-entry"><span>{selectedBookingState.description}</span><button type="button" className="appointment-add-booking" disabled={selectedBookingState.disabled} onClick={()=>startBooking(selectedSlot)}>{selectedBookingState.label}</button></div>}
      <footer><button disabled={pending!==null} onClick={()=>void toggle(selectedSlot)}>{selectedSlot.enabled?"Κλείσιμο ώρας":"Άνοιγμα ώρας"}</button><button onClick={()=>setSelectedSlot(null)}>Κλείσιμο καρτέλας</button></footer></section></div>}
  </div>;
}
