import { errorCopy } from "./errorCopy";
import { getStoredUtm } from "./analytics";
/**
 * Typed client for the Kimbio API (/api/*, same origin).
 *
 * All calls return explicit discriminated results — the UI never has to guess
 * whether the backend is configured. No verification data is stored
 * client-side; sessions are HttpOnly cookies set by the server.
 */
import { reportErrorShown } from "./friction";
import { trackFirstRsvpOnce } from "./telemetry";
import type { Me, OpRole } from "./accounts";
import { normalizeErrorCode, normalizeErrorMessage } from "./errors";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    /*
     * THE ONE LINE THAT LEAKED CODES TO USERS. This was `message ?? code`, so
     * any of the server's 189 codes without an explicit message printed its own
     * name — a signed-out visitor on /groups saw a pink box reading
     * `sign_in_required`.
     *
     * Fixed here rather than at the 47 places that render an error, because a
     * chokepoint covers a code added tomorrow without touching a page. Pages
     * convert to richer, action-bearing states as they are touched; this
     * guarantees none of them can print machine output in the meantime.
     */
    super(errorCopy(code, message));
  }
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      credentials: "same-origin",
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return { ok: false, error: new ApiError(502, "invalid_response", "The server returned an invalid response. Please try again.") };
    }
    if (!res.ok) {
      const b = body && typeof body === "object" ? body as { error?: unknown; message?: unknown } : {};
      const apiError = new ApiError(res.status, normalizeErrorCode(b.error), normalizeErrorMessage(b.message, normalizeErrorMessage(b.error)));
      // FRICTION signal. Instrumented here rather than at each call site
      // because this is the one chokepoint every server error passes through;
      // the toast layer can't be used for this since its tones don't
      // distinguish a real failure from a neutral notice. Records the code and
      // endpoint only - never the response body, which can contain user content.
      reportApiFailure(apiError.code, apiError.status, path);
      return { ok: false, error: apiError };
    }
    return { ok: true, data: body as T };
  } catch (e) {
    /*
     * THREE BRANCHES, not one.
     *
     * This said "Check your connection" for anything that threw — including a
     * server that had responded perfectly well. That is the third time a
     * fallback has hidden a real status, after error codes reaching users and
     * the "hidden or archived" discussion copy, and it is the most misleading
     * of the three: it sends someone to check their wifi while the actual
     * answer was a 400 with a reason.
     *
     * 1. No response at all — fetch itself rejected. ONLY this may mention the
     *    connection.
     * 2. A response arrived and something downstream threw (a JSON parse on an
     *    HTML error page, most likely). Report the status, which is the thing
     *    that identifies it.
     * 3. Anything else — a genuine bug in this layer, said plainly rather than
     *    blamed on the network.
     */
    const failedToFetch = e instanceof TypeError;
    if (failedToFetch) {
      reportApiFailure("network_error", 0, path);
      return {
        ok: false,
        error: new ApiError(0, "network_error", "Could not reach Kimbio. Check your connection and try again."),
      };
    }
    const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : 0;
    reportApiFailure("unexpected_response", status, path);
    return {
      ok: false,
      error: new ApiError(
        status,
        "unexpected_response",
        status > 0
          ? `The server replied with an unexpected error (${status}). Please try again.`
          : "Something went wrong handling the response. Please try again.",
      ),
    };
  }
}

/**
 * Fire-and-forget FRICTION reporting. Dynamically imported so this module
 * stays usable in non-browser test contexts and so a declining user never
 * loads the telemetry path at all. Never throws and never blocks the request.
 */
function reportApiFailure(code: string, status: number, path: string): void {
  try {
    reportErrorShown(`${code} (${status})`, { code, path });
  } catch {
    // instrumentation must never affect the request result
  }
}

// ------------------------------------------------------- username availability
export interface UsernameAvailability {
  valid: boolean;
  available: boolean;
}

/**
 * Validate the availability payload instead of treating an unexpected 2xx body
 * as "taken". A stale proxy/server can return the SPA HTML with a 200, and a
 * malformed payload must leave signup in the explicit error state.
 */
export function normalizeUsernameAvailabilityResponse(body: unknown): ApiResult<UsernameAvailability> {
  if (body && typeof body === "object") {
    const candidate = body as { valid?: unknown; available?: unknown };
    if (typeof candidate.valid === "boolean" && typeof candidate.available === "boolean") {
      return { ok: true, data: { valid: candidate.valid, available: candidate.available } };
    }
  }
  return { ok: false, error: new ApiError(502, "invalid_response", "The server returned an invalid username availability response.") };
}

export async function checkUsernameAvailability(username: string): Promise<ApiResult<UsernameAvailability>> {
  const result = await request<unknown>(`/api/username/availability?username=${encodeURIComponent(username)}`);
  return result.ok ? normalizeUsernameAvailabilityResponse(result.data) : result;
}

export type NotificationPreferences = { run_reminders:boolean; community_updates:boolean; account_alerts:boolean; messages?:boolean; };
export type NotificationLink = { kind: "conversation" | "verify" | "group_manage" | "event" | "forum_post"; id: string };
export type InAppNotification = { id:string; category:keyof NotificationPreferences; title:string; body:string; createdAt:string; readAt:string|null; link?: NotificationLink | null };
export const getNotificationPreferences = () => request<{preferences: NotificationPreferences}>("/api/notifications/preferences");
export const updateNotificationPreferences = (patch: Partial<NotificationPreferences>) => request<{preferences: NotificationPreferences}>("/api/notifications/preferences", {method:"PATCH", body:JSON.stringify(patch)});
export const getNotifications = () => request<{notifications:InAppNotification[]; unreadCount:number}>("/api/notifications");
export const markNotificationRead = (id:string) => request<{status:string}>(`/api/notifications/${encodeURIComponent(id)}/read`, {method:"POST"});
export const markAllNotificationsRead = () => request<{status:string}>("/api/notifications/read-all", {method:"POST"});

// ------------------------------------------------------------------ health
export interface HealthInfo {
  ok: true;
  /** Supabase email verification provider configured (browser-safe env vars present). */
  supabaseConfigured: boolean;
  /** Names of missing provider vars only — never values, never secrets. */
  supabaseMissing: string[];
  /** Whether VITE_AUTH_REDIRECT_URL was explicitly supplied at startup. */
  authRedirectConfigured: boolean;
  adminConfigured: boolean;
  retentionYears: number;
  retention: { retentionYears: number; eligibleForPurge: number; totalAccounts: number };
}
export function getHealth(): Promise<ApiResult<HealthInfo>> {
  return request<HealthInfo>("/api/health");
}

// ---------------------------------------------------------------------- me
export function getMe(): Promise<ApiResult<Me>> {
  return request<Me>("/api/me");
}

// ---------------------------------------------------------------- accounts
export function normalizeAccountResponse(body: unknown): ApiResult<{ account: import("./accounts").PublicAccount }> {
  if (body && typeof body === "object" && "account" in body && body.account && typeof body.account === "object") {
    return { ok: true, data: body as { account: import("./accounts").PublicAccount } };
  }
  return { ok: false, error: new ApiError(502, "invalid_response", "The server returned an invalid account response. Please try again.") };
}
export async function createAccount(input: { name: string; username: string; email: string; phone?: string; birthdate: string; cityId: string; requestedRole?: "runner" | "group_leader"; noSession?: boolean; utm_source?: string; utm_medium?: string; utm_campaign?: string;
  /**
   * Required when the city is invite_only. The server has validated this since
   * the gate was written; the client never sent it, so flipping a city to
   * invite_only would have closed signup to EVERYONE, invited or not.
   */
  invitationToken?: string }): Promise<ApiResult<{ account: import("./accounts").PublicAccount }>> {
  const result = await request<unknown>("/api/accounts", { method: "POST", body: JSON.stringify(input) });
  return result.ok ? normalizeAccountResponse(result.data) : result;
}

/** Set or change the signed-in user's unique public handle (server-normalized). */
export function setUsername(username: string): Promise<ApiResult<{ account: import("./accounts").PublicAccount }>> {
  return request("/api/profile/username", { method: "POST", body: JSON.stringify({ username }) });
}

/** Set or change the signed-in user's home city (server-validated against known city entities). */
export function setHomeCity(cityId: string): Promise<ApiResult<{ account: import("./accounts").PublicAccount }>> {
  return request("/api/profile/city", { method: "POST", body: JSON.stringify({ cityId }) });
}

export function uploadProfilePhoto(photoDataUrl: string): Promise<ApiResult<{ photoUrl: string }>> {
  return request("/api/profile/photo", { method: "POST", body: JSON.stringify({ photo: photoDataUrl }) });
}
export function uploadGroupPhoto(photoDataUrl: string): Promise<ApiResult<{ photoRef: string }>> {
  return request("/api/group/photo", { method: "POST", body: JSON.stringify({ photo: photoDataUrl }) });
}

// -------------------------------------------------------------- verification
/**
 * Request a Supabase email verification (the server gates the request; the client then
 * calls the Supabase adapter's sendOtp to actually trigger delivery).
 */
export function requestOtp(): Promise<ApiResult<{ status: string; resendInSec: number }>> {
  return request("/api/verify/start", { method: "POST", body: JSON.stringify({}) });
}

/**
 * Submit the Supabase access token obtained from a successful verification code call.
 * The server validates it against Supabase before linking the identity.
 */
export function confirmEmailOtp(token: string): Promise<ApiResult<{ status: string; next: string }>> {
  return request("/api/verify/check", { method: "POST", body: JSON.stringify({ token }) });
}

export function submitSelfie(photoDataUrl: string): Promise<ApiResult<{ status: string; message: string }>> {
  return request("/api/verify/selfie", { method: "POST", body: JSON.stringify({ photo: photoDataUrl }) });
}

// ------------------------------------------------------------------ session
export function logout(): Promise<ApiResult<{ status: string }>> {
  return request("/api/logout", { method: "POST" });
}

export function deleteAccount(): Promise<ApiResult<{ status: string }>> {
  return request("/api/account/delete", { method: "POST" });
}

// ------------------------------------------------------------ email sign-in
export function loginStart(email: string): Promise<ApiResult<{ status: string; resendInSec: number }>> {
  return request("/api/login/start", { method: "POST", body: JSON.stringify({ email }) });
}

export function loginCheck(token: string): Promise<ApiResult<{ status: string; account: import("./accounts").PublicAccount }>> {
  return request("/api/login/check", { method: "POST", body: JSON.stringify({ token }) });
}

// ---------------------------------------------------------------- CMS / site configuration
export interface SiteSettingsView {
  title: string;
  wordmark: string;
  tagline: string;
  primary: string;
  accent: string;
  surface: string;
  strings: Record<string, string>;
  tags: Record<string, string[]>;
  providers: Record<string, boolean>;
  bottomNav: string[];
  announcement: { text: string; link?: string } | null;
  logoRef: string | null;
  faviconRef: string | null;
}
export interface SiteConfig { settings: SiteSettingsView; cities: Array<{id:string;name:string;state:string;slug:string;status:string;headerImageRef:string|null;accent:string|null}>; integrations?: CmsIntegration[] }
export interface CmsIntegration {
  /** Provider id (strava/garmin/coros/suunto). */
  provider: string;
  /** CMS toggle — offered to runners on this site. */
  offered: boolean;
  /** Deployment-managed — whether server env credentials exist for OAuth. */
  configured: boolean;
  /** Names of missing env vars ONLY (never values, never secrets). */
  missing: string[];
}
export interface AdminCmsOverview { settings: SiteSettingsView; cities: SiteConfig["cities"]; integrations: CmsIntegration[] }
export function getSiteConfig(): Promise<ApiResult<SiteConfig>> { return request("/api/config"); }
export function adminCmsOverview(reason: string): Promise<ApiResult<AdminCmsOverview>> { return adminRequest("/api/admin/cms/settings", reason); }
export function adminSaveCmsSettings(settings: Partial<SiteSettingsView>, reason: string): Promise<ApiResult<{ settings: SiteSettingsView }>> { return adminRequest("/api/admin/cms/settings", reason, { method: "POST", body: JSON.stringify(settings) }); }
export function adminSaveCity(city: Record<string, unknown>, reason: string): Promise<ApiResult<{ city: SiteConfig["cities"][number] }>> { return adminRequest("/api/admin/cms/city", reason, { method: "POST", body: JSON.stringify(city) }); }
export function adminDeactivateCity(id: string, reason: string): Promise<ApiResult<{ city: SiteConfig["cities"][number] }>> { return adminRequest(`/api/admin/cms/city/${encodeURIComponent(id)}/deactivate`, reason, { method: "POST" }); }
/** Upload a CMS image (data URL) — returns an opaque ref; bytes never round-trip. */
export function adminCmsUpload(dataUrl: string, reason: string): Promise<ApiResult<{ ref: string }>> { return adminRequest("/api/admin/cms/upload", reason, { method: "POST", body: JSON.stringify({ ref: dataUrl }) }); }
/** Public URL for a ref — only serves refs referenced by the public config. */
export function cmsRefUrl(ref: string): string { return `/api/cms/refs/${encodeURIComponent(ref)}`; }
/** Audited admin-only preview URL for any stored ref. */
export function adminCmsRefUrl(ref: string): string { return `/api/admin/cms/refs/${encodeURIComponent(ref)}`; }

// -------------------------------------------------------------------- admin
export interface AdminOverview {
  scope: { kind: "global" | "city"; cityId: string | null };
  generatedAt: string;
  queues: { pendingVerification: number; pendingSubmissions: number; openSafetyReports: number; contentNeedingReview: number };
  analytics: { publishedContent: number | null; rsvpTotal: number | null; generatedAt: string; unavailable: boolean };
}
/**
 * Routed through adminRequest so the audit header is always attached. `reason`
 * is optional because these are READS — an unexplained one is not recorded —
 * but an operator who supplies a justification should have it kept.
 */
export function adminGetOverview(reason = ""): Promise<ApiResult<AdminOverview>> {
  return adminRequest("/api/admin/overview", reason);
}

