export type SignupPackage = {
  id: string;
  name: string;
  sessions_total: number | null;
  validity_days: number;
  price: number | string;
};

export function athensToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
}

// Date-only arithmetic: daylight-saving changes must not shorten a subscription.
export function subscriptionEndDate(startsOn: string, validityDays: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !Number.isInteger(validityDays) || validityDays < 1) return null;
  const date = new Date(`${startsOn}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== startsOn) return null;
  date.setUTCDate(date.getUTCDate() + validityDays - 1);
  if (!Number.isFinite(date.getTime())) return null;
  const result = date.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

export function displaySubscriptionDate(value: string): string {
  return value.split("-").reverse().join("/");
}
