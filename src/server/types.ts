/**
 * Server-side identity & verification record model.
 *
 * These records are sensitive (phone, selfie reference, IP history) and must
 * NEVER be shipped to the browser. The public surface is `toPublicAccount()`
 * in `store.ts`, which deliberately excludes every sensitive field.
 *
 * Retention rules (see `retention.ts`):
 *  - Sensitive fields (phone, selfie, IP history, signup IP) are scrubbed
 *    immediately when the user deletes their account, and after the configured
 *    inactivity period (default 3 years) by the purge job.
 *  - Login IP history is a rolling 90-day window (pruned on every login).
 */

import type { GroupType, InviteLabel } from "../types";

export type AccountStatus = "pending" | "verified" | "rejected";
/** Server-tracked stage of the verification funnel. */
export type VerifyPhase = "email" | "code" | "selfie" | "pending_review";
/**
 * Runner role, assigned by the owner/operator at approval time. `runner` is the
 * default (a "Verified Runner"); `group_leader` is a label role for people who
 * run a club/group. `city_admin` is assigned ONLY by a Global Admin (owner or
 * key admin) through the audited city-admin assignment endpoint — it is never
 * accepted from any client payload, and it always carries exactly one city
 * scope (`AccountRecord.adminCityId`). Neither `runner` nor `group_leader`
 * carries admin powers; the owner/super-admin identity is derived server-side
 * from RUN_LOCAL_OWNER_EMAIL, never from a client-supplied role.
 */
export type AccountRole = "runner" | "group_leader" | "city_admin";

export interface AccountRecord {
  id: string;
  name: string;
  email: string;
  /**
   * Unique public handle, normalized lowercase (see `src/lib/username.ts`).
   * `null` for legacy accounts created before usernames existed — they remain
   * fully functional and can claim one via /api/profile/username. Uniqueness
   * is enforced server-side on the normalized form (case-insensitive).
   */
  username: string | null;
  /**
   * The account's home city id — a supported city from the known city entity
   * list (src/data/cities.ts). REQUIRED for new signups (validated server-side
   * against known entities; never trusted from the client), nullable ONLY for
   * legacy accounts created before home cities existed — they stay fully
   * functional, browse via the guest city selector, and are clearly prompted
   * to choose a home city (which persists here). Public profile identity,
   * never sensitive data.
   */
  cityId: string | null;
  status: AccountStatus;
  /** Funnel stage; only meaningful while status === "pending". */
  phase: VerifyPhase;
  /** Assigned runner role (set at approval; defaults to "runner"). */
  role: AccountRole;
  /**
   * City Admin scope — exactly one city id, set ONLY by a Global Admin via the
   * audited assignment endpoint. Non-null means the account is a City Admin
   * with permission over that single city. Never client-settable.
   */
  adminCityId: string | null;
  /** The role held before City Admin assignment (restored on revocation). */
  rolePriorAdmin: AccountRole | null;
  /** Optional role requested at signup (admin-assigned role wins). */
  requestedRole: AccountRole | null;
  /** Filename in uploads/public — the user's chosen public profile photo. */
  profilePhotoRef: string | null;
  /**
   * Supabase Auth user UUID (sub) linked after email OTP verification.
   * Server-side only — never shipped to the client. This is the secure bridge
   * between the Supabase-authenticated email identity and the Run Local
   * account; null until the first successful OTP verification.
   */
  supabaseAuthId: string | null;
  /** Plain signup/profile phone, unverified and server-side only. */
  phone: string | null;
  phoneVerified: boolean;
  phoneVerifiedAt: string | null;
  /**
   * Birthdate collected at signup (server-enforced minimum age). Null only for
   * accounts auto-created by /api/login/check from a verified Supabase
   * identity where the birthdate was never collected — those users fill it in
   * through the normal signup-metadata path on their next full signup.
   */
  birthdate: string | null;
  /** Filename in uploads/private — the live selfie capture. NEVER public. */
  selfieRef: string | null;
  selfieCapturedAt: string | null;
  /** IP at signup — sensitive, admin-only. */
  signupIp: string | null;
  signupAt: string;
  lastActivityAt: string;
  /** Rolling login IP history, pruned to the last 90 days. */
  loginIps: { ip: string; at: string }[];
  verifiedAt: string | null;
  /** Set when the user deletes their account (tombstone). */
  deletedAt: string | null;
  /** When the retention purge will scrub/remove this record. */
  purgeAt: string | null;
  purgedAt: string | null;
  retentionYears: number;
  /**
   * Posting-blocking suspension (owner-imposed, audited). `suspended` is the
   * state; `suspendedUntil` is the expiry (`null` = indefinite until lifted)
   * and `suspensionReason` records why. Past expiry dates are treated as
   * expired (not suspended) and never shipped to the client.
   */
  suspended: boolean;
  suspendedUntil: string | null;
  suspensionReason: string | null;
  /**
   * Community-trust review state: set automatically (never client-side) when
   * the combined count of negative ratings + open concerns against this
   * account reaches the configurable threshold (see `SiteSettings.trust`).
   * While true the account may browse, RSVP, and comment, but cannot host
   * events or post coach/club content. Cleared ONLY by an admin appeal
   * decision (`reinstate`) — never automatically.
   */
  underReview: boolean;
  underReviewAt: string | null;
}

