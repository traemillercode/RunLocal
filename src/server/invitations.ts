/**
 * City invitations — the safe entry path for invite-only cities.
 *
 * Security model:
 *  - Creation and revocation are GLOBAL-ADMIN-ONLY (owner or key admin),
 *    reason-required and audited (`admin.invitation_create` /
 *    `admin.invitation_revoke`).
 *  - The raw token is generated server-side, returned to the creating admin
 *    EXACTLY ONCE, and only its HMAC-SHA256 hash (with a per-invitation salt)
 *    is persisted. The token never appears in any public payload and can never
 *    be recovered from the server.
 *  - Redemption is one-time (`usedAt`), expiry-bound (`expiresAt`), and
 *    recipient-bound (exact email match, case-insensitive). Revoked invitations
 *    are permanently dead.
 *  - Validation is server-side only: home-city selection and signup consult
 *    this module before accepting an invite-only city.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AdminCtx, AdminResult } from "./admin";
import { authorizeAdmin } from "./admin";
import { REASON_MAX } from "./admin";
import { newId } from "./store";
import type { Db } from "./store";
import type { CityInvitationRecord } from "./types";

export const INVITATION_TOKEN_PREFIX = "inv_";
/** Default validity window for a new invitation. */
export const INVITATION_DEFAULT_DAYS = 30;
export const INVITATION_MAX_DAYS = 365;

export function invitationTokenHash(token: string, salt: string): string {
  return createHmac("sha256", salt).update(token).digest("hex");
}

