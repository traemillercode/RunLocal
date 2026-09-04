/**
 * HTTP API layer for the Kimbio identity & safety features.
 *
 * Served by serve.ts on the same origin as the SPA (port 3000). All /api
 * responses are `Cache-Control: no-store`; state-changing endpoints require
 * SameSite=Lax HttpOnly cookies set by this server. No provider secrets ever
 * reach the client, and no sensitive verification value (phone, selfie ref,
 * IP) is ever included in a public payload or written to logs.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Db, newId, normalizePhone, EMAIL_SEND_LIMIT, EMAIL_SEND_WINDOW_MS, toPublicAccount, MIN_AGE, currentTrainingWeek } from "./store";
import { parseGpx } from "./gpx";
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
  adminPurgePreview,
  adminPurgeAllExceptOwner,
  adminAuditLog,
  adminDeleteAccount,
  adminUndoRejection,
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
  assignAccountRoles,
  assignCityAdmin,
  revokeCityAdmin,
  listCityAdmins,
  cityAdminAudit,
  sessionAccount,
} from "./admin";
import { purgeEligible, retentionStatus, deleteAccount as scrubAccount } from "./retention";
import { isOwnerEmail, ownerEmail } from "./owner";
import { AVATAR_STYLES } from "../lib/avatars";
import { coAttendanceForOccurrence, sharedHistory } from "./sharedHistory";
import { clubWeek } from "./clubWeek";
import { sendEmail } from "./email";
import { resolveOccurrence, defaultOccurrenceDate, sameEventId, occurrenceAttendeeCount } from "./occurrences";
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
  lifetimeCheckins,
} from "./checkins";
import { membershipDto, myMemberships, createMembership, canAdministerMembership, getOrCreateGroupChat, syncGroupChatMembership } from "./memberships";
import { listLedGroups, leaderQueue, groupRoster, assignGroupLeader, removeGroupLeader, transferGroupOwnership, editGroupProfile, notifyLeadersOfMembershipRequest, type GroupProfilePatch } from "./leadership";
import { publicEvents, listAdminEvents, createEvent, editEvent, transitionEvent } from "./events";
import { eventCapabilities, moderateEvent, editEventPublic } from "./eventModeration";
import { publicRaces, editRacePublic } from "./races";
import { listMyRuns, setMyRunKept, publicOccurrenceId, parseTzOffsetMinutes } from "./myRuns";
import { buildMyRunsIcs, myRunsIcsFilename } from "./ical";
import { publicSettings, updateSettings, saveCity, deleteCity, storeCmsUpload, providerEnabled, integrations, publicRefAllowed, cityStatus, cityExists, cityNotOpenError, publicCities, CMS_REF_PATTERN, refContentType, DEFAULT_SETTINGS } from "./cms";
import { validateImageBytes } from "./image-validation";
import { isPacePolicy, pacePolicyFromLabel } from "../types";
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
import { normalizeActivity, publicActivityCard, activityVisibleTo, type Provider, type ShareMode } from "./activity";
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
  editPendingSubmissionSelf,
  removeSubmission,
} from "./submissions";
import { listAdminContent, editContentTitle, hideContent, restoreContent, archiveContent, deleteContent, listAdminDiscussions, editDiscussion, deleteDiscussion, setAnnouncement, clearAnnouncement } from "./contentAdmin";
import { publicSponsors, publicSponsorPayment, listAdminSponsors, createSponsor, updateSponsor, deleteSponsor, submitSponsorInquiry, checkSponsorAvailability } from "./sponsors";
import { createSponsorCheckout, createPublicSponsorCheckout, handleStripeWebhook, activateSponsorFromEvent, stripeConfigured, sponsorTotalPriceUsd } from "./payments";
import { sendWeeklyPlanEmail } from "./weeklyPlanEmail";
import { createInvitation, revokeInvitation, listInvitations, validateInvitation, redeemInvitation, betaCapReached, BETA_FULL_MESSAGE } from "./invitations";
import { repairApprovedSubmissions } from "./submissionBackfill";
import {
  credentialType,
  evaluateTrustStatus,
  expireCredentials,
  parseProof,
  publicRecognitions,
  publicRunnerProfile,
  publicTrust,
  ratingEligibility,
  reconcileTrustStatus,
  resolveEventId,
  sharedEvents,
  trustThreshold,
  validTags,
  validTrustReason,
} from "./trust";
import {
  cityGrantTrustedMember,
  cityListTrustedMembers,
  cityRevokeTrustedMember,
  grantTrustedMember,
  listTrustedMembers,
  revokeTrustedMember,
} from "./verification";
import { publicForumPosts, createForumPost, publicForumReplies, createForumReply, forumReplyCounts, forumPostPublic, editForumPost, deleteForumPost, editForumReply, deleteForumReply, setForumPostPinned, setForumPostHidden, editForumPostAdmin } from "./forum";
import { createContentFlag } from "./contentFlags";
import { withdrawSubmission } from "./submissions";
import {
  acceptConnection,
  blockConnection,
  connectionState,
  declineConnection,
  mutualConnections,
  removeConnection,
  requestConnection,
  searchable,
} from "./connections";
import { canView, blockCaveats, hiddenFrom, withoutHidden } from "./privacy";
import sharp from "sharp";

/**
 * Basic, honest image-quality pre-filter for selfie submissions — NOT face
 * detection or identity verification. Catches the obvious junk (blank/black
 * camera-cap shots, extreme blur, too-small images) so the admin review
 * queue only sees real candidates. Every submission that passes still goes
 * to manual review; this never approves anyone on its own.
 */
