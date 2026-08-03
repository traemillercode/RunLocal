/**
 * HTTP API layer for the Run Local identity & safety features.
 *
 * Served by serve.ts on the same origin as the SPA (port 3000). All /api
 * responses are `Cache-Control: no-store`; state-changing endpoints require
 * SameSite=Lax HttpOnly cookies set by this server. No provider secrets ever
 * reach the client, and no sensitive verification value (phone, selfie ref,
 * IP) is ever included in a public payload or written to logs.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Db, normalizePhone, EMAIL_SEND_LIMIT, EMAIL_SEND_WINDOW_MS, MAX_CODE_ATTEMPTS, codesEqual, hashCode, toPublicAccount, MIN_AGE } from "./store";
import { sendVerificationEmail, emailConfig } from "./email";
import {
  adminConfigured,
  adminEmail,
  adminExportRows,
  adminAuditLog,
  adminDeleteAccount,
  adminGetRecord,
  adminLogin,
  adminSearch,
  adminSetStatus,
  adminViewSelfie,
  toCsv,
  validReason,
} from "./admin";
import { purgeEligible, retentionStatus, deleteAccount as scrubAccount } from "./retention";

export const SESSION_COOKIE = "runlocal_sid";
export const ADMIN_COOKIE = "runlocal_admin";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_JSON_BODY = 6 * 1024 * 1024; // 6 MB (selfie uploads)
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB decoded

// In-memory rate limiting (documented: replace with a shared store at scale).
const emailSendLog = new Map<string, number[]>();
const adminLoginAttempts = new Map<string, number[]>();

export interface ApiDeps {
  db: Db;
}

export interface ApiError {
  status: number;
  error: string;
  message?: string;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function err(res: ServerResponse, e: ApiError): void {
  json(res, e.status, { error: e.error, message: e.message });
}

function ok(res: ServerResponse, body: unknown): void {
  json(res, 200, body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_JSON_BODY) {
      const e = new Error("body_too_large") as Error & { status: number };
      e.status = 413;
      throw e;
    }
    chunks.push(buf);
  }
  if (total === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function setCookie(res: ServerResponse, name: string, value: string, secure: boolean, maxAgeSec?: number): void {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    maxAgeSec !== undefined ? `Max-Age=${maxAgeSec}` : "",
  ].filter(Boolean);
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(res: ServerResponse, name: string, secure: boolean): void {
  setCookie(res, name, "", secure, 0);
}

function getIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

function isSecure(req: IncomingMessage): boolean {
  const encrypted = (req.socket as { encrypted?: boolean }).encrypted === true;
  return encrypted || req.headers["x-forwarded-proto"] === "https";
}

/**
 * CSRF guard. The app is commonly behind a TLS-terminating proxy, so the
 * origin's public host cannot be compared only with the origin server's
 * internal Host header. Keep the production origin explicit and allow
 * same-host requests for local/custom deployments; never accept arbitrary
 * origins or forwarded host values as an allow-list.
 */
export function isAllowedOrigin(origin: string | undefined, requestHost: string | undefined): boolean {
  if (!origin) return true; // non-browser clients (curl, tests) are fine
  try {
    const parsed = new URL(origin);
    if (parsed.origin === "https://runlocal.ctonew.app") return true;
    if (!requestHost) return false;
    return parsed.host === requestHost;
  } catch {
    return false;
  }
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  return isAllowedOrigin(typeof origin === "string" ? origin : undefined, typeof host === "string" ? host : undefined);
}

function rateLimited(map: Map<string, number[]>, key: string, limit: number, windowMs: number, now: number): boolean {
  const window = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  if (window.length >= limit) return true;
  window.push(now);
  map.set(key, window);
  return false;
}

