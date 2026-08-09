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

export function listMyRuns(db: Db, accountId: string, cityId: string, now = new Date()): MyRunRow[] {
  const nowMs = now.getTime();
  const rows: MyRunRow[] = [];
  for (const a of db.listAttendance(accountId).filter((x) => x.role === "rsvp")) {
    // Legacy event-level rows (pre-occurrence): no concrete occurrence. They are
    // historical only — visible exclusively when the runner kept them.
    if (!a.occurrenceId || !a.runDate) {
      rows.push({
        id: a.id, kind: "rsvp", eventId: a.eventId.replace(/^event:/, ""), occurrenceId: null,
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
    const upcoming = Date.parse(occ.startsAt) >= nowMs;
    rows.push({
      id: a.id, kind: "rsvp", eventId: occ.eventId.replace(/^event:/, ""), occurrenceId: occ.occurrenceId,
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