async function selfieQualityCheck(bytes: Buffer): Promise<{ ok: true } | { ok: false; error: string; message: string }> {
  try {
    const img = sharp(bytes);
    const [metadata, stats] = await Promise.all([img.metadata(), img.stats()]);
    if (!metadata.width || !metadata.height || metadata.width < 200 || metadata.height < 200) {
      return { ok: false, error: "image_too_small", message: "That photo is too small — please retake it." };
    }
    const avgBrightness = stats.channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) / Math.min(3, stats.channels.length);
    if (avgBrightness < 20) return { ok: false, error: "image_too_dark", message: "That photo is too dark to review — please retake it somewhere brighter." };
    if (avgBrightness > 240) return { ok: false, error: "image_too_bright", message: "That photo is overexposed — please retake it out of direct light." };
    if (stats.entropy < 3) return { ok: false, error: "image_too_flat", message: "That photo looks blank or out of focus — please retake it." };
    return { ok: true };
  } catch {
    return { ok: false, error: "invalid_image", message: "Couldn't read that photo — please try again." };
  }
}

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
/** Private iCalendar download (auth handled by the route; never cached). */
function ical(res: ServerResponse, body: string, filename: string): void {
  res.writeHead(200, {
    "content-type": "text/calendar; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
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
  return Buffer.concat(chunks);
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

/** Compact public DTO for a runner tag. Identity is limited to ids — the
 * tagger's identity is server-derived and never exposed beyond the id. */
function tagDto(t: import("./types").TagRecord) {
  return { id: t.id, contentType: t.contentType, contentId: t.contentId, taggedUserId: t.taggedUserId, taggedByUserId: t.taggedByUserId, hiddenByTaggedUser: t.hiddenByTaggedUser, createdAt: t.createdAt };
}

/**
 * Resolve a tag's content to a public row for the Tagged tab (posts/events).
 * Posts must exist, be visible, and not moderation-hidden; events must exist
 * and be published, not hidden/archived. "run" tags reference strictly
 * private personal runs and never surface publicly -> null.
 */
function resolveTaggedContent(db: Db, t: import("./types").TagRecord): { kind: "post" | "event"; id: string; title: string } | null {
  if (t.contentType === "post") {
    const post = db.getForumPost(t.contentId);
    if (!post || post.state !== "visible") return null;
    const mod = db.getContent(`post:${post.id}`);
    if (mod?.hidden || mod?.archived) return null;
    return { kind: "post", id: post.id, title: post.title };
  }
  if (t.contentType === "event") {
    const raw = t.contentId.replace(/^event:/, "");
    const event = db.listEvents().find((e) => e.id === t.contentId || e.id === raw || e.seedRefId === raw);
    if (!event || event.status !== "published" || event.hidden || event.archivedAt) return null;
    return { kind: "event", id: event.id, title: event.title };
  }
  return null; // "run" tags stay private (personal runs)
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
/** Optional operator audit reason carried on the `x-audit-reason` header. */
function reasonHeader(req: IncomingMessage): string | undefined {
  const r = req.headers["x-audit-reason"];
  return typeof r === "string" ? r : undefined;
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

/**
 * THE CHOKEPOINT. 137 callers, one check.
 *
 * Suspension used to write a flag and change nothing: this returned a valid
 * session for a suspended account, and exactly ONE of the 137 endpoints
 * consulted `suspended` afterwards. So a suspended person kept RSVPing,
 * messaging, posting and joining groups — they were labelled, not removed.
 *
 * Rejecting here rather than at 136 call sites is the same shape as fixing the
 * error copy in the ApiError constructor: an endpoint added tomorrow is covered
 * without anyone remembering.
 *
 * ENFORCED AT THE COOKIE, not here. Rejecting inside requireSession looked like
 * the right chokepoint and was WRONG: it collapses "suspended" into "not signed
 * in", so every endpoint that already returned a specific 403 with a reason
 * started returning a bare 401 instead. Six test files caught it — the
 * endpoints were more informative than the chokepoint replacing them.
 *
 * Instead: the suspend handler deletes the session, and sign-in refuses to
 * create a new one. A suspended person therefore has no valid cookie at all,
 * which is the same outcome without discarding the specific errors the
 * endpoints already produce for the case where one somehow persists.
 */
function requireSession(db: Db, cookies: Record<string, string>): { accountId: string; sessionId: string } | null {
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;
  const session = db.getSession(sid);
  if (!session || session.accountId === "__admin__") return null;
  return { accountId: session.accountId, sessionId: sid };
}

/** True while a suspension is in force. An elapsed suspendedUntil is not. */
export function isCurrentlySuspended(account: { suspended?: boolean; suspendedUntil?: string | null }, now = new Date()): boolean {
  if (!account.suspended) return false;
  // No end date means indefinite.
  if (!account.suspendedUntil) return true;
  return new Date(account.suspendedUntil).getTime() > now.getTime();
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
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && !originAllowed(req)) return err(res, { status: 403, error: "origin_not_allowed" }), true;

  // ---- health (non-sensitive config booleans for the UI) -----------------
  if (method === "GET" && url.pathname === "/api/health") {
    const supabase = supabaseConfig();
    return ok(res, {
      ok: true,
      /*
       * The build the SERVER is running, which is the point.
       *
       * The footer stamp comes from import.meta.env at BUILD time, so a stale
       * bundle honestly reports its own build — correct, and misleading for the
       * one thing the stamp exists to do: confirm two people are looking at the
       * same code. It cost four rounds today across three separate reports.
       *
       * Read from the environment at request time rather than baked in, so this
       * value cannot itself go stale. Railway sets RAILWAY_GIT_COMMIT_SHA.
       */
      build: (process.env.VITE_BUILD_ID ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? "").slice(0, 12) || null,
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
    const owner = isOwnerEmail(rec.email);
    let account = rec;
    if (owner && (rec.status !== "verified" || rec.role !== "site_admin")) {
      const upgraded = db.updateAccount(rec.id, { status: "verified", role: "site_admin", roles: ["site_admin"], verifiedAt: rec.verifiedAt ?? now.toISOString() });
      if (upgraded) { account = upgraded; await db.persist(); }
    }
    return ok(res, { status: "signed_in", account: toPublicAccount(account, owner, db) }), true;
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
    // Optional actor: the public read stays anonymous but per-event moderation
    // capabilities are computed server-side (never derived client-side). An
    // anonymous caller receives [] per event, which clients treat as "no
    // actions available".
    const actor = sessionAccount(db, { adminSessionId: null, userSessionId: cookies[SESSION_COOKIE] ?? null, reason: undefined, ip: "" });
    return ok(res, { cityId: cityId ?? null, events: publicEvents(db, cityId).map((e) => {
      const occurrenceDate = defaultOccurrenceDate(e, now);
      const occurrenceId = `${e.id.startsWith("event:") ? e.id : `event:${e.id}`}:${occurrenceDate}`;
      const confirmedCount = occurrenceAttendeeCount(db, e.id, occurrenceId);
      return {
        ...e,
        capabilities: eventCapabilities(db, actor, e),
        confirmedCount,
        isConfirmedGroupRun: !e.minParticipants || confirmedCount >= e.minParticipants,
      };
    }) }), true;
  }
  // ---- group-lead scoped event moderation ----------------------------------
  // PATCH /api/events/:id/moderation — hide/restore/delete a recurring group
  // run. The SAME predicate as the capability lists above is re-validated
  // server-side: group leads act only on recurring runs of groups they lead
  // (403 otherwise); races and independent events stay City/Global-admin-only;
  // unknown ids 404. Audited with the distinct group_lead.event_* actions.
  const eventModeration = /^\/api\/events\/([^/]+)\/moderation$/.exec(url.pathname);
  if (eventModeration && method === "PATCH") {
    const body = (await readJson(req)) as { action?: unknown };
    const result = moderateEvent(db, { adminSessionId: cookies[ADMIN_COOKIE] ?? null, userSessionId: cookies[SESSION_COOKIE] ?? null, reason: undefined, ip }, decodeURIComponent(eventModeration[1]), typeof body.action === "string" ? body.action : "", now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { event: result.data }), true;
  }
  // ---- public event/race edit + race listing (owner batch 5) --------------
  // PUT /api/events/:id - scoped edit (lead of the event's group, or city/
  // global admin) - same predicate as the moderation endpoint.
  const eventEdit = /^\/api\/events\/([^/]+)$/.exec(url.pathname);
  if (eventEdit && method === "PUT") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const result = editEventPublic(db, { adminSessionId: cookies[ADMIN_COOKIE] ?? null, userSessionId: cookies[SESSION_COOKIE] ?? null, reason: undefined, ip }, decodeURIComponent(eventEdit[1]), body, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { event: result.data }), true;
  }
  // GET /api/races - public race listing (seed + approved community) with the
  // requesting account's capabilities (mirrors /api/events).
  if (method === "GET" && url.pathname === "/api/races") {
    const cityId = url.searchParams.get("city") ?? "";
    if (!cityId || !cityExists(db, cityId)) return err(res, { status: 400, error: "invalid_city" }), true;
    const actor = sessionAccount(db, { adminSessionId: cookies[ADMIN_COOKIE] ?? null, userSessionId: cookies[SESSION_COOKIE] ?? null, ip });
    return ok(res, { cityId, races: publicRaces(db, cityId, actor) }), true;
  }
  // PUT /api/races/:id - admin edit of a public race listing.
  const raceEdit = /^\/api\/races\/([^/]+)$/.exec(url.pathname);
  if (raceEdit && method === "PUT") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const result = editRacePublic(db, { adminSessionId: cookies[ADMIN_COOKIE] ?? null, userSessionId: cookies[SESSION_COOKIE] ?? null, reason: reasonHeader(req), ip }, decodeURIComponent(raceEdit[1]), body, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { race: result.data }), true;
  }
  // PATCH /api/my/submissions/:id - the submitter edits their own pending row.
  const mySubmissionEdit = /^\/api\/my\/submissions\/([^/]+)$/.exec(url.pathname);
  if (mySubmissionEdit && method === "PATCH") {
    const account = sessionAccount(db, { adminSessionId: cookies[ADMIN_COOKIE] ?? null, userSessionId: cookies[SESSION_COOKIE] ?? null, ip });
    if (!account) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const result = editPendingSubmissionSelf(db, account.id, decodeURIComponent(mySubmissionEdit[1]), body, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { submission: result.data }), true;
  }
  // PATCH /api/admin/forum/post/:id - admin edit of ANY user forum post.
  const adminForumPostEdit = /^\/api\/admin\/forum\/post\/([^/]+)$/.exec(url.pathname);
  if (adminForumPostEdit && method === "PATCH") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const result = editForumPostAdmin(db, { adminSessionId: cookies[ADMIN_COOKIE] ?? null, userSessionId: cookies[SESSION_COOKIE] ?? null, reason: reasonHeader(req), ip }, decodeURIComponent(adminForumPostEdit[1]), body, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, result.data), true;
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
    if (!canManageCheckins(db, group, actor)) return err(res, { status: 403, error: "forbidden" }), true;
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
      /*
       * THE CONFIRMATION IS THE PRODUCT MOMENT. Someone finishes a run, opens
       * their phone, and sees a number that went up — that is the thing they
       * screenshot, and it is worth more than the count itself.
       *
       * The GROUP count, not the global one. She just ran with this club, and
       * "your 12th run with Columbia Track Club" is a statement about belonging
       * somewhere; a global total at that moment is a statistic and lands flat.
       * The global number lives on the profile, where cumulative is the point.
       *
       * Computed AFTER the write, so it includes the run just recorded.
       */
      const lifetime = lifetimeCheckins(db, runner.id);
      return ok(res, {
        checkin: {
          id: result.record.id,
          checkedInAt: result.record.checkedInAt,
          duplicate: result.duplicate,
          groupId: result.record.groupId,
          /* The number for this club, which is what the confirmation says. */
          groupCount: lifetime.byGroup[result.record.groupId] ?? 1,
          /*
           * WHO ELSE WAS THERE. "Your 12th run with Columbia Track Club" is a
           * tally; "your 12th, and your 5th with Casey" is the same data and it
           * is about a person.
           *
           * The strongest single connection on THIS run, not a list — a roster
           * of everyone you have met is the record view again.
           *
           * Computed after the check-in is written, so this run counts. Safe by
           * the same property as everywhere else: every occurrence counted is
           * one the viewer attended, and hiddenFrom removes anyone blocked.
           */
          ...(() => {
            const others = db
              .listAttendance()
              .filter((a) => a.occurrenceId === result.record.occurrenceId && !a.deletedAt && a.accountId !== runner.id)
              .map((a) => a.accountId);
            const shared = coAttendanceForOccurrence(db, runner.id, others);
            let bestId: string | null = null;
            let best = 0;
            for (const [id, n] of shared) if (n > best) { best = n; bestId = id; }
            const account = bestId ? db.getAccount(bestId) : null;
            return best > 0 && account
              ? { alsoHere: { name: account.name, runsTogether: best } }
              : {};
          })(),
          lifetimeTotal: lifetime.total,
        },
      }), true;
    }
    return err(res, { status: 404, error: "not_found" }), true;
  }


  /*
   * GET /api/me/checkins — your own lifetime count.
   *
   * OWNER-ONLY, and that is a safety decision rather than a scoping accident.
   * A public run count is a presence signal: "32 with Columbia Track Club"
   * tells someone how reliably she attends and which club, which is the shape
   * of information the architecture doc keeps owner-only by default.
   *
   * The confirmation already gives her the number at the moment it changes.
   * This is the cumulative view — where milestones live, and the number that
   * survives changing clubs.
   */
  /*
   * POST /api/me/avatar — choose a default avatar.
   *
   * Separate from the photo upload rather than folded into it: they are
   * different acts with different friction, and an endpoint that accepted
   * either would have to branch on content type to decide which.
   */
  if (method === "POST" && url.pathname === "/api/me/avatar") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { style?: unknown };
    const style = typeof body.style === "string" ? body.style : "";
    // Validated against the known set — an arbitrary string would render as a
    // fallback everywhere and look like a bug rather than a rejected input.
    if (!AVATAR_STYLES.some((a) => a.id === style)) {
      return err(res, { status: 400, error: "invalid_avatar" }), true;
    }
    db.updateAccount(sess.accountId, { avatarStyle: style });
    await db.persist();
    return ok(res, { avatarStyle: style }), true;
  }

  /*
   * GET /api/me/club-week — what your groups did, and what you were part of.
   *
   * Reads NOBODY's attendance but the caller's own: the club's number comes
   * from the schedule, which is already on the board.
   */
  if (method === "GET" && url.pathname === "/api/me/club-week") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    return ok(res, { clubs: clubWeek(db, sess.accountId, now) }), true;
  }

  if (method === "GET" && url.pathname === "/api/me/checkins") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const counts = lifetimeCheckins(db, sess.accountId);
    // Group names resolved here so the client is not left cross-referencing
    // ids by hand — the same defect that made the safety queue unactionable.
    const groups = Object.entries(counts.byGroup)
      .map(([groupId, count]) => ({ groupId, name: db.getGroup(groupId)?.name ?? groupId, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return ok(res, { total: counts.total, groups }), true;
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
    if (status === "pending") notifyLeadersOfMembershipRequest(db, group, account.id, now);
    else syncGroupChatMembership(db, group.id, account.id, "add");
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
    const leader = canAdministerMembership(db, group, account ?? undefined, db.getAccount(targetId), membership);
    if (membershipAction[2] === "leave" && targetId === sess.accountId) { membership.status="left"; }
    else if (!leader && !isOwnerEmail(account?.email ?? "")) return err(res,{status:403,error:"forbidden"}),true;
    else membership.status = membershipAction[2] === "approve" ? "active" : membershipAction[2] === "decline" ? "declined" : "revoked";
    membership.updatedAt=now.toISOString(); membership.decidedAt=now.toISOString(); membership.decidedBy=sess.accountId;
    db.updateMembership(membership.id,membership); db.appendAudit({admin:account?.email ?? "unknown",action:(membershipAction[2] === "leave" ? "group.membership_leave" : membershipAction[2] === "approve" ? "group.membership_approve" : membershipAction[2] === "decline" ? "group.membership_decline" : "group.membership_remove") as import("./types").AdminAction,reason:"Membership lifecycle action",targetId:group.id,ip,cityId:group.cityId});
    syncGroupChatMembership(db, group.id, targetId, membership.status === "active" ? "add" : "remove");
    /*
     * TELL THEM. Being removed from a club you thought you were in and finding
     * out by absence — noticing the runs stopped appearing — is worse than
     * being told, and it invites them to assume a bug and keep trying.
     *
     * Deliberately DIFFERENT from a block, where silence is the entire point. A
     * block hides one person from another; a removal is a group acting, and a
     * group that acts should say so. The reason is NOT included: it is in the
     * audit trail for review, and a removal message is not the place to relay
     * whatever a leader typed in the moment.
     *
     * Not sent when they left of their own accord — they know.
     */
    if (membershipAction[2] === "remove" && targetId !== sess.accountId) {
      db.addNotification({
        id: newId(),
        accountId: targetId,
        category: "account_alerts",
        title: `You were removed from ${group.name}`,
        body: "You can ask to join again, or contact the group if you think this was a mistake.",
        createdAt: now.toISOString(),
        readAt: null,
        link: { kind: "group_manage", id: group.id },
      });
    }
    await db.persist();
    return ok(res,{membership:membershipDto(db,membership)}),true;
  }

  // GET /api/groups/:id/chat — opens (creating on first access) the club's
  // native group chat. Active members only — pending/declined/left/revoked
  // can't peek into a chat they're not part of.
  const groupChatPath = /^\/api\/groups\/([^/]+)\/chat$/.exec(url.pathname);
  if (groupChatPath && method === "GET") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const group = db.getGroup(groupChatPath[1]);
    if (!group) return err(res, { status: 404, error: "not_found" }), true;
    const membership = db.getMembership(group.id, sess.accountId);
    if (!membership || membership.status !== "active") return err(res, { status: 403, error: "not_a_member" }), true;
    const conversationId = getOrCreateGroupChat(db, group.id, now);
    await db.persist();
    return ok(res, { conversationId }), true;
  }

  // ==================== Group leadership & leader queue ====================
  // Ownership acts (assign/remove leaders, transfer) require the group owner,
  // the City Admin of the group's city, or the Global Admin. Profile edits
  // additionally allow plain leaders of the group. Every mutation is
  // reason-required and audited. Responses carry public identity only.

  if (method === "GET" && url.pathname === "/api/me/leader/groups") {
    const sess = requireSession(db, cookies); if (!sess) return err(res,{status:401,error:"sign_in_required"}),true;
    const actor = db.getAccount(sess.accountId); if (!actor || actor.deletedAt) return err(res,{status:401,error:"sign_in_required"}),true;
    return ok(res,{groups:listLedGroups(db,actor)}),true;
  }
  if (method === "GET" && url.pathname === "/api/me/leader/queue") {
    const sess = requireSession(db, cookies); if (!sess) return err(res,{status:401,error:"sign_in_required"}),true;
    const actor = db.getAccount(sess.accountId); if (!actor || actor.deletedAt) return err(res,{status:401,error:"sign_in_required"}),true;
    return ok(res,{pending:leaderQueue(db,actor)}),true;
  }
  /*
   * GET /api/me/leader/roster — active members of every group you lead.
   *
   * Did not exist. The manage page rendered approve and decline for PENDING
   * requests and nothing else, so a club leader could not see who was in their
   * club. Table stakes for the group product, and separately it blocked a
   * safety path: "removing him is the club's decision" was unusable because the
   * club had no surface on which to decide.
   */
  if (method === "GET" && url.pathname === "/api/me/leader/roster") {
    const sess = requireSession(db, cookies); if (!sess) return err(res,{status:401,error:"sign_in_required"}),true;
    const actor = db.getAccount(sess.accountId); if (!actor || actor.deletedAt) return err(res,{status:401,error:"sign_in_required"}),true;
    return ok(res,{members:groupRoster(db,actor)}),true;
  }
  const leaderAssign = /^\/api\/groups\/([^/]+)\/leaders$/.exec(url.pathname);
  if (leaderAssign && method === "POST") {
    const sess = requireSession(db, cookies); if (!sess) return err(res,{status:401,error:"sign_in_required"}),true;
    const actor = db.getAccount(sess.accountId); if (!actor || actor.deletedAt) return err(res,{status:401,error:"sign_in_required"}),true;
    const group = db.getGroup(decodeURIComponent(leaderAssign[1])); if (!group) return err(res,{status:404,error:"not_found"}),true;
    const body = await readJson(req) as Record<string,unknown>;
    const result = assignGroupLeader(db, actor, group, typeof body.email === "string" ? body.email : "", typeof body.reason === "string" ? body.reason : "", now);
    if (!result.ok) return err(res,{status:result.status,error:result.error,message:result.message}),true;
    await db.persist();
    return ok(res,{leaders:result.data.leaders,ownerId:result.data.ownerId}),true;
  }
  const leaderRemove = /^\/api\/groups\/([^/]+)\/leaders\/([^/]+)$/.exec(url.pathname);
  if (leaderRemove && method === "DELETE") {
    const sess = requireSession(db, cookies); if (!sess) return err(res,{status:401,error:"sign_in_required"}),true;
    const actor = db.getAccount(sess.accountId); if (!actor || actor.deletedAt) return err(res,{status:401,error:"sign_in_required"}),true;
    const group = db.getGroup(decodeURIComponent(leaderRemove[1])); if (!group) return err(res,{status:404,error:"not_found"}),true;
    const body = await readJson(req) as Record<string,unknown>;
    const result = removeGroupLeader(db, actor, group, decodeURIComponent(leaderRemove[2]), typeof body.reason === "string" ? body.reason : "", now);
    if (!result.ok) return err(res,{status:result.status,error:result.error,message:result.message}),true;
    await db.persist();
    return ok(res,{leaders:result.data.leaders,ownerId:result.data.ownerId}),true;
  }
  const ownershipPath = /^\/api\/groups\/([^/]+)\/ownership$/.exec(url.pathname);
  if (ownershipPath && method === "POST") {
    const sess = requireSession(db, cookies); if (!sess) return err(res,{status:401,error:"sign_in_required"}),true;
    const actor = db.getAccount(sess.accountId); if (!actor || actor.deletedAt) return err(res,{status:401,error:"sign_in_required"}),true;
    const group = db.getGroup(decodeURIComponent(ownershipPath[1])); if (!group) return err(res,{status:404,error:"not_found"}),true;
    const body = await readJson(req) as Record<string,unknown>;
    const result = transferGroupOwnership(db, actor, group, typeof body.accountId === "string" ? body.accountId : "", typeof body.reason === "string" ? body.reason : "", now);
    if (!result.ok) return err(res,{status:result.status,error:result.error,message:result.message}),true;
    await db.persist();
    return ok(res,{leaders:result.data.leaders,ownerId:result.data.ownerId}),true;
  }
  const profilePath = /^\/api\/groups\/([^/]+)\/profile$/.exec(url.pathname);
  if (profilePath && method === "PATCH") {
    const sess = requireSession(db, cookies); if (!sess) return err(res,{status:401,error:"sign_in_required"}),true;
    const actor = db.getAccount(sess.accountId); if (!actor || actor.deletedAt) return err(res,{status:401,error:"sign_in_required"}),true;
    const group = db.getGroup(decodeURIComponent(profilePath[1])); if (!group) return err(res,{status:404,error:"not_found"}),true;
    const body = await readJson(req) as Record<string,unknown>;
    const patch: GroupProfilePatch = {};
    if (body.description !== undefined) patch.description = String(body.description);
    if (body.websiteUrl !== undefined) patch.websiteUrl = body.websiteUrl === null ? null : String(body.websiteUrl);
    if (body.facebookUrl !== undefined) patch.facebookUrl = body.facebookUrl === null ? null : String(body.facebookUrl);
    if (body.instagramUrl !== undefined) patch.instagramUrl = body.instagramUrl === null ? null : String(body.instagramUrl);
    if (body.membershipMode !== undefined) patch.membershipMode = body.membershipMode === "request" ? "request" : body.membershipMode === "open" ? "open" : undefined;
    const result = editGroupProfile(db, actor, group, patch, typeof body.reason === "string" ? body.reason : "", now);
    if (!result.ok) return err(res,{status:result.status,error:result.error,message:result.message}),true;
    await db.persist();
    return ok(res,{leaders:result.data.leaders,ownerId:result.data.ownerId}),true;
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

  // ---- generic content-report flag (verified runner) -----------------------
  // POST /api/content/:kind/:id/flag — verified runners flag content in their
  // own home city (post / reply / event / race / group). Reason 5-500 required,
  // self-report blocked, duplicate-protected (open flag for same reporter +
  // target -> 409), rate-limited (5/hr shared bucket), creates a FlagRecord via
  // the store (reporter identity + reason are admin-only in every view) and
  // audits `content.flag`.
  const flagRoute = /^\/api\/content\/(post|reply|event|race|group)\/([^/]+)\/flag$/.exec(url.pathname);
  if (flagRoute && method === "POST") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const account = db.getAccount(sess.accountId);
    if (!account || account.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { reason?: unknown };
    const result = createContentFlag(db, account, { kind: flagRoute[1], id: decodeURIComponent(flagRoute[2]), reason: body.reason }, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { flag: result.data.flag }), true;
  }

  // ---- public forum (user-created posts; seed posts render from city data) --
  // GET is a public city-scoped read of USER-created posts only (seed posts
  // stay in the client's city seed). POST is verified-only and server-
  // authoritative: the post lands in the author's home city, and rejected /
  // pending / guest accounts are denied with explicit errors.
  if (method === "GET" && url.pathname === "/api/forum") {
    const cityId = url.searchParams.get("city") ?? "";
    if (!cityId || !cityExists(db, cityId)) {
      return err(res, { status: 400, error: "invalid_city" }), true;
    }
    // Optional actor: the public read stays anonymous but capability lists are
    // computed per-account server-side (author/admin/report rights are never
    // derived client-side).
    const actor = sessionAccount(db, { adminSessionId: null, userSessionId: cookies[SESSION_COOKIE] ?? null, reason: undefined, ip: "" });
    return ok(res, { cityId, posts: publicForumPosts(db, cityId, actor), replyCounts: forumReplyCounts(db, cityId) }), true;
  }
  if (method === "POST" && url.pathname === "/api/forum") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { section?: unknown; title?: unknown; body?: unknown; linkedEventId?: unknown };
    const result = createForumPost(db, sess.accountId, body, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { post: result.data.post }), true;
  }

  // ---- admin pin/unpin of a user-created forum post ------------------------
  // PATCH /api/forum/:id/pin with { pinned: boolean } — Global Admin or the
  // post's City Admin only (same predicates as the forum capability list).
  // Persists on the post record, mirrors the content-registry row, and is
  // audited (forum.pin / forum.unpin). Guests 401, signed-in non-admins 403,
  // unknown/seed posts 404, same-state requests 400.
  const forumPostPin = /^\/api\/forum\/([^/]+)\/pin\/?$/.exec(url.pathname);
  if (forumPostPin && method === "PATCH") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const id = decodeURIComponent(forumPostPin[1]);
    const body = (await readJson(req)) as { pinned?: unknown };
    if (typeof body.pinned !== "boolean") {
      return err(res, { status: 400, error: "invalid_pinned", message: "pinned must be true or false." }), true;
    }
    const result = setForumPostPinned(db, sess.accountId, id, body.pinned, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { post: result.data.post }), true;
  }
  // POST /api/forum/:id/vote — toggles the caller's upvote. Verified accounts
  // only (same bar as replying); the post itself doesn't need to exist as a
  // user record since seed posts can be voted on too — only the vote row is
  // checked/written, so there's nothing to look up or 404 on here.
  const forumPostVote = /^\/api\/forum\/([^/]+)\/vote\/?$/.exec(url.pathname);
  if (forumPostVote && method === "POST") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(sess.accountId);
    if (!rec || rec.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    const postId = decodeURIComponent(forumPostVote[1]);
    const nowVoted = db.toggleForumVote(sess.accountId, postId, now);
    await db.persist();
    return ok(res, { voted: nowVoted, voteCount: db.forumVoteCount(postId) }), true;
  }
  // ---- author hide/restore of their own forum post -------------------------
  // PATCH /api/forum/:id/hide with { hidden: boolean } — the verified author of
  // a user-created post may hide it from public rendering and restore it. Same
  // author gate as edit/delete: author-only (non-authors 404, never leaked),
  // same-city, post must exist and not be deleted (seed posts have no record,
  // so 404). Writes the SAME `post:<id>` moderation-registry flag the admin
  // hide path uses, so public reads, reply counts, replies rendering, and new
  // replies all stop while hidden (existing filters). Audited (forum.hide_own /
  // forum.restore_own) with the author identity. Guests 401, non-authors 404,
  // unknown/seed/deleted posts 404, same-state requests 400.
  const forumPostHide = /^\/api\/forum\/([^/]+)\/hide\/?$/.exec(url.pathname);
  if (forumPostHide && method === "PATCH") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const id = decodeURIComponent(forumPostHide[1]);
    const body = (await readJson(req)) as { hidden?: unknown };
    if (typeof body.hidden !== "boolean") {
      return err(res, { status: 400, error: "invalid_hidden", message: "hidden must be true or false." }), true;
    }
    const result = setForumPostHidden(db, sess.accountId, id, body.hidden, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { post: result.data.post }), true;
  }
  // ---- author edit/delete of a user-created forum post ---------------------
  // PATCH /api/forum/:id — author-only edit (re-validates title/body, stamps
  // updatedAt, audited); DELETE /api/forum/:id — author-only soft-delete (state
  // deleted, body/title blanked, registry row archived so replies/counts stop
  // rendering, audited). Non-authors 404 (never leaked); moderation-hidden or
  // archived posts are unavailable (post_unavailable); cross-city denied.
  const forumPostAuthor = /^\/api\/forum\/([^/]+)$/.exec(url.pathname);
  if (forumPostAuthor && (method === "PATCH" || method === "DELETE")) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const id = decodeURIComponent(forumPostAuthor[1]);
    if (method === "PATCH") {
      const body = (await readJson(req)) as { title?: unknown; body?: unknown };
      const result = editForumPost(db, sess.accountId, id, body, now);
      if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
      await db.persist();
      return ok(res, { post: result.data.post }), true;
    }
    const result = deleteForumPost(db, sess.accountId, id, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { deleted: true }), true;
  }

  // ---- public forum replies (comments on a post) ---------------------------
  // GET is a public city-scoped read of a post's replies; POST is verified-only
  // with the same authorization as posting, plus the target post must exist,
  // be visible, live in the author's home city (cross-city denied), and not be
  // moderation-hidden/archived. Hidden posts 404 on read (never leaked).
  if (method === "GET" && url.pathname === "/api/forum/replies") {
    const cityId = url.searchParams.get("city") ?? "";
    const postId = url.searchParams.get("post") ?? "";
    if (!cityId || !cityExists(db, cityId)) {
      return err(res, { status: 400, error: "invalid_city" }), true;
    }
    if (!postId || !forumPostPublic(db, cityId, postId)) {
      return err(res, { status: 404, error: "post_not_found" }), true;
    }
    const actor = sessionAccount(db, { adminSessionId: null, userSessionId: cookies[SESSION_COOKIE] ?? null, reason: undefined, ip: "" });
    return ok(res, { postId, replies: publicForumReplies(db, postId, now, actor) }), true;
  }
  if (method === "POST" && url.pathname === "/api/forum/replies") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { postId?: unknown; body?: unknown };
    const result = createForumReply(db, sess.accountId, body, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { reply: result.data.reply }), true;
  }

  // ---- author edit/delete of a forum reply ----------------------------------
  // PATCH /api/forum/replies/:id — author-only body edit (1-1000, audited);
  // DELETE /api/forum/replies/:id — author-only soft-delete (visible -> deleted,
  // body blanked, row preserved, audited).
  const forumReplyAuthor = /^\/api\/forum\/replies\/([^/]+)$/.exec(url.pathname);
  if (forumReplyAuthor && (method === "PATCH" || method === "DELETE")) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const id = decodeURIComponent(forumReplyAuthor[1]);
    if (method === "PATCH") {
      const body = (await readJson(req)) as { body?: unknown };
      const result = editForumReply(db, sess.accountId, id, body, now);
      if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
      await db.persist();
      return ok(res, { reply: result.data.reply }), true;
    }
    const result = deleteForumReply(db, sess.accountId, id, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { deleted: true }), true;
  }

  // ---- activity integrations (provider-neutral public shapes) -------------
  // OAuth sync is gone (manual logging only, by design) — this check still
  // exists because a manual entry is normalized against one of these shapes
  // (distance/pace field conventions), not because any of them sync data.
  const validProvider = (p: string | undefined): p is Provider => p === "strava" || p === "garmin" || p === "coros" || p === "suunto";
  // ---- Routes (real GPX-backed) ---------------------------------------
  // GET /api/routes?city=X — public, no auth needed to browse.
  // GET /api/routes/:id — full detail including the actual GPS/elevation
  // points, re-parsed from the stored GPX file on each request rather than
  // duplicating them into the main store (keeps store.json lean; parsing a
  // few hundred points is cheap).
  const routeDetailPath = /^\/api\/routes\/([^/]+)$/.exec(url.pathname);
  if (method === "GET" && routeDetailPath) {
    const route = db.getRoute(routeDetailPath[1]);
    if (!route) return err(res, { status: 404, error: "not_found" }), true;
    const gpxBuffer = await db.readPublicUpload(route.gpxRef);
    const parsed = gpxBuffer ? parseGpx(gpxBuffer.toString("utf-8")) : null;
    const points = parsed && !("error" in parsed) ? parsed.points : [];
    return ok(res, {
      route: {
        id: route.id, cityId: route.cityId, name: route.name, surfaceType: route.surfaceType,
        distanceMiles: route.distanceMiles, elevationGainFt: route.elevationGainFt, hasElevationData: route.hasElevationData,
        gpxUrl: `/uploads/public/${route.gpxRef}`, points,
      },
    }), true;
  }

  if (method === "GET" && url.pathname === "/api/routes") {
    const cityId = url.searchParams.get("city") ?? undefined;
    const routes = await Promise.all(db.listRoutes(cityId).map(async (r) => {
      const gpxBuffer = await db.readPublicUpload(r.gpxRef);
      const parsed = gpxBuffer ? parseGpx(gpxBuffer.toString("utf-8")) : null;
      const allPoints = parsed && !("error" in parsed) ? parsed.points : [];
      // A small, cheap sample just for a shape thumbnail on the list card —
      // not the full-resolution trace (that's the detail page's job).
      const previewPoints: [number, number][] = allPoints
        .filter((_, i) => i % Math.max(1, Math.ceil(allPoints.length / 24)) === 0)
        .map((p) => [p.lat, p.lon]);
      return { id: r.id, cityId: r.cityId, name: r.name, surfaceType: r.surfaceType, distanceMiles: r.distanceMiles, elevationGainFt: r.elevationGainFt, hasElevationData: r.hasElevationData, gpxUrl: `/uploads/public/${r.gpxRef}`, previewPoints };
    }));
    return ok(res, { routes }), true;
  }

  // POST /api/routes — verified runners only. Upload a real GPX file; every
  // number shown is computed from it server-side, never entered by hand.
  if (method === "POST" && url.pathname === "/api/routes") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(sess.accountId);
    if (!rec || rec.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!name) return err(res, { status: 400, error: "invalid_name", message: "Give the route a name." }), true;
    const surfaceType = typeof body.surfaceType === "string" && ["trail", "gravel", "road", "track"].includes(body.surfaceType) ? body.surfaceType as import("./types").RouteRecord["surfaceType"] : null;
    if (!surfaceType) return err(res, { status: 400, error: "invalid_surface" }), true;
    const gpxXml = typeof body.gpx === "string" ? body.gpx : "";
    if (!gpxXml || gpxXml.length > 5_000_000) return err(res, { status: 400, error: "invalid_gpx", message: "Attach a GPX file under 5MB." }), true;
    const parsed = parseGpx(gpxXml);
    if ("error" in parsed) return err(res, { status: 400, error: parsed.error, message: "Couldn't read any track points from that file — make sure it's a real GPX export." }), true;
    const gpxRef = `route_${newId()}.gpx`;
    await db.writePublicUpload(gpxRef, Buffer.from(gpxXml, "utf-8"));
    const route = db.createRoute({ id: newId(), cityId: rec.cityId ?? "columbia-mo", name, surfaceType, distanceMiles: parsed.distanceMiles, elevationGainFt: parsed.elevationGainFt, hasElevationData: parsed.hasElevationData, gpxRef, createdBy: sess.accountId, createdAt: now.toISOString() });
    await db.persist();
    return ok(res, { route: { id: route.id, cityId: route.cityId, name: route.name, surfaceType: route.surfaceType, distanceMiles: route.distanceMiles, elevationGainFt: route.elevationGainFt, hasElevationData: route.hasElevationData, gpxUrl: `/uploads/public/${route.gpxRef}`, previewPoints: parsed.points.filter((_, i) => i % Math.max(1, Math.ceil(parsed.points.length / 24)) === 0).map((p) => [p.lat, p.lon] as [number, number]) } }), true;
  }

  // GPX files are served the same way as every other public upload (see
  // serve.ts's static /uploads/public/ handler) - no separate endpoint needed.

  // ---- sponsors: public listing only here (no ctx/auth needed); admin
  // routes live further down after ctx is constructed, see below. -----------
  // ---- Stripe webhook: verified by signature, not a session/cookie - must
  // read the RAW body (readJson would re-serialize and break signature
  // verification). Placed early since it needs no ctx/cookies at all. ------
  if (method === "POST" && url.pathname === "/api/webhooks/stripe") {
    const raw = await readRawBody(req);
    const result = handleStripeWebhook(raw, req.headers["stripe-signature"] as string | undefined);
    if (!result.ok) return err(res, { status: result.status, error: result.error }), true;
    activateSponsorFromEvent(db, result.event);
    await db.persist();
    return ok(res, { received: true }), true;
  }

  if (method === "GET" && url.pathname === "/api/sponsors") {
    const cityId = url.searchParams.get("city") ?? "columbia-mo";
    return ok(res, { sponsors: publicSponsors(db, cityId) }), true;
  }

  // ---- public sponsor payment page: knowing the id is the authorization -
  // this is a one-time link sent directly to one business, not discoverable.
  const sponsorPay = /^\/api\/sponsors\/([^/]+)\/payment$/.exec(url.pathname);
  if (sponsorPay && method === "GET") {
    const view = publicSponsorPayment(db, decodeURIComponent(sponsorPay[1]), (t, s, e) => sponsorTotalPriceUsd(t, s, e));
    if (!view) return err(res, { status: 404, error: "not_found" }), true;
    return ok(res, { sponsor: view }), true;
  }
  const sponsorPublicCheckout = /^\/api\/sponsors\/([^/]+)\/checkout$/.exec(url.pathname);
  if (sponsorPublicCheckout && method === "POST") {
    const body = (await readJson(req)) as { successUrl?: unknown; cancelUrl?: unknown };
    const successUrl = typeof body.successUrl === "string" && body.successUrl ? body.successUrl : "https://getkimbio.com/";
    const cancelUrl = typeof body.cancelUrl === "string" && body.cancelUrl ? body.cancelUrl : "https://getkimbio.com/";
    const result = await createPublicSponsorCheckout(db, decodeURIComponent(sponsorPublicCheckout[1]), successUrl, cancelUrl);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    return ok(res, { url: result.url }), true;
  }

  // GET /api/sponsors/availability?tier=featured&start=YYYY-MM-DD&end=YYYY-MM-DD&city=columbia-mo
  // Public - lets the self-serve inquiry page validate a date range before the business fills out the whole form.
  if (method === "GET" && url.pathname === "/api/sponsors/availability") {
    const tier = url.searchParams.get("tier") === "featured" ? "featured" : "standard";
    const cityId = url.searchParams.get("city") ?? "columbia-mo";
    const start = url.searchParams.get("start") ?? "";
    const end = url.searchParams.get("end") ?? "";
    return ok(res, checkSponsorAvailability(db, cityId, tier, start, end)), true;
  }
  // POST /api/sponsors/inquire - public self-serve booking submission. Always
  // created pending (unpaid); the business gets redirected straight to the
  // payment page for the booking they just created.
  if (method === "POST" && url.pathname === "/api/sponsors/inquire") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const result = submitSponsorInquiry(db, body, now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, result.data), true;
  }
  // POST /api/sponsors/logo - public, no admin auth. Lets a business upload
  // their logo directly on the self-serve inquiry form, same storage path
  // as the admin upload. Rate-limited by the same size/type validation as
  // every other image upload in the app (see decodeImage) - not by account,
  // since there's no account here, but a bad/oversized file is still rejected.
  if (method === "POST" && url.pathname === "/api/sponsors/logo") {
    const body = (await readJson(req)) as { photo?: unknown };
    if (typeof body.photo !== "string") return err(res, { status: 400, error: "invalid_image" }), true;
    const img = decodeImage(body.photo, 64);
    if (!img.ok) return err(res, { status: 400, error: img.error }), true;
    const filename = `sponsor_${newId()}.${img.ext}`;
    await db.writePublicUpload(filename, img.bytes);
    return ok(res, { logoRef: filename }), true;
  }

  if (method === "GET" && url.pathname === "/api/activity/feed") {
    // Viewer-aware public feed: session optional. A card is included ONLY when
    // the owner would share it with THIS viewer — activityVisibleTo enforces
    // shareMode (private -> owner only) and canView(viewer, owner,
    // show_past_activity), which already applies per-owner privacy and
    // bidirectional blocks. Guests keep seeing whatever the privacy model
    // allows (show_past_activity defaults to public) — no session required.
    const cityId = url.searchParams.get("city") ?? "";
    const sess = requireSession(db, cookies);
    const viewerId = sess && !db.getAccount(sess.accountId)?.deletedAt ? sess.accountId : null;
    const cards = db
      .listActivities()
      .filter((a) => activityVisibleTo(db, viewerId, a))
      .flatMap((a) => {
        const owner = db.getAccount(a.accountId);
        return owner && owner.cityId === cityId && publicRunnerProfile(owner, now) !== null ? [publicActivityCard(a)] : [];
      })
      .sort((x, y) => y.sharedAt.localeCompare(x.sharedAt));
    return ok(res, { cards }), true;
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
    if (method === "PATCH" && url.pathname === "/api/notifications/preferences") { const b=await readJson(req) as Record<string,unknown>; /* account_alerts is deliberately absent: transactional, not a preference. */ const allowed=["run_reminders","community_updates","messages"] as const; const patch: Record<string,boolean>={}; for(const k of allowed) if(b[k]!==undefined){if(typeof b[k]!=="boolean") return err(res,{status:400,error:"invalid_preferences"}),true; patch[k]=b[k] as boolean;} const preferences=db.setNotificationPreferences(sess.accountId,patch); await db.persist(); return ok(res,{preferences}),true; }
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
  // birthdate, optional phone) — the password NEVER reaches Kimbio.
  // `noSession: true` is for the email-confirmation-required path, where
  // Supabase returns no session: the pending account is created but NO Run
  // Local session cookie is issued, so nothing claims signed-in status
  // without a valid Supabase session. The account links to the verified
  // Supabase identity on the user's first confirmed login (/api/login/check).
  /*
   * GET /api/signup-status?city=… — can this city accept a signup right now?
   *
   * Exists because of an ORPHAN. LoginPage calls supabase.signUp() FIRST, which
   * creates a Supabase auth user and sends a confirmation email, and only then
   * calls POST /api/accounts where the cap refuses. So a refused twelfth person
   * would be left with a Supabase identity, a confirmation email for an account
   * that does not exist, and a rejection message — requiring manual cleanup in
   * the Supabase console.
   *
   * The server-side ordering was already correct (the cap refuses long before
   * any db write); the orphan is one layer up, in the client's two-step signup.
   * This lets the client ask before it creates anything.
   *
   * Unauthenticated and deliberately thin: a boolean and a message. It reveals
   * that a beta is full, which is public-facing copy anyway, and nothing about
   * who is in it or how many slots remain.
   */
  /*
   * POST /api/waitlist — public. The capture that did not exist.
   *
   * Unauthenticated by necessity: the whole point is people who cannot sign up.
   *
   * IDEMPOTENT. Someone will submit twice — they will not remember, or the
   * first attempt will look like it failed. A duplicate returns success without
   * a second row and without a second email. An error here would read as
   * rejection, which is the opposite of what a waitlist is for.
   */
  if (method === "POST" && url.pathname === "/api/waitlist") {
    const b = (await readJson(req)) as Record<string, unknown>;
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return err(res, { status: 400, error: "invalid_email", message: "That doesn't look like an email address." }), true;
    }
    const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 80) : null;
    const source = ["utm_source", "utm_medium", "utm_campaign"]
      .map((k) => (typeof b[k] === "string" ? (b[k] as string).trim() : ""))
      .filter(Boolean)
      .join(" / ") || null;

    const existing = db.findWaitlistByEmail(email);
    if (existing) {
      // Fill in a name if they gave one this time and had not before, but do
      // not resend or reset their place.
      if (name && !existing.name) { db.updateWaitlistEntry(existing.id, { name }); await db.persist(); }
      return ok(res, { ok: true, alreadyOn: true }), true;
    }

    db.addWaitlistEntry({
      id: `wl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      email, name, source,
      createdAt: new Date().toISOString(),
      status: "interested",
      invitedAt: null,
    });
    await db.persist();

    /*
     * The first thing anyone receives from Kimbio, and it goes out before any
     * invite — so it is also the earliest real signal of deliverability, which
     * matters given the Gmail junk placement and the two .edu addresses that
     * never confirmed. Fire-and-forget: a mail failure must not fail the
     * signup, because the record is the thing that matters.
     */
    void sendEmail({
      to: email,
      from: "Kimbio <hello@getkimbio.com>",
      subject: "You're on the list",
      html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#14171C;max-width:520px;line-height:1.6;">
<p style="font-size:16px;">Thanks for your interest in Kimbio.</p>
<p style="font-size:16px;">We're in a private beta in Columbia right now, getting it right with a small group. You're on the list — we'll email you the moment we open up.</p>
<p style="font-size:14px;color:#5b5f66;">— Kimbio</p>
</div>`,
    });

    return ok(res, { ok: true, alreadyOn: false }), true;
  }

  if (method === "GET" && url.pathname === "/api/signup-status") {
    const cityId = (url.searchParams.get("city") ?? "").trim();
    const status = cityId ? cityStatus(db, cityId) : null;
    if (!status) return ok(res, { open: true }), true; // unknown city: let the real endpoint decide
    if (status === "coming_soon" || status === "inactive") {
      const e = cityNotOpenError(status);
      return ok(res, { open: false, reason: e.error, message: e.message }), true;
    }
    /*
     * TWO DIFFERENT QUESTIONS, and I had them collapsed into one.
     *
     *   open           — can THIS signup proceed? Used by LoginPage before it
     *                    creates a Supabase user, to avoid orphaning one. An
     *                    invited person on an invite_only city: yes.
     *   requiresInvite — can a STRANGER sign up? Used to hide login and signup
     *                    affordances. On an invite_only city: no.
     *
     * Reporting only `open` meant a city flipped to invite_only still said
     * open:true — correct for the pre-check and wrong for every CTA gated on
     * it, so the flip would have changed nothing anyone could see.
     */
    if (status === "invite_only" && !betaCapReached(db)) {
      return ok(res, { open: true, requiresInvite: true }), true;
    }
    if (status === "invite_only" && betaCapReached(db)) {
      return ok(res, { open: false, reason: "beta_full", message: BETA_FULL_MESSAGE }), true;
    }
    return ok(res, { open: true, requiresInvite: false }), true;
  }

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
      return err(res, { status: 400, error: "city_required", message: "Choose your home city — Kimbio is city-scoped and your community content defaults to it." }), true;
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

      /*
       * COHORT CAP, checked after the invitation is known valid so the two
       * failures stay distinguishable: "your code is wrong" and "your code is
       * fine, we are full" are different situations and deserve different copy.
       *
       * The OWNER bypasses it. Without this, filling the cohort would lock the
       * owner out of testing the signed-out signup flow — the class of problem
       * discovered at the worst possible moment.
       *
       * Copy, not a raw error code: a hard stop that says "beta_full" is a dead
       * end, and dead ends are what the last two days removed. The client
       * renders this message.
       */
      if (!isOwnerEmail(email) && betaCapReached(db)) {
        return err(res, {
          status: 403,
          error: "beta_full",
          message: BETA_FULL_MESSAGE,
        }), true;
      }
    }
    // Username is REQUIRED for new signups and validated/normalized here —
    // the server is authoritative, never the client. Legacy accounts without
    // a username stay valid and claim one via /api/profile/username instead.
    const username = normalizeUsername(typeof body.username === "string" ? body.username : "");
    if (!username) {
      return err(res, { status: 400, error: "invalid_username", message: `Choose a valid username. ${USERNAME_HINT}` }), true;
    }
    const existing = db.getAccountByEmail(email);
    // A pending or verified account with this email genuinely blocks a new
    // signup - that identity is already in use. A REJECTED (non-deleted)
    // account does not: previously this blocked the person permanently with
    // "email taken," and the only way forward was contacting support to have
    // the old record manually deleted. Now they resubmit onto the same
    // record instead (see resubmitRejectedAccount) - their prior rejection
    // reason is preserved for the admin reviewing the new submission, not
    // silently lost.
    if (existing && !existing.deletedAt && existing.status !== "rejected") {
      return err(res, { status: 409, error: "email_taken" }), true;
    }
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
    const utmField = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null);
    const rec = existing && existing.status === "rejected"
      ? db.resubmitRejectedAccount(existing.id, { name, username, phone, birthdate, cityId, requestedRole })!
      : db.createAccount({ name, username, email, phone, birthdate, cityId, requestedRole });
    rec.utmSource = utmField((body as Record<string, unknown>).utm_source);
    rec.utmMedium = utmField((body as Record<string, unknown>).utm_medium);
    rec.utmCampaign = utmField((body as Record<string, unknown>).utm_campaign);
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
    return ok(res, { account: toPublicAccount(rec, isOwnerEmail(rec.email), db) }), true;
  }

  // ---- request email verification (Supabase delivers it) ----------------------------
  // Supabase sends the 6-digit code to the user's inbox. This endpoint only
  // gates the request: session, funnel phase, provider configuration, and the
  // Kimbio rate limit. The actual send happens client-side via the
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
  // Supabase user (sub) to the Kimbio account and advances the funnel.
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
    const quality = await selfieQualityCheck(Buffer.from(img.bytes));
    if (!quality.ok) return err(res, { status: 400, error: quality.error, message: quality.message }), true;
    const filename = `${rec.id}_selfie.${img.ext}`;
    await db.writePrivateUpload(filename, img.bytes);
    db.updateAccount(rec.id, {
      selfieRef: filename,
      selfieCapturedAt: now.toISOString(),
      phase: "pending_review",
      lastActivityAt: now.toISOString(),
    });
    /*
     * TELL THE OWNER. Nothing did.
     *
     * addNotification fired outward to the runner on approve and reject, and
     * nothing told the person who has to act that a submission had arrived. So
     * a tester verifying at 10pm waited until someone happened to open /admin —
     * with the reviewer as the bottleneck in their first ten minutes and no way
     * to know it.
     *
     * Same shape as safety reports: intake exists, no reader. Establishing this
     * BEFORE auto-verify matters, because auto-verify would have concealed the
     * gap rather than closed it, and it reopens the moment the city does.
     */
    const ownerAccount = db.getAccountByEmail(ownerEmail());
    if (ownerAccount && ownerAccount.id !== rec.id) {
      db.addNotification({
        id: newId(),
        accountId: ownerAccount.id,
        category: "account_alerts",
        title: "Verification waiting for review",
        body: `${rec.name} submitted a selfie for verification.`,
        createdAt: now.toISOString(),
        readAt: null,
        link: { kind: "verify", id: rec.id },
      });
    }
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
    return ok(res, { account: toPublicAccount(db.getAccount(rec.id)!, isOwnerEmail(rec.email), db) }), true;
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
      return err(res, { status: 400, error: "city_required", message: "Choose your home city — Kimbio is city-scoped and your community content defaults to it." }), true;
    }
    const status = cityStatus(db, cityId);
    if (status === null) {
      return err(res, { status: 400, error: "invalid_city", message: "That city isn't supported yet — pick one from the list." }), true;
    }
    // Re-submitting the current home city is a harmless no-op — no invitation
    // is needed to keep what you already have (members of an invite-only or
    // deactivated city keep their home city).
    if (rec.cityId === cityId) {
      return ok(res, { account: toPublicAccount(rec, isOwnerEmail(rec.email), db) }), true;
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
    return ok(res, { account: toPublicAccount(db.getAccount(rec.id)!, isOwnerEmail(rec.email), db) }), true;
  }

  // ---- sign in with email verification (honest: no passwords, no fake SSO) --------
  // Guests with an existing account sign in through the SAME Supabase OTP path
  // as signup: the server validates the account exists and gates the request;
  // Supabase delivers the code; the client verifies it; the server validates
  // the resulting Supabase identity and issues the Kimbio session cookie.
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
      return err(res, { status: 404, error: "no_account", message: "No Kimbio account found for that email — you can sign up instead." }), true;
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
    // "auth.users exists but Kimbio has no account → no_account".
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
    /*
     * TELL THEM WHY. Signing someone out with a generic failure is worse than
     * telling them: they assume a bug and keep trying, and the person who was
     * protected by the suspension is not served by the suspended person
     * thinking Kimbio is broken.
     *
     * Refused BEFORE the session is created, so a suspended account cannot get
     * a fresh cookie by signing in again.
     */
    if (isCurrentlySuspended(rec, now)) {
      return err(res, {
        status: 403,
        error: "suspended",
        message: rec.suspendedUntil
          ? `Your Kimbio account is suspended until ${new Date(rec.suspendedUntil).toLocaleDateString("en-US", { month: "long", day: "numeric" })}. Email hello@getkimbio.com if you think this is a mistake.`
          : "Your Kimbio account is suspended. Email hello@getkimbio.com if you think this is a mistake.",
      }), true;
    }
    const patch: Partial<AccountRecord> = { ...linked.patch, lastActivityAt: now.toISOString() };
    if (rec.phase === "email" || rec.phase === "code") patch.phase = "selfie";
    db.updateAccount(rec.id, patch);
    db.deleteCode(rec.id);
    db.appendLoginIp(rec.id, ip, now);
    db.touchActivity(rec.id, now);
    const session = db.createSession(rec.id, ip, now);
    setCookie(res, SESSION_COOKIE, session.id, secure, 60 * 60 * 24 * 30);
    await db.persist();
    return ok(res, { status: "signed_in", account: toPublicAccount(db.getAccount(rec.id)!, isOwnerEmail(rec.email), db) }), true;
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
    db.deleteNotificationsForAccount(rec.id);
    db.deleteNotificationPreferences(rec.id);
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

  // POST /api/my/submissions/:id/withdraw — the SUBMITTER pulls a still-pending
  // submission back. Author-only (404 otherwise), pending -> withdrawn;
  // withdrawn records leave the admin pending queue but stay in the
  // submitter's own history. Audited as submission.withdraw.
  const withdrawMatch = /^\/api\/my\/submissions\/([^/]+)\/withdraw$/.exec(url.pathname);
  if (withdrawMatch && method === "POST") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const result = withdrawSubmission(db, sess.accountId, decodeURIComponent(withdrawMatch[1]), now);
    if (!result.ok) return err(res, { status: result.status, error: result.error, message: result.message }), true;
    await db.persist();
    return ok(res, { submission: { id: result.data.id, status: result.data.status } }), true;
  }

  // ---- private My Runs (RSVP attendance + solo runs; server-authoritative) -
  // Past visibility rule (exact): a past row is returned ONLY when the runner
  // checked in to that occurrence or explicitly kept it ("Keep on My Runs").
  // Kept history is indefinite; upcoming rows behave exactly as before.
  if (method === "GET" && url.pathname === "/api/my/runs") {
    const sess = requireSession(db, cookies); if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(sess.accountId); if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (rec.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    // Caller's browser offset (minutes) frames upcoming/past like the feed's
    // client-side check; absent/invalid values behave exactly as before (UTC).
    const tzOffset = parseTzOffsetMinutes(url.searchParams.get("tzOffsetMinutes"));
    return ok(res, { runs: listMyRuns(db, sess.accountId, rec.cityId ?? "", now, tzOffset) }), true;
  }
  // ---- private ICS export of upcoming My Runs (caller's rows only) ---------
  // Same auth contract as /api/my/runs; only UPCOMING rows (never past, even
  // when kept/checked in) leave as a floating-local-time iCalendar download.
  if (method === "GET" && url.pathname === "/api/my/runs/ical") {
    const sess = requireSession(db, cookies); if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(sess.accountId); if (!rec || rec.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    if (rec.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    const rows = listMyRuns(db, sess.accountId, rec.cityId ?? "", now, parseTzOffsetMinutes(url.searchParams.get("tzOffsetMinutes")));
    const runs = rows.filter((r) => r.upcoming).map((r) => ({ id: r.id, kind: r.kind, title: r.title, startsAt: r.startsAt, location: r.location }));
    return ical(res, buildMyRunsIcs(runs, now), myRunsIcsFilename(now)), true;
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
      facebookUrl?: unknown; instagramUrl?: unknown; websiteUrl?: unknown; coverPhoto?: unknown; logoPhoto?: unknown; membershipMode?: unknown;
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

  // ---- shared events (verified caller; titles + dates only; no identities)
  // The ONLY basis for a rating/concern is an event BOTH runners attended
  // (RSVP or host). Any verified runner may fetch the shared list for a
  // specific reviewee; the payload is deliberately minimal (eventId + public
  // title + date) and never reveals other attendees or attendance history.
  const sharedMatch = /^\/api\/runners\/([a-f0-9]{32})\/shared-events$/.exec(url.pathname);
  if (sharedMatch && method === "GET") {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    const caller = db.getAccount(s.accountId);
    if (!caller || caller.deletedAt || caller.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    const reviewee = db.getAccount(sharedMatch[1]);
    if (!reviewee || reviewee.deletedAt) return err(res, { status: 404, error: "not_found" }), true;
    if (reviewee.status !== "verified") return err(res, { status: 403, error: "verified_runner_required", message: "You can only share feedback with verified runners." }), true;
    return ok(res, { events: sharedEvents(db, s.accountId, reviewee.id) }), true;
  }

  // ---- public runner profile (public-safe; guests OK; no private fields) --
  // The ONLY identity fields a third party may see. Deleted/suspended
  // accounts are indistinguishable from unknown ids (404). Even the account
  // owner gets the same public-safe view here — underReview/restrictions
  // belong to /api/profile/trust, never to this route.
  const runnerMatch = /^\/api\/runners\/([a-f0-9]{32})\/?$/.exec(url.pathname);
  if (runnerMatch && method === "GET") {
    const rec = db.getAccount(runnerMatch[1]);
    if (!rec || !publicRunnerProfile(rec, now)) return err(res, { status: 404, error: "not_found" }), true;
    /*
     * BLOCKED PROFILES RETURN 404, byte-identical to the line above.
     *
     * There was no block check here at all: a blocked person could load her
     * profile — name, photo, city, trust tags — which is the single most
     * valuable page to someone who wants to know about her. The endpoint only
     * refused for an account that did not exist or was not public.
     *
     * hiddenFrom() rather than isBlocked() deliberately: it also covers deleted
     * and suspended, so all three produce the SAME 404 by construction. That is
     * what makes "she blocked me" indistinguishable from "she deleted her
     * account" without anyone matching error strings by hand.
     *
     * Resolved after the session because a guest has no blocks — and a guest
     * must see exactly what a non-blocked member sees, or the difference is
     * itself the tell.
     */
    {
      const viewer = requireSession(db, cookies);
      if (hiddenFrom(db, viewer?.accountId ?? null).has(rec.id)) return err(res, { status: 404, error: "not_found" }), true;
    }
    // Connections & privacy additions: relationship state, mutual count, and
    // whether the owner's show_connections_list setting lets this viewer see
    // the count (guests pass only when the setting is public).
    const sess = requireSession(db, cookies);
    const viewerId = sess && !db.getAccount(sess.accountId)?.deletedAt ? sess.accountId : null;
    /*
     * SHARED HISTORY, viewer-scoped and never public.
     *
     * "You've been at 11 of the same runs" and "Both in Columbia Track Club" is
     * the fact that makes a stranger a not-stranger — and it is the vetting
     * mechanism women's running communities already use, repeated shared
     * activity, made visible rather than left implicit.
     *
     * Safe by the shape of the question rather than by a filter: every
     * occurrence counted is one the VIEWER attended, so it cannot reveal a run
     * they could not otherwise see. hiddenFrom covers the rest.
     *
     * Null for a guest — there is no pair to describe.
     */
    const shared = viewerId ? sharedHistory(db, viewerId, rec.id) : null;
    const mutualVisible = canView(db, viewerId, rec.id, "show_connections_list");
    const mutual = mutualVisible && viewerId !== null ? mutualConnections(db, viewerId, rec.id) : [];
    const plan = db.getTrainingPlan(rec.id);
    const planRace = plan?.linkedRaceId ? db.getRace(plan.linkedRaceId) : undefined;
    return ok(res, {
      profile: {
        ...publicRunnerProfile(rec, now)!,
        connectionState: connectionState(db, viewerId, rec.id),
        mutualConnectionsCount: mutualVisible ? mutual.length : 0,
        /* Viewer-scoped pair facts. Null for a guest — there is no pair. */
        runsTogether: shared?.runsTogether ?? 0,
        sharedGroups: shared?.groups ?? [],
        mutualVisible,
        trainingPlan: plan ? { planType: plan.planType, customLabel: plan.customLabel, totalWeeks: plan.totalWeeks, currentWeek: currentTrainingWeek(plan, now), linkedRaceName: planRace?.name ?? null } : null,
      },
      trust: publicTrust(db, runnerMatch[1], null),
      recognitions: publicRecognitions(db, rec.cityId ?? ""),
    }), true;
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
    /*
     * SILENT. This returned 403 "blocked", which told B that A had blocked him
     * — the one thing the safety architecture says must never happen. He asks
     * to connect, and the product names the block. A stalker who learns he is
     * blocked escalates, and often escalates offline.
     *
     * Now byte-identical to the not_found two lines above, which is the
     * ordinary outcome when a target does not exist. He cannot distinguish
     * "she blocked me" from "no such person" from "she deleted her account",
     * because the responses are the same response.
     *
     * Checked BEFORE the rate limiter deliberately: a blocked requester must
     * not be able to infer anything from being rate-limited differently, and
     * he must not consume A's quota either.
     */
    if(db.isBlocked(s.accountId,target))return err(res,{status:404,error:"not_found"}),true;
    if (!db.consumeJoinRequestRate(s.accountId, now.getTime(), JOIN_REQUEST_LIMIT, JOIN_REQUEST_WINDOW_MS)) return err(res, { status: 429, error: "rate_limited", message: "Too many join requests. Try again later." }), true;
    if(db.findPendingJoinRequest(s.accountId,target,kind,context))return err(res,{status:409,error:"duplicate_request"}),true;
    const r: import("./types").JoinRequestRecord={id:newId(),requesterId:s.accountId,recipientId:target,contextType:kind,contextId:context,state:"pending",requesterAccepted:false,recipientAccepted:false,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+7*86400000).toISOString(),updatedAt:now.toISOString()};db.addJoinRequest(r);await db.persist();return ok(res,{request:{id:r.id,state:r.state,contextType:r.contextType,createdAt:r.createdAt,expiresAt:r.expiresAt,updatedAt:r.updatedAt},mutual:false}),true;
  }
  const ja=/^\/api\/join-requests\/([^/]+)\/(accept|decline|cancel)$/.exec(url.pathname);
  if(ja&&method==="POST"){const s=requireSession(db,cookies);if(!s)return err(res,{status:401,error:"sign_in_required"}),true;const r=db.getJoinRequest(ja[1]);if(!r)return err(res,{status:404,error:"not_found"}),true;if(r.state!=="pending")return err(res,{status:409,error:"invalid_state"}),true;if(new Date(r.expiresAt)<=now){db.updateJoinRequest(r.id,{state:"expired",updatedAt:now.toISOString()});await db.persist();return err(res,{status:409,error:"expired"}),true;}const action=ja[2];if((action==="accept" && r.requesterId!==s.accountId && r.recipientId!==s.accountId)||(action==="decline"&&r.recipientId!==s.accountId)||(action==="cancel"&&r.requesterId!==s.accountId))return err(res,{status:403,error:"forbidden"}),true;const requesterAccepted = r.requesterAccepted || (action === "accept" && r.requesterId === s.accountId); const recipientAccepted = r.recipientAccepted || (action === "accept" && r.recipientId === s.accountId); const state: import("./types").JoinRequestState=action==="accept"?(requesterAccepted && recipientAccepted ? "accepted" : "pending"):action==="decline"?"declined":"cancelled"; const next={...r,state,requesterAccepted,recipientAccepted,updatedAt:now.toISOString()};db.updateJoinRequest(r.id,next);await db.persist();return ok(res,{request:{id:next.id,contextType:next.contextType,state:next.state,createdAt:next.createdAt,expiresAt:next.expiresAt,updatedAt:next.updatedAt},mutual:state === "accepted"}),true;}

  // ==================== CONNECTIONS & PRIVACY ==============================
  // Runner-to-runner connections. Every mutation goes through the connections
  // service (src/server/connections.ts) — the ONE place that writes rows and
  // enforces the owner's edge cases; this layer only maps results to HTTP.
  // Unblock is served by the EXISTING POST /api/blocks DELETE endpoint (one
  // block system — no duplicate routes).

  // ---- GET /api/connections: request inbox + accepted list -----------------
  if (method === "GET" && url.pathname === "/api/connections") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const viewer = db.getAccount(sess.accountId);
    if (!viewer || viewer.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const requests = db
      .listIncomingRequests(sess.accountId)
      .map((r) => ({ record: r, from: db.getAccount(r.requesterId) }))
      .filter((x): x is { record: import("./types").ConnectionRecord; from: import("./types").AccountRecord } => !!x.from && !x.from.deletedAt && publicRunnerProfile(x.from, now) !== null)
      .sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt))
      .map(({ record, from }) => ({ requestId: record.id, from: publicRunnerProfile(from, now)!, createdAt: record.createdAt }));
    const connections = db
      .listAcceptedConnections(sess.accountId)
      .map((c) => (c.requesterId === sess.accountId ? c.addresseeId : c.requesterId))
      .map((id) => db.getAccount(id))
      .filter((rec): rec is import("./types").AccountRecord => !!rec && !rec.deletedAt && publicRunnerProfile(rec, now) !== null)
      .filter((rec) => !q || rec.name.toLowerCase().includes(q) || (rec.username ?? "").toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((rec) => ({ ...publicRunnerProfile(rec, now)!, connectionState: "connected" as const }));
    return ok(res, { requests, connections, pendingCount: requests.length }), true;
  }

  // ---- Messaging -------------------------------------------------------
  // 1:1 threads require an accepted connection (messaging is for people who've
  // opted into contact, not open DMs). Groups are created directly by their
  // creator and can include anyone the creator is connected to. Every route
  // re-checks participantIds server-side — the client's view is never trusted.
  const messageRoute = (() => {
    const m = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    return m ? m[1] : null;
  })();
  const reactionRoute = (() => {
    const m = url.pathname.match(/^\/api\/messages\/([^/]+)\/reaction$/);
    return m ? m[1] : null;
  })();

  // Shared by both the list and single-conversation endpoints so they can
  // never drift out of sync — the bug this fixes was exactly that: the
  // detail endpoint used to return the raw DB record (name: null for every
  // 1:1 thread, no otherProfile at all), while only the list endpoint built
  // the enriched shape the UI actually needs.
  const enrichConversation = (c: import("./types").ConversationRecord, viewerId: string) => {
    const otherId = !c.isGroup ? c.participantIds.find((id) => id !== viewerId) ?? null : null;
    const other = otherId ? db.getAccount(otherId) : null;
    const msgs = db.getMessages(c.id);
    const last = msgs[msgs.length - 1] ?? null;
    return {
      id: c.id,
      isGroup: c.isGroup,
      name: c.isGroup ? c.name : (other ? publicRunnerProfile(other, now)?.name ?? other.name : "Deleted account"),
      participantIds: c.participantIds,
      otherProfile: other ? publicRunnerProfile(other, now) : null,
      otherOnline: otherId ? db.isAccountOnline(otherId, now) : false,
      lastMessage: last ? { body: last.deletedAt ? null : last.body, senderId: last.senderId, createdAt: last.createdAt } : null,
      lastMessageAt: c.lastMessageAt,
      runCreatedId: c.runCreatedId,
      readBy: c.readBy,
      photoUrl: c.photoRef ? `/uploads/public/${c.photoRef}` : null,
    };
  };

  if (method === "GET" && url.pathname === "/api/conversations") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const list = db.getConversationsForAccount(sess.accountId).map((c) => enrichConversation(c, sess.accountId));
    return ok(res, { conversations: list }), true;
  }

  if (method === "POST" && url.pathname === "/api/conversations") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    if (typeof body.accountId === "string") {
      // 1:1 — target must be an accepted connection.
      const target = body.accountId;
      if (target === sess.accountId) return err(res, { status: 400, error: "invalid_target", message: "You can't message yourself." }), true;
      /*
       * BLOCK CHECKED AT THE CAPABILITY, not only at the connection row.
       *
       * This gated on `pair.status === "accepted"` alone. That happens to be
       * safe today because blockConnection marks the row "removed" — but it is
       * safe by ACCIDENT: the check is asking "are you connected", and the
       * question that matters is "may you reach her". If blocking ever moves
       * from severing the row to hiding it — which is the direction the safety
       * architecture chose, because severing is visible to him — this line
       * silently starts letting a blocked person message her.
       *
       * A hidden connection must grant nothing. That is the suspension bug one
       * layer down: a flag that changes what you see and not what you can do.
       */
      if (db.isBlocked(sess.accountId, target)) return err(res, { status: 403, error: "not_connected", message: "You can only message accepted connections." }), true;
      const pair = db.getConnectionPair(sess.accountId, target);
      if (!pair || pair.status !== "accepted") return err(res, { status: 403, error: "not_connected", message: "You can only message accepted connections." }), true;
      const convo = db.findOrCreateDirectConversation(sess.accountId, target, now);
      await db.persist();
      return ok(res, { conversation: convo }), true;
    }
    // Group — every invited participant must be an accepted connection of the creator.
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
    const participantIds = Array.isArray(body.participantIds) ? body.participantIds.filter((x): x is string => typeof x === "string") : [];
    if (!name) return err(res, { status: 400, error: "invalid_name", message: "Give the group a name." }), true;
    if (participantIds.length < 2) return err(res, { status: 400, error: "invalid_participants", message: "Add at least two other people." }), true;
    for (const pid of participantIds) {
      const pair = db.getConnectionPair(sess.accountId, pid);
      if (!pair || pair.status !== "accepted") return err(res, { status: 403, error: "not_connected", message: "You can only add accepted connections to a group." }), true;
    }
    const convo = db.createGroupConversation({ name, participantIds: [sess.accountId, ...participantIds], createdBy: sess.accountId }, now);
    await db.persist();
    return ok(res, { conversation: convo }), true;
  }

  if (method === "GET" && messageRoute) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const convo = db.getConversation(messageRoute);
    if (!convo || !convo.participantIds.includes(sess.accountId)) return err(res, { status: 404, error: "not_found" }), true;
    const messages = db.getMessages(convo.id).map((m) => ({
      id: m.id,
      senderId: m.senderId,
      body: m.deletedAt ? null : m.body,
      createdAt: m.createdAt,
      deletedAt: m.deletedAt,
      reactions: m.reactions,
      mediaUrl: !m.deletedAt && m.mediaRef ? `/uploads/public/${m.mediaRef}` : null,
      editedAt: m.editedAt ?? null,
    }));
    // Opening a thread marks it read — same convention as every mainstream
    // chat app. No separate "mark read" action needed from the client.
    const updatedConvo = db.updateConversation(convo.id, { readBy: { ...convo.readBy, [sess.accountId]: now.toISOString() } }) ?? convo;
    await db.persist();
    const typingProfiles = db.getTypingAccountIds(convo.id, sess.accountId, now).flatMap((id) => { const rec = db.getAccount(id); return rec ? [rec.name] : []; });
    return ok(res, { conversation: enrichConversation(updatedConvo, sess.accountId), messages, typingNames: typingProfiles }), true;
  }

  // GET /api/conversations/:id/typing — lightweight poll target (every 2-3s
  // while a thread is open) so the client isn't re-fetching the whole
  // message list just to check who's typing.
  if (method === "GET" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/typing")) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const convoId = url.pathname.split("/").at(-2)!;
    const convo = db.getConversation(convoId);
    if (!convo || !convo.participantIds.includes(sess.accountId)) return err(res, { status: 404, error: "not_found" }), true;
    const names = db.getTypingAccountIds(convo.id, sess.accountId, now).flatMap((id) => { const rec = db.getAccount(id); return rec ? [rec.name] : []; });
    return ok(res, { typingNames: names }), true;
  }

  // POST /api/conversations/:id/typing — client calls this on a debounce
  // while the user is actively typing (a couple times a second at most, not
  // per keystroke). Ephemeral, in-memory, never persisted — see setTyping.
  if (method === "POST" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/typing")) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const convoId = url.pathname.split("/").at(-2)!;
    const convo = db.getConversation(convoId);
    if (!convo || !convo.participantIds.includes(sess.accountId)) return err(res, { status: 404, error: "not_found" }), true;
    db.setTyping(convo.id, sess.accountId, now);
    return ok(res, { ok: true }), true;
  }

  if (method === "POST" && messageRoute) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const convo = db.getConversation(messageRoute);
    if (!convo || !convo.participantIds.includes(sess.accountId)) return err(res, { status: 404, error: "not_found" }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const text = typeof body.body === "string" ? body.body.trim().slice(0, 2000) : "";
    let mediaRef: string | null = null;
    if (typeof body.photo === "string" && body.photo) {
      const img = decodeImage(body.photo);
      if (!img.ok) return err(res, { status: 400, error: img.error }), true;
      mediaRef = `msg_${newId()}.${img.ext}`;
      await db.writePublicUpload(mediaRef, img.bytes);
    }
    if (!text && !mediaRef) return err(res, { status: 400, error: "empty_message", message: "Write something or attach a photo before sending." }), true;
    /*
     * A SEVERED CONNECTION MUST NOT LEAVE HIM IN THE CONVERSATION.
     *
     * This authorised on participantIds alone — membership, granted when the
     * conversation was created and never revisited. So blocking severed the
     * connection, removed him from her lists, and left him able to keep
     * messaging her in a thread that already existed.
     *
     * Same shape as the messaging-creation hole: a gate asking about
     * RELATIONSHIP STATE at one moment rather than about PERMISSION now.
     * Membership is a proxy, and proxies drift.
     *
     * One-to-one only: a group conversation is not a private channel to her,
     * and removing him from a club thread because one member blocked him is a
     * different decision with different consequences.
     */
    if (!convo.isGroup) {
      const otherParticipant = convo.participantIds.find((id) => id !== sess.accountId);
      // Identical to a conversation that is not there — he learns nothing.
      if (otherParticipant && db.isBlocked(sess.accountId, otherParticipant)) return err(res, { status: 404, error: "not_found" }), true;
    }
    const msg = db.addMessage({ conversationId: convo.id, senderId: sess.accountId, body: text, mediaRef }, now);
    const sender = db.getAccount(sess.accountId);
    const preview = mediaRef ? (text ? `📷 ${text}` : "📷 Sent a photo") : text;
    for (const recipientId of convo.participantIds) {
      if (recipientId === sess.accountId) continue;
      if (!db.getNotificationPreferences(recipientId).messages) continue;
      db.addNotification({
        id: newId(),
        accountId: recipientId,
        category: "messages",
        title: convo.isGroup ? `${sender?.name ?? "Someone"} in ${convo.name}` : sender?.name ?? "New message",
        body: preview.slice(0, 140),
        createdAt: now.toISOString(),
        readAt: null,
        link: { kind: "conversation", id: convo.id },
      });
    }
    await db.persist();
    return ok(res, { message: { ...msg, mediaUrl: msg.mediaRef ? `/uploads/public/${msg.mediaRef}` : null } }), true;
  }

  if (method === "PUT" && reactionRoute) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const msg = db.getMessage(reactionRoute);
    if (!msg) return err(res, { status: 404, error: "not_found" }), true;
    const convo = db.getConversation(msg.conversationId);
    if (!convo || !convo.participantIds.includes(sess.accountId)) return err(res, { status: 404, error: "not_found" }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const emoji = typeof body.emoji === "string" ? body.emoji.slice(0, 8) : null;
    const updated = db.setReaction(reactionRoute, sess.accountId, emoji || null);
    await db.persist();
    return ok(res, { message: updated }), true;
  }

  // PUT /api/messages/:id — edit your own message's text. Sender only, and
  // only within 10 minutes of sending — enforced here server-side, not just
  // hidden in the UI, so it can't be bypassed by calling the API directly.
  const messageEditPath = /^\/api\/messages\/([^/]+)$/.exec(url.pathname);
  if (method === "PUT" && messageEditPath) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const msg = db.getMessage(messageEditPath[1]);
    if (!msg || msg.deletedAt) return err(res, { status: 404, error: "not_found" }), true;
    if (msg.senderId !== sess.accountId) return err(res, { status: 403, error: "forbidden" }), true;
    const ageMs = now.getTime() - new Date(msg.createdAt).getTime();
    if (ageMs > 10 * 60 * 1000) return err(res, { status: 403, error: "edit_window_expired", message: "This message can no longer be edited — the 10-minute window has passed." }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const text = typeof body.body === "string" ? body.body.trim().slice(0, 2000) : "";
    if (!text) return err(res, { status: 400, error: "empty_message", message: "A message can't be edited to be empty — delete it instead." }), true;
    const updated = db.editMessage(msg.id, text, now)!;
    await db.persist();
    return ok(res, { message: { ...updated, mediaUrl: updated.mediaRef ? `/uploads/public/${updated.mediaRef}` : null } }), true;
  }

  // DELETE /api/messages/:id — sender only, no time limit. Soft-delete
  // (keeps the row so ordering/counts stay stable, renders as "removed").
  if (method === "DELETE" && messageEditPath) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const msg = db.getMessage(messageEditPath[1]);
    if (!msg) return err(res, { status: 404, error: "not_found" }), true;
    if (msg.senderId !== sess.accountId) return err(res, { status: 403, error: "forbidden" }), true;
    const updated = db.deleteMessage(msg.id, now)!;
    await db.persist();
    return ok(res, { message: updated }), true;
  }
  // POST /api/conversations/:id/create-run — actually creates a real,
  // published one-time event (not admin-review-gated: informal proposals are
  // meant to bypass that, using the 3-confirmed-runner threshold as the
  // safety gate instead — see minParticipants on the event). Group chats
  // only, one per conversation ever (runCreatedId guards re-creation), and
  // only a participant of that specific chat can trigger it.
  if (method === "POST" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/create-run")) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const convoId = url.pathname.split("/").at(-2)!;
    const convo = db.getConversation(convoId);
    if (!convo || !convo.participantIds.includes(sess.accountId)) return err(res, { status: 404, error: "not_found" }), true;
    if (!convo.isGroup) return err(res, { status: 400, error: "not_a_group", message: "Only group chats can start a run this way." }), true;
    if (convo.runCreatedId) return err(res, { status: 409, error: "already_created", message: "A run was already created from this chat." }), true;
    const rec = db.getAccount(sess.accountId);
    if (!rec) return err(res, { status: 404, error: "not_found" }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const scheduleDate = typeof body.scheduleDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.scheduleDate) ? body.scheduleDate : null;
    if (!scheduleDate) return err(res, { status: 400, error: "invalid_date", message: "Pick a date for the run." }), true;
    const time = typeof body.time === "string" ? body.time.trim().slice(0, 40) : "";
    if (!time) return err(res, { status: 400, error: "invalid_time", message: "Give a time for the run." }), true;
    const location = typeof body.location === "string" ? body.location.trim().slice(0, 120) : "";
    if (!location) return err(res, { status: 400, error: "invalid_location", message: "Give a meeting location." }), true;
    const distanceLabel = typeof body.distanceLabel === "string" ? body.distanceLabel.trim().slice(0, 40) : "";
    // Unrecognised values are rejected to null rather than 400: pace is optional
    // context, and a bad enum should not block a host from posting a run.
    const pacePolicy = isPacePolicy(body.pacePolicy) ? body.pacePolicy : pacePolicyFromLabel(distanceLabel);
    const dayOfWeek = (new Date(`${scheduleDate}T00:00:00`).getDay() + 6) % 7; // JS: Sun=0..Sat=6 -> our Mon=0..Sun=6
    const event: import("./types").RunEventRecord = {
      id: newId(),
      seedRefId: null,
      cityId: rec.cityId ?? "columbia-mo",
      groupId: "",
      title: convo.name || "Group run",
      dayOfWeek,
      scheduleDate,
      recurrenceType: "one_time",
      time,
      location,
      distanceLabel: distanceLabel || "Distance TBD",
      pacePolicy,
      invite: "RSVP requested",
      externalUrl: null,
      provenance: "community",
      status: "published",
      hidden: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      createdBy: sess.accountId,
      updatedBy: sess.accountId,
      archivedAt: null,
      minParticipants: 3,
    };
    db.setEvent(event);
    db.updateConversation(convo.id, { runCreatedId: event.id });
    await db.persist();
    return ok(res, { eventId: event.id, cityId: event.cityId }), true;
  }

  // POST /api/runners/:id/report — a safety report against a person, not a
  // piece of content. Verified runners only, can't report yourself, reason
  // required (5-500 chars, same bar as content flags), one OPEN report per
  // reporter/target pair at a time. Never visible to the reported person.
  const runnerReportPath = /^\/api\/runners\/([^/]+)\/report$/.exec(url.pathname);
  if (method === "POST" && runnerReportPath) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const reporter = db.getAccount(sess.accountId);
    if (!reporter || reporter.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    const targetId = runnerReportPath[1];
    if (targetId === sess.accountId) return err(res, { status: 400, error: "cannot_report_self" }), true;
    if (!db.getAccount(targetId)) return err(res, { status: 404, error: "not_found" }), true;
    if (db.hasOpenAccountReport(sess.accountId, targetId)) return err(res, { status: 409, error: "already_reported", message: "You already have an open report on this person." }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 5 || reason.length > 500) return err(res, { status: 400, error: "invalid_reason", message: "Give a bit more detail (5-500 characters)." }), true;
    const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
    const report = db.createAccountReport({ reporterId: sess.accountId, reportedAccountId: targetId, reason, conversationId }, now);
    db.appendAudit({ admin: reporter.email, action: "content.flag", reason: "Safety report filed against another runner", targetId, ip, cityId: reporter.cityId ?? "" });
    await db.persist();
    return ok(res, { reportId: report.id }), true;
  }

  // GET /api/conversations/:id/members — resolved public profiles for every
  // participant, for the group settings panel. Members only, not a public route.
  if (method === "GET" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/members")) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const convoId = url.pathname.split("/").at(-2)!;
    const convo = db.getConversation(convoId);
    if (!convo || !convo.participantIds.includes(sess.accountId)) return err(res, { status: 404, error: "not_found" }), true;
    const members = convo.participantIds.flatMap((id) => { const rec = db.getAccount(id); const p = rec ? publicRunnerProfile(rec, now) : null; return p ? [{ ...p, isCreator: id === convo.createdBy, isOnline: db.isAccountOnline(id, now) }] : []; });
    return ok(res, { members }), true;
  }

  // PATCH /api/conversations/:id — rename a group chat. Creator only; 1:1
  // threads have no editable name (it's always the other person's name).
  if (method === "PATCH" && /^\/api\/conversations\/[^/]+$/.test(url.pathname)) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const convoId = url.pathname.split("/").at(-1)!;
    const convo = db.getConversation(convoId);
    if (!convo || !convo.participantIds.includes(sess.accountId)) return err(res, { status: 404, error: "not_found" }), true;
    if (!convo.isGroup) return err(res, { status: 400, error: "not_a_group" }), true;
    if (convo.createdBy !== sess.accountId) return err(res, { status: 403, error: "creator_only", message: "Only the person who started this group can rename it." }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
    if (!name) return err(res, { status: 400, error: "invalid_name", message: "Give the group a name." }), true;
    const updated = db.updateConversation(convo.id, { name });
    await db.persist();
    return ok(res, { conversation: updated }), true;
  }

  // POST /api/conversations/:id/photo — set the group's photo. Any member can
  // set it (unlike rename, which is creator-only) — same convention as
  // WhatsApp/IG group photos, low-stakes enough not to gate.
  if (method === "POST" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/photo")) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const convoId = url.pathname.split("/").at(-2)!;
    const convo = db.getConversation(convoId);
    if (!convo || !convo.participantIds.includes(sess.accountId)) return err(res, { status: 404, error: "not_found" }), true;
    if (!convo.isGroup) return err(res, { status: 400, error: "not_a_group" }), true;
    const body = (await readJson(req)) as { photo?: unknown };
    if (typeof body.photo !== "string") return err(res, { status: 400, error: "invalid_image" }), true;
    const img = decodeImage(body.photo, 128);
    if (!img.ok) return err(res, { status: 400, error: img.error }), true;
    const filename = `convo_${convo.id}_${newId()}.${img.ext}`;
    await db.writePublicUpload(filename, img.bytes);
    const prev = convo.photoRef;
    const updated = db.updateConversation(convo.id, { photoRef: filename });
    if (prev) void db.deletePublicUpload(prev);
    await db.persist();
    return ok(res, { photoUrl: `/uploads/public/${filename}`, conversation: updated }), true;
  }

  // POST /api/conversations/:id/leave — removes the caller from a group
  // chat's participant list. 1:1 threads can't be "left" this way (there's
  // no concept of a 1:1 without both people — use connection removal instead).
  if (method === "POST" && url.pathname.startsWith("/api/conversations/") && url.pathname.endsWith("/leave")) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const convoId = url.pathname.split("/").at(-2)!;
    const convo = db.getConversation(convoId);
    if (!convo || !convo.participantIds.includes(sess.accountId)) return err(res, { status: 404, error: "not_found" }), true;
    if (!convo.isGroup) return err(res, { status: 400, error: "not_a_group" }), true;
    db.updateConversation(convo.id, { participantIds: convo.participantIds.filter((id) => id !== sess.accountId) });
    await db.persist();
    return ok(res, { left: true }), true;
  }

  // ---- GET /api/connections/activity: activity cards from the caller's
  // ACCEPTED connections only ------------------------------------------------
  // Same accepted-connection resolution as GET /api/connections; each card is
  // included only when activityVisibleTo(caller, card) passes (shareMode
  // private -> owner only; manual/auto -> canView(caller, owner,
  // show_past_activity), which applies blocks). Auth required — a guest has no
  // connections. Cards carry the owner's public-safe identity for attribution.
  if (method === "GET" && url.pathname === "/api/connections/activity") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const viewer = db.getAccount(sess.accountId);
    if (!viewer || viewer.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    const connectedIds = new Set(db.listAcceptedConnections(sess.accountId).map((c) => (c.requesterId === sess.accountId ? c.addresseeId : c.requesterId)));
    const cards = db
      .listActivities()
      .filter((a) => connectedIds.has(a.accountId) && activityVisibleTo(db, sess.accountId, a))
      .flatMap((a) => {
        const owner = db.getAccount(a.accountId);
        if (!owner || publicRunnerProfile(owner, now) === null) return [];
        return [{ ...publicActivityCard(a), owner: { accountId: owner.id, name: owner.name, username: owner.username ?? null, profilePhotoUrl: owner.profilePhotoRef ? `/uploads/public/${owner.profilePhotoRef}` : null } }];
      })
      .sort((x, y) => y.sharedAt.localeCompare(x.sharedAt));
    return ok(res, { cards }), true;
  }

  // ---- connection lifecycle mutations --------------------------------------
  // POST /api/connections/:id/request — :id is the TARGET ACCOUNT id.
  // POST /api/connections/:id/accept|decline — :id is the REQUEST id; the
  //   service enforces addressee-only (existence is never leaked: not_found).
  // POST /api/connections/:id/remove|block — :id is the OTHER ACCOUNT id.
  const connectionAction = /^\/api\/connections\/([^/]+)\/(request|accept|decline|remove|block)$/.exec(url.pathname);
  if (connectionAction && method === "POST") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const viewer = db.getAccount(sess.accountId);
    if (!viewer || viewer.deletedAt) return err(res, { status: 401, error: "sign_in_required" }), true;
    const param = decodeURIComponent(connectionAction[1]);
    const action = connectionAction[2];
    if (action === "request") {
      const target = db.getAccount(param);
      if (!target || target.deletedAt) return err(res, { status: 404, error: "not_found" }), true;
      const result = requestConnection(db, sess.accountId, param, now);
      if (!result.ok) {
        if (result.error === "cannot_connect_self") return err(res, { status: 400, error: "cannot_connect_self" }), true;
        /*
         * not_found must keep its 404. The block returns not_found so it is
         * indistinguishable from a missing target — and the route above already
         * returns 404 for a genuinely missing one. Letting it fall through to
         * the generic 400 would make the block distinguishable again by status
         * code alone, which is the whole tell being removed.
         */
        if (result.error === "not_found") return err(res, { status: 404, error: "not_found" }), true;
        return err(res, { status: 400, error: result.error ?? "error" }), true;
      }
      await db.persist();
      return ok(res, { status: result.status, resolved: result.resolved === true }), true;
    }
    if (action === "accept") {
      const result = acceptConnection(db, sess.accountId, param, now);
      if (!result.ok) {
        if (result.error === "not_pending") return err(res, { status: 409, error: "not_pending" }), true;
        return err(res, { status: 404, error: "not_found" }), true;
      }
      await db.persist();
      return ok(res, { status: "accepted" }), true;
    }
    if (action === "decline") {
      const result = declineConnection(db, sess.accountId, param, now);
      if (!result.ok) {
        if (result.error === "not_pending") return err(res, { status: 409, error: "not_pending" }), true;
        return err(res, { status: 404, error: "not_found" }), true;
      }
      await db.persist();
      return ok(res, { status: "declined" }), true;
    }
    if (action === "remove") {
      const result = removeConnection(db, sess.accountId, param, now);
      if (!result.ok) return err(res, { status: 404, error: "not_connected" }), true;
      await db.persist();
      return ok(res, { status: "removed" }), true;
    }
    // block
    if (param === sess.accountId) return err(res, { status: 400, error: "invalid_block" }), true;
    const target = db.getAccount(param);
    if (!target || target.deletedAt) return err(res, { status: 404, error: "not_found" }), true;
    blockConnection(db, sess.accountId, param, now);
    /*
     * ESCALATE IF SHE BLOCKED A LEADER OF A GROUP SHE IS IN.
     *
     * A block preserves group membership and grants nothing across it — she
     * stops appearing in his roster, feed, RSVPs and group-scoped search. That
     * works because those are identity surfaces, and identity surfaces can be
     * filtered.
     *
     * A LEADER'S POWERS ARE NOT. He can moderate content she posts, sees the
     * check-in roster by role, and administers her membership. No filter fixes
     * that without breaking the group for everyone else, and silently stripping
     * a leader because one member blocked him would be its own kind of wrong.
     *
     * So it goes to a human. Notification only, no email: it is not an
     * emergency, and it must not read to her as though something happened —
     * she blocked someone, which is a thing she is entitled to do quietly.
     */
    /*
     * ONE PANEL, not a queue of alerts. Two things must be said at block time
     * and there will be a third; separate notices turn a moment that should
     * inform her into noise she stops reading.
     *
     * Returned in the RESPONSE rather than delivered as a notification, because
     * she is standing there having just blocked someone — that is the moment
     * the information is useful, and a notification arriving later reads as
     * "something happened" rather than "here is what you just did".
     */
    const caveats = blockCaveats(db, sess.accountId, param);
    /*
     * The leader case ALSO escalates to a human, because filtering cannot
     * remove his powers over her content and that needs a judgement she should
     * not have to make alone.
     */
    const ledGroups = caveats.filter((c) => c.kind === "leads_group");
    if (ledGroups.length > 0) {
      const owner = db.getAccountByEmail(ownerEmail());
      if (owner && owner.id !== sess.accountId) {
        db.addNotification({
          id: newId(),
          accountId: owner.id,
          category: "account_alerts",
          title: "A member blocked a group leader",
          body: `Someone blocked a leader of ${ledGroups.map((g) => g.groupName).join(", ")} — a group they are in. Filtering cannot remove a leader's powers over their content.`,
          createdAt: now.toISOString(),
          readAt: null,
          link: { kind: "verify", id: param },
        });
      }
    }
    await db.persist();
    return ok(res, { status: "blocked", caveats }), true;
  }

  // ---- coach-athlete relationships (consent-based, scoped per person - not a global role) ----
  // POST /api/coach/:id/request — :id is the TARGET ACCOUNT id. Body { asCoach: boolean }:
  //   true = caller wants to coach the target; false = caller wants the target to coach them.
  // POST /api/coach/:id/accept|decline — :id is the RELATIONSHIP id; only the non-requesting party may respond.
  // GET /api/coach/relationships — every relationship (pending/active/declined) involving the caller.
  const coachAction = /^\/api\/coach\/([^/]+)\/(request|accept|decline)$/.exec(url.pathname);
  if (coachAction && method === "POST") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const param = decodeURIComponent(coachAction[1]);
    const action = coachAction[2];
    if (action === "request") {
      const target = db.getAccount(param);
      if (!target || target.deletedAt) return err(res, { status: 404, error: "not_found" }), true;
      const body = (await readJson(req)) as { asCoach?: unknown };
      const asCoach = body.asCoach === true;
      const rec = db.requestCoachRelationship(asCoach ? sess.accountId : param, asCoach ? param : sess.accountId, asCoach ? "coach" : "athlete", now);
      if (!rec) return err(res, { status: 400, error: "cannot_coach_self" }), true;
      await db.persist();
      return ok(res, { relationship: rec }), true;
    }
    // accept/decline: only the party who did NOT send the request may respond.
    const rec = db.getCoachRelationship(param);
    if (!rec || rec.status !== "pending") return err(res, { status: 404, error: "not_found" }), true;
    const isRequester = (rec.requestedBy === "coach" && rec.coachId === sess.accountId) || (rec.requestedBy === "athlete" && rec.athleteId === sess.accountId);
    if (isRequester) return err(res, { status: 403, error: "cannot_respond_to_own_request" }), true;
    const isParticipant = rec.coachId === sess.accountId || rec.athleteId === sess.accountId;
    if (!isParticipant) return err(res, { status: 404, error: "not_found" }), true;
    const updated = db.respondToCoachRelationship(param, action === "accept", now);
    await db.persist();
    return ok(res, { relationship: updated }), true;
  }
  if (method === "GET" && url.pathname === "/api/coach/relationships") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rows = db.listCoachRelationshipsFor(sess.accountId).map((r) => {
      const other = db.getAccount(r.coachId === sess.accountId ? r.athleteId : r.coachId);
      return {
        id: r.id,
        role: r.coachId === sess.accountId ? ("coach" as const) : ("athlete" as const),
        status: r.status,
        requestedByMe: (r.requestedBy === "coach" && r.coachId === sess.accountId) || (r.requestedBy === "athlete" && r.athleteId === sess.accountId),
        otherAccountId: other?.id ?? null,
        otherName: other?.name ?? "Someone",
        createdAt: r.createdAt,
      };
    });
    return ok(res, { relationships: rows }), true;
  }
  // POST /api/coach/relationships/:id/end - either the coach or the athlete can end an
  // ACTIVE relationship at any time (unlike accept/decline, which only apply to a pending one,
  // and can only be actioned by the non-requesting party).
  const endRelMatch = /^\/api\/coach\/relationships\/([^/]+)\/end$/.exec(url.pathname);
  if (endRelMatch && method === "POST") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rel = db.getCoachRelationship(endRelMatch[1]);
    if (!rel || (rel.coachId !== sess.accountId && rel.athleteId !== sess.accountId)) return err(res, { status: 404, error: "not_found" }), true;
    db.endCoachRelationship(rel.id);
    await db.persist();
    return ok(res, { ok: true }), true;
  }

  // ---- GET /api/people/search: verified-account name search -----------------
  // Search-index filter only: `searchable_by_name = false` hides the user from
  // search for EVERYONE (connections included), while profile-by-id and
  // connection views stay unaffected (see connections.searchable). Blocks beat
  // everything (bidirectional). Empty q → empty list. The viewer never
  // appears in their own results (self-connection is impossible).
  if (method === "GET" && url.pathname === "/api/people/search") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (!q) return ok(res, { people: [] }), true;
    const people = db
      .listAccounts()
      .filter((rec) => !rec.deletedAt && rec.status === "verified" && rec.id !== sess.accountId && publicRunnerProfile(rec, now) !== null)
      .filter((rec) => rec.name.toLowerCase().includes(q) || (rec.username ?? "").toLowerCase().includes(q))
      .filter((rec) => searchable(db, sess.accountId, rec.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((rec) => ({ ...publicRunnerProfile(rec, now)!, connectionState: connectionState(db, sess.accountId, rec.id) }));
    return ok(res, { people }), true;
  }

  // ---- GET /api/events/:id/occurrences/:occ/connections-going --------------
  // The viewer's accepted connections who RSVP'd/attended this exact
  // occurrence. Each attendee is included ONLY when
  // canView(viewer, attendee, show_upcoming_events, {eventId, occurrenceId})
  // passes — the event-level visibilityOverride resolves inside canView.
  // Guests 401; pending/rejected 403; unknown/unpublished occurrence 404.
  const goingPath = /^\/api\/events\/([^/]+)\/occurrences\/([^/]+)\/connections-going$/.exec(url.pathname);
  if (goingPath && method === "GET") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const viewer = db.getAccount(sess.accountId);
    if (!viewer || viewer.deletedAt || viewer.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    const eventParam = decodeURIComponent(goingPath[1]);
    const occurrenceId = decodeURIComponent(goingPath[2]);
    const rawEventParam = eventParam.replace(/^event:/, "");
    const event = db.listEvents().find((e) => e.id === eventParam || e.id === rawEventParam || e.seedRefId === rawEventParam);
    const separator = occurrenceId.lastIndexOf(":");
    const occurrenceEventId = separator > 0 ? occurrenceId.slice(0, separator) : "";
    const runDate = separator > 0 ? occurrenceId.slice(separator + 1) : "";
    const occ =
      event && (event.id === occurrenceEventId || event.id === occurrenceEventId.replace(/^event:/, "") || event.seedRefId === occurrenceEventId.replace(/^event:/, ""))
        ? resolveOccurrence(db, event.id, runDate)
        : null;
    const requestedCanonical = occ && (occ.occurrenceId === occurrenceId || (occ.event?.seedRefId && occurrenceId === `event:${occ.event.seedRefId}:${runDate}`)) ? occ.occurrenceId : "";
    if (!event || !occ || !requestedCanonical || event.status !== "published" || event.hidden || event.archivedAt) return err(res, { status: 404, error: "not_found" }), true;
    const connectedIds = new Set(db.listAcceptedConnections(sess.accountId).map((c) => (c.requesterId === sess.accountId ? c.addresseeId : c.requesterId)));
    const going = db
      .listAttendance()
      .filter((a) => (a.role === "rsvp" || a.role === "host") && a.occurrenceId === requestedCanonical)
      .map((a) => db.getAccount(a.accountId))
      .filter((rec): rec is import("./types").AccountRecord => !!rec && !rec.deletedAt && connectedIds.has(rec.id))
      .filter((rec) => canView(db, sess.accountId, rec.id, "show_upcoming_events", { eventId: occ.eventId, occurrenceId: requestedCanonical }))
      .sort((x, y) => x.name.localeCompare(y.name))
      .map((rec) => ({ accountId: rec.id, name: rec.name, username: rec.username ?? null, profilePhotoUrl: rec.profilePhotoRef ? `/uploads/public/${rec.profilePhotoRef}` : null }));
    return ok(res, going), true;
  }

  // ---- GET/PUT /api/profile/privacy (own settings; partial merge) ----------
  // Validation lives in store.setPrivacy (validatePrivacyPatch): unknown
  // fields rejected, show_saved_events can never be public, every value
  // type-checked. Response is always the FULL settings record.
  if (method === "GET" && url.pathname === "/api/profile/privacy") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    return ok(res, { settings: db.getPrivacy(sess.accountId) }), true;
  }
  if (method === "PUT" && url.pathname === "/api/profile/privacy") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const allowed = ["profile_visibility", "show_upcoming_events", "show_saved_events", "show_past_activity", "show_connections_list", "show_tagged_content", "searchable_by_name"];
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!allowed.includes(k)) return err(res, { status: 400, error: "invalid_privacy", message: `Unknown privacy setting: ${k}` }), true;
      patch[k] = v;
    }
    let settings;
    try {
      settings = db.setPrivacy(sess.accountId, patch);
    } catch {
      return err(res, { status: 400, error: "invalid_privacy" }), true;
    }
    await db.persist();
    return ok(res, { settings }), true;
  }

  // ---- PUT /api/profile/details (own pace/goal/training-block/races) -------
  // Free-text, self-reported, shown on the public profile via publicRunnerProfile.
  // Same self-only pattern as /api/profile/privacy: session required, unknown
  // fields rejected, each value length-capped, full record returned.
  if (method === "PUT" && url.pathname === "/api/profile/details") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const allowed = ["name", "bio", "customTitle", "paceLabel", "runningGoal", "trainingBlock", "upcomingRaces", "instagramUrl", "facebookUrl", "tiktokUrl", "showSocialLinks", "coachBio", "isAvailableAsCoach"];
    const patch: Record<string, string | null | boolean> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!allowed.includes(k)) return err(res, { status: 400, error: "invalid_field", message: `Unknown profile field: ${k}` }), true;
      if (k === "name") {
        if (typeof v !== "string" || !v.trim()) return err(res, { status: 400, error: "invalid_field", message: "Name cannot be blank." }), true;
        patch.name = v.trim().slice(0, 60);
        continue;
      }
      if (k === "showSocialLinks" || k === "isAvailableAsCoach") {
        if (typeof v !== "boolean") return err(res, { status: 400, error: "invalid_field", message: `${k} must be a boolean` }), true;
        patch[k] = v;
        continue;
      }
      if (v !== null && typeof v !== "string") return err(res, { status: 400, error: "invalid_field", message: `${k} must be a string or null` }), true;
      if ((k === "instagramUrl" || k === "facebookUrl" || k === "tiktokUrl") && v) {
        if (!/^https?:\/\/.+/.test(v)) return err(res, { status: 400, error: "invalid_url", message: `${k} must be a full link starting with https://` }), true;
      }
      patch[k] = v === null ? null : v.trim().slice(0, k === "bio" ? 280 : 200) || null;
    }
    const updated = db.updateAccount(sess.accountId, patch);
    if (!updated) return err(res, { status: 404, error: "not_found" }), true;
    await db.persist();
    return ok(res, { profile: publicRunnerProfile(updated) }), true;
  }

  // ---- Training plan (GET/PUT/DELETE /api/profile/training-plan) -----------
  // Structured version of the free-text trainingBlock field: a plan type,
  // length, and start date. "currentWeek" is computed fresh on every GET
  // (see currentTrainingWeek in store.ts) — never stored, so it can't drift
  // stale. Optional link to a specific race in Races for context.
  const TRAINING_PLAN_TYPES = ["5k", "10k", "half_marathon", "marathon", "ultra", "other"] as const;
  /** Validates a date falls within [startDate, startDate + totalWeeks*7 - 1 days] and returns its 1-indexed week number - unlike currentTrainingWeek, this does NOT clamp, since an out-of-range date must be rejected, not silently treated as week 1 or the last week. */
  function planWeekForDate(plan: { startDate: string; totalWeeks: number }, dateStr: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const start = new Date(`${plan.startDate}T00:00:00Z`);
    const date = new Date(`${dateStr}T00:00:00Z`);
    const daysSince = Math.round((date.getTime() - start.getTime()) / 86_400_000);
    if (daysSince < 0) return null;
    const week = Math.floor(daysSince / 7) + 1;
    return week <= plan.totalWeeks ? week : null;
  }
  /** Converts any supported distance unit to miles - shoe mileage is always tracked in miles internally (see ShoeRecord.totalMiles) so totals stay comparable regardless of what unit a given workout was logged in. */
  function toMiles(value: number, unit: import("./types").TrainingDistanceUnit): number {
    switch (unit) {
      case "miles": return value;
      case "km": return value * 0.621371;
      case "meters": return value * 0.000621371;
      case "yards": return value * 0.000568182;
    }
  }
  /**
   * Reverses the old day's contribution to its shoe's mileage (if it was
   * "done" with a shoe and distance) and applies the new day's contribution
   * - handles every real transition: newly marked done, un-done, distance
   * edited after being done, or the shoe itself changed on a completed day.
   */
  function applyShoeMileageDelta(previous: import("./types").TrainingPlanDayRecord | undefined, updated: import("./types").TrainingPlanDayRecord): void {
    if (previous?.completionStatus === "done" && previous.shoeId && previous.distanceValue) {
      db.adjustShoeMileage(previous.shoeId, -toMiles(previous.distanceValue, previous.distanceUnit));
    }
    if (updated.completionStatus === "done" && updated.shoeId && updated.distanceValue) {
      db.adjustShoeMileage(updated.shoeId, toMiles(updated.distanceValue, updated.distanceUnit));
    }
  }
  /** Validates a proposed interval structure - every numeric field bounded and sane, units restricted to what makes sense for the chosen measure (duration never carries a distance unit and vice versa). Returns null for anything malformed rather than partially accepting it. */
  function validateIntervalStructure(raw: unknown): import("./types").IntervalStructure | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const DISTANCE_UNITS_LOCAL = ["miles", "km", "meters", "yards"] as const;
    const DURATION_UNITS = ["seconds", "minutes"] as const;
    const PACE_ZONES = ["easy", "marathon", "threshold", "interval"] as const;
    const RECOVERY_TYPES = ["jog", "walk", "stand"] as const;
    const distanceVal = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
    const distanceUnit = (v: unknown) => (typeof v === "string" && (DISTANCE_UNITS_LOCAL as readonly string[]).includes(v) ? (v as typeof DISTANCE_UNITS_LOCAL[number]) : null);

    // Warm-up/cool-down: distance-only, both fields present or both absent (a value with no unit is meaningless).
    const warmupValue = distanceVal(r.warmupValue);
    const warmupUnit = warmupValue !== null ? distanceUnit(r.warmupUnit) : null;
    if (warmupValue !== null && warmupUnit === null) return null;
    const cooldownValue = distanceVal(r.cooldownValue);
    const cooldownUnit = cooldownValue !== null ? distanceUnit(r.cooldownUnit) : null;
    if (cooldownValue !== null && cooldownUnit === null) return null;

    const repeatCount = typeof r.repeatCount === "number" && Number.isInteger(r.repeatCount) && r.repeatCount >= 1 && r.repeatCount <= 100 ? r.repeatCount : null;
    const workMeasure = r.workMeasure === "distance" || r.workMeasure === "duration" ? r.workMeasure : null;
    const workValue = typeof r.workValue === "number" && Number.isFinite(r.workValue) && r.workValue > 0 ? r.workValue : null;
    if (repeatCount === null || workMeasure === null || workValue === null) return null;
    const workUnit = workMeasure === "distance" ? distanceUnit(r.workUnit) : null;
    if (workMeasure === "distance" && workUnit === null) return null;
    const workDurationUnit = workMeasure === "duration" && typeof r.workDurationUnit === "string" && (DURATION_UNITS as readonly string[]).includes(r.workDurationUnit) ? (r.workDurationUnit as typeof DURATION_UNITS[number]) : (workMeasure === "duration" ? "seconds" : null);
    const workPaceTarget = typeof r.workPaceTarget === "string" && (PACE_ZONES as readonly string[]).includes(r.workPaceTarget) ? (r.workPaceTarget as typeof PACE_ZONES[number]) : null;

    const hasRest = r.hasRest === true;
    if (!hasRest) return { warmupValue, warmupUnit, repeatCount, workMeasure, workValue, workUnit, workDurationUnit, workPaceTarget, hasRest: false, restType: null, restMeasure: null, restValue: null, restUnit: null, restDurationUnit: null, cooldownValue, cooldownUnit };

    const restType = typeof r.restType === "string" && (RECOVERY_TYPES as readonly string[]).includes(r.restType) ? (r.restType as typeof RECOVERY_TYPES[number]) : "jog";
    const restMeasure = r.restMeasure === "distance" || r.restMeasure === "duration" ? r.restMeasure : null;
    const restValue = typeof r.restValue === "number" && Number.isFinite(r.restValue) && r.restValue > 0 ? r.restValue : null;
    if (restMeasure === null || restValue === null) return null;
    const restUnit = restMeasure === "distance" ? distanceUnit(r.restUnit) : null;
    if (restMeasure === "distance" && restUnit === null) return null;
    const restDurationUnit = restMeasure === "duration" && typeof r.restDurationUnit === "string" && (DURATION_UNITS as readonly string[]).includes(r.restDurationUnit) ? (r.restDurationUnit as typeof DURATION_UNITS[number]) : (restMeasure === "duration" ? "seconds" : null);

    return { warmupValue, warmupUnit, repeatCount, workMeasure, workValue, workUnit, workDurationUnit, workPaceTarget, hasRest: true, restType, restMeasure, restValue, restUnit, restDurationUnit, cooldownValue, cooldownUnit };
  }
  function buildTrainingDay(accountId: string, dateStr: string, slot: import("./types").TrainingDaySlot, weekNumber: number, body: Record<string, unknown>, existing: import("./types").TrainingPlanDayRecord | undefined, now: Date, allowFreezeToggle: boolean): import("./types").TrainingPlanDayRecord {
    const WORKOUT_TYPES = ["run", "cross_training", "rest", "recovery", "race", "swim"] as const;
    const RUN_LABELS = ["easy", "tempo", "long_run", "workout", "recovery_run", "race_pace", "intervals"] as const;
    const DISTANCE_UNITS = ["miles", "km", "meters", "yards"] as const;
    const COMPLETION_STATUSES = ["pending", "done", "missed", "modified"] as const;
    const MISSED_REASONS = ["sick", "injured", "too_busy", "weather", "low_motivation", "other"] as const;
    const workoutType = typeof body.workoutType === "string" && (WORKOUT_TYPES as readonly string[]).includes(body.workoutType) ? (body.workoutType as typeof WORKOUT_TYPES[number]) : (existing?.workoutType ?? "run");
    const runLabel = (workoutType === "run" || workoutType === "race") && typeof body.runLabel === "string" && (RUN_LABELS as readonly string[]).includes(body.runLabel)
      ? (body.runLabel as typeof RUN_LABELS[number])
      : (workoutType === "run" || workoutType === "race") ? (existing?.runLabel ?? null) : null;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : null);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
    const completionStatus = typeof body.completionStatus === "string" && (COMPLETION_STATUSES as readonly string[]).includes(body.completionStatus) ? (body.completionStatus as typeof COMPLETION_STATUSES[number]) : (existing?.completionStatus ?? "pending");
    // A missed reason only makes sense when the status is actually "missed" - setting status back to
    // pending/done/modified clears any prior reason rather than leaving a stale one attached.
    const missedReason = completionStatus === "missed" && typeof body.missedReason === "string" && (MISSED_REASONS as readonly string[]).includes(body.missedReason)
      ? (body.missedReason as typeof MISSED_REASONS[number])
      : completionStatus === "missed" ? (existing?.missedReason ?? null) : null;
    // A shoe must actually be in THIS account's own library - never someone else's shoe id.
    const shoeId = body.shoeId !== undefined
      ? (typeof body.shoeId === "string" && db.getShoe(body.shoeId)?.accountId === accountId ? body.shoeId : null)
      : existing?.shoeId ?? null;
    // A drink mix reference must be a real item in this account's own nutrition library.
    const validDrinkMix = (v: unknown) => (typeof v === "string" && db.getNutritionItem(v)?.accountId === accountId ? v : null);
    const plannedDrinkMixId = body.plannedDrinkMixId !== undefined ? validDrinkMix(body.plannedDrinkMixId) : existing?.plannedDrinkMixId ?? null;
    const actualDrinkMixId = body.actualDrinkMixId !== undefined ? validDrinkMix(body.actualDrinkMixId) : existing?.actualDrinkMixId ?? null;
    // A linked group run must be a real occurrence this account is actually RSVP'd/attending -
    // "link this day to my group run" only makes sense if you're really going.
    const linkedEventOccurrenceId = body.linkedEventOccurrenceId !== undefined
      ? (typeof body.linkedEventOccurrenceId === "string" && db.listAttendance(accountId).some((a) => a.occurrenceId === body.linkedEventOccurrenceId) ? body.linkedEventOccurrenceId : null)
      : existing?.linkedEventOccurrenceId ?? null;
    return {
      id: `${accountId}-day-${dateStr}-${slot}`,
      accountId,
      date: dateStr,
      slot,
      scheduledTime: body.scheduledTime !== undefined
        ? (typeof body.scheduledTime === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(body.scheduledTime) ? body.scheduledTime : null)
        : existing?.scheduledTime ?? null,
      weekNumber,
      workoutType,
      runLabel,
      title: str(body.title, 60) ?? existing?.title ?? "",
      distanceValue: body.distanceValue !== undefined ? num(body.distanceValue) : existing?.distanceValue ?? null,
      distanceUnit: typeof body.distanceUnit === "string" && (DISTANCE_UNITS as readonly string[]).includes(body.distanceUnit) ? (body.distanceUnit as typeof DISTANCE_UNITS[number]) : (existing?.distanceUnit ?? "miles"),
      // Explicit null clears a previously-set interval structure (switching back to a simple distance day).
      intervalStructure: body.intervalStructure !== undefined ? (body.intervalStructure === null ? null : validateIntervalStructure(body.intervalStructure)) : existing?.intervalStructure ?? null,
      shoeId,
      plannedGelCount: body.plannedGelCount !== undefined ? num(body.plannedGelCount) : existing?.plannedGelCount ?? null,
      plannedDrinkMixId,
      nutritionPlanNotes: body.nutritionPlanNotes !== undefined ? str(body.nutritionPlanNotes, 300) : existing?.nutritionPlanNotes ?? null,
      actualGelCount: body.actualGelCount !== undefined ? num(body.actualGelCount) : existing?.actualGelCount ?? null,
      actualDrinkMixId,
      fuelNotes: body.fuelNotes !== undefined ? str(body.fuelNotes, 200) : existing?.fuelNotes ?? null,
      hydrationNotes: body.hydrationNotes !== undefined ? str(body.hydrationNotes, 200) : existing?.hydrationNotes ?? null,
      linkedRouteId: body.linkedRouteId !== undefined ? (typeof body.linkedRouteId === "string" && db.getRoute(body.linkedRouteId) ? body.linkedRouteId : null) : existing?.linkedRouteId ?? null,
      linkedEventOccurrenceId,
      notes: body.notes !== undefined ? (str(body.notes, 500) ?? "") : existing?.notes ?? "",
      completionStatus,
      missedReason,
      completionNotes: body.completionNotes !== undefined ? str(body.completionNotes, 500) : existing?.completionNotes ?? null,
      // Links this day to a real logged activity (see "Log a run") - must actually belong to this
      // account, closing the gap where this field existed but nothing ever set it to a real value.
      completedRunId: body.completedRunId !== undefined
        ? (typeof body.completedRunId === "string" && db.getActivity(body.completedRunId)?.accountId === accountId ? body.completedRunId : null)
        : existing?.completedRunId ?? null,
      frozen: allowFreezeToggle && typeof body.frozen === "boolean" ? body.frozen : existing?.frozen ?? false,
      recurrenceId: existing?.recurrenceId ?? null,
      // Directly editing any prescriptive field on a day that came from a recurrence rule marks it
      // overridden, so a later "edit all instances" on that rule never silently clobbers this one.
      recurrenceOverridden: existing?.recurrenceOverridden === true
        || (existing?.recurrenceId != null && ["workoutType", "runLabel", "title", "distanceValue", "distanceUnit"].some((k) => body[k] !== undefined)),
      updatedAt: now.toISOString(),
    };
  }
  // ---- coach access to an athlete's plan - separate, explicit endpoints
  // rather than overloading /api/profile/training-plan with a query param,
  // so "my own data" and "someone else's data I have permission to see"
  // are never the same code path. Coaches can VIEW the plan's shape
  // (type/length/dates/race - the athlete's own commitment) but only WRITE
  // weekly content (the actual workouts) - the real coaching relationship.
  const coachPlanMatch = /^\/api\/coach\/athletes\/([^/]+)\/training-plan$/.exec(url.pathname);
  if (coachPlanMatch && method === "GET") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const athleteId = decodeURIComponent(coachPlanMatch[1]);
    if (!db.isActiveCoachOf(sess.accountId, athleteId)) return err(res, { status: 403, error: "not_their_coach" }), true;
    const plan = db.getTrainingPlan(athleteId);
    if (!plan) return ok(res, { plan: null }), true;
    const race = plan.linkedRaceId ? db.getRace(plan.linkedRaceId) : undefined;
    return ok(res, { plan: { ...plan, currentWeek: currentTrainingWeek(plan, now), linkedRaceName: race?.name ?? null } }), true;
  }
  const coachWeeksMatch = /^\/api\/coach\/athletes\/([^/]+)\/training-plan\/weeks$/.exec(url.pathname);
  if (coachWeeksMatch && method === "GET") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const athleteId = decodeURIComponent(coachWeeksMatch[1]);
    if (!db.isActiveCoachOf(sess.accountId, athleteId)) return err(res, { status: 403, error: "not_their_coach" }), true;
    return ok(res, { weeks: db.listTrainingPlanWeeks(athleteId) }), true;
  }
  const coachWeekWriteMatch = /^\/api\/coach\/athletes\/([^/]+)\/training-plan\/weeks\/(\d+)$/.exec(url.pathname);
  if (coachWeekWriteMatch && method === "PUT") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const athleteId = decodeURIComponent(coachWeekWriteMatch[1]);
    if (!db.isActiveCoachOf(sess.accountId, athleteId)) return err(res, { status: 403, error: "not_their_coach" }), true;
    const weekNumber = Number(coachWeekWriteMatch[2]);
    const plan = db.getTrainingPlan(athleteId);
    if (!plan) return err(res, { status: 404, error: "no_plan", message: "This athlete hasn't set up a training plan yet." }), true;
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > plan.totalWeeks) {
      return err(res, { status: 400, error: "invalid_week", message: `Week must be between 1 and ${plan.totalWeeks} for this plan.` }), true;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const targetMiles = typeof body.targetMiles === "number" && Number.isFinite(body.targetMiles) && body.targetMiles >= 0 ? body.targetMiles : null;
    const longRunMiles = typeof body.longRunMiles === "number" && Number.isFinite(body.longRunMiles) && body.longRunMiles >= 0 ? body.longRunMiles : null;
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";
    const week = db.setTrainingPlanWeek({ id: `${athleteId}-week-${weekNumber}`, accountId: athleteId, weekNumber, targetMiles, longRunMiles, notes, updatedAt: now.toISOString() });
    await db.persist();
    return ok(res, { week }), true;
  }
  // GET /api/coach/athletes/:athleteId/training-plan/days?start=&end= - same read-gate as weeks.
  const coachDaysMatch = /^\/api\/coach\/athletes\/([^/]+)\/training-plan\/days$/.exec(url.pathname);
  if (coachDaysMatch && method === "GET") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const athleteId = decodeURIComponent(coachDaysMatch[1]);
    if (!db.isActiveCoachOf(sess.accountId, athleteId)) return err(res, { status: 403, error: "not_their_coach" }), true;
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    let days = db.listTrainingPlanDays(athleteId);
    if (start) days = days.filter((d) => d.date >= start);
    if (end) days = days.filter((d) => d.date <= end);
    return ok(res, { days }), true;
  }
  // PUT /api/coach/athletes/:athleteId/training-plan/days/:date - a coach prescribing an actual day's workout.
  const coachDayWriteMatch = /^\/api\/coach\/athletes\/([^/]+)\/training-plan\/days\/(\d{4}-\d{2}-\d{2})(?:\/(am|pm))?$/.exec(url.pathname);
  if (coachDayWriteMatch && method === "PUT") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const athleteId = decodeURIComponent(coachDayWriteMatch[1]);
    if (!db.isActiveCoachOf(sess.accountId, athleteId)) return err(res, { status: 403, error: "not_their_coach" }), true;
    const dateStr = coachDayWriteMatch[2];
    const slot = (coachDayWriteMatch[3] as "am" | "pm" | undefined) ?? "primary";
    const plan = db.getTrainingPlan(athleteId);
    if (!plan) return err(res, { status: 404, error: "no_plan", message: "This athlete hasn't set up a training plan yet." }), true;
    const weekNumber = planWeekForDate(plan, dateStr);
    if (weekNumber === null) return err(res, { status: 400, error: "invalid_date", message: "That date falls outside this plan's range." }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const priorCoachDay = db.getTrainingPlanDay(athleteId, dateStr, slot);
    const day = db.setTrainingPlanDay(buildTrainingDay(athleteId, dateStr, slot, weekNumber, body, priorCoachDay, now, true));
    applyShoeMileageDelta(priorCoachDay, day);
    await db.persist();
    return ok(res, { day }), true;
  }

  // ---- strength/gym entries (unlimited per day, separate from the capped run slots) ----
  if (method === "GET" && url.pathname === "/api/profile/training-plan/strength") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const date = url.searchParams.get("date") ?? undefined;
    return ok(res, { entries: db.listStrengthEntries(sess.accountId, date) }), true;
  }
  if (method === "POST" && url.pathname === "/api/profile/training-plan/strength") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { date?: unknown; title?: unknown; durationMinutes?: unknown; notes?: unknown };
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : "";
    if (!date) return err(res, { status: 400, error: "invalid_date" }), true;
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 60) : "";
    if (!title) return err(res, { status: 400, error: "invalid_title", message: "Give it a title." }), true;
    const entry = db.setStrengthEntry({
      id: newId(),
      accountId: sess.accountId,
      date,
      title,
      durationMinutes: typeof body.durationMinutes === "number" && Number.isFinite(body.durationMinutes) && body.durationMinutes >= 0 ? body.durationMinutes : null,
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "",
      completionStatus: "pending",
      updatedAt: now.toISOString(),
    });
    await db.persist();
    return ok(res, { entry }), true;
  }
  const strengthEntryMatch = /^\/api\/profile\/training-plan\/strength\/([^/]+)$/.exec(url.pathname);
  if (strengthEntryMatch && method === "PUT") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const existing = db.getStrengthEntry(strengthEntryMatch[1]);
    if (!existing || existing.accountId !== sess.accountId) return err(res, { status: 404, error: "not_found" }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const STATUSES = ["pending", "done", "missed"] as const;
    const updated = db.setStrengthEntry({
      ...existing,
      title: typeof body.title === "string" ? body.title.trim().slice(0, 60) : existing.title,
      durationMinutes: body.durationMinutes !== undefined ? (typeof body.durationMinutes === "number" && Number.isFinite(body.durationMinutes) && body.durationMinutes >= 0 ? body.durationMinutes : null) : existing.durationMinutes,
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : existing.notes,
      completionStatus: typeof body.completionStatus === "string" && (STATUSES as readonly string[]).includes(body.completionStatus) ? (body.completionStatus as typeof STATUSES[number]) : existing.completionStatus,
      updatedAt: now.toISOString(),
    });
    await db.persist();
    return ok(res, { entry: updated }), true;
  }
  if (strengthEntryMatch && method === "DELETE") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const okDel = db.deleteStrengthEntry(sess.accountId, strengthEntryMatch[1]);
    if (!okDel) return err(res, { status: 404, error: "not_found" }), true;
    await db.persist();
    return ok(res, { ok: true }), true;
  }

  // ---- nutrition item library (gels, drink mixes, chews) ----
  if (method === "GET" && url.pathname === "/api/profile/nutrition-items") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    return ok(res, { items: db.listNutritionItems(sess.accountId) }), true;
  }
  if (method === "POST" && url.pathname === "/api/profile/nutrition-items") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { kind?: unknown; name?: unknown };
    const KINDS = ["gel", "drink_mix", "chew", "other"] as const;
    const kind = typeof body.kind === "string" && (KINDS as readonly string[]).includes(body.kind) ? (body.kind as typeof KINDS[number]) : "gel";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
    if (!name) return err(res, { status: 400, error: "invalid_name", message: "Give it a name." }), true;
    const item = db.addNutritionItem({ id: newId(), accountId: sess.accountId, kind, name, createdAt: now.toISOString() });
    await db.persist();
    return ok(res, { item }), true;
  }
  const nutritionDeleteMatch = /^\/api\/profile\/nutrition-items\/([^/]+)$/.exec(url.pathname);
  if (nutritionDeleteMatch && method === "DELETE") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const okDel = db.deleteNutritionItem(sess.accountId, decodeURIComponent(nutritionDeleteMatch[1]));
    if (!okDel) return err(res, { status: 404, error: "not_found" }), true;
    await db.persist();
    return ok(res, { ok: true }), true;
  }

  // ---- shoe library ----
  if (method === "GET" && url.pathname === "/api/profile/shoes") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    return ok(res, { shoes: db.listShoes(sess.accountId) }), true;
  }
  if (method === "POST" && url.pathname === "/api/profile/shoes") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { name?: unknown; isDefault?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
    if (!name) return err(res, { status: 400, error: "invalid_name", message: "Give the shoe a name." }), true;
    // The very first shoe someone adds becomes their default automatically - no reason to make them take a second step.
    const isDefault = body.isDefault === true || db.listShoes(sess.accountId).length === 0;
    const shoe = db.addShoe({ id: newId(), accountId: sess.accountId, name, isDefault, totalMiles: 0, createdAt: now.toISOString() });
    await db.persist();
    return ok(res, { shoe }), true;
  }
  const shoeDefaultMatch = /^\/api\/profile\/shoes\/([^/]+)\/default$/.exec(url.pathname);
  if (shoeDefaultMatch && method === "POST") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const okSet = db.setShoeDefault(sess.accountId, decodeURIComponent(shoeDefaultMatch[1]));
    if (!okSet) return err(res, { status: 404, error: "not_found" }), true;
    await db.persist();
    return ok(res, { ok: true }), true;
  }
  const shoeDeleteMatch = /^\/api\/profile\/shoes\/([^/]+)$/.exec(url.pathname);
  if (shoeDeleteMatch && method === "DELETE") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const okDel = db.deleteShoe(sess.accountId, decodeURIComponent(shoeDeleteMatch[1]));
    if (!okDel) return err(res, { status: 404, error: "not_found" }), true;
    await db.persist();
    return ok(res, { ok: true }), true;
  }

  if (url.pathname === "/api/profile/training-plan") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;

    if (method === "GET") {
      const plan = db.getTrainingPlan(sess.accountId);
      if (!plan) return ok(res, { plan: null }), true;
      const race = plan.linkedRaceId ? db.getRace(plan.linkedRaceId) : undefined;
      return ok(res, { plan: { ...plan, currentWeek: currentTrainingWeek(plan, now), linkedRaceName: race?.name ?? null } }), true;
    }

    if (method === "PUT") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const planType = typeof body.planType === "string" && (TRAINING_PLAN_TYPES as readonly string[]).includes(body.planType) ? (body.planType as typeof TRAINING_PLAN_TYPES[number]) : null;
      if (!planType) return err(res, { status: 400, error: "invalid_plan_type", message: "Choose a valid plan type." }), true;
      const totalWeeks = typeof body.totalWeeks === "number" ? Math.round(body.totalWeeks) : NaN;
      if (!Number.isFinite(totalWeeks) || totalWeeks < 1 || totalWeeks > 52) return err(res, { status: 400, error: "invalid_weeks", message: "Plan length must be between 1 and 52 weeks." }), true;
      const startDate = typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate) ? body.startDate : null;
      if (!startDate) return err(res, { status: 400, error: "invalid_start_date", message: "Give a valid start date." }), true;
      const customLabel = planType === "other" && typeof body.customLabel === "string" ? body.customLabel.trim().slice(0, 40) || null : null;
      let linkedRaceId: string | null = null;
      if (body.linkedRaceId !== null && body.linkedRaceId !== undefined) {
        if (typeof body.linkedRaceId !== "string" || !db.getRace(body.linkedRaceId)) return err(res, { status: 400, error: "invalid_race", message: "That race couldn't be found." }), true;
        linkedRaceId = body.linkedRaceId;
      }
      // A race that isn't in the system yet - stored as a plain display
      // name (not a real race link) until it's submitted and approved
      // separately. Cleared automatically once a real linkedRaceId is set.
      const customRaceName = linkedRaceId ? null : (typeof body.customRaceName === "string" && body.customRaceName.trim() ? body.customRaceName.trim().slice(0, 80) : null);
      const existing = db.getTrainingPlan(sess.accountId);
      const plan = db.setTrainingPlan({
        accountId: sess.accountId,
        planType,
        customLabel,
        totalWeeks,
        startDate,
        linkedRaceId,
        customRaceName,
        createdAt: existing?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      });
      await db.persist();
      const race = plan.linkedRaceId ? db.getRace(plan.linkedRaceId) : undefined;
      return ok(res, { plan: { ...plan, currentWeek: currentTrainingWeek(plan, now), linkedRaceName: race?.name ?? null } }), true;
    }

    if (method === "DELETE") {
      db.deleteTrainingPlan(sess.accountId);
      await db.persist();
      return ok(res, { deleted: true }), true;
    }
  }

  // GET /api/profile/training-plan/weeks — every week's content for the
  // signed-in user's own plan, filled or not. A plan doesn't need to exist
  // for this to return an empty array (rather than erroring), since the UI
  // may check weeks before the plan itself has loaded.
  if (method === "GET" && url.pathname === "/api/profile/training-plan/weeks") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    return ok(res, { weeks: db.listTrainingPlanWeeks(sess.accountId) }), true;
  }
  // PUT /api/profile/training-plan/weeks/:weekNumber — set one week's content.
  const weekMatch = /^\/api\/profile\/training-plan\/weeks\/(\d+)$/.exec(url.pathname);
  if (weekMatch && method === "PUT") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const weekNumber = Number(weekMatch[1]);
    const plan = db.getTrainingPlan(sess.accountId);
    if (!plan) return err(res, { status: 404, error: "no_plan", message: "Create a training plan before adding weekly content." }), true;
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > plan.totalWeeks) {
      return err(res, { status: 400, error: "invalid_week", message: `Week must be between 1 and ${plan.totalWeeks} for this plan.` }), true;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const targetMiles = typeof body.targetMiles === "number" && Number.isFinite(body.targetMiles) && body.targetMiles >= 0 ? body.targetMiles : null;
    const longRunMiles = typeof body.longRunMiles === "number" && Number.isFinite(body.longRunMiles) && body.longRunMiles >= 0 ? body.longRunMiles : null;
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";
    const week = db.setTrainingPlanWeek({
      id: `${sess.accountId}-week-${weekNumber}`,
      accountId: sess.accountId,
      weekNumber,
      targetMiles,
      longRunMiles,
      notes,
      updatedAt: now.toISOString(),
    });
    await db.persist();
    return ok(res, { week }), true;
  }

  /** Generates real day records for every date in the rule's range that falls on one of its days-of-week AND within the plan's own date span. Never touches a day already marked recurrenceOverridden - that instance was edited directly and must survive regeneration untouched. */
  function generateRecurrenceInstances(accountId: string, plan: { startDate: string; totalWeeks: number }, recurrence: import("./types").TrainingPlanRecurrenceRecord, now: Date): number {
    let count = 0;
    const start = new Date(`${recurrence.startDate}T00:00:00Z`);
    const end = new Date(`${recurrence.endDate}T00:00:00Z`);
    for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (!recurrence.daysOfWeek.includes(d.getUTCDay())) continue;
      const dateStr = d.toISOString().slice(0, 10);
      const weekNumber = planWeekForDate(plan, dateStr);
      if (weekNumber === null) continue; // outside the plan's own span - skip rather than error, so a recurrence can run longer than the plan without failing entirely
      const existing = db.getTrainingPlanDay(accountId, dateStr, "primary");
      if (existing?.recurrenceOverridden) continue;
      const generated = buildTrainingDay(accountId, dateStr, "primary", weekNumber, {
        workoutType: recurrence.workoutType, runLabel: recurrence.runLabel, title: recurrence.title, distanceValue: recurrence.distanceValue, distanceUnit: recurrence.distanceUnit,
      }, existing, now, false);
      db.setTrainingPlanDay({ ...generated, recurrenceId: recurrence.id });
      count++;
    }
    return count;
  }

  // POST /api/profile/training-plan/recurrences - Outlook-style "repeat this workout" rule.
  if (method === "POST" && url.pathname === "/api/profile/training-plan/recurrences") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const plan = db.getTrainingPlan(sess.accountId);
    if (!plan) return err(res, { status: 404, error: "no_plan", message: "Create a training plan before scheduling recurring workouts." }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const daysOfWeek = Array.isArray(body.daysOfWeek) ? body.daysOfWeek.filter((n): n is number => typeof n === "number" && n >= 0 && n <= 6) : [];
    if (daysOfWeek.length === 0) return err(res, { status: 400, error: "invalid_days", message: "Pick at least one day of the week." }), true;
    const startDate = typeof body.startDate === "string" ? body.startDate : "";
    const endDate = typeof body.endDate === "string" ? body.endDate : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
      return err(res, { status: 400, error: "invalid_range", message: "Pick a valid start and end date." }), true;
    }
    const WORKOUT_TYPES = ["run", "cross_training", "rest", "recovery", "race", "swim"] as const;
    const RUN_LABELS = ["easy", "tempo", "long_run", "workout", "recovery_run", "race_pace", "intervals"] as const;
    const DISTANCE_UNITS = ["miles", "km", "meters", "yards"] as const;
    const workoutType = typeof body.workoutType === "string" && (WORKOUT_TYPES as readonly string[]).includes(body.workoutType) ? (body.workoutType as typeof WORKOUT_TYPES[number]) : "run";
    const rec: import("./types").TrainingPlanRecurrenceRecord = {
      id: newId(),
      accountId: sess.accountId,
      daysOfWeek,
      startDate,
      endDate,
      workoutType,
      runLabel: typeof body.runLabel === "string" && (RUN_LABELS as readonly string[]).includes(body.runLabel) ? (body.runLabel as typeof RUN_LABELS[number]) : null,
      title: typeof body.title === "string" ? body.title.trim().slice(0, 60) : "",
      distanceValue: typeof body.distanceValue === "number" && Number.isFinite(body.distanceValue) && body.distanceValue >= 0 ? body.distanceValue : null,
      distanceUnit: typeof body.distanceUnit === "string" && (DISTANCE_UNITS as readonly string[]).includes(body.distanceUnit) ? (body.distanceUnit as typeof DISTANCE_UNITS[number]) : "miles",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    db.setRecurrence(rec);
    const generatedCount = generateRecurrenceInstances(sess.accountId, plan, rec, now);
    await db.persist();
    return ok(res, { recurrence: rec, generatedCount }), true;
  }
  if (method === "GET" && url.pathname === "/api/profile/training-plan/recurrences") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    return ok(res, { recurrences: db.listRecurrences(sess.accountId) }), true;
  }
  // PUT /api/profile/training-plan/recurrences/:id - "edit all instances": updates the rule and
  // regenerates every non-overridden day still tied to it. The classic Outlook "this vs all" choice -
  // "this instance only" is just a normal PUT to the single day, which already flips recurrenceOverridden.
  const recurrenceEditMatch = /^\/api\/profile\/training-plan\/recurrences\/([^/]+)$/.exec(url.pathname);
  if (recurrenceEditMatch && method === "PUT") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const existing = db.getRecurrence(recurrenceEditMatch[1]);
    if (!existing || existing.accountId !== sess.accountId) return err(res, { status: 404, error: "not_found" }), true;
    const plan = db.getTrainingPlan(sess.accountId);
    if (!plan) return err(res, { status: 404, error: "no_plan" }), true;
    const body = (await readJson(req)) as Record<string, unknown>;
    const WORKOUT_TYPES = ["run", "cross_training", "rest", "recovery", "race", "swim"] as const;
    const RUN_LABELS = ["easy", "tempo", "long_run", "workout", "recovery_run", "race_pace", "intervals"] as const;
    const DISTANCE_UNITS = ["miles", "km", "meters", "yards"] as const;
    const updated: import("./types").TrainingPlanRecurrenceRecord = {
      ...existing,
      workoutType: typeof body.workoutType === "string" && (WORKOUT_TYPES as readonly string[]).includes(body.workoutType) ? (body.workoutType as typeof WORKOUT_TYPES[number]) : existing.workoutType,
      runLabel: typeof body.runLabel === "string" && (RUN_LABELS as readonly string[]).includes(body.runLabel) ? (body.runLabel as typeof RUN_LABELS[number]) : existing.runLabel,
      title: typeof body.title === "string" ? body.title.trim().slice(0, 60) : existing.title,
      distanceValue: typeof body.distanceValue === "number" && Number.isFinite(body.distanceValue) && body.distanceValue >= 0 ? body.distanceValue : existing.distanceValue,
      distanceUnit: typeof body.distanceUnit === "string" && (DISTANCE_UNITS as readonly string[]).includes(body.distanceUnit) ? (body.distanceUnit as typeof DISTANCE_UNITS[number]) : existing.distanceUnit,
      updatedAt: now.toISOString(),
    };
    db.setRecurrence(updated);
    const generatedCount = generateRecurrenceInstances(sess.accountId, plan, updated, now);
    await db.persist();
    return ok(res, { recurrence: updated, generatedCount }), true;
  }
  if (recurrenceEditMatch && method === "DELETE") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const okDel = db.deleteRecurrence(sess.accountId, recurrenceEditMatch[1]);
    if (!okDel) return err(res, { status: 404, error: "not_found" }), true;
    await db.persist();
    return ok(res, { ok: true }), true;
  }

  // POST /api/profile/training-plan/weekly-email - self-coached: send this week's plan to my own email now.
  if (method === "POST" && url.pathname === "/api/profile/training-plan/weekly-email") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { weekStartDate?: unknown; notes?: unknown };
    const weekStartDate = typeof body.weekStartDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.weekStartDate) ? body.weekStartDate : null;
    if (!weekStartDate) return err(res, { status: 400, error: "invalid_date", message: "Pick a valid week start date." }), true;
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 1000) : "";
    const result = await sendWeeklyPlanEmail(db, sess.accountId, weekStartDate, notes, "self", null, now);
    await db.persist();
    if (!result.ok) return err(res, { status: 502, error: "email_failed", message: "Couldn't send the email right now — try again." }), true;
    return ok(res, { sent: true }), true;
  }
  // POST /api/coach/athletes/:athleteId/weekly-email - coach presents the week to a specific athlete.
  const coachWeeklyEmailMatch = /^\/api\/coach\/athletes\/([^/]+)\/weekly-email$/.exec(url.pathname);
  if (coachWeeklyEmailMatch && method === "POST") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const athleteId = decodeURIComponent(coachWeeklyEmailMatch[1]);
    if (!db.isActiveCoachOf(sess.accountId, athleteId)) return err(res, { status: 403, error: "not_their_coach" }), true;
    const body = (await readJson(req)) as { weekStartDate?: unknown; notes?: unknown };
    const weekStartDate = typeof body.weekStartDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.weekStartDate) ? body.weekStartDate : null;
    if (!weekStartDate) return err(res, { status: 400, error: "invalid_date", message: "Pick a valid week start date." }), true;
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 1000) : "";
    const result = await sendWeeklyPlanEmail(db, athleteId, weekStartDate, notes, "coach", sess.accountId, now);
    await db.persist();
    if (!result.ok) return err(res, { status: 502, error: "email_failed", message: "Couldn't send the email right now — try again." }), true;
    return ok(res, { sent: true }), true;
  }
  // GET /api/profile/training-plan/weekly-emails - history, for showing "sent" status in the UI.
  if (method === "GET" && url.pathname === "/api/profile/training-plan/weekly-emails") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const weekStartDate = url.searchParams.get("weekStartDate");
    if (!weekStartDate) return err(res, { status: 400, error: "missing_week" }), true;
    const rec = db.getWeeklyPlanEmail(sess.accountId, weekStartDate);
    return ok(res, { email: rec ?? null }), true;
  }

  // GET /api/profile/training-plan/days?start=YYYY-MM-DD&end=YYYY-MM-DD -
  // real calendar-date range, for the calendar view. Omit both to get every day.
  if (method === "GET" && url.pathname === "/api/profile/training-plan/days") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    let days = db.listTrainingPlanDays(sess.accountId);
    if (start) days = days.filter((d) => d.date >= start);
    if (end) days = days.filter((d) => d.date <= end);
    return ok(res, { days }), true;
  }
  // GET /api/profile/training-plan/summary?start=&end= - the actual "end of week/month update":
  // every plan day in range, plus which logged activities were linked to the plan vs. solo/extra
  // runs that weren't - the same endpoint serves a day, week, or month view; the caller just
  // picks the date range, so there's no separate "granularity" concept to keep in sync.
  // GET /api/profile/training-plan/block-summary?start=&end= - real gear/nutrition totals for a
  // specific block (a training cycle, a month, whatever range), computed fresh from the actual
  // completed days in that range - NOT the lifetime running totalMiles on the shoe itself, which
  // covers all time and would be wrong for "how much did I use this training block."
  if (method === "GET" && url.pathname === "/api/profile/training-plan/block-summary") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const start = url.searchParams.get("start") ?? "0000-01-01";
    const end = url.searchParams.get("end") ?? "9999-12-31";
    const doneDays = db.listTrainingPlanDays(sess.accountId).filter((d) => d.date >= start && d.date <= end && d.completionStatus === "done");

    const shoeMilesById = new Map<string, number>();
    for (const d of doneDays) {
      if (!d.shoeId || d.distanceValue == null) continue;
      const miles = toMiles(d.distanceValue, d.distanceUnit);
      shoeMilesById.set(d.shoeId, (shoeMilesById.get(d.shoeId) ?? 0) + miles);
    }
    const shoeMiles = [...shoeMilesById.entries()].map(([shoeId, miles]) => ({
      shoeId, shoeName: db.getShoe(shoeId)?.name ?? "Unknown shoe", miles: Math.round(miles * 10) / 10,
    })).sort((a, b) => b.miles - a.miles);

    const totalGels = doneDays.reduce((sum, d) => sum + (d.actualGelCount ?? 0), 0);
    const drinkMixCountById = new Map<string, number>();
    for (const d of doneDays) {
      if (!d.actualDrinkMixId) continue;
      drinkMixCountById.set(d.actualDrinkMixId, (drinkMixCountById.get(d.actualDrinkMixId) ?? 0) + 1);
    }
    const drinkMixUsage = [...drinkMixCountById.entries()].map(([id, count]) => ({
      nutritionItemId: id, name: db.getNutritionItem(id)?.name ?? "Unknown", uses: count,
    })).sort((a, b) => b.uses - a.uses);

    return ok(res, { start, end, doneDayCount: doneDays.length, shoeMiles, totalGels, drinkMixUsage }), true;
  }

  if (method === "GET" && url.pathname === "/api/profile/training-plan/summary") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const start = url.searchParams.get("start") ?? "0000-01-01";
    const end = url.searchParams.get("end") ?? "9999-12-31";
    const planDays = db.listTrainingPlanDays(sess.accountId).filter((d) => d.date >= start && d.date <= end);
    const strengthEntries = db.listStrengthEntries(sess.accountId).filter((e) => e.date >= start && e.date <= end);
    const linkedActivityIds = new Set(planDays.map((d) => d.completedRunId).filter((id): id is string => id !== null));
    const activitiesInRange = db.listActivities(sess.accountId).filter((a) => {
      const activityDate = a.completedAt.slice(0, 10);
      return activityDate >= start && activityDate <= end;
    });
    const linkedActivities = activitiesInRange.filter((a) => linkedActivityIds.has(a.id));
    const unlinkedActivities = activitiesInRange.filter((a) => !linkedActivityIds.has(a.id));
    const toMilesLocal = (v: number, u: string) => (u === "miles" ? v : u === "km" ? v * 0.621371 : u === "meters" ? v * 0.000621371 : v * 0.000568182);
    const plannedMiles = planDays.reduce((sum, d) => sum + (d.distanceValue ? toMilesLocal(d.distanceValue, d.distanceUnit) : 0), 0);
    const loggedMiles = activitiesInRange.reduce((sum, a) => sum + a.distanceMeters * 0.000621371, 0);
    return ok(res, {
      planDays,
      strengthEntries,
      linkedActivities,
      unlinkedActivities,
      totals: {
        plannedMiles: Math.round(plannedMiles * 10) / 10,
        loggedMiles: Math.round(loggedMiles * 10) / 10,
        daysDone: planDays.filter((d) => d.completionStatus === "done").length,
        daysMissed: planDays.filter((d) => d.completionStatus === "missed").length,
        daysModified: planDays.filter((d) => d.completionStatus === "modified").length,
        daysPending: planDays.filter((d) => d.completionStatus === "pending" && d.workoutType !== "rest").length,
      },
    }), true;
  }
  // GET /api/profile/training-plan/week-score?weekStartDate= - the actual red/yellow/green
  // grade, run and strength scored separately, plus whether the PRIOR week is still blocking
  // (red and unreviewed) and whether THIS week already has a review on file if it's red.
  if (method === "GET" && url.pathname === "/api/profile/training-plan/week-score") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const weekStartDate = url.searchParams.get("weekStartDate");
    if (!weekStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)) return err(res, { status: 400, error: "invalid_date" }), true;
    const score = db.computeWeekScore(sess.accountId, weekStartDate, now);
    const priorWeekStart = new Date(`${weekStartDate}T00:00:00Z`);
    priorWeekStart.setUTCDate(priorWeekStart.getUTCDate() - 7);
    const priorWeekStartStr = priorWeekStart.toISOString().slice(0, 10);
    const priorScore = db.computeWeekScore(sess.accountId, priorWeekStartStr, now);
    const priorReviewed = db.getWeeklyReview(sess.accountId, priorWeekStartStr) !== undefined;
    return ok(res, {
      ...score,
      weekStartDate,
      reviewRequired: score.overallColor === "red",
      reviewed: db.getWeeklyReview(sess.accountId, weekStartDate) !== undefined,
      priorWeekBlocking: priorScore.overallColor === "red" && !priorReviewed,
      priorWeekStartDate: priorWeekStartStr,
    }), true;
  }
  // POST /api/profile/training-plan/week-review - the mandatory checkpoint. Only accepted when
  // the target week actually scored red, and requires real notes - a review isn't a formality.
  if (method === "POST" && url.pathname === "/api/profile/training-plan/week-review") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { weekStartDate?: unknown; notes?: unknown };
    const weekStartDate = typeof body.weekStartDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.weekStartDate) ? body.weekStartDate : null;
    if (!weekStartDate) return err(res, { status: 400, error: "invalid_date" }), true;
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : "";
    if (!notes) return err(res, { status: 400, error: "notes_required", message: "Write what's going to be different this week." }), true;
    const score = db.computeWeekScore(sess.accountId, weekStartDate, now);
    if (score.overallColor !== "red") return err(res, { status: 400, error: "not_red", message: "This week wasn't red - no review needed." }), true;
    const rec = db.recordWeeklyReview({ id: `${sess.accountId}-review-${weekStartDate}`, accountId: sess.accountId, weekStartDate, color: score.overallColor, notes, reviewedAt: now.toISOString() });
    await db.persist();
    return ok(res, { review: rec }), true;
  }
  // GET /api/coach/athletes/:athleteId/week-score?weekStartDate= - same score, coach-gated.
  const coachWeekScoreMatch = /^\/api\/coach\/athletes\/([^/]+)\/week-score$/.exec(url.pathname);
  if (coachWeekScoreMatch && method === "GET") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const athleteId = decodeURIComponent(coachWeekScoreMatch[1]);
    if (!db.isActiveCoachOf(sess.accountId, athleteId)) return err(res, { status: 403, error: "not_their_coach" }), true;
    const weekStartDate = url.searchParams.get("weekStartDate");
    if (!weekStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)) return err(res, { status: 400, error: "invalid_date" }), true;
    const score = db.computeWeekScore(athleteId, weekStartDate, now);
    return ok(res, { ...score, weekStartDate, reviewed: db.getWeeklyReview(athleteId, weekStartDate) !== undefined }), true;
  }
  // GET /api/coach/roster - every athlete this coach has, with their current week's color at a glance.
  if (method === "GET" && url.pathname === "/api/coach/roster") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const weekStartDay = db.getAccount(sess.accountId)?.weekStartDay ?? 0;
    const currentWeekStart = db.weekStartDateFor(now.toISOString().slice(0, 10), weekStartDay);
    const athletes = db.listCoachRelationshipsFor(sess.accountId).filter((r) => r.coachId === sess.accountId && r.status === "active");
    const rows = athletes.map((r) => {
      const athlete = db.getAccount(r.athleteId);
      const score = db.computeWeekScore(r.athleteId, currentWeekStart, now);
      return { relationshipId: r.id, athleteId: r.athleteId, athleteName: athlete?.name ?? "An athlete", weekStartDate: currentWeekStart, ...score };
    });
    return ok(res, { athletes: rows }), true;
  }
  // GET /api/coaches - the coach directory: everyone who's self-declared available to coach,
  // with their bio and whether they also hold the existing verified coach_certification credential
  // (a real, higher-trust signal, surfaced here rather than duplicated as a separate system).
  if (method === "GET" && url.pathname === "/api/coaches") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rows = db.listAccounts()
      .filter((a) => !a.deletedAt && a.isAvailableAsCoach === true && a.id !== sess.accountId)
      .map((a) => ({
        accountId: a.id,
        name: a.name,
        username: a.username,
        coachBio: a.coachBio,
        isVerifiedCoach: db.listCredentials(a.id).some((c) => c.type === "coach_certification" && c.status === "verified"),
      }))
      .sort((a, b) => (a.isVerifiedCoach === b.isVerifiedCoach ? a.name.localeCompare(b.name) : a.isVerifiedCoach ? -1 : 1));
    return ok(res, { coaches: rows }), true;
  }
  // PUT /api/profile/training-plan/days/:date or /:date/:slot(am|pm) - set one day's real content.
  const dayMatch = /^\/api\/profile\/training-plan\/days\/(\d{4}-\d{2}-\d{2})(?:\/(am|pm))?$/.exec(url.pathname);
  if (dayMatch && method === "PUT") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const dateStr = dayMatch[1];
    const slot = (dayMatch[2] as "am" | "pm" | undefined) ?? "primary";
    const plan = db.getTrainingPlan(sess.accountId);
    if (!plan) return err(res, { status: 404, error: "no_plan", message: "Create a training plan before adding daily content." }), true;
    const weekNumber = planWeekForDate(plan, dateStr);
    if (weekNumber === null) return err(res, { status: 400, error: "invalid_date", message: "That date falls outside this plan's range." }), true;
    const existing = db.getTrainingPlanDay(sess.accountId, dateStr, slot);
    const body = (await readJson(req)) as Record<string, unknown>;
    // A coach's freeze blocks every athlete edit to this day/slot, full stop - the coach can still edit it themselves via the coach endpoint.
    if (existing?.frozen) return err(res, { status: 403, error: "day_frozen", message: "Your coach has locked this day — contact them if it needs to change." }), true;
    // An athlete with an ACTIVE coach can't directly edit the prescribed workout - they propose a change instead. Linking a group run and logging plan-vs-actual (did I actually do it) are always the athlete's own call, never gated.
    const hasActiveCoach = db.listCoachRelationshipsFor(sess.accountId).some((r) => r.athleteId === sess.accountId && r.status === "active");
    const ALWAYS_ALLOWED = new Set(["linkedEventOccurrenceId", "completionStatus", "missedReason", "completionNotes"]);
    if (hasActiveCoach && Object.keys(body).some((k) => !ALWAYS_ALLOWED.has(k))) {
      return err(res, { status: 403, error: "coach_managed", message: "Your coach manages this workout — propose a change instead of editing it directly." }), true;
    }
    const day = db.setTrainingPlanDay(buildTrainingDay(sess.accountId, dateStr, slot, weekNumber, body, existing, now, false));
    applyShoeMileageDelta(existing, day);
    await db.persist();
    return ok(res, { day }), true;
  }

  // POST /api/profile/training-plan/days/:date/propose (or :date/:slot/propose) - a coached
  // athlete's actual path forward after hitting coach_managed. Body: { coachId, proposedChanges, note }.
  const proposeMatch = /^\/api\/profile\/training-plan\/days\/(\d{4}-\d{2}-\d{2})(?:\/(am|pm))?\/propose$/.exec(url.pathname);
  if (proposeMatch && method === "POST") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const dateStr = proposeMatch[1];
    const slot: import("./types").TrainingDaySlot = (proposeMatch[2] as "am" | "pm" | undefined) ?? "primary";
    const body = (await readJson(req)) as { coachId?: unknown; proposedChanges?: unknown; note?: unknown };
    const coachId = typeof body.coachId === "string" ? body.coachId : "";
    if (!db.isActiveCoachOf(coachId, sess.accountId)) return err(res, { status: 400, error: "not_your_coach", message: "That's not an active coach of yours." }), true;
    const proposedChanges = body.proposedChanges && typeof body.proposedChanges === "object" ? (body.proposedChanges as Record<string, unknown>) : {};
    if (Object.keys(proposedChanges).length === 0) return err(res, { status: 400, error: "empty_proposal", message: "Nothing to propose." }), true;
    const rec = db.createChangeProposal({
      id: newId(),
      athleteId: sess.accountId,
      coachId,
      date: dateStr,
      slot,
      proposedChanges,
      note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : "",
      status: "pending",
      createdAt: now.toISOString(),
      respondedAt: null,
    });
    await db.persist();
    return ok(res, { proposal: rec }), true;
  }
  // GET /api/coach/proposals - every proposal from any of the caller's athletes, most recent first.
  if (method === "GET" && url.pathname === "/api/coach/proposals") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rows = db.listChangeProposalsFor(sess.accountId).filter((p) => p.coachId === sess.accountId).map((p) => ({ ...p, athleteName: db.getAccount(p.athleteId)?.name ?? "An athlete" }));
    return ok(res, { proposals: rows }), true;
  }
  // GET /api/profile/training-plan/proposals - an athlete's own proposals (to track what's pending).
  if (method === "GET" && url.pathname === "/api/profile/training-plan/proposals") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rows = db.listChangeProposalsFor(sess.accountId).filter((p) => p.athleteId === sess.accountId);
    return ok(res, { proposals: rows }), true;
  }
  // POST /api/coach/proposals/:id/approve|decline - approving actually applies the proposed
  // changes to the real day (bypassing the coach_managed gate, since the coach IS the one approving).
  const proposalRespondMatch = /^\/api\/coach\/proposals\/([^/]+)\/(approve|decline)$/.exec(url.pathname);
  if (proposalRespondMatch && method === "POST") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const proposal = db.getChangeProposal(proposalRespondMatch[1]);
    if (!proposal || proposal.coachId !== sess.accountId) return err(res, { status: 404, error: "not_found" }), true;
    if (proposal.status !== "pending") return err(res, { status: 409, error: "already_resolved" }), true;
    const approve = proposalRespondMatch[2] === "approve";
    if (approve) {
      const plan = db.getTrainingPlan(proposal.athleteId);
      const weekNumber = plan ? planWeekForDate(plan, proposal.date) : null;
      if (weekNumber !== null) {
        const existing = db.getTrainingPlanDay(proposal.athleteId, proposal.date, proposal.slot);
        const day = db.setTrainingPlanDay(buildTrainingDay(proposal.athleteId, proposal.date, proposal.slot, weekNumber, proposal.proposedChanges, existing, now, false));
        applyShoeMileageDelta(existing, day);
      }
    }
    db.respondToChangeProposal(proposal.id, approve, now);
    await db.persist();
    return ok(res, { ok: true, applied: approve }), true;
  }

  // ---- runner tags on content (posts/events/runs) --------------------------
  // POST /api/tags — verified actor, target must exist, self-tag rejected,
  // blocked pairs rejected. No approval needed. PATCH /api/tags/:id/self —
  // ONLY the tagged user may toggle their own hiddenByTaggedUser flag.
  if (method === "POST" && url.pathname === "/api/tags") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const actor = db.getAccount(sess.accountId);
    if (!actor || actor.deletedAt || actor.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    const body = (await readJson(req)) as { contentType?: unknown; contentId?: unknown; taggedUserId?: unknown };
    const contentType = body.contentType;
    const contentId = typeof body.contentId === "string" ? body.contentId : "";
    const taggedUserId = typeof body.taggedUserId === "string" ? body.taggedUserId : "";
    if ((contentType !== "run" && contentType !== "post" && contentType !== "event") || !contentId || !taggedUserId) return err(res, { status: 400, error: "invalid_tag" }), true;
    if (taggedUserId === sess.accountId) return err(res, { status: 400, error: "cannot_tag_self" }), true;
    const target = db.getAccount(taggedUserId);
    if (!target || target.deletedAt) return err(res, { status: 404, error: "not_found" }), true;
    // Tagging a blocked person must fail like tagging someone who is not there.
    if (db.isBlocked(sess.accountId, taggedUserId)) return err(res, { status: 404, error: "not_found" }), true;
    const tag: import("./types").TagRecord = { id: newId(), contentType, contentId, taggedUserId, taggedByUserId: sess.accountId, hiddenByTaggedUser: false, createdAt: now.toISOString() };
    db.addTag(tag);
    await db.persist();
    return ok(res, { tag: tagDto(tag) }), true;
  }
  // GET /api/tags?contentType=&contentId= — public-safe read (guests OK):
  // hidden_by_tagged_user rows are excluded UNLESS the viewer is the tagged
  // user; blocked pairs (viewer ↔ tagged user) are excluded; each row carries
  // the tagged user's public profile.
  if (method === "GET" && url.pathname === "/api/tags") {
    const contentType = url.searchParams.get("contentType") ?? "";
    const contentId = url.searchParams.get("contentId") ?? "";
    if ((contentType !== "run" && contentType !== "post" && contentType !== "event") || !contentId) return err(res, { status: 400, error: "invalid_tag_query" }), true;
    const sess = requireSession(db, cookies);
    const viewerId = sess ? sess.accountId : null;
    const tags = db
      .getTagsForContent(contentType, contentId)
      .filter((t) => !(t.hiddenByTaggedUser && t.taggedUserId !== viewerId))
      .filter((t) => viewerId === null || !db.isBlocked(viewerId, t.taggedUserId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((t) => ({ ...tagDto(t), taggedUser: publicRunnerProfile(db.getAccount(t.taggedUserId)!, now) }))
      .filter((x) => x.taggedUser !== null);
    return ok(res, { tags }), true;
  }
  const tagSelf = /^\/api\/tags\/([^/]+)\/self$/.exec(url.pathname);
  if (tagSelf && method === "PATCH") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const body = (await readJson(req)) as { hiddenByTaggedUser?: unknown };
    if (typeof body.hiddenByTaggedUser !== "boolean") return err(res, { status: 400, error: "invalid_hidden_flag" }), true;
    const tag = db.getTag(decodeURIComponent(tagSelf[1]));
    if (!tag) return err(res, { status: 404, error: "not_found" }), true;
    if (tag.taggedUserId !== sess.accountId) return err(res, { status: 403, error: "forbidden" }), true;
    const updated = db.updateTag(tag.id, { hiddenByTaggedUser: body.hiddenByTaggedUser })!;
    await db.persist();
    return ok(res, { tag: tagDto(updated) }), true;
  }
  // GET /api/runners/:id/tagged — content (posts/events) where this runner is
  // tagged. Gated by canView(viewer, owner, show_tagged_content); hidden rows
  // drop for everyone except the tagged user themselves; blocked pairs are
  // handled inside canView (blocked beats everything → empty).
  const runnerTagged = /^\/api\/runners\/([a-f0-9]{32})\/tagged$/.exec(url.pathname);
  if (runnerTagged && method === "GET") {
    const owner = db.getAccount(runnerTagged[1]);
    if (!owner || owner.deletedAt) return err(res, { status: 404, error: "not_found" }), true;
    const sess = requireSession(db, cookies);
    const viewerId = sess ? sess.accountId : null;
    if (!canView(db, viewerId, owner.id, "show_tagged_content")) return ok(res, { tagged: [] }), true;
    const tagged = db
      .getTagsForUser(owner.id)
      .filter((t) => !(t.hiddenByTaggedUser && viewerId !== owner.id))
      .map((t) => ({ tag: { id: t.id, contentType: t.contentType, contentId: t.contentId, hiddenByTaggedUser: t.hiddenByTaggedUser, createdAt: t.createdAt }, content: resolveTaggedContent(db, t) }))
      .filter((x) => x.content !== null)
      .sort((a, b) => b.tag.createdAt.localeCompare(a.tag.createdAt));
    return ok(res, { tagged }), true;
  }
  // GET /api/runners/:id/activity — the runner's public forum posts PLUS their
  // activity cards (manual/auto/strava records via cardForActivity), gated by
  // canView(viewer, owner, show_past_activity) at the endpoint level and by
  // activityVisibleTo per card (shareMode private -> owner only). Public read
  // (guests pass only when the setting is public — the default). Empty when
  // nothing is visible. Forum-posts payload shape is backward-compatible; the
  // activityCards array rides alongside it.
  const runnerActivity = /^\/api\/runners\/([a-f0-9]{32})\/activity$/.exec(url.pathname);
  if (runnerActivity && method === "GET") {
    const owner = db.getAccount(runnerActivity[1]);
    if (!owner || owner.deletedAt) return err(res, { status: 404, error: "not_found" }), true;
    const sess = requireSession(db, cookies);
    const viewerId = sess && !db.getAccount(sess.accountId)?.deletedAt ? sess.accountId : null;
    if (!canView(db, viewerId, owner.id, "show_past_activity")) return ok(res, { activity: [], activityCards: [] }), true;
    const activity = db
      .listForumPosts()
      .filter((f) => f.authorAccountId === owner.id && f.state === "visible")
      .filter((f) => {
        const mod = db.getContent(`post:${f.id}`);
        return !mod?.hidden && !mod?.archived;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((f) => ({ id: f.id, title: f.title, excerpt: f.body.slice(0, 200), section: f.section, createdAt: f.createdAt }));
    const activityCards = db
      .listActivities()
      .filter((a) => a.accountId === owner.id && activityVisibleTo(db, viewerId, a))
      .map(publicActivityCard)
      .sort((x, y) => y.sharedAt.localeCompare(x.sharedAt));
    return ok(res, { activity, activityCards }), true;
  }

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
  if (discussionPath && (method === "GET" || method === "POST" || method === "PATCH" || method === "DELETE")) {
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
    // The client may send the canonical occurrence id OR the display-space
    // form seed events surface (`event:<seedRefId>:<date>`, as returned by
    // My Runs / the RSVP API). Resolve to the CANONICAL id before any
    // attendance/record check: stored rows are always canonical, so a
    // display spelling never widens or narrows exact-occurrence access.
    const requestedCanonical = occ && (occ.occurrenceId === occurrenceId || (occ.event?.seedRefId && occurrenceId === `event:${occ.event.seedRefId}:${runDate}`)) ? occ.occurrenceId : "";
    if (!event || !occ || !requestedCanonical || event.status !== "published" || event.hidden || event.archivedAt) return err(res, { status: 404, error: "discussion_unavailable" }), true;
    const publicDto = (d: import("./types").DiscussionRecord) => ({ id:d.id, kind:d.kind, parentId:d.parentId, occurrenceId:d.occurrenceId, eventId:d.eventId, cityId:d.cityId, title:d.title, body:d.body, authorId:d.authorId, createdAt:d.createdAt, updatedAt:d.updatedAt });
    // Discussion reads are private to verified participants; this is not a public forum.
    const sess = requireSession(db, cookies); if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const account = db.getAccount(sess.accountId);
    const attendance = account && db.listAttendance(account.id).some(a => (a.role === "rsvp" || a.role === "host") && sameEventId(a.eventId, event.id) && a.occurrenceId === requestedCanonical);
    if (!account || account.deletedAt || account.status !== "verified" || !attendance || account.cityId !== event.cityId) return err(res, { status: 403, error: "participant_required" }), true;
    if (method === "GET") return ok(res, { discussion: db.listDiscussions(requestedCanonical).map(publicDto) }), true;
    if (account.suspended && (!account.suspendedUntil || new Date(account.suspendedUntil) > now)) return err(res, { status: 403, error: "suspended" }), true;
    if (!db.consumeDiscussionRate(account.id, now.getTime())) return err(res, { status: 429, error: "rate_limited" }), true;
    if (method === "DELETE") {
      const target = db.getDiscussion(decodeURIComponent(discussionPath[3] ?? ""));
      if (!target || target.authorId !== account.id || target.occurrenceId !== requestedCanonical || target.state === "deleted") return err(res, { status: 404, error: "not_found" }), true;
      db.updateDiscussion(target.id, { state: "deleted", body: "", title: null }); await db.persist(); return ok(res, { deleted: true }), true;
    }

    if (method === "PATCH") {
      // Author edit of a discussion thread/comment: author-only (404 for anyone
      // else), same occurrence, same city/participant gate already enforced
      // above. Body re-validated (1-1000), thread title 1-120, updatedAt
      // stamped by the store, audited as discussion.edit.
      const target = db.getDiscussion(decodeURIComponent(discussionPath[3] ?? ""));
      if (!target || target.authorId !== account.id || target.occurrenceId !== requestedCanonical || target.state === "deleted") return err(res, { status: 404, error: "not_found" }), true;
      const b = await readJson(req) as Record<string, unknown>;
      const body = typeof b.body === "string" ? b.body.trim() : "";
      const title = typeof b.title === "string" ? b.title.trim() : target.title;
      if (!body || body.length > 1000 || (title !== null && (!title || title.length > 120))) return err(res, { status: 400, error: "invalid_discussion" }), true;
      const updated = db.updateDiscussion(target.id, { body: body.slice(0, 1000), title: title ? title.slice(0, 120) : target.title })!;
      db.appendAudit({ admin: account.email, action: "discussion.edit", reason: "Author edited their run-day discussion", targetId: target.id, ip: "member-action", cityId: target.cityId, owner: account.email, change: `discussion edited by author (${body.length} chars)` }, now);
      await db.persist(); return ok(res, { discussion: publicDto(updated) }), true;
    }
    const b = await readJson(req) as Record<string, unknown>;
    const body = typeof b.body === "string" ? b.body.trim() : "";
    const title = typeof b.title === "string" ? b.title.trim() : null;
    const parentId = typeof b.parentId === "string" ? b.parentId : null;
    if (!body || body.length > 1000 || (title !== null && (!title || title.length > 120)) || (parentId && (!db.getDiscussion(parentId) || db.getDiscussion(parentId)?.occurrenceId !== requestedCanonical))) return err(res, { status: 400, error: "invalid_discussion" }), true;
    const kind = parentId ? "comment" : "thread";
    if (kind === "thread" && title === null) return err(res, { status: 400, error: "title_required" }), true;
    const record: import("./types").DiscussionRecord = { id:newId(), kind, parentId, occurrenceId:requestedCanonical, eventId:event.id, cityId:event.cityId, authorId:account.id, title:title ? title.slice(0,120) : null, body:body.slice(0,1000), state:"visible", createdAt:now.toISOString(), updatedAt:now.toISOString() };
    db.addDiscussion(record);
    const recipients = new Set(db.listDiscussions(requestedCanonical).filter(d => d.authorId !== account.id && !db.isBlocked(account.id,d.authorId)).map(d => d.authorId));
    if (parentId) { const parent=db.getDiscussion(parentId); if(parent && parent.authorId !== account.id && !db.isBlocked(account.id,parent.authorId)) recipients.add(parent.authorId); }
    for (const recipient of recipients) if (db.getNotificationPreferences(recipient).community_updates) db.addNotification({id:newId(),accountId:recipient,category:"community_updates",title:"New run-day discussion activity",body:"Someone added to a run you joined.",createdAt:now.toISOString(),readAt:null,link:{kind:"event",id:event.id}});
    await db.persist(); return ok(res, { discussion: publicDto(record) }), true;
  }

  // ---- RSVP to an event occurrence (server-validated schedule) ------------
  if (url.pathname === "/api/events/rsvp" && method === "POST") {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    const rec = db.getAccount(s.accountId); if (!rec || rec.deletedAt || rec.status !== "verified") return err(res, { status: 403, error: "verified_runner_required" }), true;
    /*
     * A FACE BEFORE YOUR NAME GOES ON A LIST, and the gate is HERE rather than
     * at signup deliberately.
     *
     * Signup is friction at the worst moment — the person has not seen the
     * product yet and every field is a reason to stop. The first RSVP is when
     * it starts to matter: that is the moment your name appears on a list other
     * people read while deciding whether to come.
     *
     * Satisfied by EITHER a photo or a chosen avatar. Requiring a photograph
     * would push people toward lying or leaving, and on a product that
     * publishes where you will be at dawn, "not my face" is a reasonable
     * position rather than an edge case.
     */
    if (!rec.profilePhotoRef && !rec.avatarStyle) {
      return err(res, {
        status: 428,
        error: "avatar_required",
        message: "Pick a photo or an avatar before your first RSVP — your name goes on a list other runners read.",
      }), true;
    }
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
      // Occurrence id surfaces in DISPLAY space (seed events expose the seed
      // ref) so the client's local state matches what My Runs / the feed show.
      return ok(res, { rsvped: true, occurrenceId: occ.event ? publicOccurrenceId(occ.event, occ.eventId, occ.runDate) : occ.occurrenceId, runDate:occ.runDate, startsAt:occ.startsAt }), true;
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
      const rowEvent = row.occurrenceId && row.runDate ? db.listEvents().find((e) => e.id === row.eventId || e.seedRefId === row.eventId.replace(/^event:/, "")) : undefined;
      return ok(res, { rsvped: false, occurrenceId: row.occurrenceId && row.runDate ? (rowEvent ? publicOccurrenceId(rowEvent, row.eventId, row.runDate) : row.occurrenceId) : (row.occurrenceId ?? null), runDate: row.runDate ?? null, startsAt: row.startsAt ?? null }), true;
    }
    const occ = resolveOccurrence(db, requestedId, date);
    if (!occ) return err(res, { status: 400, error: "invalid_occurrence", message: "That date is not a scheduled occurrence of this event." }), true;
    const mine = db.listAttendance(s.accountId).filter(a => a.role === "rsvp" && sameEventId(a.eventId, occ.eventId) && a.occurrenceId === occ.occurrenceId);
    for (const a of mine) db.removeAttendance(a.id);
    if (mine.length) await db.persist();
    return ok(res, { rsvped: false, occurrenceId: occ.event ? publicOccurrenceId(occ.event, occ.eventId, occ.runDate) : occ.occurrenceId, runDate: occ.runDate, startsAt: occ.startsAt }), true;
  }
  /*
   * GET /api/occurrences/:id/attendees — the full VISIBLE list for one run.
   *
   * The board caps attendees at four server-side, which is right for a card and
   * wrong for the one question the safety architecture is actually about: she
   * is looking at Saturday, deciding whether to go, and needs to know whether
   * he is on the list. "and 8 others" that cannot be opened is a wall in front
   * of exactly the thing she is checking for.
   *
   * EXPANDING IS SAFE BECAUSE OF hiddenFrom, not despite the cap. The fixed-cap
   * rule exists to stop the list length revealing HOW MANY people are hiding;
   * it is not a limit on how many names a member may see. Anyone hidden from
   * this viewer — blocked, deleted, suspended, and in future anyone who chose
   * invisible attendance — is absent from the list AND from its length, so
   * expanding reveals nothing the cap was protecting.
   *
   * The COUNT deliberately still comes from the summary endpoint, unfiltered.
   * If this list's length were used as the count, a blocked person would see a
   * smaller number than everyone else and the block would be readable.
   */
  /** Shared by the summary and the full list, so the two cannot render a name differently. */
  const initialsFor = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  const occAttendees = /^\/api\/occurrences\/([^/]+)\/attendees$/.exec(url.pathname);
  if (method === "GET" && occAttendees) {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const occurrenceId = decodeURIComponent(occAttendees[1]);
    const hidden = hiddenFrom(db, sess.accountId);
    const people = db
      .listAttendance()
      // role "rsvp" is a goer; "host" is handled by the card separately. The
      // deletedAt check matters: archived rows are preserved for audit and must
      // not resurface as attendees.
      .filter((a) => a.occurrenceId === occurrenceId && a.role === "rsvp" && !a.deletedAt && !hidden.has(a.accountId))
      .map((a) => db.getAccount(a.accountId))
      .filter((acc): acc is NonNullable<typeof acc> => Boolean(acc))
      .map((acc) => ({ id: acc.id, name: acc.name, initials: initialsFor(acc.name), isHost: false }));
    return ok(res, { attendees: people }), true;
  }

  // POST /api/events/attendance-summary — bulk per-occurrence host/attendee/goingCount,
  // capped to 4 attendees server-side, for a whole week's board in one call instead of
  // one request per card. Body: { occurrenceIds: string[] } (capped to 100 per call).
  // ---- Product feedback (roadmap 0.7) -------------------------------------
  // POST /api/feedback — anyone (signed in or not) can report. Everything is
  // stored; only "broken" emails immediately, because a notification that
  // fires for praise and ideas trains the owner to ignore it within a week.
  if (url.pathname === "/api/feedback" && method === "POST") {
    const sess = requireSession(db, cookies);
    const b = (await readJson(req)) as Record<string, unknown>;
    const CATEGORIES = ["broken", "confusing", "idea", "praise"] as const;
    const category = typeof b.category === "string" && (CATEGORIES as readonly string[]).includes(b.category)
      ? (b.category as typeof CATEGORIES[number]) : null;
    const message = typeof b.message === "string" ? b.message.trim().slice(0, 2000) : "";
    if (!category) return err(res, { status: 400, error: "invalid_category" }), true;
    if (!message) return err(res, { status: 400, error: "message_required", message: "Tell us a little about what happened." }), true;

    const account = sess ? db.getAccount(sess.accountId) : undefined;
    const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    const record: import("./types").FeedbackRecord = {
      id: `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      accountId: account?.id ?? null,
      category,
      message,
      path: str(b.path, 200) ?? "/",
      role: str(b.role, 40),
      userAgent: str(req.headers["user-agent"], 300) ?? "",
      viewport: str(b.viewport, 20),
      appVersion: str(b.appVersion, 60),
      recentActions: Array.isArray(b.recentActions)
        ? b.recentActions.filter((a): a is string => typeof a === "string").slice(-3).map((a) => a.slice(0, 120))
        : [],
      onScreenError: str(b.onScreenError, 300),
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    db.addFeedback(record);
    await db.persist();

    if (category === "broken") {
      const reporter = account?.name ?? "Anonymous";
      const rows: [string, string][] = [
        ["Route", record.path],
        ["Reporter", account ? `${account.name} (${account.email})` : "Signed out"],
        ["Role", record.role ?? "—"],
        ["Device", record.userAgent],
        ["Viewport", record.viewport ?? "—"],
        ["App version", record.appVersion ?? "—"],
        ["Last actions", record.recentActions.length ? record.recentActions.join(" → ") : "—"],
        ["Error on screen", record.onScreenError ?? "—"],
      ];
      const esc = (v: string) => v.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
      void sendEmail({
        // feedback@getkimbio.com, not the owner's personal address. Google
        // Workspace now delivers it, and a role address means the destination
        // survives the owner changing address or someone else triaging.
        // FEEDBACK_INBOX overrides it for a non-production environment, where
        // sending to the real inbox would pollute a live queue with test data.
        to: process.env.FEEDBACK_INBOX?.trim() || "feedback@getkimbio.com",
        from: "Kimbio Feedback <feedback@getkimbio.com>",
        // Reply-To is the whole loop for a small beta: answer the tester from a
        // mail client without opening the app. Receiving is disabled on the
        // domain, so the From address can never be a destination.
        ...(account?.email ? { replyTo: account.email } : {}),
        // Route and category in the subject so the inbox list alone is triageable.
        subject: `[Kimbio] Broken — ${record.path} — ${reporter}`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#14171C;max-width:600px;">
<p style="font-size:16px;line-height:1.6;white-space:pre-wrap;border-left:3px solid #FF5741;padding-left:12px;margin:0 0 20px;">${esc(record.message)}</p>
<table cellpadding="6" cellspacing="0" style="font-size:13px;border-collapse:collapse;">
${rows.map(([k, v]) => `<tr><td style="color:#5b5f66;vertical-align:top;">${k}</td><td style="font-family:monospace;">${esc(v)}</td></tr>`).join("")}
</table></div>`,
      });
    }
    return ok(res, { id: record.id }), true;
  }

  // GET /api/feedback — owner/admin only. The table is the record; this is what
  // the unified queue (1.6) will read.
  if (url.pathname === "/api/feedback" && method === "GET") {
    const sess = requireSession(db, cookies);
    if (!sess) return err(res, { status: 401, error: "sign_in_required" }), true;
    const account = db.getAccount(sess.accountId);
    if (!account || !isOwnerEmail(account.email)) return err(res, { status: 403, error: "forbidden" }), true;
    const unresolvedOnly = url.searchParams.get("unresolved") === "1";
    return ok(res, { feedback: db.listFeedback({ unresolvedOnly }) }), true;
  }

  // GET /api/events/public-summary?ids=a,b,c — going COUNTS only, no auth.
  //
  // Exists because the marketing preview must prove the community is real, and
  // a stranger seeing three runs with "0 going" would disprove it — worse than
  // showing no runs at all. The authenticated attendance-summary endpoint can't
  // serve this: it returns names and initials, which must never reach an
  // anonymous visitor (D2, and "private by default" is claimed on this very
  // page).
  //
  // Deliberately returns nothing but the count. Not names, not initials, not
  // avatars, not even the number of hosts — a count cannot identify anyone.
  // Cached because every marketing view and every crawler hit lands here.
  if (url.pathname === "/api/events/public-summary" && method === "GET") {
    const ids = (url.searchParams.get("ids") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
    const counts: Record<string, number> = {};
    if (ids.length > 0) {
      const wanted = new Set(ids);
      for (const a of db.listAttendance()) {
        if (!a.occurrenceId || !wanted.has(a.occurrenceId) || a.role === "host") continue;
        counts[a.occurrenceId] = (counts[a.occurrenceId] ?? 0) + 1;
      }
    }
    res.writeHead(200, {
      "content-type": "application/json",
      // Short TTL: fresh enough that a new RSVP shows up quickly, long enough
      // that a crawl or a burst of marketing views doesn't recount every time.
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    });
    res.end(JSON.stringify({ summaries: ids.map((eventId) => ({ eventId, goingCount: counts[eventId] ?? 0 })) }));
    return true;
  }

  if (url.pathname === "/api/events/attendance-summary" && method === "POST") {
    const s = requireSession(db, cookies); if (!s) return err(res, { status: 401, error: "sign_in_required" }), true;
    const b = (await readJson(req)) as { occurrenceIds?: unknown };
    const ids = Array.isArray(b.occurrenceIds) ? b.occurrenceIds.filter((x): x is string => typeof x === "string").slice(0, 100) : [];
    const idSet = new Set(ids);
    // Once per request. A week's board across 40 attendees would otherwise run
    // 40 block lookups, and that cost is what makes people skip the check.
    const hidden = hiddenFrom(db, s.accountId);
    const byOccurrence = new Map<string, { hostAccountId: string | null; goingAccountIds: string[] }>();
    for (const a of db.listAttendance()) {
      if (!a.occurrenceId || !idSet.has(a.occurrenceId)) continue;
      const bucket = byOccurrence.get(a.occurrenceId) ?? { hostAccountId: null, goingAccountIds: [] };
      if (a.role === "host") bucket.hostAccountId = a.accountId;
      else bucket.goingAccountIds.push(a.accountId);
      byOccurrence.set(a.occurrenceId, bucket);
    }
    const summaries: Record<string, { host: { accountId: string; name: string; initials: string } | null; attendees: { accountId: string; name: string; initials: string; runsWithYou: number }[]; goingCount: number; discussionCount: number; lastDiscussionAt: string | null }> = {};
    for (const id of ids) {
      const bucket = byOccurrence.get(id) ?? { hostAccountId: null, goingAccountIds: [] };
      const hostAccount = bucket.hostAccountId ? db.getAccount(bucket.hostAccountId) : undefined;
      /*
       * The host is an identity too. It already excluded deleted accounts —
       * hiddenFrom covers that case AND blocked AND suspended, so the three
       * stop being three separate conditions someone has to remember.
       *
       * A hidden host renders as null, which the card already handles: it is
       * the same state as a run with no host recorded. The run still appears
       * and the count is unchanged — only the name goes.
       */
      const host = hostAccount && !hidden.has(hostAccount.id) ? { accountId: hostAccount.id, name: hostAccount.name, initials: initialsFor(hostAccount.name) } : null;
      /*
       * IDENTITIES FILTERED, COUNT UNTOUCHED — and the existing shape makes
       * that safe rather than delicate.
       *
       * goingCount comes from goingAccountIds.length (the FULL list) while
       * attendees is .slice(0, 4). So the count was already independent of the
       * names shown, and filtering identities cannot move it: he sees the same
       * "12 going" everyone else does, with her name absent from the four.
       *
       * That is the fixed-cap property arriving for free. The gap between 12
       * and 4 is explained by the cap, identically whether anyone is hidden or
       * not — which is exactly why the count must NOT be derived from the
       * filtered list, and why this filter sits after .length is taken.
       */
      /*
       * SORTED BY WHO YOU HAVE RUN WITH, so the four names shown are the four
       * you know rather than the first four in insertion order.
       *
       * That is the difference between a headcount and a reason to go, and the
       * card is the exact moment someone decides. "12 going" is a number;
       * "Casey, Jordan and 10 others" is people.
       *
       * The cap does not move and neither does the count — this reorders WHICH
       * names fill the four, nothing else. Ties keep insertion order, so a
       * viewer with no shared history sees exactly what they saw before.
       */
      const coAttendance = coAttendanceForOccurrence(db, s.accountId, bucket.goingAccountIds);
      const attendees = withoutHidden(bucket.goingAccountIds.map((id) => ({ id })), hidden, (r) => r.id).map((r) => r.id)
        .sort((a, b) => (coAttendance.get(b) ?? 0) - (coAttendance.get(a) ?? 0))
        .map((accountId) => db.getAccount(accountId))
        .filter((a): a is import("./types").AccountRecord => !!a && !a.deletedAt)
        .slice(0, 4)
        .map((a) => ({
          accountId: a.id,
          name: a.name,
          initials: initialsFor(a.name),
          /*
           * Viewer-scoped and never public — the number means nothing without
           * knowing who is asking. Zero is sent as zero rather than omitted so
           * the client does not have to distinguish "no history" from "not
           * computed".
           */
          runsWithYou: coAttendance.get(a.id) ?? 0,
        }));
      /*
       * DISCUSSION ACTIVITY, BEFORE COMMITTING.
       *
       * The run-day discussion exists and is invisible until you have RSVP'd —
       * so the thing that makes a run feel alive sits behind the decision it
       * should inform. "3 messages today" is what tells you people are actually
       * turning up.
       *
       * METADATA ONLY. The count and the last-message time; no author, no
       * body, no identity. Content stays gated exactly as it is now — this
       * changes what you can see ABOUT the conversation, not what is in it.
       *
       * A count is not an identity surface: it says a run is active, not who
       * is on it.
       */
      const discussions = db.listDiscussions(id);
      const lastAt = discussions.reduce((acc, d) => (d.createdAt > acc ? d.createdAt : acc), "");
      summaries[id] = {
        host,
        attendees,
        goingCount: bucket.goingAccountIds.length,
        discussionCount: discussions.length,
        lastDiscussionAt: lastAt || null,
      };
    }
    return ok(res, { summaries }), true;
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
    db.addSafetyReport(report);
    /*
     * EMAIL, NOT A BADGE. The architecture doc is explicit and it is right: a
     * report that waits for someone to open /admin is a report nobody read, and
     * the form implies otherwise. A badge is something you see if you are
     * already looking; the person who needs to act is asleep.
     *
     * Deliberately CONTENT-FREE. The reason text is not in the email — it is
     * frequently the most sensitive thing anyone will type into Kimbio, and
     * mail lands in inboxes, on lock screens, and in whatever a client caches.
     * Subject says a report exists; the queue says what it is.
     *
     * Fire-and-forget: a mail failure must not fail the report. Losing the
     * record would be far worse than losing the alert.
     */
    const safetyOwner = db.getAccountByEmail(ownerEmail());
    void sendEmail({
      to: ownerEmail(),
      subject: "Safety report filed on Kimbio",
      html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#14171C;line-height:1.6;max-width:520px;">
<p style="font-size:16px;"><strong>A safety report was filed.</strong></p>
<p style="font-size:15px;">Filed ${new Date(report.createdAt).toISOString()}. The details are in the admin queue — they are deliberately not included here.</p>
<p style="font-size:15px;"><a href="https://getkimbio.com/admin#safety">Open the safety queue</a></p>
</div>`,
    }).catch(() => {});
    if (safetyOwner) {
      db.addNotification({
        id: newId(), accountId: safetyOwner.id, category: "account_alerts",
        title: "Safety report filed",
        body: "A safety report needs review.",
        createdAt: now.toISOString(), readAt: null, link: null,
      });
    }
    await db.persist(); return ok(res, { report: { id: report.id, status: report.status } }), true;
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

  // ---- sponsors: admin routes (public GET /api/sponsors lives earlier, no ctx needed there) ----
  if (method === "GET" && url.pathname === "/api/admin/sponsors") {
    const cityId = url.searchParams.get("city") ?? "columbia-mo";
    const result = listAdminSponsors(db, ctx, cityId, now);
    if (!result.ok) return sendErr(result), true;
    return ok(res, result.data), true;
  }
  if (method === "POST" && url.pathname === "/api/admin/sponsors") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const result = createSponsor(db, ctx, body, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, result.data), true;
  }
  const sponsorPatch = /^\/api\/admin\/sponsors\/([^/]+)$/.exec(url.pathname);
  if (sponsorPatch && method === "PATCH") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const result = updateSponsor(db, ctx, decodeURIComponent(sponsorPatch[1]), body, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, result.data), true;
  }
  if (sponsorPatch && method === "DELETE") {
    const result = deleteSponsor(db, ctx, decodeURIComponent(sponsorPatch[1]), now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, result.data), true;
  }
  // POST /api/admin/sponsors/logo — uploads a logo image, returns a ref to
  // pass as logoRef on create/update. Kept as its own step so a failed image
  // upload never corrupts an otherwise-valid sponsor record.
  if (method === "POST" && url.pathname === "/api/admin/sponsors/logo") {
    const auth = authorizeAdmin(db, ctx, "admin.sponsor_create", null, now);
    if (!auth.ok) return sendErr(auth), true;
    const body = (await readJson(req)) as { photo?: unknown };
    if (typeof body.photo !== "string") return err(res, { status: 400, error: "invalid_image" }), true;
    const img = decodeImage(body.photo, 64);
    if (!img.ok) return err(res, { status: 400, error: img.error }), true;
    const filename = `sponsor_${newId()}.${img.ext}`;
    await db.writePublicUpload(filename, img.bytes);
    return ok(res, { logoRef: filename }), true;
  }

  // ---- geofence allowlist: specific emails exempt from the 20-mile radius ----
  if (method === "GET" && url.pathname === "/api/admin/geofence-allowlist") {
    const auth = authorizeAdmin(db, ctx, "admin.geofence_allowlist_add", null, now);
    if (!auth.ok) return sendErr(auth), true;
    return ok(res, { emails: db.listGeofenceAllowlist() }), true;
  }
  if (method === "POST" && url.pathname === "/api/admin/geofence-allowlist") {
    const auth = authorizeAdmin(db, ctx, "admin.geofence_allowlist_add", null, now);
    if (!auth.ok) return sendErr(auth), true;
    const body = (await readJson(req)) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email || !email.includes("@")) return err(res, { status: 400, error: "invalid_email", message: "Enter a valid email address." }), true;
    db.addGeofenceAllowlistEmail(email);
    await db.persist();
    return ok(res, { emails: db.listGeofenceAllowlist() }), true;
  }
  const allowlistRemove = /^\/api\/admin\/geofence-allowlist\/([^/]+)$/.exec(url.pathname);
  if (allowlistRemove && method === "DELETE") {
    const auth = authorizeAdmin(db, ctx, "admin.geofence_allowlist_remove", null, now);
    if (!auth.ok) return sendErr(auth), true;
    db.removeGeofenceAllowlistEmail(decodeURIComponent(allowlistRemove[1]));
    await db.persist();
    return ok(res, { emails: db.listGeofenceAllowlist() }), true;
  }
  // GET /api/admin/sponsors/payments-status — lets the admin UI know whether
  // to show the "Generate payment link" action at all.
  if (method === "GET" && url.pathname === "/api/admin/sponsors/payments-status") {
    return ok(res, { configured: stripeConfigured() }), true;
  }
  // POST /api/admin/sponsors/checkout — generates a one-time Stripe Checkout
  // link for an already-created (inactive) sponsor record, to send to the
  // business. The record activates automatically once the webhook confirms payment.
  if (method === "POST" && url.pathname === "/api/admin/sponsors/checkout") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const result = await createSponsorCheckout(db, ctx, body, now);
    if (!result.ok) return sendErr(result), true;
    return ok(res, result.data), true;
  }

  // Idempotent repair for legacy approved submissions; owner/key admin only.
  if (method === "POST" && url.pathname === "/api/admin/city/submissions/backfill") {
    const auth = authorizeAdmin(db, ctx, "admin.submission_approve", null, now);
    if (!auth.ok) return sendErr(auth), true;
    const result = repairApprovedSubmissions(db, now);
    await db.persist();
    return ok(res, result), true;
  }

  if (method === "GET" && url.pathname === "/api/admin/cms/settings") { const a=authorizeAdmin(db,ctx,"admin.cms_settings",null,now); if(!a.ok)return sendErr(a),true; /*
   * publicCities, NOT db.listCities. listCities returns only cities written to
   * the STORE — and every city is a seed until someone edits it, so Columbia
   * was absent from the admin overview entirely. The city-status control
   * therefore had nothing to render for the one city that exists, and the only
   * way to get a city into the store was to edit it through a control that
   * could not see it.
   */
  return ok(res,{settings:publicSettings(db),cities:publicCities(db),integrations:integrations(db)}),true; }
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
  if (credentialDecision && method === "POST") { const [,id,decision]=credentialDecision; const a=authorizeAdmin(db,ctx,decision==="approve"?"admin.approve":"admin.reject",id,now);if(!a.ok)return sendErr(a),true;const b=await readJson(req) as Record<string,unknown>;if(decision==="reject"&&(typeof b.reason!=="string"||b.reason.trim().length<5))return err(res,{status:400,error:"reason_required"}),true;const c=db.updateCredential(id,{status:decision==="approve"?"verified":"rejected",verifiedBy:a.data.admin,verifiedAt:now.toISOString(),decisionReason:typeof b.reason==="string"?b.reason.trim().slice(0,500):null,updatedAt:now.toISOString()});if(!c)return err(res,{status:404,error:"not_found"}),true;if(db.getNotificationPreferences(c.accountId).account_alerts)db.addNotification({id:newId(),accountId:c.accountId,category:"account_alerts",title:decision==="approve"?"Credential approved":"Credential rejected",body:decision==="approve"?`Your ${c.type.replace(/_/g," ")} credential was verified.`:(c.decisionReason??"Your credential submission was rejected."),createdAt:now.toISOString(),readAt:null,link:{kind:"verify",id:c.accountId}});await db.persist();return ok(res,{credential:{id:c.id,status:c.status}}),true; }
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
    if (db.getNotificationPreferences(updated.accountId).account_alerts) db.addNotification({ id: newId(), accountId: updated.accountId, category: "account_alerts", title: decision === "reinstate" ? "Appeal accepted" : "Appeal decision", body: decisionReason, createdAt: now.toISOString(), readAt: null, link: { kind: "verify", id: updated.accountId } });
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

  // ---- Trusted Member (manual trust / blue-check) - Task 7 slice 1 ----
  // Grant (by email) is a Global Admin op; revoke (by id) too. City Admins
  // use the /api/admin/city/trust/* variants below - the server enforces the
  // exact scope city on every call, and no admin can ever set/clear the badge
  // on their own account. All operations are reason-required and audited.
  if (method === "POST" && url.pathname === "/api/admin/trust/grant") {
    const body = (await readJson(req)) as { email?: unknown };
    const result = grantTrustedMember(db, ctx, typeof body.email === "string" ? body.email : "", now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { member: result.data }), true;
  }
  const trustRevokeMatch = /^\/api\/admin\/trust\/([a-f0-9]{32})\/revoke\/?$/.exec(url.pathname);
  if (trustRevokeMatch && method === "POST") {
    const result = revokeTrustedMember(db, ctx, trustRevokeMatch[1], now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { member: result.data }), true;
  }
  if (method === "GET" && url.pathname === "/api/admin/trust/members") {
    const result = listTrustedMembers(db, ctx, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { members: result.data }), true;
  }
  // City Admin variants - the target's home city must equal the caller's
  // exact scope city (enforced server-side with enforceCity).
  if (method === "POST" && url.pathname === "/api/admin/city/trust/grant") {
    const body = (await readJson(req)) as { email?: unknown };
    const result = cityGrantTrustedMember(db, ctx, typeof body.email === "string" ? body.email : "", now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { member: result.data }), true;
  }
  const cityTrustRevokeMatch = /^\/api\/admin\/city\/trust\/([a-f0-9]{32})\/revoke\/?$/.exec(url.pathname);
  if (cityTrustRevokeMatch && method === "POST") {
    const result = cityRevokeTrustedMember(db, ctx, cityTrustRevokeMatch[1], now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { member: result.data }), true;
  }
  if (method === "GET" && url.pathname === "/api/admin/city/trust/members") {
    const result = cityListTrustedMembers(db, ctx, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { members: result.data }), true;
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
  // groups) and is routine: the audit entry carries the admin identity with a
  // system label when no operator reason header is sent. Reject REQUIRES the
  // audited reason header, which is stored as the submitter-visible rejection
  // reason.
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

  // POST /api/admin/records/:id/approve | reject | delete | undo_reject
  const actionMatch = /^\/api\/admin\/records\/([a-f0-9]{32})\/(approve|reject|delete|undo_reject)$/.exec(url.pathname);
  if (actionMatch && method === "POST") {
    const [, id, action] = actionMatch;
    if (action === "delete") {
      const result = adminDeleteAccount(db, ctx, id, now);
      if (!result.ok) return sendErr(result), true;
      await db.persist();
      return ok(res, { ok: true, deleted: result.data.id }), true;
    }
    if (action === "undo_reject") {
      const result = adminUndoRejection(db, ctx, id, now);
      if (!result.ok) return sendErr(result), true;
      await db.persist();
      return ok(res, { ok: true, account: toPublicAccount(result.data, isOwnerEmail(result.data.email), db) }), true;
    }
    // Role to assign on approval (owner/operator picks in the control center).
    const role = url.searchParams.get("role") === "group_leader" ? "group_leader" : "runner";
    // Rejection stores an explicit applicant-facing reason (separate from the
    // audit reason header): required, persisted on the account, shown only to
    // the applicant themselves.
    let rejectionReason: string | null = null;
    if (action === "reject") {
      const b = (await readJson(req).catch(() => null)) as Record<string, unknown> | null;
      const raw = typeof b?.reason === "string" ? b.reason.trim() : "";
      if (raw.length < 5) {
        return err(res, { status: 400, error: "reason_required", message: "A rejection reason (min 5 characters) is required — it is shown to the applicant." }), true;
      }
      rejectionReason = raw.slice(0, 500);
    }
    const result = adminSetStatus(db, ctx, id, action === "approve" ? "verified" : "rejected", now, role, rejectionReason);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { ok: true, account: toPublicAccount(result.data, isOwnerEmail(result.data.email), db) }), true;
  }

  // GET /api/admin/export.csv?q=
  // GET /api/admin/purge-preview — owner-only, shows exactly who would be
  // deleted without deleting anything.
  if (method === "GET" && url.pathname === "/api/admin/purge-preview") {
    const result = adminPurgePreview(db, ctx, now);
    if (!result.ok) return sendErr(result), true;
    return ok(res, result.data), true;
  }
  // POST /api/admin/purge-all — owner-only, irreversible. Requires the
  // literal confirmation string and the expected count to still match at
  // execution time (see adminPurgeAllExceptOwner for the full safety gate).
  if (method === "POST" && url.pathname === "/api/admin/purge-all") {
    const body = (await readJson(req)) as { confirmText?: unknown; expectedCount?: unknown };
    const confirmText = typeof body.confirmText === "string" ? body.confirmText : "";
    const expectedCount = typeof body.expectedCount === "number" ? body.expectedCount : -1;
    const result = adminPurgeAllExceptOwner(db, ctx, confirmText, expectedCount, now);
    if (!result.ok) return sendErr(result), true;
    return ok(res, result.data), true;
  }

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
  // PATCH /api/admin/accounts/:id/roles — audited multi-role assignment
  // (set semantics: the body carries the FULL desired role set + optional
  // city scope for city_admin). Global Admin: any role incl. site_admin.
  // City Admin: group_leader toggles only, own city only.
  const rolesMatch = /^\/api\/admin\/accounts\/([a-f0-9]{32})\/roles\/?$/.exec(url.pathname);
  if (rolesMatch && method === "PATCH") {
    const body = (await readJson(req)) as { roles?: unknown; cityId?: unknown };
    const result = assignAccountRoles(db, ctx, rolesMatch[1], body, now);
    if (!result.ok) return sendErr(result), true;
    await db.persist();
    return ok(res, { account: result.data }), true;
  }

  // ---- Global Admin: city invitations (audited; token shown once) ---------
  /*
   * GET /api/admin/waitlist — owner only.
   *
   * listWaitlist() existed in the store from part 1 with no HTTP route, so
   * entries landed on the Railway volume and could not be looked at. A
   * write-only list is worse than none: it invites an ad campaign against a
   * bucket nobody can open.
   *
   * Routed through authorizeAdmin with admin.waitlist_list, which is on the
   * NO-REASON side — reading your own waitlist is not moderation, and gating
   * it is exactly how revoke and minting both silently 400'd.
   */
  if (method === "GET" && url.pathname === "/api/admin/waitlist") {
    const auth = authorizeAdmin(db, ctx, "admin.waitlist_list", null, now);
    if (!auth.ok) return sendErr(auth), true;
    const entries = db.listWaitlist();
    return ok(res, { entries, total: entries.length }), true;
  }

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
