/**
 * Community trust: credentials, ratings, concerns, recognitions, and the
 * configurable under-review state.
 *
 * Privacy rules enforced here (and at the API layer):
 *  - Proof bytes are private uploads. They are NEVER in any JSON payload and
 *    are served only to the credential owner (or an audited admin) through
 *    dedicated, protected endpoints.
 *  - Reviewer identity, concern/rating reasons, and raw counts/scores are
 *    never exposed in any public payload. The public surface is qualitative:
 *    a tier label ("new" / "recognized" / "well-regarded"), coach/host
 *    booleans, and recognition roles.
 *  - Rating eligibility is server-derived from SHARED attendance: a reviewer
 *    may rate a reviewee only for an event both of them RSVP'd to or hosted
 *    (see AttendanceRecord). Nothing is ever client-claimed.
 */
import { newId } from "./store";
import type { Db } from "./store";
import { ALLOWED_TRUST_TAGS, type AccountRecord, type CredentialType, type TrustTag } from "./types";
import type { AdminResult } from "./admin";

const MAX_PROOF = 8 * 1024 * 1024;
const MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
export const DEFAULT_TRUST_THRESHOLD = 3;
export const TRUST_THRESHOLD_MIN = 1;
export const TRUST_THRESHOLD_MAX = 10;
export const TRUST_REASON_MIN = 5;
export const TRUST_REASON_MAX = 500;

/** Configurable combined negative-rating + concern threshold (Global Admin). */
export function trustThreshold(db: Db): number {
  const s = db.getSettings<{ trust?: { underReviewThreshold?: number } }>({ trust: { underReviewThreshold: DEFAULT_TRUST_THRESHOLD } });
  const v = s?.trust?.underReviewThreshold;
  return typeof v === "number" && Number.isInteger(v) && v >= TRUST_THRESHOLD_MIN && v <= TRUST_THRESHOLD_MAX
    ? v
    : DEFAULT_TRUST_THRESHOLD;
}

export function negativeRatingCount(db: Db, accountId: string): number {
  return db.listRatings().filter((r) => r.revieweeId === accountId && r.positive === false).length;
}
export function openConcernCount(db: Db, accountId: string): number {
  return db.listConcerns().filter((c) => c.subjectId === accountId && c.status === "open").length;
}
/** Combined negative-ratings + open-concerns signal count (internal only). */
export function combinedSignals(db: Db, accountId: string): { negatives: number; concerns: number; total: number } {
  const negatives = negativeRatingCount(db, accountId);
  const concerns = openConcernCount(db, accountId);
  return { negatives, concerns, total: negatives + concerns };
}

/**
 * Auto-mark an account under review when its combined signal count reaches the
 * threshold. Never auto-clears — clearing is an admin appeal decision only.
 * Returns true when the state changed.
 */
export function evaluateTrustStatus(db: Db, accountId: string, now = new Date()): boolean {
  const rec = db.getAccount(accountId);
  if (!rec || rec.deletedAt || rec.underReview) return false;
  if (combinedSignals(db, accountId).total >= trustThreshold(db)) {
    db.updateAccount(accountId, { underReview: true, underReviewAt: now.toISOString() });
    return true;
  }
  return false;
}

/** Re-evaluate every account (used after the threshold is reconfigured). */
export function reconcileTrustStatus(db: Db, now = new Date()): number {
  let changed = 0;
  for (const rec of db.listAccounts()) {
    if (rec.deletedAt || rec.underReview) continue;
    if (evaluateTrustStatus(db, rec.id, now)) changed++;
  }
  return changed;
}

/**
 * Hosting / coach-post restrictions while under review. Browse, RSVP, and
 * comment stay available (enforced per-endpoint — see the API layer).
 * `true` means the action is BLOCKED.
 */
export function trustRestrictions(rec: AccountRecord | null | undefined): { hosting: boolean; coachPost: boolean } {
  const blocked = Boolean(rec && !rec.deletedAt && rec.underReview === true);
  return { hosting: blocked, coachPost: blocked };
}

/**
 * Resolve a client-supplied event id to the moderation-registry event id
 * ("event:refId"). Accepts both the bare refId ("mon-social") and the full
 * registry id ("event:mon-social" / "event:user-…"). Returns null for unknown
 * or non-event ids — the server is authoritative, never the client.
 */
export function resolveEventId(db: Db, eventId: string): string | null {
  const id = eventId.trim();
  if (!id) return null;
  // Canonical CMS events are authoritative; retain compatibility with the
  // legacy moderation registry used by attendance/rating records.
  const canonical = db.getEvent(id) ?? db.listEvents().find((event) => event.seedRefId === id);
  if (canonical && canonical.status !== "archived") return canonical.id;
  const candidate = id.startsWith("event:") ? id : `event:${id}`;
  const content = db.getContent(candidate);
  return content && content.kind === "event" ? candidate : null;
}

export function attended(db: Db, accountId: string, eventId: string): boolean {
  return db.hasAttendance(accountId, eventId);
}

/**
 * Rating eligibility: BOTH people must have shared the event (either RSVP'd
 * or hosted it). This is the only basis for a rating — a stranger can never
 * rate another runner. Returns the normalized registry event id on success.
 */