export interface SessionRecord {
  id: string;
  accountId: string;
  createdAt: string;
  lastSeenAt: string;
  /** IP the session was created from (feeds the 90-day rolling history). */
  ip: string;
}

export interface CodeRecord {
  accountId: string;
  /** HMAC-SHA256 of the 6-digit code — the raw code is never stored. */
  hash: string;
  salt: string;
  expiresAt: string;
  attempts: number;
  createdAt: string;
  /** Email the code was sent to (for expiry/verification context). */
  email: string;
}

export type AdminAction =
  | "admin.login"
  | "admin.search"
  | "admin.view_record"
  | "admin.view_selfie"
  | "admin.approve"
  | "admin.reject"
  | "admin.delete"
  | "admin.export"
  | "admin.audit"
  | "admin.purge"
  | "admin.pending_list"
  | "admin.dashboard"
  | "admin.flag_dismiss"
  | "admin.flag_hide"
  | "admin.content_unhide"
  | "admin.suspend"
  | "admin.unsuspend"
  | "admin.group_rrca"
  | "admin.content_highlight"
  | "admin.submission_list"
  | "admin.submission_approve"
  | "admin.submission_reject"
  | "admin.cms_settings"
  | "admin.cms_city"
  | "admin.city_admin_assign"
  | "admin.city_admin_revoke"
  | "admin.invitation_create"
  | "admin.invitation_revoke"
  | "admin.view_credential_proof"
  | "admin.appeal_list"
  | "admin.appeal_reinstate"
  | "admin.appeal_uphold"
  | "admin.trust_threshold"
  | "admin.safety_report_list"
  | "admin.safety_report_resolve"
  | "admin.event_list"
  | "admin.event_create"
  | "admin.event_edit"
  | "admin.event_approve"
  | "admin.event_publish"
  | "admin.event_hide"
  | "admin.event_unhide"
  | "admin.event_archive"
  | "cityadmin.dashboard"
  | "cityadmin.submission_list"
  | "cityadmin.submission_approve"
  | "cityadmin.submission_reject"
  | "cityadmin.flag_dismiss"
  | "cityadmin.flag_hide"
  | "cityadmin.content_unhide"
  | "cityadmin.group_rrca"
  | "cityadmin.content_highlight"
  | "cityadmin.audit"
  | "account.delete"
  | "group.membership_request"
  | "group.membership_approve"
  | "group.membership_decline"
  | "group.membership_leave"
  | "group.membership_remove";

export interface AuditEntry {
  id: string;
  at: string;
  /** Admin identity (email from RUN_LOCAL_ADMIN_EMAIL, or "unknown"). */
  admin: string;
  action: AdminAction;
  /** Required, free-form reason supplied by the admin for the access. */
  reason: string;
  targetId: string | null;
  /** Admin's IP at access time. */
  ip: string;
  /**
   * City this audit entry concerns (city-scoped admin actions). Null for
   * global/system entries. Added for the multi-city foundation; entries
   * written before this field existed load as null.
   */
  cityId: string | null;
}

export interface RunEventRecord {
  id: string; seedRefId: string | null; cityId: string; groupId: string; title: string;
  dayOfWeek: number; time: string; location: string; distanceLabel: string; invite: InviteLabel; externalUrl: string | null;
  provenance: "seed" | "community" | "admin"; status: "draft" | "approved" | "published" | "hidden" | "archived";
  hidden: boolean; createdAt: string; updatedAt: string; createdBy: string; updatedBy: string; archivedAt: string | null;
}

