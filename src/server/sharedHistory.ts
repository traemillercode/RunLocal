import type { Db } from "./store";
import { hiddenFrom } from "./privacy";

/**
 * Who you have run with, and how often.
 *
 * THE MISSING THING. Kimbio stores attendance, group membership, connections
 * and shared run-day history — and renders every one of them as a record rather
 * than as people. Nothing in the product knows you have run with someone
 * before, which is the fact that turns a headcount into a reason to go and a
 * stranger into a not-stranger.
 *
 * It is a query, not a schema. Co-attendance is the intersection of two calls
 * that already exist.
 *
 * THE SAFETY PROPERTY FALLS OUT OF THE DEFINITION, which is worth stating
 * because it is the reason this is safe rather than merely filtered: every
 * occurrence counted is one the VIEWER attended. It is impossible for this to
 * reveal a run the viewer could not otherwise see, because the viewer was
 * standing there. No filter is doing that work — the shape of the question is.
 *
 * On top of that, hiddenFrom is applied so a blocked, deleted or suspended
 * person never surfaces as shared history. Those two together are the whole
 * safety story.
 */

/** Occurrences the viewer attended, as a Set for intersection. */
function occurrencesAttendedBy(db: Db, accountId: string): Set<string> {
  const out = new Set<string>();
  for (const a of db.listAttendance(accountId)) {
    // Legacy rows carry no occurrenceId. Counting them would compare an event
    // to an occurrence and inflate the number.
    if (a.occurrenceId) out.add(a.occurrenceId);
  }
  return out;
}

/**
 * How many distinct occurrences the viewer and this person both attended.
 *
 * Viewer-scoped and never public: it is a fact about a PAIR, and it means
 * nothing without knowing who is asking.
 */
export function coAttendanceCount(db: Db, viewerId: string, otherId: string): number {
  if (viewerId === otherId) return 0;
  const mine = occurrencesAttendedBy(db, viewerId);
  if (mine.size === 0) return 0;
  let shared = 0;
  for (const occ of occurrencesAttendedBy(db, otherId)) {
    if (mine.has(occ)) shared += 1;
  }
  return shared;
}

/**
 * Co-attendance with everyone on one occurrence, in one pass.
 *
 * The per-pair function above is O(attendance) and calling it once per attendee
 * would re-scan the viewer's history for every name on a roster of forty. This
 * builds the viewer's set once — the same reason hiddenFrom is resolved per
 * request rather than per row.
 */
export function coAttendanceForOccurrence(
  db: Db,
  viewerId: string,
  attendeeIds: readonly string[],
): Map<string, number> {
  const mine = occurrencesAttendedBy(db, viewerId);
  const hidden = hiddenFrom(db, viewerId);
  const out = new Map<string, number>();
  for (const id of attendeeIds) {
    if (id === viewerId || hidden.has(id)) continue;
    let shared = 0;
    for (const occ of occurrencesAttendedBy(db, id)) if (mine.has(occ)) shared += 1;
    out.set(id, shared);
  }
  return out;
}

/**
 * Groups both people are active members of.
 *
 * The other half of "not a stranger". Co-membership is weaker evidence than
 * co-attendance — being in a club together is not the same as having run
 * together — so it is reported alongside rather than folded into one number.
 */
export function sharedGroups(db: Db, viewerId: string, otherId: string): { id: string; name: string }[] {
  const mine = new Set(
    db.listMemberships(viewerId).filter((m) => m.status === "active").map((m) => m.groupId),
  );
  if (mine.size === 0) return [];
  const out: { id: string; name: string }[] = [];
  for (const m of db.listMemberships(otherId)) {
    if (m.status !== "active" || !mine.has(m.groupId)) continue;
    const g = db.getGroup(m.groupId);
    if (g) out.push({ id: g.id, name: g.name });
  }
  return out;
}

export interface SharedHistory {
  /** Distinct occurrences both attended. */
  runsTogether: number;
  groups: { id: string; name: string }[];
}

/**
 * The pair fact, for a profile.
 *
 * "You've been at 11 of the same runs" and "Both in Columbia Track Club" is the
 * vetting mechanism women's running communities already use — repeated shared
 * activity — made visible rather than left implicit.
 */
export function sharedHistory(db: Db, viewerId: string, otherId: string): SharedHistory {
  return {
    runsTogether: coAttendanceCount(db, viewerId, otherId),
    groups: sharedGroups(db, viewerId, otherId),
  };
}
