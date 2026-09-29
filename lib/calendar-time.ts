export type TimelineRow = { startsAt: number; endsAt: number; top: number; bottom: number };

// Rows have different heights and can contain services of different durations.
// Interpolate within the actual rendered row, stopping at the boundary during breaks.
export function calendarNowPosition(rows: TimelineRow[], now: number): number | null {
  if (!rows.length || !Number.isFinite(now)) return null;
  const end = Math.max(...rows.map(row => row.endsAt));
  if (now < rows[0].startsAt || now >= end) return null;
  const index = rows.findIndex((row, i) => row.startsAt <= now && (!rows[i + 1] || now < rows[i + 1].startsAt));
  if (index < 0) return null;
  const row = rows[index], next = rows[index + 1];
  const segmentEnd = next ? Math.min(next.startsAt, row.endsAt) : end;
  const duration = segmentEnd - row.startsAt;
  const progress = duration > 0 ? Math.min(1, Math.max(0, (now - row.startsAt) / duration)) : 1;
  return row.top + progress * (row.bottom - row.top);
}

export function calendarSlotPhase(startsAt: string, endsAt: string, now: number): "past" | "current" | "future" {
  if (Date.parse(endsAt) <= now) return "past";
  return Date.parse(startsAt) <= now ? "current" : "future";
}
