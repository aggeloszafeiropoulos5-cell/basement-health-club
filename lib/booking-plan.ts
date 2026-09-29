import {addDays,athensDate,localTime} from "./weekly-report";
export type PlanSlot={id:number;service:string;starts_at:string;ends_at:string;capacity:number;enabled:boolean;reserved:number};
export type PlanMember={id:string;name:string;contact:string;packages:{starts_on:string;expires_on:string}[]};
export type PlanRow={key:string;day:string;memberId:string;memberName:string;slotId:number|null;issue:string};
export function bookingPlan({seed,slots,members,bookings,waiting,repeat,end,weekdays,now=Date.now()}:{seed:PlanSlot;slots:PlanSlot[];members:PlanMember[];bookings:{slot_id:number;member_id:string;status:string}[];waiting:{slot_id:number;member_id:string}[];repeat:boolean;end:string;weekdays:number[];now?:number}){
  const start=athensDate(seed.starts_at),dates:string[]=[];
  if(repeat){for(let day=start,n=0;day<=end&&n<=365;day=addDays(day,1),n++)if(weekdays.includes(new Date(`${day}T12:00:00Z`).getUTCDay()))dates.push(day)}else dates.push(start);
  const rows:PlanRow[]=[];
  for(const day of dates){
    const candidates=repeat?slots.filter(s=>s.service===seed.service&&athensDate(s.starts_at)===day&&localTime(s.starts_at)===localTime(seed.starts_at)):[seed];
    const slot=candidates.length===1?candidates[0]:undefined;
    let free=slot?Math.max(0,slot.capacity-Number(slot.reserved)):0;
    for(const member of members){
      let issue="";
      if(!slot)issue=candidates.length>1?"Περισσότερες από μία ώρες — επίλεξε από το ημερολόγιο":"Δεν υπάρχει ώρα στο διαθέσιμο πρόγραμμα";
      else if(!slot.enabled)issue="Κλειστή ώρα";
      else if(new Date(slot.starts_at).getTime()<=now)issue="Η ώρα έχει ήδη ξεκινήσει";
      else if(bookings.some(b=>b.slot_id===slot.id&&b.member_id===member.id&&["pending","booked","completed"].includes(b.status)))issue="Υπάρχει ήδη κράτηση";
      else if(waiting.some(w=>w.slot_id===slot.id&&w.member_id===member.id))issue="Υπάρχει ήδη αναμονή";
      else if(repeat&&!member.packages.some(p=>p.starts_on<=day&&p.expires_on>=day))issue="Εκτός διάρκειας ενεργού πακέτου";
      else if(free<=0)issue="Δεν υπάρχει διαθέσιμη θέση";
      if(!issue)free--;
      rows.push({key:`${day}:${member.id}`,day,memberId:member.id,memberName:member.name,slotId:slot?.id??null,issue});
    }
  }
  return rows;
}
export type PlanResult={state:"booked"|"waiting"|"failed"|"unknown";message:string};
export async function submitBookingPlan(rows:PlanRow[],book:(slotId:number,memberId:string)=>Promise<PlanResult>,onResult:(row:PlanRow,result:PlanResult)=>void){
  for(const row of rows){
    if(row.issue||row.slotId===null)continue;
    let result:PlanResult;
    try{result=await book(row.slotId,row.memberId)}catch{result={state:"unknown",message:"Άγνωστο αποτέλεσμα σύνδεσης — έλεγξε το ημερολόγιο πριν ξαναδοκιμάσεις"}}
    onResult(row,result);
    // Never retry a mutation with an ambiguous outcome or proceed after it.
    if(result.state==="unknown")break;
  }
}
