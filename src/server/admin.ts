/**
 * Admin-only safety tool — server-side authorization & handlers.
 *
 * Auth model (no identity provider in this build):
 *  - `RUN_LOCAL_ADMIN_KEY` (env, secret) unlocks the admin UI. The key is
 *    POSTed once; on success the server issues an HttpOnly admin session
 *    cookie. The key itself is never stored client-side.
 *  - `RUN_LOCAL_ADMIN_EMAIL` (env, non-secret) names the admin for the audit
 *    log (default "admin@runlocal.app").
 *  - Every lookup/export/approve/reject/delete/purge requires BOTH an admin
 *    session AND a free-form reason (5–500 chars). Every access is appended
 *    to the audit log with admin/timestamp/reason/action.
 *
 * Handlers are pure functions over (Db, ctx) so authorization and audit
 * behavior are unit-testable without HTTP.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { AccountRecord, AdminAction } from "./types";
import type { Db } from "./store";

export const ADMIN_KEY_VAR = "RUN_LOCAL_ADMIN_KEY";
export const ADMIN_EMAIL_VAR = "RUN_LOCAL_ADMIN_EMAIL";
export const REASON_MIN = 5;
export const REASON_MAX = 500;

export interface AdminCtx {
  /** Admin session id from the HttpOnly cookie, or null. */
  adminSessionId: string | null;
  /** The reason header supplied with the request, or undefined. */
  reason?: string;
  ip: string;
}

export type AdminResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export function adminConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env[ADMIN_KEY_VAR]);
}

export function adminEmail(env: Record<string, string | undefined> = process.env): string {
  return env[ADMIN_EMAIL_VAR]?.trim() || "admin@runlocal.app";
}

export function validReason(reason: string | undefined): boolean {
  return Boolean(reason && reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX);
}

export function keyMatches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Authorize an admin *action* (not login). Returns the admin email on success
 * and appends the audit entry. All sensitive actions go through this.
 */
export function authorizeAdmin(
  db: Db,
  ctx: AdminCtx,
  action: AdminAction,
  targetId: string | null,
  now = new Date(),
): AdminResult<{ admin: string }> {
  if (!adminConfigured()) {
    return {
      ok: false,
      status: 503,
      error: "admin_unconfigured",
    };
  }
  const session = ctx.adminSessionId ? db.getSession(ctx.adminSessionId) : undefined;
  if (!session || session.accountId !== "__admin__") {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (!validReason(ctx.reason)) {
    return {
      ok: false,
      status: 400,
      error: "reason_required",
    };
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
  status: AccountRecord["status"];
  phase: AccountRecord["phase"] | null;
  phoneLast4: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

function searchRow(rec: AccountRecord): AdminSearchRow {
  const digits = (rec.phone ?? "").replace(/\D/g, "");
  return {
    id: rec.id,
    name: rec.name,
    email: rec.email,
    status: rec.status,
    phase: rec.status === "pending" ? rec.phase : null,
    phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
    createdAt: rec.signupAt,
    verifiedAt: rec.verifiedAt,
  };
}

/** Search by username/email only (never by phone — no phone-based discovery). */
export function adminSearch(
  db: Db,
  ctx: AdminCtx,
  query: string,
  now = new Date(),
): AdminResult<AdminSearchRow[]> {
  const auth = authorizeAdmin(db, ctx, "admin.search", null, now);
  if (!auth.ok) return auth;
  const q = query.trim().toLowerCase();
  const rows = db
    .listAccounts()
    .filter((a) => !a.deletedAt && (a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)))
    .slice(0, 25)
    .map(searchRow);
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
      status: rec.status,
      phase: rec.status === "pending" ? rec.phase : null,
      phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
      createdAt: rec.signupAt,
      verifiedAt: rec.verifiedAt,
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
): AdminResult<AccountRecord> {
  const auth = authorizeAdmin(db, ctx, status === "verified" ? "admin.approve" : "admin.reject", id, now);
  if (!auth.ok) return auth;
  const rec = db.getAccount(id);
  if (!rec) return { ok: false, status: 404, error: "not_found" };
  if (rec.deletedAt) return { ok: false, status: 409, error: "account_deleted" };
  const updated = db.updateAccount(id, {
    status,
    verifiedAt: status === "verified" ? now.toISOString() : rec.verifiedAt,
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
        status: rec.status,
        phase: rec.status === "pending" ? rec.phase : null,
        phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
        createdAt: rec.signupAt,
        verifiedAt: rec.verifiedAt,
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
