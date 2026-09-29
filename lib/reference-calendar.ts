export function appointmentColor(statuses:string[],capacity:number,warning:boolean){
 const active=statuses.filter(s=>["booked","pending","completed"].includes(s));
 if(statuses.includes("no_show")||(statuses.length>0&&!active.length))return "red";
 if(warning)return "orange";
 if(active.length>=capacity||(active.length>0&&active.every(s=>s==="completed")))return "green";
 return "blue";
}
export function shiftDay(day:string,step:number){const d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+step);return d.toISOString().slice(0,10)}
export function athensDay(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
