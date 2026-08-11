import type { MyRunView } from "./api";
import { bareEventId } from "./dates";

/**
 * The set of event ids the caller has RSVP'd to (any occurrence), normalized
 * to the bare (prefix-stripped) form so the weekly feed can compare against
 * seed ids, canonical ids, and community ref ids uniformly. This is what keeps
 * "Add to My Runs" state authoritative across tab switches and reloads: the
 * server is the source of truth, and the id comparison can no longer miss a
 * canonical `event:<id>` row after a refetch.
 */
export function rsvpedEventIds(runs: MyRunView[]): Set<string> {
  return new Set(runs.map((run) => bareEventId(run.eventId)));
}

/**
 * Whether the caller has RSVP'd the EXACT occurrence of an event. Ids are
 * compared in normalized (bare) form; the occurrence id is compared verbatim
 * (`event:<id>:<YYYY-MM-DD>`) so a sibling occurrence never counts.
 */
export function isOccurrenceRsvped(runs: MyRunView[], eventId: string, occurrenceId: string): boolean {
  return runs.some((run) => run.occurrenceId !== undefined && run.occurrenceId !== null && bareEventId(run.eventId) === bareEventId(eventId) && run.occurrenceId === occurrenceId);
}

export function runStartMs(run: Pick<MyRunView, "date" | "time">): number {
  const match = run.time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return Date.parse(`${run.date}T23:59:59`);
  let hour = Number(match[1]);
  if (match[3].toUpperCase() === "PM" && hour < 12) hour += 12;
  if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;
  return Date.parse(`${run.date}T${String(hour).padStart(2, "0")}:${match[2]}:00`);
}

export function orderMyRuns(runs: MyRunView[], now = Date.now()): { upcoming: MyRunView[]; past: MyRunView[] } {
  const sorted = [...runs].sort((a, b) => runStartMs(a) - runStartMs(b) || a.eventId.localeCompare(b.eventId) || a.id.localeCompare(b.id));
  return { upcoming: sorted.filter((run) => runStartMs(run) >= now), past: sorted.filter((run) => runStartMs(run) < now).reverse() };
}

export function formatRunDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** `YYYY-MM` month key for a `YYYY-MM-DD` run date (UTC, timezone-safe). */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** Human month label for a `YYYY-MM` key, e.g. "August 2026" (UTC). */
export function monthLabel(key: string): string {
  return new Date(`${key}-01T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Group past runs by month, newest month first; runs within a month are
 * ordered newest first (the past list is already reverse-chronological). */
export function groupRunsByMonth(runs: MyRunView[]): Array<{ key: string; label: string; runs: MyRunView[] }> {
  const groups = new Map<string, MyRunView[]>();
  for (const run of runs) {
    const key = monthKey(run.date);
    const bucket = groups.get(key) ?? [];
    bucket.push(run);
    groups.set(key, bucket);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, bucket]) => ({ key, label: monthLabel(key), runs: bucket }));
}
