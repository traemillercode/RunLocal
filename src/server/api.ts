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
import { PERSONAL_RUN_CONSENT_VERSION, MATCHING_CONSENT_VERSION } from "./types";
import { normalizeUsername, USERNAME_HINT } from "../lib/username";
import { listSafetyReportsAdmin, decideSafetyReport } from "./safety";
import { adminOverview } from "./adminOverview";
import type { SafetyReportStatus } from "./types";

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
import { resolveOccurrence, defaultOccurrenceDate, sameEventId } from "./occurrences";
import { publicGroups, publicGroup } from "./groups";
import { currentWaiver, waiverStatus, createWaiverVersion, signWaiver, processWaiverExpiry } from "./waivers";
import {
  canManageCheckins,
  resolveManagedOccurrence,
  rosterRows,
  leaderCheckin,
  leaderUndoCheckin,
  createQrSession,
  findSessionByToken,
  validSessionOccurrence,
  joinViaSession,
  checkinViaSession,
  sessionPublicDto,
  sessionMeDto,
  signViaSession,
} from "./checkins";
import { membershipDto, myMemberships, createMembership, canAdministerMembership } from "./memberships";
import { publicEvents, listAdminEvents, createEvent, editEvent, transitionEvent } from "./events";
import { listMyRuns, setMyRunKept } from "./myRuns";
import { publicSettings, updateSettings, saveCity, deleteCity, storeCmsUpload, providerEnabled, integrations, publicRefAllowed, cityStatus, cityExists, cityNotOpenError, publicCities, CMS_REF_PATTERN, refContentType, DEFAULT_SETTINGS } from "./cms";
import { validateImageBytes } from "./image-validation";
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
  requireVerifiedSubmitter,
  editPendingSubmission,
  removeSubmission,
} from "./submissions";
import { listAdminContent, editContentTitle, hideContent, restoreContent, archiveContent, deleteContent, listAdminDiscussions, editDiscussion, deleteDiscussion, setAnnouncement, clearAnnouncement } from "./contentAdmin";
import { createInvitation, revokeInvitation, listInvitations, validateInvitation, redeemInvitation } from "./invitations";
import { repairApprovedSubmissions } from "./submissionBackfill";
import {
  credentialType,
  evaluateTrustStatus,
  expireCredentials,
  parseProof,
  publicRecognitions,
  publicTrust,
  ratingEligibility,
  reconcileTrustStatus,
  resolveEventId,
  trustThreshold,
  validTags,
  validTrustReason,
} from "./trust";

export const SESSION_COOKIE = "runlocal_sid";
export const ADMIN_COOKIE = "runlocal_admin";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_JSON_BODY = 6 * 1024 * 1024; // 6 MB (selfie uploads)
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB decoded

function validateUploadedImage(bytes: Buffer, ext: string, minEdge: number): string | null {
  if (ext !== "jpg" && ext !== "png" && ext !== "webp") return "invalid_image";
  return validateImageBytes(bytes, ext, minEdge, MAX_IMAGE_BYTES);
}

// In-memory rate limiting (documented: replace with a shared store at scale).
const emailSendLog = new Map<string, number[]>();
const adminLoginAttempts = new Map<string, number[]>();
/** Persisted/shared limiter policy: 10 JoinRequests per account per rolling 60 minutes. */
const JOIN_REQUEST_LIMIT = 10;
const JOIN_REQUEST_WINDOW_MS = 60 * 60 * 1000;

export interface ApiDeps {
  db: Db;
}

