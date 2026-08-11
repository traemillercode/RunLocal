/**
 * Trusted Member (manual trust / blue-check) state — Task 7, slice 1.
 *
 * This module is the server-authoritative home of the manual trust state that
 * sits ON TOP of identity verification. The identity funnel (`status:
 * "verified"`, email + selfie + owner approval) proves *who someone is*; the
 * Trusted Member badge is an explicit, human decision that a member is known
 * and trusted in their local community.
 *
 * Hard rules enforced here (and never client-claimed):
 *  - GRANT requires the target to have completed REAL identity verification
 *    (`status === "verified"`). Pending/rejected accounts can never receive
 *    the badge — no fabricated verification.
 *  - Grant/revoke is a Global Admin (any city) or City Admin (their EXACT
 *    scope city) operation. Cross-city is denied server-side via
 *    `authorizeScoped`'s `enforceCity` binding to the target's home city.
 *  - No self-verification: an admin can never set or clear the badge on their
 *    own account. The key-admin session is the owner's operator identity, so
 *    a key-session grant targeting the owner account is also rejected — the
 *    owner account can only receive the badge from a genuinely separate
 *    City Admin.
 *  - Every grant/revoke/list is reason-required and audited with the target
 *    account id, the city the decision concerns, and a change summary. The
 *    audit log is the only history — the account fields hold just the current
 *    state (no timestamps beyond the current grant).
 *
 * The badge is display-only for the client (`PublicAccount.trustedMember`) —
 * it grants NO powers here: no matching, no messaging, no analytics, no
 * visibility into private occurrence data. Those remain out of scope until a
 * separate, reviewed slice.
 */
import type { AccountRecord } from "./types";
import type { Db } from "./store";
import { authorizeScoped, ownerSessionAccount, routineAdminCtx, sessionAccount, type AdminCtx } from "./admin";
import type { AdminResult } from "./admin";
import { isOwnerEmail } from "./owner";

/** One row of the trusted-member roster — public fields only, never sensitive. */
export interface TrustedMemberRow {
  accountId: string;
  name: string;
  email: string;
  cityId: string | null;
  /** When the CURRENT grant was made (null-able for legacy safety, always set in practice). */
  trustedMemberAt: string | null;
  /** Server-authoritative current state (display-only for the client). */
  trustedMember: boolean;
  status: AccountRecord["status"];
}

function memberRow(rec: AccountRecord): TrustedMemberRow {
  return {
    accountId: rec.id,
    name: rec.name,
    email: rec.email,
    cityId: rec.cityId ?? null,
    trustedMemberAt: rec.trustedMemberAt ?? null,
    trustedMember: rec.trustedMember === true,
    status: rec.status,
  };
}

/** Resolve an account by id; deleted/tombstoned accounts are treated as gone. */
function byId(db: Db, accountId: string): AdminResult<AccountRecord> {
  if (!/^[a-f0-9]{32}$/.test(accountId)) return { ok: false, status: 400, error: "invalid_account_id" };
  const rec = db.getAccount(accountId);
  if (!rec || rec.deletedAt) return { ok: false, status: 404, error: "not_found", message: "No account found for that id." };
  return { ok: true, data: rec };
}

/** Resolve an account by normalized email (case-insensitive). */
function byEmail(db: Db, email: string): AdminResult<AccountRecord> {
  const key = email.trim().toLowerCase();
  if (!key || key.length > 120) return { ok: false, status: 400, error: "invalid_email" };
  const rec = db.getAccountByEmail(key);
  if (!rec || rec.deletedAt) return { ok: false, status: 404, error: "not_found", message: "No account found for that email." };
  return { ok: true, data: rec };
}

/**
 * Self-check: is the target the caller's own account? The key-admin session
 * is the owner's operator identity, so the owner account is treated as self
 * for key sessions too — the owner can never badge their own account through
 * their own admin tooling. Only a genuinely separate City Admin (or the owner
 * operating through a different admin identity than the target account) can.
 */
function isSelfTarget(db: Db, ctx: AdminCtx, target: AccountRecord): boolean {
  const keySession = ctx.adminSessionId ? db.getSession(ctx.adminSessionId) : undefined;
  if (keySession && keySession.accountId === "__admin__") return isOwnerEmail(target.email);
  const owner = ownerSessionAccount(db, ctx);
  if (owner) return owner.id === target.id;
  const user = sessionAccount(db, ctx);
  return user?.id === target.id;
}

/** Shared pre-authorization checks for grant/revoke (lookup + self). */
function guardCommon(db: Db, ctx: AdminCtx, rec: AccountRecord): AdminResult<null> {
  if (isSelfTarget(db, ctx, rec)) {
    return {
      ok: false,
      status: 400,
      error: "self_verification",
      message: "An admin can never grant or revoke the Trusted Member badge on their own account.",
    };
  }
  return { ok: true, data: null };
}

/** Grant-side integrity gates: real identity verification + a home city. */
function guardGrant(db: Db, ctx: AdminCtx, rec: AccountRecord): AdminResult<null> {
  const common = guardCommon(db, ctx, rec);
  if (!common.ok) return common;
  if (rec.status !== "verified") {
    return {
      ok: false,
      status: 409,
      error: "not_verified",
      message: "The Trusted Member badge requires a fully identity-verified member (email + selfie + approval). Pending or rejected accounts cannot receive it.",
    };
  }
  if (!rec.cityId) {
    return {
      ok: false,
      status: 409,
      error: "no_home_city",
      message: "Trust is city-anchored — the member needs a home city before receiving the badge.",
    };
  }
  return { ok: true, data: null };
}

