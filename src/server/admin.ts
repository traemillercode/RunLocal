/**
 * Admin-only safety tool — server-side authorization & handlers.
 *
 * Auth model (no identity provider in this build):
 *  - `RUN_LOCAL_ADMIN_KEY` (env, secret) unlocks the admin UI. The key is
 *    POSTed once; on success the server issues an HttpOnly admin session
 *    cookie. The key itself is never stored client-side.
 *  - `RUN_LOCAL_ADMIN_EMAIL` (env, non-secret) names the admin for the audit
 *    log (default "admin@runlocal.app").
 *  - The OWNER (see `owner.ts`, `RUN_LOCAL_OWNER_EMAIL`, default
 *    traemiller.email@gmail.com) is additionally authorized through their
 *    normal signed-in user session — server-side email rule, never a
 *    client-supplied role. The owner is the only identity that may use the
 *    pending-user control center.
 *  - Every lookup/export/approve/reject/delete/purge requires BOTH an admin
 *    session (key OR owner) AND a free-form reason (5–500 chars). Every access
 *    is appended to the audit log with admin/timestamp/reason/action.
 *
 * Handlers are pure functions over (Db, ctx) so authorization and audit
 * behavior are unit-testable without HTTP.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { AccountRecord, AccountRole, AdminAction } from "./types";
import type { Db } from "./store";
import { newId } from "./store";
import { sendEmail, verifiedEmailHtml } from "./email";
import { isOwnerEmail, ownerEmail } from "./owner";
import {
  ALL_ACCOUNT_ROLES,
  ADMIN_ROLES,
  accountRoles,
  addRolePatch,
  effectiveRole,
  hasRole,
  normalizeRoles,
  rolesPatch,
  storedRoles,
} from "./accountRoles";

export const ADMIN_KEY_VAR = "RUN_LOCAL_ADMIN_KEY";
export const ADMIN_EMAIL_VAR = "RUN_LOCAL_ADMIN_EMAIL";
export const REASON_MIN = 5;
export const REASON_MAX = 500;

export interface AdminCtx {
  /** Admin session id from the HttpOnly cookie (key-based), or null. */
  adminSessionId: string | null;
  /** The signed-in user's session id (owner super-admin path), or null. */
  userSessionId?: string | null;
  /** The reason header supplied with the request, or undefined. */
  reason?: string;
  ip: string;
}

export type AdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; message?: string };

export function adminConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env[ADMIN_KEY_VAR]);
}

export function adminEmail(env: Record<string, string | undefined> = process.env): string {
  return env[ADMIN_EMAIL_VAR]?.trim() || "admin@runlocal.app";
}

export function validReason(reason: string | undefined): boolean {
  return Boolean(reason && reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX);
}

/** Routine reads remain audited, but do not require an operator-entered reason.
 * The audit entry uses the given system label when the operator supplied none
 * (an operator-entered reason, when present, is always kept). */
/**
 * DEPRECATED — now a pass-through.
 *
 * This existed solely to satisfy the blanket reason requirement: it INVENTED
 * the string "Routine admin read" so that listing pending accounts or reading
 * a dashboard would not be rejected. That fake reason then landed in the audit
 * log, filling it with a constant that recorded nothing about who decided what.
 *
 * With the requirement now per-action, routine reads need no reason and should
 * not be audited. Kept as a pass-through rather than deleted at 23 call sites
 * in one commit; those drop it as they are touched.
 */
export function routineAdminCtx(ctx: AdminCtx, _label?: string): AdminCtx {
  void _label;
  return ctx;
}

export function keyMatches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Authorize an admin *action* (not login). Returns the admin email on success
 * and appends the audit entry. All sensitive actions go through this.
 *
 * Two acceptable identities:
 *  1. A key-based admin session (`runlocal_admin` cookie, account "__admin__").
 *  2. The owner's signed-in user session — server-side email rule against
 *     RUN_LOCAL_OWNER_EMAIL. Group Leaders / Verified Runners can never pass.
 */

/**
 * Which admin actions require a written reason.
 *
 * THE DEFECT THIS FIXES: authorizeAdmin / authorizeOwner / authorizeScoped all
 * demanded x-audit-reason unconditionally, but the client sends it on 11 of 75
 * calls — so 64 admin operations could never succeed. The tool was unusable AND
 * the audit trail was empty, which is the worst of both: enforced server-side,
 * absent client-side.
 *
 * The rule is not "audit everything". A reason is worth collecting where the
 * record MATTERS — a decision that is contested, destructive, or shown to the
 * person it affects. Demanding one to approve a runner or save a setting is
 * friction that produces a log full of "ok" and teaches operators to type
 * anything to get past it, which makes the genuine entries worth less.
 *
 * DEFAULT IS NOT REQUIRED. A capability added tomorrow will not silently break
 * its own UI; it will simply not be audited until someone adds it here. That
 * direction is deliberate — the failure mode of the old default was an admin
 * tool that could not be used at all.
 */
export const REASON_REQUIRED_ACTIONS: ReadonlySet<string> = new Set([
  // Rejection copy is SHOWN to the applicant (admin.ts reject path), so the
  // reason is user-facing, not just a log line.
  "admin.reject",
  "admin.submission_reject",
  "admin.undo_rejection",

  // Destructive: removes or conceals someone else's content or account.
  "admin.purge",
  "admin.purge_all",
  "admin.delete",
  "admin.suspend",
  "admin.unsuspend",
  "admin.content_delete",
  "admin.content_hide",
  "admin.content_unhide",
  "admin.content_archive",
  "admin.discussion_delete",
  "admin.submission_remove",
  "admin.event_hide",
  "admin.event_unhide",
  "admin.event_archive",
  "admin.sponsor_delete",
  "admin.flag_hide",

  // NOTE: admin.invitation_revoke is deliberately NOT here. Revoking an
  // unredeemed invitation is undoing your own action, not moderating a person —
  // nobody is affected and there is no decision to justify. It was on this list
  // and the client sent no header, so every revoke 400'd and the X did nothing.
  //
  // Contested: a judgement another operator may need to understand or reverse.
  "admin.appeal_uphold",
  "admin.appeal_reinstate",
  "admin.safety_report_resolve",
  "admin.flag_dismiss",
  "admin.trust_revoke",
  "admin.trust_grant",
  "admin.trust_threshold",

  // Overriding another operator, or changing who can operate.
  "admin.roles_assign",
  "admin.city_admin_assign",
  "admin.city_admin_revoke",
  "admin.content_edit",
  "admin.discussion_edit",
  "admin.forum_post_edit",
  "admin.submission_edit",

  // Privacy-sensitive reads: looking at someone's identity documents should
  // leave a record even though nothing is written.
  "admin.view_selfie",
  "admin.view_credential_proof",
  "admin.view_record",
  "admin.export",
]);