export interface ApiError {
  status: number;
  error: string;
  message?: string;
  provider?: string;
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
function decodeImage(dataUrl: string, minEdge = 64): { ok: true; bytes: Buffer; ext: string } | { ok: false; error: string } {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!m) return { ok: false, error: "invalid_image" };
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const bytes = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  if (bytes.length === 0) return { ok: false, error: "invalid_image" };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: "image_too_large" };
  const validation = validateUploadedImage(bytes, ext, minEdge);
  if (validation) return { ok: false, error: validation };
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
  if (["POST", "PATCH", "DELETE"].includes(method) && !originAllowed(req)) return err(res, { status: 403, error: "origin_not_allowed" }), true;

  // ---- health (non-sensitive config booleans for the UI) -----------------
  if (method === "GET" && url.pathname === "/api/health") {
    const supabase = supabaseConfig();
    return ok(res, {
      ok: true,
      // Supabase email verification provider status — names of missing vars only, never
      // values, and never the anon key itself.
      supabaseConfigured: supabase.configured,
      supabaseMissing: supabase.missing,
      authRedirectConfigured: supabase.redirectConfigured,
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

  if (method === "GET" && url.pathname === "/api/events") {
    const cityId = url.searchParams.get("city") ?? undefined;
    return ok(res, { cityId: cityId ?? null, events: publicEvents(db, cityId) }), true;
  }
  // ---- public approved community content (no auth) -------------------------
  // Only APPROVED submissions ever appear here (pending/rejected never leave
  // the server), and owner-hidden content is excluded. No emails, phones, IPs,
  // or rejection reasons — just the public listing facts.
  if (method === "GET" && url.pathname === "/api/groups") {
    const cityId = url.searchParams.get("city") ?? "";
    if (!cityId || !cityExists(db, cityId)) return err(res, { status: 400, error: "invalid_city" }), true;
    return ok(res, { cityId, groups: publicGroups(db, cityId) }), true;
  }
  // Approved submission groups use stable user-<submissionId> ids.
  const groupDetail = /^\/api\/groups\/([^/]+)$/.exec(url.pathname);
  if (method === "GET" && groupDetail) { const group = publicGroup(db, groupDetail[1]); if (!group) return err(res,{status:404,error:"not_found"}),true; return ok(res,{group}),true; }

  // Group waiver endpoints: waiver text is public to the group directory, but signatures/status are private to the signed-in member.
  const waiverPath = /^\/api\/groups\/([^/]+)\/waiver$/.exec(url.pathname);
  if (waiverPath && method === "GET") {
    const group = db.getGroup(waiverPath[1]); if (!group) return err(res,{status:404,error:"not_found"}),true;
    const w = currentWaiver(db, group.id); return ok(res,{waiver:w ? {id:w.id,groupId:w.groupId,version:w.version,text:w.text,createdAt:w.createdAt} : null}),true;
  }
  if (waiverPath && method === "POST") {
    const sess=requireSession(db,cookies); if(!sess)return err(res,{status:401,error:"sign_in_required"}),true;
    const group=db.getGroup(waiverPath[1]); const actor=db.getAccount(sess.accountId); if(!group)return err(res,{status:404,error:"not_found"}),true;
    const body=await readJson(req) as {text?:unknown}; const rec=createWaiverVersion(db,group,actor,typeof body.text==="string"?body.text:"",now);
    if(!rec)return err(res,{status:403,error:"waiver_management_forbidden"}),true; await db.persist(); return ok(res,{waiver:rec}),true;
  }
  const signPath = /^\/api\/groups\/([^/]+)\/waiver\/sign$/.exec(url.pathname);
  if(signPath && method === "POST") { const sess=requireSession(db,cookies); if(!sess)return err(res,{status:401,error:"sign_in_required"}),true; const group=db.getGroup(signPath[1]); const actor=db.getAccount(sess.accountId); if(!group)return err(res,{status:404,error:"not_found"}),true; const rec=signWaiver(db,group.id,actor,now); if(!rec)return err(res,{status:400,error:"waiver_unavailable"}),true; await db.persist(); return ok(res,{signature:{signedAt:rec.signedAt,expiresAt:rec.expiresAt,versionId:rec.waiverVersionId}}),true; }
  if(method === "GET" && url.pathname === "/api/me/waivers") { const sess=requireSession(db,cookies); if(!sess)return err(res,{status:401,error:"sign_in_required"}),true; const expired=processWaiverExpiry(db,now); if(expired) await db.persist(); const rows=db.listMemberships(sess.accountId).filter(m=>m.status==="active").map(m=>({groupId:m.groupId,...waiverStatus(db,m.groupId,sess.accountId,now)})); return ok(res,{waivers:rows}),true; }
  // ---- organizer check-in: leader roster, check-in records, QR sessions -----
  // Privacy contract: the roster is private to the group's verified leaders
  // (owner / listed leaders / city admin / platform owner, same city). Rows
  // carry public profile identity (name, username) + RSVP / check-in / waiver
  // facts only — never email, phone, or home city. Waiver state is a warning
  // on the roster and in the mobile flow; it never blocks check-in. QR
  // sessions are occurrence-bound, expiring, revocable, and hash-only stored
  // (the raw token is returned exactly once at creation).
  const checkinPath = /^\/api\/groups\/([^/]+)\/events\/([^/]+)\/occurrences\/([^/]+)\/(roster|checkin|checkin\/undo|qr)$/.exec(url.pathname);
  if (checkinPath && (method === "GET" || method === "POST")) {
    const sess = requireSession(db, cookies); if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const actor = db.getAccount(sess.accountId); if (!actor || actor.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    const group = db.getGroup(decodeURIComponent(checkinPath[1]));
    if (!group) return err(res, { status: 404, error: "not_found" }), true;
    if (!canManageCheckins(group, actor)) return err(res, { status: 403, error: "forbidden" }), true;
    const eventId = decodeURIComponent(checkinPath[2]);
    const occurrenceId = decodeURIComponent(checkinPath[3]);
    const scope = resolveManagedOccurrence(db, group, eventId, occurrenceId);
    if (!scope) return err(res, { status: 404, error: "checkin_unavailable" }), true;
    const action = checkinPath[4];
    if (action === "roster" && method === "GET") {
      const expired = processWaiverExpiry(db, now); if (expired) await db.persist();
      return ok(res, {
        event: { id: scope.event.id, title: scope.event.title, runDate: scope.occ.runDate, startsAt: scope.occ.startsAt, time: scope.event.time, location: scope.event.location, groupId: group.id, groupName: group.name, cityId: group.cityId },
        occurrenceId,
        roster: rosterRows(db, scope.occ, now),
      }), true;
    }
    if (action === "checkin" && method === "POST") {
      const body = await readJson(req) as Record<string, unknown>;
      const targetId = typeof body.accountId === "string" ? body.accountId : "";
      if (!targetId) return err(res, { status: 400, error: "account_required" }), true;
      const result = leaderCheckin(db, group, scope.occ, actor, targetId, now);
      if ("error" in result) return err(res, { status: result.error === "not_on_roster" ? 400 : 404, error: result.error }), true;
      await db.persist();
      return ok(res, { checkin: { id: result.record.id, accountId: result.record.accountId, checkedInAt: result.record.checkedInAt, checkedInBy: result.record.checkedInBy, source: result.record.source } }), true;
    }
    if (action === "checkin/undo" && method === "POST") {
      const body = await readJson(req) as Record<string, unknown>;
      const targetId = typeof body.accountId === "string" ? body.accountId : "";
      if (!targetId) return err(res, { status: 400, error: "account_required" }), true;
      const removed = leaderUndoCheckin(db, scope.occ, targetId);
      await db.persist();
      return ok(res, { removed }), true;
    }
    if (action === "qr" && method === "POST") {
      const created = createQrSession(db, group, scope.occ, actor, now);
      await db.persist();
      // The raw token is returned exactly once; only its HMAC hash is stored.
      return ok(res, { session: created }), true;
    }
    return err(res, { status: 404, error: "not_found" }), true;
  }
  // ---- mobile QR flow: guest-safe peek + self-service join/sign/check-in ---
  // The token grants ONLY the caller's own actions on the bound occurrence:
  // RSVP (join), signing the group's current waiver, and checking themselves
  // in. It never exposes the roster and never grants leader powers. The
  // occurrence is taken from the session record — never from the request — so
  // a token can never check anyone in for a different event or date.
  const sessionPath = /^\/api\/checkin\/session\/([^/]+)(?:\/(join|sign|checkin))?$/.exec(url.pathname);
  if (sessionPath) {
    const token = decodeURIComponent(sessionPath[1]);
    const action = sessionPath[2] ?? null;
    const found = findSessionByToken(db, token, now);
    if (!found) return err(res, { status: 404, error: "checkin_session_not_found" }), true;
    if (!found.valid) return err(res, { status: 410, error: "checkin_session_expired", message: "This check-in link has expired or been revoked. Ask the organizer for a new one." }), true;
    const scope = validSessionOccurrence(db, found.session);
    if (!scope) return err(res, { status: 410, error: "checkin_session_expired", message: "This check-in link is no longer valid for this run." }), true;
    const sess = requireSession(db, cookies);
    const runner = sess ? db.getAccount(sess.accountId) : undefined;
    if (action === null && method === "GET") {
      const expired = processWaiverExpiry(db, now); if (expired) await db.persist();
      return ok(res, { ...sessionPublicDto(db, found.session, scope.occ, scope.event), me: sessionMeDto(db, found.session, runner?.id, now) }), true;
    }
    if (!runner || runner.deletedAt || runner.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    if (action === "join" && method === "POST") { joinViaSession(db, found.session, runner, now); await db.persist(); return ok(res, { rsvped: true }), true; }
    if (action === "sign" && method === "POST") {
      const signature = signViaSession(db, found.session, runner, now);
      if (!signature) return err(res, { status: 400, error: "waiver_unavailable" }), true;
      await db.persist();
      return ok(res, { signature: { signedAt: signature.signedAt, expiresAt: signature.expiresAt, versionId: signature.waiverVersionId } }), true;
    }
    if (action === "checkin" && method === "POST") {
      const result = checkinViaSession(db, found.session, runner, now);
      await db.persist();
      return ok(res, { checkin: { id: result.record.id, checkedInAt: result.record.checkedInAt, duplicate: result.duplicate } }), true;
    }
    return err(res, { status: 404, error: "not_found" }), true;
  }


  if (method === "GET" && url.pathname === "/api/me/groups") {
    const sess = requireSession(db, cookies); if (!sess) return err(res,{status:401,error:"sign_in_required"}),true;
    return ok(res, { memberships: myMemberships(db, sess.accountId) }), true;
  }
  const membershipPath = /^\/api\/groups\/([^/]+)\/membership$/.exec(url.pathname);
  if (membershipPath && method === "POST") {
    const sess = requireSession(db, cookies); if (!sess) return err(res,{status:401,error:"sign_in_required"}),true;
    const group = db.getGroup(membershipPath[1]); if (!group) return err(res,{status:404,error:"not_found"}),true;
    const account = db.getAccount(sess.accountId); if (!account || account.status !== "verified") return err(res,{status:403,error:"verified_runner_required"}),true;
    if (account.cityId !== group.cityId) return err(res,{status:403,error:"cross_city_forbidden"}),true;
    const current = db.getMembership(group.id, account.id);
    if (current && (current.status === "pending" || current.status === "active")) return ok(res,{membership:membershipDto(db,current)}),true;
    const status = group.membershipMode === "open" ? "active" : "pending";
    const membership = createMembership(db, group.id, account.id, status, now)!;
    db.appendAudit({admin:account.email, action:"group.membership_request", reason:"Member membership request", targetId:group.id, ip, cityId:group.cityId}); await db.persist();
    return ok(res,{membership:membershipDto(db,membership)}),true;
  }
  const membershipAction = /^\/api\/groups\/([^/]+)\/membership\/(leave|approve|decline|remove)$/.exec(url.pathname);
  if (membershipAction && method === "POST") {
    const sess = requireSession(db, cookies); if (!sess) return err(res,{status:401,error:"sign_in_required"}),true;
    const group = db.getGroup(membershipAction[1]); if (!group) return err(res,{status:404,error:"not_found"}),true;
    const body = await readJson(req) as Record<string,unknown>; const account = db.getAccount(sess.accountId);
    const targetId = typeof body.accountId === "string" ? body.accountId : sess.accountId;
    const membership = db.getMembership(group.id,targetId); if (!membership) return err(res,{status:404,error:"membership_not_found"}),true;
    const leader = canAdministerMembership(group, account ?? undefined, db.getAccount(targetId), membership);
    if (membershipAction[2] === "leave" && targetId === sess.accountId) { membership.status="left"; }
    else if (!leader && !isOwnerEmail(account?.email ?? "")) return err(res,{status:403,error:"forbidden"}),true;
    else membership.status = membershipAction[2] === "approve" ? "active" : membershipAction[2] === "decline" ? "declined" : "revoked";
    membership.updatedAt=now.toISOString(); membership.decidedAt=now.toISOString(); membership.decidedBy=sess.accountId;
    db.updateMembership(membership.id,membership); db.appendAudit({admin:account?.email ?? "unknown",action:(membershipAction[2] === "leave" ? "group.membership_leave" : membershipAction[2] === "approve" ? "group.membership_approve" : membershipAction[2] === "decline" ? "group.membership_decline" : "group.membership_remove") as import("./types").AdminAction,reason:"Membership lifecycle action",targetId:group.id,ip,cityId:group.cityId}); await db.persist();
    return ok(res,{membership:membershipDto(db,membership)}),true;
  }

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
    const offered = providerEnabled(db, provider);
    const connected = Boolean(db.getToken(sess.accountId, provider));
    if (method === "GET") {
      if (!offered) return ok(res, { provider, offered: false, configured: adapters[provider].configured(), connected, state: "unavailable" }), true;
      if (provider !== "strava") return ok(res, { provider, offered: true, configured: false, connected, state: "coming_soon", error: "provider_coming_soon" }), true;
      if (!adapters.strava.configured()) return ok(res, { provider, offered: true, configured: false, connected, state: "not_configured", missing: configError("strava").missing }), true;
      return ok(res, { provider, offered: true, configured: true, connected, state: connected ? "connected" : "available", authorizeUrl: connected ? undefined : adapters.strava.authorizeUrl(oauthState(sess.accountId, "strava")) }), true;
    }
    if (provider !== "strava") return err(res, { status: 409, error: "provider_coming_soon" }), true;
    if (!offered || !adapters.strava.configured()) return err(res, { status: 503, error: "provider_not_configured" }), true;
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

  // ---- account-owned notification preferences and inbox -------------------
  if (url.pathname.startsWith("/api/notifications")) {
    const sess=requireSession(db,cookies); if(!sess) return err(res,{status:401,error:"sign_in_required"}),true;
    if (method === "GET" && url.pathname === "/api/notifications/preferences") return ok(res,{preferences:db.getNotificationPreferences(sess.accountId)}),true;
    if (method === "PATCH" && url.pathname === "/api/notifications/preferences") { const b=await readJson(req) as Record<string,unknown>; const allowed=["run_reminders","community_updates","account_alerts"] as const; const patch: Record<string,boolean>={}; for(const k of allowed) if(b[k]!==undefined){if(typeof b[k]!=="boolean") return err(res,{status:400,error:"invalid_preferences"}),true; patch[k]=b[k] as boolean;} const preferences=db.setNotificationPreferences(sess.accountId,patch); await db.persist(); return ok(res,{preferences}),true; }
    if (method === "GET" && url.pathname === "/api/notifications") { const items=db.listNotifications(sess.accountId); return ok(res,{notifications:items,unreadCount:items.filter(n=>!n.readAt).length}),true; }
    if (method === "POST" && url.pathname === "/api/notifications/read-all") { db.markAllNotificationsRead(sess.accountId); await db.persist(); return ok(res,{status:"ok"}),true; }
    const m=/^\/api\/notifications\/([^/]+)\/read$/.exec(url.pathname); if(method==="POST"&&m){ if(!db.updateNotification(m[1],sess.accountId,{readAt:new Date().toISOString()})) return err(res,{status:404,error:"not_found"}),true; await db.persist(); return ok(res,{status:"ok"}),true; }
  }
  // ---- public username availability (format + uniqueness only) -----------
  // This endpoint is intentionally narrow: usernames are public profile identity,
  // and the response contains no account metadata or sensitive information.
  if (method === "GET" && url.pathname === "/api/username/availability") {
    const raw = url.searchParams.get("username") ?? "";
    const username = normalizeUsername(raw);
    if (!username) return ok(res, { valid: false, available: false }), true;
    const taken = db.getAccountByUsername(username);
    return ok(res, { valid: true, available: !taken || Boolean(taken.deletedAt) }), true;
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
  if (method === "POST" && url.pathname === "/api/group/photo") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { photo?: unknown };
    const rec = db.getAccount(sess.accountId);
    if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    const verified = requireVerifiedSubmitter(db, sess.accountId);
    if (!verified.ok) return err(res, { status: verified.status, error: verified.error, message: verified.message }), true;
    if (typeof body.photo !== "string") return err(res, { status: 400, error: "invalid_image" }), true;
    const img = decodeImage(body.photo, 256);
    if (!img.ok) return err(res, { status: 400, error: img.error }), true;
    const filename = `${rec.id}_group_${newId()}.${img.ext}`;
    await db.writePublicUpload(filename, img.bytes);
    return ok(res, { photoRef: filename }), true;
  }
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

  // ---- private My Runs (RSVP attendance + solo runs; server-authoritative) -
  // Past visibility rule (exact): a past row is returned ONLY when the runner
  // checked in to that occurrence or explicitly kept it ("Keep on My Runs").
  // Kept history is indefinite; upcoming rows behave exactly as before.
  if (method === "GET" && url.pathname === "/api/my/runs") {
    const sess = requireSession(db, cookies); if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(sess.accountId); if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (rec.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    return ok(res, { runs: listMyRuns(db, sess.accountId, rec.cityId ?? "", now) }), true;
  }
  // ---- keep on My Runs (opt-in indefinite history; caller-scoped) ----------
  if (method === "POST" && url.pathname === "/api/my/runs/keep") {
    const sess = requireSession(db, cookies); if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(sess.accountId); if (!rec || rec.deletedAt || rec.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    const b = await readJson(req) as Record<string, unknown>;
    const runId = typeof b.runId === "string" ? b.runId : "";
    if (!runId) return err(res, { status: 400, error: "invalid_run" }), true;
    const result = setMyRunKept(db, sess.accountId, runId, b.kept === true, now);
    if (!result) return err(res, { status: 404, error: "not_found" }), true;
    await db.persist();
    return ok(res, result), true;
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
      groupmeUrl?: unknown; facebookUrl?: unknown; instagramUrl?: unknown; websiteUrl?: unknown; coverPhoto?: unknown; logoPhoto?: unknown; membershipMode?: unknown;
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

  // ==================== CREDENTIALS & COMMUNITY TRUST ======================
  // Privacy invariants for this whole block:
  //  - Proof bytes are private uploads — never in any JSON payload; served
  //    ONLY to the credential owner or an audited admin via dedicated routes.
  //  - Reviewer identity, rating/concern reasons, and raw counts/scores are
  //    never exposed in any public payload — the public surface is qualitative
  //    (tier labels, coach/host booleans, recognition roles).
  //  - Rating/concern eligibility is server-derived from SHARED attendance
  //    (RSVP or host) — a stranger can never rate or report another runner.

  // ---- my credentials (owner-only view; no proof bytes, no reviewer data) --
  if (url.pathname === "/api/credentials" && method === "GET") {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    expireCredentials(db, now);
    return ok(res, { credentials: db.listCredentials(s.accountId).map((c) => ({ id: c.id, type: c.type, certifyingBody: c.certifyingBody, issuedOn: c.issuedOn, expiresOn: c.expiresOn, status: c.status, decisionReason: c.decisionReason, hasProof: c.proofRef !== null })) }), true;
  }

  // ---- submit a credential (coach certification requires proof) -----------
  if (url.pathname === "/api/credentials" && method === "POST") {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(s.accountId); if (!rec || rec.deletedAt || rec.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    const b = await readJson(req) as Record<string, unknown>;
    if (!credentialType(b.type) || typeof b.certifyingBody !== "string" || !b.certifyingBody.trim()) return err(res, { status: 400, error: "invalid_credential" }), true;
    const p = parseProof(b);
    if (b.type === "coach_certification" && !p) return err(res, { status: 400, error: "proof_required" }), true;
    const proofRef = p ? `credential-${crypto.randomUUID()}` : null;
    const c = {
      id: crypto.randomUUID().replace(/-/g, ""),
      accountId: s.accountId,
      type: b.type,
      certifyingBody: b.certifyingBody.trim().slice(0, 120),
      proofRef,
      proofMime: p?.mime ?? null,
      proofBytes: p?.bytes.length ?? 0,
      issuedOn: typeof b.issuedOn === "string" ? b.issuedOn : null,
      expiresOn: typeof b.expiresOn === "string" ? b.expiresOn : null,
      status: b.type === "first_aid_cpr" && !p ? "verified" : "pending_review",
      verifiedBy: b.type === "first_aid_cpr" && !p ? "self" : null,
      verifiedAt: b.type === "first_aid_cpr" && !p ? now.toISOString() : null,
      decisionReason: null,
      renewalNotifiedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    } as import("./types").CredentialRecord;
    if (p && proofRef) await db.writePrivateUpload(proofRef, p.bytes);
    db.addCredential(c);
    await db.persist();
    return ok(res, { credential: { id: c.id, type: c.type, status: c.status } }), true;
  }

  // ---- protected proof view (credential owner only) -----------------------
  // The proof file is served ONLY to the credential's own account — it is
  // never in any listing payload and never served to third parties.
  const credentialProof = /^\/api\/credentials\/([a-f0-9]{32})\/proof$/.exec(url.pathname);
  if (method === "GET" && credentialProof) {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    const c = db.getCredential(credentialProof[1]);
    if (!c || c.accountId !== s.accountId || !c.proofRef) return err(res, { status: 404, error: "not_found" }), true;
    const bytes = await db.readPrivateUpload(c.proofRef);
    if (!bytes) return err(res, { status: 404, error: "not_found" }), true;
    res.writeHead(200, { "content-type": c.proofMime ?? "application/octet-stream", "cache-control": "private, no-store" });
    res.end(bytes);
    return true;
  }

  // ---- qualitative trust view (public; owner extras only for self) --------
  if (url.pathname === "/api/profile/trust" && method === "GET") {
    const id = url.searchParams.get("accountId");
    if (!id) return err(res, { status: 400, error: "account_required" }), true;
    const sess = requireSession(db, cookies);
    const viewerId = sess ? sess.accountId : null;
    return ok(res, publicTrust(db, id, viewerId)), true;
  }

  // ---- public recognitions: NON-RANKED qualitative list for a city --------
  if (url.pathname === "/api/recognitions" && method === "GET") {
    const cityId = url.searchParams.get("city") ?? "";
    if (!cityId) return err(res, { status: 400, error: "invalid_city" }), true;
    return ok(res, { recognitions: publicRecognitions(db, cityId) }), true;
  }

  // ---- private matching preferences ----------------------------------------
  if (url.pathname === "/api/matching/preferences" && (method === "GET" || method === "PATCH")) {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (!db.getAccount(s.accountId)) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (method === "GET") return ok(res, { preferences: db.getMatchingPreferences(s.accountId) ?? { accountId:s.accountId, enabled:false, consentVersion:null, consentedAt:null, cityId:null, timeWindow:null, selfDescribedGender:null, genderPreference:null, updatedAt:null } }), true;
    const b = await readJson(req) as Record<string, unknown>;
    if (typeof b.enabled !== "boolean") return err(res, { status:400, error:"invalid_enabled" }), true;
    if (b.enabled && (b.consent !== true || b.consentVersion !== MATCHING_CONSENT_VERSION)) return err(res, { status:400, error:"consent_required" }), true;
    const cityId = b.cityId == null ? null : typeof b.cityId === "string" ? b.cityId.trim() : "";
    const timeWindow = b.timeWindow == null ? null : b.timeWindow;
    const text = (v:unknown) => v == null || (typeof v === "string" && v.trim().length <= 80);
    if ((cityId !== null && cityStatus(db, cityId) === null) || (timeWindow !== null && !["morning","afternoon","evening","flexible"].includes(String(timeWindow))) || !text(b.selfDescribedGender) || !text(b.genderPreference)) return err(res, { status:400, error:"invalid_preferences" }), true;
    const old = db.getMatchingPreferences(s.accountId); const p = { accountId:s.accountId, enabled:b.enabled, consentVersion:b.enabled ? MATCHING_CONSENT_VERSION : null, consentedAt:b.enabled ? (old?.consentedAt ?? now.toISOString()) : null, cityId, timeWindow:timeWindow as any, selfDescribedGender:typeof b.selfDescribedGender === "string" ? b.selfDescribedGender.trim() || null : null, genderPreference:typeof b.genderPreference === "string" ? b.genderPreference.trim() || null : null, updatedAt:now.toISOString() };
    db.setMatchingPreferences(p); await db.persist(); return ok(res, { preferences:p }), true;
  }

  // ---- private join requests (no discovery/candidate listing) -------------
  // Blocking is symmetric for matching and immediately invalidates requests.
  if (url.pathname === "/api/blocks" && (method === "GET" || method === "POST" || method === "DELETE")) {
    const s=requireSession(db,cookies); if(!s)return err(res,{status:401,error:"sign_in_required"}),true;
    if(method === "GET") return ok(res,{blocks:db.listBlocks(s.accountId).map(b=>({blockedId:b.blockedId,createdAt:b.createdAt}))}),true;
    const b=await readJson(req) as Record<string,unknown>; const target=typeof b.accountId === "string" ? b.accountId : typeof b.blockedId === "string" ? b.blockedId : "";
    if(!target || target===s.accountId || !db.getAccount(target)) return err(res,{status:400,error:"invalid_block"}),true;
    if(method === "DELETE") { db.removeBlock(s.accountId,target); await db.persist(); return ok(res,{removed:true}),true; }
    db.addBlock({blockerId:s.accountId,blockedId:target,createdAt:now.toISOString()}); db.invalidateJoinRequests(s.accountId,target); await db.persist(); return ok(res,{blocked:true}),true;
  }
  if (url.pathname === "/api/join-requests" && (method === "GET" || method === "POST")) {
    const s=requireSession(db,cookies); if(!s)return err(res,{status:401,error:"sign_in_required"}),true;
    if(method==="GET") return ok(res,{requests:db.listJoinRequests(s.accountId).map(r=>{ if(r.state === "pending" && new Date(r.expiresAt)<=now){db.updateJoinRequest(r.id,{state:"expired",updatedAt:now.toISOString()}); r={...r,state:"expired"};} return {id:r.id,contextType:r.contextType,state:r.state,createdAt:r.createdAt,expiresAt:r.expiresAt,updatedAt:r.updatedAt}; })}),true;
    const b=await readJson(req) as Record<string,unknown>, target=typeof b.targetId==="string"?b.targetId:"", kind=b.contextType as "event" | "personal_run", context=typeof b.contextId==="string"?b.contextId:"";
    const requester=db.getAccount(s.accountId), recipient=db.getAccount(target);
    const eligible=(a: typeof requester) => !!a && !a.deletedAt && a.status === "verified" && !a.underReview;
    if(!target||target===s.accountId||!eligible(requester)||!eligible(recipient)||(kind!=="event"&&kind!=="personal_run")||!context)return err(res,{status:400,error:"invalid_join_request"}),true;
    const rp=db.getMatchingPreferences(s.accountId), tp=db.getMatchingPreferences(target);
    if(!rp?.enabled || rp.consentVersion !== MATCHING_CONSENT_VERSION || !tp?.enabled || tp.consentVersion !== MATCHING_CONSENT_VERSION) return err(res,{status:403,error:"matching_consent_required"}),true;
    let contextCity: string | null = null;
    if(kind==="personal_run"){const run=db.getPersonalRun(context);if(!run||run.accountId!==target||run.deletedAt)return err(res,{status:404,error:"not_found"}),true; contextCity=run.cityId;}
    else { const eid=resolveEventId(db,context), event=eid ? db.getContent(eid) : undefined; if(!event || !db.hasAttendance(s.accountId,eid!)) return err(res,{status:403,error:"event_eligibility_required"}),true; contextCity=event.cityId; }
    if(requester?.cityId !== contextCity || recipient?.cityId !== contextCity || rp.cityId !== contextCity || tp.cityId !== contextCity)return err(res,{status:403,error:"cross_city"}),true;
    if(db.isBlocked(s.accountId,target))return err(res,{status:403,error:"blocked"}),true;
    if (!db.consumeJoinRequestRate(s.accountId, now.getTime(), JOIN_REQUEST_LIMIT, JOIN_REQUEST_WINDOW_MS)) return err(res, { status: 429, error: "rate_limited", message: "Too many join requests. Try again later." }), true;
    if(db.findPendingJoinRequest(s.accountId,target,kind,context))return err(res,{status:409,error:"duplicate_request"}),true;
    const r: import("./types").JoinRequestRecord={id:newId(),requesterId:s.accountId,recipientId:target,contextType:kind,contextId:context,state:"pending",requesterAccepted:false,recipientAccepted:false,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+7*86400000).toISOString(),updatedAt:now.toISOString()};db.addJoinRequest(r);await db.persist();return ok(res,{request:{id:r.id,state:r.state,contextType:r.contextType,createdAt:r.createdAt,expiresAt:r.expiresAt,updatedAt:r.updatedAt},mutual:false}),true;
  }
  const ja=/^\/api\/join-requests\/([^/]+)\/(accept|decline|cancel)$/.exec(url.pathname);
  if(ja&&method==="POST"){const s=requireSession(db,cookies);if(!s)return err(res,{status:401,error:"sign_in_required"}),true;const r=db.getJoinRequest(ja[1]);if(!r)return err(res,{status:404,error:"not_found"}),true;if(r.state!=="pending")return err(res,{status:409,error:"invalid_state"}),true;if(new Date(r.expiresAt)<=now){db.updateJoinRequest(r.id,{state:"expired",updatedAt:now.toISOString()});await db.persist();return err(res,{status:409,error:"expired"}),true;}const action=ja[2];if((action==="accept" && r.requesterId!==s.accountId && r.recipientId!==s.accountId)||(action==="decline"&&r.recipientId!==s.accountId)||(action==="cancel"&&r.requesterId!==s.accountId))return err(res,{status:403,error:"forbidden"}),true;const requesterAccepted = r.requesterAccepted || (action === "accept" && r.requesterId === s.accountId); const recipientAccepted = r.recipientAccepted || (action === "accept" && r.recipientId === s.accountId); const state: import("./types").JoinRequestState=action==="accept"?(requesterAccepted && recipientAccepted ? "accepted" : "pending"):action==="decline"?"declined":"cancelled"; const next={...r,state,requesterAccepted,recipientAccepted,updatedAt:now.toISOString()};db.updateJoinRequest(r.id,next);await db.persist();return ok(res,{request:{id:next.id,contextType:next.contextType,state:next.state,createdAt:next.createdAt,expiresAt:next.expiresAt,updatedAt:next.updatedAt},mutual:state === "accepted"}),true;}

  // ---- strictly private PersonalRun records -------------------------------
  // Account identity is always derived from the HttpOnly session. PersonalRuns
  // never enter public content, admin dashboards, or matching surfaces.
  if (url.pathname === "/api/personal-runs" && (method === "GET" || method === "POST")) {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(s.accountId); if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (rec.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    if (method === "GET") return ok(res, { runs: db.listPersonalRuns(s.accountId).filter(r => !r.deletedAt) }), true;
    const b = await readJson(req) as Record<string, unknown>;
    const cityId = typeof b.cityId === "string" ? b.cityId.trim() : "";
    const title = typeof b.title === "string" ? b.title.trim() : "";
    const startsAt = typeof b.startsAt === "string" ? b.startsAt : "";
    const validText = (v: unknown, max: number) => v === undefined || v === null || (typeof v === "string" && v.trim().length <= max);
    if (!cityId || cityStatus(db, cityId) === null) return err(res, { status: 400, error: "invalid_city" }), true;
    if (!title || title.length > 120 || !validText(b.locationLabel, 160) || !validText(b.distanceLabel, 80) || !validText(b.notes, 1000)) return err(res, { status: 400, error: "invalid_personal_run" }), true;
    const parsed = new Date(startsAt); const nowMs = now.getTime();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(startsAt) || Number.isNaN(parsed.getTime()) || parsed.getTime() < nowMs - 24 * 60 * 60 * 1000 || parsed.getTime() > nowMs + 2 * 365 * 24 * 60 * 60 * 1000) return err(res, { status: 400, error: "invalid_starts_at" }), true;
    if (b.consentVersion !== PERSONAL_RUN_CONSENT_VERSION || b.consent !== true) return err(res, { status: 400, error: "consent_required" }), true;
    const r = { id: newId(), accountId: s.accountId, cityId, title, startsAt: parsed.toISOString(), locationLabel: typeof b.locationLabel === "string" && b.locationLabel.trim() ? b.locationLabel.trim() : null, distanceLabel: typeof b.distanceLabel === "string" && b.distanceLabel.trim() ? b.distanceLabel.trim() : null, notes: typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : null, visibility: "private" as const, consentVersion: PERSONAL_RUN_CONSENT_VERSION, consentedAt: now.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString(), deletedAt: null };
    db.addPersonalRun(r); await db.persist(); return ok(res, { run: r }), true;
  }
  const personalRunId = /^\/api\/personal-runs\/([^/]+)$/.exec(url.pathname);
  if (personalRunId && (method === "PATCH" || method === "DELETE")) {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(s.accountId); if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (rec.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    const run = db.getPersonalRun(decodeURIComponent(personalRunId[1]));
    if (!run || run.accountId !== s.accountId || run.deletedAt) return err(res, { status: 404, error: "not_found" }), true;
    if (method === "DELETE") { db.updatePersonalRun(run.id, { deletedAt: now.toISOString(), updatedAt: now.toISOString() }); await db.persist(); return ok(res, { deleted: true }), true; }
    const b = await readJson(req) as Record<string, unknown>;
    // PATCH uses the same complete validation contract as POST. Merge only
    // editable fields; identity and privacy fields always come from `run`.
    if (b.consent !== true || b.consentVersion !== PERSONAL_RUN_CONSENT_VERSION) return err(res, { status: 400, error: "consent_required" }), true;
    const cityId = typeof b.cityId === "string" ? b.cityId.trim() : run.cityId;
    const title = typeof b.title === "string" ? b.title.trim() : run.title;
    const startsAt = typeof b.startsAt === "string" ? b.startsAt : run.startsAt;
    const validText = (v: unknown, max: number) => v === undefined || v === null || (typeof v === "string" && v.trim().length <= max);
    if (!cityId || cityStatus(db, cityId) === null || !title || title.length > 120 || !validText(b.locationLabel, 160) || !validText(b.distanceLabel, 80) || !validText(b.notes, 1000)) return err(res, { status: 400, error: "invalid_personal_run" }), true;
    const parsed = new Date(startsAt); const nowMs = now.getTime();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(startsAt) || Number.isNaN(parsed.getTime()) || parsed.getTime() < nowMs - 24 * 60 * 60 * 1000 || parsed.getTime() > nowMs + 2 * 365 * 24 * 60 * 60 * 1000) return err(res, { status: 400, error: "invalid_starts_at" }), true;
    const next = db.updatePersonalRun(run.id, { cityId, title, startsAt: parsed.toISOString(), locationLabel: typeof b.locationLabel === "string" ? b.locationLabel.trim() || null : run.locationLabel, distanceLabel: typeof b.distanceLabel === "string" ? b.distanceLabel.trim() || null : run.distanceLabel, notes: typeof b.notes === "string" ? b.notes.trim() || null : run.notes, consentVersion: PERSONAL_RUN_CONSENT_VERSION, consentedAt: now.toISOString(), updatedAt: now.toISOString() }); await db.persist(); return ok(res, { run: next }), true;
  }

  // ---- occurrence-scoped run-day discussion -------------------------------
  const discussionPath = /^\/api\/events\/([^/]+)\/occurrences\/([^/]+)\/discussion(?:\/([^/]+))?$/i.exec(url.pathname);
  if (discussionPath && (method === "GET" || method === "POST" || method === "DELETE")) {
    const eventParam = decodeURIComponent(discussionPath[1]);
    const occurrenceId = decodeURIComponent(discussionPath[2]);
    const event = db.listEvents().find(e => e.id === eventParam || e.seedRefId === eventParam || e.id === `event:${eventParam}`);
    // Occurrence IDs are `event:<event-id>:<YYYY-MM-DD>`; split only at the
    // final colon because event IDs themselves may contain colons.
    const separator = occurrenceId.lastIndexOf(":");
    const occurrenceEventId = separator > 0 ? occurrenceId.slice(0, separator) : "";
    const runDate = separator > 0 ? occurrenceId.slice(separator + 1) : "";
    const occ = event && (event.id === occurrenceEventId || event.id === occurrenceEventId.replace(/^event:/, "") || event.seedRefId === occurrenceEventId.replace(/^event:/, ""))
      ? resolveOccurrence(db, event.id, runDate) : null;
    if (!event || !occ || occ.occurrenceId !== occurrenceId || event.status !== "published" || event.hidden || event.archivedAt) return err(res, { status: 404, error: "discussion_unavailable" }), true;
    const publicDto = (d: import("./types").DiscussionRecord) => ({ id:d.id, kind:d.kind, parentId:d.parentId, occurrenceId:d.occurrenceId, eventId:d.eventId, cityId:d.cityId, title:d.title, body:d.body, authorId:d.authorId, createdAt:d.createdAt, updatedAt:d.updatedAt });
    // Discussion reads are private to verified participants; this is not a public forum.
    const sess = requireSession(db, cookies); if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const account = db.getAccount(sess.accountId);
    const attendance = account && db.listAttendance(account.id).some(a => (a.role === "rsvp" || a.role === "host") && sameEventId(a.eventId, event.id) && a.occurrenceId === occurrenceId);
    if (!account || account.deletedAt || account.status !== "verified" || !attendance || account.cityId !== event.cityId) return err(res, { status: 403, error: "participant_required" }), true;
    if (method === "GET") return ok(res, { discussion: db.listDiscussions(occurrenceId).map(publicDto) }), true;
    if (account.suspended && (!account.suspendedUntil || new Date(account.suspendedUntil) > now)) return err(res, { status: 403, error: "suspended" }), true;
    if (!db.consumeDiscussionRate(account.id, now.getTime())) return err(res, { status: 429, error: "rate_limited" }), true;
    if (method === "DELETE") {
      const target = db.getDiscussion(decodeURIComponent(discussionPath[3] ?? ""));
      if (!target || target.authorId !== account.id || target.occurrenceId !== occurrenceId || target.state === "deleted") return err(res, { status: 404, error: "not_found" }), true;
      db.updateDiscussion(target.id, { state: "deleted", body: "", title: null }); await db.persist(); return ok(res, { deleted: true }), true;
    }
    const b = await readJson(req) as Record<string, unknown>;
    const body = typeof b.body === "string" ? b.body.trim() : "";
    const title = typeof b.title === "string" ? b.title.trim() : null;
    const parentId = typeof b.parentId === "string" ? b.parentId : null;
    if (!body || body.length > 1000 || (title !== null && (!title || title.length > 120)) || (parentId && (!db.getDiscussion(parentId) || db.getDiscussion(parentId)?.occurrenceId !== occurrenceId))) return err(res, { status: 400, error: "invalid_discussion" }), true;
    const kind = parentId ? "comment" : "thread";
    if (kind === "thread" && title === null) return err(res, { status: 400, error: "title_required" }), true;
    const record: import("./types").DiscussionRecord = { id:newId(), kind, parentId, occurrenceId, eventId:event.id, cityId:event.cityId, authorId:account.id, title:title ? title.slice(0,120) : null, body:body.slice(0,1000), state:"visible", createdAt:now.toISOString(), updatedAt:now.toISOString() };
    db.addDiscussion(record);
    const recipients = new Set(db.listDiscussions(occurrenceId).filter(d => d.authorId !== account.id && !db.isBlocked(account.id,d.authorId)).map(d => d.authorId));
    if (parentId) { const parent=db.getDiscussion(parentId); if(parent && parent.authorId !== account.id && !db.isBlocked(account.id,parent.authorId)) recipients.add(parent.authorId); }
    for (const recipient of recipients) if (db.getNotificationPreferences(recipient).community_updates) db.addNotification({id:newId(),accountId:recipient,category:"community_updates",title:"New run-day discussion activity",body:"Someone added to a run you joined.",createdAt:now.toISOString(),readAt:null});
    await db.persist(); return ok(res, { discussion: publicDto(record) }), true;
  }

  // ---- RSVP to an event occurrence (server-validated schedule) ------------
  if (url.pathname === "/api/events/rsvp" && method === "POST") {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(s.accountId); if (!rec || rec.deletedAt || rec.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    const b = await readJson(req) as Record<string, unknown>; const requestedId = typeof b.eventId === "string" ? b.eventId : "";
    const rawId = requestedId.replace(/^event:/, "");
    const known = db.listEvents().find(e => e.id === requestedId || e.id === rawId || e.seedRefId === rawId);
    const date = typeof b.runDate === "string" ? b.runDate : (known ? defaultOccurrenceDate(known, now) : "");
    const want = b.rsvp !== false;
    if (want) {
      const occ = resolveOccurrence(db, requestedId, date);
      if (!occ) return err(res, { status: 400, error: "invalid_occurrence", message: "That date is not a scheduled occurrence of this event." }), true;
      // Idempotent: a second RSVP for the same occurrence is a no-op (one row).
      const mine = db.listAttendance(s.accountId).filter(a => a.role === "rsvp" && sameEventId(a.eventId, occ.eventId) && a.occurrenceId === occ.occurrenceId);
      if (!mine.length) { db.addAttendance({ id: crypto.randomUUID().replace(/-/g,""), accountId:s.accountId, eventId:occ.eventId, role:"rsvp", createdAt:now.toISOString(), occurrenceId:occ.occurrenceId, runDate:occ.runDate, startsAt:occ.startsAt }); await db.persist(); }
      return ok(res, { rsvped: true, occurrenceId:occ.occurrenceId, runDate:occ.runDate, startsAt:occ.startsAt }), true;
    }
    // Removal is occurrence-exact and owner-scoped: it touches only the
    // caller's own rsvp attendance row(s) for this exact occurrence — never
    // host rows, never other accounts, never sibling occurrences.
    const runId = typeof b.runId === "string" && b.runId ? b.runId : "";
    if (runId) {
      // Precise row removal by the attendance id the My Runs list exposes.
      // This also covers legacy attendance rows whose stored date is not a
      // resolvable occurrence (the date-based path would reject them); the row
      // itself is the authority and identity always comes from the session.
      const row = db.listAttendance(s.accountId).find(a => a.id === runId && a.role === "rsvp");
      if (!row) return ok(res, { rsvped: false }), true; // idempotent: already gone
      const refs = [known?.id, known?.seedRefId, requestedId].filter((x): x is string => !!x);
      if (requestedId && !refs.some(ref => sameEventId(row.eventId, ref))) return err(res, { status: 400, error: "invalid_run", message: "That RSVP does not belong to this run." }), true;
      db.removeAttendance(row.id); await db.persist();
      return ok(res, { rsvped: false, occurrenceId: row.occurrenceId ?? null, runDate: row.runDate ?? null, startsAt: row.startsAt ?? null }), true;
    }
    const occ = resolveOccurrence(db, requestedId, date);
    if (!occ) return err(res, { status: 400, error: "invalid_occurrence", message: "That date is not a scheduled occurrence of this event." }), true;
    const mine = db.listAttendance(s.accountId).filter(a => a.role === "rsvp" && sameEventId(a.eventId, occ.eventId) && a.occurrenceId === occ.occurrenceId);
    for (const a of mine) db.removeAttendance(a.id);
    if (mine.length) await db.persist();
    return ok(res, { rsvped: false, occurrenceId: occ.occurrenceId, runDate: occ.runDate, startsAt: occ.startsAt }), true;
  }
  // ---- ratings (server-eligible: shared RSVP/host attendance only) --------
  if (url.pathname === "/api/ratings" && method === "POST") {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(s.accountId); if (!rec || rec.deletedAt || rec.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    const b = await readJson(req) as Record<string, unknown>;
    if (typeof b.revieweeId !== "string" || typeof b.eventId !== "string" || typeof b.positive !== "boolean") return err(res, { status: 400, error: "invalid_rating" }), true;
    const elig = ratingEligibility(db, s.accountId, b.revieweeId, b.eventId);
    if (!elig.ok) return err(res, { status: elig.status, error: elig.error, message: elig.message }), true;
    if (db.hasRating(s.accountId, b.revieweeId, elig.data.eventId)) return err(res, { status: 409, error: "already_rated", message: "You already rated this runner for this event." }), true;
    const positive = b.positive === true;
    if (positive && !validTags(b.tags)) return err(res, { status: 400, error: "invalid_tags" }), true;
    if (!positive && !validTrustReason(b.reason)) return err(res, { status: 400, error: "reason_required", message: "A reason (5-500 chars) is required for a negative rating — admins review it privately." }), true;
    const r = { id: crypto.randomUUID().replace(/-/g, ""), reviewerId: s.accountId, revieweeId: b.revieweeId, eventId: elig.data.eventId, positive, tags: positive ? b.tags : [], reason: positive ? null : (b.reason as string).trim().slice(0, 500), createdAt: now.toISOString() } as import("./types").RatingRecord;
    db.addRating(r);
    if (!positive) evaluateTrustStatus(db, b.revieweeId, now); // auto under-review at threshold
    await db.persist();
    return ok(res, { rating: { id: r.id } }), true;
  }

  // ---- private concerns (shared-attendance eligibility, admin-only) -------
  if (url.pathname === "/api/concerns" && method === "POST") {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(s.accountId); if (!rec || rec.deletedAt || rec.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    const b = await readJson(req) as Record<string, unknown>;
    if (typeof b.subjectId !== "string" || typeof b.eventId !== "string") return err(res, { status: 400, error: "invalid_concern" }), true;
    if (!validTrustReason(b.reason)) return err(res, { status: 400, error: "reason_required", message: "Describe the concern (5-500 chars) — it goes to admins only, never public." }), true;
    const elig = ratingEligibility(db, s.accountId, b.subjectId, b.eventId);
    if (!elig.ok) return err(res, { status: elig.status, error: elig.error, message: elig.message }), true;
    const c = { id: crypto.randomUUID().replace(/-/g, ""), reporterId: s.accountId, subjectId: b.subjectId, eventId: elig.data.eventId, reason: (b.reason as string).trim().slice(0, 500), status: "open" as const, createdAt: now.toISOString() } as import("./types").ConcernRecord;
    db.addConcern(c);
    evaluateTrustStatus(db, b.subjectId, now);
    await db.persist();
    return ok(res, { submitted: true }), true;
  }

  // ---- scoped safety reports: verified runners only -----------------------
  if (url.pathname === "/api/safety-reports" && method === "POST") {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    const reporter = db.getAccount(s.accountId); if (!reporter || reporter.deletedAt || reporter.status !== "verified" || reporter.underReview) return err(res, { status: 403, error: "verified_runner_required" }), true;
    if (!db.consumeSafetyReportRate(s.accountId, now.getTime())) return err(res, { status: 429, error: "rate_limited" }), true;
    const b = await readJson(req) as Record<string, unknown>;
    if (typeof b.subjectId !== "string" || typeof b.contextType !== "string" || typeof b.contextId !== "string" || typeof b.reason !== "string" || !["join_request","event","personal_run"].includes(b.contextType)) return err(res, { status: 400, error: "invalid_report" }), true;
    const reasonText = b.reason.trim(); if (reasonText.length < 5 || reasonText.length > 500) return err(res, { status: 400, error: "invalid_reason" }), true;
    const subject = db.getAccount(b.subjectId); if (!subject || subject.deletedAt || subject.id === reporter.id) return err(res, { status: 404, error: "not_found" }), true;
    let cityId: string | null = null;
    if (b.contextType === "join_request") { const jr = db.getJoinRequest(b.contextId); if (!jr || (jr.requesterId !== reporter.id && jr.recipientId !== reporter.id) || (jr.requesterId !== b.subjectId && jr.recipientId !== b.subjectId) || db.isBlocked(reporter.id, b.subjectId)) return err(res, { status: 403, error: "invalid_context" }), true; const run = jr.contextType === "personal_run" ? db.getPersonalRun(jr.contextId) : null; cityId = run?.cityId ?? reporter.cityId; }
    else if (b.contextType === "personal_run") { const run = db.getPersonalRun(b.contextId); if (!run || run.deletedAt || run.accountId !== b.subjectId || reporter.cityId !== run.cityId || db.isBlocked(reporter.id, b.subjectId)) return err(res, { status: 403, error: "invalid_context" }), true; cityId = run.cityId; }
    else { if (!db.hasAttendance(reporter.id, b.contextId) || !db.hasAttendance(subject.id, b.contextId)) return err(res, { status: 403, error: "invalid_context" }), true; cityId = reporter.cityId; }
    if (!cityId || (db.listSafetyReports().some(r => r.reporterId === reporter.id && r.subjectId === subject.id && r.contextType === b.contextType && r.contextId === b.contextId && r.status !== "dismissed"))) return err(res, { status: 409, error: "duplicate_report" }), true;
    const report = { id: newId(), reporterId: reporter.id, subjectId: subject.id, cityId, contextType: b.contextType as any, contextId: b.contextId, reason: reasonText.slice(0, 500), status: "open" as const, createdAt: now.toISOString(), updatedAt: now.toISOString(), resolvedAt: null };
    db.addSafetyReport(report); await db.persist(); return ok(res, { report: { id: report.id, status: report.status } }), true;
  }

  // ---- my appeals (own records only) --------------------------------------
  if (url.pathname === "/api/appeals" && method === "GET") {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    return ok(res, { appeals: db.listAppeals(s.accountId).map((a) => ({ id: a.id, reason: a.reason, status: a.status, createdAt: a.createdAt, decidedAt: a.decidedAt, decisionReason: a.decisionReason })) }), true;
  }

  // ---- file an appeal (only while under review; one open appeal at a time)
  if (url.pathname === "/api/appeals" && method === "POST") {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(s.accountId); if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (rec.underReview !== true) return err(res, { status: 409, error: "nothing_to_appeal", message: "Your account is not under community review right now." }), true;
    const b = await readJson(req) as Record<string, unknown>;
    if (!validTrustReason(b.reason)) return err(res, { status: 400, error: "invalid_appeal", message: "Explain your appeal (5-500 chars)." }), true;
    if (db.listAppeals(s.accountId).some((a) => a.status === "open")) return err(res, { status: 409, error: "appeal_open", message: "You already have an open appeal." }), true;
    const a = { id: crypto.randomUUID().replace(/-/g, ""), accountId: s.accountId, reason: (b.reason as string).trim().slice(0, 500), status: "open" as const, createdAt: now.toISOString(), decidedAt: null, decidedBy: null, decisionReason: null } as import("./types").AppealRecord;
    db.addAppeal(a);
    await db.persist();
    return ok(res, { appeal: { id: a.id, status: a.status } }), true;
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
  // Idempotent repair for legacy approved submissions; owner/key admin only.
  if (method === "POST" && url.pathname === "/api/admin/city/submissions/backfill") {
    const auth = authorizeAdmin(db, ctx, "admin.submission_approve", null, now);
    if (!auth.ok) return sendErr(auth), true;
    const result = repairApprovedSubmissions(db, now);
    await db.persist();
    return ok(res, result), true;
  }

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
  if (method === "GET" && url.pathname === "/api/admin/credentials") { const a=authorizeAdmin(db,ctx,"admin.pending_list",null,now);if(!a.ok)return sendErr(a),true;return ok(res,{credentials:db.listCredentials().filter(c=>c.status==="pending_review").map(c=>({id:c.id,accountId:c.accountId,type:c.type,certifyingBody:c.certifyingBody,issuedOn:c.issuedOn,expiresOn:c.expiresOn}))}),true; }
  const credentialDecision=/^\/api\/admin\/credentials\/([a-f0-9]{32})\/(approve|reject)$/.exec(url.pathname);
  if (credentialDecision && method === "POST") { const [,id,decision]=credentialDecision; const a=authorizeAdmin(db,ctx,decision==="approve"?"admin.approve":"admin.reject",id,now);if(!a.ok)return sendErr(a),true;const b=await readJson(req) as Record<string,unknown>;if(decision==="reject"&&(typeof b.reason!=="string"||b.reason.trim().length<5))return err(res,{status:400,error:"reason_required"}),true;const c=db.updateCredential(id,{status:decision==="approve"?"verified":"rejected",verifiedBy:a.data.admin,verifiedAt:now.toISOString(),decisionReason:typeof b.reason==="string"?b.reason.trim().slice(0,500):null,updatedAt:now.toISOString()});if(!c)return err(res,{status:404,error:"not_found"}),true;await db.persist();return ok(res,{credential:{id:c.id,status:c.status}}),true; }
  // GET /api/admin/credentials/:id/proof — audited admin proof view. The
  // proof bytes are private uploads: only an authorized admin (with a reason)
  // can retrieve them, and they never appear in any JSON payload.
  const adminCredentialProof = /^\/api\/admin\/credentials\/([a-f0-9]{32})\/proof$/.exec(url.pathname);
  if (adminCredentialProof && method === "GET") {
    const a = authorizeAdmin(db, ctx, "admin.view_credential_proof", adminCredentialProof[1], now);
    if (!a.ok) return sendErr(a), true;
    const c = db.getCredential(adminCredentialProof[1]);
    if (!c || !c.proofRef) return err(res, { status: 404, error: "not_found" }), true;
    const bytes = await db.readPrivateUpload(c.proofRef);
    if (!bytes) return err(res, { status: 404, error: "not_found" }), true;
    res.writeHead(200, { "content-type": c.proofMime ?? "application/octet-stream", "cache-control": "private, no-store" });
    res.end(bytes);
    return true;
  }

  // GET /api/admin/appeals — appeal queue (open first, then recent). The
  // appellant's own text plus public account identity; never reviewer data.
  if (method === "GET" && url.pathname === "/api/admin/appeals") {
    const a = authorizeAdmin(db, ctx, "admin.appeal_list", null, now);
    if (!a.ok) return sendErr(a), true;
    const rows = db
      .listAppeals()
      .sort((x, y) => (x.status === "open" ? 0 : 1) - (y.status === "open" ? 0 : 1) || y.createdAt.localeCompare(x.createdAt))
      .map((ap) => {
        const acct = db.getAccount(ap.accountId);
        return { id: ap.id, accountId: ap.accountId, accountName: acct?.name ?? "Deleted account", accountEmail: acct?.email ?? "", reason: ap.reason, status: ap.status, createdAt: ap.createdAt, decidedAt: ap.decidedAt, decidedBy: ap.decidedBy, decisionReason: ap.decisionReason };
      });
    return ok(res, { appeals: rows }), true;
  }

  // POST /api/admin/appeals/:id/reinstate | uphold — decide an appeal.
  // Reinstate clears the account's under_review state; uphold keeps it.
  // Both require the audit reason header (authorizeAdmin) AND a decision
  // reason body field (5-500 chars) that is shown to the appellant.
  const appealDecision = /^\/api\/admin\/appeals\/([a-f0-9]{32})\/(reinstate|uphold)\/?$/.exec(url.pathname);
  if (appealDecision && method === "POST") {
    const [, id, decision] = appealDecision;
    const a = authorizeAdmin(db, ctx, decision === "reinstate" ? "admin.appeal_reinstate" : "admin.appeal_uphold", id, now);
    if (!a.ok) return sendErr(a), true;
    const b = await readJson(req) as Record<string, unknown>;
    const decisionReason = typeof b.reason === "string" ? b.reason.trim() : "";
    if (decisionReason.length < 5 || decisionReason.length > 500) {
      return err(res, { status: 400, error: "reason_required", message: "A decision reason (5-500 chars) is required — it's shown to the appellant." }), true;
    }
    const appeal = db.getAppeal(id);
    if (!appeal) return err(res, { status: 404, error: "not_found" }), true;
    if (appeal.status !== "open") return err(res, { status: 409, error: "already_decided" }), true;
    const updated = db.updateAppeal(id, { status: decision === "reinstate" ? "reinstated" : "upheld", decidedAt: now.toISOString(), decidedBy: a.data.admin, decisionReason })!;
    if (decision === "reinstate") {
      const target = db.getAccount(appeal.accountId);
      if (target && !target.deletedAt) db.updateAccount(target.id, { underReview: false });
    }
    await db.persist();
    return ok(res, { appeal: { id: updated.id, status: updated.status } }), true;
  }

  // GET /api/admin/trust — trust policy + under-review roster (audited).
  if (method === "GET" && url.pathname === "/api/admin/trust") {
    const a = authorizeAdmin(db, ctx, "admin.trust_threshold", null, now);
    if (!a.ok) return sendErr(a), true;
    const underReview = db
      .listAccounts()
      .filter((r) => !r.deletedAt && r.underReview === true)
      .map((r) => ({ accountId: r.id, name: r.name, email: r.email, underReviewAt: r.underReviewAt }));
    return ok(res, { threshold: trustThreshold(db), underReview }), true;
  }

  // POST /api/admin/trust/threshold — reconfigure the combined negative-rating
  // + concern threshold. Auto-marks accounts that are now at/above the new
  // threshold; never auto-clears (only an appeal decision clears).
  if (method === "POST" && url.pathname === "/api/admin/trust/threshold") {
    const a = authorizeAdmin(db, ctx, "admin.trust_threshold", null, now);
    if (!a.ok) return sendErr(a), true;
    const b = await readJson(req) as Record<string, unknown>;
    const t = Number(b.threshold);
    if (!Number.isInteger(t) || t < 1 || t > 10) return err(res, { status: 400, error: "invalid_threshold" }), true;
    const settings = db.getSettings(DEFAULT_SETTINGS);
    db.setSettings({ ...settings, trust: { underReviewThreshold: t } });
    const newlyUnderReview = reconcileTrustStatus(db, now);
    await db.persist();
    return ok(res, { threshold: t, newlyUnderReview }), true;
  }

  if (method === "GET" && url.pathname === "/api/admin/overview") {
    const result = adminOverview(db, ctx, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, result.data), true;
  }
  if (method === "GET" && url.pathname === "/api/admin/pending") {
    const result = adminPending(db, ctx);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { results: result.data }), true;
  }

  // GET /api/admin/submissions?city= — admin-only pending-submission queue
  // (owner OR key-based admin; safe summaries only, audited with a reason).
  if (method === "GET" && url.pathname === "/api/admin/submissions") {
    const cityId = url.searchParams.get("city")?.trim() || null;
    const statusParam = url.searchParams.get("status");
    const status = statusParam === "approved" || statusParam === "rejected" ? (statusParam as "approved" | "rejected") : "pending";
    // Routine read: audited with the server-generated reason — no operator prompt.
    const result = submissionQueue(db, ctx, cityId, status, now);
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
  // PATCH /api/admin/submissions/:id — super-admin edit of a pending payload.
  const submissionEdit = /^\/api\/admin\/submissions\/([a-f0-9]{32})\/?$/.exec(url.pathname);
  if (submissionEdit && method === "PATCH") {
    const result = editPendingSubmission(db, ctx, submissionEdit[1], (await readJson(req)) as Record<string, unknown>, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, submission: { id: result.data.id, status: result.data.status, title: result.data.payload.kind === "race" || result.data.payload.kind === "group" ? result.data.payload.name : result.data.payload.title } }), true;
  }
  // POST /api/admin/submissions/:id/remove — super-admin removal of a pending record.
  const submissionRemove = /^\/api\/admin\/submissions\/([a-f0-9]{32})\/remove\/?$/.exec(url.pathname);
  if (submissionRemove && method === "POST") {
    const result = removeSubmission(db, ctx, submissionRemove[1], now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, removed: result.data.id }), true;
  }

  if (url.pathname === "/api/admin/events" && method === "GET") {
    const result = listAdminEvents(db, ctx, url.searchParams.get("city") ?? undefined, now);
    if (!result.ok) return sendErr(result), true; await db.persist(); return ok(res, { events: result.data }), true;
  }
  if (url.pathname === "/api/admin/events" && method === "POST") {
    const result = createEvent(db, ctx, (await readJson(req)) as Record<string, unknown>, now);
    if (!result.ok) return sendErr(result), true; await db.persist(); return ok(res, { event: result.data }), true;
  }
  const eventEdit = /^\/api\/admin\/events\/([^/]+)$/.exec(url.pathname);
  if (eventEdit && method === "PATCH") {
    const result = editEvent(db, ctx, eventEdit[1], (await readJson(req)) as Record<string, unknown>, now);
    if (!result.ok) return sendErr(result), true; await db.persist(); return ok(res, { event: result.data }), true;
  }
  const eventTransition = /^\/api\/admin\/events\/([^/]+)\/(approve|publish|hide|unhide|archive)$/.exec(url.pathname);
  if (eventTransition && method === "POST") {
    const result = transitionEvent(db, ctx, eventTransition[1], eventTransition[2] as "approve"|"publish"|"hide"|"unhide"|"archive", now);
    if (!result.ok) return sendErr(result), true; await db.persist(); return ok(res, { event: result.data }), true;
  }
  // GET /api/admin/dashboard?city= — owner-only moderation dashboard overview
  if (method === "GET" && url.pathname === "/api/admin/dashboard") {
    const result = dashboardOverview(db, ctx, url.searchParams.get("city") ?? "", now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, result.data), true;
  }


  // ---- super-admin content management (races / runs / groups / forum posts)
  // GET /api/admin/content?city=&kind= — routine read of every content row
  // (audited with the server-generated reason; no operator prompt).
  if (method === "GET" && url.pathname === "/api/admin/content") {
    const city = url.searchParams.get("city")?.trim() || null;
    const kind = url.searchParams.get("kind") ?? null;
    const k = kind === "race" || kind === "event" || kind === "post" || kind === "group" ? kind : null;
    const result = listAdminContent(db, ctx, { cityId: city, kind: k }, now);
    if (!result.ok) return sendErr(result), true;
    return ok(res, { results: result.data }), true;
  }
  // PATCH /api/admin/content/:id — retitle content (propagates to submissions).
  const contentEdit = /^\/api\/admin\/content\/([^/]+)$/.exec(url.pathname);
  if (contentEdit && method === "PATCH") {
    const body = (await readJson(req)) as { title?: unknown };
    const result = editContentTitle(db, ctx, contentEdit[1], body.title, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, content: result.data }), true;
  }
  // POST /api/admin/content/:id/hide|restore|archive|delete — visibility
  // transitions. `delete` is the soft-delete (archive + dependent-content
  // cascade: RSVPs/discussions/ratings/memberships are stamped, never purged).
  const contentTransition = /^\/api\/admin\/content\/([^/]+)\/(hide|restore|archive|delete)\/?$/.exec(url.pathname);
  if (contentTransition && method === "POST") {
    const [, id, action] = contentTransition;
    const result = action === "hide" ? hideContent(db, ctx, id, now) : action === "restore" ? restoreContent(db, ctx, id, now) : action === "delete" ? deleteContent(db, ctx, id, now) : archiveContent(db, ctx, id, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, content: result.data }), true;
  }

  // GET /api/admin/discussions?city= — routine read of active run-day
  // discussion threads/comments (city-scoped for City Admins).
  if (method === "GET" && url.pathname === "/api/admin/discussions") {
    const city = url.searchParams.get("city")?.trim() || null;
    const result = listAdminDiscussions(db, ctx, { cityId: city }, now);
    if (!result.ok) return sendErr(result), true;
    return ok(res, { results: result.data }), true;
  }
  // PATCH /api/admin/discussion/:id — admin edit of a discussion body/title.
  const discussionEdit = /^\/api\/admin\/discussion\/([^/]+)$/.exec(url.pathname);
  if (discussionEdit && method === "PATCH") {
    const body = (await readJson(req)) as { body?: unknown; title?: unknown };
    const result = editDiscussion(db, ctx, decodeURIComponent(discussionEdit[1]), body, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, discussion: result.data }), true;
  }
  // DELETE /api/admin/discussion/:id — admin soft-delete (row preserved).
  if (discussionEdit && method === "DELETE") {
    const result = deleteDiscussion(db, ctx, decodeURIComponent(discussionEdit[1]), now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, ...result.data }), true;
  }
  // PATCH /api/admin/announcement — Global Admin sets the site announcement.
  if (method === "PATCH" && url.pathname === "/api/admin/announcement") {
    const body = (await readJson(req)) as { text?: unknown; link?: unknown };
    const result = setAnnouncement(db, ctx, body, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, ...result.data }), true;
  }
  // DELETE /api/admin/announcement — Global Admin clears the announcement.
  if (method === "DELETE" && url.pathname === "/api/admin/announcement") {
    const result = clearAnnouncement(db, ctx, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, ...result.data }), true;
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
    const result = adminSetStatus(db, ctx, id, action === "approve" ? "verified" : "rejected", now, role);
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
    // Never treat a normal user session copied into the admin cookie as an
    // admin session. This prevents cookie-name confusion on the purge path.
    if (!session || session.accountId !== "__admin__") return err(res, { status: 401, error: "unauthorized" }), true;
    if (!adminConfigured()) return err(res, { status: 503, error: "admin_unconfigured" }), true;
    const result = await purgeEligible(db, now);
    db.appendAudit({ admin: adminEmail(), action: "admin.purge", reason: ctx.reason!.trim().slice(0, 500), targetId: null, ip }, now);
    await db.persist();
    return ok(res, { purged: result.purged.length, retained: result.retained.length }), true;
  }

  // Safety reports: scoped, privacy-safe admin DTOs.
  if (method === "GET" && url.pathname === "/api/admin/safety-reports") {
    const city = url.searchParams.get("city");
    const result = listSafetyReportsAdmin(db, ctx, city, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { reports: result.data }), true;
  }
  const safetyDecision = /^\/api\/admin\/safety-reports\/([a-f0-9]{32})\/?$/.exec(url.pathname);
  if (method === "POST" && safetyDecision) {
    const body = (await readJson(req)) as { status?: unknown };
    const status = body.status;
    if (status !== "open" && status !== "under_review" && status !== "resolved" && status !== "dismissed") return err(res, {status:400,error:"invalid_status"}), true;
    const result = decideSafetyReport(db, ctx, safetyDecision[1], status as SafetyReportStatus, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { report: result.data }), true;
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
