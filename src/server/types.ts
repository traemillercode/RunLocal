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
 * Operational account roles (multi-role model). `runner` is the default (a
 * "Verified Runner"); `group_leader` is a label role for people who run a
 * club/group; `city_admin` is scoped to exactly one city
 * (`AccountRecord.adminCityId`); `site_admin` is the top of the hierarchy
 * (the owner email is ALWAYS a site admin, server-derived; a Global Admin may
 * also grant the stored role to other verified accounts).
 *
 * Roles "glue together": each role implies every role of equal or lower rank
 * (runner(0) < group_leader(1) < city_admin(2) < site_admin(3)), so the
 * effective role is the highest-ranked held role. Role sets are stored on
 * `AccountRecord.roles`; the legacy single `role` field is kept in sync
 * (highest-ranked role) for backward compatibility during migration.
 *
 * Admin roles (city_admin / site_admin) are NEVER accepted from any client
 * payload — only the audited role-assignment endpoints set them, and admin
 * roles require an identity-verified target.
 */
export type AccountRole = "runner" | "group_leader" | "city_admin" | "site_admin";

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
  /** Free-text runner-facing stats, self-reported, shown on the public profile when set. All optional, all editable via PATCH /api/profile/details. */
  paceLabel?: string | null;
  runningGoal?: string | null;
  trainingBlock?: string | null;
  upcomingRaces?: string | null;
  /** Free-text about-me, self-reported, optional. */
  bio?: string | null;
  /** Optional override shown instead of the role label (e.g. "Founder"). Display-only — grants no permissions. */
  customTitle?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  tiktokUrl?: string | null;
  /** Off by default — social links are private until the runner explicitly opts to show them on their public profile. */
  showSocialLinks?: boolean;
  status: AccountStatus;
  /** Funnel stage; only meaningful while status === "pending". */
  phase: VerifyPhase;
  /** Assigned runner role (set at approval; defaults to "runner"). */
  role: AccountRole;
  /**
   * Full multi-role set (the multi-role model). `role` above is the DEPRECATED
   * single-source field, kept in sync for backward compat: every write sets
   * both, with `role` = the highest-ranked role in `roles`. Records persisted
   * before `roles` existed are normalized on load (roles := [role]).
   */
  roles: AccountRole[];
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
  /**
   * The explicit reason an admin recorded when rejecting this account's
   * verification application (or revoking a previously verified status).
   * Required on rejection; cleared on a fresh approval. Applicant-facing but
   * PRIVATE — surfaced only in the account's own `/api/me` payload and admin
   * views, never in other members' projections of this account.
   */
  rejectionReason: string | null;
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
  /**
   * Trusted Member (manual trust / blue-check) state — server-authoritative.
   * Distinct from identity verification (`status === "verified"`): this badge
   * is granted ONLY by a Global Admin (any city) or a City Admin (their exact
   * scope city) through audited, reason-required endpoints, and only to
   * accounts that have already completed real identity verification (never to
   * pending/rejected accounts — no fabricated verification). Admins can never
   * set it on their own account. `trustedMemberAt` records when the current
   * grant was made (cleared on revoke; the full history lives in the audit
   * log).
   */
  trustedMember: boolean;
  trustedMemberAt: string | null;
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
  | "admin.overview"
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
  | "admin.roles_assign"
  | "admin.invitation_create"
  | "admin.invitation_revoke"
  | "admin.view_credential_proof"
  | "admin.appeal_list"
  | "admin.appeal_reinstate"
  | "admin.appeal_uphold"
  | "admin.trust_threshold"
  | "admin.trust_grant"
  | "admin.trust_revoke"
  | "admin.trust_list"
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
  | "admin.content_list"
  | "admin.content_edit"
  | "admin.content_hide"
  | "admin.content_archive"
  | "admin.content_delete"
  | "admin.announcement_edit"
  | "admin.announcement_remove"
  | "admin.discussion_list"
  | "admin.discussion_edit"
  | "admin.discussion_delete"
  | "admin.submission_edit"
  | "admin.submission_remove"
  | "submission.withdraw"
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
  | "cityadmin.trust_grant"
  | "cityadmin.trust_revoke"
  | "cityadmin.trust_list"
  | "account.delete"
  | "group.membership_request"
  | "group.membership_approve"
  | "group.membership_decline"
  | "group.membership_leave"
  | "group.membership_remove"
  | "group.leader_assign"
  | "group.leader_remove"
  | "group.ownership_transfer"
  | "group.profile_edit"
  | "forum.post_edit"
  | "forum.post_delete"
  | "forum.reply_edit"
  | "forum.reply_delete"
  | "forum.pin"
  | "forum.unpin"
  | "forum.hide_own"
  | "forum.restore_own"
  | "discussion.edit"
  | "content.flag"
  | "group_lead.event_hide"
  | "group_lead.event_restore"
  | "group_lead.event_delete"
  | "group_lead.event_edit"
  | "admin.race_edit"
  | "admin.forum_post_edit"
  | "submission.edit_pending";

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
  /**
   * Owner identity of the affected content (content-owner account email, or
   * the seeded author label when there is no account). Null for entries that
   * don't concern user content.
   */
  owner: string | null;
  /**
   * Human-readable summary of what changed (e.g. `title: "A" -> "B"`,
   * `archived + 2 RSVPs soft-deleted`). Null for entries without a change
   * payload. Records a snapshot description only — the underlying rows are
   * never hard-deleted so the full trail survives.
   */
  change: string | null;
  /**
   * Run Local account id of the actor (signed-in user actions outside the
   * admin-session model, e.g. group-lead moderation). Null for key-admin
   * sessions and legacy entries written before this field existed.
   */
  accountId: string | null;
}

