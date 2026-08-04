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
import { Db, newId, normalizePhone, EMAIL_SEND_LIMIT, EMAIL_SEND_WINDOW_MS, toPublicAccount, MIN_AGE } from "./store";
import type { AccountRecord } from "./types";
import { normalizeUsername, USERNAME_HINT } from "../lib/username";

import { supabaseConfig, verifySupabaseToken, applySupabaseIdentity } from "./supabase";
import {
  adminConfigured,
  adminEmail,
  adminExportRows,
  adminAuditLog,
  adminDeleteAccount,
  adminGetRecord,
  adminLogin,
  adminPending,
  adminSearch,
  adminSetStatus,
  adminViewSelfie,
  toCsv,
  validReason,
  authorizeAdmin,
  adminAccessLevel,
  assignCityAdmin,
  revokeCityAdmin,
  listCityAdmins,
  cityAdminAudit,
} from "./admin";
import { purgeEligible, retentionStatus, deleteAccount as scrubAccount } from "./retention";
import { isOwnerEmail } from "./owner";
import { publicSettings, updateSettings, saveCity, deleteCity, storeCmsUpload, providerEnabled, integrations, publicRefAllowed, cityStatus, cityExists, cityNotOpenError, publicCities, CMS_REF_PATTERN, refContentType } from "./cms";
import {
  dashboardOverview,
  liftSuspension,
  moderateFlag,
  publicModerated,
  setContentHighlight,
  setGroupRrca,
  suspendAccount,
  unhideContent,
  cityDashboardOverview,
  cityModerateFlag,
  cityUnhideContent,
  citySetGroupRrca,
  citySetContentHighlight,
} from "./dashboard";
import { adapters, configError, oauthState, stateValid, normalizeActivity, publicActivityCard, type Provider, type ShareMode } from "./activity";
import { decideSubmission,
  mySubmissions,
  publicApprovedContent,
  submitEvent,
  submitGroup,
  submitRace,
  submissionQueue,
  citySubmissionQueue,
  cityDecideSubmission,
} from "./submissions";
import { createInvitation, revokeInvitation, listInvitations, validateInvitation, redeemInvitation } from "./invitations";

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

