import type { Db } from "./store";
import { resolveOccurrence } from "./occurrences";

/**
 * My Runs — the runner's own private list. Server-authoritative: every row is
 * resolved from the session's account, never from client-supplied identity.
 *
 * Two row kinds share one list:
 *  - `rsvp` — attendance rows the runner RSVP'd to (occurrence-exact: one row
 *    per concrete `event:<id>:<YYYY-MM-DD>` occurrence, with the attendance id
 *    preserved so removal/keep targets the exact row).
 *  - `solo` — the runner's own private personal runs (nothing shared; the
 *    record stays private to the account).
 *
 * Past visibility rule (exact): a PAST row appears only when the runner
 * checked in to that occurrence (`checkedIn`) or explicitly kept it
 * ("Keep on My Runs" — `kept`). Kept history is indefinite; nothing prunes a
 * kept row. Upcoming rows are always visible, exactly as before.
 */

/** Deterministic h:mm AM/PM label (UTC) derived from an ISO start time. */
export function isoTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Time unavailable";
  let h = d.getUTCHours();
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(d.getUTCMinutes()).padStart(2, "0")} ${suffix}`;
}

/**
 * Display-space occurrence id for the public API. Seed events (which the
 * weekly feed renders under their seed ref, e.g. `mon-social`) surface
 * `event:<seedRefId>:<YYYY-MM-DD>` so My Runs links, discussion links, and
 * RSVP responses all match the ids runners see in the feed — the client never
 * has to guess between a seed ref and the server's canonical hex id. Everything
 * else keeps its canonical `event:<id>:<YYYY-MM-DD>` form. The internal
 * attendance rows are untouched (always canonical); this is a presentation
 * mapping only, applied at the API boundary.
 */
export function publicOccurrenceId(event: { seedRefId: string | null }, eventId: string, runDate: string): string {
  const canonical = event.seedRefId ? `event:${event.seedRefId}` : eventId.startsWith("event:") ? eventId : `event:${eventId}`;
  return `${canonical}:${runDate}`;
}

export interface MyRunRow {
  id: string;
  kind: "rsvp" | "solo";
  eventId: string;
  occurrenceId: string | null;
  runDate: string;
  startsAt: string | null;
  cityId: string;
  title: string;
  date: string;
  time: string;
  location: string;
  groupId: string;
  rsvpedAt: string;
  distanceLabel: string | null;
  upcoming: boolean;
  past: boolean;
  kept: boolean;
  checkedIn: boolean;
}

/**
 * The browser's `getTimezoneOffset()` minutes for the caller, clamped to the
 * real-world range (±14 hours) and never NaN — 0 when absent/invalid. Run start
 * times are stored as UTC-encoded wall-clock labels (see ical.ts), so the
 * caller's offset is what restores a label like "6:00 PM" to the real instant
 * a runner sees; without it, an occurrence dated today is classified past from
 * the UTC-encoded time instead of the local time the feed displays.
 */
export function parseTzOffsetMinutes(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-840, Math.min(840, Math.round(n)));
}

export function listMyRuns(db: Db, accountId: string, cityId: string, now = new Date(), tzOffsetMinutes = 0): MyRunRow[] {
  const nowMs = now.getTime();
  const rows: MyRunRow[] = [];
  for (const a of db.listAttendance(accountId).filter((x) => x.role === "rsvp")) {
    // Legacy event-level rows (pre-occurrence): no concrete occurrence. They are
    // historical only — visible exclusively when the runner kept them.
    if (!a.occurrenceId || !a.runDate) {
      const legacyBare = a.eventId.replace(/^event:/, "");
      const legacyEvent = db.listEvents().find((e) => e.id === legacyBare || e.seedRefId === legacyBare);
      rows.push({
        id: a.id, kind: "rsvp", eventId: legacyEvent?.seedRefId ?? legacyBare, occurrenceId: null,
        runDate: a.createdAt.slice(0, 10), startsAt: null, cityId,
        title: "Past run RSVP", date: a.createdAt.slice(0, 10), time: "Time unavailable",
        location: "Location unavailable", groupId: "", rsvpedAt: a.createdAt,
        distanceLabel: null, upcoming: false, past: true, kept: a.kept === true, checkedIn: false,
      });
      continue;
    }
    const occ = resolveOccurrence(db, a.eventId, a.runDate);
    if (!occ || !occ.event) continue;
    const ev = occ.event;
    // Upcoming/past uses the caller's local frame, matching the feed's
    // client-side "has this run started" check and the My Runs client ordering.
    // `startsAt` is a wall-clock label encoded in a UTC field ("6:00 PM" for
    // Columbia is stored as 18:00Z but means 6:00 PM local): the caller's
    // browser offset restores the real instant. Without this, a run dated the
    // 11th that the feed still shows as upcoming (before 6:00 PM local) was
    // classified PAST at 18:00Z and vanished from My Runs immediately after an
    // otherwise-successful same-day RSVP — the owner's "Add to My Runs fails
    // for the run dated the 11th" report. Solo runs store real instants and
    // are compared directly below; legacy rows stay historical.
    const upcoming = Date.parse(occ.startsAt) + tzOffsetMinutes * 60_000 >= nowMs;
    // Display-space ids: seed events surface their seed ref (what the weekly
    // feed renders), so My Runs links and the feed/detail RSVP state agree
    // after any reload or tab switch. The occurrence stays exact — one row
    // per concrete `event:<seedRef>:<YYYY-MM-DD>` (or canonical form for
    // community/admin runs); a sibling occurrence never counts.
    const displayEventId = ev.seedRefId ?? occ.eventId.replace(/^event:/, "");
    const displayOccurrenceId = ev.seedRefId ? `event:${ev.seedRefId}:${occ.runDate}` : occ.occurrenceId;
    rows.push({
      id: a.id, kind: "rsvp", eventId: displayEventId, occurrenceId: displayOccurrenceId,
      runDate: occ.runDate, startsAt: occ.startsAt, cityId: ev.cityId, title: ev.title,
      date: occ.runDate, time: ev.time, location: ev.location, groupId: ev.groupId,
      rsvpedAt: a.createdAt, distanceLabel: ev.distanceLabel ?? null, upcoming, past: !upcoming,
      kept: a.kept === true,
      // Check-in is bound to the exact occurrence (leader/QR); a sibling
      // occurrence of the same event never counts.
      checkedIn: a.occurrenceId ? db.getCheckin(a.occurrenceId, accountId) !== undefined : false,
    });
  }
  for (const r of db.listPersonalRuns(accountId).filter((x) => !x.deletedAt)) {
    const upcoming = Date.parse(r.startsAt) >= nowMs;
    rows.push({
      id: r.id, kind: "solo", eventId: "", occurrenceId: null, runDate: r.startsAt.slice(0, 10),
      startsAt: r.startsAt, cityId: r.cityId, title: r.title, date: r.startsAt.slice(0, 10),
      time: isoTimeLabel(r.startsAt), location: r.locationLabel ?? "", groupId: "",
      rsvpedAt: r.createdAt, distanceLabel: r.distanceLabel, upcoming, past: !upcoming,
      kept: r.kept === true, checkedIn: false,
    });
  }
  return rows
    .filter((r) => !r.past || r.checkedIn || r.kept)
    .sort((a, b) => (a.startsAt ?? `${a.runDate}T00:00:00Z`).localeCompare(b.startsAt ?? `${b.runDate}T00:00:00Z`) || a.eventId.localeCompare(b.eventId) || a.id.localeCompare(b.id));
}

/**
 * Opt-in "Keep on My Runs" toggle. Resolves the row from the caller's OWN
 * records only — an RSVP attendance row or a solo (personal) run — and never
 * touches another caller's row. Returns null when the caller owns no such row
 * (404 — existence is not leaked). The `kept` flag persists server-side and
 * survives re-login and server reload (it lives on the row itself).
 */
export function setMyRunKept(db: Db, accountId: string, runId: string, kept: boolean, now = new Date()): { kept: boolean } | null {
  const attendance = db.listAttendance(accountId).find((a) => a.id === runId && a.role === "rsvp");
  if (attendance) {
    db.updateAttendance(attendance.id, { kept });
    return { kept };
  }
  const run = db.listPersonalRuns(accountId).find((r) => r.id === runId && !r.deletedAt);
  if (run) {
    db.updatePersonalRun(run.id, { kept, updatedAt: now.toISOString() });
    return { kept };
  }
  return null;
}
