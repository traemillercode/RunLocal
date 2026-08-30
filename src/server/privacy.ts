/**
 * canView — THE single visibility gate for the whole system.
 *
 * Every visibility decision in the product (part B endpoints, and beyond) MUST
 * call this function; there are no ad-hoc checks anywhere. It is pure against
 * the store (no HTTP, no client state) so it is unit-testable and safe to call
 * from any server layer.
 *
 * Semantics, in order (owner-locked design):
 *   1. Blocked beats everything — if either user has blocked the other
 *      (`db.isBlocked`, bidirectional) → false, even for accepted connections.
 *   2. Self always passes — viewerId === ownerId → true (blocking between
 *      self and self is impossible anyway).
 *   3. Event-level override first — for event-related fields
 *      (`show_upcoming_events`), when an event/occurrence context is provided,
 *      the OWNER's attendance record for that event is consulted; a
 *      `visibilityOverride` other than "inherit" REPLACES the global setting.
 *      Only "inherit" falls through to the global value.
 *   4. Resolve the setting: "public" → true; "private" → false;
 *      "connections_only" → true iff an ACCEPTED connection row exists between
 *      the pair (either direction).
 *
 * Guests (viewerId === null) pass ONLY "public" — connections_only/private
 * never pass for a guest, and self/blocked checks are skipped (a guest cannot
 * be blocked or be the owner).
 *
 * Guard: `show_saved_events` can never resolve to "public" (owner rule) — a
 * stored value that somehow reads "public" is clamped to false here, on top of
 * the write-side validation in `store.setPrivacy`.
 */
import type { Db } from "./store";
import type { AttendanceVisibility, ContentVisibility, PrivacySettingsRecord, SavedEventsVisibility, ProfileVisibility } from "./types";

export { PRIVACY_DEFAULTS } from "./types";
export type { PrivacySettingsRecord } from "./types";

/** The visibility fields canView decides (searchable_by_name is a search-index filter, not a canView field). */
export type PrivacyField =
  | "profile_visibility"
  | "show_upcoming_events"
  | "show_saved_events"
  | "show_past_activity"
  | "show_connections_list"
  | "show_tagged_content";

/** What a privacy field can resolve to. */
export type PrivacyResolution = "public" | "connections_only" | "private";

export interface CanViewOpts {
  /** Event context — when provided, the owner's event-level override applies (event-related fields only). */
  eventId?: string;
  /** Occurrence context — refines the event-level override to the exact occurrence. */
  occurrenceId?: string;
}

function resolveFieldSetting(db: Db, ownerId: string, field: PrivacyField, opts: CanViewOpts): PrivacyResolution {
  // Event-level override first (event-related fields only): the OWNER's
  // attendance record for this event/occurrence replaces the global setting
  // unless it is "inherit".
  if (field === "show_upcoming_events" && (opts.eventId || opts.occurrenceId)) {
    const override: AttendanceVisibility = db.getAttendanceVisibilityOverride(ownerId, opts.eventId ?? "", opts.occurrenceId);
    if (override !== "inherit") return override;
  }
  const record: PrivacySettingsRecord = db.getPrivacy(ownerId);
  const value = record[field];
  return normalizeResolution(field, value);
}

/** Clamp a stored value to the safe resolution space (never "public" for show_saved_events). */
function normalizeResolution(field: PrivacyField, value: unknown): PrivacyResolution {
  if (field === "show_saved_events") {
    // Owner rule: saved events can never be public. A stored "public" (only
    // possible via a corrupt/legacy record — setPrivacy rejects it) is clamped
    // to "private".
    return value === "private" ? "private" : "connections_only" === value ? "connections_only" : "private";
  }
  if (value === "public" || value === "private") return value;
  return "connections_only";
}

/**
 * THE single visibility gate. Signature per owner design; pure against the db.
 *
 * @param db        the store
 * @param viewerId  the viewing account id, or null for a guest
 * @param ownerId   the account whose content is being viewed
 * @param field     which privacy field governs this content
 * @param opts      optional event/occurrence context for event-related fields
 */
export function canView(db: Db, viewerId: string | null, ownerId: string, field: PrivacyField, opts: CanViewOpts = {}): boolean {
  // 1. Blocked beats everything (bidirectional). Guests can't be blocked.
  if (viewerId !== null && db.isBlocked(viewerId, ownerId)) return false;
  // 2. Self always passes (blocked between self and self is impossible).
  if (viewerId === ownerId) return true;

  // 3+4. Event override first, then public/private/connections_only.
  const resolved = resolveFieldSetting(db, ownerId, field, opts);
  if (resolved === "public") return true;
  if (resolved === "private") return false;
  // connections_only — guests never pass; otherwise an accepted row in EITHER
  // direction (the store keys by sorted pair, so direction is irrelevant).
  if (viewerId === null) return false;
  return db.getConnectionPair(viewerId, ownerId)?.status === "accepted";
}

// Re-export the value unions so callers can type privacy payloads without
// importing types.ts directly.
export type { AttendanceVisibility, ContentVisibility, ProfileVisibility, SavedEventsVisibility };

/* ── The hidden set ───────────────────────────────────────────────────────── */

/**
 * Every account that must not appear to this viewer, as one set.
 *
 * THE POINT IS THE UNION. Blocked, deleted and suspended collapse into a single
 * answer, so "she blocked him" is indistinguishable from "she deleted her
 * account" and from "she was removed" BY CONSTRUCTION — not by remembering to
 * return matching error strings at each of the sites that could tell them
 * apart. Six such sites had drifted apart before this existed.
 *
 * Resolved once per request and passed down, rather than recomputed per row: a
 * roster of 40 would otherwise run 40 block lookups, and the cost pressure is
 * what makes people skip the check.
 *
 * NOT A RENDERING FILTER. Every capability that consults identity must consult
 * this too — messaging, connections-only content, appearing in mutuals. A
 * hidden person who can still reach her is the suspension bug one layer down:
 * a flag that changes what you see and not what you can do.
 */
export function hiddenFrom(db: Db, viewerId: string | null): ReadonlySet<string> {
  const hidden = new Set<string>();
  // Deleted and suspended are hidden from EVERYONE, viewer or not — so a guest
  // and a member get the same answer, and neither can infer from the other.
  for (const a of db.listAccounts()) {
    if (a.deletedAt) hidden.add(a.id);
    else if (a.suspended && (!a.suspendedUntil || new Date(a.suspendedUntil).getTime() > Date.now())) hidden.add(a.id);
  }
  if (viewerId === null) return hidden;
  // Blocks are bidirectional: isBlocked is true whichever way the row runs, so
  // she disappears for him AND he disappears for her by default.
  for (const b of db.listBlocksInvolving(viewerId)) {
    hidden.add(b.blockerId === viewerId ? b.blockedId : b.blockerId);
  }
  return hidden;
}

/**
 * Filter a list of things that carry an account id.
 *
 * Identity lists only. A COUNT must never be filtered through this — if he sees
 * 11 where everyone else sees 12, the block is readable and we have made things
 * worse. Counts are computed identically for every viewer; only names are
 * removed.
 */
export function withoutHidden<T>(rows: readonly T[], hidden: ReadonlySet<string>, idOf: (row: T) => string): T[] {
  return rows.filter((r) => !hidden.has(idOf(r)));
}
