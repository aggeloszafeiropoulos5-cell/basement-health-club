"use client";
import {useEffect, useRef, useState} from "react";
import {calendarNowPosition} from "../../lib/calendar-time";

export function useCalendarClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const resume = () => { if (document.visibilityState === "visible") update(); };
    update();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  return now;
}

export default function CalendarNowLine({now, label, layoutKey}: {now: number; label: string; layoutKey: string}) {
  const marker = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    const board = marker.current?.parentElement;
    if (!board) return;
    const rows = [...board.querySelectorAll<HTMLElement>("[data-calendar-start]")];
    const measure = () => {
      const origin = board.getBoundingClientRect().top + board.clientTop;
      setTop(calendarNowPosition(rows.map(row => {
        const bounds = row.getBoundingClientRect();
        return {startsAt: Date.parse(row.dataset.calendarStart!), endsAt: Number(row.dataset.calendarEnd), top: bounds.top - origin, bottom: bounds.bottom - origin};
      }), now));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(board);
    rows.forEach(row => observer?.observe(row));
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [now, layoutKey]);
  return <div ref={marker} className="calendar-now-line" style={{top: top ?? 0, visibility: top === null ? "hidden" : "visible"}}>
    <span className="calendar-now-label">Τώρα <time dateTime={new Date(now).toISOString()}>{label}</time></span>
  </div>;
}