/**
 * Reads. Auditing an unexplained one records nothing useful — it was the
 * invented "Routine admin read" constant filling the log before.
 * Privacy-sensitive reads (view_selfie, view_credential_proof, export) are
 * deliberately ABSENT: those are audited precisely because looking is the act.
 */
const READ_ONLY_ACTIONS: ReadonlySet<string> = new Set([
  "admin.pending_list", "admin.search", "admin.dashboard", "admin.overview",
  "admin.audit", "admin.content_list", "admin.event_list", "admin.submission_list",
  "admin.waitlist_list",
  "admin.discussion_list", "admin.trust_list", "admin.appeal_list",
  "admin.safety_report_list", "admin.login",
]);

/** True when this action must carry a written reason. */
export function reasonRequiredFor(action: string): boolean {
  return REASON_REQUIRED_ACTIONS.has(action);
}


/**
 * Write an audit entry only when there is something worth recording.
 *
 * Under the old blanket requirement every action carried a reason, so every
 * action was logged — and routine reads were forced through routineAdminCtx(),
 * which INVENTED the string "Routine admin read" purely to satisfy the check.
 * The log therefore filled with a constant that recorded nothing.
 *
 * Now: an action that requires a reason is audited with it. A routine action
 * is audited only if the operator volunteered one. A log of real decisions is
 * worth more than a log of everything, because the everything version is what
 * nobody reads.
 */
function auditIfMeaningful(
  db: Db,
  entry: { admin: string; action: AdminAction; reason: string | undefined; targetId: string | null; ip: string | null; cityId?: string | null; owner?: string | null; change?: unknown },
  now: Date,
): void {
  const reason = (entry.reason ?? "").trim();
  /*
   * READS with no reason are not recorded. Everything else always is.
   *
   * I conflated two questions on the first attempt — whether a reason is
   * REQUIRED, and whether the action is AUDITED — and skipped the audit for any
   * unexplained action not in the required set. That silently stopped recording
   * writes like admin.race_edit and admin.submission_edit, which is a worse
   * outcome than the bug being fixed: the audit trail is the thing the reason
   * requirement exists to serve.
   *
   * A write is worth recording even when the operator did not say why — THAT it
   * happened, by whom, to what. An unexplained read is not.
   */
  if (READ_ONLY_ACTIONS.has(entry.action) && reason.length === 0) return;
  db.appendAudit({ ...entry, reason: reason.slice(0, REASON_MAX) } as Parameters<Db["appendAudit"]>[0], now);
}

export function authorizeAdmin(
  db: Db,
  ctx: AdminCtx,
  action: AdminAction,
  targetId: string | null,
  now = new Date(),
): AdminResult<{ admin: string }> {
  // Only for actions where the record matters — see REASON_REQUIRED_ACTIONS.
  if (reasonRequiredFor(action) && !validReason(ctx.reason)) {
    return {
      ok: false,
      status: 400,
      error: "reason_required",
    };
  }
  const adminSession = ctx.adminSessionId ? db.getSession(ctx.adminSessionId) : undefined;
  if (adminSession && adminSession.accountId === "__admin__") {
    if (!adminConfigured()) {
      return { ok: false, status: 503, error: "admin_unconfigured" };
    }
    const admin = adminEmail();
    auditIfMeaningful(
      db,
      {
        admin,
        action,
        reason: ctx.reason,
        targetId,
        ip: ctx.ip,
      },
      now,
    );
    return { ok: true, data: { admin } };
  }
  const owner = ownerSessionAccount(db, ctx);
  if (owner) {
    const admin = ownerEmail();
    auditIfMeaningful(
      db,
      {
        admin,
        action,
        reason: ctx.reason,
        targetId,
        ip: ctx.ip,
      },
      now,
    );
    return { ok: true, data: { admin } };
  }
  if (!adminConfigured()) {
    return { ok: false, status: 503, error: "admin_unconfigured" };
  }
  return { ok: false, status: 401, error: "unauthorized" };
}

/**
 * Resolve the owner's user session, if any. The owner is authorized through
 * their normal signed-in session whose account email matches
 * RUN_LOCAL_OWNER_EMAIL. This is the ONLY way the pending-user control center
 * can be reached — key-based admin sessions cannot.
 */
export function ownerSessionAccount(db: Db, ctx: AdminCtx): AccountRecord | null {
  if (!ctx.userSessionId) return null;
  const session = db.getSession(ctx.userSessionId);
  if (!session || session.accountId === "__admin__") return null;
  const rec = db.getAccount(session.accountId);
  if (!rec || rec.deletedAt) return null;
  return isOwnerEmail(rec.email) ? rec : null;
}