export interface PersistedDb {
  accounts: AccountRecord[];
  sessions: SessionRecord[];
  codes: CodeRecord[];
  audits: AuditEntry[];
  /**
   * Owner-dashboard registry: seeded public content (events/races/forum posts)
   * mirrored server-side so moderation state (hidden/featured/pinned) survives
   * per city. Content details stay in the client seed; this registry holds
   * ONLY ids, titles, and moderation flags — no sensitive data.
   */
  content: ContentRecord[];
  events?: RunEventRecord[];
  /** Owner-dashboard group records: RRCA badge state + internal note. */
  groups: GroupModRecord[];
  memberships?: GroupMembershipRecord[];
  /** Content flags (reports). Reasons are owner-only, never public. */
  flags: FlagRecord[];
  /**
   * Community submissions (races / groups / independent events). Pending until
   * an admin approves or rejects them; only approved records ever become
   * public content, and rejection reasons are shown ONLY to the submitter.
   */
  submissions: SubmissionRecord[];
  activities?: import("./activity").Activity[];
  oauthTokens?: import("./activity").OAuthToken[];
  settings?: SiteSettings;
  cities?: CmsCity[];
  invitations?: CityInvitationRecord[];
  credentials?: CredentialRecord[];
  ratings?: RatingRecord[];
  concerns?: ConcernRecord[];
  appeals?: AppealRecord[];
  recognitions?: RecognitionRecord[];
  /**
   * Shared event attendance (RSVP or host) — the server-side basis for rating
   * eligibility ("did both people actually share this event?"). RSVPs are
   * created by the runner; host records are created when an admin approves an
   * event submission (the submitter is the host of that event).
   */
  attendance?: AttendanceRecord[];
  personalRuns?: PersonalRunRecord[];
  matchingPreferences?: MatchingPreferencesRecord[];
  joinRequests?: JoinRequestRecord[];
  blocks?: BlockRecord[];
  /** Per-account JoinRequest timestamps (epoch ms), persisted for restart/shared enforcement. */
  joinRequestRate?: Record<string, number[]>;
  safetyReports?: SafetyReportRecord[];
  safetyReportRate?: Record<string, number[]>;
  notificationPreferences?: NotificationPreferenceRecord[];
  notifications?: NotificationRecord[];
}

export const NOTIFICATION_CATEGORIES = ["run_reminders", "community_updates", "account_alerts"] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];
export interface NotificationPreferenceRecord { accountId: string; run_reminders: boolean; community_updates: boolean; account_alerts: boolean; updatedAt: string; }
export interface NotificationRecord { id: string; accountId: string; category: NotificationCategory; title: string; body: string; createdAt: string; readAt: string | null; }
export interface MatchingPreferencesRecord {
  accountId: string;
  enabled: boolean;
  consentVersion: string | null;
  consentedAt: string | null;
  cityId: string | null;
  timeWindow: "morning" | "afternoon" | "evening" | "flexible" | null;
  selfDescribedGender: string | null;
  genderPreference: string | null;
  updatedAt: string;
}
export type JoinRequestState = "pending" | "accepted" | "declined" | "cancelled" | "expired" | "blocked";
export interface JoinRequestRecord {
  id: string; requesterId: string; recipientId: string;
  contextType: "event" | "personal_run"; contextId: string;
  /** State is accepted only after BOTH participants explicitly accept. */
  state: JoinRequestState;
  requesterAccepted: boolean; recipientAccepted: boolean;
  createdAt: string; expiresAt: string; updatedAt: string;
}
export interface BlockRecord { blockerId: string; blockedId: string; createdAt: string; }

export const MATCHING_CONSENT_VERSION = "2026-08-04.matching.v1";
export const PERSONAL_RUN_CONSENT_VERSION = "2026-08-04.v1";
export interface PersonalRunRecord {
  id: string; accountId: string; cityId: string; title: string; startsAt: string;
  locationLabel: string | null; distanceLabel: string | null; notes: string | null;
  visibility: "private"; consentVersion: string; consentedAt: string;
  createdAt: string; updatedAt: string; deletedAt: string | null;
}

