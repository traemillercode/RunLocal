/**
 * Typed client for the Run Local API (/api/*, same origin).
 *
 * All calls return explicit discriminated results — the UI never has to guess
 * whether the backend is configured. No verification data is stored
 * client-side; sessions are HttpOnly cookies set by the server.
 */
import type { Me } from "./accounts";

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
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: "invalid_response" };
    }
    if (!res.ok) {
      const b = body as { error?: string; message?: string };
      return { ok: false, error: new ApiError(res.status, b.error ?? "request_failed", b.message) };
    }
    return { ok: true, data: body as T };
  } catch {
    return {
      ok: false,
      error: new ApiError(0, "network_error", "Could not reach the Run Local server. Check your connection."),
    };
  }
}

// ------------------------------------------------------------------ health
export interface HealthInfo {
  ok: true;
  /** Supabase email verification provider configured (browser-safe env vars present). */
  supabaseConfigured: boolean;
  /** Names of missing provider vars only — never values, never secrets. */
  supabaseMissing: string[];
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
export function createAccount(input: { name: string; username: string; email: string; phone?: string; birthdate: string; cityId: string; requestedRole?: "runner" | "group_leader"; noSession?: boolean }): Promise<ApiResult<{ account: import("./accounts").PublicAccount }>> {
  return request("/api/accounts", { method: "POST", body: JSON.stringify(input) });
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

// -------------------------------------------------------------------- admin
export interface AdminSearchRow {
  id: string;
  name: string;
  email: string;
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

/** Admin calls attach the mandatory reason header; the server audits it. */
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

export function adminSearch(query: string, reason: string): Promise<ApiResult<{ results: AdminSearchRow[] }>> {
  return adminRequest(`/api/admin/search?q=${encodeURIComponent(query)}`, reason);
}

export function adminGetRecord(id: string, reason: string): Promise<ApiResult<{ record: AdminRecordView }>> {
  return adminRequest(`/api/admin/records/${id}`, reason);
}

export function adminSetStatus(id: string, action: "approve" | "reject", reason: string, role: "runner" | "group_leader" = "runner"): Promise<ApiResult<{ ok: true }>> {
  return adminRequest(`/api/admin/records/${id}/${action}?role=${role}`, reason, { method: "POST" });
}

/** Owner-only: fetch the pending-users queue (audited with the reason). */
export function adminPending(reason: string): Promise<ApiResult<{ results: PendingQueueRow[] }>> {
  return adminRequest("/api/admin/pending", reason);
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
  groupmeUrl?: string; facebookUrl?: string; instagramUrl?: string; websiteUrl?: string;
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
  groupmeUrl: string | null; facebookUrl: string | null; instagramUrl: string | null; websiteUrl: string | null;
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
export function getConnection(provider: ActivityProvider): Promise<ApiResult<{ authorizeUrl?: string; connected?: boolean; shareMode?: ShareMode }>> { return request(`/api/connections/${provider}`); }
export function disconnectConnection(provider: ActivityProvider, deleteActivities: boolean): Promise<ApiResult<{ disconnected: boolean; deletedActivities: boolean }>> { return request(`/api/connections/${provider}/disconnect`, { method: "POST", body: JSON.stringify({ deleteActivities }) }); }
