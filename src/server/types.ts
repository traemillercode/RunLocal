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

import type { GroupType, InviteLabel, PacePolicy } from "../types";

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
  /** 0 = Sunday, 1 = Monday - which day a "week" starts on for run-history/dashboard views (not the training plan's own week numbering, which stays anchored to the plan's own startDate regardless of this). Defaults to Sunday, the US convention. */
  weekStartDay: 0 | 1;
  /**
   * Self-declared coach identity - separate from the actual coach-athlete
   * relationship mechanism (request/accept), which stays exactly as built.
   * This is purely the DISCOVERY layer: turning it on puts the account in
   * the coach directory and shows a badge on their profile. An account can
   * be a coach and an athlete at the same time (coaching others while
   * having their own coach).
   */
  isAvailableAsCoach: boolean;
  /** Short public bio shown on the profile and in the coach directory - distances coached, philosophy, specialties. Only meaningful when isAvailableAsCoach is true, but kept even if toggled off so re-enabling doesn't lose it. */
  coachBio: string | null;
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
  /** Ad-attribution — captured at signup only if the person had granted analytics consent. Null for everyone else, including all pre-existing accounts. */
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;

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
   * between the Supabase-authenticated email identity and the Kimbio
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
  /**
   * Set when a rejected account re-applies with the same email (see the
   * signup handler in api.ts) - the CURRENT rejectionReason moves here
   * before being cleared, so an admin reviewing the new submission can see
   * "this person was previously rejected for: X" without it looking like an
   * active rejection. Cleared only on a fresh approval.
   */
  priorRejectionReason: string | null;
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
  | "admin.undo_rejection"
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
  | "admin.sponsor_create"
  | "admin.sponsor_edit"
  | "admin.sponsor_delete"
  | "admin.geofence_allowlist_add"
  | "admin.geofence_allowlist_remove"
  | "admin.purge_all"
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
   * Kimbio account id of the actor (signed-in user actions outside the
   * admin-session model, e.g. group-lead moderation). Null for key-admin
   * sessions and legacy entries written before this field existed.
   */
  accountId: string | null;
}