export type CredentialType = "coach_certification" | "first_aid_cpr";
export type CredentialStatus = "pending_review" | "verified" | "rejected" | "expired";
export interface CredentialRecord {
  id: string; accountId: string; type: CredentialType; certifyingBody: string;
  proofRef: string | null; proofMime: string | null; proofBytes: number;
  issuedOn: string | null; expiresOn: string | null; status: CredentialStatus;
  verifiedBy: string | null; verifiedAt: string | null; decisionReason: string | null;
  renewalNotifiedAt: string | null; createdAt: string; updatedAt: string;
}
export const ALLOWED_TRUST_TAGS = ["reliable", "welcoming", "safety-minded", "knowledgeable", "well-organized"] as const;
export type TrustTag = typeof ALLOWED_TRUST_TAGS[number];
export interface RatingRecord { id:string; reviewerId:string; revieweeId:string; eventId:string; positive:boolean; tags:TrustTag[]; createdAt:string; /** Required when positive === false — the reviewer's stated reason (admin-only, never public). */ reason:string|null; }
export interface ConcernRecord { id:string; reporterId:string; subjectId:string; eventId:string|null; reason:string; status:"open"|"resolved"; createdAt:string; }
export type SafetyReportStatus = "open" | "under_review" | "resolved" | "dismissed";
export interface SafetyReportRecord { id:string; reporterId:string; subjectId:string; cityId:string; contextType:"join_request"|"event"|"personal_run"; contextId:string; reason:string; status:SafetyReportStatus; createdAt:string; updatedAt:string; resolvedAt:string|null; }
export interface AppealRecord { id:string; accountId:string; reason:string; status:"open"|"reinstated"|"upheld"; createdAt:string; decidedAt:string|null; decidedBy:string|null; decisionReason:string|null; }
export interface RecognitionRecord { accountId:string; cityId:string; role:"coach"|"host"; tier:"recognized"; updatedAt:string; }
/**
 * Shared event attendance. `rsvp` = the runner is coming to the event;
 * `host` = the account hosted the event (created server-side when an admin
 * approves that account's event submission). Both are the eligibility basis
 * for ratings: a reviewer may rate a reviewee only for an event BOTH of them
 * attended (shared RSVP/host-attendance).
 */
export interface AttendanceRecord { id:string; accountId:string; eventId:string; role:"rsvp"|"host"; createdAt:string; }

export interface SiteSettings { title:string; wordmark:string; tagline:string; primary:string; accent:string; surface:string; strings:Record<string,string>; tags:Record<string,string[]>; providers:Record<string,boolean>; bottomNav:string[]; announcement:{text:string;link?:string}|null; logoRef:string|null; faviconRef:string|null; /**
   * Community-trust policy, configurable by a Global Admin. `underReviewThreshold`
   * is the combined number of negative ratings + open concerns against one
   * account that moves it into `under_review` (default 3). The value itself is
   * non-sensitive policy and may appear in the public settings payload.
   */ trust:{ underReviewThreshold:number }; }

/**
 * City lifecycle status (server-authoritative runtime registry):
 *  - `active` — open: signup, home-city selection, and submissions allowed.
 *  - `coming_soon` — visible in the registry but not enterable (no signup,
 *    no home-city selection, no submissions).
 *  - `invite_only` — visible; entry (signup / home-city selection) requires a
 *    valid, unexpired, unrevoked, one-time invitation bound to the account
 *    email. Existing members may keep submitting.
 *  - `inactive` — deactivated: history retained (content stays browsable),
 *    but new entry and submissions are denied.
 */
export type CmsCityStatus = "active" | "coming_soon" | "invite_only" | "inactive";
export interface CmsCity { id:string; name:string; state:string; slug:string; status:CmsCityStatus; headerImageRef:string|null; accent:string|null; }

/**
 * Invitation for an invite-only city's home-city selection. The raw token is
 * returned to the Global Admin ONCE at creation and never stored: only the
 * HMAC-SHA256 hash (with a per-invitation salt) is persisted, and the token
 * never appears in any public payload. Redemption is one-time (`usedAt`),
 * expiry-bound (`expiresAt`), and recipient-bound (`email`, exact match).
 */
export interface CityInvitationRecord {
  id: string;
  cityId: string;
  /** Recipient email — exact (case-insensitive) binding. */
  email: string;
  /** HMAC-SHA256(token, salt) — the raw token is never stored. */
  tokenHash: string;
  salt: string;
  createdAt: string;
  /** Global Admin identity that created the invitation (audit trail). */
  createdBy: string;
  expiresAt: string;
  usedAt: string | null;
  usedByAccountId: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}

/** What kind of seeded content a moderation record refers to. */
export type ContentKind = "event" | "race" | "post";

export interface ContentRecord {
  /** Registry id — `${kind}:${refId}` (e.g. "event:mon-social"). */
  id: string;
  cityId: string;
  kind: ContentKind;
  /** The seed-data id (e.g. "mon-social", "r1", "p4"). */
  refId: string;
  title: string;
  /** Display label of the author (posts) / organizer — dashboard context only. */
  authorLabel: string | null;
  /** Set when the content belongs to a real signed-in account (none in MVP seed). */
  authorAccountId: string | null;
  /** Owner-highlight toggles — independent of each other. */
  featured: boolean;
  pinned: boolean;
  /** Hidden by an owner moderation action; excluded from public rendering. */
  hidden: boolean;
  hiddenAt: string | null;
}

