"use client";
import {useEffect,useState} from "react";
import {useDisplayPreference} from "../../lib/use-display-preference";
import {useRouter} from "next/navigation";
import Image from "next/image";
import {api} from "../../lib/supabase-rest";
import {clearSession,SessionExpiredError} from "../../lib/session";
import NutritionPanel from "./nutrition-panel";
import WeeklyReport from "./weekly-report";
import BookingsCalendar from "./bookings-calendar";
import MemberPortal from "./member-portal";
import BusinessCenter from "./business-center";
import ReferenceSettings from "./reference-settings";
import ReferenceMembers from "./reference-members";
import ReferenceSessions from "./reference-sessions";
import {ControlTheme,useControlTheme} from "../../lib/control-theme";
import OperationsPanel from "./operations-panel";
import MemberProfilePanel from "./member-profile-panel";
import MemberRecordsPanel from "./member-records-panel";
import UpcomingAppointments from "./upcoming-appointments";
import CreateMemberForm, {CreatedMember} from "./create-member-form";
import NotificationsPanel from "./notifications-panel";
import AppInstall from "../app-install";
import {disableDevicePush,pushOwnerKey} from "../../lib/push-client";

type Profile={id:string;full_name:string|null;role:string;phone?:string|null;email?:string|null;active?:boolean;member_record_id?:string;has_login?:boolean};
const roleLabels:Record<string,string>={owner:"Ιδιοκτήτης",admin:"Διαχειριστής",reception:"Υποδοχή",trainer:"Γυμναστής",customer:"Μέλος"};

