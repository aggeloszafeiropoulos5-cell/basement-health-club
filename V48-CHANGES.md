# V48 — Bookup member import

- Added idempotent source identifiers for imported members and packages.
- Preserved the Bookup source email, status, review notes, subscription balance,
  expiry, future-appointment count, total-booking count, out-of-subscription
  value, and payment code.
- Imported 1,122 Bookup member records without modifying the three existing
  member records.
- Created 70 active `Bookup μεταφορά` packages from current source balances.
- Placeholder Bookup addresses are retained only as source metadata and are not
  treated as portal/login emails.

The export contains only the count of future appointments, not their date,
time, or service, so no appointment rows were recreated.
