/**
 * Typed client for the Run Local API (/api/*, same origin).
 *
 * All calls return explicit discriminated results — the UI never has to guess
 * whether the backend is configured. No verification data is stored
 * client-side; sessions are HttpOnly cookies set by the server.
 */
import type { Me, OpRole } from "./accounts";
import { normalizeErrorCode, normalizeErrorMessage } from "./errors";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
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
      return { ok: false, error: new ApiError(res.status, normalizeErrorCode(b.error), normalizeErrorMessage(b.message, normalizeErrorMessage(b.error))) };
    }
    return { ok: true, data: body as T };
  } catch {
    return {
      ok: false,
      error: new ApiError(0, "network_error", "Could not reach the Run Local server. Check your connection."),
    };
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
export async function createAccount(input: { name: string; username: string; email: string; phone?: string; birthdate: string; cityId: string; requestedRole?: "runner" | "group_leader"; noSession?: boolean; utm_source?: string; utm_medium?: string; utm_campaign?: string }): Promise<ApiResult<{ account: import("./accounts").PublicAccount }>> {
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
export function adminGetOverview(): Promise<ApiResult<AdminOverview>> {
  return request("/api/admin/overview");
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
function adminRequest<T>(path: string, reason: string, init?: RequestInit): Promise<ApiResult<T>> {
  return request<T>(path, {
    ...init,
    headers: { "x-audit-reason": reason },
  });
}

export function adminLogin(key: string): Promise<ApiResult<{ ok: true; admin: string }>> {
  return request("/api/admin/login", { method: "POST", body: JSON.stringify({ key }) });
}

export function adminLogout(): Promise<ApiResult<{ ok: true }>> {
  return request("/api/admin/logout", { method: "POST" });
}

export function adminSearch(query: string): Promise<ApiResult<{ results: AdminSearchRow[] }>> {
  return request(`/api/admin/search?q=${encodeURIComponent(query)}`);
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
export function adminPending(): Promise<ApiResult<{ results: PendingQueueRow[] }>> {
  return request("/api/admin/pending");
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
      headers: { "x-audit-reason": reason },
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
    return { ok: false, error: new ApiError(0, "network_error", "Could not reach the Run Local server.") };
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
  time: string; location: string; distanceLabel: string; invite: string; externalUrl?: string; description?: string;
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
export interface CanonicalEvent { id: string; seedRefId: string | null; cityId: string; groupId: string; title: string; dayOfWeek: number; /** One-time events carry an exact date; recurring events leave this null. */ scheduleDate?: string | null; time: string; location: string; distanceLabel: string; invite: "Open to all" | "Members + guests" | "RSVP requested"; externalUrl: string | null; provenance: "seed" | "community" | "admin"; status: "draft" | "approved" | "published" | "hidden" | "archived"; hidden: boolean; createdAt: string; updatedAt: string; createdBy: string; updatedBy: string; archivedAt: string | null; /** Server-computed moderation capabilities for the requesting account (hide/restore/delete for leads/admins). Optional — older server responses omit it; callers treat undefined as []. */ capabilities?: string[]; /** Confirmation threshold for informal proposals — undefined/0 means no threshold, always confirmed. */ minParticipants?: number; confirmedCount?: number; isConfirmedGroupRun?: boolean; }
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
  return request(`/api/admin/sponsors?city=${encodeURIComponent(cityId)}`, { headers: { "x-audit-reason": reason } });
}
export function adminCreateSponsor(
  input: { cityId: string; tier: "featured" | "standard"; businessName: string; tagline: string; linkUrl: string; logoRef?: string | null; active?: boolean; startDate: string; endDate: string },
  reason: string,
): Promise<ApiResult<{ sponsor: AdminSponsorView }>> {
  return request("/api/admin/sponsors", { method: "POST", headers: { "x-audit-reason": reason }, body: JSON.stringify(input) });
}
export function adminUpdateSponsor(
  id: string,
  patch: Partial<{ tier: "featured" | "standard"; businessName: string; tagline: string; linkUrl: string; logoRef: string | null; active: boolean; startDate: string; endDate: string }>,
  reason: string,
): Promise<ApiResult<{ sponsor: AdminSponsorView }>> {
  return request(`/api/admin/sponsors/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "x-audit-reason": reason }, body: JSON.stringify(patch) });
}
export function adminDeleteSponsor(id: string, reason: string): Promise<ApiResult<{ deleted: true }>> {
  return request(`/api/admin/sponsors/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-audit-reason": reason } });
}
export function adminUploadSponsorLogo(photoDataUrl: string, reason: string): Promise<ApiResult<{ logoRef: string }>> {
  return request("/api/admin/sponsors/logo", { method: "POST", headers: { "x-audit-reason": reason }, body: JSON.stringify({ photo: photoDataUrl }) });
}
export function adminListGeofenceAllowlist(reason: string): Promise<ApiResult<{ emails: string[] }>> {
  return request("/api/admin/geofence-allowlist", { headers: { "x-audit-reason": reason } });
}
export function adminAddGeofenceAllowlistEmail(email: string, reason: string): Promise<ApiResult<{ emails: string[] }>> {
  return request("/api/admin/geofence-allowlist", { method: "POST", headers: { "x-audit-reason": reason }, body: JSON.stringify({ email }) });
}
export function adminRemoveGeofenceAllowlistEmail(email: string, reason: string): Promise<ApiResult<{ emails: string[] }>> {
  return request(`/api/admin/geofence-allowlist/${encodeURIComponent(email)}`, { method: "DELETE", headers: { "x-audit-reason": reason } });
}
export function getSponsorPaymentsStatus(): Promise<ApiResult<{ configured: boolean }>> {
  return request("/api/admin/sponsors/payments-status");
}
export function createSponsorCheckoutLink(sponsorId: string, reason: string): Promise<ApiResult<{ url: string }>> {
  return request("/api/admin/sponsors/checkout", { method: "POST", headers: { "x-audit-reason": reason }, body: JSON.stringify({ sponsorId, successUrl: window.location.href, cancelUrl: window.location.href }) });
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
export function getActivityFeed(city: string): Promise<ApiResult<{ cards: PublicActivityCard[] }>> { return request(`/api/activity/feed?city=${encodeURIComponent(city)}`); }
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
  mutualConnectionsCount?: number;
  /** Whether the runner's show_connections_list lets this viewer see the count. */
  mutualVisible?: boolean;
  /** Structured training plan, when set — takes precedence over the free-text trainingBlock field for display. */
  trainingPlan?: { planType: TrainingPlanType; customLabel: string | null; totalWeeks: number; currentWeek: number; linkedRaceName: string | null } | null;
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
/** POST /api/connections/:id/block — writes a block + removes any active row. */
export function blockConnection(accountId: string): Promise<ApiResult<{ status: string }>> {
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
/** GET /api/runners/:id/activity — gated by show_past_activity server-side. */
export function getRunnerActivity(runnerId: string): Promise<ApiResult<{ activity: RunnerActivityRow[] }>> {
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
export function rsvpEvent(eventId: string, rsvp: boolean = true, runDate?: string, runId?: string): Promise<ApiResult<{ rsvped: boolean; occurrenceId?: string | null; runDate?: string | null; startsAt?: string | null }>> {
  return request("/api/events/rsvp", { method: "POST", body: JSON.stringify({ eventId, rsvp, ...(runDate ? { runDate } : {}), ...(runId ? { runId } : {}) }) });
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
export const checkinViaSession = (token: string) => request<{ checkin: { id: string; checkedInAt: string; duplicate: boolean } }>(`/api/checkin/session/${encodeURIComponent(token)}/checkin`, { method: "POST" });