/** Owner-only variant of authorizeAdmin (key sessions are rejected). */
export function authorizeOwner(
  db: Db,
  ctx: AdminCtx,
  action: AdminAction,
  targetId: string | null,
  now = new Date(),
): AdminResult<{ admin: string }> {
  if (reasonRequiredFor(action) && !validReason(ctx.reason)) {
    return { ok: false, status: 400, error: "reason_required" };
  }
  if (!ownerSessionAccount(db, ctx)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  const admin = ownerEmail();
  auditIfMeaningful(
      db,
      {
      admin,
      action,
      reason: ctx.reason,
      targetId,
      ip: ctx.ip,
      },
      now,
    );
  return { ok: true, data: { admin } };
}

// --------------------------------------------------------- scope-aware authz
// Multi-city foundation: three admin identities exist.
//   1. Key admin ("__admin__" session)            → GLOBAL scope (all cities).
//   2. Owner (signed-in user whose email matches
//      RUN_LOCAL_OWNER_EMAIL)                     → GLOBAL scope (all cities).
//   3. City Admin (signed-in user whose account
//      has role "city_admin" + adminCityId)       → EXACTLY ONE city scope.
// authorizeScoped() resolves the caller's scope and enforces it; every
// city-admin read/mutation passes through it so cross-city access is denied
// server-side regardless of any client-supplied params.

export type ScopeKind = "global" | "city";
export interface Authz {
  /** The caller's effective admin scope. */
  scope: { kind: ScopeKind; cityId: string | null };
  /** Admin identity for the audit log. */
  admin: string;
  /** Kimbio account id (null for key-admin sessions). */
  accountId: string | null;
}

/** Resolve the signed-in account behind a user session, if any. */
export function sessionAccount(db: Db, ctx: AdminCtx): AccountRecord | null {
  if (!ctx.userSessionId) return null;
  const session = db.getSession(ctx.userSessionId);
  if (!session || session.accountId === "__admin__") return null;
  const rec = db.getAccount(session.accountId);
  if (!rec || rec.deletedAt) return null;
  return rec;
}

/** True when the account is a City Admin with exactly one city scope. */
export function isCityAdminAccount(rec: AccountRecord): boolean {
  return hasRole(rec, "city_admin") && typeof rec.adminCityId === "string" && rec.adminCityId.length > 0;
}

export interface ScopedOptions {
  /**
   * When set, city-admin callers must be scoped to exactly this city (used to
   * bind a mutation to the target record's cityId). Global admins are always
   * allowed.
   */
  enforceCity?: string | null;
  /**
   * When true, city-admin sessions are rejected entirely (global-only action).
   */
  globalOnly?: boolean;
  /**
   * City to record on the audit entry (the city the action concerns). For
   * city-admin callers this is forced to their scope.
   */
  auditCity?: string | null;
  /**
   * Owner identity of the affected content, recorded on the audit entry
   * (content-owner account email, or a seeded author label when no account).
   */
  owner?: string | null;
  /**
   * Human-readable change summary recorded on the audit entry (e.g.
   * `title: "A" -> "B"`, `soft-deleted + 2 RSVPs cascaded`). The underlying
   * rows are never hard-deleted, so this is a snapshot description only.
   */
  change?: string | null;
}

/**
 * Resolve + authorize an admin action with scope enforcement. Appends the
 * audit entry on success (action, reason, target, ip, city).
 */
export function authorizeScoped(
  db: Db,
  ctx: AdminCtx,
  action: AdminAction,
  targetId: string | null,
  now = new Date(),
  opts: ScopedOptions = {},
): AdminResult<Authz> {
  if (reasonRequiredFor(action) && !validReason(ctx.reason)) {
    return { ok: false, status: 400, error: "reason_required" };
  }
  // 1) Key admin → global.
  const adminSession = ctx.adminSessionId ? db.getSession(ctx.adminSessionId) : undefined;
  if (adminSession && adminSession.accountId === "__admin__") {
    if (!adminConfigured()) {
      return { ok: false, status: 503, error: "admin_unconfigured" };
    }
    const admin = adminEmail();
    auditIfMeaningful(db, { admin, action, reason: ctx.reason, targetId, ip: ctx.ip, cityId: opts.auditCity ?? null, owner: opts.owner ?? null, change: opts.change ?? null }, now);
    return { ok: true, data: { scope: { kind: "global", cityId: null }, admin, accountId: null } };
  }
  // 2) Owner signed-in session → global.
  const owner = ownerSessionAccount(db, ctx);
  if (owner) {
    const admin = ownerEmail();
    auditIfMeaningful(db, { admin, action, reason: ctx.reason, targetId, ip: ctx.ip, cityId: opts.auditCity ?? null, owner: opts.owner ?? null, change: opts.change ?? null }, now);
    return { ok: true, data: { scope: { kind: "global", cityId: null }, admin, accountId: owner.id } };
  }
  // 3) City Admin signed-in session → exactly one city.
  const user = sessionAccount(db, ctx);
  if (user && isCityAdminAccount(user)) {
    if (opts.globalOnly) return { ok: false, status: 401, error: "unauthorized" };
    const scopeCity = user.adminCityId!;
    if (opts.enforceCity !== undefined && opts.enforceCity !== null && scopeCity !== opts.enforceCity) {
      return { ok: false, status: 403, error: "city_scope_denied", message: "Your admin access is scoped to one city only." };
    }
    const admin = user.email;
    auditIfMeaningful(db, { admin, action, reason: ctx.reason, targetId, ip: ctx.ip, cityId: opts.auditCity ?? scopeCity, owner: opts.owner ?? null, change: opts.change ?? null }, now);
    return { ok: true, data: { scope: { kind: "city", cityId: scopeCity }, admin, accountId: user.id } };
  }
  return { ok: false, status: 401, error: "unauthorized" };
}

// ---------------------------------------------------- city admin management
// Global Admin ONLY (owner or key admin): assignment/revocation of the
// city_admin role with exactly one city scope. Never granted from any client
// payload — only these audited endpoints.

export interface CityAdminRow {
  accountId: string;
  name: string;
  email: string;
  cityId: string;
  assignedAt: string;
  roleBefore: AccountRole | null;
}

/** Global Admin list of current City Admin assignments. */
export function listCityAdmins(db: Db, ctx: AdminCtx, now = new Date()): AdminResult<CityAdminRow[]> {
  const auth = authorizeAdmin(db, ctx, "admin.city_admin_assign", null, now);
  if (!auth.ok) return auth;
  const rows: CityAdminRow[] = [];
  for (const rec of db.listAccounts()) {
    if (rec.deletedAt || !isCityAdminAccount(rec)) continue;
    // Assignment time comes from the most recent assign audit entry.
    const assignEntry = db
      .listAudit(500)
      .find((a) => a.action === "admin.city_admin_assign" && a.targetId === rec.id);
    rows.push({
      accountId: rec.id,
      name: rec.name,
      email: rec.email,
      cityId: rec.adminCityId!,
      assignedAt: assignEntry?.at ?? "",
      roleBefore: rec.rolePriorAdmin,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, data: rows };
}

/**
 * Global Admin assigns the city_admin role + exactly one city scope. The
 * target must be an existing, non-deleted account (any status — a Global Admin
 * may assign before the user completes verification; the scope takes effect on
 * their next admin action).
 */
export function assignCityAdmin(
  db: Db,
  ctx: AdminCtx,
  email: string,
  cityId: string,
  now = new Date(),
): AdminResult<{ row: CityAdminRow }> {
  const key = email.trim().toLowerCase();
  if (!key || key.length > 120) return { ok: false, status: 400, error: "invalid_email" };
  const rec = db.getAccountByEmail(key);
  if (!rec || rec.deletedAt) {
    return { ok: false, status: 404, error: "account_not_found", message: "No account found for that email." };
  }
  const city = db.getCity(cityId);
  if (!city) return { ok: false, status: 400, error: "invalid_city", message: "That city isn't in the registry." };
  // Authorize with the resolved target account so the audit entry carries it.
  const auth = authorizeScoped(db, ctx, "admin.city_admin_assign", rec.id, now, { globalOnly: true, auditCity: cityId });
  if (!auth.ok) return auth;
  if (isCityAdminAccount(rec) && rec.adminCityId === cityId) {
    // Re-assignment to the same city is a harmless no-op.
    const entry = db.listAudit(500).find((a) => a.action === "admin.city_admin_assign" && a.targetId === rec.id);
    return {
      ok: true,
      data: {
        row: { accountId: rec.id, name: rec.name, email: rec.email, cityId, assignedAt: entry?.at ?? now.toISOString(), roleBefore: rec.rolePriorAdmin },
      },
    };
  }
  const roleBefore = hasRole(rec, "city_admin") ? rec.rolePriorAdmin : rec.role;
  const updated = db.updateAccount(rec.id, {
    ...rolesPatch([...storedRoles(rec), "city_admin"]),
    adminCityId: cityId,
    rolePriorAdmin: roleBefore === "city_admin" ? null : roleBefore,
    // A Global Admin grant is explicit trust, but it never bypasses the
    // verification funnel: an account that has completed email + selfie and
    // is awaiting manual review is approved by this grant (the grant IS the
    // review decision). An account that has NOT completed the funnel stays
    // pending — the role takes effect once they verify like everyone else,
    // preserving the identity gate.
    ...(rec.status !== "verified" && rec.phase === "pending_review" && rec.selfieRef
      ? { status: "verified" as const, verifiedAt: now.toISOString() }
      : {}),
    lastActivityAt: now.toISOString(),
  })!;
  const entry = db.listAudit(500).find((a) => a.action === "admin.city_admin_assign" && a.targetId === rec.id);
  return { ok: true, data: { row: { accountId: updated.id, name: updated.name, email: updated.email, cityId: updated.adminCityId!, assignedAt: entry?.at ?? now.toISOString(), roleBefore: updated.rolePriorAdmin } } };
}

/** Global Admin revokes the city_admin role + scope, restoring the prior role. */
export function revokeCityAdmin(
  db: Db,
  ctx: AdminCtx,
  accountId: string,
  now = new Date(),
): AdminResult<{ accountId: string }> {
  const auth = authorizeAdmin(db, ctx, "admin.city_admin_revoke", accountId, now);
  if (!auth.ok) return auth;
  const rec = db.getAccount(accountId);
  if (!rec || rec.deletedAt) return { ok: false, status: 404, error: "not_found" };
  if (!isCityAdminAccount(rec)) return { ok: false, status: 409, error: "not_city_admin" };
  const restored = rec.rolePriorAdmin === "group_leader" ? "group_leader" : "runner";
  const prior = storedRoles(rec).filter((r) => r !== "city_admin");
  db.updateAccount(accountId, {
    ...rolesPatch(prior.length > 0 ? prior : [restored]),
    adminCityId: null,
    rolePriorAdmin: null,
    lastActivityAt: now.toISOString(),
  });
  const cityId = rec.adminCityId!;
  auditIfMeaningful(db, { admin: auth.data.admin, action: "admin.city_admin_revoke", reason: ctx.reason, targetId: accountId, ip: ctx.ip, cityId }, now);
  return { ok: true, data: { accountId } };
}

// ---------------------------------------------------- multi-role assignment
// PATCH /api/admin/accounts/:id/roles — the audited role editor backend. Set
// semantics: the caller sends the FULL desired role set (each UI toggle adds
// or removes exactly one role, then submits the whole array). The legacy
// single `role` field is kept in sync server-side (highest-ranked role).
//
// Permission boundaries (never client-settable):
//  - Global Admin (owner or key admin): may assign ANY role, including
//    site_admin, and may set the city_admin city scope.
//  - City Admin: may only ADD or REMOVE group_leader, and only for accounts
//    whose home city is the admin's own scope city. city_admin / site_admin
//    are permanently out of reach.
//  - Admin roles (city_admin / site_admin) require an identity-verified
//    target (verified, or a pending_review account that completed email +
//    selfie — the grant is the review decision, mirroring assignCityAdmin).
//  - The owner email can never be demoted below site_admin (site_admin is
//    owner-implied server-side regardless, and the stored set must agree).

export interface RolesAssignResult {
  accountId: string;
  roles: AccountRole[];
  role: AccountRole;
  adminCityId: string | null;
}

/** Identity gate for admin roles: verified, or completed email+selfie (pending_review). */
function identityReady(rec: AccountRecord): boolean {
  return rec.status === "verified" || (rec.status === "pending" && rec.phase === "pending_review" && Boolean(rec.selfieRef));
}

export function assignAccountRoles(
  db: Db,
  ctx: AdminCtx,
  accountId: string,
  input: { roles?: unknown; cityId?: unknown },
  now = new Date(),
): AdminResult<RolesAssignResult> {
  const raw = Array.isArray(input.roles) ? input.roles : null;
  if (!raw || raw.length === 0 || raw.some((r) => typeof r !== "string" || !ALL_ACCOUNT_ROLES.includes(r as AccountRole))) {
    return { ok: false, status: 400, error: "invalid_roles", message: "Roles must be a non-empty array of known roles." };
  }
  const desired = normalizeRoles(raw as AccountRole[]);
  const rec = db.getAccount(accountId);
  if (!rec || rec.deletedAt) return { ok: false, status: 404, error: "account_not_found" };

  // City scope for city_admin: required, and must be a registry city.
  let cityId: string | null = null;
  if (desired.includes("city_admin")) {
    const cid = typeof input.cityId === "string" && input.cityId.trim() ? input.cityId.trim() : rec.adminCityId ?? null;
    if (!cid || !db.getCity(cid)) {
      return { ok: false, status: 400, error: "invalid_city", message: "The city_admin role requires a valid city scope." };
    }
    cityId = cid;
  }

  const current = accountRoles(rec);
  const change = `roles: ${current.join(",") || "none"} -> ${desired.join(",")}${cityId ? `; city: ${cityId}` : ""}`;

  // Audit the attempt with the before/after summary (written on success).
  const auth = authorizeScoped(db, ctx, "admin.roles_assign", rec.id, now, {
    auditCity: cityId ?? rec.cityId ?? null,
    change,
  });
  if (!auth.ok) return auth;

  if (auth.data.scope.kind === "city") {
    // City Admin: group_leader toggles only, own city only.
    const scopeCity = auth.data.scope.cityId!;
    if (rec.cityId !== scopeCity) {
      return { ok: false, status: 403, error: "city_scope_denied", message: "City Admins may only manage roles of accounts in their own city." };
    }
    const removed = current.filter((r) => !desired.includes(r));
    const added = desired.filter((r) => !current.includes(r));
    if (removed.some((r) => r !== "group_leader") || added.some((r) => r !== "group_leader")) {
      return { ok: false, status: 403, error: "roles_out_of_scope", message: "City Admins may only add or remove the group_leader role within their own city." };
    }
  }

  // The owner can never be demoted below site_admin.
  if (isOwnerEmail(rec.email) && !desired.includes("site_admin")) {
    return { ok: false, status: 409, error: "owner_cannot_demote", message: "The owner account always holds site_admin and cannot be demoted." };
  }

  // Admin roles require an identity-verified target.
  if (desired.some((r) => ADMIN_ROLES.includes(r)) && !identityReady(rec)) {
    return { ok: false, status: 409, error: "verification_incomplete", message: "Admin roles (city_admin, site_admin) require an identity-verified target." };
  }

  const updated = db.updateAccount(rec.id, {
    ...rolesPatch(desired),
    adminCityId: desired.includes("city_admin") ? cityId : null,
    lastActivityAt: now.toISOString(),
    // Mirror assignCityAdmin: granting an admin role to an account that has
    // completed email + selfie (pending_review) IS the review decision.
    ...(desired.some((r) => ADMIN_ROLES.includes(r)) && rec.status !== "verified" && rec.phase === "pending_review" && rec.selfieRef
      ? { status: "verified" as const, verifiedAt: now.toISOString() }
      : {}),
  })!;
  return { ok: true, data: { accountId: updated.id, roles: accountRoles(updated), role: effectiveRole(updated), adminCityId: updated.adminCityId } };
}

/** Admin login — issues a session id (caller sets the cookie). */
export function adminLogin(
  db: Db,
  key: string | undefined,
  ip: string,
  now = new Date(),
): AdminResult<{ sessionId: string; admin: string }> {
  if (!adminConfigured()) {
    return { ok: false, status: 503, error: "admin_unconfigured" };
  }
  if (!key || !keyMatches(key, process.env[ADMIN_KEY_VAR]!)) {
    db.appendAudit({ admin: "unknown", action: "admin.login", reason: "Failed admin login attempt", targetId: null, ip }, now);
    return { ok: false, status: 401, error: "invalid_key" };
  }
  const session = db.createSession("__admin__", ip, now);
  db.appendAudit({ admin: adminEmail(), action: "admin.login", reason: "Admin signed in", targetId: null, ip }, now);
  return { ok: true, data: { sessionId: session.id, admin: adminEmail() } };
}

/** Admin search row — phone is MASKED; full record requires a separate view. */
export interface AdminSearchRow {
  id: string;
  name: string;
  email: string;
  username: string | null;
  status: AccountRecord["status"];
  phase: AccountRecord["phase"] | null;
  phoneLast4: string | null;
  createdAt: string;
  verifiedAt: string | null;
  /** Trusted Member (manual trust / blue-check) state — display-only here. */
  trustedMember: boolean;
}

function searchRow(rec: AccountRecord): AdminSearchRow {
  const digits = (rec.phone ?? "").replace(/\D/g, "");
  return {
    id: rec.id,
    name: rec.name,
    email: rec.email,
    username: rec.username ?? null,
    status: rec.status,
    phase: rec.status === "pending" ? rec.phase : null,
    phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
    createdAt: rec.signupAt,
    verifiedAt: rec.verifiedAt,
    trustedMember: rec.trustedMember === true,
  };
}

/** Search by username/email only (never by phone — no phone-based discovery). */
export function adminSearch(
  db: Db,
  ctx: AdminCtx,
  query: string,
  now = new Date(),
): AdminResult<AdminSearchRow[]> {
  const auth = authorizeAdmin(db, routineAdminCtx(ctx), "admin.search", null, now);
  if (!auth.ok) return auth;
  const q = query.trim().toLowerCase();
  const rows = db
    .listAccounts()
    .filter((a) => !a.deletedAt && (a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q) || (a.username?.toLowerCase().includes(q) ?? false)))
    .slice(0, 25)
    .map(searchRow);
  return { ok: true, data: rows };
}

/** One row of the owner-only pending queue — redacted, never sensitive. */
export interface PendingQueueRow {
  id: string;
  name: string;
  email: string;
  phase: AccountRecord["phase"];
  /** Role the user requested at signup, if any. */
  requestedRole: AccountRecord["role"] | null;
  signupAt: string;
}

/**
 * Pending-user control center queue. OWNER-ONLY (key-based admin sessions are
 * rejected — see authorizeOwner). Rows expose only redacted public fields:
 * name, email, funnel phase, requested role, signup time. No phone, no selfie
 * reference, no IPs, no timestamps beyond signup.
 */
/** Read-only owner queue access. Reads are authorized but not audit mutations;
 * consequential decisions below still require authorizeAdmin + a reason. */
export function adminPending(db: Db, ctx: AdminCtx, now = new Date()): AdminResult<PendingQueueRow[]> {
  const auth = authorizeOwner(db, routineAdminCtx(ctx), "admin.pending_list", null, now);
  if (!auth.ok) return auth;
  const rows = db
    .listAccounts()
    .filter((a) => !a.deletedAt && a.status === "pending")
    .sort((a, b) => a.signupAt.localeCompare(b.signupAt))
    .map((rec) => ({
      id: rec.id,
      name: rec.name,
      email: rec.email,
      phase: rec.phase,
      requestedRole: rec.requestedRole,
      signupAt: rec.signupAt,
    }));
  return { ok: true, data: rows };
}

export interface AdminRecordView extends AdminSearchRow {
  phone: string | null;
  phoneVerifiedAt: string | null;
  selfieRef: string | null;
  selfieCapturedAt: string | null;
  signupIp: string | null;
  signupAt: string;
  lastActivityAt: string;
  loginIps: { ip: string; at: string }[];
  deletedAt: string | null;
  purgeAt: string | null;
  purgedAt: string | null;
  retentionYears: number;
  canViewSelfie: boolean;
  /** The applicant-facing reason stored at rejection (admin-set, admin-viewable). */
  rejectionReason: string | null;
  /** Set when this account was previously rejected and has since resubmitted with the same email - gives full context on the new submission without it looking like an active rejection. */
  priorRejectionReason: string | null;
  /** Home city id (admin view — used by the role editor's city scoping). */
  cityId: string | null;
  /** Full multi-role set (effective — owner-implied site_admin included). */
  roles: AccountRole[];
  /** City Admin scope, when the account holds city_admin. */
  adminCityId: string | null;
  /** Server-derived owner flag (RUN_LOCAL_OWNER_EMAIL) — the owner can never be demoted below site_admin. */
  isOwner: boolean;
}

export function adminGetRecord(
  db: Db,
  ctx: AdminCtx,
  id: string,
  now = new Date(),
): AdminResult<AdminRecordView> {
  const auth = authorizeAdmin(db, ctx, "admin.view_record", id, now);
  if (!auth.ok) return auth;
  const rec = db.getAccount(id);
  if (!rec) return { ok: false, status: 404, error: "not_found" };
  const digits = (rec.phone ?? "").replace(/\D/g, "");
  return {
    ok: true,
    data: {
      id: rec.id,
      name: rec.name,
      email: rec.email,
      username: rec.username ?? null,
      status: rec.status,
      phase: rec.status === "pending" ? rec.phase : null,
      phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
      createdAt: rec.signupAt,
      verifiedAt: rec.verifiedAt,
      trustedMember: rec.trustedMember === true,
      phone: rec.phone,
      phoneVerifiedAt: rec.phoneVerifiedAt,
      selfieRef: rec.selfieRef,
      selfieCapturedAt: rec.selfieCapturedAt,
      signupIp: rec.signupIp,
      signupAt: rec.signupAt,
      lastActivityAt: rec.lastActivityAt,
      loginIps: rec.loginIps,
      deletedAt: rec.deletedAt,
      purgeAt: rec.purgeAt,
      purgedAt: rec.purgedAt,
      retentionYears: rec.retentionYears,
      canViewSelfie: Boolean(rec.selfieRef && rec.selfieRef.endsWith(".jpg")),
      rejectionReason: rec.rejectionReason ?? null,
      priorRejectionReason: rec.priorRejectionReason ?? null,
      cityId: rec.cityId ?? null,
      roles: accountRoles(rec),
      adminCityId: rec.adminCityId ?? null,
      isOwner: isOwnerEmail(rec.email),
    },
  };
}

/** Authorize + fetch the selfie for an admin view (audited). */
export async function adminViewSelfie(
  db: Db,
  ctx: AdminCtx,
  id: string,
  now = new Date(),
): Promise<AdminResult<{ filename: string; buffer: Buffer }>> {
  const auth = authorizeAdmin(db, ctx, "admin.view_selfie", id, now);
  if (!auth.ok) return auth;
  const rec = db.getAccount(id);
  if (!rec?.selfieRef) return { ok: false, status: 404, error: "no_selfie" };
  const buffer = await db.readPrivateUpload(rec.selfieRef);
  if (!buffer) return { ok: false, status: 404, error: "no_selfie" };
  return { ok: true, data: { filename: rec.selfieRef, buffer } };
}

export function adminSetStatus(
  db: Db,
  ctx: AdminCtx,
  id: string,
  status: "verified" | "rejected",
  now = new Date(),
  role: AccountRole = "runner",
  rejectionReason: string | null = null,
): AdminResult<AccountRecord> {
  // Approving is a routine super-admin action: the audit log still records the
  // action with the admin identity + timestamp, but no typed reason is forced —
  // when the operator supplies none, the audit entry carries the system label.
  // Rejection keeps a REQUIRED operator reason, which is applicant-facing.
  const authCtx = status === "verified" ? routineAdminCtx(ctx, "Routine approval") : ctx;
  const auth = authorizeAdmin(db, authCtx, status === "verified" ? "admin.approve" : "admin.reject", id, now);
  if (!auth.ok) return auth;
  const rec = db.getAccount(id);
  if (!rec) return { ok: false, status: 404, error: "not_found" };
  if (rec.deletedAt) return { ok: false, status: 409, error: "account_deleted" };
  if (status === "verified") {
    // Honesty gate: an account can only be approved as Verified after the
    // email code AND live selfie steps completed (phase "pending_review" is
    // set exclusively by the selfie endpoint, after the image was stored).
    // There is no approval without the required verification state.
    if (rec.phase !== "pending_review" || !rec.selfieRef) {
      return { ok: false, status: 409, error: "verification_incomplete", message: "This user has not completed email + selfie verification yet — approval requires the pending_review state." };
    }
    if (role !== "runner" && role !== "group_leader") role = "runner";
  }
  if (status === "rejected" && !rejectionReason) {
    return { ok: false, status: 400, error: "reason_required", message: "A rejection reason (min 5 characters) is required — it is shown to the applicant." };
  }
  const updated = db.updateAccount(id, {
    status,
    verifiedAt: status === "verified" ? now.toISOString() : null,
    role: status === "verified" ? role : rec.role,
    // Approval grants the chosen role into the multi-role set (role stays in
    // sync as the highest-ranked member; rejection leaves roles untouched).
    ...(status === "verified" ? addRolePatch(rec, role) : {}),
    // Rejection is a revocation of any current verified/badge presentation:
    // the account must never keep a Verified or Trusted presentation it no
    // longer has. Audit history (authorizeAdmin above) preserves the full
    // trail; only the current-state fields are cleared here.
    trustedMember: status === "rejected" ? false : rec.trustedMember,
    trustedMemberAt: status === "rejected" ? null : rec.trustedMemberAt,
    // A rejected account's chosen username is released back into the pool -
    // it was never earned, and holding it hostage forever blocks both other
    // people AND this same person (on resubmission) from ever using it.
    username: status === "rejected" ? null : rec.username,
    rejectionReason: status === "rejected" ? rejectionReason : null,
    lastActivityAt: now.toISOString(),
  })!;
  try {
    if (db.getNotificationPreferences(updated.id).account_alerts) {
      db.addNotification({
        id: newId(),
        accountId: updated.id,
        category: "account_alerts",
        title: status === "verified" ? "You're verified!" : "Verification update",
        body: status === "verified" ? "Your identity is verified — you're all set to join runs and connect with other runners." : (rejectionReason ?? "Your verification submission was not approved."),
        createdAt: now.toISOString(),
        readAt: null,
        link: { kind: "verify", id: updated.id },
      });
    }
    if (status === "verified") {
      void sendEmail({ to: updated.email, subject: "You're verified on Kimbio!", html: verifiedEmailHtml(updated.name) }).catch(() => {});
    }
  } catch {
    // Notification/email side-effects must never fail the approval itself —
    // the account status change above already succeeded and is what matters.
  }
  void db.persist();
  return { ok: true, data: updated };
}

/**
 * Reverts a rejected account back to pending review - a real "undo" button,
 * not a workaround. Restores phase to "pending_review" (the state
 * rejection came from, since only accounts that completed email+selfie can
 * be rejected in the first place) and clears rejectionReason so it shows up
 * fresh in the review queue. Does NOT restore a released username - it may
 * have been claimed by someone else in the meantime, so the person picks a
 * new one if needed, same as any account with no username yet.
 */
export function adminUndoRejection(db: Db, ctx: AdminCtx, id: string, now = new Date()): AdminResult<AccountRecord> {
  const auth = authorizeAdmin(db, ctx, "admin.undo_rejection", id, now);
  if (!auth.ok) return auth;
  const rec = db.getAccount(id);
  if (!rec) return { ok: false, status: 404, error: "not_found" };
  if (rec.deletedAt) return { ok: false, status: 409, error: "account_deleted" };
  if (rec.status !== "rejected") return { ok: false, status: 409, error: "not_rejected", message: "This account isn't currently rejected." };
  const updated = db.updateAccount(id, {
    status: "pending",
    phase: "pending_review",
    rejectionReason: null,
    lastActivityAt: now.toISOString(),
  })!;
  void db.persist();
  return { ok: true, data: updated };
}

export function adminDeleteAccount(
  db: Db,
  ctx: AdminCtx,
  id: string,
  now = new Date(),
): AdminResult<{ id: string }> {
  const auth = authorizeAdmin(db, ctx, "admin.delete", id, now);
  if (!auth.ok) return auth;
  const rec = db.getAccount(id);
  if (!rec) return { ok: false, status: 404, error: "not_found" };
  if (rec.selfieRef) void db.deletePrivateUpload(rec.selfieRef);
  if (rec.profilePhotoRef) void db.deletePublicUpload(rec.profilePhotoRef);
  db.removeAccount(rec.id);
  db.deleteSessionsForAccount(rec.id);
  void db.persist();
  return { ok: true, data: { id: rec.id } };
}

/**
 * Preview for the "purge everyone except the owner" action - owner-only,
 * lists exactly who would be deleted without deleting anything. The
 * protected email is ALWAYS the server-configured owner email
 * (RUN_LOCAL_OWNER_EMAIL) - never a client-supplied value, so there's no way
 * to typo your way into deleting the wrong account or protecting the wrong one.
 */
export function adminPurgePreview(db: Db, ctx: AdminCtx, now = new Date()): AdminResult<{ count: number; emails: string[] }> {
  const auth = authorizeOwner(db, ctx, "admin.purge_all", null, now);
  if (!auth.ok) return auth;
  const protectedEmail = ownerEmail().trim().toLowerCase();
  const targets = db.listAccounts().filter((a) => a.email.trim().toLowerCase() !== protectedEmail);
  return { ok: true, data: { count: targets.length, emails: targets.map((a) => a.email) } };
}

/**
 * Deletes every account except the owner's. Irreversible, so this requires
 * two things beyond normal admin auth: an exact literal confirmation string
 * ("DELETE ALL"), and the caller's expectedCount must match the CURRENT real
 * count at execution time - if someone signed up between the preview and
 * this call, the count won't match and the action safely refuses rather than
 * deleting a possibly-different set than what was actually previewed.
 * Reuses the same per-account cleanup as adminDeleteAccount (selfie/photo
 * uploads, sessions) so bulk deletion behaves identically to deleting one
 * account at a time, not a separate, less-tested code path.
 */
export function adminPurgeAllExceptOwner(db: Db, ctx: AdminCtx, confirmText: string, expectedCount: number, now = new Date()): AdminResult<{ deletedCount: number; deletedEmails: string[] }> {
  const auth = authorizeOwner(db, ctx, "admin.purge_all", null, now);
  if (!auth.ok) return auth;
  if (confirmText !== "DELETE ALL") {
    return { ok: false, status: 400, error: "confirmation_required", message: 'Type exactly "DELETE ALL" to confirm.' };
  }
  const protectedEmail = ownerEmail().trim().toLowerCase();
  const targets = db.listAccounts().filter((a) => a.email.trim().toLowerCase() !== protectedEmail);
  if (targets.length !== expectedCount) {
    return {
      ok: false,
      status: 409,
      error: "count_changed",
      message: `Expected ${expectedCount} accounts but found ${targets.length} now - someone may have signed up. Reload the preview and try again.`,
    };
  }
  const deletedEmails: string[] = [];
  for (const rec of targets) {
    if (rec.selfieRef) void db.deletePrivateUpload(rec.selfieRef);
    if (rec.profilePhotoRef) void db.deletePublicUpload(rec.profilePhotoRef);
    db.removeAccount(rec.id);
    db.deleteSessionsForAccount(rec.id);
    deletedEmails.push(rec.email);
  }
  void db.persist();
  return { ok: true, data: { deletedCount: deletedEmails.length, deletedEmails } };
}

export function adminExportRows(
  db: Db,
  ctx: AdminCtx,
  query: string,
  now = new Date(),
): AdminResult<{ rows: AdminRecordView[] }> {
  const auth = authorizeAdmin(db, ctx, "admin.export", null, now);
  if (!auth.ok) return auth;
  const q = query.trim().toLowerCase();
  const rows = db
    .listAccounts()
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q))
    .map((rec) => {
      const digits = (rec.phone ?? "").replace(/\D/g, "");
      return {
        id: rec.id,
        name: rec.name,
        email: rec.email,
        username: rec.username ?? null,
        status: rec.status,
        phase: rec.status === "pending" ? rec.phase : null,
        phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
        createdAt: rec.signupAt,
        verifiedAt: rec.verifiedAt,
        trustedMember: rec.trustedMember === true,
        phone: rec.phone,
        phoneVerifiedAt: rec.phoneVerifiedAt,
        selfieRef: rec.selfieRef,
        selfieCapturedAt: rec.selfieCapturedAt,
        signupIp: rec.signupIp,
        signupAt: rec.signupAt,
        lastActivityAt: rec.lastActivityAt,
        loginIps: rec.loginIps,
        deletedAt: rec.deletedAt,
        purgeAt: rec.purgeAt,
        purgedAt: rec.purgedAt,
        retentionYears: rec.retentionYears,
        canViewSelfie: Boolean(rec.selfieRef && rec.selfieRef.endsWith(".jpg")),
        rejectionReason: rec.rejectionReason ?? null,
        priorRejectionReason: rec.priorRejectionReason ?? null,
        cityId: rec.cityId ?? null,
        roles: accountRoles(rec),
        adminCityId: rec.adminCityId ?? null,
        isOwner: isOwnerEmail(rec.email),
      } satisfies AdminRecordView;
    });
  return { ok: true, data: { rows } };
}