export interface AdminSearchRow {
  id: string;
  name: string;
  email: string;
  username: string | null;
  status: string;
  phase: string | null;
  phoneLast4: string | null;
  createdAt: string;
  verifiedAt: string | null;
  /** Trusted Member (manual trust / blue-check) state — display-only here. */
  trustedMember: boolean;
}

/** Owner-only pending queue row — redacted public fields only. */
export interface PendingQueueRow {
  id: string;
  name: string;
  email: string;
  phase: string;
  requestedRole: "runner" | "group_leader" | null;
  signupAt: string;
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
  /** Applicant-facing rejection reason stored at rejection (admin view). */
  rejectionReason: string | null;
  /** Set when this account was previously rejected and has since resubmitted with the same email. */
  priorRejectionReason: string | null;
  /** Home city id (admin view — used by the role editor's city scoping). */
  cityId: string | null;
  /** Full multi-role set (effective — owner-implied site_admin included). */
  roles: OpRole[];
  /** City Admin scope, when the account holds city_admin. */
  adminCityId: string | null;
  /** Server-derived owner flag — the owner can never be demoted below site_admin. */
  isOwner: boolean;
}

export interface AuditEntryView {
  id: string;
  at: string;
  admin: string;
  action: string;
  reason: string;
  targetId: string | null;
  ip: string;
}

/** Consequential admin calls attach an operator reason; routine reads use server-generated audit context. */
/**
 * Make a reason safe to put in an HTTP header.
 *
 * HTTP header values are ISO-8859-1. A single code point above 0xFF makes
 * fetch() throw SYNCHRONOUSLY, before a socket is opened — so there is no
 * request, nothing in the Network tab, and (because the throw is a TypeError)
 * request()'s catch takes the one branch allowed to blame the connection.
 *
 * That is what a `→` in "City status → invite_only" did: the handler ran, it
 * reached the fetch, and every observable symptom pointed somewhere else.
 * Confirmed live — same endpoint, same method, only the reason differing:
 * with the arrow, TypeError; with "->", 200.
 *
 * NORMALISED AT THE CHOKEPOINT rather than at that one call site, because every
 * reason box on the admin page is FREE TEXT. An operator pasting a smart quote
 * from a doc, or typing an em dash, hits the identical failure with the
 * identical misleading message. Fixing the arrow alone would leave the class.
 *
 * Numeric character references rather than stripping: the audit log should
 * record what was typed, and a reason silently missing its punctuation is a
 * worse record than one carrying an escape.
 */
export function auditReasonHeader(reason: string): string {
  return reason.replace(/[^\x20-\x7E\xA0-\xFF]/g, (c) => `&#${c.codePointAt(0)};`);
}

function adminRequest<T>(path: string, reason: string, init?: RequestInit): Promise<ApiResult<T>> {
  return request<T>(path, {
    ...init,
    headers: { "x-audit-reason": auditReasonHeader(reason) },
  });
}

export function adminLogin(key: string): Promise<ApiResult<{ ok: true; admin: string }>> {
  return request("/api/admin/login", { method: "POST", body: JSON.stringify({ key }) });
}

export function adminLogout(): Promise<ApiResult<{ ok: true }>> {
  return request("/api/admin/logout", { method: "POST" });
}

export function adminSearch(query: string, reason = ""): Promise<ApiResult<{ results: AdminSearchRow[] }>> {
  return adminRequest(`/api/admin/search?q=${encodeURIComponent(query)}`, reason);
}

export function adminGetRecord(id: string, reason: string): Promise<ApiResult<{ record: AdminRecordView }>> {
  return adminRequest(`/api/admin/records/${id}`, reason);
}

export function adminSetStatus(id: string, action: "approve" | "reject", reason: string, role: "runner" | "group_leader" = "runner"): Promise<ApiResult<{ ok: true }>> {
  // On reject the reason is ALSO the applicant-facing rejection reason stored
  // on the account (audit header + body reason). Approve needs no body.
  return adminRequest(`/api/admin/records/${id}/${action}?role=${role}`, reason, {
    method: "POST",
    ...(action === "reject" ? { body: JSON.stringify({ reason }) } : {}),
  });
}
/** Audited multi-role assignment — the body carries the FULL desired role set (set semantics). */
export function adminAssignRoles(id: string, roles: OpRole[], cityId: string | null, reason: string): Promise<ApiResult<{ account: { accountId: string; roles: OpRole[]; role: OpRole; adminCityId: string | null } }>> {
  return adminRequest(`/api/admin/accounts/${id}/roles`, reason, {
    method: "PATCH",
    body: JSON.stringify({ roles, cityId }),
  });
}

/** Owner-only read: fetch the pending-users queue. Read access is authorized
 * server-side without an audit reason; decisions remain reason-required. */
export function adminPending(reason = ""): Promise<ApiResult<{ results: PendingQueueRow[] }>> {
  return adminRequest("/api/admin/pending", reason);
}

export function adminDeleteRecord(id: string, reason: string): Promise<ApiResult<{ ok: true }>> {
  return adminRequest(`/api/admin/records/${id}/delete`, reason, { method: "POST" });
}
export function adminUndoRejection(id: string, reason: string): Promise<ApiResult<{ ok: true; account: import("./accounts").PublicAccount }>> {
  return adminRequest(`/api/admin/records/${id}/undo_reject`, reason, { method: "POST" });
}
export function adminPurgePreview(reason: string): Promise<ApiResult<{ count: number; emails: string[] }>> {
  return adminRequest("/api/admin/purge-preview", reason);
}
export function adminPurgeAll(confirmText: string, expectedCount: number, reason: string): Promise<ApiResult<{ deletedCount: number; deletedEmails: string[] }>> {
  return adminRequest("/api/admin/purge-all", reason, { method: "POST", body: JSON.stringify({ confirmText, expectedCount }) });
}

export function adminAudit(limit = 100, reason: string): Promise<ApiResult<{ entries: AuditEntryView[] }>> {
  return adminRequest(`/api/admin/audit?limit=${limit}`, reason);
}

export function adminPurge(reason: string): Promise<ApiResult<{ purged: number; retained: number }>> {
  return adminRequest("/api/admin/purge", reason, { method: "POST" });
}

export function adminSelfieUrl(id: string): string {
  return `/api/admin/records/${id}/selfie`;
}

/** Export CSV: fetch with reason; returns blob URL or error. */
export async function adminExportCsv(query: string, reason: string): Promise<ApiResult<{ blobUrl: string; filename: string }>> {
  try {
    const res = await fetch(`/api/admin/export.csv?q=${encodeURIComponent(query)}`, {
      headers: { "x-audit-reason": auditReasonHeader(reason) },
      credentials: "same-origin",
    });
    if (!res.ok) {
      let code = "request_failed";
      try {
        const b = (await res.json()) as { error?: string };
        code = b.error ?? code;
      } catch {
        // non-JSON error body
      }
      return { ok: false, error: new ApiError(res.status, code) };
    }
    const blob = await res.blob();
    const filename = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "runlocal-verifications.csv";
    return { ok: true, data: { blobUrl: URL.createObjectURL(blob), filename } };
  } catch {
    return { ok: false, error: new ApiError(0, "network_error", "Could not reach the Kimbio server.") };
  }
}

// ------------------------------------------------------------- moderated
/**
 * Public-safe moderation state for one city: hidden content ids, featured/
 * pinned highlights, and RRCA badge state. Deliberately contains no flag
 * reasons, reporters, suspension details, or sensitive records.
 */
export interface ModeratedHighlights {
  id: string;
  kind: "event" | "race" | "post";
  refId: string;
  featured: boolean;
  pinned: boolean;
}
export interface ModeratedState {
  cityId: string;
  hidden: string[];
  highlights: ModeratedHighlights[];
  groups: { id: string; rrcaBadge: boolean }[];
}
export function getModerated(cityId: string): Promise<ApiResult<ModeratedState>> {
  return request(`/api/moderated?city=${encodeURIComponent(cityId)}`);
}

// ------------------------------------------------------------- submissions
export type SubmissionKind = "race" | "group" | "event";
export type SubmissionStatus = "pending" | "approved" | "rejected" | "withdrawn";

/** A submitter's own submission row (statuses + rejection reason, own only). */
export interface MySubmissionView {
  id: string;
  kind: SubmissionKind;
  cityId: string;
  status: SubmissionStatus;
  title: string;
  submittedAt: string;
  decidedAt: string | null;
  rejectionReason: string | null;
  /** Server-computed actions (pending → ["edit_pending", "withdraw"]; decided rows get []). */
  capabilities: string[];
  /** The submitter's own still-pending payload (prefill for the edit form). */
  payload?: Record<string, unknown>;
}

export function submitRace(input: {
  cityId?: string; name: string; distances: string; date: string; location: string; registrationUrl: string; description?: string;
}): Promise<ApiResult<{ submission: { id: string; status: string } }>> {
  return request("/api/submissions/race", { method: "POST", body: JSON.stringify(input) });
}

export function submitGroup(input: {
  cityId?: string; name: string; description?: string; groupType: "rrca-chartered" | "community";
  facebookUrl?: string; instagramUrl?: string; websiteUrl?: string; coverPhoto?: string; logoPhoto?: string; membershipMode?: "open" | "request";
}): Promise<ApiResult<{ submission: { id: string; status: string } }>> {
  return request("/api/submissions/group", { method: "POST", body: JSON.stringify(input) });
}

export function submitEvent(input: {
  cityId?: string; type: "one_time" | "recurring"; title: string; date?: string | null; dayOfWeek?: number | null;
  time: string; location: string; distanceLabel: string; pacePolicy?: string | null; invite: string; externalUrl?: string; description?: string;
}): Promise<ApiResult<{ submission: { id: string; status: string } }>> {
  return request("/api/submissions/event", { method: "POST", body: JSON.stringify(input) });
}