export function ratingEligibility(
  db: Db,
  reviewerId: string,
  revieweeId: string,
  eventId: string,
): AdminResult<{ eventId: string }> {
  const reviewee = db.getAccount(revieweeId);
  if (!reviewee || reviewee.deletedAt) return { ok: false, status: 404, error: "not_found" };
  if (reviewerId === revieweeId) return { ok: false, status: 400, error: "self_rating" };
  const registryId = resolveEventId(db, eventId);
  if (!registryId) return { ok: false, status: 400, error: "invalid_event", message: "That event isn't in the current listings." };
  if (!attended(db, reviewerId, registryId) || !attended(db, revieweeId, registryId)) {
    return {
      ok: false,
      status: 403,
      error: "not_shared_event",
      message: "You can only rate runners you actually shared an event with (RSVP or host).",
    };
  }
  return { ok: true, data: { eventId: registryId } };
}

export interface PublicTrustView {
  /** Qualitative reputation label only — raw counts/scores are never exposed. */
  tier: "new" | "recognized" | "well-regarded";
  coach: boolean;
  host: boolean;
  /** Admin-granted recognition roles — qualitative, non-ranked. */
  recognitions: { role: "coach" | "host"; tier: "recognized" }[];
  /** Only present when the caller is the account owner (their own state). */
  underReview?: boolean;
  /** Only present for the owner: which actions are blocked while under review. */
  restrictions?: { hosting: boolean; coachPost: boolean };
}

/**
 * Qualitative, privacy-safe view of a runner's community standing. Never
 * contains counts, scores, reviewer identities, reasons, or reports.
 */
export function publicTrust(db: Db, accountId: string, viewerId: string | null = null): PublicTrustView {
  const rec = db.getAccount(accountId);
  const ratings = db.listRatings().filter((r) => r.revieweeId === accountId);
  const positive = ratings.filter((r) => r.positive).length;
  const tier: PublicTrustView["tier"] = positive >= 10 ? "well-regarded" : positive >= 3 ? "recognized" : "new";
  const coach =
    db.listCredentials(accountId).some((c) => c.type === "coach_certification" && c.status === "verified") ||
    db.listRecognitions().some((r) => r.accountId === accountId && r.role === "coach");
  const host =
    db.listAttendance(accountId).some((a) => a.role === "host") ||
    db.listRecognitions().some((r) => r.accountId === accountId && r.role === "host");
  const view: PublicTrustView = {
    tier,
    coach,
    host,
    recognitions: db
      .listRecognitions()
      .filter((r) => r.accountId === accountId)
      .map((r) => ({ role: r.role, tier: "recognized" as const })),
  };
  if (viewerId === accountId) {
    view.underReview = rec?.underReview === true;
    view.restrictions = trustRestrictions(rec);
  }
  return view;
}

/**
 * Public, NON-RANKED qualitative recognition list for a city: coaches and
 * hosts with their qualitative tier label. Sorted by name (never by score),
 * no counts, no emails, no sensitive data.
 */
export function publicRecognitions(db: Db, cityId: string): { accountId: string; name: string; username: string | null; roles: ("coach" | "host")[]; tier: PublicTrustView["tier"] }[] {
  const rows: { accountId: string; name: string; username: string | null; roles: ("coach" | "host")[]; tier: PublicTrustView["tier"] }[] = [];
  for (const rec of db.listAccounts()) {
    if (rec.deletedAt || rec.cityId !== cityId) continue;
    const roles: ("coach" | "host")[] = [];
    if (db.listCredentials(rec.id).some((c) => c.type === "coach_certification" && c.status === "verified") || db.listRecognitions().some((r) => r.accountId === rec.id && r.role === "coach")) roles.push("coach");
    if (db.listAttendance(rec.id).some((a) => a.role === "host") || db.listRecognitions().some((r) => r.accountId === rec.id && r.role === "host")) roles.push("host");
    if (roles.length === 0) continue;
    const positive = db.listRatings().filter((r) => r.revieweeId === rec.id && r.positive).length;
    const tier: PublicTrustView["tier"] = positive >= 10 ? "well-regarded" : positive >= 3 ? "recognized" : "new";
    rows.push({ accountId: rec.id, name: rec.name, username: rec.username, roles, tier });
  }
  // Non-ranked: alphabetical by name, never by any count.
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------- credentials
export function expireCredentials(db: Db, now = new Date()) {
  for (const c of db.listCredentials()) {
    if (c.expiresOn && new Date(c.expiresOn).getTime() <= now.getTime() && c.status === "verified") db.updateCredential(c.id, { status: "expired", updatedAt: now.toISOString() });
    if (c.expiresOn && new Date(c.expiresOn).getTime() - now.getTime() <= 30 * 86400000 && !c.renewalNotifiedAt) db.updateCredential(c.id, { renewalNotifiedAt: now.toISOString(), updatedAt: now.toISOString() });
  }
}
export function validTags(tags: unknown): tags is TrustTag[] { return Array.isArray(tags) && tags.length <= 3 && tags.every(t => typeof t === "string" && (ALLOWED_TRUST_TAGS as readonly string[]).includes(t)); }
export function parseProof(body: Record<string, unknown>) {
  if (typeof body.proof !== "string" || typeof body.proofMime !== "string" || !MIME.has(body.proofMime)) return null;
  const m = /^data:[^;]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(body.proof); if (!m) return null;
  const bytes = Buffer.from(m[1].replace(/\s/g, ""), "base64"); if (!bytes.length || bytes.length > MAX_PROOF) return null; return { bytes, mime: body.proofMime };
}
export function credentialType(v: unknown): v is CredentialType { return v === "coach_certification" || v === "first_aid_cpr"; }
export function validTrustReason(reason: unknown): reason is string {
  return typeof reason === "string" && reason.trim().length >= TRUST_REASON_MIN && reason.trim().length <= TRUST_REASON_MAX;
}
export { newId };
