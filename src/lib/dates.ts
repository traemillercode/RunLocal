// Date helpers for the "this week" event model. Pure functions — unit tested.
import type { InviteLabel, RunEvent } from "../types";

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

/**
 * Canonical event-id normalization (client twin of the server's `sameEventId`):
 * attendance rows created via the RSVP API store the canonical prefixed id
 * (`event:<id>`), while event records, seed refs, and the weekly feed may use
 * the bare form (`<id>` or a seed ref). All comparisons between the two MUST
 * go through this helper so an RSVP'd canonical run is never mistaken for an
 * un-RSVP'd one after a reload or tab switch. Occurrence identity is
 * unaffected — this is prefix normalization only, never a date/occurrence change.
 */
export function bareEventId(id: string): string {
  return id.replace(/^event:/, "");
}

/** Canonical occurrence id for a resolved event: `event:<id>:<YYYY-MM-DD>`. */
export function occurrenceIdFor(eventId: string, runDate: string): string {
  const canonical = eventId.startsWith("event:") ? eventId : `event:${eventId}`;
  return `${canonical}:${runDate}`;
}

/**
 * Canonical registry record shape consumed by mergeWeekEventSources. Matches
 * the public subset of api.CanonicalEvent returned by /api/events.
 */
export interface WeekCanonicalSource {
  id: string;
  seedRefId: string | null;
  groupId: string;
  title: string;
  dayOfWeek: number;
  time: string;
  location: string;
  distanceLabel: string;
  invite: InviteLabel;
  externalUrl: string | null;
  status: "draft" | "approved" | "published" | "hidden" | "archived";
  hidden: boolean;
  archivedAt: string | null;
}
/**
 * Merge the three weekly run sources — client seed slots, the server canonical
 * registry, and approved recurring community events — so each logical run
 * appears exactly once before date resolution:
 * - canonical seed copies (server-materialized rows carrying a seedRefId) are
 *   dropped when the client seed already carries that slot;
 * - canonical community copies (id "event:<refId>") are dropped when the
 *   approved recurring community event with id "<refId>" is already present.
 * Admin-created canonical runs (no seedRefId, no "event:" prefix) have no
 * duplicate anywhere and are always kept, as are every distinct seed slot
 * (e.g. two different groups on the same weekday). The returned list is ready
 * for resolveWeekEvents, which then filters past occurrences.
 */
export function mergeWeekEventSources(
  seed: RunEvent[],
  canonical: readonly WeekCanonicalSource[],
  recurring: RunEvent[],
): RunEvent[] {
  const seedKeys = new Set(seed.map((e) => `seed:${e.id}`));
  const communityKeys = new Set(recurring.map((e) => `community:${e.id}`));
  const out: RunEvent[] = [...seed];
  for (const e of canonical) {
    if (e.status !== "published" || e.hidden || e.archivedAt) continue;
    if (e.seedRefId && seedKeys.has(`seed:${e.seedRefId}`)) continue;
    const refId = e.id.startsWith("event:") ? e.id.slice("event:".length) : null;
    if (refId && communityKeys.has(`community:${refId}`)) continue;
    out.push({
      id: e.id,
      groupId: e.groupId,
      title: e.title,
      dayOfWeek: e.dayOfWeek,
      time: e.time,
      location: e.location,
      distanceLabel: e.distanceLabel,
      invite: e.invite,
      externalUrl: e.externalUrl ?? undefined,
    });
  }
  out.push(...recurring);
  return out;
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

/**
 * Local wall-clock `YYYY-MM-DD` label for a resolved occurrence date — the same
 * run-date labels the app displays and the server resolves. Unlike
 * `date.toISOString().slice(0, 10)` this never shifts the label into the
 * previous UTC day: for a runner east of UTC a Tuesday run dated the 11th must
 * stay "2026-08-11", or the server rejects the RSVP with
 * "not a scheduled occurrence" (and a month-boundary date like Sep 1 must not
 * become Aug 31).
 */
export function localDateLabel(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