export function getMySubmissions(): Promise<ApiResult<{ submissions: MySubmissionView[] }>> {
  return request("/api/my/submissions");
}
/** Author withdraw of a still-pending submission (pending → withdrawn). */
export function withdrawSubmission(id: string): Promise<ApiResult<{ ok: true; submission: { id: string; status: string } }>> {
  return request(`/api/my/submissions/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}

/** Admin-only pending submission queue row (safe summaries). */
export interface SubmissionQueueRow {
  id: string;
  kind: SubmissionKind;
  cityId: string;
  status: SubmissionStatus;
  title: string;
  submittedAt: string;
  submitterName: string;
  summary: string;
}

export function adminGetSubmissions(cityId: string | null, reason: string, status?: "pending" | "approved" | "rejected"): Promise<ApiResult<{ results: SubmissionQueueRow[] }>> {
  const params = new URLSearchParams();
  if (cityId) params.set("city", cityId);
  if (status && status !== "pending") params.set("status", status);
  const q = params.size ? `?${params.toString()}` : "";
  return adminRequest(`/api/admin/submissions${q}`, reason);
}
export function adminDecideSubmission(id: string, action: "approve" | "reject", reason: string): Promise<ApiResult<{ ok: true }>> {
  return adminRequest(`/api/admin/submissions/${id}/${action}`, reason, { method: "POST" });
}
/** Super-admin edit of a pending submission payload (reason-required, audited). */
export function adminEditSubmission(id: string, input: Record<string, unknown>, reason: string): Promise<ApiResult<{ ok: true; submission: { id: string; status: string; title: string } }>> {
  return adminRequest(`/api/admin/submissions/${id}`, reason, { method: "PATCH", body: JSON.stringify(input) });
}
/** Super-admin removal of a pending submission (reason-required, audited). */
export function adminRemoveSubmission(id: string, reason: string): Promise<ApiResult<{ ok: true; removed: string }>> {
  return adminRequest(`/api/admin/submissions/${id}/remove`, reason, { method: "POST" });
}
export function cityAdminGetSubmissions(reason: string): Promise<ApiResult<{ results: SubmissionQueueRow[] }>> {
  return adminRequest("/api/admin/city/submissions", reason);
}
export function cityAdminDecideSubmission(id: string, action: "approve" | "reject", reason: string): Promise<ApiResult<{ ok: true }>> {
  return adminRequest(`/api/admin/city/submissions/${encodeURIComponent(id)}/${action}`, reason, { method: "POST" });
}

// ------------------------------------------------------- public forum posts
/** A user-created forum post as served by /api/forum (server-persisted). */
export interface ForumPostView {
  id: string;
  section: import("../types").ForumSection;
  category: import("../types").ForumCategory | null;
  title: string;
  body: string;
  author: string;
  authorNote: string | null;
  createdAt: string;
  replies: number;
  pinned: boolean;
  voteCount?: number;
  hasVoted?: boolean;
  /** Author account id — null for seed posts (never an "own" target). */
  authorId: string | null;
  /** Resolved display info for a linked run, if any. */
  linkedEvent: { id: string; title: string; dayOfWeek: number; time: string; location: string } | null;
  /** Server-computed action capabilities for the requesting account. */
  capabilities: string[];
}
export function getForumPosts(cityId: string): Promise<ApiResult<{ cityId: string; posts: ForumPostView[]; replyCounts: Record<string, number> }>> {
  return request(`/api/forum?city=${encodeURIComponent(cityId)}`);
}
export function createForumPost(input: { section: import("../types").ForumSection; category: import("../types").ForumCategory; title: string; body: string; linkedEventId?: string }): Promise<ApiResult<{ post: ForumPostView }>> {
  return request("/api/forum", { method: "POST", body: JSON.stringify(input) });
}
/** Toggles the caller's upvote on a post — verified runners only, one vote per person. */
export function toggleForumVote(postId: string): Promise<ApiResult<{ voted: boolean; voteCount: number }>> {
  return request(`/api/forum/${encodeURIComponent(postId)}/vote`, { method: "POST" });
}
/** Author edit of an own forum post (PATCH /api/forum/:id — server re-validates). */
export function updateForumPost(id: string, input: { title: string; body: string }): Promise<ApiResult<{ post: ForumPostView }>> {
  return request(`/api/forum/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
}
/** Author delete of an own forum post (DELETE /api/forum/:id — soft delete). */
export function deleteForumPost(id: string): Promise<ApiResult<{ post: ForumPostView }>> {
  return request(`/api/forum/${encodeURIComponent(id)}`, { method: "DELETE" });
}
/** Admin pin/unpin of a forum post (PATCH /api/forum/:id/pin — server re-validates). */
export function pinForumPost(id: string, pinned: boolean): Promise<ApiResult<{ post: ForumPostView }>> {
  return request(`/api/forum/${encodeURIComponent(id)}/pin`, { method: "PATCH", body: JSON.stringify({ pinned }) });
}
/** Author hide/restore of an own forum post (PATCH /api/forum/:id/hide — server re-validates). */
export function setForumPostHidden(id: string, hidden: boolean): Promise<ApiResult<{ post: ForumPostView }>> {
  return request(`/api/forum/${encodeURIComponent(id)}/hide`, { method: "PATCH", body: JSON.stringify({ hidden }) });
}

// --------------------------------------------------- public forum replies
/** A user-created reply to a forum post, as served by /api/forum/replies. */
export interface ForumReplyView {
  id: string;
  postId: string;
  body: string;
  author: string;
  createdAt: string;
  /** Author account id — persisted replies always have one. */
  authorId: string;
  /** Server-computed action capabilities for the requesting account. */
  capabilities: string[];
}
export function getForumReplies(cityId: string, postId: string): Promise<ApiResult<{ postId: string; replies: ForumReplyView[] }>> {
  return request(`/api/forum/replies?city=${encodeURIComponent(cityId)}&post=${encodeURIComponent(postId)}`);
}
export function createForumReply(input: { postId: string; body: string }): Promise<ApiResult<{ reply: ForumReplyView }>> {
  return request("/api/forum/replies", { method: "POST", body: JSON.stringify(input) });
}
/** Author edit of an own reply (PATCH /api/forum/replies/:id — server re-validates). */
export function updateForumReply(id: string, input: { body: string }): Promise<ApiResult<{ reply: ForumReplyView }>> {
  return request(`/api/forum/replies/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
}
/** Author delete of an own reply (DELETE /api/forum/replies/:id — soft delete). */
export function deleteForumReply(id: string): Promise<ApiResult<{ reply: ForumReplyView }>> {
  return request(`/api/forum/replies/${encodeURIComponent(id)}`, { method: "DELETE" });
}
/** Verified-runner content flag (post/reply/event/race/group — admins review it). */
export function flagContent(kind: "post" | "reply" | "event" | "race" | "group", id: string, reason: string): Promise<ApiResult<{ flag: { id: string; status: string } }>> {
  return request(`/api/content/${kind}/${encodeURIComponent(id)}/flag`, { method: "POST", body: JSON.stringify({ reason }) });
}

// -------------------------------------------------- public approved content
export interface PublicUserRace {
  id: string; kind: "race"; name: string; date: string; distance: string; location: string;
  organizer: string; price: string; registrationUrl: string; registrationOpen: boolean;
  registrationNote: string; description: string;
}
export interface PublicUserGroup {
  id: string; ownerId?: string; kind: "group"; name: string; groupType: "rrca-chartered" | "community"; description: string;
  facebookUrl: string | null; instagramUrl: string | null; websiteUrl: string | null; coverPhotoUrl?: string; logoPhotoUrl?: string; membershipMode?: "open" | "request"; rrcaVerified?: boolean; leaders?: {id:string;name:string}[];
}
export interface PublicUserEvent {
  id: string; kind: "event"; title: string; type: "one_time" | "recurring"; date: string | null;
  dayOfWeek: number | null; time: string; location: string; distanceLabel: string;
  invite: "Open to all" | "Members + guests" | "RSVP requested"; externalUrl: string | null;
  description: string; host: string;
}
export interface PublicApprovedContent {
  cityId: string; races: PublicUserRace[]; groups: PublicUserGroup[]; events: PublicUserEvent[];
}
export function getPublicContent(cityId: string): Promise<ApiResult<PublicApprovedContent>> {
  return request(`/api/content?city=${encodeURIComponent(cityId)}`);
}
export interface CanonicalEvent { id: string; seedRefId: string | null; cityId: string; groupId: string; title: string; dayOfWeek: number; /** One-time events carry an exact date; recurring events leave this null. */ scheduleDate?: string | null; time: string; location: string; distanceLabel: string; /** How the run treats pace. Null when the host said nothing about it. */ pacePolicy?: import("../types").PacePolicy | null; invite: "Open to all" | "Members + guests" | "RSVP requested"; externalUrl: string | null; provenance: "seed" | "community" | "admin"; status: "draft" | "approved" | "published" | "hidden" | "archived"; hidden: boolean; createdAt: string; updatedAt: string; createdBy: string; updatedBy: string; archivedAt: string | null; /** Server-computed moderation capabilities for the requesting account (hide/restore/delete for leads/admins). Optional — older server responses omit it; callers treat undefined as []. */ capabilities?: string[]; /** Confirmation threshold for informal proposals — undefined/0 means no threshold, always confirmed. */ minParticipants?: number; confirmedCount?: number; isConfirmedGroupRun?: boolean; }
export function getCanonicalEvents(cityId: string): Promise<ApiResult<{ cityId: string | null; events: CanonicalEvent[] }>> { return request(`/api/events?city=${encodeURIComponent(cityId)}`); }
/** Scoped moderation of a canonical event (group lead / city admin / global admin) — PATCH /api/events/:id/moderation. The server re-validates the same capability predicate as GET /api/events; `id` must be the CANONICAL event id (the server resolves seedRefId matches itself). */
export function moderateEvent(id: string, action: "hide" | "restore" | "delete"): Promise<ApiResult<{ event: CanonicalEvent }>> { return request(`/api/events/${encodeURIComponent(id)}/moderation`, { method: "PATCH", body: JSON.stringify({ action }) }); }
export interface PublicRaceView {
  id: string;
  kind: "race";
  name: string;
  date: string;
  distance: string;
  location: string;
  organizer: string;
  price: string;
  registrationUrl: string;
  registrationOpen: boolean;
  registrationNote: string;
  description: string;
  source: "seed" | "submission";
  /** Server-computed capabilities (edit/delete for scoped admins). */
  capabilities: string[];
}
/** Public race listing (seed + approved community) with the requesting account's capabilities. */
export interface RouteView { id: string; cityId: string; name: string; surfaceType: "trail" | "gravel" | "road" | "track"; distanceMiles: number; elevationGainFt: number; hasElevationData: boolean; gpxUrl: string; previewPoints?: [number, number][]; }
export function getRoutes(cityId: string): Promise<ApiResult<{ routes: RouteView[] }>> {
  return request(`/api/routes?city=${encodeURIComponent(cityId)}`);
}
export function uploadRoute(input: { name: string; surfaceType: string; gpx: string }): Promise<ApiResult<{ route: RouteView }>> {
  return request("/api/routes", { method: "POST", body: JSON.stringify(input) });
}

export interface SponsorView { id: string; tier: "featured" | "standard"; businessName: string; tagline: string; linkUrl: string; logoUrl: string | null; startDate: string; endDate: string; }
export interface AdminSponsorView extends SponsorView { active: boolean; createdAt: string; }
/** Public, active sponsor placements for a city — no auth required. */
export function getSponsors(cityId: string): Promise<ApiResult<{ sponsors: SponsorView[] }>> {
  return request(`/api/sponsors?city=${encodeURIComponent(cityId)}`);
}
export function adminListSponsors(cityId: string, reason: string): Promise<ApiResult<{ sponsors: AdminSponsorView[] }>> {
  return request(`/api/admin/sponsors?city=${encodeURIComponent(cityId)}`, { headers: { "x-audit-reason": auditReasonHeader(reason) } });
}
export function adminCreateSponsor(
  input: { cityId: string; tier: "featured" | "standard"; businessName: string; tagline: string; linkUrl: string; logoRef?: string | null; active?: boolean; startDate: string; endDate: string },
  reason: string,
): Promise<ApiResult<{ sponsor: AdminSponsorView }>> {
  return request("/api/admin/sponsors", { method: "POST", headers: { "x-audit-reason": auditReasonHeader(reason) }, body: JSON.stringify(input) });
}
export function adminUpdateSponsor(
  id: string,
  patch: Partial<{ tier: "featured" | "standard"; businessName: string; tagline: string; linkUrl: string; logoRef: string | null; active: boolean; startDate: string; endDate: string }>,
  reason: string,
): Promise<ApiResult<{ sponsor: AdminSponsorView }>> {
  return request(`/api/admin/sponsors/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "x-audit-reason": auditReasonHeader(reason) }, body: JSON.stringify(patch) });
}
export function adminDeleteSponsor(id: string, reason: string): Promise<ApiResult<{ deleted: true }>> {
  return request(`/api/admin/sponsors/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-audit-reason": auditReasonHeader(reason) } });
}
export function adminUploadSponsorLogo(photoDataUrl: string, reason: string): Promise<ApiResult<{ logoRef: string }>> {
  return request("/api/admin/sponsors/logo", { method: "POST", headers: { "x-audit-reason": auditReasonHeader(reason) }, body: JSON.stringify({ photo: photoDataUrl }) });
}
export function adminListGeofenceAllowlist(reason: string): Promise<ApiResult<{ emails: string[] }>> {
  return request("/api/admin/geofence-allowlist", { headers: { "x-audit-reason": auditReasonHeader(reason) } });
}
export function adminAddGeofenceAllowlistEmail(email: string, reason: string): Promise<ApiResult<{ emails: string[] }>> {
  return request("/api/admin/geofence-allowlist", { method: "POST", headers: { "x-audit-reason": auditReasonHeader(reason) }, body: JSON.stringify({ email }) });
}
export function adminRemoveGeofenceAllowlistEmail(email: string, reason: string): Promise<ApiResult<{ emails: string[] }>> {
  return request(`/api/admin/geofence-allowlist/${encodeURIComponent(email)}`, { method: "DELETE", headers: { "x-audit-reason": auditReasonHeader(reason) } });
}
export function getSponsorPaymentsStatus(reason = ""): Promise<ApiResult<{ configured: boolean }>> {
  return adminRequest("/api/admin/sponsors/payments-status", reason);
}
export function createSponsorCheckoutLink(sponsorId: string, reason: string): Promise<ApiResult<{ url: string }>> {
  return request("/api/admin/sponsors/checkout", { method: "POST", headers: { "x-audit-reason": auditReasonHeader(reason) }, body: JSON.stringify({ sponsorId, successUrl: window.location.href, cancelUrl: window.location.href }) });
}
export interface SponsorPaymentView { id: string; tier: "featured" | "standard"; businessName: string; active: boolean; priceUsd: number; startDate: string; endDate: string; }
/** Public — no auth. Knowing the id is the authorization (a one-time link sent to one business). */
export function getSponsorPayment(sponsorId: string): Promise<ApiResult<{ sponsor: SponsorPaymentView }>> {
  return request(`/api/sponsors/${encodeURIComponent(sponsorId)}/payment`);
}
export function payForSponsor(sponsorId: string): Promise<ApiResult<{ url: string }>> {
  return request(`/api/sponsors/${encodeURIComponent(sponsorId)}/checkout`, {
    method: "POST",
    body: JSON.stringify({ successUrl: `${window.location.origin}/sponsor/${sponsorId}?paid=1`, cancelUrl: window.location.href }),
  });
}
/** Public - no auth. Lets the self-serve inquiry page validate a date range before the business fills out the whole form. */
export function checkSponsorAvailability(cityId: string, tier: "featured" | "standard", startDate: string, endDate: string): Promise<ApiResult<{ available: boolean }>> {
  return request(`/api/sponsors/availability?city=${encodeURIComponent(cityId)}&tier=${tier}&start=${startDate}&end=${endDate}`);
}
/** Public - no auth. Self-serve booking submission; always created pending until paid. */
export function submitSponsorInquiry(input: {
  cityId: string; tier: "featured" | "standard"; businessName: string; tagline: string; linkUrl: string; logoRef?: string | null; startDate: string; endDate: string;
}): Promise<ApiResult<{ sponsor: AdminSponsorView }>> {
  return request("/api/sponsors/inquire", { method: "POST", body: JSON.stringify(input) });
}
/** Public - no auth. Uploads a logo for a self-serve inquiry submission (same storage path as the admin upload, just without the admin auth requirement). */
export function uploadInquirySponsorLogo(photoDataUrl: string): Promise<ApiResult<{ logoRef: string }>> {
  return request("/api/sponsors/logo", { method: "POST", body: JSON.stringify({ photo: photoDataUrl }) });
}

export function getRaces(cityId: string): Promise<ApiResult<{ cityId: string; races: PublicRaceView[] }>> {
  return request(`/api/races?city=${encodeURIComponent(cityId)}`);
}
/** Scoped admin edit of a public race listing — PUT /api/races/:id (audited, routine reason). */
export function updateRace(id: string, input: { name?: string; distances?: string; date?: string; location?: string; registrationUrl?: string; description?: string }): Promise<ApiResult<{ race: PublicRaceView }>> {
  return request(`/api/races/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}
/** Scoped edit of a canonical event (group lead / city admin / global admin) — PUT /api/events/:id (audited, routine reason). */
export function updateEvent(id: string, input: { title?: string; dayOfWeek?: number; scheduleDate?: string | null; time?: string; location?: string; distanceLabel?: string; invite?: string; externalUrl?: string | null }): Promise<ApiResult<{ event: CanonicalEvent }>> {
  return request(`/api/events/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}
/** Scoped admin edit of ANY user forum post — PATCH /api/admin/forum/post/:id (reason-required, audited). */
export function adminUpdateForumPost(id: string, input: { title: string; body: string }): Promise<ApiResult<{ post: ForumPostView }>> {
  return adminRequest(`/api/admin/forum/post/${encodeURIComponent(id)}`, "Forum post edit by scoped admin", { method: "PATCH", body: JSON.stringify(input) });
}
/** Submitter's own edit of a still-pending submission — PATCH /api/my/submissions/:id (audited). */
export function updatePendingSubmission(id: string, input: Record<string, unknown>): Promise<ApiResult<{ submission: { id: string; status: string; title: string } }>> {
  return request(`/api/my/submissions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
}
export function adminGetEvents(cityId: string | null, reason: string): Promise<ApiResult<{ events: CanonicalEvent[] }>> { return adminRequest(`/api/admin/events${cityId ? `?city=${encodeURIComponent(cityId)}` : ""}`, reason); }
export function adminCreateEvent(input: Partial<CanonicalEvent>, reason: string): Promise<ApiResult<{ event: CanonicalEvent }>> { return adminRequest("/api/admin/events", reason, { method: "POST", body: JSON.stringify(input) }); }
export function adminEditEvent(id: string, input: Partial<CanonicalEvent>, reason: string): Promise<ApiResult<{ event: CanonicalEvent }>> { return adminRequest(`/api/admin/events/${encodeURIComponent(id)}`, reason, { method: "PATCH", body: JSON.stringify(input) }); }
export function adminTransitionEvent(id: string, action: "approve" | "publish" | "hide" | "unhide" | "archive", reason: string): Promise<ApiResult<{ event: CanonicalEvent }>> { return adminRequest(`/api/admin/events/${encodeURIComponent(id)}/${action}`, reason, { method: "POST" }); }
export function getPublicGroups(cityId: string): Promise<ApiResult<{cityId:string;groups:PublicUserGroup[]}>> { return request(`/api/groups?city=${encodeURIComponent(cityId)}`); }
export function getPublicGroup(id: string): Promise<ApiResult<{group:PublicUserGroup}>> { return request(`/api/groups/${encodeURIComponent(id)}`); }

// ------------------------------------------------- owner dashboard (admin)
export interface DashboardFlagView {
  id: string;
  cityId: string;
  contentId: string;
  kind: "event" | "race" | "post";
  refId: string;
  title: string;
  reason: string;
  reporterName: string;
  createdAt: string;
  status: "open" | "dismissed" | "hidden";
  resolvedAt: string | null;
  resolvedAction: "dismiss" | "hide" | null;
  authorAccountId: string | null;
}
export interface DashboardContentView {
  id: string;
  refId: string;
  kind: "event" | "race" | "post";
  title: string;
  featured: boolean;
  pinned: boolean;
  hidden: boolean;
}
export interface DashboardGroupView {
  id: string;
  name: string;
  rrcaBadge: boolean;
  rrcaNote: string | null;
  rrcaNoteUpdatedAt: string | null;
}
export interface DashboardSuspensionView {
  accountId: string;
  name: string;
  email: string;
  status: string;
  phase: string | null;
  role: string;
  suspendedUntil: string | null;
  suspensionReason: string | null;
}
export interface DashboardView {
  cityId: string;
  flags: DashboardFlagView[];
  events: DashboardContentView[];
  races: DashboardContentView[];
  posts: DashboardContentView[];
  groups: DashboardGroupView[];
  suspensions: DashboardSuspensionView[];
}

/** Owner-only: full dashboard overview for a city (reason required, audited). */
export function adminDashboard(cityId: string, reason: string): Promise<ApiResult<DashboardView>> {
  return adminRequest(`/api/admin/dashboard?city=${encodeURIComponent(cityId)}`, reason);
}

/** Owner-only: dismiss (keep visible) or hide a flagged item. */
export function adminModerateFlag(flagId: string, action: "dismiss" | "hide", reason: string): Promise<ApiResult<{ ok: true; flag: DashboardFlagView }>> {
  return adminRequest(`/api/admin/moderate/flag/${flagId}`, reason, { method: "POST", body: JSON.stringify({ action }) });
}

/** Owner-only: reverse a hide (content visible again). */
export function adminUnhideContent(contentId: string, reason: string): Promise<ApiResult<{ ok: true; content: DashboardContentView }>> {
  return adminRequest(`/api/admin/moderate/unhide/${contentId}`, reason, { method: "POST", body: JSON.stringify({}) });
}

/** Owner-only: posting-blocking suspension. days null = indefinite. */
export function adminSuspendAccount(accountId: string, days: number | null, reason: string): Promise<ApiResult<{ ok: true; account: DashboardSuspensionView }>> {
  return adminRequest(`/api/admin/suspend/${accountId}`, reason, { method: "POST", body: JSON.stringify({ days }) });
}

/** Owner-only: lift a suspension. */
export function adminLiftSuspension(accountId: string, reason: string): Promise<ApiResult<{ ok: true; account: DashboardSuspensionView }>> {
  return adminRequest(`/api/admin/lift/${accountId}`, reason, { method: "POST", body: JSON.stringify({}) });
}

/** Owner-only: RRCA badge + internal note for a group. */
export function adminSetGroupRrca(groupId: string, badge: boolean, note: string, reason: string): Promise<ApiResult<{ ok: true; group: DashboardGroupView }>> {
  return adminRequest(`/api/admin/group/${groupId}/rrca`, reason, { method: "POST", body: JSON.stringify({ badge, note }) });
}

/** Owner-only: featured/pinned toggle for an event or race. */
export function adminSetHighlight(contentId: string, patch: { featured?: boolean; pinned?: boolean }, reason: string): Promise<ApiResult<{ ok: true; content: DashboardContentView }>> {
  return adminRequest(`/api/admin/content/${contentId}/highlight`, reason, { method: "POST", body: JSON.stringify(patch) });
}

// ---------------------------------------------- super-admin content management
export interface AdminContentRow {
  id: string;
  kind: "event" | "race" | "post" | "group";
  refId: string;
  cityId: string;
  title: string;
  authorLabel: string | null;
  source: "seed" | "submission";
  submissionId: string | null;
  hidden: boolean;
  archived: boolean;
  featured: boolean;
  pinned: boolean;
  eventStatus: string | null;
}
/** Routine read — audited with the server-generated reason, no operator prompt. */
export function adminListContent(cityId: string | null, kind: AdminContentRow["kind"] | null): Promise<ApiResult<{ results: AdminContentRow[] }>> {
  const params = new URLSearchParams();
  if (cityId) params.set("city", cityId);
  if (kind) params.set("kind", kind);
  return adminRequest(`/api/admin/content${params.size ? `?${params.toString()}` : ""}`, "");
}
export function adminEditContentTitle(contentId: string, title: string, reason: string): Promise<ApiResult<{ ok: true; content: AdminContentRow }>> {
  return adminRequest(`/api/admin/content/${encodeURIComponent(contentId)}`, reason, { method: "PATCH", body: JSON.stringify({ title }) });
}
export function adminTransitionContent(contentId: string, action: "hide" | "restore" | "archive" | "delete", reason: string): Promise<ApiResult<{ ok: true; content: AdminContentRow }>> {
  return adminRequest(`/api/admin/content/${encodeURIComponent(contentId)}/${action}`, reason, { method: "POST" });
}
export interface AdminDiscussionRow {
  id: string;
  kind: "thread" | "comment";
  parentId: string | null;
  occurrenceId: string;
  eventId: string;
  cityId: string;
  title: string | null;
  body: string;
  authorLabel: string | null;
  authorEmail: string | null;
  createdAt: string;
  updatedAt: string;
}
/** Routine read — audited with the server-generated reason, no operator prompt. */
export function adminListDiscussions(cityId: string | null): Promise<ApiResult<{ results: AdminDiscussionRow[] }>> {
  const params = new URLSearchParams();
  if (cityId) params.set("city", cityId);
  return adminRequest(`/api/admin/discussions${params.size ? `?${params.toString()}` : ""}`, "");
}
export function adminEditDiscussion(discussionId: string, patch: { body?: string; title?: string }, reason: string): Promise<ApiResult<{ ok: true; discussion: AdminDiscussionRow }>> {
  return adminRequest(`/api/admin/discussion/${encodeURIComponent(discussionId)}`, reason, { method: "PATCH", body: JSON.stringify(patch) });
}
export function adminDeleteDiscussion(discussionId: string, reason: string): Promise<ApiResult<{ ok: true; deleted: true }>> {
  return adminRequest(`/api/admin/discussion/${encodeURIComponent(discussionId)}`, reason, { method: "DELETE" });
}
export function adminSetAnnouncement(input: { text: string; link?: string }, reason: string): Promise<ApiResult<{ ok: true; announcement: { text: string; link?: string } | null }>> {
  return adminRequest("/api/admin/announcement", reason, { method: "PATCH", body: JSON.stringify(input) });
}
export function adminClearAnnouncement(reason: string): Promise<ApiResult<{ ok: true; announcement: null }>> {
  return adminRequest("/api/admin/announcement", reason, { method: "DELETE" });
}
export type ActivityProvider = "strava" | "garmin" | "coros" | "suunto";
export type ShareMode = "auto" | "manual" | "private";
export interface PublicActivityCard { id: string; type: string; distanceMeters: number; durationSeconds: number; provider: ActivityProvider; attribution: string; sharedAt: string; }
/**
 * GET /api/activity/feed — the city-scoped activity feed. Session optional:
 * the server returns only cards the owner would share with the current viewer
 * (per-owner show_past_activity privacy + bidirectional blocks; shareMode
 * "private" cards are owner-only). Guests see whatever the privacy model
 * allows (show_past_activity defaults to public).
 */
export function getActivityFeed(city: string): Promise<ApiResult<{ cards: PublicActivityCard[] }>> { return request(`/api/activity/feed?city=${encodeURIComponent(city)}`); }
/** POST /api/activity/manual — verified runners log a completed run manually. */
export interface ManualActivityInput {
  /** Provider attribution stamped on the card. Defaults to "strava" (the only provider enabled by default); shareMode is always "manual" server-side. */
  provider?: ActivityProvider;
  distanceMeters: number;
  durationSeconds: number;
  /** ISO completion timestamp (optional; the server defaults to now). */
  startedAt?: string;
  /** Optional caption, truncated server-side to 280 chars. */
  caption?: string;
}
export function postManualActivity(input: ManualActivityInput): Promise<ApiResult<{ card: PublicActivityCard }>> {
  return request("/api/activity/manual", {
    method: "POST",
    body: JSON.stringify({
      provider: input.provider ?? "strava",
      activity: { distanceMeters: input.distanceMeters, durationSeconds: input.durationSeconds, completedAt: input.startedAt },
      caption: input.caption,
    }),
  });
}
export type ProviderStatus = { provider: ActivityProvider; offered: boolean; configured: boolean; connected: boolean; state: "unavailable" | "coming_soon" | "not_configured" | "available" | "connected"; authorizeUrl?: string; missing?: string[] };
export function getProviderStatus(provider: ActivityProvider): Promise<ApiResult<ProviderStatus>> { return request(`/api/connections/${provider}`); }
export function disconnectConnection(provider: ActivityProvider, deleteActivities: boolean): Promise<ApiResult<{ disconnected: boolean; deletedActivities: boolean }>> { return request(`/api/connections/${provider}/disconnect`, { method: "POST", body: JSON.stringify({ deleteActivities }) }); }

// ------------------------------------------------------- credentials & trust
// Privacy contract: the client only ever sees QUALITATIVE trust data and its
// OWN credential rows (no proof bytes, no reviewer identity, no raw counts).
export type CredentialType = "coach_certification" | "first_aid_cpr";
export type CredentialStatus = "pending_review" | "verified" | "rejected" | "expired";
export interface CredentialView {
  id: string;
  type: CredentialType;
  certifyingBody: string;
  issuedOn: string | null;
  expiresOn: string | null;
  status: CredentialStatus;
  /** Decision reason — only ever shown to the credential's own account. */
  decisionReason: string | null;
  /** Whether a proof file exists (viewable only by the owner, protected route). */
  hasProof: boolean;
}
export function getMyCredentials(): Promise<ApiResult<{ credentials: CredentialView[] }>> {
  return request("/api/credentials");
}
export function submitCredential(input: {
  type: CredentialType;
  certifyingBody: string;
  issuedOn?: string;
  expiresOn?: string;
  proof?: string;
  proofMime?: string;
}): Promise<ApiResult<{ credential: { id: string; type: string; status: string } }>> {
  return request("/api/credentials", { method: "POST", body: JSON.stringify(input) });
}
/** Protected proof URL — only the credential owner (same session) can open it. */
export function credentialProofUrl(id: string): string {
  return `/api/credentials/${encodeURIComponent(id)}/proof`;
}

/** Qualitative trust view of any account — never counts, scores, or reports. */
export interface PublicTrustView {
  tier: "new" | "recognized" | "well-regarded";
  coach: boolean;
  host: boolean;
  recognitions: { role: "coach" | "host"; tier: "recognized" }[];
  /** Present only when viewing your own account. */
  underReview?: boolean;
  restrictions?: { hosting: boolean; coachPost: boolean };
}
export function getPublicTrust(accountId: string): Promise<ApiResult<PublicTrustView>> {
  return request(`/api/profile/trust?accountId=${encodeURIComponent(accountId)}`);
}
/** Public, non-ranked qualitative recognition list for a city. */
export interface RecognitionView {
  accountId: string;
  name: string;
  username: string | null;
  roles: ("coach" | "host")[];
  tier: "new" | "recognized" | "well-regarded";
}
export function getRecognitions(cityId: string): Promise<ApiResult<{ recognitions: RecognitionView[] }>> {
  return request(`/api/recognitions?city=${encodeURIComponent(cityId)}`);
}
/**
 * Public-safe identity of ANY account — the only fields a third party (or
 * guest) may see. Never email, phone, suspended state, rejection reason,
 * under-review state, or verification history.
 */
export interface RunnerProfileView {
  id: string;
  name: string;
  username: string | null;
  profilePhotoUrl: string | null;
  /** Display name of the runner's home city (null when unset/unknown). */
  cityName: string | null;
  isVerified: boolean;
  isTrustedMember: boolean;
  isLeader: boolean;
  /** Self-reported, optional — null when the runner hasn't set them. */
  paceLabel?: string | null;
  runningGoal?: string | null;
  trainingBlock?: string | null;
  upcomingRaces?: string | null;
  bio?: string | null;
  /** Optional override shown instead of the role label (e.g. "Founder") — display-only. */
  customTitle?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  tiktokUrl?: string | null;
  /** Relationship of the signed-in viewer to this runner (null for guests). */
  connectionState?: ConnectionState | null;
  /** Shared accepted connections; meaningful only when mutualVisible is true. */
  /** Occurrences you and this person both attended. Viewer-scoped, never public. */
  runsTogether?: number;
  /** Groups you are both active members of. */
  sharedGroups?: { id: string; name: string }[];
  mutualConnectionsCount?: number;
  /** Whether the runner's show_connections_list lets this viewer see the count. */
  mutualVisible?: boolean;
  /** Structured training plan, when set — takes precedence over the free-text trainingBlock field for display. */
  trainingPlan?: { planType: TrainingPlanType; customLabel: string | null; totalWeeks: number; currentWeek: number; linkedRaceName: string | null } | null;
  isAvailableAsCoach?: boolean;
  coachBio?: string | null;
}
/** GET /api/runners/:id — guest-accessible public runner profile. */
export interface RunnerProfileResponse {
  profile: RunnerProfileView;
  trust: PublicTrustView;
  /** Non-ranked qualitative recognition list for the runner's city. */
  recognitions: RecognitionView[];
}
export function getRunnerProfile(id: string): Promise<ApiResult<RunnerProfileResponse>> {
  return request(`/api/runners/${encodeURIComponent(id)}`);
}

/**
 * A run both the viewer and this runner attended (RSVP or host) — the only
 * basis for sharing feedback. The server returns public titles + dates only,
 * never other attendees or attendance history.
 */
export interface SharedEventView {
  eventId: string;
  title: string;
  date: string;
}
/** GET /api/runners/:id/shared-events — verified signed-in runners only. */
export function getRunnerSharedEvents(runnerId: string): Promise<ApiResult<{ events: SharedEventView[] }>> {
  return request(`/api/runners/${encodeURIComponent(runnerId)}/shared-events`);
}

// ------------------------------------------------- connections & privacy
/** Relationship of the signed-in viewer to another runner (null for guests). */
export type ConnectionState = "none" | "requested_by_me" | "requested_to_me" | "connected" | "removed";
/** One incoming pending request row (from = the requester's public profile). */
export interface ConnectionRequestView {
  requestId: string;
  from: RunnerProfileView;
  createdAt: string;
}
/** An accepted connection entry: public profile + "connected". */
export type ConnectionView = RunnerProfileView & { connectionState: ConnectionState };
export interface ConnectionsView {
  requests: ConnectionRequestView[];
  connections: ConnectionView[];
  pendingCount: number;
}
/** GET /api/connections — signed-in only. Optional ?q= filters the list. */
export function getConnections(q?: string): Promise<ApiResult<ConnectionsView>> {
  return request(`/api/connections${q ? `?q=${encodeURIComponent(q)}` : ""}`);
}
/** POST /api/connections/:id/request — :id is the TARGET ACCOUNT id. */
export function requestConnection(targetId: string): Promise<ApiResult<{ status: string; resolved?: boolean }>> {
  return request(`/api/connections/${encodeURIComponent(targetId)}/request`, { method: "POST" });
}
/** POST /api/connections/:id/accept|decline — :id is the REQUEST id. */
export function acceptConnection(requestId: string): Promise<ApiResult<{ status: string }>> {
  return request(`/api/connections/${encodeURIComponent(requestId)}/accept`, { method: "POST" });
}
export function declineConnection(requestId: string): Promise<ApiResult<{ status: string }>> {
  return request(`/api/connections/${encodeURIComponent(requestId)}/decline`, { method: "POST" });
}
/** POST /api/connections/:id/remove — :id is the OTHER ACCOUNT id (soft delete). */
export function removeConnection(accountId: string): Promise<ApiResult<{ status: string }>> {
  return request(`/api/connections/${encodeURIComponent(accountId)}/remove`, { method: "POST" });
}
/**
 * What a block does not do, for this specific pair. Empty in the common case.
 *
 * Shown at block time rather than sent later: she is standing there having just
 * blocked someone, which is when the information is useful. A notification
 * arriving afterwards reads as "something happened" rather than "here is what
 * you just did".
 */
export interface BlockCaveat {
  kind: "shared_group" | "leads_group";
  groupId: string;
  groupName: string;
}

/** POST /api/connections/:id/block — writes a block + removes any active row. */
export function blockConnection(accountId: string): Promise<ApiResult<{ status: string; caveats?: BlockCaveat[] }>> {
  return request(`/api/connections/${encodeURIComponent(accountId)}/block`, { method: "POST" });
}
/** Unblock via the EXISTING single block system (POST /api/blocks DELETE). */
export function unblockConnection(accountId: string): Promise<ApiResult<{ removed: boolean }>> {
  return request("/api/blocks", { method: "DELETE", body: JSON.stringify({ accountId }) });
}
/** GET /api/people/search?q= — verified accounts only; searchable_by_name enforced server-side. */
export interface PeopleSearchResult extends RunnerProfileView {
  connectionState: ConnectionState | null;
}
export function searchPeople(q: string): Promise<ApiResult<{ people: PeopleSearchResult[] }>> {
  return request(`/api/people/search?q=${encodeURIComponent(q)}`);
}
/** One attendee row of the connections-going strip (canView-filtered server-side). */
export interface ConnectionGoingRow {
  accountId: string;
  name: string;
  username: string | null;
  profilePhotoUrl: string | null;
}
/** GET /api/events/:eventId/occurrences/:occurrenceId/connections-going — verified signed-in only. */
export function getConnectionsGoing(eventId: string, occurrenceId: string): Promise<ApiResult<ConnectionGoingRow[]>> {
  return request(`/api/events/${encodeURIComponent(eventId)}/occurrences/${encodeURIComponent(occurrenceId)}/connections-going`);
}
/** One card of the connections activity feed: card + the owner's public-safe identity. */
export interface ConnectionActivityCard extends PublicActivityCard {
  owner: { accountId: string; name: string; username: string | null; profilePhotoUrl: string | null };
}
/** GET /api/connections/activity — signed-in only; cards from the caller's ACCEPTED connections, filtered by show_past_activity + shareMode + blocks server-side. */
export function getConnectionsActivity(): Promise<ApiResult<{ cards: ConnectionActivityCard[] }>> {
  return request("/api/connections/activity");
}

// ------------------------------------------------------------ privacy settings
export type ProfileVisibilitySetting = "public" | "connections_only";
export type ContentVisibilitySetting = "public" | "connections_only" | "private";
export type SavedEventsVisibilitySetting = "connections_only" | "private";
export interface PrivacySettings {
  profile_visibility: ProfileVisibilitySetting;
  show_upcoming_events: ContentVisibilitySetting;
  show_saved_events: SavedEventsVisibilitySetting;
  show_past_activity: ContentVisibilitySetting;
  show_connections_list: ContentVisibilitySetting;
  show_tagged_content: ContentVisibilitySetting;
  searchable_by_name: boolean;
}
export interface ConversationSummary {
  id: string;
  isGroup: boolean;
  name: string;
  participantIds: string[];
  otherProfile: RunnerProfileView | null;
  /** Approximate presence for the other person in a 1:1 — polling-accurate, not instant push. */
  otherOnline?: boolean;
  lastMessage: { body: string | null; senderId: string; createdAt: string } | null;
  lastMessageAt: string;
  runCreatedId: string | null;
  /** accountId -> ISO timestamp of that person's last-read moment — the basis for "Seen" under your own messages. */
  readBy: Record<string, string>;
  /** Group photo — null shows the default group icon. Never set for 1:1 threads. */
  photoUrl?: string | null;
}
export interface MessageView {
  id: string;
  senderId: string;
  body: string | null;
  createdAt: string;
  deletedAt: string | null;
  reactions: Record<string, string>;
  mediaUrl?: string | null;
  editedAt?: string | null;
}
export function getConversations(): Promise<ApiResult<{ conversations: ConversationSummary[] }>> {
  return request("/api/conversations");
}
export function createDirectConversation(accountId: string): Promise<ApiResult<{ conversation: ConversationSummary }>> {
  return request("/api/conversations", { method: "POST", body: JSON.stringify({ accountId }) });
}
export function createGroupConversation(name: string, participantIds: string[]): Promise<ApiResult<{ conversation: ConversationSummary }>> {
  return request("/api/conversations", { method: "POST", body: JSON.stringify({ name, participantIds }) });
}
export function getMessages(conversationId: string): Promise<ApiResult<{ conversation: ConversationSummary; messages: MessageView[]; typingNames?: string[] }>> {
  return request(`/api/conversations/${encodeURIComponent(conversationId)}/messages`);
}
export function sendMessage(conversationId: string, body: string, photoDataUrl?: string | null): Promise<ApiResult<{ message: MessageView }>> {
  return request(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", body: JSON.stringify({ body, ...(photoDataUrl ? { photo: photoDataUrl } : {}) }) });
}
export function setMessageReaction(messageId: string, emoji: string | null): Promise<ApiResult<{ message: MessageView }>> {
  return request(`/api/messages/${encodeURIComponent(messageId)}/reaction`, { method: "PUT", body: JSON.stringify({ emoji }) });
}
/** Sender only, and only within 10 minutes of sending — the server enforces the window regardless of what the client shows. */
export function editMessage(messageId: string, body: string): Promise<ApiResult<{ message: MessageView }>> {
  return request(`/api/messages/${encodeURIComponent(messageId)}`, { method: "PUT", body: JSON.stringify({ body }) });
}
/** Sender only, no time limit. */
export function deleteMessage(messageId: string): Promise<ApiResult<{ message: MessageView }>> {
  return request(`/api/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" });
}
export function createRunFromConversation(conversationId: string, input: { scheduleDate: string; time: string; location: string; distanceLabel?: string }): Promise<ApiResult<{ eventId: string; cityId: string }>> {
  return request(`/api/conversations/${encodeURIComponent(conversationId)}/create-run`, { method: "POST", body: JSON.stringify(input) });
}
export interface ConversationMember extends RunnerProfileView { isCreator: boolean; isOnline?: boolean; }
export function getConversationMembers(conversationId: string): Promise<ApiResult<{ members: ConversationMember[] }>> {
  return request(`/api/conversations/${encodeURIComponent(conversationId)}/members`);
}
export function renameConversation(conversationId: string, name: string): Promise<ApiResult<{ conversation: ConversationSummary }>> {
  return request(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: "PATCH", body: JSON.stringify({ name }) });
}
export function leaveConversation(conversationId: string): Promise<ApiResult<{ left: boolean }>> {
  return request(`/api/conversations/${encodeURIComponent(conversationId)}/leave`, { method: "POST" });
}
export function reportRunner(accountId: string, reason: string, conversationId?: string): Promise<ApiResult<{ reportId: string }>> {
  return request(`/api/runners/${encodeURIComponent(accountId)}/report`, { method: "POST", body: JSON.stringify({ reason, conversationId }) });
}
export function uploadGroupChatPhoto(conversationId: string, photoDataUrl: string): Promise<ApiResult<{ photoUrl: string; conversation: ConversationSummary }>> {
  return request(`/api/conversations/${encodeURIComponent(conversationId)}/photo`, { method: "POST", body: JSON.stringify({ photo: photoDataUrl }) });
}
/** Call on a debounce while the user is actively typing — not per keystroke. */
export function sendTyping(conversationId: string): Promise<ApiResult<{ ok: boolean }>> {
  return request(`/api/conversations/${encodeURIComponent(conversationId)}/typing`, { method: "POST" });
}
export function getTyping(conversationId: string): Promise<ApiResult<{ typingNames: string[] }>> {
  return request(`/api/conversations/${encodeURIComponent(conversationId)}/typing`);
}

export type TrainingPlanType = "5k" | "10k" | "half_marathon" | "marathon" | "ultra" | "other";
export interface TrainingPlanView {
  accountId: string;
  planType: TrainingPlanType;
  customLabel: string | null;
  totalWeeks: number;
  startDate: string;
  linkedRaceId: string | null;
  linkedRaceName: string | null;
  customRaceName: string | null;
  currentWeek: number;
  createdAt: string;
  updatedAt: string;
}
export function getTrainingPlan(): Promise<ApiResult<{ plan: TrainingPlanView | null }>> {
  return request("/api/profile/training-plan");
}
export function setTrainingPlan(input: { planType: TrainingPlanType; customLabel?: string | null; totalWeeks: number; startDate: string; linkedRaceId?: string | null; customRaceName?: string | null }): Promise<ApiResult<{ plan: TrainingPlanView }>> {
  return request("/api/profile/training-plan", { method: "PUT", body: JSON.stringify(input) });
}
export function deleteTrainingPlan(): Promise<ApiResult<{ deleted: boolean }>> {
  return request("/api/profile/training-plan", { method: "DELETE" });
}

export interface TrainingPlanWeekView {
  id: string;
  accountId: string;
  weekNumber: number;
  targetMiles: number | null;
  longRunMiles: number | null;
  notes: string;
  updatedAt: string;
}
export function getTrainingPlanWeeks(): Promise<ApiResult<{ weeks: TrainingPlanWeekView[] }>> {
  return request("/api/profile/training-plan/weeks");
}
export function setTrainingPlanWeek(weekNumber: number, input: { targetMiles?: number | null; longRunMiles?: number | null; notes?: string }): Promise<ApiResult<{ week: TrainingPlanWeekView }>> {
  return request(`/api/profile/training-plan/weeks/${weekNumber}`, { method: "PUT", body: JSON.stringify(input) });
}

export type TrainingDayWorkoutType = "run" | "cross_training" | "rest" | "recovery" | "race" | "swim";
export type TrainingRunLabel = "easy" | "tempo" | "long_run" | "workout" | "recovery_run" | "race_pace" | "intervals";
export type TrainingDayMissedReason = "sick" | "injured" | "too_busy" | "weather" | "low_motivation" | "other";
export type TrainingDaySlot = "primary" | "am" | "pm";
export type TrainingDistanceUnit = "miles" | "km" | "meters" | "yards";
export type IntervalMeasure = "distance" | "duration";
export type DurationUnit = "seconds" | "minutes";
export type PaceZoneTarget = "easy" | "marathon" | "threshold" | "interval";
export type RecoveryType = "jog" | "walk" | "stand";
export interface IntervalStructure {
  warmupValue: number | null;
  warmupUnit: TrainingDistanceUnit | null;
  repeatCount: number;
  workMeasure: IntervalMeasure;
  workValue: number;
  workUnit: TrainingDistanceUnit | null;
  workDurationUnit: DurationUnit | null;
  workPaceTarget: PaceZoneTarget | null;
  hasRest: boolean;
  restType: RecoveryType | null;
  restMeasure: IntervalMeasure | null;
  restValue: number | null;
  restUnit: TrainingDistanceUnit | null;
  restDurationUnit: DurationUnit | null;
  cooldownValue: number | null;
  cooldownUnit: TrainingDistanceUnit | null;
}
export interface TrainingPlanDayView {
  id: string;
  accountId: string;
  date: string;
  slot: TrainingDaySlot;
  scheduledTime: string | null;
  weekNumber: number;
  workoutType: TrainingDayWorkoutType;
  runLabel: TrainingRunLabel | null;
  title: string;
  distanceValue: number | null;
  distanceUnit: TrainingDistanceUnit;
  intervalStructure: IntervalStructure | null;
  shoeId: string | null;
  plannedGelCount: number | null;
  plannedDrinkMixId: string | null;
  nutritionPlanNotes: string | null;
  actualGelCount: number | null;
  actualDrinkMixId: string | null;
  fuelNotes: string | null;
  hydrationNotes: string | null;
  linkedRouteId: string | null;
  linkedEventOccurrenceId: string | null;
  notes: string;
  completionStatus: "pending" | "done" | "missed" | "modified";
  missedReason: TrainingDayMissedReason | null;
  completionNotes: string | null;
  completedRunId: string | null;
  frozen: boolean;
  recurrenceId: string | null;
  recurrenceOverridden: boolean;
  updatedAt: string;
}
export type TrainingPlanDayInput = Partial<Omit<TrainingPlanDayView, "id" | "accountId" | "date" | "slot" | "weekNumber" | "completedRunId" | "recurrenceId" | "recurrenceOverridden" | "updatedAt">>;

function dayPath(date: string, slot?: TrainingDaySlot): string {
  return slot && slot !== "primary" ? `${date}/${slot}` : date;
}
export function getTrainingPlanDays(range?: { start?: string; end?: string }): Promise<ApiResult<{ days: TrainingPlanDayView[] }>> {
  const q = range ? `?${new URLSearchParams({ ...(range.start ? { start: range.start } : {}), ...(range.end ? { end: range.end } : {}) })}` : "";
  return request(`/api/profile/training-plan/days${q}`);
}

export interface SummaryActivityView { id: string; type: string; distanceMeters: number; durationSeconds: number; completedAt: string; caption?: string | null; }
export interface TrainingSummaryView {
  planDays: TrainingPlanDayView[];
  strengthEntries: { id: string; date: string; title: string; completionStatus: string }[];
  linkedActivities: SummaryActivityView[];
  unlinkedActivities: SummaryActivityView[];
  totals: { plannedMiles: number; loggedMiles: number; daysDone: number; daysMissed: number; daysModified: number; daysPending: number };
}
export interface BlockSummaryView {
  start: string;
  end: string;
  doneDayCount: number;
  shoeMiles: { shoeId: string; shoeName: string; miles: number }[];
  totalGels: number;
  drinkMixUsage: { nutritionItemId: string; name: string; uses: number }[];
}
export function getBlockSummary(start: string, end: string): Promise<ApiResult<BlockSummaryView>> {
  return request(`/api/profile/training-plan/block-summary?${new URLSearchParams({ start, end })}`);
}
export function getTrainingSummary(start: string, end: string): Promise<ApiResult<TrainingSummaryView>> {
  return request(`/api/profile/training-plan/summary?${new URLSearchParams({ start, end })}`);
}

export type WeekColor = "green" | "yellow" | "red";
export interface WeekScoreView { weekStartDate: string; runColor: WeekColor; strengthColor: WeekColor; overallColor: WeekColor; reviewRequired: boolean; reviewed: boolean; priorWeekBlocking: boolean; priorWeekStartDate: string; }
export function getWeekScore(weekStartDate: string): Promise<ApiResult<WeekScoreView>> {
  return request(`/api/profile/training-plan/week-score?${new URLSearchParams({ weekStartDate })}`);
}
export function submitWeeklyReview(weekStartDate: string, notes: string): Promise<ApiResult<{ review: unknown }>> {
  return request("/api/profile/training-plan/week-review", { method: "POST", body: JSON.stringify({ weekStartDate, notes }) });
}
export function getAthleteWeekScore(athleteId: string, weekStartDate: string): Promise<ApiResult<{ runColor: WeekColor; strengthColor: WeekColor; overallColor: WeekColor; reviewed: boolean }>> {
  return request(`/api/coach/athletes/${encodeURIComponent(athleteId)}/week-score?${new URLSearchParams({ weekStartDate })}`);
}
export interface RosterAthleteView { relationshipId: string; athleteId: string; athleteName: string; weekStartDate: string; runColor: WeekColor; strengthColor: WeekColor; overallColor: WeekColor; }
export function getCoachRoster(): Promise<ApiResult<{ athletes: RosterAthleteView[] }>> {
  return request("/api/coach/roster");
}
export interface CoachDirectoryEntry { accountId: string; name: string; username: string | null; coachBio: string | null; isVerifiedCoach: boolean; }
export function getCoachDirectory(): Promise<ApiResult<{ coaches: CoachDirectoryEntry[] }>> {
  return request("/api/coaches");
}
export function setTrainingPlanDay(date: string, input: TrainingPlanDayInput, slot?: TrainingDaySlot): Promise<ApiResult<{ day: TrainingPlanDayView }>> {
  return request(`/api/profile/training-plan/days/${dayPath(date, slot)}`, { method: "PUT", body: JSON.stringify(input) });
}

// ---- recurring workout scheduling ----
export interface RecurrenceView {
  id: string;
  accountId: string;
  daysOfWeek: number[];
  startDate: string;
  endDate: string;
  workoutType: TrainingDayWorkoutType;
  runLabel: TrainingRunLabel | null;
  title: string;
  distanceValue: number | null;
  distanceUnit: TrainingDistanceUnit;
  createdAt: string;
  updatedAt: string;
}
export type RecurrenceInput = {
  daysOfWeek: number[]; startDate: string; endDate: string;
  workoutType?: TrainingDayWorkoutType; runLabel?: TrainingRunLabel | null; title?: string; distanceValue?: number | null; distanceUnit?: TrainingDistanceUnit;
};
export function listRecurrences(): Promise<ApiResult<{ recurrences: RecurrenceView[] }>> {
  return request("/api/profile/training-plan/recurrences");
}
export function createRecurrence(input: RecurrenceInput): Promise<ApiResult<{ recurrence: RecurrenceView; generatedCount: number }>> {
  return request("/api/profile/training-plan/recurrences", { method: "POST", body: JSON.stringify(input) });
}
export function updateRecurrenceAllInstances(id: string, input: Partial<RecurrenceInput>): Promise<ApiResult<{ recurrence: RecurrenceView; generatedCount: number }>> {
  return request(`/api/profile/training-plan/recurrences/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}
export function deleteRecurrence(id: string): Promise<ApiResult<{ ok: true }>> {
  return request(`/api/profile/training-plan/recurrences/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---- shoe library ----
export interface ShoeView { id: string; accountId: string; name: string; isDefault: boolean; totalMiles: number; createdAt: string; }
export function listShoes(): Promise<ApiResult<{ shoes: ShoeView[] }>> {
  return request("/api/profile/shoes");
}
export function addShoe(name: string, isDefault?: boolean): Promise<ApiResult<{ shoe: ShoeView }>> {
  return request("/api/profile/shoes", { method: "POST", body: JSON.stringify({ name, isDefault: isDefault === true }) });
}
export function setDefaultShoe(shoeId: string): Promise<ApiResult<{ ok: true }>> {
  return request(`/api/profile/shoes/${encodeURIComponent(shoeId)}/default`, { method: "POST" });
}
export function deleteShoe(shoeId: string): Promise<ApiResult<{ ok: true }>> {
  return request(`/api/profile/shoes/${encodeURIComponent(shoeId)}`, { method: "DELETE" });
}

// ---- coach access to an athlete's plan ----
export interface CoachRelationshipView {
  id: string;
  role: "coach" | "athlete";
  status: "pending" | "active" | "declined";
  requestedByMe: boolean;
  otherAccountId: string | null;
  otherName: string;
  createdAt: string;
}
export function listCoachRelationships(): Promise<ApiResult<{ relationships: CoachRelationshipView[] }>> {
  return request("/api/coach/relationships");
}
export function requestCoachRelationship(targetAccountId: string, asCoach: boolean): Promise<ApiResult<{ relationship: { id: string } }>> {
  return request(`/api/coach/${encodeURIComponent(targetAccountId)}/request`, { method: "POST", body: JSON.stringify({ asCoach }) });
}
export function respondToCoachRelationship(relationshipId: string, accept: boolean): Promise<ApiResult<{ relationship: { id: string; status: string } }>> {
  return request(`/api/coach/${encodeURIComponent(relationshipId)}/${accept ? "accept" : "decline"}`, { method: "POST" });
}
export function endCoachRelationship(relationshipId: string): Promise<ApiResult<{ ok: true }>> {
  return request(`/api/coach/relationships/${encodeURIComponent(relationshipId)}/end`, { method: "POST" });
}
export function getAthleteTrainingPlan(athleteId: string): Promise<ApiResult<{ plan: TrainingPlanView | null }>> {
  return request(`/api/coach/athletes/${encodeURIComponent(athleteId)}/training-plan`);
}
export function getAthleteTrainingPlanDays(athleteId: string, range?: { start?: string; end?: string }): Promise<ApiResult<{ days: TrainingPlanDayView[] }>> {
  const q = range ? `?${new URLSearchParams({ ...(range.start ? { start: range.start } : {}), ...(range.end ? { end: range.end } : {}) })}` : "";
  return request(`/api/coach/athletes/${encodeURIComponent(athleteId)}/training-plan/days${q}`);
}
export function setAthleteTrainingPlanDay(athleteId: string, date: string, input: TrainingPlanDayInput, slot?: TrainingDaySlot): Promise<ApiResult<{ day: TrainingPlanDayView }>> {
  return request(`/api/coach/athletes/${encodeURIComponent(athleteId)}/training-plan/days/${dayPath(date, slot)}`, { method: "PUT", body: JSON.stringify(input) });
}

export function getPrivacy(): Promise<ApiResult<{ settings: PrivacySettings }>> {
  return request("/api/profile/privacy");
}
/** Partial update merges server-side; response is the full settings record. */
export function putPrivacy(patch: Partial<PrivacySettings>): Promise<ApiResult<{ settings: PrivacySettings }>> {
  return request("/api/profile/privacy", { method: "PUT", body: JSON.stringify(patch) });
}

export interface ProfileDetailsPatch { name?: string; bio?: string | null; customTitle?: string | null; paceLabel?: string | null; runningGoal?: string | null; trainingBlock?: string | null; upcomingRaces?: string | null; instagramUrl?: string | null; facebookUrl?: string | null; tiktokUrl?: string | null; showSocialLinks?: boolean; }
/** Self-reported pace/goal/training-block/races, shown on the public profile. Partial update; response is the full public profile. */
export function putProfileDetails(patch: ProfileDetailsPatch): Promise<ApiResult<{ profile: RunnerProfileView }>> {
  return request("/api/profile/details", { method: "PUT", body: JSON.stringify(patch) });
}

// ------------------------------------------------------------------- tags
export type TagContentType = "run" | "post" | "event";
export interface TagView {
  id: string;
  contentType: TagContentType;
  contentId: string;
  taggedUserId: string;
  taggedByUserId: string;
  hiddenByTaggedUser: boolean;
  createdAt: string;
  /** Tagged runner's public profile — present on GET /api/tags rows. */
  taggedUser?: RunnerProfileView;
}
/** POST /api/tags — verified actor; no approval needed. */
export function createTag(input: { contentType: TagContentType; contentId: string; taggedUserId: string }): Promise<ApiResult<{ tag: TagView }>> {
  return request("/api/tags", { method: "POST", body: JSON.stringify(input) });
}
/** GET /api/tags?contentType=&contentId= — hidden rows drop unless you are the tagged user. */
export function getTags(contentType: TagContentType, contentId: string): Promise<ApiResult<{ tags: TagView[] }>> {
  return request(`/api/tags?contentType=${encodeURIComponent(contentType)}&contentId=${encodeURIComponent(contentId)}`);
}
/** PATCH /api/tags/:id/self — ONLY the tagged user may set their own flag. */
export function selfHideTag(tagId: string, hiddenByTaggedUser: boolean): Promise<ApiResult<{ tag: TagView }>> {
  return request(`/api/tags/${encodeURIComponent(tagId)}/self`, { method: "PATCH", body: JSON.stringify({ hiddenByTaggedUser }) });
}
/** One row of the runner's Tagged tab: the tag + its public content title. */
export interface RunnerTaggedRow {
  tag: { id: string; contentType: TagContentType; contentId: string; hiddenByTaggedUser: boolean; createdAt: string };
  content: { kind: "post" | "event"; id: string; title: string };
}
/** GET /api/runners/:id/tagged — gated by show_tagged_content server-side. */
export function getRunnerTagged(runnerId: string): Promise<ApiResult<{ tagged: RunnerTaggedRow[] }>> {
  return request(`/api/runners/${encodeURIComponent(runnerId)}/tagged`);
}
/** One row of the runner's public Activity tab (forum posts). */
export interface RunnerActivityRow {
  id: string;
  title: string;
  excerpt: string;
  section: string;
  createdAt: string;
}
/** GET /api/runners/:id/activity — forum posts + activity cards, both gated by show_past_activity server-side (per-card shareMode "private" is owner-only). */
export interface RunnerActivityResponse {
  activity: RunnerActivityRow[];
  /** The runner's activity cards (manual/auto records) visible to this viewer. */
  activityCards: PublicActivityCard[];
}
export function getRunnerActivity(runnerId: string): Promise<ApiResult<RunnerActivityResponse>> {
  return request(`/api/runners/${encodeURIComponent(runnerId)}/activity`);
}

/** One row of the runner's own private My Runs list. `kind` distinguishes an
 * RSVP'd event occurrence from a solo (personal) run. `kept`/`checkedIn` drive
 * past visibility: a past row is shown only when the runner checked in to that
 * occurrence or explicitly kept it ("Keep on My Runs"). */
export interface MyRunView {
  id: string;
  kind: "rsvp" | "solo";
  eventId: string;
  occurrenceId?: string | null;
  cityId: string;
  title: string;
  date: string;
  time: string;
  location: string;
  groupId: string;
  rsvpedAt: string;
  runDate?: string | null;
  startsAt?: string | null;
  distanceLabel?: string | null;
  upcoming?: boolean;
  past?: boolean;
  kept: boolean;
  checkedIn: boolean;
}
export const PERSONAL_RUN_CONSENT_VERSION = "2026-08-04.v1";
export interface PersonalRun { id:string; accountId:string; cityId:string; title:string; startsAt:string; locationLabel:string|null; distanceLabel:string|null; notes:string|null; visibility:"private"; consentVersion:string; consentedAt:string; createdAt:string; updatedAt:string; deletedAt:string|null; }
export function getPersonalRuns(): Promise<ApiResult<{runs: PersonalRun[]}>> { return request("/api/personal-runs"); }
export function createPersonalRun(input: Omit<PersonalRun, "id"|"accountId"|"visibility"|"consentVersion"|"consentedAt"|"createdAt"|"updatedAt"|"deletedAt"> & {consent:true}): Promise<ApiResult<{run:PersonalRun}>> { return request("/api/personal-runs", {method:"POST", body:JSON.stringify({...input, consentVersion: PERSONAL_RUN_CONSENT_VERSION})}); }
export function updatePersonalRun(id:string, input: Partial<Pick<PersonalRun,"cityId"|"title"|"startsAt"|"locationLabel"|"distanceLabel"|"notes">> & {consent:true}): Promise<ApiResult<{run:PersonalRun}>> { return request(`/api/personal-runs/${encodeURIComponent(id)}`, {method:"PATCH", body:JSON.stringify({...input, consentVersion: PERSONAL_RUN_CONSENT_VERSION})}); }
export function deletePersonalRun(id:string): Promise<ApiResult<{deleted:boolean}>> { return request(`/api/personal-runs/${encodeURIComponent(id)}`, {method:"DELETE"}); }
/**
 * The runner's own private My Runs list. `tzOffsetMinutes` is the browser's
 * `getTimezoneOffset()`: run start times are stored as UTC-encoded wall-clock
 * labels, so the server restores the real local instant to decide upcoming/past
 * exactly like the feed does — an occurrence dated the 11th stays upcoming
 * until its displayed local time, not the UTC-encoded label.
 */
export function getMyRuns(tzOffsetMinutes: number = new Date().getTimezoneOffset()): Promise<ApiResult<{ runs: MyRunView[] }>> { return request(`/api/my/runs?tzOffsetMinutes=${tzOffsetMinutes}`); }
/** Opt-in "Keep on My Runs" toggle — persists server-side on the exact row. */
export function keepMyRun(runId: string, kept: boolean): Promise<ApiResult<{ kept: boolean }>> { return request("/api/my/runs/keep", { method: "POST", body: JSON.stringify({ runId, kept }) }); }

/** Server-side RSVP — the shared-attendance basis for rating eligibility. */
export async function rsvpEvent(eventId: string, rsvp: boolean = true, runDate?: string, runId?: string): Promise<ApiResult<{ rsvped: boolean; occurrenceId?: string | null; runDate?: string | null; startsAt?: string | null }>> {
  const result = await request<{ rsvped: boolean; occurrenceId?: string | null; runDate?: string | null; startsAt?: string | null }>(
    "/api/events/rsvp",
    { method: "POST", body: JSON.stringify({ eventId, rsvp, ...(runDate ? { runDate } : {}), ...(runId ? { runId } : {}) }) },
  );
  // ACTIVATION signal - only on a real join, never on a cancellation. Wired
  // here rather than in a page component so both the DepartureBoard and the
  // management list report it identically.
  if (result.ok && rsvp && result.data.rsvped) {
    trackFirstRsvpOnce({ eventId });
  }
  return result;
}
export interface AttendanceSummaryEntry { host: { accountId: string; name: string; initials: string } | null; attendees: { accountId: string; name: string; initials: string; runsWithYou?: number }[]; goingCount: number; discussionCount?: number; lastDiscussionAt?: string | null; otherNewcomers?: number; }
export function getAttendanceSummary(occurrenceIds: string[]): Promise<ApiResult<{ summaries: Record<string, AttendanceSummaryEntry> }>> {
  return request("/api/events/attendance-summary", { method: "POST", body: JSON.stringify({ occurrenceIds }) });
}
export interface DiscussionView { id:string; kind:"thread"|"comment"; parentId:string|null; occurrenceId:string; eventId:string; cityId:string; title:string|null; body:string; authorId:string; createdAt:string; updatedAt:string; }
export function getOccurrenceDiscussion(eventId:string, occurrenceId:string): Promise<ApiResult<{discussion:DiscussionView[]}>> { return request(`/api/events/${encodeURIComponent(eventId)}/occurrences/${encodeURIComponent(occurrenceId)}/discussion`); }
export function createDiscussion(eventId:string, occurrenceId:string, input:{title?:string;body:string;parentId?:string}): Promise<ApiResult<{discussion:DiscussionView}>> { return request(`/api/events/${encodeURIComponent(eventId)}/occurrences/${encodeURIComponent(occurrenceId)}/discussion`, {method:"POST",body:JSON.stringify(input)}); }
export function deleteDiscussion(eventId:string, occurrenceId:string, id:string): Promise<ApiResult<{deleted:boolean}>> { return request(`/api/events/${encodeURIComponent(eventId)}/occurrences/${encodeURIComponent(occurrenceId)}/discussion/${encodeURIComponent(id)}`, {method:"DELETE"}); }

export function submitRating(input: {
  revieweeId: string;
  eventId: string;
  positive: boolean;
  tags?: string[];
  reason?: string;
}): Promise<ApiResult<{ rating: { id: string } }>> {
  return request("/api/ratings", { method: "POST", body: JSON.stringify(input) });
}

export function submitConcern(input: { subjectId: string; eventId: string; reason: string }): Promise<ApiResult<{ submitted: boolean }>> {
  return request("/api/concerns", { method: "POST", body: JSON.stringify(input) });
}

export interface AppealView {
  id: string;
  reason: string;
  status: "open" | "reinstated" | "upheld";
  createdAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
}
export function getMyAppeals(): Promise<ApiResult<{ appeals: AppealView[] }>> {
  return request("/api/appeals");
}
export function submitAppeal(reason: string): Promise<ApiResult<{ appeal: { id: string; status: string } }>> {
  return request("/api/appeals", { method: "POST", body: JSON.stringify({ reason }) });
}

// ------------------------------------------------------- admin trust tooling
export interface AdminCredentialRow {
  id: string;
  accountId: string;
  type: CredentialType;
  certifyingBody: string;
  issuedOn: string | null;
  expiresOn: string | null;
}
export function adminGetCredentials(reason: string): Promise<ApiResult<{ credentials: AdminCredentialRow[] }>> {
  return adminRequest("/api/admin/credentials", reason);
}
export function adminDecideCredential(id: string, action: "approve" | "reject", auditReason: string, decisionReason: string): Promise<ApiResult<{ credential: { id: string; status: string } }>> {
  // auditReason goes in the audited header; decisionReason is the per-row
  // note the applicant sees (credential.decisionReason) — kept separate.
  return adminRequest(`/api/admin/credentials/${id}/${action}`, auditReason, { method: "POST", body: JSON.stringify({ reason: decisionReason }) });
}
/** Audited admin-only proof URL (proof bytes never enter any JSON payload). */
export function adminCredentialProofUrl(id: string): string {
  return `/api/admin/credentials/${encodeURIComponent(id)}/proof`;
}

export interface AdminAppealRow {
  id: string;
  accountId: string;
  accountName: string;
  accountEmail: string;
  reason: string;
  status: "open" | "reinstated" | "upheld";
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
}
export function adminGetAppeals(reason: string): Promise<ApiResult<{ appeals: AdminAppealRow[] }>> {
  return adminRequest("/api/admin/appeals", reason);
}
/** Decide an appeal: reinstate clears under_review; uphold keeps it. */
export function adminDecideAppeal(id: string, action: "reinstate" | "uphold", auditReason: string, decisionReason: string): Promise<ApiResult<{ appeal: { id: string; status: string } }>> {
  return adminRequest(`/api/admin/appeals/${id}/${action}`, auditReason, { method: "POST", body: JSON.stringify({ reason: decisionReason }) });
}

export interface AdminTrustView {
  threshold: number;
  underReview: { accountId: string; name: string; email: string; underReviewAt: string | null }[];
}
export function adminGetTrust(reason: string): Promise<ApiResult<AdminTrustView>> {
  return adminRequest("/api/admin/trust", reason);
}
export function adminSetTrustThreshold(threshold: number, reason: string): Promise<ApiResult<{ threshold: number; newlyUnderReview: number }>> {
  return adminRequest("/api/admin/trust/threshold", reason, { method: "POST", body: JSON.stringify({ threshold }) });
}
/** Trusted Member (manual trust / blue-check) roster row - public fields only. */
export interface TrustedMemberRow {
  accountId: string;
  name: string;
  email: string;
  cityId: string | null;
  trustedMemberAt: string | null;
  trustedMember: boolean;
  status: string;
}
/** Global Admin grants the Trusted Member badge by account email (audited). */
export function adminGrantTrust(email: string, reason: string): Promise<ApiResult<{ member: TrustedMemberRow }>> {
  return adminRequest("/api/admin/trust/grant", reason, { method: "POST", body: JSON.stringify({ email }) });
}
/** Global Admin revokes the Trusted Member badge by account id (audited). */
export function adminRevokeTrust(accountId: string, reason: string): Promise<ApiResult<{ member: TrustedMemberRow }>> {
  return adminRequest(`/api/admin/trust/${encodeURIComponent(accountId)}/revoke`, reason, { method: "POST" });
}
/** Global Admin roster of every trusted member (routine audited read). */
export function adminGetTrustedMembers(reason: string): Promise<ApiResult<{ members: TrustedMemberRow[] }>> {
  return adminRequest("/api/admin/trust/members", reason);
}
/** City Admin grants the Trusted Member badge within their exact scope city (audited). */
export function cityGrantTrust(email: string, reason: string): Promise<ApiResult<{ member: TrustedMemberRow }>> {
  return adminRequest("/api/admin/city/trust/grant", reason, { method: "POST", body: JSON.stringify({ email }) });
}
/** City Admin revokes the Trusted Member badge within their exact scope city (audited). */
export function cityRevokeTrust(accountId: string, reason: string): Promise<ApiResult<{ member: TrustedMemberRow }>> {
  return adminRequest(`/api/admin/city/trust/${encodeURIComponent(accountId)}/revoke`, reason, { method: "POST" });
}
/** City Admin roster - trusted members in the caller's scope city only (routine audited read). */
export function cityGetTrustedMembers(reason: string): Promise<ApiResult<{ members: TrustedMemberRow[] }>> {
  return adminRequest("/api/admin/city/trust/members", reason);
}

export interface MyGroupMembership { id:string; groupId:string; cityId:string; groupName:string; status:"pending"|"active"|"declined"|"revoked"|"left"; requestedAt:string; updatedAt:string; websiteUrl?: string | null }
export function getMyGroups(): Promise<ApiResult<{memberships:MyGroupMembership[]}>> { return request("/api/me/groups"); }
export function openGroupChat(groupId: string): Promise<ApiResult<{ conversationId: string }>> { return request(`/api/groups/${encodeURIComponent(groupId)}/chat`); }
export function requestGroupMembership(groupId:string): Promise<ApiResult<{membership:MyGroupMembership}>> { return request(`/api/groups/${encodeURIComponent(groupId)}/membership`, {method:"POST",body:"{}"}); }
export function updateGroupMembership(groupId:string, action:"leave"|"approve"|"decline"|"remove", accountId?:string): Promise<ApiResult<{membership:MyGroupMembership}>> { return request(`/api/groups/${encodeURIComponent(groupId)}/membership/${action}`, {method:"POST",body:JSON.stringify(accountId?{accountId}:{})}); }
/** Leader identity shown to group managers — public fields only. */
export interface LeaderIdentity { id: string; name: string; username: string | null; profilePhotoUrl: string | null; }
/** One group the signed-in account manages (owner/leader, or in-scope admin). */
export interface LedGroupRow {
  groupId: string; groupName: string; cityId: string; ownerId: string | null;
  role: "owner" | "leader" | "city_admin" | "global_admin"; pendingCount: number;
  canManageLeaders: boolean; leaders: LeaderIdentity[];
  /** Public profile fields the manage form initializes from (server truth). */
  description: string; membershipMode: "open" | "request";
}
/** Pending membership request visible in the leader queue. */
export interface PendingRequestRow {
  membershipId: string; groupId: string; accountId: string; name: string;
  username: string | null; profilePhotoUrl: string | null; requestedAt: string;
}
export function getMyLedGroups(): Promise<ApiResult<{ groups: LedGroupRow[] }>> { return request("/api/me/leader/groups"); }
export function getLeaderQueue(): Promise<ApiResult<{ pending: PendingRequestRow[] }>> { return request("/api/me/leader/queue"); }
export function assignGroupLeader(groupId: string, email: string, reason: string): Promise<ApiResult<{ leaders: LeaderIdentity[]; ownerId: string | null }>> {
  return request(`/api/groups/${encodeURIComponent(groupId)}/leaders`, { method: "POST", body: JSON.stringify({ email, reason }) });
}
export function removeGroupLeader(groupId: string, accountId: string, reason: string): Promise<ApiResult<{ leaders: LeaderIdentity[]; ownerId: string | null }>> {
  return request(`/api/groups/${encodeURIComponent(groupId)}/leaders/${encodeURIComponent(accountId)}`, { method: "DELETE", body: JSON.stringify({ reason }) });
}
export function transferGroupOwnership(groupId: string, accountId: string, reason: string): Promise<ApiResult<{ leaders: LeaderIdentity[]; ownerId: string | null }>> {
  return request(`/api/groups/${encodeURIComponent(groupId)}/ownership`, { method: "POST", body: JSON.stringify({ accountId, reason }) });
}
export interface GroupProfilePatch { description?: string; websiteUrl?: string | null; facebookUrl?: string | null; instagramUrl?: string | null; membershipMode?: "open" | "request"; }
export function updateGroupProfile(groupId: string, patch: GroupProfilePatch, reason: string): Promise<ApiResult<{ leaders: LeaderIdentity[]; ownerId: string | null }>> {
  return request(`/api/groups/${encodeURIComponent(groupId)}/profile`, { method: "PATCH", body: JSON.stringify({ ...patch, reason }) });
}


export type WaiverStatus = {groupId:string;status:"not_required"|"unsigned"|"signed"|"expired";version:number|null;expiresAt:string|null};
export const getMyWaivers = () => request<{waivers:WaiverStatus[]}>("/api/me/waivers");
export const getGroupWaiver = (groupId:string) => request<{waiver:{id:string;groupId:string;version:number;text:string;createdAt:string}|null}>(`/api/groups/${encodeURIComponent(groupId)}/waiver`);
export const createGroupWaiver = (groupId:string,text:string) => request<{waiver:unknown}>(`/api/groups/${encodeURIComponent(groupId)}/waiver`,{method:"POST",body:JSON.stringify({text})});
export const signGroupWaiver = (groupId:string) => request<{signature:{signedAt:string;expiresAt:string;versionId:string}}>(`/api/groups/${encodeURIComponent(groupId)}/waiver/sign`,{method:"POST"});

// ------------------------------------------------------------ organizer check-in
// Privacy contract (server-enforced): the roster is private to the group's
// verified leaders; rows carry only public identity + RSVP/check-in/waiver
// facts. QR sessions are occurrence-bound, expiring, and hash-only stored —
// the raw token is returned once and grants only the caller's own actions.
export type WaiverState = { status: "not_required" | "unsigned" | "signed" | "expired"; version: number | null; expiresAt: string | null };
export interface RosterRow {
  accountId: string;
  name: string;
  username: string | null;
  rsvpedAt: string;
  checkedIn: boolean;
  checkedInAt: string | null;
  checkedInBy: string | null;
  waiver: WaiverState;
  /** First run with this group. Leader-only — the roster is role-gated. */
  firstTimeWithGroup: boolean;
}
export interface RosterView {
  event: { id: string; title: string; runDate: string; startsAt: string; time: string; location: string; groupId: string; groupName: string; cityId: string };
  occurrenceId: string;
  roster: RosterRow[];
}
export function rosterUrl(groupId: string, eventId: string, occurrenceId: string): string {
  return `/api/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/occurrences/${encodeURIComponent(occurrenceId)}`;
}
export const getRoster = (groupId: string, eventId: string, occurrenceId: string) => request<RosterView>(`${rosterUrl(groupId, eventId, occurrenceId)}/roster`);
export const leaderCheckin = (groupId: string, eventId: string, occurrenceId: string, accountId: string) => request<{ checkin: { id: string; accountId: string; checkedInAt: string; checkedInBy: string; source: string } }>(`${rosterUrl(groupId, eventId, occurrenceId)}/checkin`, { method: "POST", body: JSON.stringify({ accountId }) });
export const leaderUndoCheckin = (groupId: string, eventId: string, occurrenceId: string, accountId: string) => request<{ removed: boolean }>(`${rosterUrl(groupId, eventId, occurrenceId)}/checkin/undo`, { method: "POST", body: JSON.stringify({ accountId }) });
export interface QrSessionView { id: string; eventId: string; occurrenceId: string; runDate: string; groupId: string; expiresAt: string; token: string; }
export const createQrSession = (groupId: string, eventId: string, occurrenceId: string) => request<{ session: QrSessionView }>(`${rosterUrl(groupId, eventId, occurrenceId)}/qr`, { method: "POST" });
export interface CheckinSessionView {
  session: {
    eventId: string; occurrenceId: string; runDate: string; groupId: string; cityId: string; expiresAt: string;
    event: { title: string; time: string; location: string; distanceLabel: string; startsAt: string; groupName: string };
  };
  me: { rsvped: boolean; checkedIn: boolean; checkedInAt: string | null; waiver: WaiverState } | null;
}
export const getCheckinSession = (token: string) => request<CheckinSessionView>(`/api/checkin/session/${encodeURIComponent(token)}`);
export const joinCheckinSession = (token: string) => request<{ rsvped: boolean }>(`/api/checkin/session/${encodeURIComponent(token)}/join`, { method: "POST" });
export const signCheckinWaiver = (token: string) => request<{ signature: { signedAt: string; expiresAt: string; versionId: string } }>(`/api/checkin/session/${encodeURIComponent(token)}/sign`, { method: "POST" });
/**
 * The runner's own check-in. Returns the LIFETIME COUNT alongside the record —
 * groupCount is what the confirmation says, because she just ran with this club
 * and belonging somewhere lands harder than a global statistic.
 */
export const checkinViaSession = (token: string) => request<{ checkin: { id: string; checkedInAt: string; duplicate: boolean; groupId: string; groupCount: number; lifetimeTotal: number; alsoHere?: { name: string; runsTogether: number } } }>(`/api/checkin/session/${encodeURIComponent(token)}/checkin`, { method: "POST" });

// ---- Product feedback (roadmap 0.7) ---------------------------------------
export type FeedbackCategory = "broken" | "confusing" | "idea" | "praise";
export interface FeedbackContext {
  path: string;
  role?: string | null;
  viewport?: string | null;
  appVersion?: string | null;
  recentActions?: string[];
  onScreenError?: string | null;
}
export function submitFeedback(category: FeedbackCategory, message: string, context: FeedbackContext): Promise<ApiResult<{ id: string }>> {
  return request("/api/feedback", { method: "POST", body: JSON.stringify({ category, message, ...context }) });
}

/** Public going-counts — no auth, counts only, never identities. Powers the marketing preview (roadmap 1.4). */
export function getPublicGoingCounts(occurrenceIds: string[]): Promise<ApiResult<{ summaries: { eventId: string; goingCount: number }[] }>> {
  return request(`/api/events/public-summary?ids=${encodeURIComponent(occurrenceIds.join(","))}`);
}

/**
 * Can this city accept a signup right now?
 *
 * Called BEFORE supabase.signUp(), which creates an auth user and sends a
 * confirmation email. Without this pre-check a refused signup leaves a Supabase
 * identity with no Kimbio account behind it — an orphan needing manual cleanup.
 */
export function getSignupStatus(cityId: string): Promise<ApiResult<{ open: boolean; requiresInvite?: boolean; reason?: string; message?: string }>> {
  return request(`/api/signup-status?city=${encodeURIComponent(cityId)}`);
}

/* ── Invitations (admin) ──────────────────────────────────────────────────── */

export interface InvitationView {
  id: string;
  cityId: string;
  email: string;
  createdAt: string;
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  valid: boolean;
  /** Present only while unredeemed, so the list can rebuild the link. */
  token: string | null;
}

/**
 * All three of these route through adminRequest so the audit header is always
 * present. Written with plain request() first, which is why revoke 400'd and
 * minting reported a failure it had not had — the reason split changed the
 * server side and these were never updated to match.
 */
export function listInvitations(cityId?: string, reason = "Invitation list"): Promise<ApiResult<{ invitations: InvitationView[] }>> {
  return adminRequest(`/api/admin/invitations${cityId ? `?city=${encodeURIComponent(cityId)}` : ""}`, reason);
}

/**
 * Mint an invitation. The raw token is returned ONCE and never again — only its
 * hash is stored — so the caller must surface it immediately or it is lost.
 */
export function createInvitation(input: { cityId: string; email: string; expiresInDays?: number }, reason = "Invitation created"): Promise<ApiResult<{ invitation: InvitationView; token: string }>> {
  return adminRequest("/api/admin/invitations", reason, { method: "POST", body: JSON.stringify(input) });
}

export function revokeInvitation(id: string, reason = "Invitation revoked"): Promise<ApiResult<{ invitation: InvitationView }>> {
  return adminRequest(`/api/admin/invitations/${encodeURIComponent(id)}/revoke`, reason, { method: "POST" });
}

/**
 * The link to send. Carries BOTH token and email because invitations are
 * email-bound and validateInvitation() looks the record up by (city, email) —
 * the token alone cannot find it. Including the email also lets signup prefill
 * and lock the field, removing the mismatch failure rather than explaining it.
 */
export function invitationUrl(email: string, token: string): string {
  const base = typeof window !== "undefined" ? window.location.origin : "https://getkimbio.com";
  return `${base}/login?mode=signup&invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}

/**
 * Join the waitlist. Public — the people who need it cannot sign up.
 *
 * Idempotent server-side: a second submission returns ok with alreadyOn: true
 * rather than an error, because an error on a waitlist form reads as rejection.
 */
export function joinWaitlist(input: { email: string; name?: string }): Promise<ApiResult<{ ok: true; alreadyOn: boolean }>> {
  // UTM travels with the signup so an ad can be measured against signups
  // rather than clicks — it has been captured since launch with nowhere to land.
  return request("/api/waitlist", { method: "POST", body: JSON.stringify({ ...input, ...getStoredUtm() }) });
}

/* ── Waitlist (admin) ─────────────────────────────────────────────────────── */

export interface WaitlistEntryView {
  id: string;
  email: string;
  name: string | null;
  source: string | null;
  createdAt: string;
  status: "interested" | "invited" | "joined";
  invitedAt: string | null;
}

/**
 * Routed through adminRequest like every other /api/admin call. `reason` is
 * optional because this is a read — see the audit split. Calling it with plain
 * request() is the mistake that broke revoke and minting.
 */
export function listWaitlist(reason = ""): Promise<ApiResult<{ entries: WaitlistEntryView[]; total: number }>> {
  return adminRequest("/api/admin/waitlist", reason);
}

/* ── Safety reports (admin) ───────────────────────────────────────────────── */

export interface SafetyReportView {
  id: string;
  cityId: string;
  contextType: "join_request" | "event" | "personal_run";
  contextId: string;
  status: "open" | "under_review" | "resolved" | "dismissed";
  reason: string;
  /** Who reported, and whom. Without these the queue is unactionable. */
  reporterId: string;
  reporterName: string;
  subjectId: string;
  subjectName: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

/**
 * Reports could be FILED and not READ — the endpoint existed with no client
 * caller, which the architecture doc calls worse than having no reporting at
 * all, because the form implies someone is looking.
 */
export function listSafetyReports(cityId?: string, reason = ""): Promise<ApiResult<{ reports: SafetyReportView[] }>> {
  return adminRequest(`/api/admin/safety-reports${cityId ? `?city=${encodeURIComponent(cityId)}` : ""}`, reason);
}

/** Reason REQUIRED — admin.safety_report_resolve is a contested judgement. */
export function decideSafetyReport(id: string, status: SafetyReportView["status"], reason: string): Promise<ApiResult<{ report: SafetyReportView }>> {
  return adminRequest(`/api/admin/safety-reports/${encodeURIComponent(id)}`, reason, { method: "POST", body: JSON.stringify({ status }) });
}

export interface OccurrenceAttendee { id: string; name: string; initials: string; isHost: boolean }

/**
 * The full VISIBLE attendee list for one run.
 *
 * Separate from the board's capped summary because the card wants four names
 * and she wants to know whether one specific person is going. Filtered through
 * hiddenFrom server-side, so it never returns someone hidden from this viewer —
 * and its length is deliberately NOT the going count, which stays unfiltered so
 * a block cannot be read off a smaller number.
 */
export function getOccurrenceAttendees(occurrenceId: string): Promise<ApiResult<{ attendees: OccurrenceAttendee[] }>> {
  return request(`/api/occurrences/${encodeURIComponent(occurrenceId)}/attendees`);
}

export interface RosterMemberRow {
  membershipId: string;
  groupId: string;
  groupName: string;
  accountId: string;
  name: string;
  username: string | null;
  profilePhotoUrl: string | null;
  joinedAt: string;
  isLead: boolean;
}

/** Active members of every group you lead. */
export function getLeaderRoster(): Promise<ApiResult<{ members: RosterMemberRow[] }>> {
  return request("/api/me/leader/roster");
}

export interface MyCheckinCounts {
  total: number;
  groups: { groupId: string; name: string; count: number }[];
}

/**
 * Your own lifetime check-in count. Owner-only by design.
 *
 * A public run count is a presence signal — "32 with Columbia Track Club" says
 * how reliably someone attends and which club — so it stays on your own
 * surfaces. The confirmation gives the number at the moment it changes; this is
 * the cumulative view where milestones live.
 */
export function getMyCheckins(): Promise<ApiResult<MyCheckinCounts>> {
  return request("/api/me/checkins");
}

/**
 * Choose a default avatar.
 *
 * Separate from the photo upload: different acts, different friction. Either
 * one satisfies the pre-RSVP requirement — the point is a face on the list, not
 * a photograph specifically.
 */
export function setAvatarStyle(style: string): Promise<ApiResult<{ avatarStyle: string }>> {
  return request("/api/me/avatar", { method: "POST", body: JSON.stringify({ style }) });
}

export interface ClubWeekRow { groupId: string; groupName: string; runsHeld: number; youWereAt: number }

/**
 * What your groups did this week and what you were part of.
 *
 * The club's number comes from the schedule — already public on the board — and
 * only your own attendance is read. Nothing here aggregates other people.
 */
export function getClubWeek(): Promise<ApiResult<{ clubs: ClubWeekRow[] }>> {
  return request("/api/me/club-week");
}

/**
 * Remove one notification. A delete, not a flag — a notification is a nudge,
 * not a record, and the thing it points at still exists.
 */
export const dismissNotification = (id: string) =>
  request<{ removed: boolean }>(`/api/notifications/${encodeURIComponent(id)}`, { method: "DELETE" });

/**
 * Clear everything already read. Never clears unread: that is the queue, and it
 * is the one state that cannot be recovered by looking somewhere else.
 */
export const clearReadNotifications = () =>
  request<{ removed: number }>("/api/notifications/clear-read", { method: "POST" });
