import type { Db } from "./store";

/**
 * What your groups did this week, and what you were part of.
 *
 * Home today is three first-person panels — your next run, your notifications,
 * your training week. That is a dashboard: it tells you about your account and
 * nothing about the community you joined.
 *
 * THE SAFETY QUESTION AND WHY IT DOES NOT ARISE.
 *
 * The obvious way to build this aggregates other people's attendance, and that
 * would be the first thing in the product to do so. It does not, because the
 * two halves come from different places:
 *
 *   "Columbia Track Club ran 4 times this week"  — from the SCHEDULE. These are
 *     occurrences of the group's own events, which are already on the board and
 *     already public. Nobody's attendance is read.
 *
 *   "You were at 2"  — from YOUR attendance, and only yours.
 *
 * So nothing here reads another person's attendance at all. That is a stronger
 * position than filtering one would have been, and it is why this can ship
 * without the treatment blocking needed.
 *
 * A run nobody attended still counts toward the club's number, which is
 * correct: the club held it. The number is about the group's activity, not its
 * popularity — and a "3 of 4 people came" figure would be exactly the
 * attendance-pattern leak the architecture avoids.
 */

export interface ClubWeek {
  groupId: string;
  groupName: string;
  /** Occurrences of this group's events that have already happened this week. */
  runsHeld: number;
  /** How many of those you were at. Yours alone. */
  youWereAt: number;
}

/** Monday 00:00 through now, in the store's clock. */
function weekStart(now: Date): Date {
  const d = new Date(now);
  // getDay(): 0 = Sunday. Monday-start weeks match how a running club talks
  // about "this week" — Sunday long run closes a week rather than opening one.
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * One row per group the viewer is an active member of.
 *
 * Groups with no runs held yet this week are dropped — "Columbia Track Club ran
 * 0 times" on a Monday morning is furniture, and it says nothing about the club.
 */
export function clubWeek(db: Db, accountId: string, now = new Date()): ClubWeek[] {
  const memberships = db.listMemberships(accountId).filter((m) => m.status === "active");
  if (memberships.length === 0) return [];

  const today = isoDate(now);

  /*
   * The viewer's own occurrences, as a Set. Built once rather than per group —
   * the same reason hiddenFrom is resolved per request.
   */
  const mine = new Set<string>();
  for (const a of db.listAttendance(accountId)) if (a.occurrenceId) mine.add(a.occurrenceId);

  const rows: ClubWeek[] = [];
  for (const m of memberships) {
    const group = db.getGroup(m.groupId);
    if (!group) continue;

    /*
     * FROM THE SCHEDULE, NOT FROM ATTENDANCE. My first version derived this by
     * filtering attendance rows — which read other people's attendance, the one
     * thing this was supposed to avoid, AND missed any run nobody attended. The
     * comment above claimed a property the code did not have.
     *
     * A group's events carry a dayOfWeek. The occurrences it held this week are
     * therefore the dates in this week matching each event's day, up to today.
     * No attendance is read to compute it.
     */
    const occurrences = new Set<string>();
    for (const ev of db.listEvents()) {
      if (ev.groupId !== m.groupId) continue;
      for (let d = new Date(weekStart(now)); isoDate(d) <= today; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== ev.dayOfWeek) continue;
        // Canonical occurrence id, matching what attendance rows store.
        occurrences.add(`${ev.id}:${isoDate(d)}`);
      }
    }
    if (occurrences.size === 0) continue;

    /*
     * The only attendance read anywhere in this function, and it is the
     * viewer's own — built once, above.
     */
    let youWereAt = 0;
    for (const occ of occurrences) if (mine.has(occ)) youWereAt += 1;

    rows.push({ groupId: group.id, groupName: group.name, runsHeld: occurrences.size, youWereAt });
  }

  // Most active club first — if someone is in three, the one that ran most is
  // the one they are most likely to be reading about.
  return rows.sort((a, b) => b.runsHeld - a.runsHeld || a.groupName.localeCompare(b.groupName));
}
