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
/** The moderation action available for one canonical event row: the canonical
 * id to PATCH and the server-computed capability list. */
export interface CanonicalEventAction {
  /** Canonical event id — the exact id GET /api/events serves for this row. */
  id: string;
  /** Server-computed moderation capabilities; undefined on old responses = []. */
  capabilities: string[];
}
/**
 * Index canonical /api/events rows by EVERY id form a rendered weekly row can
 * carry, so a card can attach the server-computed capability list and know
 * which canonical id to PATCH:
 *  - the canonical id itself (`e.id`) — admin-created runs render as-is;
 *  - the seed id (`e.seedRefId`) — server-materialized seed copies carry a
 *    random canonical id while the client city data still renders the seed id;
 *  - the bare community refId — approved community events render with the
 *    `event:<refId>` canonical copy dropped (deduped) and the `/api/content`
 *    bare refId shown instead.
 * Rows with no server copy get no entry (no menu). Capabilities never default
 * on the client: an absent list stays [] exactly like an empty one.
 */
export function canonicalEventActions(events: readonly (WeekCanonicalSource & { capabilities?: string[] })[]): Map<string, CanonicalEventAction> {
  const map = new Map<string, CanonicalEventAction>();
  for (const e of events) {
    const entry: CanonicalEventAction = { id: e.id, capabilities: e.capabilities ?? [] };
    map.set(e.id, entry);
    if (e.seedRefId) map.set(e.seedRefId, entry);
    if (e.id.startsWith("event:")) map.set(e.id.slice("event:".length), entry);
  }
  return map;
}
/**
 * Detail-page canonical preference: when a canonical registry record exists for
 * the same logical run as a weekly entry (seedRefId match for seed slots, bare
 * refId for community events), overlay the canonical fields onto the entry so
 * the visible card renders the server-authoritative record — the source a
 * successful edit (PUT /api/events/:id) replaces. The entry's own id is kept
 * (the feed/URL already resolve by it); only the displayed fields change, and
 * only from PUBLISHED, visible canonical rows (hidden/archived rows never
 * overlay). Entries with no matching canonical row (seed-only slots,
 * admin-created runs) pass through unchanged. For canonical entries themselves
 * the match is identity, so the overlay is a no-op.
 */
export function preferCanonicalFields<T extends RunEvent>(entry: T, canonical: readonly WeekCanonicalSource[]): T {
  const key = bareEventId(entry.id);
  const rec = canonical.find(
    (c) => c.status === "published" && !c.hidden && !c.archivedAt && (c.seedRefId === key || bareEventId(c.id) === key),
  );
  if (!rec) return entry;
  return {
    ...entry,
    groupId: rec.groupId,
    title: rec.title,
    dayOfWeek: rec.dayOfWeek,
    time: rec.time,
    location: rec.location,
    distanceLabel: rec.distanceLabel,
    invite: rec.invite,
    externalUrl: rec.externalUrl ?? undefined,
  };
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

/** "Aug 4, 2025" label for an ISO submission timestamp, rendered in the viewer's local timezone. */
export function submissionDateLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
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