/** Decode + validate an image data URL. Returns { ok, bytes, error }. */
function decodeImage(dataUrl: string): { ok: true; bytes: Buffer; ext: string } | { ok: false; error: string } {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!m) return { ok: false, error: "invalid_image" };
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const bytes = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  if (bytes.length === 0) return { ok: false, error: "invalid_image" };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: "image_too_large" };
  return { ok: true, bytes, ext };
}

function requireSession(db: Db, cookies: Record<string, string>): { accountId: string; sessionId: string } | null {
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;
  const session = db.getSession(sid);
  if (!session || session.accountId === "__admin__") return null;
  return { accountId: session.accountId, sessionId: sid };
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
  url: URL,
): Promise<boolean> {
  const method = req.method ?? "GET";
  const cookies = parseCookies(req);
  const ip = getIp(req);
  const secure = isSecure(req);
  const now = new Date();

  // ---- health (non-sensitive config booleans for the UI) -----------------
  if (method === "GET" && url.pathname === "/api/health") {
    return ok(res, {
      ok: true,
      emailConfigured: emailConfig().configured,
      emailMissing: emailConfig().missing,
      adminConfigured: adminConfigured(),
      retentionYears: db.retentionYears,
      retention: retentionStatus(db, now),
    }), true;
  }

  // ---- current user (public-safe) ----------------------------------------
  if (method === "GET" && url.pathname === "/api/me") {
    const sess = requireSession(db, cookies);
    if (!sess) return ok(res, { status: "guest" }), true;
    const rec = db.getAccount(sess.accountId);
    if (!rec || rec.deletedAt) {
      clearCookie(res, SESSION_COOKIE, secure);
      return ok(res, { status: "guest" }), true;
    }
    const session = db.getSession(sess.sessionId);
    if (session) session.lastSeenAt = now.toISOString();
    return ok(res, { status: "signed_in", account: toPublicAccount(rec) }), true;
  }

  if (method === "POST" && !originAllowed(req)) {
    return err(res, { status: 403, error: "forbidden" }), true;
  }

  // ---- account creation (signup completion) ------------------------------
  if (method === "POST" && url.pathname === "/api/accounts") {
    const body = (await readJson(req)) as { name?: unknown; email?: unknown; phone?: unknown; birthdate?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : null;
    const birthdate = typeof body.birthdate === "string" ? body.birthdate : "";
    const ageCutoff = new Date(now.getFullYear() - MIN_AGE, now.getMonth(), now.getDate());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate) || Number.isNaN(new Date(`${birthdate}T00:00:00Z`).getTime()) || new Date(`${birthdate}T00:00:00Z`) > ageCutoff) return err(res, { status: 400, error: "minimum_age", message: `You must be at least ${MIN_AGE} to join.` }), true;
    if (name.length < 1 || name.length > 60) return err(res, { status: 400, error: "invalid_name" }), true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
      return err(res, { status: 400, error: "invalid_email" }), true;
    }
    const existing = db.getAccountByEmail(email);
    if (existing && !existing.deletedAt) return err(res, { status: 409, error: "email_taken" }), true;
    if (typeof body.phone === "string" && !phone) return err(res, { status: 400, error: "invalid_phone" }), true;
    const rec = db.createAccount({ name, email, phone, birthdate });
    rec.signupIp = ip;
    rec.signupAt = now.toISOString();
    db.appendLoginIp(rec.id, ip, now);
    const session = db.createSession(rec.id, ip, now);
    setCookie(res, SESSION_COOKIE, session.id, secure, 60 * 60 * 24 * 30);
    await db.persist();
    return ok(res, { account: toPublicAccount(rec) }), true;
  }

  // ---- send email code ----------------------------------------------------
  if (method === "POST" && url.pathname === "/api/verify/start") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(sess.accountId);
    if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (rec.status !== "pending" || (rec.phase !== "email" && rec.phase !== "code")) return err(res, { status: 409, error: "wrong_step" }), true;
    // Fail before rate limiting or creating a code when deployment config is absent.
    // This keeps an unavailable provider from consuming the user's resend budget.
    const emailStatus = emailConfig();
    if (!emailStatus.configured) {
      return err(res, {
        status: 503,
        error: "email_unconfigured",
        message: `Email provider is not configured (${emailStatus.missing.join(", ")}). No code was sent.`,
      }), true;
    }
    if (rateLimited(emailSendLog, rec.email, EMAIL_SEND_LIMIT, EMAIL_SEND_WINDOW_MS, now.getTime())) return err(res, { status: 429, error: "rate_limited" }), true;
    const { code } = db.createCode(rec.id, rec.email, now);
    const sent = await sendVerificationEmail(rec.email, code);
    if (!sent.ok) { db.deleteCode(rec.id); return err(res, { status: sent.kind === "unconfigured" ? 503 : 502, error: sent.kind === "unconfigured" ? "email_unconfigured" : "email_send_failed", message: sent.message }), true; }
    db.updateAccount(rec.id, { phase: "code" }); await db.persist();
    return ok(res, { status: "code_sent", resendInSec: 30 }), true;
  }

  // ---- verify email code --------------------------------------------------
  if (method === "POST" && url.pathname === "/api/verify/check") {
    const sess = requireSession(db, cookies); if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { code?: unknown }; const code = typeof body.code === "string" ? body.code.replace(/\D/g, "") : "";
    const rec = db.getAccount(sess.accountId); if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (rec.phase !== "code") return err(res, { status: 409, error: "wrong_step" }), true;
    const codeRec = db.getCode(rec.id); if (!codeRec || new Date(codeRec.expiresAt).getTime() < now.getTime()) return err(res, { status: 410, error: "code_expired" }), true;
    codeRec.attempts += 1; if (codeRec.attempts > MAX_CODE_ATTEMPTS) { db.deleteCode(rec.id); return err(res, { status: 429, error: "too_many_attempts" }), true; }
    if (!codesEqual(hashCode(code, codeRec.salt), codeRec.hash)) { await db.persist(); return err(res, { status: 401, error: "invalid_code" }), true; }
    db.deleteCode(rec.id); db.updateAccount(rec.id, { phase: "selfie", lastActivityAt: now.toISOString() }); db.appendLoginIp(rec.id, ip, now); await db.persist();
    return ok(res, { status: "email_verified", next: "selfie" }), true;
  }

  // ---- selfie submission (server-side verification request contract) -----
  if (method === "POST" && url.pathname === "/api/verify/selfie") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { photo?: unknown };
    const rec = db.getAccount(sess.accountId);
    if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (rec.phase !== "selfie") return err(res, { status: 409, error: "wrong_step" }), true;
    if (typeof body.photo !== "string") return err(res, { status: 400, error: "invalid_image" }), true;
    const img = decodeImage(body.photo);
    if (!img.ok) return err(res, { status: 400, error: img.error }), true;
    const filename = `${rec.id}_selfie.${img.ext}`;
    await db.writePrivateUpload(filename, img.bytes);
    db.updateAccount(rec.id, {
      selfieRef: filename,
      selfieCapturedAt: now.toISOString(),
      phase: "pending_review",
      lastActivityAt: now.toISOString(),
    });
    await db.persist();
    // Explicit pending state — no liveness/match claim. Review is manual.
    return ok(res, { status: "pending_review", message: "Selfie received. Your verification is now in manual review — you'll see a Verified badge once approved." }), true;
  }

  // ---- profile photo (public) --------------------------------------------
  if (method === "POST" && url.pathname === "/api/profile/photo") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { photo?: unknown };
    const rec = db.getAccount(sess.accountId);
    if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (typeof body.photo !== "string") return err(res, { status: 400, error: "invalid_image" }), true;
    const img = decodeImage(body.photo);
    if (!img.ok) return err(res, { status: 400, error: img.error }), true;
    const filename = `${rec.id}_profile.${img.ext}`;
    await db.writePublicUpload(filename, img.bytes);
    const prev = rec.profilePhotoRef;
    db.updateAccount(rec.id, { profilePhotoRef: filename });
    if (prev && prev !== filename) void db.deletePublicUpload(prev);
    await db.persist();
    return ok(res, { photoUrl: `/uploads/public/${filename}` }), true;
  }

  // ---- logout -------------------------------------------------------------
  if (method === "POST" && url.pathname === "/api/logout") {
    const sid = cookies[SESSION_COOKIE];
    if (sid) db.deleteSession(sid);
    clearCookie(res, SESSION_COOKIE, secure);
    return ok(res, { status: "guest" }), true;
  }

  // ---- account self-deletion (immediate scrub of sensitive fields) -------
  if (method === "POST" && url.pathname === "/api/account/delete") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(sess.accountId);
    if (!rec || rec.deletedAt) return err(res, { status: 404, error: "not_found" }), true;
    if (rec.selfieRef) void db.deletePrivateUpload(rec.selfieRef);
    if (rec.profilePhotoRef) void db.deletePublicUpload(rec.profilePhotoRef);
    const scrubbed = scrubAccount(rec, now);
    const tombstone = db.updateAccount(rec.id, scrubbed)!;
    tombstone.purgeAt = new Date(new Date(now.toISOString()).getTime() + tombstone.retentionYears * 365 * 24 * 60 * 60 * 1000).toISOString();
    db.deleteSessionsForAccount(rec.id);
    db.appendAudit({ admin: rec.email, action: "account.delete", reason: "User requested account deletion", targetId: rec.id, ip }, now);
    await db.persist();
    clearCookie(res, SESSION_COOKIE, secure);
    return ok(res, { status: "deleted" }), true;
  }

  // ============================ ADMIN =====================================
  if (url.pathname.startsWith("/api/admin")) {
    return handleAdmin(req, res, db, url, method, cookies, ip, secure, now);
  }

  return false;
}

