type BookingState = {status:string};

// Attendance is retained after check-in. Cancellations and absences are history,
// not attendance. These display totals do not replace server booking validation.
export function calendarCounts(bookings:ReadonlyArray<BookingState>) {
  let active=0,completed=0,noShow=0,cancelled=0;
  for(const booking of bookings){
    if(booking.status==="pending"||booking.status==="booked")active++;
    else if(booking.status==="completed")completed++;
    else if(booking.status==="no_show")noShow++;
    else if(booking.status==="cancelled"||booking.status==="late_cancel")cancelled++;
  }
  return {active,completed,noShow,cancelled,total:active+completed};
}

export function calendarCountDetails(counts:ReturnType<typeof calendarCounts>) {
  return [
    counts.active>0?`${counts.active} ενεργές`:"",
    counts.completed>0?`${counts.completed} check-in`:"",
    counts.noShow>0?`${counts.noShow} no-show`:"",
    counts.cancelled>0?`${counts.cancelled} ακυρώσεις`:""
  ].filter(Boolean).join(" · ");
}
