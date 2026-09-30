# V41 PERFORMANCE + SETTINGS FIX

- Calendar no longer waits for package, finance and credit metadata before rendering.
- Booking history used by calendar reduced from 24 months to 45 days for the live grid.
- Active/scheduled packages only are loaded for calendar billing badges.
- Heavy billing metadata loads after the calendar is already usable.
- Background refresh reduced from every 60 seconds to every 180 seconds; setting changes still refresh immediately.
- Settings save now reads the value back from Supabase before reporting success.
- Settings changes dispatch an immediate calendar refresh event.
- Per-service settings are read back after save and immediately refresh calendar behavior.
- Existing database-side booking rules, availability, closures, capacities, waiting list and package enforcement remain intact.