export interface RunEventRecord {
  id: string; seedRefId: string | null; cityId: string; groupId: string; title: string;
  dayOfWeek: number; /** One-time submissions carry an exact date; recurring records leave this null. */ scheduleDate?: string | null; recurrenceType?: "one_time" | "recurring"; time: string; location: string; distanceLabel: string; invite: InviteLabel; externalUrl: string | null;
  provenance: "seed" | "community" | "admin"; status: "draft" | "approved" | "published" | "hidden" | "archived";
  hidden: boolean; createdAt: string; updatedAt: string; createdBy: string; updatedBy: string; archivedAt: string | null;
  /** When set, this occurrence needs at least this many RSVPs before it counts as a confirmed group run rather than a proposal. Undefined/0 = no threshold, always confirmed. */
  minParticipants?: number;
}

/**
 * Canonical race record — the server-side source of truth for race listings
 * that must survive admin edits (the events analog of `RunEventRecord`). Seed
 * races are materialized at startup from the client seed; approved community
 * race submissions keep their payload-driven rendering but share the same
 * public view + capability model. `refId` is the seed id for seed rows and the
 * `user-<submissionId>` ref for community rows.
 */
export interface RaceRecord {
  id: string;
  cityId: string;
  refId: string;
  /** "seed" = preview fixture (sample content); "submission" = approved community listing. */
  source: "seed" | "submission";
  name: string;
  /** Display distance label, e.g. "5K / 10K". */
  distances: string;
  /** ISO yyyy-mm-dd race date. */
  date: string;
  location: string;
  registrationUrl: string;
  description: string;
  organizer: string;
  price: string;
  registrationOpen: boolean;
  registrationNote: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
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
  /** Canonical race records (seed-materialized + admin-edited race facts). */
  races?: RaceRecord[];
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
  contentFlagRate?: Record<string, number[]>;
  notificationPreferences?: NotificationPreferenceRecord[];
  notifications?: NotificationRecord[];
  discussions?: DiscussionRecord[];
  discussionRate?: Record<string, number[]>;
  /** User-created forum posts (public city forum) — persisted server-side. */
  forumPosts?: ForumPostRecord[];
  /** User-created replies to forum posts (public city forum) — persisted server-side. */
  forumReplies?: ForumReplyRecord[];
  waivers?: import("./waivers").GroupWaiverVersion[];
  waiverSignatures?: import("./waivers").GroupWaiverSignature[];
  /** Organizer check-in records (per event occurrence, per runner). */
  checkins?: import("./checkins").EventCheckInRecord[];
  /** New-runner QR sessions (token hashes only — raw tokens are never stored). */
  checkinQrSessions?: import("./checkins").CheckInQrSession[];
  /** Runner connections — one row per pair, keyed by the sorted pair. */
  connections?: ConnectionRecord[];
  conversations?: ConversationRecord[];
  messages?: MessageRecord[];
  trainingPlans?: TrainingPlanRecord[];
  forumVotes?: ForumVoteRecord[];
  accountReports?: AccountReportRecord[];
  /** Per-account privacy settings (keyed by accountId; defaults when absent). */
  privacy?: PrivacySettingsRecord[];
  /** Runner tags on content ("run"|"post"|"event"). */
  tags?: TagRecord[];
}