function applyGrant(db: Db, accountId: string, now: Date): AccountRecord {
  return db.updateAccount(accountId, { trustedMember: true, trustedMemberAt: now.toISOString() })!;
}
function applyRevoke(db: Db, accountId: string): AccountRecord {
  return db.updateAccount(accountId, { trustedMember: false, trustedMemberAt: null })!;
}

// ------------------------------------------------------------- global paths
// Global Admin (owner user session or key-admin session) — any city.

/** Global Admin grants the Trusted Member badge by account email. */
export function grantTrustedMember(db: Db, ctx: AdminCtx, email: string, now = new Date()): AdminResult<TrustedMemberRow> {
  const target = byEmail(db, email);
  if (!target.ok) return target;
  const guard = guardGrant(db, ctx, target.data);
  if (!guard.ok) return guard;
  const auth = authorizeScoped(db, ctx, "admin.trust_grant", target.data.id, now, {
    globalOnly: true,
    auditCity: target.data.cityId,
    change: `Trusted Member granted (${target.data.email})`,
  });
  if (!auth.ok) return auth;
  const updated = applyGrant(db, target.data.id, now);
  return { ok: true, data: memberRow(updated) };
}

/** Global Admin revokes the Trusted Member badge by account id. */
export function revokeTrustedMember(db: Db, ctx: AdminCtx, accountId: string, now = new Date()): AdminResult<TrustedMemberRow> {
  const target = byId(db, accountId);
  if (!target.ok) return target;
  const guard = guardCommon(db, ctx, target.data);
  if (!guard.ok) return guard;
  const auth = authorizeScoped(db, ctx, "admin.trust_revoke", target.data.id, now, {
    globalOnly: true,
    auditCity: target.data.cityId,
    change: `Trusted Member revoked (${target.data.email})`,
  });
  if (!auth.ok) return auth;
  const updated = applyRevoke(db, target.data.id);
  return { ok: true, data: memberRow(updated) };
}

/** Global Admin roster — every trusted member across all cities (routine read). */
export function listTrustedMembers(db: Db, ctx: AdminCtx, now = new Date()): AdminResult<TrustedMemberRow[]> {
  const auth = authorizeScoped(db, routineAdminCtx(ctx), "admin.trust_list", null, now, { globalOnly: true });
  if (!auth.ok) return auth;
  const rows = db
    .listAccounts()
    .filter((r) => !r.deletedAt && r.trustedMember === true)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(memberRow);
  return { ok: true, data: rows };
}

// --------------------------------------------------------------- city paths
// City Admin (account role "city_admin" + exactly one adminCityId) — the
// target's home city must equal the scope city; everything else is denied.

/** City Admin grants the Trusted Member badge within their exact scope city. */
export function cityGrantTrustedMember(db: Db, ctx: AdminCtx, email: string, now = new Date()): AdminResult<TrustedMemberRow> {
  const target = byEmail(db, email);
  if (!target.ok) return target;
  const guard = guardGrant(db, ctx, target.data);
  if (!guard.ok) return guard;
  const auth = authorizeScoped(db, ctx, "cityadmin.trust_grant", target.data.id, now, {
    enforceCity: target.data.cityId,
    auditCity: target.data.cityId,
    change: `Trusted Member granted (${target.data.email})`,
  });
  if (!auth.ok) return auth;
  const updated = applyGrant(db, target.data.id, now);
  return { ok: true, data: memberRow(updated) };
}

/** City Admin revokes the Trusted Member badge within their exact scope city. */
export function cityRevokeTrustedMember(db: Db, ctx: AdminCtx, accountId: string, now = new Date()): AdminResult<TrustedMemberRow> {
  const target = byId(db, accountId);
  if (!target.ok) return target;
  const guard = guardCommon(db, ctx, target.data);
  if (!guard.ok) return guard;
  // Defense in depth: a null cityId would make `enforceCity` a no-op in
  // authorizeScoped, so reject it explicitly — trust is always city-anchored.
  if (!target.data.cityId) {
    return { ok: false, status: 409, error: "no_home_city", message: "Trust is city-anchored — the member needs a home city." };
  }
  const auth = authorizeScoped(db, ctx, "cityadmin.trust_revoke", target.data.id, now, {
    enforceCity: target.data.cityId,
    auditCity: target.data.cityId,
    change: `Trusted Member revoked (${target.data.email})`,
  });
  if (!auth.ok) return auth;
  const updated = applyRevoke(db, target.data.id);
  return { ok: true, data: memberRow(updated) };
}

/** City Admin roster — trusted members in the caller's scope city only. */
export function cityListTrustedMembers(db: Db, ctx: AdminCtx, now = new Date()): AdminResult<TrustedMemberRow[]> {
  const auth = authorizeScoped(db, routineAdminCtx(ctx), "cityadmin.trust_list", null, now);
  if (!auth.ok) return auth;
  const cityId = auth.data.scope.kind === "city" ? auth.data.scope.cityId : null;
  if (cityId === null) return { ok: false, status: 403, error: "city_scope_denied" };
  const rows = db
    .listAccounts()
    .filter((r) => !r.deletedAt && r.trustedMember === true && r.cityId === cityId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(memberRow);
  return { ok: true, data: rows };
}