/** CSV export (audited). CSV is sufficient for the safety tool; PDF adds risk. */
export function toCsv(rows: AdminRecordView[]): string {
  const header = [
    "id",
    "name",
    "email",
    "status",
    "phase",
    "phone",
    "phone_verified_at",
    "selfie_ref",
    "selfie_captured_at",
    "signup_at",
    "signup_ip",
    "last_activity_at",
    "verified_at",
    "deleted_at",
    "purge_at",
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.name,
        r.email,
        r.status,
        r.phase ?? "",
        r.phone ?? "",
        r.phoneVerifiedAt ?? "",
        r.selfieRef ?? "",
        r.selfieCapturedAt ?? "",
        r.signupAt,
        r.signupIp ?? "",
        r.lastActivityAt,
        r.verifiedAt ?? "",
        r.deletedAt ?? "",
        r.purgeAt ?? "",
      ]
        .map(esc)
        .join(","),
    );
  }
  return "\uFEFF" + lines.join("\r\n");
}

export function adminAuditLog(db: Db, ctx: AdminCtx, limit = 100, now = new Date()): AdminResult<ReturnType<Db["listAudit"]>> {
  // Audit-log read is a ROUTINE READ (like content/submission/event lists):
  // audited, but no operator-entered reason is required.
  const auth = authorizeAdmin(db, routineAdminCtx(ctx), "admin.audit", null, now);
  if (!auth.ok) return auth;
  return { ok: true, data: db.listAudit(limit) };
}