export interface DiscussionRecord {
  id: string; kind: "thread" | "comment"; parentId: string | null;
  occurrenceId: string; eventId: string; cityId: string; authorId: string;
  title: string | null; body: string; state: "visible" | "hidden" | "deleted";
  createdAt: string; updatedAt: string;
}
/**
 * A user-created forum post (public city forum). Distinct from the seed posts
 * that live in the client's city data: these records are server-persisted so
 * verified members can actually post, and they render merged with the seed
 * posts in the Forum UI. Author identity on the public payload is the author's
 * public display name only — never email, phone, or other account data.
 * Moderation integrates with the content registry (`post:<id>` rows), so the
 * existing admin hide/archive paths apply.
 */
export interface ForumPostRecord {
  id: string;
  cityId: string;
  section: "announcements" | "community" | "qa";
  /** Topic, independent of section — null for older posts created before categories existed. */
  category?: "training" | "races" | "gear" | "routes" | "general" | null;
  title: string;
  body: string;
  authorAccountId: string;
  state: "visible" | "deleted";
  /** Admin pinning — pinned posts sort first in the forum list. Default false. */
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A user-created reply to a forum post (public city forum). Replies hang off a
 * post id that may name either a user-created post (`ForumPostRecord`) or a
 * seed post from the client's city data — the post id is the single key, and
 * moderation visibility is inherited from the parent post's content-registry
 * row (`post:<id>`), so hiding/archiving a post hides its replies too. The
 * public payload carries the author's public display name only — never email,
 * phone, or other account data.
 */
export interface ForumReplyRecord {
  id: string;
  /** Id of the parent post — a user-created post id or a seed post id. */
  postId: string;
  cityId: string;
  authorAccountId: string;
  body: string;
  state: "visible" | "deleted";
  createdAt: string;
  updatedAt: string;
}

export const NOTIFICATION_CATEGORIES = ["run_reminders", "community_updates", "account_alerts", "messages"] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];
export interface NotificationPreferenceRecord { accountId: string; run_reminders: boolean; community_updates: boolean; account_alerts: boolean; messages: boolean; updatedAt: string; }
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

// ------------------------------------------------------- connections & privacy

/**
 * Runners connection lifecycle. ONE row per account pair, keyed by the sorted
 * pair (least/greatest id) so A→B and B→A can never coexist in the store.
 * `pending`/`accepted` are ACTIVE states — at most one active row per pair;
 * `declined`/`removed` are terminal HISTORY states that never block a future
 * request (a later request simply supersedes the row). Rows are never
 * hard-deleted: `removeConnection` soft-deletes via the `removed` status.
 */
export type ConnectionStatus = "pending" | "accepted" | "declined" | "removed";
/**
 * A safety report against another runner — separate from the content-flag
 * system (which is for public city content like posts/events). This is for
 * reporting a PERSON, typically arising from a message or connection, so it
 * has no city scoping and no content-registry row to hang off of.
 */
export interface AccountReportRecord {
  id: string;
  reporterId: string;
  reportedAccountId: string;
  reason: string;
  /** Optional context — the conversation this arose from, if any. */
  conversationId: string | null;
  createdAt: string;
  status: "open" | "reviewed" | "dismissed";
}

export interface ConnectionRecord {
  id: string;
  /** The account that initiated the request. */
  requesterId: string;
  /** The account the request was addressed to. */
  addresseeId: string;
  status: ConnectionStatus;
  createdAt: string;
  /** When the request was accepted or declined (null until then). */
  respondedAt: string | null;
  /** When the row was soft-deleted via removeConnection/block (null until then). */
  removedAt: string | null;
}

/**
 * A single upvote on a forum post — "this was helpful," Reddit-lite (no
 * downvotes, keeps it simple and hard to weaponize). One row per
 * (accountId, postId) pair; toggling off deletes the row rather than
 * storing a zero/negative value.
 */
