# V43 — SETTINGS COMPLETE

Η V43 συνδέει τις ρυθμίσεις που στη V42 αποθηκεύονταν αλλά δεν επηρέαζαν πλήρως τη λειτουργία.

## Booking / συνδρομές
- Νέα μέλη: `newCustomerBooking`, `skipNewCustomerChecks`, `newCustomerOutsideSubscription`.
- Πακέτα ανά υπηρεσία: `serviceSubscriptionDates`.
- Όρια: `maxBookingsPerPeriod`, `serviceBookingLimits`, `ignoreCancelledInLimit`, `ignoreMovedInLimit`, `cancelMoveLimit`.
- No-show: `noShowLimit`, `noShowUnlockCost`, `subscriptionOnly`, `freeAbsences`.
- GDPR: πραγματική συγκατάθεση μέλους πριν από κράτηση όταν είναι ενεργό το `gdprConsent`.
- Περιορισμοί συγκεκριμένου μέλους/υπηρεσίας/ημέρας/ώρας με `restrictedCustomers`.

## Waiting list
- `overLimitToWaitlist`: κράτηση πάνω από επιτρεπόμενο όριο μπορεί να πάει σε waiting list.
- `waitlistUpdateLink`: δημιουργεί queued notification για αλλαγές waiting list.
- `autoConfirmWaitlist` και `waitlistConfirmationHours`: υποστηρίζεται pending θέση και επιβεβαίωση από Member Portal.
- Καταστάσεις waiting list: waiting / promoted / accepted / expired / cancelled.

## Ημερολόγιο / γυμναστές / θέσεις
- `showStaffAsNote`, `staffScheduleLink`, `staffScheduleNote` χρησιμοποιούν πραγματικό `trainer_id` στο slot.
- `chooseStaffOnMove` φιλτράρει τις ώρες μεταφοράς ανά γυμναστή.
- `fixedPositions` δίνει πραγματικό `position_no` σε ενεργές κρατήσεις.
- `fixedPositionsAffectCapacity` ελέγχει αν επιτρέπεται θέση πέρα από τη δηλωμένη χωρητικότητα σε overbooking flow.
- `hideFixedPositions` κρύβει τη θέση από την προβολή μέλους.
- `dependentAvailability` αποκλείει επικαλυπτόμενη ώρα για το μέλος.
- `paidDate` ελέγχει καταγραφή/εμφάνιση ημερομηνίας πληρωμής.

## Site / CRM / λειτουργίες
- `guestBooking`: δημόσια φόρμα ενδιαφέροντος που δημιουργεί lead στο CRM.
- `businessEmail`, `businessPhone`: χρησιμοποιούνται στη δημόσια σελίδα και στο Member Portal.
- `questionnaires`: πραγματικό ερωτηματολόγιο υγείας/EMS στο Member Portal.
- `incomeTools`: κρύβει/εμφανίζει Ταμείο και Αναφορές στο Operations.

## Βάση δεδομένων
- Νέα πεδία: `basement_slots.trainer_id`, `basement_bookings.position_no`, `basement_bookings.waitlist_source_id`, `basement_waiting_list.reason`.
- Νέοι πίνακες: `member_consents`, `member_no_show_unlocks`, `booking_restrictions`.
- Προστέθηκαν indexes στα νέα foreign keys / φίλτρα.
- Το `basement_availability()` παραμένει μόνο για authenticated χρήστες — το `anon` δεν απέκτησε πρόσβαση.

## Production Supabase
Οι V43 backend migrations εφαρμόστηκαν ήδη στο συνδεδεμένο Supabase project στις 30/09/2026. Το frontend V43 χρειάζεται deployment για να εμφανιστούν όλα τα νέα controls/screens στο live site.