export type GroupStatus = "pending_approval" | "published" | "suspended";
export type MembershipMode = "open" | "request";
export interface GroupModRecord {
  id: string; cityId: string; name: string; description?: string;
  groupType?: GroupType; websiteUrl?: string|null; groupmeUrl?: string|null; facebookUrl?: string|null; instagramUrl?: string|null;
  coverPhotoRef?: string|null; logoPhotoRef?: string|null; ownerId?: string; leaderIds?: string[]; membershipMode?: MembershipMode; status?: GroupStatus;
  rrcaBadge: boolean; rrcaNote: string | null; rrcaNoteUpdatedAt: string | null;
  rejectionReason?: string|null;
}

export type GroupMembershipStatus = "pending" | "active" | "declined" | "revoked" | "left";
export interface GroupMembershipRecord {
  id: string; groupId: string; accountId: string; cityId: string; status: GroupMembershipStatus;
  requestedAt: string; updatedAt: string; decidedAt: string | null; decidedBy: string | null;
}

export type FlagStatus = "open" | "dismissed" | "hidden";

export interface FlagRecord {
  id: string;
  cityId: string;
  contentId: string;
  kind: ContentKind;
  refId: string;
  title: string;
  /** The reporter's stated reason — owner-only, never in a public payload. */
  reason: string;
  /** Reporter display name (or "Sample report (preview data)" for seeded flags). */
  reporterName: string;
  reporterAccountId: string | null;
  createdAt: string;
  status: FlagStatus;
  resolvedAt: string | null;
  resolvedAction: "dismiss" | "hide" | null;
}

// ------------------------------------------------------------- submissions

/** What a community member can submit for admin review. */
export type SubmissionKind = "race" | "group" | "event";
export type SubmissionStatus = "pending" | "approved" | "rejected";

/** Race submission payload — one-off race listing with external registration. */
export interface RaceSubmissionPayload {
  kind: "race";
  name: string;
  /** Free-text distance description, e.g. "5K / 10K" (same shape as Race.distance). */
  distances: string;
  /** ISO yyyy-mm-dd race date. */
  date: string;
  location: string;
  /** External registration URL (http/https). */
  registrationUrl: string;
  description: string;
}

/** Group submission payload — a local run group the submitter runs. */
export interface GroupSubmissionPayload {
  kind: "group";
  name: string;
  description: string;
  /** Validated supported city id (server-side, never client-trusted). */
  cityId: string;
  /**
   * Exactly "rrca-chartered" | "community". The RRCA option is a REQUEST —
   * the charter claim is only ever assigned by an admin at/after approval
   * (see GroupModRecord.rrcaBadge) and may be adjusted by the admin.
   */
  groupType: GroupType;
  groupmeUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  websiteUrl: string | null;
  coverPhotoRef?: string;
  logoPhotoRef?: string;
  membershipMode?: MembershipMode;
}

/** Independent-event submission payload — a run NOT tied to a group. */
export interface EventSubmissionPayload {
  kind: "event";
  /** One-time (absolute date) or recurring (weekly day-of-week slot). */
  type: "one_time" | "recurring";
  title: string;
  /** ISO yyyy-mm-dd — required when type === "one_time", null otherwise. */
  date: string | null;
  /** 0 (Mon) … 6 (Sun) — required when type === "recurring", null otherwise. */
  dayOfWeek: number | null;
  time: string;
  location: string;
  distanceLabel: string;
  invite: InviteLabel;
  externalUrl: string | null;
  description: string;
}

export type SubmissionPayload = RaceSubmissionPayload | GroupSubmissionPayload | EventSubmissionPayload;

export interface SubmissionRecord {
  id: string;
  kind: SubmissionKind;
  cityId: string;
  status: SubmissionStatus;
  /** The account that submitted this entry (their own records only are visible to them). */
  submitterAccountId: string;
  submittedAt: string;
  decidedAt: string | null;
  /** Admin identity that decided (email), null until decided. */
  decidedBy: string | null;
  /**
   * Required when status === "rejected" (the admin's rejection reason). Sent
   * back ONLY to the submitter of this record — never in any public payload.
   */
  rejectionReason: string | null;
  payload: SubmissionPayload;
  /**
   * When approved, the id of the public record created:
   *  - race/event: moderation registry id ("race:user-<sid>" / "event:user-<sid>");
   *  - group: group record id ("user-<sid>"). Null until approved.
   */
  publicRefId: string | null;
}