function err(res: ServerResponse, e: ApiError): true {
  json(res, e.status, { error: e.error, message: e.message });
  return true;
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

/**
 * Placeholder display name derived from an email local-part for accounts
 * auto-created by /api/login/check from a verified Supabase identity (the
 * repair path for "Supabase user exists, local account missing"). It is a
 * neutral label, not a fabricated claim — no birthdate/phone are invented.
 */
export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w[0] ?? "").toUpperCase() + w.slice(1));
  return (words.join(" ") || "Runner").slice(0, 60);
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
    const supabase = supabaseConfig();
    return ok(res, {
      ok: true,
      // Supabase email verification provider status — names of missing vars only, never
      // values, and never the anon key itself.
      supabaseConfigured: supabase.configured,
      supabaseMissing: supabase.missing,
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
    // isOwner is a SERVER-side role rule (account email vs RUN_LOCAL_OWNER_EMAIL).
    // The client renders the boolean; it can never self-assign the role.
    return ok(res, { status: "signed_in", account: toPublicAccount(rec, isOwnerEmail(rec.email)) }), true;
  }

  if (method === "POST" && !originAllowed(req)) {
    return err(res, { status: 403, error: "forbidden" }), true;
  }

  // ---- public-safe moderation state (visibility facts only) ----------------
  // Rendered by every city page: which content is hidden, which events/races
  // are featured/pinned, and which groups carry the RRCA badge. NO reasons,
  // reporters, suspension details, or sensitive records — see
  // dashboard.publicModerated.
  if (method === "GET" && url.pathname === "/api/moderated") {
    const cityId = url.searchParams.get("city") ?? "";
    return ok(res, publicModerated(db, cityId)), true;
  }

  // ---- public approved community content (no auth) -------------------------
  // Only APPROVED submissions ever appear here (pending/rejected never leave
  // the server), and owner-hidden content is excluded. No emails, phones, IPs,
  // or rejection reasons — just the public listing facts.
  if (method === "GET" && url.pathname === "/api/content") {
    const cityId = url.searchParams.get("city") ?? "";
    // Any KNOWN city serves its content history — deactivated and invite-only
    // cities stay browsable for existing members even though they deny new entry.
    if (!cityId || !cityExists(db, cityId)) {
      return err(res, { status: 400, error: "invalid_city" }), true;
    }
    return ok(res, publicApprovedContent(db, cityId)), true;
  }

  // ---- activity integrations (provider-neutral public shapes) -------------
  const provider = url.pathname.match(/^\/api\/connections\/([^/]+)/)?.[1] as Provider | undefined;
  const validProvider = (p: string | undefined): p is Provider => Boolean(p && p in adapters);
  if (method === "GET" && url.pathname === "/api/activity/feed") {
    const cityId = url.searchParams.get("city") ?? "";
    const cards = db.listActivities().filter(a => a.shareMode !== "private").flatMap(a => { const owner=db.getAccount(a.accountId); return owner?.cityId===cityId ? [publicActivityCard(a)] : []; });
    return ok(res, { cards }), true;
  }
  if ((method === "GET" || method === "POST") && provider && validProvider(provider) && url.pathname === `/api/connections/${provider}`) {
    const sess = requireSession(db, cookies); if (!sess) return err(res,{status:401,error:"sign_in_required"}),true;
    const account=db.getAccount(sess.accountId); if (!account || account.status!=="verified") return err(res,{status:403,error:"verified_runner_required"}),true;
    // CMS provider toggle: a disabled provider is not offered on this site,
    // regardless of whether deployment credentials exist.
    if (!providerEnabled(db, provider)) return err(res,{status:403,error:"provider_disabled"}),true;
    if (method === "GET") { if (!adapters[provider].configured()) return err(res,{status:503,...configError(provider)}),true; const state=oauthState(sess.accountId,provider); return ok(res,{authorizeUrl:adapters[provider].authorizeUrl(state)}), true; }
    const body=await readJson(req) as Record<string,unknown>; const mode=body.shareMode;
    if (mode!==undefined && mode!=="auto" && mode!=="manual" && mode!=="private") return err(res,{status:400,error:"invalid_share_mode"}),true;
    if (!adapters[provider].configured()) return err(res,{status:503,...configError(provider)}),true;
    const token= db.getToken(sess.accountId,provider); if (token) return ok(res,{connected:true,shareMode:mode??"manual"}),true;
    return err(res,{status:400,error:"oauth_required"}),true;
  }
  const callback = /^\/api\/connections\/([^/]+)\/callback$/.exec(url.pathname);
  if (method === "GET" && callback && validProvider(callback[1])) {
    const p = callback[1];
    const sess = requireSession(db, cookies);
    if (!sess) { err(res, { status: 401, error: "sign_in_required" }); return true; }
    if (!providerEnabled(db, p)) { err(res, { status: 403, error: "provider_disabled" }); return true; }
    if (!adapters[p].configured()) { err(res, { status: 503, ...configError(p) }); return true; }
    const state = url.searchParams.get("state") ?? "";
    if (!stateValid(state, sess.accountId, p)) { err(res, { status: 403, error: "invalid_oauth_state" }); return true; }
    try {
      const t = await adapters[p].exchange(url.searchParams.get("code") ?? "");
      db.setToken({ accountId: sess.accountId, provider: p, accessToken: t.accessToken, refreshToken: t.refreshToken ?? null, expiresAt: t.expiresAt ?? null, providerUserId: t.providerUserId ?? null });
      await db.persist();
      ok(res, { connected: true, provider: p }); return true;
    } catch { err(res, { status: 502, error: "oauth_exchange_failed" }); return true; }
  }
  const disconnect = /^\/api\/connections\/([^/]+)\/disconnect$/.exec(url.pathname);
  if (method === "POST" && disconnect && validProvider(disconnect[1])) {
    const p = disconnect[1]; const sess = requireSession(db, cookies);
    if (!sess) { err(res, { status: 401, error: "sign_in_required" }); return true; }
    const t = db.getToken(sess.accountId, p); if (t) await adapters[p].revoke(t.accessToken).catch(() => {});
    db.removeToken(sess.accountId, p); const body = await readJson(req) as Record<string, unknown>;
    if (body.deleteActivities === true) db.removeActivities(sess.accountId, p); await db.persist();
    ok(res, { disconnected: true, deletedActivities: body.deleteActivities === true }); return true;
  }
  if (method === "POST" && url.pathname === "/api/activity/manual") {
    const sess = requireSession(db, cookies); if (!sess) { err(res, { status: 401, error: "sign_in_required" }); return true; }
    const account = db.getAccount(sess.accountId); if (!account || account.status !== "verified") { err(res, { status: 403, error: "verified_runner_required" }); return true; }
    const body = await readJson(req) as Record<string, unknown>; const p = body.provider as Provider;
    if (!validProvider(p)) { err(res, { status: 400, error: "invalid_provider" }); return true; }
    if (!providerEnabled(db, p)) { err(res, { status: 403, error: "provider_disabled" }); return true; }
    let normalized; try { normalized = normalizeActivity(p, body.activity); } catch { err(res, { status: 400, error: "invalid_activity" }); return true; }
    const a = { ...normalized, id: newId(), accountId: sess.accountId, shareMode: "manual" as ShareMode, caption: typeof body.caption === "string" ? body.caption.slice(0, 280) : null };
    db.addActivity(a); await db.persist(); ok(res, { card: publicActivityCard(a) }); return true;
  }

  // ---- account creation (signup completion) ------------------------------
  // Used by the password signup flow AFTER Supabase created the auth user:
  // the local Pending profile carries only profile metadata (name, email,
  // birthdate, optional phone) — the password NEVER reaches Run Local.
  // `noSession: true` is for the email-confirmation-required path, where
  // Supabase returns no session: the pending account is created but NO Run
  // Local session cookie is issued, so nothing claims signed-in status
  // without a valid Supabase session. The account links to the verified
  // Supabase identity on the user's first confirmed login (/api/login/check).
  if (method === "POST" && url.pathname === "/api/accounts") {
    const body = (await readJson(req)) as { name?: unknown; username?: unknown; email?: unknown; phone?: unknown; birthdate?: unknown; cityId?: unknown; requestedRole?: unknown; noSession?: unknown; invitationToken?: unknown };
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
    // Home city is REQUIRED for new signups and validated HERE against the
    // known city entities (src/data/cities.ts) — the server is authoritative,
    // never the client. Missing and unknown ids get distinct, clear errors.
    // The id must arrive EXACT: surrounding whitespace is malformed input, not
    // silently normalized (a padded id would mask a buggy client). Whitespace-
    // only counts as missing; any other mismatch is invalid_city.
    const rawCityId = typeof body.cityId === "string" ? body.cityId : "";
    const cityId = rawCityId.trim();
    if (!cityId) {
      return err(res, { status: 400, error: "city_required", message: "Choose your home city — Run Local is city-scoped and your community content defaults to it." }), true;
    }
    if (rawCityId !== cityId || cityStatus(db, cityId) === null) {
      return err(res, { status: 400, error: "invalid_city", message: "That city isn't supported yet — pick one from the list." }), true;
    }
    // Lifecycle gate: coming_soon and inactive cities deny new signups
    // entirely; invite_only cities require a valid invitation bound to this
    // email (validated before any account is created — a failed invitation
    // never leaves a partial account behind).
    const signupCityStatus = cityStatus(db, cityId)!;
    if (signupCityStatus === "coming_soon" || signupCityStatus === "inactive") {
      const e = cityNotOpenError(signupCityStatus);
      return err(res, { status: e.status, error: e.error, message: e.message }), true;
    }
    const invitationToken = signupCityStatus === "invite_only" ? (typeof body.invitationToken === "string" ? body.invitationToken.trim() : "") : "";
    if (signupCityStatus === "invite_only") {
      const v = validateInvitation(db, cityId, email, invitationToken, now);
      if (!v.ok) return err(res, { status: v.status, error: v.error, message: v.message }), true;
    }
    // Username is REQUIRED for new signups and validated/normalized here —
    // the server is authoritative, never the client. Legacy accounts without
    // a username stay valid and claim one via /api/profile/username instead.
    const username = normalizeUsername(typeof body.username === "string" ? body.username : "");
    if (!username) {
      return err(res, { status: 400, error: "invalid_username", message: `Choose a valid username. ${USERNAME_HINT}` }), true;
    }
    const existing = db.getAccountByEmail(email);
    if (existing && !existing.deletedAt) return err(res, { status: 409, error: "email_taken" }), true;
    // Duplicate usernames are rejected deterministically on the normalized,
    // case-insensitive form. The check + create run in one synchronous turn of
    // the single-threaded store, so a concurrent request can never interleave
    // between them (see tests/username-api.test.ts for the race test).
    const taken = db.getAccountByUsername(username);
    if (taken && !taken.deletedAt) {
      return err(res, { status: 409, error: "username_taken", message: "That username is already taken — try another." }), true;
    }
    if (typeof body.phone === "string" && !phone) return err(res, { status: 400, error: "invalid_phone" }), true;
    // Role requests are label-only and strictly validated server-side; the
    // owner/operator assigns the real role at approval time.
    const requestedRole = body.requestedRole === "group_leader" ? "group_leader" : body.requestedRole === "runner" ? "runner" : null;
    const rec = db.createAccount({ name, username, email, phone, birthdate, cityId, requestedRole });
    rec.signupIp = ip;
    rec.signupAt = now.toISOString();
    if (signupCityStatus === "invite_only") {
      // Consume the invitation (one-time). Validated above in the same
      // synchronous turn of the single-threaded store, so no concurrent
      // request can interleave; still handle an unexpected failure safely by
      // dropping the invite-only home city rather than granting entry.
      const redeemed = redeemInvitation(db, cityId, email, invitationToken, rec.id, now);
      if (!redeemed.ok) {
        db.updateAccount(rec.id, { cityId: null });
        return err(res, { status: redeemed.status, error: redeemed.error, message: redeemed.message }), true;
      }
    }
    db.appendLoginIp(rec.id, ip, now);
    if (body.noSession !== true) {
      const session = db.createSession(rec.id, ip, now);
      setCookie(res, SESSION_COOKIE, session.id, secure, 60 * 60 * 24 * 30);
    }
    await db.persist();
    return ok(res, { account: toPublicAccount(rec, isOwnerEmail(rec.email)) }), true;
  }

  // ---- request email verification (Supabase delivers it) ----------------------------
  // Supabase sends the 6-digit code to the user's inbox. This endpoint only
  // gates the request: session, funnel phase, provider configuration, and the
  // Run Local rate limit. The actual send happens client-side via the
  // supabase-js `email verification` call, so the server never holds the code.
  if (method === "POST" && url.pathname === "/api/verify/start") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(sess.accountId);
    if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (rec.status !== "pending" || (rec.phase !== "email" && rec.phase !== "code")) return err(res, { status: 409, error: "wrong_step" }), true;
    // Fail before rate limiting when deployment config is absent. This keeps
    // an unavailable provider from consuming the user's resend budget.
    const supabase = supabaseConfig();
    if (!supabase.configured) {
      return err(res, {
        status: 503,
        error: "email_unconfigured",
        message: "Email verification is not configured on this server (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing). No code was sent.",
      }), true;
    }
    if (rateLimited(emailSendLog, rec.email, EMAIL_SEND_LIMIT, EMAIL_SEND_WINDOW_MS, now.getTime())) return err(res, { status: 429, error: "rate_limited" }), true;
    return ok(res, { status: "otp_sent", resendInSec: 30 }), true;
  }

  // ---- verify email verification (server validates the Supabase identity) ----------
  // The client verifies the 6-digit code with Supabase (verification code) and sends
  // the resulting access token here. The server NEVER trusts the client's
  // claim: it introspects the token against Supabase and only then links the
  // Supabase user (sub) to the Run Local account and advances the funnel.
  // Email verification alone moves the funnel to the selfie step — it does NOT
  // grant the Verified badge (only owner approval does).
  if (method === "POST" && url.pathname === "/api/verify/check") {
    const sess = requireSession(db, cookies); if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return err(res, { status: 400, error: "invalid_token", message: "No Supabase session token was provided." }), true;
    const rec = db.getAccount(sess.accountId); if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (rec.phase !== "code" && rec.phase !== "email") return err(res, { status: 409, error: "wrong_step" }), true;
    const verified = await verifySupabaseToken(token);
    if (!verified.ok) {
      return err(res, {
        status: verified.reason === "unconfigured" ? 503 : verified.reason === "network" ? 502 : 401,
        error: verified.reason === "unconfigured" ? "email_unconfigured" : "auth_failed",
        message: verified.message,
      }), true;
    }
    const linked = applySupabaseIdentity(rec, verified);
    if (!linked.ok) {
      const status = linked.code === "email_mismatch" ? 409 : 403;
      return err(res, { status, error: linked.code, message: linked.message }), true;
    }
    db.updateAccount(rec.id, { ...linked.patch, phase: "selfie", lastActivityAt: now.toISOString() });
    db.deleteCode(rec.id); // clear any legacy local code record
    db.appendLoginIp(rec.id, ip, now);
    await db.persist();
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

  // ---- username (public handle) --------------------------------------------
  // Signed-in users set or change their unique public handle. Validation and
  // normalization happen HERE (server-authoritative, see src/lib/username.ts
  // for the allowed characters and case behavior); duplicates are rejected
  // deterministically on the normalized case-insensitive form. The check +
  // write run in one synchronous turn of the single-threaded store, so a
  // concurrent request can never claim the same name in between.
  if (method === "POST" && url.pathname === "/api/profile/username") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { username?: unknown };
    const rec = db.getAccount(sess.accountId);
    if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    const username = normalizeUsername(typeof body.username === "string" ? body.username : "");
    if (!username) {
      return err(res, { status: 400, error: "invalid_username", message: `Choose a valid username. ${USERNAME_HINT}` }), true;
    }
    // Re-submitting your own current username is a harmless no-op (still
    // validated + normalized); any OTHER account holding the name is a 409.
    const taken = db.getAccountByUsername(username);
    if (taken && taken.id !== rec.id) {
      return err(res, { status: 409, error: "username_taken", message: "That username is already taken — try another." }), true;
    }
    db.updateAccount(rec.id, { username, lastActivityAt: now.toISOString() });
    await db.persist();
    return ok(res, { account: toPublicAccount(db.getAccount(rec.id)!, isOwnerEmail(rec.email)) }), true;
  }

  // ---- home city (public profile preference) ------------------------------
  // Signed-in users set or change the single home city their community content
  // defaults to. Validated HERE against the known city entities — the server is
  // authoritative, never the client. Missing and unknown ids get distinct,
  // clear errors; re-submitting your own current city is a harmless no-op.
  if (method === "POST" && url.pathname === "/api/profile/city") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { cityId?: unknown; invitationToken?: unknown };
    const rec = db.getAccount(sess.accountId);
    if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    const cityId = typeof body.cityId === "string" ? body.cityId.trim() : "";
    if (!cityId) {
      return err(res, { status: 400, error: "city_required", message: "Choose your home city — Run Local is city-scoped and your community content defaults to it." }), true;
    }
    const status = cityStatus(db, cityId);
    if (status === null) {
      return err(res, { status: 400, error: "invalid_city", message: "That city isn't supported yet — pick one from the list." }), true;
    }
    // Re-submitting the current home city is a harmless no-op — no invitation
    // is needed to keep what you already have (members of an invite-only or
    // deactivated city keep their home city).
    if (rec.cityId === cityId) {
      return ok(res, { account: toPublicAccount(rec, isOwnerEmail(rec.email)) }), true;
    }
    // Lifecycle gate: coming_soon / inactive cities deny NEW entry while
    // retaining their history; invite_only requires a valid invitation bound
    // to the account email (validated before the write — a failed invitation
    // never changes the account).
    if (status === "coming_soon" || status === "inactive") {
      const e = cityNotOpenError(status);
      return err(res, { status: e.status, error: e.error, message: e.message }), true;
    }
    const invitationToken = status === "invite_only" ? (typeof body.invitationToken === "string" ? body.invitationToken.trim() : "") : "";
    let invitationId: string | null = null;
    if (status === "invite_only") {
      const v = validateInvitation(db, cityId, rec.email, invitationToken, now);
      if (!v.ok) return err(res, { status: v.status, error: v.error, message: v.message }), true;
      invitationId = db.findInvitation(cityId, rec.email)?.id ?? null;
    }
    db.updateAccount(rec.id, { cityId, lastActivityAt: now.toISOString() });
    if (status === "invite_only" && invitationId) {
      // Consume the invitation (one-time) — validated above in the same
      // synchronous turn, so this can only fail on an interleaving race, which
      // the single-threaded store rules out.
      redeemInvitation(db, cityId, rec.email, invitationToken, rec.id, now);
    }
    await db.persist();
    return ok(res, { account: toPublicAccount(db.getAccount(rec.id)!, isOwnerEmail(rec.email)) }), true;
  }

  // ---- sign in with email verification (honest: no passwords, no fake SSO) --------
  // Guests with an existing account sign in through the SAME Supabase OTP path
  // as signup: the server validates the account exists and gates the request;
  // Supabase delivers the code; the client verifies it; the server validates
  // the resulting Supabase identity and issues the Run Local session cookie.
  // Every failure is explicit: unknown email, rejected account, unconfigured
  // provider, rejected/unverifiable Supabase token.
  if (method === "POST" && url.pathname === "/api/login/start") {
    const body = (await readJson(req)) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
      return err(res, { status: 400, error: "invalid_email" }), true;
    }
    const rec = db.getAccountByEmail(email);
    if (!rec || rec.deletedAt) {
      return err(res, { status: 404, error: "no_account", message: "No Run Local account found for that email — you can sign up instead." }), true;
    }
    if (rec.status === "rejected") {
      return err(res, { status: 403, error: "account_rejected", message: "This account was rejected and can't sign in. Contact the owner if you believe this is a mistake." }), true;
    }
    const supabase = supabaseConfig();
    if (!supabase.configured) {
      return err(res, {
        status: 503,
        error: "email_unconfigured",
        message: "Email verification is not configured on this server (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing). No code was sent.",
      }), true;
    }
    if (rateLimited(emailSendLog, rec.email, EMAIL_SEND_LIMIT, EMAIL_SEND_WINDOW_MS, now.getTime())) {
      return err(res, { status: 429, error: "rate_limited" }), true;
    }
    return ok(res, { status: "otp_sent", resendInSec: 30 }), true;
  }

  if (method === "POST" && url.pathname === "/api/login/check") {
    const body = (await readJson(req)) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return err(res, { status: 400, error: "invalid_token", message: "No Supabase session token was provided." }), true;
    const verified = await verifySupabaseToken(token);
    if (!verified.ok) {
      return err(res, {
        status: verified.reason === "unconfigured" ? 503 : verified.reason === "network" ? 502 : 401,
        error: verified.reason === "unconfigured" ? "email_unconfigured" : "auth_failed",
        message: verified.message,
      }), true;
    }
    // The authenticated email comes from the VERIFIED token, never from the
    // client request body — the client cannot choose whose account to sign in
    // to. If no local account exists yet (e.g. Supabase auth.user was created
    // by an earlier signup whose local profile never completed), create the
    // matching Pending account from the verified identity alone. Name is
    // derived from the email local-part as a placeholder (never fabricated
    // claims — no birthdate/phone are invented); the normal signup-metadata
    // path collects the real profile on a fresh signup. This is what fixes
    // "auth.users exists but Run Local has no account → no_account".
    let rec = db.getAccountByEmail(verified.email);
    if (!rec || rec.deletedAt) {
      rec = db.createAccount({ name: displayNameFromEmail(verified.email), email: verified.email });
      rec.signupIp = ip;
      rec.signupAt = now.toISOString();
    }
    if (rec.status === "rejected") return err(res, { status: 403, error: "account_rejected" }), true;
    const linked = applySupabaseIdentity(rec, verified);
    if (!linked.ok) {
      const status = linked.code === "email_mismatch" ? 409 : 403;
      return err(res, { status, error: linked.code, message: linked.message }), true;
    }
    // Link the Supabase identity if this is a legacy account that predates the
    // bridge (email ownership was just proven by a successful Supabase
    // password login / confirmation link, so linking is legitimate); a
    // mismatch with an existing link is rejected above. A successful login
    // also proves email ownership, so a pending account still on the
    // email-code stage advances straight to the selfie step — the primary
    // flow never shows a six-digit code after the confirmation link.
    const patch: Partial<AccountRecord> = { ...linked.patch, lastActivityAt: now.toISOString() };
    if (rec.phase === "email" || rec.phase === "code") patch.phase = "selfie";
    db.updateAccount(rec.id, patch);
    db.deleteCode(rec.id);
    db.appendLoginIp(rec.id, ip, now);
    db.touchActivity(rec.id, now);
    const session = db.createSession(rec.id, ip, now);
    setCookie(res, SESSION_COOKIE, session.id, secure, 60 * 60 * 24 * 30);
    await db.persist();
    return ok(res, { status: "signed_in", account: toPublicAccount(db.getAccount(rec.id)!, isOwnerEmail(rec.email)) }), true;
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

  // ==================== COMMUNITY SUBMISSIONS ==============================
  // Race / group / independent-event submissions. All permission + field
  // validation is server-side (src/server/submissions.ts) — the client never
  // decides who may submit or what is valid. Submissions enter the pending
  // queue; only an admin approval makes them public.

  // ---- my submissions (submitter's own records only) ----------------------
  if (method === "GET" && url.pathname === "/api/my/submissions") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(sess.accountId);
    if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    return ok(res, { submissions: mySubmissions(db, sess.accountId) }), true;
  }

  // ---- submit a race ------------------------------------------------------
  if (method === "POST" && url.pathname === "/api/submissions/race") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as {
      cityId?: unknown; name?: unknown; distances?: unknown; date?: unknown;
      location?: unknown; registrationUrl?: unknown; description?: unknown;
    };
    const result = submitRace(db, sess.accountId, body, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { submission: { id: result.data.id, status: result.data.status } }), true;
  }

  // ---- submit a group -----------------------------------------------------
  if (method === "POST" && url.pathname === "/api/submissions/group") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as {
      cityId?: unknown; name?: unknown; description?: unknown; groupType?: unknown;
      groupmeUrl?: unknown; facebookUrl?: unknown; instagramUrl?: unknown; websiteUrl?: unknown;
    };
    const result = submitGroup(db, sess.accountId, body, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { submission: { id: result.data.id, status: result.data.status } }), true;
  }

  // ---- submit an independent event (one-time or recurring) ----------------
  if (method === "POST" && url.pathname === "/api/submissions/event") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as {
      cityId?: unknown; type?: unknown; title?: unknown; date?: unknown; dayOfWeek?: unknown;
      time?: unknown; location?: unknown; distanceLabel?: unknown; invite?: unknown;
      externalUrl?: unknown; description?: unknown;
    };
    const result = submitEvent(db, sess.accountId, body, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { submission: { id: result.data.id, status: result.data.status } }), true;
  }

  if (method === "GET" && url.pathname === "/api/config") return ok(res, { settings: publicSettings(db), cities: publicCities(db), integrations: integrations(db) }), true;
  // Public brand/city-header images: ONLY refs currently referenced by the
  // public config (logo, favicon, active-city headers). Everything else stays
  // private behind the audited admin route.
  const publicRef = /^\/api\/cms\/refs\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
  if (method === "GET" && publicRef) {
    const ref = publicRef[1];
    if (!CMS_REF_PATTERN.test(ref) || !publicRefAllowed(db, ref)) return err(res, { status: 404, error: "not_found" }), true;
    const bytes = await db.readRef(ref);
    if (!bytes) return err(res, { status: 404, error: "not_found" }), true;
    res.writeHead(200, { "content-type": refContentType(ref), "cache-control": "public, max-age=3600" });
    res.end(bytes);
    return true;
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
  const userSessionId = cookies[SESSION_COOKIE] ?? null;
  const reason = req.headers["x-audit-reason"];
  const ctx = { adminSessionId, userSessionId, reason: typeof reason === "string" ? reason : undefined, ip };
  const sendErr = (r: { ok: false; error: string; status: number; message?: string }) =>
    err(res, { status: r.status, error: r.error, message: r.message });

  if (method === "GET" && url.pathname === "/api/admin/cms/settings") { const a=authorizeAdmin(db,ctx,"admin.cms_settings",null,now); if(!a.ok)return sendErr(a),true; return ok(res,{settings:publicSettings(db),cities:db.listCities(),integrations:integrations(db)}),true; }
  if (method === "POST" && url.pathname === "/api/admin/cms/settings") { const body=await readJson(req) as Record<string,unknown>; const r=updateSettings(db,ctx,body as any,now); if(!r.ok)return sendErr(r),true; await db.persist(); return ok(res,r.data),true; }
  if (method === "POST" && url.pathname === "/api/admin/cms/city") { const body=await readJson(req) as any; const r=saveCity(db,ctx,body,now); if(!r.ok)return sendErr(r),true; await db.persist(); return ok(res,r.data),true; }
  if (method === "POST" && url.pathname.startsWith("/api/admin/cms/city/") && url.pathname.endsWith("/deactivate")) { const id=url.pathname.split("/").at(-2)!; const r=deleteCity(db,ctx,id,now); if(!r.ok)return sendErr(r),true; await db.persist(); return ok(res,r.data),true; }
  if (method === "POST" && url.pathname === "/api/admin/cms/upload") { const a=authorizeAdmin(db,ctx,"admin.cms_settings",null,now); if(!a.ok)return sendErr(a),true; const body=await readJson(req) as { ref?: unknown }; const r=await storeCmsUpload(db,body.ref); if(!r.ok)return err(res,{status:400,error:r.error}),true; await db.persist(); return ok(res,{ref:r.ref}),true; }
  // Audited admin preview of ANY stored CMS ref (unreferenced uploads are
  // never public — this is the only way to inspect them).
  const adminRef = /^\/api\/admin\/cms\/refs\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
  if (method === "GET" && adminRef) {
    const ref = adminRef[1];
    const a = authorizeAdmin(db, ctx, "admin.cms_settings", ref, now); if (!a.ok) return sendErr(a), true;
    if (!CMS_REF_PATTERN.test(ref)) return err(res, { status: 404, error: "not_found" }), true;
    const bytes = await db.readRef(ref);
    if (!bytes) return err(res, { status: 404, error: "not_found" }), true;
    res.writeHead(200, { "content-type": refContentType(ref), "cache-control": "private, no-store" });
    res.end(bytes);
    return true;
  }
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

  // GET /api/admin/pending — owner-only pending-user queue (redacted rows)
  if (method === "GET" && url.pathname === "/api/admin/pending") {
    const result = adminPending(db, ctx, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { results: result.data }), true;
  }

  // GET /api/admin/submissions?city= — admin-only pending-submission queue
  // (owner OR key-based admin; safe summaries only, audited with a reason).
  if (method === "GET" && url.pathname === "/api/admin/submissions") {
    const cityId = url.searchParams.get("city")?.trim() || null;
    const result = submissionQueue(db, ctx, cityId, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { results: result.data }), true;
  }

  // POST /api/admin/submissions/:id/approve|reject — decide a submission.
  // Approve publishes the record (and grants the Group Leader role for
  // groups); reject stores the audit reason as the submitter-visible
  // rejection reason. Both require the audited reason header.
  const submissionMatch = /^\/api\/admin\/submissions\/([a-f0-9]{32})\/(approve|reject)\/?$/.exec(url.pathname);
  if (submissionMatch && method === "POST") {
    const result = decideSubmission(db, ctx, submissionMatch[1], submissionMatch[2] as "approve" | "reject", now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, submission: { id: result.data.id, status: result.data.status } }), true;
  }

  // GET /api/admin/dashboard?city= — owner-only moderation dashboard overview
  if (method === "GET" && url.pathname === "/api/admin/dashboard") {
    const result = dashboardOverview(db, ctx, url.searchParams.get("city") ?? "", now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, result.data), true;
  }

  // POST /api/admin/moderate/flag/:flagId — dismiss | hide an open flag
  const flagMatch = /^\/api\/admin\/moderate\/flag\/([a-f0-9]{32})\/?$/.exec(url.pathname);
  if (flagMatch && method === "POST") {
    const body = (await readJson(req)) as { action?: unknown };
    const action = body.action === "hide" ? "hide" : body.action === "dismiss" ? "dismiss" : null;
    if (!action) return err(res, { status: 400, error: "invalid_action", message: "Action must be 'dismiss' or 'hide'." }), true;
    const result = moderateFlag(db, ctx, flagMatch[1], action, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, flag: result.data }), true;
  }

  // POST /api/admin/moderate/unhide/:contentId — reverse a hide
  const unhideMatch = /^\/api\/admin\/moderate\/unhide\/([a-z]+:[A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if (unhideMatch && method === "POST") {
    const result = unhideContent(db, ctx, unhideMatch[1], now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, content: result.data }), true;
  }

  // POST /api/admin/suspend/:accountId — posting-blocking suspension (days optional)
  const suspendMatch = /^\/api\/admin\/suspend\/([a-f0-9]{32})\/?$/.exec(url.pathname);
  if (suspendMatch && method === "POST") {
    const body = (await readJson(req)) as { days?: unknown };
    const days = body.days === undefined || body.days === null || body.days === "" ? null : Number(body.days);
    const result = suspendAccount(db, ctx, suspendMatch[1], days, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, account: result.data }), true;
  }

  // POST /api/admin/lift/:accountId — lift a suspension
  const liftMatch = /^\/api\/admin\/lift\/([a-f0-9]{32})\/?$/.exec(url.pathname);
  if (liftMatch && method === "POST") {
    const result = liftSuspension(db, ctx, liftMatch[1], now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, account: result.data }), true;
  }

  // POST /api/admin/group/:groupId/rrca — RRCA badge + internal note
  const rrcaMatch = /^\/api\/admin\/group\/([A-Za-z0-9_-]+)\/rrca\/?$/.exec(url.pathname);
  if (rrcaMatch && method === "POST") {
    const body = (await readJson(req)) as { badge?: unknown; note?: unknown };
    const result = setGroupRrca(db, ctx, rrcaMatch[1], { badge: body.badge === true, note: typeof body.note === "string" ? body.note : undefined }, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, group: result.data }), true;
  }

  // POST /api/admin/content/:contentId/highlight — featured/pinned toggles
  const highlightMatch = /^\/api\/admin\/content\/([a-z]+:[A-Za-z0-9_-]+)\/highlight\/?$/.exec(url.pathname);
  if (highlightMatch && method === "POST") {
    const body = (await readJson(req)) as { featured?: unknown; pinned?: unknown };
    const result = setContentHighlight(
      db,
      ctx,
      highlightMatch[1],
      { featured: typeof body.featured === "boolean" ? body.featured : undefined, pinned: typeof body.pinned === "boolean" ? body.pinned : undefined },
      now,
    );
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, content: result.data }), true;
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
    // Role to assign on approval (owner/operator picks in the control center).
    const role = url.searchParams.get("role") === "group_leader" ? "group_leader" : "runner";
    const result = adminSetStatus(db, ctx, id, action as "verified" | "rejected", now, role);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, account: toPublicAccount(result.data, isOwnerEmail(result.data.email)) }), true;
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

  // ==================== MULTI-CITY ADMIN FOUNDATION ========================
  // GET /api/admin/access — non-auditing probe of the caller's admin level
  // (global_admin | city_admin | none). The UI uses it to render the right
  // surface; it never reveals verification data.
  if (method === "GET" && url.pathname === "/api/admin/access") {
    return ok(res, adminAccessLevel(db, ctx)), true;
  }

  // ---- Global Admin: City Admin assignment & revocation (audited) ---------
  if (method === "GET" && url.pathname === "/api/admin/cityadmins") {
    const result = listCityAdmins(db, ctx, now);
    if (!result.ok) return sendErr(result), true;
    return ok(res, { admins: result.data }), true;
  }
  if (method === "POST" && url.pathname === "/api/admin/cityadmins") {
    const body = (await readJson(req)) as { email?: unknown; cityId?: unknown };
    const result = assignCityAdmin(db, ctx, typeof body.email === "string" ? body.email : "", typeof body.cityId === "string" ? body.cityId : "", now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { admin: result.data.row }), true;
  }
  const cityAdminRevoke = /^\/api\/admin\/cityadmins\/([a-f0-9]{32})\/revoke\/?$/.exec(url.pathname);
  if (cityAdminRevoke && method === "POST") {
    const result = revokeCityAdmin(db, ctx, cityAdminRevoke[1], now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { revoked: result.data.accountId }), true;
  }

  // ---- Global Admin: city invitations (audited; token shown once) ---------
  if (method === "GET" && url.pathname === "/api/admin/invitations") {
    const cityId = url.searchParams.get("city")?.trim() || null;
    const result = listInvitations(db, ctx, cityId, now);
    if (!result.ok) return sendErr(result), true;
    return ok(res, { invitations: result.data }), true;
  }
  if (method === "POST" && url.pathname === "/api/admin/invitations") {
    const body = (await readJson(req)) as { cityId?: unknown; email?: unknown; expiresInDays?: unknown };
    const result = createInvitation(db, ctx, { cityId: body.cityId, email: body.email, expiresInDays: body.expiresInDays }, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { invitation: result.data.invitation, token: result.data.token }), true;
  }
  const invitationRevoke = /^\/api\/admin\/invitations\/([a-f0-9]{32})\/revoke\/?$/.exec(url.pathname);
  if (invitationRevoke && method === "POST") {
    const result = revokeInvitation(db, ctx, invitationRevoke[1], now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { invitation: result.data.invitation }), true;
  }

  // ---- City Admin: scoped reads & mutations (server-enforced one-city) ----
  if (method === "GET" && url.pathname === "/api/admin/city/dashboard") {
    const result = cityDashboardOverview(db, ctx, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, result.data), true;
  }
  if (method === "GET" && url.pathname === "/api/admin/city/submissions") {
    const result = citySubmissionQueue(db, ctx, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { results: result.data }), true;
  }
  const citySubmissionMatch = /^\/api\/admin\/city\/submissions\/([a-f0-9]{32})\/(approve|reject)\/?$/.exec(url.pathname);
  if (citySubmissionMatch && method === "POST") {
    const result = cityDecideSubmission(db, ctx, citySubmissionMatch[1], citySubmissionMatch[2] as "approve" | "reject", now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, submission: { id: result.data.id, status: result.data.status } }), true;
  }
  const cityFlagMatch = /^\/api\/admin\/city\/moderate\/flag\/([a-f0-9]{32})\/?$/.exec(url.pathname);
  if (cityFlagMatch && method === "POST") {
    const body = (await readJson(req)) as { action?: unknown };
    const action = body.action === "hide" ? "hide" : body.action === "dismiss" ? "dismiss" : null;
    if (!action) return err(res, { status: 400, error: "invalid_action", message: "Action must be 'dismiss' or 'hide'." }), true;
    const result = cityModerateFlag(db, ctx, cityFlagMatch[1], action, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, flag: result.data }), true;
  }
  const cityUnhideMatch = /^\/api\/admin\/city\/moderate\/unhide\/([a-z]+:[A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if (cityUnhideMatch && method === "POST") {
    const result = cityUnhideContent(db, ctx, cityUnhideMatch[1], now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, content: result.data }), true;
  }
  const cityRrcaMatch = /^\/api\/admin\/city\/group\/([A-Za-z0-9_-]+)\/rrca\/?$/.exec(url.pathname);
  if (cityRrcaMatch && method === "POST") {
    const body = (await readJson(req)) as { badge?: unknown; note?: unknown };
    const result = citySetGroupRrca(db, ctx, cityRrcaMatch[1], { badge: body.badge === true, note: typeof body.note === "string" ? body.note : undefined }, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, group: result.data }), true;
  }
  const cityHighlightMatch = /^\/api\/admin\/city\/content\/([a-z]+:[A-Za-z0-9_-]+)\/highlight\/?$/.exec(url.pathname);
  if (cityHighlightMatch && method === "POST") {
    const body = (await readJson(req)) as { featured?: unknown; pinned?: unknown };
    const result = citySetContentHighlight(
      db,
      ctx,
      cityHighlightMatch[1],
      { featured: typeof body.featured === "boolean" ? body.featured : undefined, pinned: typeof body.pinned === "boolean" ? body.pinned : undefined },
      now,
    );
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, content: result.data }), true;
  }
  if (method === "GET" && url.pathname === "/api/admin/city/audit") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "100") || 100, 500);
    const result = cityAdminAudit(db, ctx, limit, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { entries: result.data }), true;
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
