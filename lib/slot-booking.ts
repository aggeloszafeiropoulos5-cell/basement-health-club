/** Display-only rules. The booking RPC re-checks permissions and capacity.
 * Kept separate so compact cards and the appointment sheet cannot disagree.
 */
export type BookingSlot = {
  starts_at: string;
  ends_at: string;
  capacity: number;
  reserved: number;
  enabled: boolean;
};
export type BookingOptions = {
  now: number;
  busy: boolean;
  paused: boolean;
  canWaitlist: boolean;
  canOverbook: boolean;
};
export type SlotBookingState = {
  disabled: boolean;
  label: string;
  description: string;
  freePlaces: number;
};

export function slotBookingState(slot: BookingSlot, options: BookingOptions): SlotBookingState {
  const freePlaces = Math.max(0, Number(slot.capacity) - Number(slot.reserved));
  const result = (disabled: boolean, label: string, description: string): SlotBookingState => ({
    disabled: disabled || options.busy, label,
    description: options.busy ? "Περίμενε να ολοκληρωθεί η προηγούμενη ενέργεια." : description,
    freePlaces,
  });
  const start = Date.parse(slot.starts_at);
  if (!Number.isFinite(start)) return result(true, "Μη διαθέσιμη ώρα", "Δεν είναι έγκυρη η ώρα έναρξης.");
  if (start <= options.now) return result(true, "Έχει ξεκινήσει", "Δεν γίνεται νέα κράτηση σε ώρα που έχει ήδη ξεκινήσει.");
  if (!slot.enabled) return result(true, "Κλειστή ώρα", "Άνοιξε πρώτα την ώρα από την καρτέλα ραντεβού.");
  if (options.paused) return result(true, "Παύση κρατήσεων", "Οι νέες κρατήσεις είναι σε παύση από τις ρυθμίσεις.");
  if (freePlaces > 0) return result(false, "＋ Κράτηση", `${freePlaces} ${freePlaces === 1 ? "διαθέσιμη θέση" : "διαθέσιμες θέσεις"}`);
  if (options.canWaitlist) return result(false, "＋ Αναμονή", "Πλήρης ώρα · διαθέσιμη λίστα αναμονής.");
  if (options.canOverbook) return result(false, "＋ Επιπλέον θέση", "Πλήρης ώρα · απαιτείται ρητή επιβεβαίωση και δικαίωμα ιδιοκτήτη.");
  return result(true, "Πλήρες", "Δεν υπάρχουν διαθέσιμες θέσεις σε αυτή την ώρα.");
}