export interface RunEventRecord {
  id: string; seedRefId: string | null; cityId: string; groupId: string; title: string;
  dayOfWeek: number; /** One-time submissions carry an exact date; recurring records leave this null. */ scheduleDate?: string | null; recurrenceType?: "one_time" | "recurring"; time: string; location: string; distanceLabel: string; invite: InviteLabel; externalUrl: string | null;
  /**
   * How this run treats pace. Optional: records written before the field
   * existed have no value, and readers fall back to deriving one from
   * distanceLabel rather than showing nothing.
   */
  pacePolicy?: PacePolicy | null;
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
  /** Emails (lowercased) exempt from the 20-mile geofence - admin-managed, e.g. someone who lives just outside the radius or a remote partner who needs full access. Never exposed to the client as a list; only a per-account isGeofenceExempt boolean via /api/me. */
  geofenceAllowlist?: string[];
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
  trainingPlanWeeks?: TrainingPlanWeekRecord[];
  trainingPlanDays?: TrainingPlanDayRecord[];
  shoes?: ShoeRecord[];
  nutritionItems?: NutritionItemRecord[];
  trainingPlanStrengthEntries?: TrainingPlanStrengthEntryRecord[];
  trainingPlanRecurrences?: TrainingPlanRecurrenceRecord[];
  weeklyPlanEmails?: WeeklyPlanEmailRecord[];
  weeklyReviews?: WeeklyReviewRecord[];
  trainingPlanChangeProposals?: TrainingPlanChangeProposalRecord[];
  coachRelationships?: CoachRelationshipRecord[];
  routeWaypoints?: RouteWaypointRecord[];
  sponsors?: SponsorRecord[];
  forumVotes?: ForumVoteRecord[];
  accountReports?: AccountReportRecord[];
  routes?: RouteRecord[];
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
  /** A post can reference a specific run — "this Thursday's route was great" links to the actual event, not just a text mention. Null for most posts. Validated against a real, currently-published event at post-creation time (see createForumPost), never a dangling/fabricated id. */
  linkedEventId?: string | null;
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
/** Where a notification should take you when tapped - the actual click-through target. Absent for notifications with no natural destination (e.g. a general account-status message). */
export interface NotificationLink {
  kind: "conversation" | "verify" | "group_manage" | "event" | "forum_post";
  id: string;
}
export interface NotificationRecord { id: string; accountId: string; category: NotificationCategory; title: string; body: string; createdAt: string; readAt: string | null; link?: NotificationLink | null; }
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

/**
 * A route backed by a real uploaded GPX file — distance and elevation gain
 * are computed from the actual track points, never hand-entered guesses.
 * The GPX itself is stored so anyone can download it back onto their own
 * watch/Strava/Garmin — that's the actual "shareable" artifact.
 */
export interface RouteRecord {
  id: string;
  cityId: string;
  name: string;
  surfaceType: "trail" | "gravel" | "road" | "track";
  /** Computed from the GPX track points at upload time, not user-entered. */
  distanceMiles: number;
  elevationGainFt: number;
  /** False when the source GPX had no elevation data at all - the UI shows "No elevation data" instead of a misleading "0 ft". */
  hasElevationData: boolean;
  /** Filename under the GPX upload store — see readGpxUpload/writeGpxUpload. */
  gpxRef: string;
  createdBy: string;
  createdAt: string;
}

/**
 * A point of interest along an existing route: a checkpoint/mile marker, an
 * aid station, a volunteer spot that needs a real person to staff it (a
 * water table, a turn, traffic control), or a turn feeding turn-by-turn
 * directions. Lives on top of a route's real GPS points — this is not a
 * from-scratch route drawing tool, it annotates a route that already has a
 * real GPX track.
 */
export interface RouteWaypointRecord {
  id: string;
  routeId: string;
  kind: "checkpoint" | "aid_station" | "volunteer_spot" | "turn";
  lat: number;
  lng: number;
  /** Distance in miles along the route to this point, computed at creation time from the route's GPS points — not user-entered, so it can't drift from reality. */
  distanceMiles: number;
  label: string;
  /** e.g. "Gatorade + water", "Direct runners left onto Elm St", volunteer instructions. */
  note?: string;
  /** Only meaningful for kind === "volunteer_spot". */
  volunteersNeeded?: number;
  /** Account ids who have claimed a slot at this spot — length is capped at volunteersNeeded server-side. */
  volunteerAccountIds: string[];
  createdBy: string;
  createdAt: string;
}

/**
 * A paid local sponsorship placement — sold and set up manually (no
 * self-serve ad platform), shown on the Events page. "featured" is the one
 * larger/top placement; "standard" covers the smaller slots. At most one
 * featured + three standard sponsors are active at once (four total),
 * enforced server-side in sponsors.ts, not just a UI convention.
 */
export interface SponsorRecord {
  id: string;
  cityId: string;
  tier: "featured" | "standard";
  businessName: string;
  tagline: string;
  linkUrl: string;
  /** Filename under the public upload store — see readPublicUpload/writePublicUpload. Null shows a text-only placement. */
  logoRef: string | null;
  /** Whether this booking has been paid for. A booking can be active=true but not yet showing (startDate is in the future) or no longer showing (endDate has passed) — see isSponsorLive in sponsors.ts, which checks both active and the date window on every read rather than needing a background job to flip a flag. */
  active: boolean;
  /** Inclusive booking window, YYYY-MM-DD. The placement only actually appears on Events between these dates. */
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A coach's access to a specific athlete's training plan - consent-based
 * (either side can propose it, the other must accept) rather than a global
 * "coach" role, since coaching is a relationship with particular people,
 * not a site-wide privilege (the same way group_leader is scoped to one
 * group, not the whole app). An active relationship lets the coach view
 * and edit that one athlete's plan/weeks - never a blanket "see everyone."
 */
export type CoachRelationshipStatus = "pending" | "active" | "declined";
export interface CoachRelationshipRecord {
  id: string;
  coachId: string;
  athleteId: string;
  status: CoachRelationshipStatus;
  /** Who sent the original request - shown back to both sides for context. */
  requestedBy: "coach" | "athlete";
  createdAt: string;
  respondedAt: string | null;
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
  /** Set when the runner is training for a race that isn't in the system yet - they submitted it for admin review (see /api/submissions/race) but it's not a real RaceRecord to link to until approved. Shown as "(pending)" until then; cleared once linkedRaceId is set to a real approved race. Mutually exclusive with linkedRaceId in practice, though not enforced at the type level. */
  customRaceName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One week's actual workout content within a plan - the part that was
 * missing before (the plan record itself only ever stored the overall
 * shape: type/length/dates, never what to actually run). Stored as a
 * separate per-week collection rather than an array embedded in
 * TrainingPlanRecord, so editing week 12 doesn't require resending the
 * other 51 weeks, and a plan can be filled in progressively rather than
 * all at once.
 */
/**
 * A repeating workout rule (Outlook-style) - "every Mon/Wed/Fri, 8/1 to
 * 9/26, easy run, 5 miles." Creating one generates real
 * TrainingPlanDayRecord entries for every matching date in range; each
 * generated day carries recurrenceId back to this rule. Editing offers the
 * classic two-way choice: "this instance" (edits just that one day,
 * flipping recurrenceOverridden so a later "edit all" never clobbers it) or
 * "all instances" (updates the rule and regenerates every non-overridden
 * day still tied to it).
 */
export interface TrainingPlanRecurrenceRecord {
  id: string;
  accountId: string;
  /** 0=Sunday..6=Saturday. */
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

/**
 * A record of a weekly plan email having gone out - the coach (or a
 * self-coached athlete) can manually send one when they finalize the week;
 * if nobody does by the scheduled check, the automatic fallback sends one
 * anyway using whatever's currently on the calendar. Keyed by
 * (accountId, weekStartDate) so it's idempotent: a manual send earlier in
 * the week means the automatic check skips that week entirely.
 */
export type WeekColor = "green" | "yellow" | "red";

/**
 * A required checkpoint before moving into the next week when the prior
 * week scored red - confirms the athlete actually looked at it, plus what's
 * changing. One per (accountId, weekStartDate); the gate checks for its
 * existence, not just a boolean, so there's always a real note on file for
 * why a bad week happened and what's different going forward.
 */
export interface WeeklyReviewRecord {
  id: string;
  accountId: string;
  weekStartDate: string;
  color: WeekColor;
  notes: string;
  reviewedAt: string;
}

export interface WeeklyPlanEmailRecord {
  id: string;
  /** The ATHLETE receiving the email - always, whether a coach or the athlete themself triggered it. */
  accountId: string;
  weekStartDate: string;
  notes: string;
  sentAt: string;
  sentBy: "self" | "coach" | "automatic";
  /** Set only when sentBy === "coach". */
  coachId: string | null;
}

export interface TrainingPlanWeekRecord {
  id: string;
  accountId: string;
  /** 1-indexed, matches currentTrainingWeek's numbering. */
  weekNumber: number;
  /** Total planned mileage for the week. Null = not yet filled in. */
  targetMiles: number | null;
  /** The week's single longest run, called out separately since it's the number a runner actually plans their week around. */
  longRunMiles: number | null;
  /** Free-text workout notes - e.g. "Tempo Tuesday, long run Saturday, rest Monday/Friday." */
  notes: string;
  updatedAt: string;
}

export type TrainingDayWorkoutType = "run" | "cross_training" | "rest" | "recovery" | "race" | "swim";

/**
 * One actual calendar day's plan content - the real detail everything else
 * (calendar view, PDF export, "what do I do today" widgets, linking a
 * logged run) is built on. TrainingPlanWeekRecord stays as a lighter
 * week-level rollup (total miles, a coach's one-line summary for the week);
 * this is where the specific, actionable content lives. Keyed by real
 * calendar date rather than (weekNumber, dayOfWeek), so a day survives even
 * if the plan's start date or length is edited later.
 */
export type TrainingDaySlot = "primary" | "am" | "pm";
/** Sub-classification for a run-type day - shown as a real label (Tempo, Long run, etc.) rather than free text, matching how real training platforms categorize runs. Only meaningful when workoutType is "run" or "race". */
export type TrainingRunLabel = "easy" | "tempo" | "long_run" | "workout" | "recovery_run" | "race_pace" | "intervals";

/**
 * A strength/gym/mobility entry for a day - deliberately NOT part of the
 * run-slot system (which caps at 2, matching "max two runs a day"). There
 * can be any number of these per day, each its own record with its own id,
 * since gym work doesn't have the same natural cap a run does.
 */
export interface TrainingPlanStrengthEntryRecord {
  id: string;
  accountId: string;
  date: string;
  title: string;
  durationMinutes: number | null;
  notes: string;
  completionStatus: "pending" | "done" | "missed";
  updatedAt: string;
}
export type TrainingDistanceUnit = "miles" | "km" | "meters" | "yards";

/**
 * Structured interval workout - "6x400m," "10x100m sprints," or
 * "5x(1:00 work / 30s rest)." Work and rest are each EITHER a distance or a
 * duration (never both at once) - a track repeat is measured in meters, a
 * tempo interval in minutes, and mixing units within one field would be
 * meaningless. Rest is optional (some interval sets are continuous, no
 * recovery between reps).
 */
export type IntervalMeasure = "distance" | "duration";
export type DurationUnit = "seconds" | "minutes";
/** Ties a work interval's target directly to the pace zones already computed by the pace calculator (easy/marathon/threshold/interval), matching how real coaches actually describe a workout ("at 5K pace") rather than a raw number the runner has to look up separately. */
export type PaceZoneTarget = "easy" | "marathon" | "threshold" | "interval";
/** Recovery type matters practically, not just cosmetically - a jog recovery, a walk, and standing rest are different instructions to actually execute, confirmed as a real distinction in both Final Surge and TrainingPeaks. */
export type RecoveryType = "jog" | "walk" | "stand";

export interface IntervalStructure {
  /** Optional warm-up before the main set - distance only (the overwhelmingly common real-world pattern is "2 mile warmup," not a timed warmup). */
  warmupValue: number | null;
  warmupUnit: TrainingDistanceUnit | null;

