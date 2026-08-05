/**
 * Typed client for the Run Local API (/api/*, same origin).
 *
 * All calls return explicit discriminated results — the UI never has to guess
 * whether the backend is configured. No verification data is stored
 * client-side; sessions are HttpOnly cookies set by the server.
 */
import type { Me } from "./accounts";
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

export type NotificationPreferences = { run_reminders:boolean; community_updates:boolean; account_alerts:boolean; };
export type InAppNotification = { id:string; category:keyof NotificationPreferences; title:string; body:string; createdAt:string; readAt:string|null };
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
export async function createAccount(input: { name: string; username: string; email: string; phone?: string; birthdate: string; cityId: string; requestedRole?: "runner" | "group_leader"; noSession?: boolean }): Promise<ApiResult<{ account: import("./accounts").PublicAccount }>> {
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
  return adminRequest(`/api/admin/records/${id}/${action}?role=${role}`, reason, { method: "POST" });
}

/** Owner-only read: fetch the pending-users queue. Read access is authorized
 * server-side without an audit reason; decisions remain reason-required. */
export function adminPending(): Promise<ApiResult<{ results: PendingQueueRow[] }>> {
  return request("/api/admin/pending");
}

export function adminDeleteRecord(id: string, reason: string): Promise<ApiResult<{ ok: true }>> {
  return adminRequest(`/api/admin/records/${id}/delete`, reason, { method: "POST" });
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
export type SubmissionStatus = "pending" | "approved" | "rejected";

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
}

export function submitRace(input: {
  cityId?: string; name: string; distances: string; date: string; location: string; registrationUrl: string; description?: string;
}): Promise<ApiResult<{ submission: { id: string; status: string } }>> {
  return request("/api/submissions/race", { method: "POST", body: JSON.stringify(input) });
}

export function submitGroup(input: {
  cityId?: string; name: string; description?: string; groupType: "rrca-chartered" | "community";
  groupmeUrl?: string; facebookUrl?: string; instagramUrl?: string; websiteUrl?: string; coverPhoto?: string; logoPhoto?: string; membershipMode?: "open" | "request";
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

export function adminGetSubmissions(cityId: string | null, reason: string): Promise<ApiResult<{ results: SubmissionQueueRow[] }>> {
  const q = cityId ? `?city=${encodeURIComponent(cityId)}` : "";
  return adminRequest(`/api/admin/submissions${q}`, reason);
}

export function adminDecideSubmission(id: string, action: "approve" | "reject", reason: string): Promise<ApiResult<{ ok: true }>> {
  return adminRequest(`/api/admin/submissions/${id}/${action}`, reason, { method: "POST" });
}

// -------------------------------------------------- public approved content
export interface PublicUserRace {
  id: string; kind: "race"; name: string; date: string; distance: string; location: string;
  organizer: string; price: string; registrationUrl: string; registrationOpen: boolean;
  registrationNote: string; description: string;
}
export interface PublicUserGroup {
  id: string; kind: "group"; name: string; groupType: "rrca-chartered" | "community"; description: string;
  groupmeUrl: string | null; facebookUrl: string | null; instagramUrl: string | null; websiteUrl: string | null; coverPhotoUrl?: string; logoPhotoUrl?: string; membershipMode?: "open" | "request"; rrcaVerified?: boolean; leaders?: {id:string;name:string}[];
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
export interface CanonicalEvent { id: string; seedRefId: string | null; cityId: string; groupId: string; title: string; dayOfWeek: number; time: string; location: string; distanceLabel: string; invite: "Open to all" | "Members + guests" | "RSVP requested"; externalUrl: string | null; provenance: "seed" | "community" | "admin"; status: "draft" | "approved" | "published" | "hidden" | "archived"; hidden: boolean; createdAt: string; updatedAt: string; createdBy: string; updatedBy: string; archivedAt: string | null; }
export function getCanonicalEvents(cityId: string): Promise<ApiResult<{ cityId: string | null; events: CanonicalEvent[] }>> { return request(`/api/events?city=${encodeURIComponent(cityId)}`); }
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

export interface MyRunView { id: string; eventId: string; occurrenceId?: string | null; cityId: string; title: string; date: string; time: string; location: string; groupId: string; rsvpedAt: string; }
export const PERSONAL_RUN_CONSENT_VERSION = "2026-08-04.v1";
export interface PersonalRun { id:string; accountId:string; cityId:string; title:string; startsAt:string; locationLabel:string|null; distanceLabel:string|null; notes:string|null; visibility:"private"; consentVersion:string; consentedAt:string; createdAt:string; updatedAt:string; deletedAt:string|null; }
export function getPersonalRuns(): Promise<ApiResult<{runs: PersonalRun[]}>> { return request("/api/personal-runs"); }
export function createPersonalRun(input: Omit<PersonalRun, "id"|"accountId"|"visibility"|"consentVersion"|"consentedAt"|"createdAt"|"updatedAt"|"deletedAt"> & {consent:true}): Promise<ApiResult<{run:PersonalRun}>> { return request("/api/personal-runs", {method:"POST", body:JSON.stringify({...input, consentVersion: PERSONAL_RUN_CONSENT_VERSION})}); }
export function updatePersonalRun(id:string, input: Partial<Pick<PersonalRun,"cityId"|"title"|"startsAt"|"locationLabel"|"distanceLabel"|"notes">> & {consent:true}): Promise<ApiResult<{run:PersonalRun}>> { return request(`/api/personal-runs/${encodeURIComponent(id)}`, {method:"PATCH", body:JSON.stringify({...input, consentVersion: PERSONAL_RUN_CONSENT_VERSION})}); }
export function deletePersonalRun(id:string): Promise<ApiResult<{deleted:boolean}>> { return request(`/api/personal-runs/${encodeURIComponent(id)}`, {method:"DELETE"}); }
export function getMyRuns(): Promise<ApiResult<{ runs: MyRunView[] }>> { return request("/api/my/runs"); }

/** Server-side RSVP — the shared-attendance basis for rating eligibility. */
export function rsvpEvent(eventId: string, rsvp: boolean = true, runDate?: string): Promise<ApiResult<{ rsvped: boolean }>> {
  return request("/api/events/rsvp", { method: "POST", body: JSON.stringify({ eventId, rsvp, ...(runDate ? { runDate } : {}) }) });
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
export function adminDecideCredential(id: string, action: "approve" | "reject", reason: string): Promise<ApiResult<{ credential: { id: string; status: string } }>> {
  return adminRequest(`/api/admin/credentials/${id}/${action}`, reason, { method: "POST", body: JSON.stringify({ reason }) });
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

export interface MyGroupMembership { id:string; groupId:string; cityId:string; groupName:string; status:"pending"|"active"|"declined"|"revoked"|"left"; requestedAt:string; updatedAt:string }
export function getMyGroups(): Promise<ApiResult<{memberships:MyGroupMembership[]}>> { return request("/api/me/groups"); }
export function requestGroupMembership(groupId:string): Promise<ApiResult<{membership:MyGroupMembership}>> { return request(`/api/groups/${encodeURIComponent(groupId)}/membership`, {method:"POST",body:"{}"}); }
export function updateGroupMembership(groupId:string, action:"leave"|"approve"|"decline"|"remove", accountId?:string): Promise<ApiResult<{membership:MyGroupMembership}>> { return request(`/api/groups/${encodeURIComponent(groupId)}/membership/${action}`, {method:"POST",body:JSON.stringify(accountId?{accountId}:{})}); }
