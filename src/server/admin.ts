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
import { isOwnerEmail, ownerEmail } from "./owner";

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

/** Routine reads remain audited, but do not require an operator-entered reason. */
export function routineAdminCtx(ctx: AdminCtx): AdminCtx {
  return { ...ctx, reason: ctx.reason?.trim() || "Routine admin read" };
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
export function authorizeAdmin(
  db: Db,
  ctx: AdminCtx,
  action: AdminAction,
  targetId: string | null,
  now = new Date(),
): AdminResult<{ admin: string }> {
  if (!validReason(ctx.reason)) {
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
    db.appendAudit(
      {
        admin,
        action,
        reason: ctx.reason!.trim().slice(0, REASON_MAX),
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
    db.appendAudit(
      {
        admin,
        action,
        reason: ctx.reason!.trim().slice(0, REASON_MAX),
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
  if (!validReason(ctx.reason)) {
    return { ok: false, status: 400, error: "reason_required" };
  }
  if (!ownerSessionAccount(db, ctx)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  const admin = ownerEmail();
  db.appendAudit(
    {
      admin,
      action,
      reason: ctx.reason!.trim().slice(0, REASON_MAX),
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
  /** Run Local account id (null for key-admin sessions). */
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
  return rec.role === "city_admin" && typeof rec.adminCityId === "string" && rec.adminCityId.length > 0;
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
  if (!validReason(ctx.reason)) {
    return { ok: false, status: 400, error: "reason_required" };
  }
  // 1) Key admin → global.
  const adminSession = ctx.adminSessionId ? db.getSession(ctx.adminSessionId) : undefined;
  if (adminSession && adminSession.accountId === "__admin__") {
    if (!adminConfigured()) {
      return { ok: false, status: 503, error: "admin_unconfigured" };
    }
    const admin = adminEmail();
    db.appendAudit({ admin, action, reason: ctx.reason!.trim().slice(0, REASON_MAX), targetId, ip: ctx.ip, cityId: opts.auditCity ?? null, owner: opts.owner ?? null, change: opts.change ?? null }, now);
    return { ok: true, data: { scope: { kind: "global", cityId: null }, admin, accountId: null } };
  }
  // 2) Owner signed-in session → global.
  const owner = ownerSessionAccount(db, ctx);
  if (owner) {
    const admin = ownerEmail();
    db.appendAudit({ admin, action, reason: ctx.reason!.trim().slice(0, REASON_MAX), targetId, ip: ctx.ip, cityId: opts.auditCity ?? null, owner: opts.owner ?? null, change: opts.change ?? null }, now);
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
    db.appendAudit({ admin, action, reason: ctx.reason!.trim().slice(0, REASON_MAX), targetId, ip: ctx.ip, cityId: opts.auditCity ?? scopeCity, owner: opts.owner ?? null, change: opts.change ?? null }, now);
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
  const roleBefore = rec.role === "city_admin" ? rec.rolePriorAdmin : rec.role;
  const updated = db.updateAccount(rec.id, {
    role: "city_admin",
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
  db.updateAccount(accountId, { role: restored, adminCityId: null, rolePriorAdmin: null, lastActivityAt: now.toISOString() });
  const cityId = rec.adminCityId!;
  db.appendAudit({ admin: auth.data.admin, action: "admin.city_admin_revoke", reason: ctx.reason!.trim().slice(0, REASON_MAX), targetId: accountId, ip: ctx.ip, cityId }, now);
  return { ok: true, data: { accountId } };
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
): AdminResult<AccountRecord> {
  const auth = authorizeAdmin(db, ctx, status === "verified" ? "admin.approve" : "admin.reject", id, now);
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
  const updated = db.updateAccount(id, {
    status,
    verifiedAt: status === "verified" ? now.toISOString() : rec.verifiedAt,
    role: status === "verified" ? role : rec.role,
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
  const auth = authorizeAdmin(db, ctx, "admin.audit", null, now);
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
