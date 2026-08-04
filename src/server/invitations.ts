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
  const updated = db.updateInvitation(id, { revokedAt: now.toISOString(), revokedBy: auth.data.admin })!;
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
    return { ok: false, status: 403, error: "invitation_not_found", message: "No valid invitation found for that email and city." };
  }
  if (rec.revokedAt) {
    return { ok: false, status: 403, error: "invitation_revoked", message: "That invitation was revoked and can't be used." };
  }
  if (rec.usedAt) {
    return { ok: false, status: 409, error: "invitation_used", message: "That invitation was already used." };
  }
  if (new Date(rec.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, status: 403, error: "invitation_expired", message: "That invitation has expired." };
  }
  const expected = invitationTokenHash(token, rec.salt);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(rec.tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 403, error: "invalid_token", message: "That invitation code is not correct." };
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
    return { ok: false, status: 403, error: "invitation_not_found", message: "No valid invitation found for that email and city." };
  }
  if (rec.revokedAt) {
    return { ok: false, status: 403, error: "invitation_revoked", message: "That invitation was revoked and can't be used." };
  }
  if (rec.usedAt) {
    return { ok: false, status: 409, error: "invitation_used", message: "That invitation was already used." };
  }
  if (new Date(rec.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, status: 403, error: "invitation_expired", message: "That invitation has expired." };
  }
  const expected = invitationTokenHash(token, rec.salt);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(rec.tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 403, error: "invalid_token", message: "That invitation code is not correct." };
  }
  db.updateInvitation(rec.id, { usedAt: now.toISOString(), usedByAccountId: accountId });
  return { ok: true };
}
