"use client";
import {FormEvent,useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import Image from "next/image";
import {api} from "../../lib/supabase-rest";
import {clearSession,memberRequest,SessionExpiredError} from "../../lib/session";
import BookingsCalendar from "./bookings-calendar";
import PackagesPanel from "./packages-panel";
import SettingsPanel from "./settings-panel";
import OperationsPanel from "./operations-panel";
import MemberProfilePanel from "./member-profile-panel";

type Profile={id:string;full_name:string|null;role:string};
const roleLabels:Record<string,string>={owner:"Ιδιοκτήτης",admin:"Διαχειριστής",reception:"Υποδοχή",trainer:"Γυμναστής",customer:"Μέλος"};

export default function DashboardClient(){
  const router=useRouter();
  const [profile,setProfile]=useState<Profile|null>(null),[members,setMembers]=useState<Profile[]>([]);
  const [tab,setTab]=useState("overview"),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const [stats,setStats]=useState({members:"—",bookings:"—",packages:"—",services:"—"});
  const token=()=>localStorage.getItem("basement_access_token")||"";

  useEffect(()=>{void (async()=>{try{
    if(!token()){logout();return}
    const u=await api("/auth/v1/user",token());
    if(!u.ok){if(u.status===401){logout();return}throw new Error("Δεν ήταν δυνατός ο έλεγχος σύνδεσης. Δοκίμασε ξανά σε λίγο.")}
    const user=await u.json();
    const p=await api(`/rest/v1/profiles?id=eq.${user.id}&select=id,full_name,role`,token());
    if(!p.ok)throw new Error("Δεν ήταν δυνατή η φόρτωση του προφίλ.");
    const rows=await p.json(),me=rows[0];
    if(!me){logout();return}
    setProfile(me);
    if(["owner","admin"].includes(me.role)){
      const m=await api("/rest/v1/profiles?role=eq.customer&select=id,full_name,role&order=full_name",token());
      if(!m.ok)throw new Error("Δεν ήταν δυνατή η φόρτωση των μελών.");
      setMembers(await m.json());
    }
    const count=async(path:string)=>{const response=await api(path,token(),{method:"HEAD",headers:{Prefer:"count=exact"}});return response.ok?(response.headers.get("content-range")?.split("/")[1]||"0"):"—"};
    const [memberCount,bookingCount,packageCount,serviceCount]=await Promise.all([
      ["owner","admin"].includes(me.role)?count("/rest/v1/members?select=id&active=eq.true"):Promise.resolve("—"),
      count("/rest/v1/basement_bookings?select=id&status=eq.booked"),
      count("/rest/v1/member_packages?select=id&status=eq.active"),
      count("/rest/v1/services?select=id&active=eq.true"),
    ]);
    setStats({members:memberCount,bookings:bookingCount,packages:packageCount,services:serviceCount});
  }catch(error){if(error instanceof SessionExpiredError){logout();return}setNotice(error instanceof Error?error.message:"Δεν ήταν δυνατή η σύνδεση.")}})()},[]);

  function logout(){clearSession();router.replace("/login")}
  async function createMember(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const element=e.currentTarget;setBusy(true);setNotice("");
    try{const form=new FormData(element);const r=await memberRequest({method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(form))});const data=await r.json();setNotice(r.ok?data.warning||"Το μέλος δημιουργήθηκε επιτυχώς.":data.error||"Δεν ολοκληρώθηκε η εγγραφή.");if(r.ok){element.reset();setMembers(x=>[...x,{id:data.id,full_name:data.full_name,role:data.role}])}}
    catch(error){setNotice(error instanceof Error&&!(error instanceof TypeError)?error.message:"Δεν επιβεβαιώθηκε η ενέργεια. Έλεγξε πρώτα τη λίστα μελών πριν επαναλάβεις.")}
    finally{setBusy(false)}
  }

  if(!profile)return <main className="loading-page">{notice?<><p role="alert">{notice}</p><button onClick={()=>window.location.reload()}>Δοκίμασε ξανά</button><button onClick={logout}>Επιστροφή στη σύνδεση</button></>:"Φόρτωση Control Center…"}</main>;
  const owner=["owner","admin"].includes(profile.role);
  const tabs=[["overview","Επισκόπηση"],["calendar","Ημερολόγιο"],["members","Μέλη"],["packages","Πακέτα"],["profile","Πρόοδος"],["operations","Λειτουργίες"],["settings","Ρυθμίσεις"]].filter(x=>owner||!["members","operations"].includes(x[0]));

  return <main className="control"><header><div className="brand"><Image src="/basement-logo.jpeg" width={52} height={52} alt="Basement"/><span><b>BASEMENT</b><small>CONTROL CENTER</small></span></div><button onClick={logout}>Αποσύνδεση</button></header><div className="control-body"><aside aria-label="Κύριο μενού">{tabs.map(x=><button key={x[0]} className={tab===x[0]?"active":""} onClick={()=>setTab(x[0])}>{x[1]}</button>)}</aside><section><div className="dashboard-title"><div><h1>Καλώς ήρθες, {profile.full_name||"μέλος"}</h1><p>{owner?"Owner Dashboard · Basement Health Club":"Member Portal · Προσωπικές κρατήσεις"}</p></div><span>{roleLabels[profile.role]||profile.role}</span></div>
  {tab==="overview"&&<><div className="dash-grid"><article><small>Ενεργά μέλη</small><strong>{owner?stats.members:"—"}</strong></article><article><small>Κρατήσεις</small><strong>{stats.bookings}</strong></article><article><small>Ενεργά πακέτα</small><strong>{stats.packages}</strong></article><article><small>Υπηρεσίες</small><strong>{stats.services}</strong></article></div><div className="overview-panels"><article><span className="status-dot">● Η ΣΥΝΔΕΣΗ ΛΕΙΤΟΥΡΓΕΙ</span><h2>Basement Control Center</h2><p>Ο λογαριασμός είναι συνδεδεμένος με τη βάση του Basement. Οι κρατήσεις, τα μέλη και τα πακέτα ενημερώνονται σε πραγματικό χρόνο.</p><button onClick={()=>setTab("calendar")}>Άνοιξε το ημερολόγιο →</button></article><article><span className="kicker">ΓΡΗΓΟΡΕΣ ΕΝΕΡΓΕΙΕΣ</span><h2>{owner?"Διαχείριση επιχείρησης":"Η συνδρομή σου"}</h2><div className="quick-links"><button onClick={()=>setTab("calendar")}>Ημερολόγιο</button>{owner&&<button onClick={()=>setTab("members")}>Νέο μέλος</button>}<button onClick={()=>setTab("packages")}>Πακέτα</button></div></article></div></>}
  {tab==="calendar"&&<BookingsCalendar userId={profile.id} owner={owner} members={members}/>}
  {tab==="members"&&owner&&<><div className="panel-title"><div><h2>Μέλη</h2><p>Μόνο ο ιδιοκτήτης δημιουργεί νέους λογαριασμούς.</p></div></div><div className="two-col"><form className="admin-form" onSubmit={createMember}><h3>Νέο μέλος</h3><label>Ονοματεπώνυμο<input name="full_name" required/></label><label>Email<input name="email" type="email" required/></label><label>Προσωρινός κωδικός<input name="password" type="password" minLength={8} required/></label><label>Τηλέφωνο<input name="phone" inputMode="tel"/></label><button disabled={busy}>{busy?"Δημιουργία…":"Δημιουργία μέλους"}</button>{notice&&<p className="notice" role="status">{notice}</p>}</form><div className="member-list"><h3>Λίστα μελών</h3>{members.length?members.map(m=><div key={m.id}><b>{m.full_name||"Χωρίς όνομα"}</b><span>● Ενεργό μέλος</span></div>):<p>Δεν υπάρχουν ακόμη μέλη.</p>}</div></div></>}
  {tab==="packages"&&<PackagesPanel owner={owner} userId={profile.id}/>} 
  {tab==="operations"&&owner&&<OperationsPanel/>}
  {tab==="profile"&&<MemberProfilePanel userId={profile.id}/>}
  {tab==="settings"&&<SettingsPanel owner={owner} profile={{full_name:profile.full_name,role:roleLabels[profile.role]||profile.role}}/>}
  </section></div></main>;
}
