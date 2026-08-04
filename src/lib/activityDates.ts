import type { PublicUserEvent } from "./api";

/** Parse an ISO calendar date as a local calendar date (not UTC). */
export function localDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dayStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Calendar-date filter shared by public current and past activity views. */
export function isPastCalendarDate(iso: string, now = new Date()): boolean {
  return localDate(iso).getTime() < dayStart(now).getTime();
}

export function filterOneTimeEvents(events: PublicUserEvent[], mode: "upcoming" | "past", now = new Date()): PublicUserEvent[] {
  return events.filter((event) => {
    if (event.type !== "one_time" || !event.date) return false;
    return isPastCalendarDate(event.date, now) === (mode === "past");
  });
}