export interface ForumVoteRecord {
  accountId: string;
  postId: string;
  createdAt: string;
}

/**
 * A structured training plan — replaces the free-text trainingBlock field
 * when set. "Current week" is never stored; it's computed from startDate on
 * every read, so it's always accurate without a background job.
 */
export type TrainingPlanType = "5k" | "10k" | "half_marathon" | "marathon" | "ultra" | "other";
export interface TrainingPlanRecord {
  accountId: string;
  planType: TrainingPlanType;
  /** Only meaningful when planType === "other". */
  customLabel: string | null;
  totalWeeks: number;
  /** ISO date (yyyy-mm-dd) — week 1 starts this day. */
  startDate: string;
  /** Optional link to a specific race in Races — shown alongside the plan when set. */
  linkedRaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A message thread — either a 1:1 between two connected accounts, or a group
 * with a name and 3+ participants. 1:1 threads are found/reused by sorted
 * participant-pair lookup (never duplicated); groups are always created fresh.
 */
export interface ConversationRecord {
  id: string;
  isGroup: boolean;
  /** Group display name — null for 1:1 threads (shown as the other person's name instead). */
  name: string | null;
  participantIds: string[];
  createdBy: string;
  createdAt: string;
  lastMessageAt: string;
  /** Set once a run has been created from this thread — prevents creating a second one from the same chat. */
  runCreatedId: string | null;
  /** accountId -> ISO timestamp of that person's last-read moment in this thread. A message is "seen" once every other participant's readBy timestamp is >= its createdAt. */
  readBy: Record<string, string>;
  /** Group photo — filename under /uploads/public/. Null/absent shows the default group icon. 1:1 threads never set this (they show the other person's profile photo instead). */
  photoRef?: string | null;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  /** Soft-delete — deleted messages keep their row (so ordering/counts stay stable) but render as removed. */
  deletedAt: string | null;
  /** accountId -> emoji, one reaction per person per message (re-reacting overwrites). */
  reactions: Record<string, string>;
  /** Set when this message carries a photo — filename under /uploads/public/. A message can be image-only (body can be empty) or image + caption. */
  mediaRef?: string | null;
  /** Set when the sender edits the message — editing is only allowed within 10 minutes of createdAt (enforced server-side, not just in the UI). */
  editedAt?: string | null;
}

/**
 * Per-account privacy settings. When no record exists the store applies
 * `PRIVACY_DEFAULTS` (verbatim owner spec). `show_saved_events` can NEVER be
 * "public" — enforced by `setPrivacy` validation and by the canView guard.
 */
export type ProfileVisibility = "public" | "connections_only";
export type ContentVisibility = "public" | "connections_only" | "private";
export type SavedEventsVisibility = "connections_only" | "private";
export interface PrivacySettingsRecord {
  accountId: string;
  profile_visibility: ProfileVisibility;
  show_upcoming_events: ContentVisibility;
  show_saved_events: SavedEventsVisibility;
  show_past_activity: ContentVisibility;
  show_connections_list: ContentVisibility;
  show_tagged_content: ContentVisibility;
  searchable_by_name: boolean;
}
/** Verbatim owner-spec defaults — applied when no privacy record exists. */
export const PRIVACY_DEFAULTS: Omit<PrivacySettingsRecord, "accountId"> = {
  profile_visibility: "public",
  show_upcoming_events: "connections_only",
  show_saved_events: "private",
  show_past_activity: "public",
  show_connections_list: "connections_only",
  show_tagged_content: "connections_only",
  searchable_by_name: true,
};

/** Runner tags on content ("run"|"post"|"event"). `hiddenByTaggedUser` is the
 * tagged runner's private self-hide toggle — never visible to other users;
 * their view of the tag simply drops the hidden user. */
export type TagContentType = "run" | "post" | "event";
export interface TagRecord {
  id: string;
  contentType: TagContentType;
  contentId: string;
  taggedUserId: string;
  taggedByUserId: string;
  hiddenByTaggedUser: boolean;
  createdAt: string;
}

export const MATCHING_CONSENT_VERSION = "2026-08-04.matching.v1";
export const PERSONAL_RUN_CONSENT_VERSION = "2026-08-04.v1";
export interface PersonalRunRecord {
  id: string; accountId: string; cityId: string; title: string; startsAt: string;
  locationLabel: string | null; distanceLabel: string | null; notes: string | null;
  visibility: "private"; consentVersion: string; consentedAt: string;
  createdAt: string; updatedAt: string; deletedAt: string | null;
  /** Opt-in "Keep on My Runs": a past solo run stays visible in My Runs forever. */
  kept?: boolean;
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
export interface RatingRecord { id:string; reviewerId:string; revieweeId:string; eventId:string; positive:boolean; tags:TrustTag[]; createdAt:string; /** Required when positive === false — the reviewer's stated reason (admin-only, never public). */ reason:string|null; /** Soft-delete stamp set when the rated event is archived/removed by an admin. The row is preserved for the audit trail but excluded from active listings. */ deletedAt?: string|null; }
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
/** Per-event/occurrence visibility override (see AttendanceRecord.visibilityOverride). */
export type AttendanceVisibility = "inherit" | "public" | "connections_only" | "private";
export interface AttendanceRecord { id:string; accountId:string; eventId:string; role:"rsvp"|"host"; createdAt:string; /** Concrete occurrence; absent on legacy event-level rows. */ occurrenceId?: string; runDate?: string; startsAt?: string; /** Soft-delete stamp: set when an admin archives the event. The row is preserved (audit trail) but excluded from active RSVP/eligibility checks. */ deletedAt?: string|null; /** Opt-in "Keep on My Runs": a past occurrence stays visible in My Runs forever (indefinite kept history). */ kept?: boolean; /** Set once a run-reminder notification has fired for this row — prevents re-notifying on every check. */ remindedAt?: string | null; /**
   * Event-level privacy override — "inherit" (default) means the OWNER's
   * global `show_upcoming_events` setting applies; any other value REPLACES it
   * for visibility decisions about this specific event/occurrence (see
   * `canView` in src/server/privacy.ts). Absent on rows created before the
   * field existed and read as "inherit".
   */ visibilityOverride?: AttendanceVisibility; }

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
/**
 * What a flag may target. Everything with a content-registry row maps to its
 * registry kind/refId; entities without registry rows (forum replies, groups)
 * use the kind + id directly.
 */
export type FlagKind = ContentKind | "reply" | "group";

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
  /**
   * Archived by a super-admin (owner or key admin): removed from public
   * rendering permanently (unlike hidden, there is no restore-to-visible path
   * — only the audit trail remains). Records are never hard-deleted so the
   * moderation trail survives.
   */
  archived: boolean;
  archivedAt: string | null;
}

export type GroupStatus = "pending_approval" | "published" | "suspended";
export type MembershipMode = "open" | "request";
export interface GroupModRecord {
  id: string; cityId: string; name: string; description?: string;
  groupType?: GroupType; websiteUrl?: string|null; facebookUrl?: string|null; instagramUrl?: string|null;
  coverPhotoRef?: string|null; logoPhotoRef?: string|null; ownerId?: string; leaderIds?: string[]; membershipMode?: MembershipMode; status?: GroupStatus;
  rrcaBadge: boolean; rrcaNote: string | null; rrcaNoteUpdatedAt: string | null;
  rejectionReason?: string|null;
  /** Native group chat conversation — lazily created on first access, then reused. Members are synced in as they join. */
  chatConversationId?: string | null;
  /**
   * Archived by a super-admin: removed from the public directory permanently
   * (the record and its audit trail remain). Group "hide" uses the existing
   * `status: "suspended"` transition; archive is a stronger, terminal state.
   */
  archived?: boolean;
  archivedAt?: string | null;
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
  kind: FlagKind;
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
/**
 * Submission lifecycle:
 *  - pending   → in the admin queue, awaiting a decision;
 *  - approved  → created the public record (group / race / event);
 *  - rejected  → declined by an admin (rejection reason stored);
 *  - withdrawn → the SUBMITTER pulled a still-pending submission back before
 *    any admin decision. Withdrawn records leave the admin pending queue but
 *    stay in the submitter's own "My submissions" history.
 */
export type SubmissionStatus = "pending" | "approved" | "rejected" | "withdrawn";

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
