// Date helpers for the "this week" event model. Pure functions — unit tested.
import type { RunEvent } from "../types";

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_ABBREV = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Monday 00:00 of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7; // Mon = 0
  d.setDate(d.getDate() - dow);
  return d;
}

/** Date of `dayOfWeek` (Mon=0) within the week containing `date`. */
export function dateForWeekday(dayOfWeek: number, date: Date): Date {
  const start = startOfWeek(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + dayOfWeek);
}

/** "Aug 4 – Aug 10" style label for the week starting at `start`. */
export function weekRangeLabel(start: Date): string {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const s = `${MONTHS[start.getMonth()]} ${start.getDate()}`;
  const e = start.getMonth() === end.getMonth() ? `${end.getDate()}` : `${MONTHS[end.getMonth()]} ${end.getDate()}`;
  return `${s} – ${e}`;
}

export interface DatedRunEvent extends RunEvent {
  /** Resolved date within the current week. */
  date: Date;
  /** True when the run falls on today's date. */
  isToday: boolean;
  /** "Mon", "Tue", … */
  dayAbbrev: string;
}

/** Resolve recurring weekly events to concrete dates and sort chronologically. */
export function resolveWeekEvents(events: RunEvent[], now: Date): DatedRunEvent[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return events
    .map((e) => {
      const date = dateForWeekday(e.dayOfWeek, now);
      return {
        ...e,
        date,
        isToday: date.getTime() === today,
        dayAbbrev: DAY_ABBREV[e.dayOfWeek],
      };
    })
    .sort((a, b) => {
      if (a.date.getTime() !== b.date.getTime()) return a.date.getTime() - b.date.getTime();
      return a.time.localeCompare(b.time);
    });
}

/** "Today", "Tomorrow", "Wed", or "Aug 7" style label for a resolved date. */
export function dayLabel(date: Date, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff >= 2 && diff <= 6) {
    const dow = (date.getDay() + 6) % 7; // convert Sunday-first getDay() → Monday-first
    return DAY_NAMES[dow];
  }
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** "Aug 4" style label for an event date. */
export function monthDayLabel(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** Parse "yyyy-mm-dd" → "Sat, Oct 4". */
export function formatRaceDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dow = (date.getDay() + 6) % 7; // Monday-first index
  return `${DAY_ABBREV[dow]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${y}`;
}

/** Whether a resolved occurrence has started, including time on today's date. */
export function occurrenceHasStarted(event: Pick<DatedRunEvent, "date" | "time">, now = new Date()): boolean {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (event.date.getTime() < day.getTime()) return true;
  if (event.date.getTime() > day.getTime()) return false;
  const match = event.time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return false;
  let hour = Number(match[1]);
  if (match[3].toUpperCase() === "PM" && hour < 12) hour += 12;
  if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, Number(match[2])).getTime() <= now.getTime();
}