async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
  url: URL,
  method: string,
  cookies: Record<string, string>,
  ip: string,
  secure: boolean,
  now: Date,
): Promise<boolean> {
  const adminSessionId = cookies[ADMIN_COOKIE] ?? null;
  const reason = req.headers["x-audit-reason"];
  const ctx = { adminSessionId, reason: typeof reason === "string" ? reason : undefined, ip };
  const sendErr = (r: { ok: false; error: string; status: number }) => err(res, { status: r.status, error: r.error });

  // POST /api/admin/login
  if (method === "POST" && url.pathname === "/api/admin/login") {
    if (!adminConfigured()) {
      return err(res, { status: 503, error: "admin_unconfigured", message: "Admin access is not configured on this server (RUN_LOCAL_ADMIN_KEY is not set)." }), true;
    }
    if (rateLimited(adminLoginAttempts, `login:${ip}`, 5, 60_000, now.getTime())) {
      return err(res, { status: 429, error: "rate_limited" }), true;
    }
    const body = (await readJson(req)) as { key?: unknown };
    const result = adminLogin(db, typeof body.key === "string" ? body.key : "", ip, now);
    if (!result.ok) return sendErr(result), true;
    setCookie(res, ADMIN_COOKIE, result.data.sessionId, secure, 60 * 60 * 8);
    await db.persist();
    return ok(res, { ok: true, admin: result.data.admin }), true;
  }

  // POST /api/admin/logout
  if (method === "POST" && url.pathname === "/api/admin/logout") {
    if (adminSessionId) db.deleteSession(adminSessionId);
    clearCookie(res, ADMIN_COOKIE, secure);
    return ok(res, { ok: true }), true;
  }

  // GET /api/admin/search?q=
  if (method === "GET" && url.pathname === "/api/admin/search") {
    const q = url.searchParams.get("q") ?? "";
    const result = adminSearch(db, ctx, q, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { results: result.data }), true;
  }

  // GET /api/admin/records/:id
  const recordMatch = /^\/api\/admin\/records\/([a-f0-9]{32})\/?$/.exec(url.pathname);
  if (recordMatch && method === "GET") {
    const result = adminGetRecord(db, ctx, recordMatch[1], now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { record: result.data }), true;
  }

  // GET /api/admin/records/:id/selfie
  const selfieMatch = /^\/api\/admin\/records\/([a-f0-9]{32})\/selfie$/.exec(url.pathname);
  if (selfieMatch && method === "GET") {
    const result = await adminViewSelfie(db, ctx, selfieMatch[1], now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    res.writeHead(200, {
      "content-type": "image/jpeg",
      "cache-control": "no-store",
      "content-disposition": "inline",
    });
    res.end(result.data.buffer);
    return true;
  }

  // POST /api/admin/records/:id/approve | reject | delete
  const actionMatch = /^\/api\/admin\/records\/([a-f0-9]{32})\/(approve|reject|delete)$/.exec(url.pathname);
  if (actionMatch && method === "POST") {
    const [, id, action] = actionMatch;
    if (action === "delete") {
      const result = adminDeleteAccount(db, ctx, id, now);
      if (!result.ok) return sendErr(result), true;
      await db.persist();
      return ok(res, { ok: true, deleted: result.data.id }), true;
    }
    const result = adminSetStatus(db, ctx, id, action as "verified" | "rejected", now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, account: toPublicAccount(result.data) }), true;
  }

  // GET /api/admin/export.csv?q=
  if (method === "GET" && url.pathname === "/api/admin/export.csv") {
    const q = url.searchParams.get("q") ?? "";
    const result = adminExportRows(db, ctx, q, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    const csv = toCsv(result.data.rows);
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="runlocal-verifications-${now.toISOString().slice(0, 10)}.csv"`,
    });
    res.end(csv);
    return true;
  }

  // GET /api/admin/audit?limit=
  if (method === "GET" && url.pathname === "/api/admin/audit") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "100") || 100, 500);
    const result = adminAuditLog(db, ctx, limit, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { entries: result.data }), true;
  }

  // POST /api/admin/purge — run the retention purge now
  if (method === "POST" && url.pathname === "/api/admin/purge") {
    if (!ctx.adminSessionId) return err(res, { status: 401, error: "unauthorized" }), true;
    if (!validReason(ctx.reason)) return err(res, { status: 400, error: "reason_required" }), true;
    const session = db.getSession(ctx.adminSessionId);
    if (!session) return err(res, { status: 401, error: "unauthorized" }), true;
    if (!adminConfigured()) return err(res, { status: 503, error: "admin_unconfigured" }), true;
    const result = await purgeEligible(db, now);
    db.appendAudit({ admin: adminEmail(), action: "admin.purge", reason: ctx.reason!.trim().slice(0, 500), targetId: null, ip }, now);
    await db.persist();
    return ok(res, { purged: result.purged.length, retained: result.retained.length }), true;
  }

  // Unknown admin route
  return err(res, { status: 404, error: "not_found" }), true;
}

/**
 * Entry point used by serve.ts. Returns true when the request was handled
 * as an API request (so the static layer can fall back to the SPA otherwise).
 */
export async function apiHandler(req: IncomingMessage, res: ServerResponse, db: Db): Promise<boolean> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return false;
    return await handleApi(req, res, db, url);
  } catch (e) {
    const status = e instanceof Error && "status" in e ? Number((e as Error & { status?: number }).status ?? 500) : 500;
    if (!res.headersSent) {
      err(res, { status, error: status === 413 ? "body_too_large" : "server_error" });
    }
    return true;
  }
}

/** Prune stale sessions (called by serve.ts on an interval). */
export function pruneSessionsWith(db: Db): number {
  return db.pruneSessions(SESSION_MAX_AGE_MS);
}