/** Raw 32-byte token, never stored. */
export function newInvitationToken(): string {
  return `${INVITATION_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

export interface InvitationView {
  id: string;
  cityId: string;
  email: string;
  createdAt: string;
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  /** True while the invitation can still be redeemed right now. */
  valid: boolean;
  /** Raw token, present only while unredeemed — lets the list re-copy the link. */
  token: string | null;
  /** Why it is not valid (for the admin UI); null when valid. */
  invalidReason: "expired" | "used" | "revoked" | null;
}

function view(rec: CityInvitationRecord, now = new Date()): InvitationView {
  let invalidReason: InvitationView["invalidReason"] = null;
  if (rec.revokedAt) invalidReason = "revoked";
  else if (rec.usedAt) invalidReason = "used";
  else if (new Date(rec.expiresAt).getTime() <= now.getTime()) invalidReason = "expired";
  return {
    id: rec.id,
    cityId: rec.cityId,
    email: rec.email,
    createdAt: rec.createdAt,
    createdBy: rec.createdBy,
    expiresAt: rec.expiresAt,
    usedAt: rec.usedAt,
    revokedAt: rec.revokedAt,
    valid: invalidReason === null,
    invalidReason,
    // Present only while the invitation can still be redeemed, so the admin
    // list can rebuild a sendable link. Cleared on redeem and on revoke, and
    // this view is only ever returned to an authorized admin.
    token: invalidReason === null ? rec.token : null,
  };
}

export function createInvitation(
  db: Db,
  ctx: AdminCtx,
  input: { cityId?: unknown; email?: unknown; expiresInDays?: unknown },
  now = new Date(),
): AdminResult<{ invitation: InvitationView; token: string }> {
  // Generate the target id BEFORE authorizing so the audit entry carries it.
  const id = newId();
  const auth = authorizeAdmin(db, ctx, "admin.invitation_create", id, now);
  if (!auth.ok) return auth;
  const cityId = typeof input.cityId === "string" ? input.cityId.trim() : "";
  const city = db.getCity(cityId);
  // Invitations are meaningful only for known cities. Any known city is
  // accepted at creation (an admin may pre-issue invites before flipping the
  // status), but redemption only ever happens for invite-only cities.
  if (!city) return { ok: false, status: 400, error: "invalid_city" };
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
    return { ok: false, status: 400, error: "invalid_email" };
  }
  let days = INVITATION_DEFAULT_DAYS;
  if (input.expiresInDays !== undefined && input.expiresInDays !== null) {
    const n = Number(input.expiresInDays);
    if (!Number.isInteger(n) || n < 1 || n > INVITATION_MAX_DAYS) {
      return { ok: false, status: 400, error: "invalid_expiry", message: `Invitation days must be 1–${INVITATION_MAX_DAYS}.` };
    }
    days = n;
  }
  const token = newInvitationToken();
  const salt = randomBytes(16).toString("hex");
  const rec: CityInvitationRecord = {
    id,
    cityId,
    email,
    tokenHash: invitationTokenHash(token, salt),
    salt,
    // Retained until redeemed or revoked so the link can be re-copied.
    token,
    createdAt: now.toISOString(),
    createdBy: auth.data.admin,
    expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
    usedAt: null,
    usedByAccountId: null,
    revokedAt: null,
    revokedBy: null,
  };
  db.appendInvitation(rec);
  // The audit entry carries the recipient's email as context (admin-facing
  // audit only — never shipped in public payloads).
  db.appendAudit(
    { admin: auth.data.admin, action: "admin.invitation_create", reason: ctx.reason!.trim().slice(0, REASON_MAX), targetId: id, ip: ctx.ip, cityId },
    now,
  );
  return { ok: true, data: { invitation: view(rec, now), token } };
}

export function revokeInvitation(
  db: Db,
  ctx: AdminCtx,
  id: string,
  now = new Date(),
): AdminResult<{ invitation: InvitationView }> {
  const auth = authorizeAdmin(db, ctx, "admin.invitation_revoke", id, now);
  if (!auth.ok) return auth;
  const rec = db.getInvitation(id);
  if (!rec) return { ok: false, status: 404, error: "not_found" };
  if (rec.revokedAt) return { ok: false, status: 409, error: "already_revoked" };
  const updated = db.updateInvitation(id, { revokedAt: now.toISOString(), revokedBy: auth.data.admin, token: null })!;
  db.appendAudit(
    { admin: auth.data.admin, action: "admin.invitation_revoke", reason: ctx.reason!.trim().slice(0, REASON_MAX), targetId: id, ip: ctx.ip, cityId: rec.cityId },
    now,
  );
  return { ok: true, data: { invitation: view(updated, now) } };
}

/** Global Admin list (all invitations, optional city filter). */
export function listInvitations(
  db: Db,
  ctx: AdminCtx,
  cityId: string | null,
  now = new Date(),
): AdminResult<InvitationView[]> {
  const auth = authorizeAdmin(db, ctx, "admin.invitation_create", null, now);
  if (!auth.ok) return auth;
  const rows = db
    .listInvitations()
    .filter((i) => !cityId || i.cityId === cityId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((i) => view(i, now));
  return { ok: true, data: rows };
}

/**
 * Non-consuming validation of an invitation token for a city+recipient.
 * Used by the API layer BEFORE an account write (signup / home-city change)
 * so a failed invitation never leaves a partial account behind. Redeem the
 * invitation AFTER the write, in the same synchronous turn of the
 * single-threaded store, so one-time redemption is still guaranteed.
 */
export function validateInvitation(
  db: Db,
  cityId: string,
  email: string,
  token: string,
  now = new Date(),
): { ok: true } | { ok: false; error: string; status: number; message: string } {
  const key = email.trim().toLowerCase();
  const rec = db.findInvitation(cityId, key);
  if (!rec) {
    return { ok: false, status: 403, error: "invitation_not_found", message: SIGNUP_CLOSED_MESSAGE };
  }
  if (rec.revokedAt) {
    return { ok: false, status: 403, error: "invitation_revoked", message: SIGNUP_CLOSED_MESSAGE };
  }
  if (rec.usedAt) {
    return { ok: false, status: 409, error: "invitation_used", message: SIGNUP_CLOSED_MESSAGE };
  }
  if (new Date(rec.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, status: 403, error: "invitation_expired", message: SIGNUP_CLOSED_MESSAGE };
  }
  const expected = invitationTokenHash(token, rec.salt);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(rec.tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 403, error: "invalid_token", message: SIGNUP_CLOSED_MESSAGE };
  }
  return { ok: true };
}

/**
 * Redeem an invitation for an invite-only city. Consumes the invitation on
 * success (one-time). The caller (API layer) performs the account write after
 * a successful redemption, in the same synchronous turn of the single-threaded
 * store, so a concurrent request can never redeem the same invitation twice.
 */
export function redeemInvitation(
  db: Db,
  cityId: string,
  email: string,
  token: string,
  accountId: string,
  now = new Date(),
): { ok: true } | { ok: false; error: string; status: number; message: string } {
  const key = email.trim().toLowerCase();
  const rec = db.findInvitation(cityId, key);
  if (!rec) {
    return { ok: false, status: 403, error: "invitation_not_found", message: SIGNUP_CLOSED_MESSAGE };
  }
  if (rec.revokedAt) {
    return { ok: false, status: 403, error: "invitation_revoked", message: SIGNUP_CLOSED_MESSAGE };
  }
  if (rec.usedAt) {
    return { ok: false, status: 409, error: "invitation_used", message: SIGNUP_CLOSED_MESSAGE };
  }
  if (new Date(rec.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, status: 403, error: "invitation_expired", message: SIGNUP_CLOSED_MESSAGE };
  }
  const expected = invitationTokenHash(token, rec.salt);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(rec.tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 403, error: "invalid_token", message: SIGNUP_CLOSED_MESSAGE };
  }
  db.updateInvitation(rec.id, { usedAt: now.toISOString(), usedByAccountId: accountId, token: null });
  return { ok: true };
}

/* ── Beta redemption cap ──────────────────────────────────────────────────── */

/**
 * How many invitations may be redeemed before signup closes.
 *
 * NOT hardcoded, deliberately. SPONSOR_DAY_RATE_USD being a constant in
 * payments.ts is recorded as a defect for exactly this reason: changing a
 * number that the business decides should not require shipping software. If
 * the eleventh person is someone we actually want, raising the cap is an
 * environment change.
 *
 * 0 or unset means NO CAP — the gate itself is the control, and a cap that
 * defaults to something restrictive would silently close signup the first time
 * the variable failed to load.
 */
export function betaRedemptionCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.BETA_REDEMPTION_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/**
 * Redemptions consumed so far.
 *
 * Counts REDEEMED INVITATIONS, not accounts. There are already nine accounts
 * in auth.users created before any gate existed; counting accounts would mean
 * the cap is blown before the first invitee arrives. Pre-existing accounts sit
 * outside the invitation system and consume no slots.
 */
export function redemptionCount(db: Db): number {
  return db.listInvitations().filter((i) => i.usedAt !== null).length;
}

/**
 * Whether the beta is full. Separate from validateInvitation() because a
 * VALID invitation can still be refused when the cohort is full, and the two
 * produce different messages: one is "your code is wrong", the other is
 * "you did nothing wrong, we are full".
 */
export function betaCapReached(db: Db, env: NodeJS.ProcessEnv = process.env): boolean {
  const cap = betaRedemptionCap(env);
  return cap > 0 && redemptionCount(db) >= cap;
}

/**
 * Shown when the cohort is full.
 *
 * Deliberately NOT "this week's spots are taken" — that implies slots reopen on
 * Monday, and someone who comes back would be refused again. And a bare
 * "opening up soon" is a promise with nothing to act on.
 *
 * The mailto is the email capture: hello@getkimbio.com receives now, so this
 * collects the next cohort without a table, an endpoint or a form. When the
 * queue justifies real capture, the replies will already say whether anyone
 * writes in.
 *
 * Exported so the pre-check and the refusal cannot drift apart.
 */
/**
 * ONE message for every reason a stranger cannot sign up.
 *
 * There were five — no invitation, revoked, already used, expired, wrong code —
 * plus a separate one for the cohort being full. The distinctions matter to us
 * and to nobody standing in front of the form, and they LEAK: "already used"
 * versus "no invitation found" turns the signup form into a way to test whether
 * an address was invited.
 *
 * It also has to CONVERT. A stranger who reached this point typed their email,
 * which is the highest-intent moment in the funnel, and "No valid invitation
 * found for that email and city" spent it on a lookup failure. The form is
 * rendered directly beneath this message rather than a link elsewhere —
 * somebody who just typed their address should not type it again somewhere else.
 */
export const SIGNUP_CLOSED_MESSAGE =
  "Kimbio is in a private beta while we get things right for Columbia. Add yourself to the list and we'll email you the moment we open up.";

/**
 * The cohort being full and having no invitation are the SAME experience from
 * outside the door, so they say the same thing. Keeping them distinct served
 * only us, and distinguishing them would leak how many spots remain.
 */
export const BETA_FULL_MESSAGE = SIGNUP_CLOSED_MESSAGE;