export default function DashboardClient(){return <ControlTheme><DashboardBody/></ControlTheme>}
function DashboardBody(){
  const {config}=useControlTheme();
  const router=useRouter();
  const [menuCollapsed,setMenuCollapsed]=useDisplayPreference("basement_menu_collapsed",0,0,1);
  const [profile,setProfile]=useState<Profile|null>(null),[members,setMembers]=useState<Profile[]>([]);
  const [tab,setTab]=useState("calendar"),[notice,setNotice]=useState(""),[memberFocus,setMemberFocus]=useState("");
  const [memberRevision,setMemberRevision]=useState(0);
  const [stats,setStats]=useState({members:"—",bookings:"—",packages:"—",services:"—"});
  const token=()=>localStorage.getItem("basement_access_token")||"";

  useEffect(()=>{void (async()=>{try{
    const target=new URLSearchParams(window.location.search).get("tab");
    if(target&&["calendar","packages","notifications","nutrition"].includes(target))setTab(target);
    if(!token()){logout();return}
    const u=await api("/auth/v1/user",token());
    if(!u.ok){if(u.status===401){logout();return}throw new Error("Δεν ήταν δυνατός ο έλεγχος σύνδεσης. Δοκίμασε ξανά σε λίγο.")}
    const user=await u.json();
    const p=await api(`/rest/v1/profiles?id=eq.${user.id}&select=id,full_name,role`,token());
    if(!p.ok)throw new Error("Δεν ήταν δυνατή η φόρτωση του προφίλ.");
    const rows=await p.json(),me=rows[0];
    if(!me){logout();return}
    setProfile(me);
    if(localStorage.getItem(pushOwnerKey)!==me.id)await disableDevicePush();
    if(["owner","admin","reception"].includes(me.role)){
      type DirectoryMember={id:string;auth_user_id:string|null;full_name:string|null;email:string|null;phone:string|null;active:boolean};
      const memberRows:DirectoryMember[]=[];
      for(let offset=0;;offset+=1000){
        const m=await api(`/rest/v1/members?select=id,auth_user_id,full_name,email,phone,active&order=full_name,id&limit=1000&offset=${offset}`,token());
        if(!m.ok)throw new Error("Δεν ήταν δυνατή η φόρτωση των μελών.");
        const page:DirectoryMember[]=await m.json();memberRows.push(...page);
        if(page.length<1000)break;
      }
      setMembers(memberRows.map(member=>({id:member.auth_user_id||member.id,member_record_id:member.id,has_login:!!member.auth_user_id,full_name:member.full_name,email:member.email,phone:member.phone,active:member.active,role:"customer"})));
    }
    if(me.role==="customer")return;
    const count=async(path:string)=>{const response=await api(path,token(),{method:"HEAD",headers:{Prefer:"count=exact"}});return response.ok?(response.headers.get("content-range")?.split("/")[1]||"0"):"—"};
    const [memberCount,bookingCount,packageCount,serviceCount]=await Promise.all([
      ["owner","admin","reception"].includes(me.role)?count("/rest/v1/members?select=id&active=eq.true"):Promise.resolve("—"),
      count("/rest/v1/basement_bookings?select=id&status=eq.booked"),
      count("/rest/v1/member_packages?select=id&status=eq.active"),
      count("/rest/v1/services?select=id&active=eq.true"),
    ]);
    setStats({members:memberCount,bookings:bookingCount,packages:packageCount,services:serviceCount});
  }catch(error){if(error instanceof SessionExpiredError){logout();return}setNotice(error instanceof Error?error.message:"Δεν ήταν δυνατή η σύνδεση.")}})()},[]);

  function logout(){clearSession();const target=new URLSearchParams(window.location.search).get("tab");router.replace(target&&["calendar","packages","notifications","nutrition"].includes(target)?`/login?tab=${target}`:"/login")}
  async function signOut(){try{await disableDevicePush();logout()}catch(error){setNotice(error instanceof Error?error.message:"Δεν ολοκληρώθηκε η αποσύνδεση.")}}
  function memberCreated(member:CreatedMember){
    setMembers(current=>[...current.filter(item=>item.id!==member.id),{...member,active:true,has_login:true}]);
    setMemberFocus(member.id);setMemberRevision(current=>current+1);
    setStats(current=>({...current,members:current.members==="—"?"—":String(Number(current.members)+1),packages:member.subscription&&current.packages!=="—"?String(Number(current.packages)+1):current.packages}));
    void api(`/rest/v1/members?auth_user_id=eq.${encodeURIComponent(member.id)}&select=id`,token()).then(async response=>{
      if(!response.ok)return;const rows=await response.json();
      if(rows[0]?.id)setMembers(current=>current.map(item=>item.id===member.id?{...item,member_record_id:rows[0].id}:item));
    }).catch(()=>{});
  }

  if(!profile)return <main className="loading-page">{notice?<><p role="alert">{notice}</p><button onClick={()=>window.location.reload()}>Δοκίμασε ξανά</button><button onClick={logout}>Επιστροφή στη σύνδεση</button></>:"Φόρτωση Control Center…"}</main>;
  const customer=profile.role==="customer",owner=["owner","admin"].includes(profile.role),manager=["owner","admin","reception"].includes(profile.role);
  const tabs=[["members","Μέλη"],["calendar","Ημερολόγιο"],["nutrition","Διατροφή"],["sessions","Συνεδρίες"],["packages","Πακέτα & CRM"],["settings","Settings"],["overview","Επισκόπηση"],["weekly","Εβδομαδιαία"],["profile","Πρόοδος"],["operations","Υποδοχή & λειτουργίες"],["notifications","Εφαρμογή & ειδοποιήσεις"]].filter(x=>manager||!["members","operations","weekly","sessions"].includes(x[0])).filter(x=>owner||x[0]!=="settings").filter(x=>owner||customer||x[0]!=="nutrition");

  return <main className="control"><header><div className="brand"><Image src="/basement-logo.jpeg" width={52} height={52} alt="Basement"/><span><b>{config.name}</b><small>{config.subtitle}</small></span></div><span className="reference-top-label">CONTROL CENTER</span><button onClick={()=>void signOut()}>Αποσύνδεση</button></header><div className={`control-body ${menuCollapsed?"menu-collapsed":"menu-expanded"}`}><aside aria-label="Κύριο μενού"><button type="button" className="dashboard-menu-toggle" aria-expanded={!menuCollapsed} aria-controls="dashboard-navigation" aria-label={menuCollapsed?"Άνοιγμα μενού":"Απόκρυψη μενού"} title={menuCollapsed?"Άνοιγμα μενού":"Απόκρυψη μενού"} onClick={()=>setMenuCollapsed(menuCollapsed?0:1)}><span aria-hidden="true">{menuCollapsed?"›":"‹"}</span><span className="dashboard-menu-label">{menuCollapsed?"Μενού":"Απόκρυψη μενού"}</span></button><div id="dashboard-navigation" className="dashboard-navigation" hidden={!!menuCollapsed}>{tabs.map(x=><button key={x[0]} className={tab===x[0]?"active":""} aria-current={tab===x[0]?"page":undefined} onClick={()=>setTab(x[0])}>{customer&&x[0]==="packages"?"Η συνδρομή μου":x[1]}</button>)}</div></aside><section><div className="dashboard-title" hidden={tab!=="overview"}><div><h1>Καλώς ήρθες, {profile.full_name||"μέλος"}</h1><p>{owner?"Owner Dashboard · Basement Health Club":"Member Portal · Προσωπικές κρατήσεις"}</p></div><span>{roleLabels[profile.role]||profile.role}</span></div>
  {notice&&<p className="notice" role="status">{notice}</p>}
  {tab==="nutrition"&&<NutritionPanel owner={owner} userId={profile.id}/> }
  {tab==="weekly"&&manager&&<WeeklyReport/>}
  {tab==="notifications"&&<NotificationsPanel userId={profile.id}/>}
  {customer&&["overview","calendar","packages"].includes(tab)&&<>{tab==="overview"&&<><AppInstall/><button className="notification-shortcut" onClick={()=>setTab("notifications")}>Εφαρμογή & ειδοποιήσεις →</button></>}<MemberPortal mode={tab as "overview"|"calendar"|"packages"} onCalendar={()=>setTab("calendar")}/></>}
  {tab==="overview"&&!customer&&<><AppInstall/><button className="notification-shortcut" onClick={()=>setTab("notifications")}>Εφαρμογή & ειδοποιήσεις →</button><div className="dash-grid"><article><small>Ενεργά μέλη</small><strong>{owner?stats.members:"—"}</strong></article><article><small>Κρατήσεις</small><strong>{stats.bookings}</strong></article><article><small>Ενεργά πακέτα</small><strong>{stats.packages}</strong></article><article><small>Υπηρεσίες</small><strong>{stats.services}</strong></article></div><div className="overview-panels"><article><span className="status-dot">● Η ΣΥΝΔΕΣΗ ΛΕΙΤΟΥΡΓΕΙ</span><h2>Basement Control Center</h2><p>Ο λογαριασμός είναι συνδεδεμένος με τη βάση του Basement. Οι κρατήσεις, τα μέλη και τα πακέτα ενημερώνονται σε πραγματικό χρόνο.</p><button onClick={()=>setTab("calendar")}>Άνοιξε το ημερολόγιο →</button></article><article><span className="kicker">ΓΡΗΓΟΡΕΣ ΕΝΕΡΓΕΙΕΣ</span><h2>{owner?"Διαχείριση επιχείρησης":"Η συνδρομή σου"}</h2><div className="quick-links"><button onClick={()=>setTab("calendar")}>Ημερολόγιο</button>{owner&&<button onClick={()=>setTab("members")}>Νέο μέλος</button>}<button onClick={()=>setTab("packages")}>Πακέτα</button></div></article></div><UpcomingAppointments onOpenMember={id=>{setMemberFocus(id);setTab("members")}}/></>}
  {tab==="calendar"&&!customer&&<BookingsCalendar onOpenReports={()=>setTab("weekly")} userId={profile.id} owner={manager} members={members} onOpenMember={id=>{setMemberFocus(id);setTab("members")}}/>}
  {tab==="members"&&manager&&<ReferenceMembers key={memberRevision} focus={memberFocus} onCreated={memberCreated} onPackages={()=>setTab("packages")} owner={owner}/>}
  {tab==="sessions"&&manager&&<ReferenceSessions owner={owner} onOpenMember={id=>{setMemberFocus(id);setTab("members")}}/>}
  {tab==="packages"&&!customer&&<BusinessCenter owner={owner} userId={profile.id}/>}
  {tab==="operations"&&manager&&<OperationsPanel/>}
  {tab==="profile"&&<MemberProfilePanel userId={profile.id}/>}
  {tab==="settings"&&<ReferenceSettings profile={{full_name:profile.full_name,role:roleLabels[profile.role]||profile.role}}/>}
  </section></div><footer className="reference-footer">{config.name}<span>Μέλη. Συνέπεια. Εξέλιξη.</span></footer></main>;
}