  repeatCount: number;
  workMeasure: IntervalMeasure;
  workValue: number;
  workUnit: TrainingDistanceUnit | null;
  /** Only set when workMeasure is "duration" - lets a coach write "4:00" instead of forcing everything into raw seconds. */
  workDurationUnit: DurationUnit | null;
  workPaceTarget: PaceZoneTarget | null;

  hasRest: boolean;
  restType: RecoveryType | null;
  restMeasure: IntervalMeasure | null;
  restValue: number | null;
  restUnit: TrainingDistanceUnit | null;
  restDurationUnit: DurationUnit | null;

  /** Optional cool-down after the main set - same distance-only reasoning as warm-up. */
  cooldownValue: number | null;
  cooldownUnit: TrainingDistanceUnit | null;
}

export interface TrainingPlanDayRecord {
  id: string;
  accountId: string;
  /** ISO yyyy-mm-dd - the actual calendar date this content applies to. */
  date: string;
  /** "primary" for a single workout that day; "am"/"pm" when there are two - each is its own full record, not a sub-object, so either can be edited/frozen/completed independently. Derived automatically from scheduledTime (before/after noon) when a real time is set, rather than chosen manually. */
  slot: TrainingDaySlot;
  /** HH:MM (24-hour) - the actual time this workout is scheduled for. Optional; when set, it's what determines whether this is the "am" or "pm" slot, rather than an arbitrary manual choice. */
  scheduledTime: string | null;
  /** Denormalized for fast weekly grouping/filtering without recomputing from startDate every time. */
  weekNumber: number;
  workoutType: TrainingDayWorkoutType;
  /** Real sub-classification (Tempo, Long run, Easy, etc.) - only meaningful for run/race workouts, matching how real training platforms categorize runs rather than relying on free-text title alone. */
  runLabel: TrainingRunLabel | null;
  /** Short label shown on the calendar, e.g. "Tempo run" or "Easy 5mi" or "Yoga". Empty for a plain rest day. */
  title: string;
  distanceValue: number | null;
  /** Miles/km for run-family workouts; meters/yards for swim - a runner and a swimmer need genuinely different units, not a converted mile value pretending to be a pool distance. */
  distanceUnit: TrainingDistanceUnit;
  /**
   * Structured interval detail - "6x400m" or "5x(1:00 work/30s rest)" -
   * separate from distanceValue, which stays the day's TOTAL distance
   * (used for mileage tracking and calendar display exactly as before).
   * A distance-based interval's total can be computed and used to prefill
   * distanceValue as a convenience; a time-based interval's total distance
   * is genuinely unknown until actually run, so distanceValue stays
   * whatever the runner enters separately (or null).
   */
  intervalStructure: IntervalStructure | null;
  /** Planned fueling for this workout - what to eat/drink and roughly when, e.g. "1 gel at mile 6, Tailwind throughout." References the runner's own nutrition library items where applicable (see NutritionItemRecord), tracked separately as plannedGelCount/plannedDrinkMixId for real aggregate reporting rather than only free text. */
  plannedGelCount: number | null;
  plannedDrinkMixId: string | null;
  nutritionPlanNotes: string | null;
  /** What was actually consumed - only meaningful once logged (see completionStatus). Feeds the real training-block summary totals; planned and actual can differ, and reporting should reflect what really happened. */
  actualGelCount: number | null;
  actualDrinkMixId: string | null;
  /** References a ShoeRecord in the runner's own shoe library - null shows no shoe (e.g. swim/cross-training days, or a run day where none was picked). */
  shoeId: string | null;
  fuelNotes: string | null;
  hydrationNotes: string | null;
  /** Optional link to a real route in Routes - shown as a real map/elevation reference for the day, not just a name. */
  linkedRouteId: string | null;
  /**
   * Optional link to a real group-run occurrence in Events - lets this
   * specific plan day say "this is the Thursday group run at 6pm," visible
   * from both directions (the plan shows the group run's real time/location;
   * the group run, if the app surfaces it, can show it's someone's planned
   * workout). Distinct from linkedRouteId (a route is just a course
   * reference; this is an actual scheduled run people are attending).
   */
  linkedEventOccurrenceId: string | null;
  notes: string;
  /** Set once a real logged/RSVP'd run is linked to this day (see runs -> plan-day linking) - lets the calendar show "done" vs. "planned" distinctly. */
  completedRunId: string | null;
  /**
   * Plan-vs-actual: did the planned workout actually happen? "pending" is
   * the default for any future or not-yet-logged day. A rest day is never
   * loggable (there's nothing to complete), so this only meaningfully
   * applies to run/cross_training/recovery/race/swim days.
   */
  completionStatus: "pending" | "done" | "missed" | "modified";
  /** Only set when completionStatus is "missed" - a fixed set of reasons (dropdowns are easier than free text for logging quickly), not open text. */
  missedReason: TrainingDayMissedReason | null;
  /** Free-text elaboration on the missed reason or a modification - optional, in addition to the dropdown, not instead of it. */
  completionNotes: string | null;
  /**
   * Set by an active coach to lock this specific day against athlete edits
   * (linking a group run is still always allowed even when frozen - that's
   * the athlete's own schedule, not the prescribed content). An athlete
   * with a coach can never freeze their own day; only the coach can, and
   * only the coach can unfreeze it.
   */
  frozen: boolean;
  /** Set when this day was generated by a recurrence rule - null for a one-off day created directly. */
  recurrenceId: string | null;
  /** True once this specific instance has been edited directly - protects it from being silently overwritten the next time the rule's "edit all instances" regenerates the series. */
  recurrenceOverridden: boolean;
  updatedAt: string;
}

export type TrainingDayMissedReason = "sick" | "injured" | "too_busy" | "weather" | "low_motivation" | "other";

/**
 * A runner's own shoe library - add a shoe once, reuse it across days via
 * shoeId instead of retyping "Pegasus 40" every time. One shoe can be
 * marked the default, pre-selected for a new day's content.
 */
export interface ShoeRecord {
  id: string;
  accountId: string;
  name: string;
  isDefault: boolean;
  /** Cumulative miles logged with this shoe - incremented automatically when a day using this shoe is marked "done" (see completeDayForShoeMileage in api.ts), the same way Strava tracks gear mileage. Always stored in miles internally regardless of what unit the runner logged the workout in, so totals are comparable. */
  totalMiles: number;
  createdAt: string;
}

/** A runner's own library of nutrition products - add "Maurten Gel 100" or "Tailwind Endurance Fuel" once, reuse it across days and get real aggregate totals, the same pattern as the shoe library. */
export type NutritionItemKind = "gel" | "drink_mix" | "chew" | "other";
export interface NutritionItemRecord {
  id: string;
  accountId: string;
  kind: NutritionItemKind;
  name: string;
  createdAt: string;
}

/**
 * When an athlete has an active coach, they can't edit the prescribed
 * workout content directly (title/distance/type/etc.) - they propose a
 * change, and the coach approves or declines it. Linking a group run to
 * the day is exempt from this (that's the athlete's own schedule, not the
 * prescribed content) and never needs a proposal. A frozen day can still
 * be proposed against, but the coach freezing it is a strong signal they
 * don't want it touched - the UI should make that context visible.
 */
export interface TrainingPlanChangeProposalRecord {
  id: string;
  athleteId: string;
  coachId: string;
  date: string;
  slot: TrainingDaySlot;
  /** The proposed field changes - same shape as a day PUT body, applied verbatim on approval. */
  proposedChanges: Record<string, unknown>;
  /** The athlete's own note explaining why, shown to the coach alongside the diff. */
  note: string;
  status: "pending" | "approved" | "declined";
  createdAt: string;
  respondedAt: string | null;
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
