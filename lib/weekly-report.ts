const dateFormat=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit",day:"2-digit"});
export function athensDate(value:string|Date){
  const parts=Object.fromEntries(dateFormat.formatToParts(new Date(value)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function addDays(day:string,amount:number){const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10)}
export function weekStart(day:string){const weekday=new Date(`${day}T12:00:00Z`).getUTCDay();return addDays(day,-((weekday+6)%7))}
export const localTime=(value:string)=>new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Athens",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(value));
export type WeeklyBooking={id:number;member_id:string;status:string;slot:{service:string;starts_at:string}|null};
export function weeklySummary(bookings:ReadonlyArray<WeeklyBooking>,start:string,serviceNames:string[]=[]){
  const end=addDays(start,7),seen=new Set<number>();
  const inWeek=bookings.filter(b=>{if(!b.slot||seen.has(b.id))return false;seen.add(b.id);const day=athensDate(b.slot.starts_at);return day>=start&&day<end});
  const count=(rows:ReadonlyArray<WeeklyBooking>)=>{
    const included=rows.filter(b=>["pending","booked","completed"].includes(b.status));
    const attended=rows.filter(b=>b.status==="completed");
    return {people:new Set(included.map(b=>b.member_id)).size,bookings:included.length,
      attendees:new Set(attended.map(b=>b.member_id)).size,checkins:attended.length,
      active:rows.filter(b=>["booked","pending"].includes(b.status)).length,
      noShow:rows.filter(b=>b.status==="no_show").length,cancelled:rows.filter(b=>["cancelled","late_cancel"].includes(b.status)).length};
  };
  const names=[...new Set([...serviceNames,...inWeek.map(b=>b.slot!.service)])].sort((a,b)=>a.localeCompare(b,"el"));
  return {services:names.map(service=>({service,...count(inWeek.filter(b=>b.slot!.service===service))})),total:count(inWeek)};
}