/**
 * City Admin audit view — ONLY entries concerning the admin's scope city
 * (their own actions and any other city-scoped entry for that city). Global
 * audit records (no cityId) are never visible to City Admins. The access
 * itself is reason-required and audited as `cityadmin.audit`.
 */
export function cityAdminAudit(db: Db, ctx: AdminCtx, limit = 100, now = new Date()): AdminResult<ReturnType<Db["listAudit"]>> {
  const auth = authorizeScoped(db, ctx, "cityadmin.audit", null, now);
  if (!auth.ok) return auth;
  const cityId = auth.data.scope.kind === "city" ? auth.data.scope.cityId : null;
  if (cityId === null) return { ok: false, status: 403, error: "city_scope_denied" };
  const rows = db
    .listAudit(Math.min(limit, 500))
    .filter((a) => a.cityId === cityId || (a.admin === auth.data.admin && a.cityId === cityId));
  return { ok: true, data: rows };
}

/**
 * Resolve the admin access level for the current request WITHOUT auditing —
 * the client probe used by the Admin UI to render the right surface
 * (global admin control center vs city-admin panel vs nothing).
 */
export type AdminAccessLevel =
  | { level: "global_admin"; admin: string }
  | { level: "city_admin"; admin: string; cityId: string; accountId: string }
  | { level: "none" };

export function adminAccessLevel(db: Db, ctx: AdminCtx): AdminAccessLevel {
  const adminSession = ctx.adminSessionId ? db.getSession(ctx.adminSessionId) : undefined;
  if (adminSession && adminSession.accountId === "__admin__") {
    return adminConfigured() ? { level: "global_admin", admin: adminEmail() } : { level: "none" };
  }
  const owner = ownerSessionAccount(db, ctx);
  if (owner) return { level: "global_admin", admin: ownerEmail() };
  const user = sessionAccount(db, ctx);
  if (user && isCityAdminAccount(user)) {
    return { level: "city_admin", admin: user.email, cityId: user.adminCityId!, accountId: user.id };
  }
  return { level: "none" };
}
