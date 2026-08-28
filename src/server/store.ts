/**
 * JSON-file-backed data store for identity & verification records.
 *
 * Design notes:
 *  - All writes are atomic (write temp file + rename). A failed write can
 *    never leave a half-written db.json.
 *  - Sensitive values are persisted ONLY here (or the private upload dir),
 *    never in the browser bundle, localStorage, or server logs.
 *  - `dataDir` is configurable via RUN_LOCAL_DATA_DIR (default ./data).
 *  - Pass `dataDir: null` (or use `createMemoryStore`) for tests / ephemeral runs.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { accountRoles, effectiveRole, hasRole, highestRole, normalizeRoles, storedRoles } from "./accountRoles";
import { PRIVACY_DEFAULTS } from "./types";
import type {
  AccountRecord,
  AuditEntry,
  CityInvitationRecord,
  CodeRecord,
  ContentRecord,
  FlagRecord,
  GroupModRecord,
  GroupMembershipRecord,
  PersistedDb,
  SessionRecord,
  SubmissionRecord,
  VerifyPhase,
  SafetyReportRecord,
  RunEventRecord,
} from "./types";

export const DEFAULT_RETENTION_YEARS = 3;
export const LOGIN_IP_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
export const LOGIN_IP_MAX_ENTRIES = 200;
export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const MAX_CODE_ATTEMPTS = 5;
export const EMAIL_SEND_LIMIT = 5; // sends per email per rolling hour
export const EMAIL_SEND_WINDOW_MS = 60 * 60 * 1000;
export const MIN_AGE = Math.max(13, Number(process.env.RUN_LOCAL_MIN_AGE ?? 16) || 16);

export function nowIso(now = new Date()): string {
  return now.toISOString();
}

export function newId(): string {
  return randomBytes(16).toString("hex");
}

/** Days (as YYYY-MM-DD strings) covered by an inclusive [start, end] range. Small ranges only — sponsor bookings are expected to span days/weeks, not years. */
function daysInRange(start: string, end: string): string[] {
  const days: string[] = [];
  const cur = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (cur <= last) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/** Today as YYYY-MM-DD in UTC — matches the date-string format sponsor bookings are stored in. */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Real slot caps: at most one live "featured" sponsor and three live "standard" sponsors per city, per day. */
export const SPONSOR_TIER_CAPS = { featured: 1, standard: 3 } as const;

/**
 * Current week of a training plan, computed fresh from startDate every time
 * — never stored, so it's always correct without any background job. Week 1
 * covers the 7 days starting on startDate; clamped to [1, totalWeeks] so a
 * plan that's finished still reads as "week N of N" rather than climbing
 * past it, and a plan that hasn't started yet reads as week 1.
 */
export function currentTrainingWeek(plan: { startDate: string; totalWeeks: number }, now: Date): number {
  const start = new Date(`${plan.startDate}T00:00:00Z`);
  const daysSince = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  const week = Math.floor(daysSince / 7) + 1;
  return Math.max(1, Math.min(plan.totalWeeks, week));
}

/** "Online now" is approximate by nature without a real push/socket layer — this treats any session active within the last 2 minutes as live. Good enough for a presence dot; not a guarantee of this instant. */
export const PRESENCE_WINDOW_MS = 2 * 60 * 1000;

/**
 * Canonical connection key — the SORTED pair (least/greatest id). One row per
 * pair: A→B and B→A always map to the same key and can never coexist.
 */
export function connectionKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function isActiveConnection(status: import("./types").ConnectionStatus): boolean {
  return status === "pending" || status === "accepted";
}

/**
 * Validate a privacy patch before it reaches the store. Throws on any unknown
 * field or invalid value. The owner-locked rule `show_saved_events` can never
 * be "public" is enforced HERE (write guard) and again in canView (read guard).
 */
export function validatePrivacyPatch(patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case "profile_visibility":
        if (value !== "public" && value !== "connections_only") throw new Error("privacy: invalid profile_visibility (must be public or connections_only)");
        break;
      case "show_upcoming_events":
      case "show_past_activity":
      case "show_connections_list":
      case "show_tagged_content":
        if (value !== "public" && value !== "connections_only" && value !== "private") throw new Error(`privacy: invalid ${key}`);
        break;
      case "show_saved_events":
        if (value !== "connections_only" && value !== "private") throw new Error("privacy: show_saved_events must be connections_only or private (never public)");
        break;
      case "searchable_by_name":
        if (typeof value !== "boolean") throw new Error("privacy: searchable_by_name must be a boolean");
        break;
      default:
        throw new Error(`privacy: unknown field "${key}"`);
    }
  }
}

export function hashCode(code: string, salt: string): string {
  return createHmac("sha256", salt).update(code).digest("hex");
}

export function codesEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(CODE_LENGTH, "0");
}

export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[\s().-]/g, "");
  if (!/^\+?\d{10,15}$/.test(digits)) return null;
  if (!digits.startsWith("+")) {
    // US-centric fallback for launch city: bare 10 digits → +1.
    if (digits.length === 10) digits = `+1${digits}`;
    else return null;
  }
  return digits;
}

/** Public shape of an account — the ONLY thing the client may ever see. */
export interface PublicAccount {
  id: string;
  name: string;
  email: string;
  /**
   * Unique public handle, normalized lowercase (null = legacy account that has
   * not claimed one yet). Public profile identity — never sensitive data.
   */
  username: string | null;
  /**
   * Home city id (null = legacy account that has not chosen one yet — the UI
   * prompts them clearly). Public profile identity, never sensitive.
   */
  cityId: string | null;
  bio?: string | null;
  customTitle?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  tiktokUrl?: string | null;
  showSocialLinks?: boolean;
  paceLabel?: string | null;
  runningGoal?: string | null;
  trainingBlock?: string | null;
  upcomingRaces?: string | null;
  status: AccountRecord["status"];
  phase: VerifyPhase | null;
  badge: "verified" | null;
  /** Assigned runner role (label only — never a power source). */
  role: AccountRecord["role"];
  /** Full multi-role set (server-authoritative; `role` = highest of these). */
  roles: AccountRecord["roles"];
  /** City Admin scope is display-only; authorization checks stay server-side. */
  adminCityId?: string | null;
  /** Server-derived super-admin flag (from RUN_LOCAL_OWNER_EMAIL). */
  isOwner: boolean;
  /** Server-computed: true for the owner or anyone on the admin-managed geofence allowlist. Client uses this to bypass the location check without ever seeing the allowlist itself. */
  isGeofenceExempt: boolean;
  /**
   * Posting-blocking suspension, computed server-side against the current
   * time. The client may only ever see this boolean — never the expiry or the
   * reason (moderation data stays owner-only).
   */
  suspended: boolean;
  /**
   * Community-trust review state (see AccountRecord.underReview). Visible to
   * the account itself (and the admin) — the account may still browse, RSVP,
   * and comment, but hosting and coach/club posting are restricted.
   */
  underReview: boolean;
  /**
   * Trusted Member (manual trust / blue-check) state — server-authoritative,
   * display-only for the client. Distinct from the identity `badge`: granted
   * only by Global/City Admins through audited endpoints to identity-verified
   * members. The client can render it but never set it.
   */
  trustedMember: boolean;
  /**
   * Applicant-facing rejection reason — PRIVATE to the account itself: it is
   * only ever populated in the account's own `/api/me` payload (and admin
   * views). Never shipped in any other member's projection of this account.
   */
  rejectionReason?: string | null;
  priorRejectionReason?: string | null;
  profilePhotoUrl: string | null;
}

/**
 * True while the account's posting rights are suspended. `suspendedUntil`
 * null means indefinite (until lifted); past timestamps are treated as
 * expired.
 */
export function isSuspended(rec: AccountRecord, now = new Date()): boolean {
  if (rec.deletedAt || !rec.suspended) return false;
  if (rec.suspendedUntil === null) return true; // indefinite
  return new Date(rec.suspendedUntil).getTime() > now.getTime();
}

/** Posting gate used by the client payload and (in future) posting endpoints. */
export function canPost(rec: AccountRecord, now = new Date()): { ok: boolean; reason?: string } {
  if (!isSuspended(rec, now)) return { ok: true };
  return { ok: false, reason: "suspended" };
}

export function toPublicAccount(rec: AccountRecord, isOwner = false, db?: Db, now = new Date()): PublicAccount {
  return {
    id: rec.id,
    name: rec.name,
    email: rec.email,
    username: rec.username ?? null,
    cityId: rec.cityId ?? null,
    bio: rec.bio ?? null,
    customTitle: rec.customTitle ?? null,
    instagramUrl: rec.instagramUrl ?? null,
    facebookUrl: rec.facebookUrl ?? null,
    tiktokUrl: rec.tiktokUrl ?? null,
    showSocialLinks: rec.showSocialLinks === true,
    paceLabel: rec.paceLabel ?? null,
    runningGoal: rec.runningGoal ?? null,
    trainingBlock: rec.trainingBlock ?? null,
    upcomingRaces: rec.upcomingRaces ?? null,
    status: rec.status,
    phase: rec.status === "pending" ? rec.phase : null,
    badge: rec.status === "verified" ? "verified" : null,
    role: effectiveRole(rec),
    roles: accountRoles(rec),
    adminCityId: hasRole(rec, "city_admin") ? rec.adminCityId : null,
    isOwner,
    /** Server-computed: owner is always exempt from the geofence, plus anyone on the admin-managed allowlist. Never derived client-side. */
    isGeofenceExempt: isOwner || (db?.isGeofenceExempt(rec.email) ?? false),
    suspended: isSuspended(rec, now),
    underReview: rec.underReview === true,
    trustedMember: rec.trustedMember === true,
    rejectionReason: rec.status === "rejected" ? rec.rejectionReason : null,
    /** Shown when this account was previously rejected and has since resubmitted - gives the admin reviewing the new submission full context without it looking like an active rejection. */
    priorRejectionReason: rec.priorRejectionReason ?? null,
    profilePhotoUrl: rec.profilePhotoRef ? `/uploads/public/${rec.profilePhotoRef}` : null,
  };
}

export interface DbOptions {
  dataDir?: string | null;
  retentionYears?: number;
  now?: () => Date;
}

export class Db {
  readonly dataDir: string | null;
  readonly retentionYears: number;
  private nowFn: () => Date;
  private accounts = new Map<string, AccountRecord>();
  private sessions = new Map<string, SessionRecord>();
  private codes = new Map<string, CodeRecord>();
  private audits: AuditEntry[] = [];
  private content = new Map<string, ContentRecord>();
  private events = new Map<string, RunEventRecord>();
  private races = new Map<string, import("./types").RaceRecord>();
  private groups = new Map<string, GroupModRecord>();
  private memberships = new Map<string, GroupMembershipRecord>();
  private flags: FlagRecord[] = [];
  private submissions = new Map<string, SubmissionRecord>();
  private activities = new Map<string, import("./activity").Activity>();
  private oauthTokens = new Map<string, import("./activity").OAuthToken>();
  private settings: import("./types").SiteSettings | undefined;
  private cities = new Map<string, import("./types").CmsCity>();
  private invitations = new Map<string, CityInvitationRecord>();
  private credentials = new Map<string, import("./types").CredentialRecord>();
  private ratings = new Map<string, import("./types").RatingRecord>();
  private concerns = new Map<string, import("./types").ConcernRecord>();
  private appeals = new Map<string, import("./types").AppealRecord>();
  private recognitions = new Map<string, import("./types").RecognitionRecord>();
  private attendance = new Map<string, import("./types").AttendanceRecord>();
  private personalRuns = new Map<string, import("./types").PersonalRunRecord>();
  private matchingPreferences = new Map<string, import("./types").MatchingPreferencesRecord>();
  private joinRequests = new Map<string, import("./types").JoinRequestRecord>();
  private blocks = new Map<string, import("./types").BlockRecord>();
  /** Persisted per-account JoinRequest timestamps. Old entries are pruned on every check. */
  private joinRequestRate = new Map<string, number[]>();
  private safetyReports = new Map<string, SafetyReportRecord>();
  private safetyReportRate = new Map<string, number[]>();
  private contentFlagRate = new Map<string, number[]>();
  private notificationPreferences = new Map<string, import("./types").NotificationPreferenceRecord>();
  private notifications = new Map<string, import("./types").NotificationRecord>();
  private discussions = new Map<string, import("./types").DiscussionRecord>();
  private discussionRate = new Map<string, number[]>();
  private forumPosts = new Map<string, import("./types").ForumPostRecord>();
  private forumReplies = new Map<string, import("./types").ForumReplyRecord>();
  private waivers = new Map<string, import("./waivers").GroupWaiverVersion>();
  private waiverSignatures = new Map<string, import("./waivers").GroupWaiverSignature>();
  private checkins = new Map<string, import("./checkins").EventCheckInRecord>();
  private checkinQrSessions = new Map<string, import("./checkins").CheckInQrSession>();
  /** Runner connections — keyed by the SORTED pair (least/greatest id), so one row per pair. */
  private connections = new Map<string, import("./types").ConnectionRecord>();
  private conversations = new Map<string, import("./types").ConversationRecord>();
  private messages = new Map<string, import("./types").MessageRecord>();
  private trainingPlans = new Map<string, import("./types").TrainingPlanRecord>();
  private trainingPlanWeeks = new Map<string, import("./types").TrainingPlanWeekRecord>();
  private coachRelationships = new Map<string, import("./types").CoachRelationshipRecord>();
  private trainingPlanDays = new Map<string, import("./types").TrainingPlanDayRecord>();
  private shoes = new Map<string, import("./types").ShoeRecord>();
  private nutritionItems = new Map<string, import("./types").NutritionItemRecord>();
  private trainingPlanStrengthEntries = new Map<string, import("./types").TrainingPlanStrengthEntryRecord>();
  private trainingPlanRecurrences = new Map<string, import("./types").TrainingPlanRecurrenceRecord>();
  private weeklyPlanEmails = new Map<string, import("./types").WeeklyPlanEmailRecord>();
  private trainingPlanChangeProposals = new Map<string, import("./types").TrainingPlanChangeProposalRecord>();
  private forumVotes = new Map<string, import("./types").ForumVoteRecord>();
  private accountReports = new Map<string, import("./types").AccountReportRecord>();
  private routes = new Map<string, import("./types").RouteRecord>();
  private routeWaypoints = new Map<string, import("./types").RouteWaypointRecord>();
  private sponsors = new Map<string, import("./types").SponsorRecord>();
  private geofenceAllowlist = new Set<string>();
  /** Ephemeral typing state — accountId -> expiry timestamp, per conversation. Deliberately NOT part of load/persist: it's a live-only signal, meaningless across a restart, and would just be stale noise if saved. */
  private typing = new Map<string, Map<string, number>>();
  /** Per-account privacy settings — keyed by accountId (defaults when absent). */
  private privacy = new Map<string, import("./types").PrivacySettingsRecord>();
  /** Runner tags on content — keyed by tag id. */
  private tags = new Map<string, import("./types").TagRecord>();
  /**
   * Private upload bytes (credential proofs) kept in memory so in-memory/test
   * stores can serve them back; file-backed stores mirror the bytes to disk
   * under uploads/private (never in db.json) exactly like selfies and CMS refs.
   */
  private privateUploads = new Map<string, Buffer>();
  /**
   * CMS image references (brand logo/favicon, city header images) keyed by
   * ref id. Bytes live on disk under uploads/private for file-backed stores
   * (never in db.json) and in this map for in-memory/test stores. Refs are
   * opaque ids — settings/cities only ever carry the ref string, never the
   * image bytes or data URLs.
   */
  private refs = new Map<string, Buffer>();
  private loaded = false;

  constructor(opts: DbOptions = {}) {
    this.dataDir = opts.dataDir ?? null;
    this.retentionYears = opts.retentionYears ?? DEFAULT_RETENTION_YEARS;
    this.nowFn = opts.now ?? (() => new Date());
  }

  now(): Date {
    return this.nowFn();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.dataDir) return;
    const file = join(this.dataDir, "db.json");
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw) as PersistedDb;
      for (const a of parsed.accounts ?? []) {
        // Backward-compatible migration: accounts persisted before usernames
        // existed simply lack the field — treat it as `null` (not set) so they
        // keep working and can claim a username from their profile later.
        a.username = a.username ?? null;
        // Same for home cities: accounts created before home-city selection
        // existed lack the field — treat it as `null` (not set) so they keep
        // working and are prompted to choose a city (see /api/profile/city).
        a.cityId = a.cityId ?? null;
        // Same for the City Admin scope fields: accounts persisted before the
        // multi-city foundation lack them — treat as `null` (not a City Admin).
        a.adminCityId = a.adminCityId ?? null;
        a.rolePriorAdmin = a.rolePriorAdmin ?? null;
        // Multi-role migration: accounts persisted before `roles` existed
        // carry only the legacy single `role` — treat it as their full role
        // set (the helpers fall back the same way for in-memory records).
        if (!Array.isArray(a.roles) || a.roles.length === 0) {
          a.roles = a.role ? [a.role] : ["runner"];
        }
        // Same for the community-trust review state: accounts persisted before
        // it existed lack the fields — treat as not under review.
        a.underReview = a.underReview === true;
        a.underReviewAt = a.underReviewAt ?? null;
        // Same for the Trusted Member (manual trust) state: accounts persisted
        // before it existed lack the fields — treat as not trusted. Nothing is
        // ever fabricated here: only the audited admin endpoints set it.
        a.trustedMember = a.trustedMember === true;
        a.trustedMemberAt = a.trustedMemberAt ?? null;
        // Same for the account rejection reason: accounts persisted before it
        // existed lack the field — treat as `null` (never rejected with a
        // stored reason). Only the audited admin reject path sets it.
        a.rejectionReason = a.rejectionReason ?? null;
        a.weekStartDay = a.weekStartDay ?? 0;
        this.accounts.set(a.id, a);
      }
      for (const s of parsed.sessions ?? []) this.sessions.set(s.id, s);
      for (const c of parsed.codes ?? []) this.codes.set(c.accountId, c);
      // Pre-multi-city audit entries have no cityId — normalize to null.
      this.audits = (parsed.audits ?? []).map((a) => ({ ...a, cityId: a.cityId ?? null, owner: a.owner ?? null, change: a.change ?? null }));
      for (const r of parsed.content ?? []) this.content.set(r.id, r);
      for (const e of parsed.events ?? []) this.events.set(e.id, e);
      for (const r of parsed.races ?? []) this.races.set(r.id, r);
      for (const g of parsed.groups ?? []) this.groups.set(g.id, g);
      for (const m of parsed.memberships ?? []) this.memberships.set(m.id, m);
      this.flags = parsed.flags ?? [];
      for (const s of parsed.submissions ?? []) this.submissions.set(s.id, s);
      for (const a of parsed.activities ?? []) this.activities.set(a.id, a);
      for (const t of parsed.oauthTokens ?? []) this.oauthTokens.set(`${t.accountId}:${t.provider}`, t);
      this.settings = parsed.settings;
      for (const c of parsed.cities ?? []) this.cities.set(c.id, c);
      for (const i of parsed.invitations ?? []) this.invitations.set(i.id, i);
      for (const c of parsed.credentials ?? []) this.credentials.set(c.id, c);
      for (const r of parsed.ratings ?? []) this.ratings.set(r.id, { ...r, deletedAt: r.deletedAt ?? null });
      for (const c of parsed.concerns ?? []) this.concerns.set(c.id, c);
      for (const a of parsed.appeals ?? []) this.appeals.set(a.id, a);
      for (const r of parsed.recognitions ?? []) this.recognitions.set(`${r.accountId}:${r.role}`, r);
      for (const a of parsed.attendance ?? []) this.attendance.set(a.id, { ...a, deletedAt: a.deletedAt ?? null, visibilityOverride: a.visibilityOverride ?? "inherit" });
      for (const r of parsed.personalRuns ?? []) this.personalRuns.set(r.id, r);
      for (const p of parsed.matchingPreferences ?? []) this.matchingPreferences.set(p.accountId, p);
      for (const j of parsed.joinRequests ?? []) this.joinRequests.set(j.id, { ...j, requesterAccepted: j.requesterAccepted ?? false, recipientAccepted: j.recipientAccepted ?? false });
      for (const b of parsed.blocks ?? []) this.blocks.set(`${b.blockerId}:${b.blockedId}`, b);
      for (const r of parsed.safetyReports ?? []) this.safetyReports.set(r.id, r);
      for (const p of parsed.notificationPreferences ?? []) this.notificationPreferences.set(p.accountId, { ...p, messages: p.messages ?? true });
      for (const n of parsed.notifications ?? []) this.notifications.set(n.id, n);
      for (const d of parsed.discussions ?? []) this.discussions.set(d.id, d);
      for (const [accountId, timestamps] of Object.entries(parsed.discussionRate ?? {})) this.discussionRate.set(accountId, timestamps.filter((t) => Number.isFinite(t)));
      for (const f of parsed.forumPosts ?? []) this.forumPosts.set(f.id, { ...f, pinned: f.pinned === true });
      for (const r of parsed.forumReplies ?? []) this.forumReplies.set(r.id, r);
      for (const [accountId, timestamps] of Object.entries(parsed.safetyReportRate ?? {})) this.safetyReportRate.set(accountId, timestamps.filter((t) => Number.isFinite(t)));
      for (const [accountId, timestamps] of Object.entries(parsed.contentFlagRate ?? {})) this.contentFlagRate.set(accountId, timestamps.filter((t) => Number.isFinite(t)));
      for (const [accountId, timestamps] of Object.entries(parsed.joinRequestRate ?? {})) {
        this.joinRequestRate.set(accountId, timestamps.filter((t) => Number.isFinite(t)));
      }
      for (const w of parsed.waivers ?? []) this.waivers.set(w.id, w);
      for (const s of parsed.waiverSignatures ?? []) this.waiverSignatures.set(s.id, s);
      for (const c of parsed.checkins ?? []) this.checkins.set(c.id, c);
      for (const q of parsed.checkinQrSessions ?? []) this.checkinQrSessions.set(q.id, q);
      // Connections: key by the sorted pair. Terminal history rows (declined/
      // removed) load as-is; missing timestamps normalize to null.
      for (const c of parsed.connections ?? []) {
        this.connections.set(connectionKey(c.requesterId, c.addresseeId), { ...c, respondedAt: c.respondedAt ?? null, removedAt: c.removedAt ?? null });
      }
      for (const c of parsed.conversations ?? []) this.conversations.set(c.id, { ...c, runCreatedId: c.runCreatedId ?? null, readBy: c.readBy ?? {}, photoRef: c.photoRef ?? null });
      for (const m of parsed.messages ?? []) this.messages.set(m.id, { ...m, deletedAt: m.deletedAt ?? null, reactions: m.reactions ?? {}, mediaRef: m.mediaRef ?? null, editedAt: m.editedAt ?? null });
      for (const t of parsed.trainingPlans ?? []) this.trainingPlans.set(t.accountId, t);
      for (const w of parsed.trainingPlanWeeks ?? []) this.trainingPlanWeeks.set(w.id, w);
      for (const c of parsed.coachRelationships ?? []) this.coachRelationships.set(c.id, c);
      for (const d of parsed.trainingPlanDays ?? []) this.trainingPlanDays.set(d.id, d);
      for (const s of parsed.shoes ?? []) this.shoes.set(s.id, { ...s, totalMiles: s.totalMiles ?? 0 });
      for (const n of parsed.nutritionItems ?? []) this.nutritionItems.set(n.id, n);
      for (const e of parsed.trainingPlanStrengthEntries ?? []) this.trainingPlanStrengthEntries.set(e.id, e);
      for (const r of parsed.trainingPlanRecurrences ?? []) this.trainingPlanRecurrences.set(r.id, r);
      for (const w of parsed.weeklyPlanEmails ?? []) this.weeklyPlanEmails.set(w.id, w);
      for (const p of parsed.trainingPlanChangeProposals ?? []) this.trainingPlanChangeProposals.set(p.id, p);
      for (const v of parsed.forumVotes ?? []) this.forumVotes.set(`${v.accountId}:${v.postId}`, v);
      for (const r of parsed.accountReports ?? []) this.accountReports.set(r.id, r);
      for (const rt of parsed.routes ?? []) this.routes.set(rt.id, { ...rt, hasElevationData: rt.hasElevationData ?? rt.elevationGainFt > 0 });
      for (const wp of parsed.routeWaypoints ?? []) this.routeWaypoints.set(wp.id, { ...wp, volunteerAccountIds: wp.volunteerAccountIds ?? [] });
      for (const s of parsed.sponsors ?? []) this.sponsors.set(s.id, s);
      for (const e of parsed.geofenceAllowlist ?? []) this.geofenceAllowlist.add(e.toLowerCase());
      // Privacy: records persisted before a field existed are merged over the
      // verbatim owner-spec defaults so they keep working.
      for (const p of parsed.privacy ?? []) this.privacy.set(p.accountId, { ...PRIVACY_DEFAULTS, ...p, accountId: p.accountId });
      for (const t of parsed.tags ?? []) this.tags.set(t.id, t);
    } catch {
      // First run — empty store. db.json is created on first persist().
    }
  }

  async persist(): Promise<void> {
    if (!this.dataDir) return;
    await mkdir(this.dataDir, { recursive: true });
    const db: PersistedDb = {
      accounts: [...this.accounts.values()],
      sessions: [...this.sessions.values()],
      codes: [...this.codes.values()],
      audits: this.audits,
      content: [...this.content.values()],
      events: [...this.events.values()],
      races: [...this.races.values()],
      groups: [...this.groups.values()],
      memberships: [...this.memberships.values()],
      flags: this.flags,
      submissions: [...this.submissions.values()],
      activities: [...this.activities.values()],
      oauthTokens: [...this.oauthTokens.values()],
      settings: this.settings,
      cities: [...this.cities.values()],
      invitations: [...this.invitations.values()],
      credentials: [...this.credentials.values()],
      ratings: [...this.ratings.values()],
      concerns: [...this.concerns.values()],
      appeals: [...this.appeals.values()],
      recognitions: [...this.recognitions.values()],
      attendance: [...this.attendance.values()],
      personalRuns: [...this.personalRuns.values()],
      matchingPreferences: [...this.matchingPreferences.values()],
      joinRequests: [...this.joinRequests.values()],
      blocks: [...this.blocks.values()],
      joinRequestRate: Object.fromEntries(this.joinRequestRate.entries()),
      safetyReports: [...this.safetyReports.values()],
      safetyReportRate: Object.fromEntries(this.safetyReportRate.entries()),
      contentFlagRate: Object.fromEntries(this.contentFlagRate.entries()),
      notificationPreferences: [...this.notificationPreferences.values()],
      notifications: [...this.notifications.values()],
      discussions: [...this.discussions.values()],
      discussionRate: Object.fromEntries(this.discussionRate.entries()),
      forumPosts: [...this.forumPosts.values()],
      forumReplies: [...this.forumReplies.values()],
      waivers: [...this.waivers.values()],
      waiverSignatures: [...this.waiverSignatures.values()],
      checkins: [...this.checkins.values()],
      checkinQrSessions: [...this.checkinQrSessions.values()],
      connections: [...this.connections.values()],
      conversations: [...this.conversations.values()],
      messages: [...this.messages.values()],
      trainingPlans: [...this.trainingPlans.values()],
      trainingPlanWeeks: [...this.trainingPlanWeeks.values()],
      coachRelationships: [...this.coachRelationships.values()],
      trainingPlanDays: [...this.trainingPlanDays.values()],
      shoes: [...this.shoes.values()],
      nutritionItems: [...this.nutritionItems.values()],
      trainingPlanStrengthEntries: [...this.trainingPlanStrengthEntries.values()],
      trainingPlanRecurrences: [...this.trainingPlanRecurrences.values()],
      weeklyPlanEmails: [...this.weeklyPlanEmails.values()],
      trainingPlanChangeProposals: [...this.trainingPlanChangeProposals.values()],
      forumVotes: [...this.forumVotes.values()],
      accountReports: [...this.accountReports.values()],
      routes: [...this.routes.values()],
      routeWaypoints: [...this.routeWaypoints.values()],
      sponsors: [...this.sponsors.values()],
      geofenceAllowlist: [...this.geofenceAllowlist],
      privacy: [...this.privacy.values()],
      tags: [...this.tags.values()],
    };
    const file = join(this.dataDir, "db.json");
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
    await rename(tmp, file);
  }

  getNotificationPreferences(accountId: string) { return this.notificationPreferences.get(accountId) ?? { accountId, run_reminders:false, community_updates:false, account_alerts:false, messages:true, updatedAt:this.now().toISOString() }; }
  setNotificationPreferences(accountId: string, patch: Partial<Pick<import("./types").NotificationPreferenceRecord,"run_reminders"|"community_updates"|"account_alerts"|"messages">>) { const next={...this.getNotificationPreferences(accountId),...patch,accountId,updatedAt:this.now().toISOString()}; this.notificationPreferences.set(accountId,next); return next; }
  addNotification(notification: import("./types").NotificationRecord) { this.notifications.set(notification.id, notification); return notification; }
  listNotifications(accountId: string) { return [...this.notifications.values()].filter(n=>n.accountId===accountId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
  updateNotification(id: string, accountId: string, patch: {readAt:string|null}) { const n=this.notifications.get(id); if(!n||n.accountId!==accountId)return undefined; n.readAt=patch.readAt; return n; }
  markAllNotificationsRead(accountId:string) { const at=this.now().toISOString(); for(const n of this.notifications.values()) if(n.accountId===accountId)n.readAt=at; }
  /** Remove every notification row for an account (account deletion / purge — no orphaned private data). */
  deleteNotificationsForAccount(accountId: string): void {
    for (const [id, n] of this.notifications) {
      if (n.accountId === accountId) this.notifications.delete(id);
    }
  }
  /** Remove an account's notification preference record entirely (account deletion / purge). */
  deleteNotificationPreferences(accountId: string): void {
    this.notificationPreferences.delete(accountId);
  }
  listDiscussions(occurrenceId: string) { return [...this.discussions.values()].filter(d => d.occurrenceId === occurrenceId && d.state === "visible").sort((a,b) => a.createdAt.localeCompare(b.createdAt)); }
  /** All discussions for an event (any occurrence), soft-deleted included — cascade/audit tooling. */
  listDiscussionsByEvent(eventId: string) { return [...this.discussions.values()].filter(d => d.eventId === eventId); }
  /** Active (visible) discussions for an event, newest first — admin listing. */
  listActiveDiscussions(eventId?: string, cityId?: string) { return [...this.discussions.values()].filter(d => d.state === "visible" && (!eventId || d.eventId === eventId) && (!cityId || d.cityId === cityId)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
  getDiscussion(id: string) { return this.discussions.get(id); }
  addDiscussion(d: import("./types").DiscussionRecord) { this.discussions.set(d.id, d); return d; }
  updateDiscussion(id: string, patch: Partial<import("./types").DiscussionRecord>) { const d=this.discussions.get(id); if (!d) return undefined; const n={...d,...patch,updatedAt:this.now().toISOString()}; this.discussions.set(id,n); return n; }
  consumeDiscussionRate(accountId:string, nowMs:number, limit=10, windowMs=60*60*1000) { const current=(this.discussionRate.get(accountId)??[]).filter(t=>nowMs-t<windowMs); if(current.length>=limit){this.discussionRate.set(accountId,current);return false;} current.push(nowMs);this.discussionRate.set(accountId,current);return true; }
  // --------------------------------------------------------------- forum posts
  /** All user-created forum posts (visible and soft-deleted) for a city. */
  listForumPosts(cityId?: string) { return [...this.forumPosts.values()].filter(f => !cityId || f.cityId === cityId); }
  getForumPost(id: string) { return this.forumPosts.get(id); }
  addForumPost(f: import("./types").ForumPostRecord) { this.forumPosts.set(f.id, f); return f; }
  updateForumPost(id: string, patch: Partial<import("./types").ForumPostRecord>) { const f = this.forumPosts.get(id); if (!f) return undefined; const n = { ...f, ...patch, updatedAt: this.now().toISOString() }; this.forumPosts.set(id, n); return n; }
  listForumReplies(postId?: string) { return [...this.forumReplies.values()].filter(r => !postId || r.postId === postId); }
  getForumReply(id: string) { return this.forumReplies.get(id); }
  addForumReply(r: import("./types").ForumReplyRecord) { this.forumReplies.set(r.id, r); return r; }
  updateForumReply(id: string, patch: Partial<import("./types").ForumReplyRecord>) { const r = this.forumReplies.get(id); if (!r) return undefined; const n = { ...r, ...patch, updatedAt: this.now().toISOString() }; this.forumReplies.set(id, n); return n; }
  // ---------------------------------------------------------------- accounts
  listAccounts(): AccountRecord[] {
    return [...this.accounts.values()];
  }
  getAccount(id: string): AccountRecord | undefined {
    return this.accounts.get(id);
  }
  getAccountByEmail(email: string): AccountRecord | undefined {
    const key = email.trim().toLowerCase();
    return [...this.accounts.values()].find((a) => a.email.toLowerCase() === key);
  }
  /**
   * Look up an account by its normalized username (case-insensitive). The
   * caller MUST pass the already-normalized form (see `normalizeUsername` in
   * `src/lib/username.ts`) — this method compares on the stored, normalized
   * lowercase value, so any casing of the same name collides deterministically.
   */
  getAccountByUsername(username: string): AccountRecord | undefined {
    const key = username.trim().toLowerCase();
    return [...this.accounts.values()].find((a) => a.username !== null && a.username !== undefined && a.username.toLowerCase() === key);
  }
  createAccount(input: {
    name: string;
    email: string;
    username?: string | null;
    /** Home city id — REQUIRED for new signups (validated in the API layer against known city entities). */
    cityId?: string | null;
    phone?: string | null;
    birthdate?: string | null;
    requestedRole?: "runner" | "group_leader" | null;
  }): AccountRecord {
    const isOwner = input.email.trim().toLowerCase() === (process.env.RUN_LOCAL_ADMIN_EMAIL ?? "").trim().toLowerCase();
    const rec: AccountRecord = {
      id: newId(),
      name: input.name.trim().slice(0, 60),
      email: input.email.trim().toLowerCase(),
      weekStartDay: 0,
      // Uniqueness/validation live in the API layer (single-threaded store:
      // check-then-write is atomic in-process). The store keeps the value as
      // given — callers are expected to pass the normalized form.
      username: input.username ?? null,
      cityId: input.cityId ?? null,
      paceLabel: null,
      runningGoal: null,
      trainingBlock: null,
      upcomingRaces: null,
      bio: null,
      customTitle: null,
      instagramUrl: null,
      facebookUrl: null,
      tiktokUrl: null,
      showSocialLinks: false,
      status: isOwner ? "verified" : "pending",
      phase: "email",
      role: isOwner ? "site_admin" : "runner",
      roles: isOwner ? ["site_admin"] : ["runner"],
      adminCityId: null,
      rolePriorAdmin: null,
      requestedRole: input.requestedRole ?? null,
      profilePhotoRef: null,
      supabaseAuthId: null,
      phone: input.phone ?? null,
      phoneVerified: false,
      phoneVerifiedAt: null,
      birthdate: input.birthdate ?? null,
      selfieRef: null,
      selfieCapturedAt: null,
      signupIp: null,
      signupAt: nowIso(this.now()),
      lastActivityAt: nowIso(this.now()),
      loginIps: [],
      verifiedAt: isOwner ? nowIso(this.now()) : null,
      rejectionReason: null,
      priorRejectionReason: null,
      deletedAt: null,
      purgeAt: null,
      purgedAt: null,
      retentionYears: this.retentionYears,
      suspended: false,
      suspendedUntil: null,
      suspensionReason: null,
      underReview: false,
      underReviewAt: null,
      trustedMember: false,
      trustedMemberAt: null,
    };
    this.accounts.set(rec.id, rec);
    return rec;
  }
  /**
   * A rejected (not deleted) account tries to sign up again with the same
   * email — rather than permanently blocking them with "email taken"
   * (the actual bug: previously the only way forward was contacting support
   * to have the old record deleted), this resets the SAME account record to
   * a fresh pending state with their new signup details, moving the old
   * rejectionReason into priorRejectionReason so an admin reviewing the new
   * submission has full context. Does not restore the old username (it was
   * released back to the pool on rejection and may be taken by now) - the
   * new signup's chosen username is used, already validated for uniqueness
   * by the caller before this runs.
   */
  resubmitRejectedAccount(id: string, input: { name: string; username: string; phone: string | null; birthdate: string | null; cityId: string | null; requestedRole: "runner" | "group_leader" | null }): AccountRecord | undefined {
    const rec = this.accounts.get(id);
    if (!rec || rec.status !== "rejected" || rec.deletedAt) return undefined;
    return this.updateAccount(id, {
      name: input.name.trim().slice(0, 60),
      username: input.username,
      phone: input.phone,
      birthdate: input.birthdate,
      cityId: input.cityId,
      requestedRole: input.requestedRole,
      status: "pending",
      phase: "email",
      selfieRef: null,
      selfieCapturedAt: null,
      phoneVerified: false,
      phoneVerifiedAt: null,
      priorRejectionReason: rec.rejectionReason,
      rejectionReason: null,
      signupAt: nowIso(this.now()),
      lastActivityAt: nowIso(this.now()),
    });
  }
  updateAccount(id: string, patch: Partial<AccountRecord>): AccountRecord | undefined {
    const rec = this.accounts.get(id);
    if (!rec) return undefined;
    const next = { ...rec, ...patch };
    // Keep the legacy single `role` field and the multi-role `roles` set in
    // sync for ALL callers (backward-compat guarantee of the multi-role model):
    // - `roles` (an array) is the authoritative write form — derive `role` as
    //   the set's highest-ranked member (production writers use rolesPatch /
    //   addRolePatch, which already pass both consistently).
    // - a legacy single `role` write (test fixtures / pre-multi-role callers)
    //   is MERGED into the stored set rather than replacing it, so a role set
    //   that already exists (e.g. ["runner"]) never shadows the new role.
    if (Array.isArray(patch.roles)) {
      next.role = highestRole(normalizeRoles(patch.roles));
    } else if (patch.role !== undefined) {
      next.roles = normalizeRoles([...storedRoles(rec), patch.role]);
      next.role = highestRole(next.roles);
    }
    this.accounts.set(id, next);
    return next;
  }
  /** Touch the activity clock used for inactivity-based retention. */
  touchActivity(id: string, now = new Date()): void {
    const rec = this.accounts.get(id);
    if (!rec) return;
    rec.lastActivityAt = nowIso(now);
  }

  /** Append to the rolling 90-day login IP history (prunes old entries). */
  appendLoginIp(id: string, ip: string, now = new Date()): void {
    const rec = this.accounts.get(id);
    if (!rec) return;
    const cutoff = now.getTime() - LOGIN_IP_WINDOW_MS;
    const window = rec.loginIps.filter((e) => new Date(e.at).getTime() >= cutoff);
    window.push({ ip, at: nowIso(now) });
    rec.loginIps = window.slice(-LOGIN_IP_MAX_ENTRIES);
  }

  /** Remove an account record entirely (retention purge / full deletion). */
  removeAccount(id: string): void {
    this.accounts.delete(id);
    this.deleteCode(id);
  }

  // ------------------------------------------------------ private matching data
  getMatchingPreferences(accountId: string): import("./types").MatchingPreferencesRecord | undefined { return this.matchingPreferences.get(accountId); }
  setMatchingPreferences(record: import("./types").MatchingPreferencesRecord): void { this.matchingPreferences.set(record.accountId, record); }
  listJoinRequests(accountId: string): import("./types").JoinRequestRecord[] { return [...this.joinRequests.values()].filter((r) => r.requesterId === accountId || r.recipientId === accountId); }
  getJoinRequest(id: string): import("./types").JoinRequestRecord | undefined { return this.joinRequests.get(id); }
  addJoinRequest(record: import("./types").JoinRequestRecord): void { this.joinRequests.set(record.id, record); }
  updateJoinRequest(id: string, patch: Partial<import("./types").JoinRequestRecord>): import("./types").JoinRequestRecord | undefined { const r = this.joinRequests.get(id); if (!r) return undefined; const next = { ...r, ...patch }; this.joinRequests.set(id, next); return next; }
  findPendingJoinRequest(requesterId: string, recipientId: string, contextType: "event" | "personal_run", contextId: string): import("./types").JoinRequestRecord | undefined { return [...this.joinRequests.values()].find((r) => r.requesterId === requesterId && r.recipientId === recipientId && r.contextType === contextType && r.contextId === contextId && r.state === "pending"); }
  isBlocked(a: string, b: string): boolean { return this.blocks.has(`${a}:${b}`) || this.blocks.has(`${b}:${a}`); }
  addBlock(record: import("./types").BlockRecord): void { this.blocks.set(`${record.blockerId}:${record.blockedId}`, record); }
  /** Sliding-window limiter: returns true and records a request, persisting on caller's next persist(). */
  consumeJoinRequestRate(accountId: string, nowMs: number, limit: number, windowMs: number): boolean {
    const cutoff = nowMs - windowMs;
    const current = (this.joinRequestRate.get(accountId) ?? []).filter((t) => t > cutoff).slice(-limit);
    if (current.length >= limit) { this.joinRequestRate.set(accountId, current); return false; }
    current.push(nowMs);
    this.joinRequestRate.set(accountId, current);
    return true;
  }
  removeBlock(blockerId: string, blockedId: string): void { this.blocks.delete(`${blockerId}:${blockedId}`); }
  listBlocks(blockerId: string): import("./types").BlockRecord[] { return [...this.blocks.values()].filter(b => b.blockerId === blockerId); }
  invalidateJoinRequests(a: string, b: string): number { let n=0; for (const r of this.joinRequests.values()) if (((r.requesterId===a&&r.recipientId===b)||(r.requesterId===b&&r.recipientId===a)) && (r.state === "pending" || r.state === "accepted")) { r.state="blocked"; r.updatedAt=new Date().toISOString(); n++; } return n; }

  listSafetyReports(): SafetyReportRecord[] { return [...this.safetyReports.values()]; }
  getSafetyReport(id: string): SafetyReportRecord | undefined { return this.safetyReports.get(id); }
  addSafetyReport(r: SafetyReportRecord): void { this.safetyReports.set(r.id, r); }
  updateSafetyReport(id: string, patch: Partial<SafetyReportRecord>): SafetyReportRecord | undefined { const r=this.safetyReports.get(id); if (!r) return; const next={...r,...patch}; this.safetyReports.set(id,next); return next; }
  consumeSafetyReportRate(accountId:string, nowMs:number, limit=3, windowMs=60*60*1000): boolean { const current=(this.safetyReportRate.get(accountId)??[]).filter(t=>nowMs-t<windowMs); if(current.length>=limit){this.safetyReportRate.set(accountId,current);return false;} current.push(nowMs);this.safetyReportRate.set(accountId,current);return true; }
  /** Shared content-flag limiter: 5 flags per account per rolling hour. */
  consumeContentFlagRate(accountId:string, nowMs:number, limit=5, windowMs=60*60*1000): boolean { const current=(this.contentFlagRate.get(accountId)??[]).filter(t=>nowMs-t<windowMs); if(current.length>=limit){this.contentFlagRate.set(accountId,current);return false;} current.push(nowMs);this.contentFlagRate.set(accountId,current);return true; }
  getSettings<T>(fallback:T): T { return (this.settings ?? fallback) as T; }
  setSettings(settings: import("./types").SiteSettings): void { this.settings = settings; }
  getCity(id:string): import("./types").CmsCity | undefined { return this.cities.get(id); }
  listCities(): import("./types").CmsCity[] { return [...this.cities.values()]; }
  setCity(city:import("./types").CmsCity): void { this.cities.set(city.id, city); }

  // ------------------------------------------------------------- invitations
  listInvitations(): CityInvitationRecord[] { return [...this.invitations.values()]; }
  getInvitation(id: string): CityInvitationRecord | undefined { return this.invitations.get(id); }
  appendInvitation(rec: CityInvitationRecord): CityInvitationRecord { this.invitations.set(rec.id, rec); return rec; }
  updateInvitation(id: string, patch: Partial<CityInvitationRecord>): CityInvitationRecord | undefined {
    const rec = this.invitations.get(id);
    if (!rec) return undefined;
    const next = { ...rec, ...patch };
    this.invitations.set(id, next);
    return next;
  }
  /** Find the active (non-revoked) invitation for a city+recipient, newest first. */
  findInvitation(cityId: string, email: string): CityInvitationRecord | undefined {
    const key = email.trim().toLowerCase();
    return [...this.invitations.values()]
      .filter((i) => i.cityId === cityId && i.email.toLowerCase() === key && i.revokedAt === null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  // ------------------------------------------------------------ cms image refs
  /**
   * Store CMS image bytes under an opaque ref. File-backed stores write to
   * uploads/private (like selfies) so image data never appears in db.json;
   * in-memory stores keep the bytes in the map. The ref is the ONLY value
   * that settings/cities ever carry.
   */
  async saveRef(ref: string, bytes: Buffer): Promise<void> {
    this.refs.set(ref, bytes);
    if (!this.dataDir) return;
    const dir = this.uploadDir("private");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `cms-${ref}`), bytes);
  }
  /** Read CMS image bytes by ref (memory first, then disk). */
  async readRef(ref: string): Promise<Buffer | null> {
    const mem = this.refs.get(ref);
    if (mem) return mem;
    if (!this.dataDir) return null;
    try {
      return await readFile(join(this.uploadDir("private"), `cms-${ref}`));
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- sessions
  getSession(id: string): SessionRecord | undefined {
    return this.sessions.get(id);
  }
  /** Approximate presence — true if any of the account's sessions has been active within PRESENCE_WINDOW_MS. No push layer, so this is polling-accurate, not instant. */
  isAccountOnline(accountId: string, now: Date): boolean {
    const cutoff = now.getTime() - PRESENCE_WINDOW_MS;
    for (const s of this.sessions.values()) {
      if (s.accountId === accountId && new Date(s.lastSeenAt).getTime() >= cutoff) return true;
    }
    return false;
  }
  createSession(accountId: string, ip: string, now = new Date()): SessionRecord {
    const rec: SessionRecord = {
      id: newId(),
      accountId,
      createdAt: nowIso(now),
      lastSeenAt: nowIso(now),
      ip,
    };
    this.sessions.set(rec.id, rec);
    return rec;
  }
  deleteSession(id: string): void {
    this.sessions.delete(id);
  }
  deleteSessionsForAccount(accountId: string): void {
    for (const [sid, s] of this.sessions) {
      if (s.accountId === accountId) this.sessions.delete(sid);
    }
  }
  pruneSessions(maxAgeMs: number, now = new Date()): number {
    const cutoff = now.getTime() - maxAgeMs;
    let removed = 0;
    for (const [sid, s] of this.sessions) {
      if (new Date(s.lastSeenAt).getTime() < cutoff) {
        this.sessions.delete(sid);
        removed++;
      }
    }
    return removed;
  }

  // ------------------------------------------------------------------- codes
  getCode(accountId: string): CodeRecord | undefined {
    return this.codes.get(accountId);
  }
  createCode(accountId: string, email: string, now = new Date()): { code: string; record: CodeRecord } {
    const code = newCode();
    const salt = randomBytes(16).toString("hex");
    const rec: CodeRecord = {
      accountId,
      hash: hashCode(code, salt),
      salt,
      expiresAt: nowIso(new Date(now.getTime() + CODE_TTL_MS)),
      attempts: 0,
      createdAt: nowIso(now),
      email,
    };
    this.codes.set(accountId, rec);
    return { code, record: rec };
  }
  deleteCode(accountId: string): void {
    this.codes.delete(accountId);
  }

  // --------------------------------------------------------- memberships
  listMemberships(accountId?: string): GroupMembershipRecord[] {
    return [...this.memberships.values()].filter((m) => !accountId || m.accountId === accountId);
  }
  getMembership(groupId: string, accountId: string): GroupMembershipRecord | undefined {
    return [...this.memberships.values()].find((m) => m.groupId === groupId && m.accountId === accountId);
  }
  getMembershipById(id: string): GroupMembershipRecord | undefined { return this.memberships.get(id); }
  addMembership(m: GroupMembershipRecord): void { this.memberships.set(m.id, m); }
  updateMembership(id: string, patch: Partial<GroupMembershipRecord>): GroupMembershipRecord | undefined {
    const current = this.memberships.get(id); if (!current) return undefined;
    const next = { ...current, ...patch }; this.memberships.set(id, next); return next;
  }

  // ------------------------------------------------------------------- audit
  appendAudit(
    entry: Omit<AuditEntry, "id" | "at" | "cityId" | "owner" | "change" | "accountId"> & { cityId?: string | null; owner?: string | null; change?: string | null; accountId?: string | null },
    now = new Date(),
  ): AuditEntry {
    const rec: AuditEntry = { ...entry, cityId: entry.cityId ?? null, owner: entry.owner ?? null, change: entry.change ?? null, accountId: entry.accountId ?? null, id: newId(), at: nowIso(now) };
    this.audits.push(rec);
    return rec;
  }
  listAudit(limit = 100): AuditEntry[] {
    return this.audits.slice(-limit).reverse();
  }
  pruneAudits(maxAgeMs: number, now = new Date()): number {
    const cutoff = now.getTime() - maxAgeMs;
    const before = this.audits.length;
    this.audits = this.audits.filter((a) => new Date(a.at).getTime() >= cutoff);
    return before - this.audits.length;
  }

  // ------------------------------------------- canonical event registry
  listEvents(): RunEventRecord[] { return [...this.events.values()]; }
  getEvent(id: string): RunEventRecord | undefined { return this.events.get(id); }
  setEvent(rec: RunEventRecord): RunEventRecord { this.events.set(rec.id, rec); return rec; }
  // ------------------------------------------------------------- canonical races
  listRaces(): import("./types").RaceRecord[] { return [...this.races.values()]; }
  getRace(id: string): import("./types").RaceRecord | undefined { return this.races.get(id); }
  setRace(rec: import("./types").RaceRecord): import("./types").RaceRecord { this.races.set(rec.id, rec); return rec; }

  // ------------------------------------------- owner-dashboard registry
  listContent(): ContentRecord[] {
    return [...this.content.values()];
  }
  getContent(id: string): ContentRecord | undefined {
    return this.content.get(id);
  }
  /**
   * Upsert a registry record, applying the FULL incoming state. Moderation
   * callers pass the complete record (hidden/featured/pinned included);
   * re-seeding never touches existing records (see contentSeed.ts) so owner
   * decisions are preserved.
   */
  upsertContent(rec: ContentRecord): ContentRecord {
    const prev = this.content.get(rec.id);
    const next = prev ? { ...prev, ...rec } : rec;
    this.content.set(rec.id, next);
    return next;
  }
  listWaivers(groupId?: string) { return [...this.waivers.values()].filter(w => !groupId || w.groupId===groupId); }
  addWaiver(w: import("./waivers").GroupWaiverVersion) { this.waivers.set(w.id,w); return w; }
  listWaiverSignatures(groupId?: string) { return [...this.waiverSignatures.values()].filter(s => !groupId || s.groupId===groupId); }
  getWaiverSignature(groupId:string, waiverVersionId:string, signerId:string) { return [...this.waiverSignatures.values()].find(s=>s.groupId===groupId&&s.waiverVersionId===waiverVersionId&&s.signerId===signerId); }
  addWaiverSignature(s: import("./waivers").GroupWaiverSignature) { this.waiverSignatures.set(s.id,s); return s; }
  updateWaiverSignature(id:string, patch: Partial<import("./waivers").GroupWaiverSignature>) { const s=this.waiverSignatures.get(id); if(!s)return; const next={...s,...patch}; this.waiverSignatures.set(id,next); return next; }
  // ------------------------------------------------- organizer check-ins
  listCheckins(occurrenceId?: string, accountId?: string) { return [...this.checkins.values()].filter(c => (!occurrenceId || c.occurrenceId === occurrenceId) && (!accountId || c.accountId === accountId)); }
  getCheckin(occurrenceId: string, accountId: string) { return [...this.checkins.values()].find(c => c.occurrenceId === occurrenceId && c.accountId === accountId); }
  addCheckin(c: import("./checkins").EventCheckInRecord) { this.checkins.set(c.id, c); return c; }
  removeCheckin(id: string) { this.checkins.delete(id); }
  listQrSessions(occurrenceId?: string) { return [...this.checkinQrSessions.values()].filter(q => !occurrenceId || q.occurrenceId === occurrenceId); }
  addQrSession(q: import("./checkins").CheckInQrSession) { this.checkinQrSessions.set(q.id, q); return q; }
  updateQrSession(id: string, patch: Partial<import("./checkins").CheckInQrSession>) { const q = this.checkinQrSessions.get(id); if (!q) return; const next = { ...q, ...patch }; this.checkinQrSessions.set(id, next); return next; }
  listGroups(): GroupModRecord[] {
    return [...this.groups.values()];
  }
  getGroup(id: string): GroupModRecord | undefined {
    return this.groups.get(id);
  }
  upsertGroup(rec: GroupModRecord): GroupModRecord {
    const prev = this.groups.get(rec.id);
    if (prev) {
      // Preserve owner-managed badge state and notes across re-seeds.
      const next = { ...prev, cityId: rec.cityId, name: rec.name };
      this.groups.set(rec.id, next);
      return next;
    }
    this.groups.set(rec.id, rec);
    return rec;
  }
  updateGroup(id: string, patch: Partial<GroupModRecord>): GroupModRecord | undefined {
    const rec = this.groups.get(id);
    if (!rec) return undefined;
    const next = { ...rec, ...patch };
    this.groups.set(id, next);
    return next;
  }
  listFlags(): FlagRecord[] {
    return [...this.flags];
  }
  getFlag(id: string): FlagRecord | undefined {
    return this.flags.find((f) => f.id === id);
  }
  appendFlag(flag: Omit<FlagRecord, "id" | "createdAt">, now = new Date()): FlagRecord {
    const rec: FlagRecord = { ...flag, id: newId(), createdAt: nowIso(now) };
    this.flags.push(rec);
    return rec;
  }
  updateFlag(id: string, patch: Partial<FlagRecord>): FlagRecord | undefined {
    const idx = this.flags.findIndex((f) => f.id === id);
    if (idx === -1) return undefined;
    const next = { ...this.flags[idx], ...patch };
    this.flags[idx] = next;
    return next;
  }

  // ------------------------------------------------------------- submissions
  listSubmissions(): SubmissionRecord[] {
    return [...this.submissions.values()];
  }
  getSubmission(id: string): SubmissionRecord | undefined {
    return this.submissions.get(id);
  }
  listSubmissionsBySubmitter(accountId: string): SubmissionRecord[] {
    return this.listSubmissions()
      .filter((s) => s.submitterAccountId === accountId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }
  appendSubmission(rec: SubmissionRecord): SubmissionRecord {
    this.submissions.set(rec.id, rec);
    return rec;
  }
  updateSubmission(id: string, patch: Partial<SubmissionRecord>): SubmissionRecord | undefined {
    const rec = this.submissions.get(id);
    if (!rec) return undefined;
    const next = { ...rec, ...patch };
    this.submissions.set(id, next);
    return next;
  }
  removeSubmission(id: string): boolean {
    return this.submissions.delete(id);
  }

  // ------------------------------------------------------------- activities
  listActivities(accountId?: string) { return [...this.activities.values()].filter(a => !accountId || a.accountId === accountId); }
  addActivity(a: import("./activity").Activity) { this.activities.set(a.id, a); return a; }
  removeActivities(accountId: string, provider: import("./activity").Provider) { for (const [id,a] of this.activities) if (a.accountId===accountId && a.provider===provider) this.activities.delete(id); }
  getToken(accountId: string, provider: import("./activity").Provider) { return this.oauthTokens.get(`${accountId}:${provider}`); }
  setToken(t: import("./activity").OAuthToken) { this.oauthTokens.set(`${t.accountId}:${t.provider}`, t); }
  removeToken(accountId: string, provider: import("./activity").Provider) { this.oauthTokens.delete(`${accountId}:${provider}`); }

  // ------------------------------------------------------ credentials & trust
  listCredentials(accountId?: string) { return [...this.credentials.values()].filter(c => !accountId || c.accountId === accountId); }
  getCredential(id: string) { return this.credentials.get(id); }
  addCredential(c: import("./types").CredentialRecord) { this.credentials.set(c.id, c); return c; }
  updateCredential(id: string, patch: Partial<import("./types").CredentialRecord>) { const c=this.credentials.get(id); if (!c) return undefined; const n={...c,...patch}; this.credentials.set(id,n); return n; }
  listRatings() { return [...this.ratings.values()].filter((r) => !r.deletedAt); }
  /** All ratings, soft-deleted included (cascade/audit tooling only). */
  listAllRatings() { return [...this.ratings.values()]; }
  addRating(r: import("./types").RatingRecord) { this.ratings.set(r.id,r); return r; }
  updateRating(id: string, patch: Partial<import("./types").RatingRecord>) { const r=this.ratings.get(id); if(!r)return; const n={...r,...patch}; this.ratings.set(id,n); return n; }
  hasRating(reviewerId:string, revieweeId:string, eventId:string) { return [...this.ratings.values()].some(r=>r.reviewerId===reviewerId&&r.revieweeId===revieweeId&&r.eventId===eventId&&!r.deletedAt); }
  listConcerns() { return [...this.concerns.values()]; }
  addConcern(c: import("./types").ConcernRecord) { this.concerns.set(c.id,c); return c; }
  updateConcern(id:string, patch: Partial<import("./types").ConcernRecord>) { const c=this.concerns.get(id); if(!c)return; const n={...c,...patch};this.concerns.set(id,n);return n; }
  listAppeals(accountId?:string) { return [...this.appeals.values()].filter(a=>!accountId||a.accountId===accountId); }
  getAppeal(id:string) { return this.appeals.get(id); }
  addAppeal(a: import("./types").AppealRecord) { this.appeals.set(a.id,a);return a; }
  updateAppeal(id:string, patch: Partial<import("./types").AppealRecord>) { const a=this.appeals.get(id);if(!a)return;const n={...a,...patch};this.appeals.set(id,n);return n; }
  listRecognitions() { return [...this.recognitions.values()]; }
  setRecognition(r: import("./types").RecognitionRecord) { this.recognitions.set(`${r.accountId}:${r.role}`,r);return r; }
  // ------------------------------------------------------- shared attendance
  /** Active (non-soft-deleted) attendance rows. */
  listAttendance(accountId?: string) { return [...this.attendance.values()].filter(a => !a.deletedAt && (!accountId || a.accountId === accountId)); }
  listAttendanceByEvent(eventId: string) { return [...this.attendance.values()].filter(a => a.eventId === eventId && !a.deletedAt); }
  /** All attendance rows for an event, soft-deleted included (cascade tooling). */
  listAllAttendanceByEvent(eventId: string) { return [...this.attendance.values()].filter(a => a.eventId === eventId); }
  hasAttendance(accountId: string, eventId: string) { return [...this.attendance.values()].some(a => !a.deletedAt && a.accountId === accountId && a.eventId === eventId); }
  addAttendance(a: import("./types").AttendanceRecord) { this.attendance.set(a.id, a); return a; }
  updateAttendance(id: string, patch: Partial<import("./types").AttendanceRecord>) { const a = this.attendance.get(id); if (!a) return undefined; const next = { ...a, ...patch }; this.attendance.set(id, next); return next; }
  /**
   * Fires a "your run starts soon" notification for every active RSVP whose
   * event starts within the reminder window and hasn't been reminded yet.
   * Idempotent per attendance row (remindedAt gates it) so calling this on
   * every interval tick never double-notifies. Returns the count notified,
   * for logging only — never account ids.
   */
  checkRunReminders(now: Date, windowMinutes = 90): number {
    const nowMs = now.getTime();
    const windowEndMs = nowMs + windowMinutes * 60_000;
    let notified = 0;
    for (const a of this.attendance.values()) {
      if (a.deletedAt || a.remindedAt || !a.startsAt) continue;
      const startsMs = Date.parse(a.startsAt);
      if (!Number.isFinite(startsMs) || startsMs < nowMs || startsMs > windowEndMs) continue;
      this.updateAttendance(a.id, { remindedAt: now.toISOString() });
      if (this.getNotificationPreferences(a.accountId).run_reminders) {
        const minutesAway = Math.round((startsMs - nowMs) / 60_000);
        this.addNotification({ id: newId(), accountId: a.accountId, category: "run_reminders", title: "Your run is coming up", body: `Starting in about ${minutesAway} minute${minutesAway === 1 ? "" : "s"} — see you out there.`, createdAt: now.toISOString(), readAt: null, link: { kind: "event", id: a.eventId } });
        notified++;
      }
    }
    return notified;
  }
  removeAttendance(id: string) { this.attendance.delete(id); }
  /** The date of the week-start day (0=Sun..1=Mon) that the given date falls within - e.g. weekStartDay=1 (Monday) and a Wednesday date returns that week's Monday. */
  weekStartDateFor(dateStr: string, weekStartDay: 0 | 1): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    const diff = (d.getUTCDay() - weekStartDay + 7) % 7;
    d.setUTCDate(d.getUTCDate() - diff);
    return d.toISOString().slice(0, 10);
  }
  getWeeklyPlanEmail(accountId: string, weekStartDate: string): import("./types").WeeklyPlanEmailRecord | undefined {
    return this.weeklyPlanEmails.get(`${accountId}-weekemail-${weekStartDate}`);
  }
  recordWeeklyPlanEmail(rec: import("./types").WeeklyPlanEmailRecord): import("./types").WeeklyPlanEmailRecord {
    this.weeklyPlanEmails.set(rec.id, rec);
    return rec;
  }
  /**
   * Pure query, no side effects (mirrors checkRunReminders' shape): every
   * account whose own week-start day is TODAY and who has an active
   * training plan and hasn't already had a weekly email recorded for this
   * week (manual or automatic - either way, idempotent). Actually building
   * and sending the email happens elsewhere (see weeklyPlanEmail.ts), since
   * that needs the email templating/sending code this store layer
   * deliberately doesn't know about.
   */
  listAccountsDueForWeeklyPlanEmail(now: Date): { accountId: string; weekStartDate: string }[] {
    const todayStr = now.toISOString().slice(0, 10);
    const due: { accountId: string; weekStartDate: string }[] = [];
    for (const plan of this.trainingPlans.values()) {
      const account = this.accounts.get(plan.accountId);
      if (!account || account.deletedAt) continue;
      const weekStart = this.weekStartDateFor(todayStr, account.weekStartDay);
      if (weekStart !== todayStr) continue; // only fires on the week-start day itself
      if (this.getWeeklyPlanEmail(plan.accountId, weekStart)) continue; // already sent (manual or automatic) - idempotent
      due.push({ accountId: plan.accountId, weekStartDate: weekStart });
    }
    return due;
  }
  /**
   * Read one account's event/occurrence visibility override. Returns
   * "inherit" when the account has no matching attendance row (or the row
   * carries no override) — the caller (canView) falls through to the global
   * setting in that case. `occurrenceId` refines the lookup to the exact
   * occurrence; when no occurrence-exact row exists, event-level rows apply.
   */
  getAttendanceVisibilityOverride(accountId: string, eventId: string, occurrenceId?: string): import("./types").AttendanceVisibility {
    const norm = (id: string) => id.replace(/^event:/, "");
    const rows = [...this.attendance.values()].filter((a) => !a.deletedAt && a.accountId === accountId && norm(a.eventId) === norm(eventId));
    if (occurrenceId) {
      const exact = rows.find((a) => a.occurrenceId === occurrenceId);
      if (exact) return exact.visibilityOverride ?? "inherit";
    }
    const withOverride = rows.find((a) => (a.visibilityOverride ?? "inherit") !== "inherit");
    return withOverride ? (withOverride.visibilityOverride ?? "inherit") : "inherit";
  }
  // ------------------------------------------------------- connections & privacy
  /** The single row for a pair (any status), regardless of request direction. */
  getConnectionPair(a: string, b: string): import("./types").ConnectionRecord | undefined {
    return this.connections.get(connectionKey(a, b));
  }
  /** Accepted rows where the account is either side. */
  listAcceptedConnections(accountId: string): import("./types").ConnectionRecord[] {
    return [...this.connections.values()].filter((c) => c.status === "accepted" && (c.requesterId === accountId || c.addresseeId === accountId));
  }
  /** Pending requests addressed to the account. */
  listIncomingRequests(accountId: string): import("./types").ConnectionRecord[] {
    return [...this.connections.values()].filter((c) => c.status === "pending" && c.addresseeId === accountId);
  }
  /** The ACTIVE (pending|accepted) row between the account and otherId, if any. */
  listActiveConnection(accountId: string, otherId: string): import("./types").ConnectionRecord | undefined {
    const c = this.getConnectionPair(accountId, otherId);
    return c && isActiveConnection(c.status) ? c : undefined;
  }
  /**
   * Write a connection row, keyed by the sorted pair. Enforces the one-active-
   * row invariant: writing an ACTIVE row (pending/accepted) while an active row
   * already exists for the pair throws — callers must resolve or reuse the
   * existing active state (see src/server/connections.ts). Terminal history
   * (declined/removed) is freely superseded by a fresh row.
   */
  upsertConnection(record: import("./types").ConnectionRecord): import("./types").ConnectionRecord {
    const existing = this.getConnectionPair(record.requesterId, record.addresseeId);
    if (existing && isActiveConnection(existing.status) && isActiveConnection(record.status)) {
      throw new Error("connection: one-active-row invariant violated for pair");
    }
    this.connections.set(connectionKey(record.requesterId, record.addresseeId), record);
    return record;
  }
  updateConnection(id: string, patch: Partial<import("./types").ConnectionRecord>): import("./types").ConnectionRecord | undefined {
    for (const [key, c] of this.connections) {
      if (c.id === id) {
        const next = { ...c, ...patch };
        this.connections.set(key, next);
        return next;
      }
    }
    return undefined;
  }
  /** Finds the existing 1:1 thread between two accounts, or creates one. Never duplicates — the pair is looked up by membership, not a derived key, so it's stable regardless of who messages first. */
  findOrCreateDirectConversation(a: string, b: string, now: Date): import("./types").ConversationRecord {
    for (const c of this.conversations.values()) {
      if (!c.isGroup && c.participantIds.length === 2 && c.participantIds.includes(a) && c.participantIds.includes(b)) return c;
    }
    const rec: import("./types").ConversationRecord = { id: newId(), isGroup: false, name: null, participantIds: [a, b], createdBy: a, createdAt: now.toISOString(), lastMessageAt: now.toISOString(), runCreatedId: null, readBy: {} };
    this.conversations.set(rec.id, rec);
    return rec;
  }
  createGroupConversation(input: { name: string; participantIds: string[]; createdBy: string }, now: Date): import("./types").ConversationRecord {
    const rec: import("./types").ConversationRecord = { id: newId(), isGroup: true, name: input.name, participantIds: [...new Set(input.participantIds)], createdBy: input.createdBy, createdAt: now.toISOString(), lastMessageAt: now.toISOString(), runCreatedId: null, readBy: {} };
    this.conversations.set(rec.id, rec);
    return rec;
  }
  getConversation(id: string): import("./types").ConversationRecord | undefined {
    return this.conversations.get(id);
  }
  /** Newest-first by last activity — the natural inbox order. */
  getConversationsForAccount(accountId: string): import("./types").ConversationRecord[] {
    return [...this.conversations.values()].filter((c) => c.participantIds.includes(accountId)).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }
  updateConversation(id: string, patch: Partial<import("./types").ConversationRecord>): import("./types").ConversationRecord | undefined {
    const c = this.conversations.get(id);
    if (!c) return undefined;
    const next = { ...c, ...patch };
    this.conversations.set(id, next);
    return next;
  }
  addMessage(input: { conversationId: string; senderId: string; body: string; mediaRef?: string | null }, now: Date): import("./types").MessageRecord {
    const rec: import("./types").MessageRecord = { id: newId(), conversationId: input.conversationId, senderId: input.senderId, body: input.body, createdAt: now.toISOString(), deletedAt: null, reactions: {}, mediaRef: input.mediaRef ?? null };
    this.messages.set(rec.id, rec);
    this.updateConversation(input.conversationId, { lastMessageAt: rec.createdAt });
    return rec;
  }
  /** Oldest-first — natural reading order for a thread. */
  getMessages(conversationId: string): import("./types").MessageRecord[] {
    return [...this.messages.values()].filter((m) => m.conversationId === conversationId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  getMessage(id: string): import("./types").MessageRecord | undefined {
    return this.messages.get(id);
  }
  /** One reaction per person per message — setting again overwrites, passing null removes it. */
  setReaction(messageId: string, accountId: string, emoji: string | null): import("./types").MessageRecord | undefined {
    const m = this.messages.get(messageId);
    if (!m) return undefined;
    const reactions = { ...m.reactions };
    if (emoji) reactions[accountId] = emoji; else delete reactions[accountId];
    const next = { ...m, reactions };
    this.messages.set(messageId, next);
    return next;
  }
  editMessage(messageId: string, body: string, now: Date): import("./types").MessageRecord | undefined {
    const m = this.messages.get(messageId);
    if (!m) return undefined;
    const next = { ...m, body, editedAt: now.toISOString() };
    this.messages.set(messageId, next);
    return next;
  }
  deleteMessage(messageId: string, now: Date): import("./types").MessageRecord | undefined {
    const m = this.messages.get(messageId);
    if (!m) return undefined;
    const next = { ...m, deletedAt: now.toISOString() };
    this.messages.set(messageId, next);
    return next;
  }
  getTrainingPlan(accountId: string): import("./types").TrainingPlanRecord | undefined {
    return this.trainingPlans.get(accountId);
  }
  setTrainingPlan(plan: import("./types").TrainingPlanRecord): import("./types").TrainingPlanRecord {
    this.trainingPlans.set(plan.accountId, plan);
    return plan;
  }
  deleteTrainingPlan(accountId: string): boolean {
    // Weekly and daily content belongs to the plan - deleting the plan
    // without clearing them would leave orphaned rows that reappear (with
    // stale content) if the person ever creates a new plan later.
    for (const w of this.listTrainingPlanWeeks(accountId)) this.trainingPlanWeeks.delete(w.id);
    for (const d of this.listTrainingPlanDays(accountId)) this.trainingPlanDays.delete(d.id);
    return this.trainingPlans.delete(accountId);
  }
  listTrainingPlanWeeks(accountId: string): import("./types").TrainingPlanWeekRecord[] {
    return [...this.trainingPlanWeeks.values()].filter((w) => w.accountId === accountId).sort((a, b) => a.weekNumber - b.weekNumber);
  }
  getTrainingPlanWeek(accountId: string, weekNumber: number): import("./types").TrainingPlanWeekRecord | undefined {
    return this.trainingPlanWeeks.get(`${accountId}-week-${weekNumber}`);
  }
  setTrainingPlanWeek(week: import("./types").TrainingPlanWeekRecord): import("./types").TrainingPlanWeekRecord {
    this.trainingPlanWeeks.set(week.id, week);
    return week;
  }
  /** True if coachId has an ACTIVE (accepted) coaching relationship with athleteId - the actual permission check used to gate plan/week access. Pending or declined never grants access. */
  isActiveCoachOf(coachId: string, athleteId: string): boolean {
    return [...this.coachRelationships.values()].some((c) => c.coachId === coachId && c.athleteId === athleteId && c.status === "active");
  }
  getCoachRelationship(id: string): import("./types").CoachRelationshipRecord | undefined {
    return this.coachRelationships.get(id);
  }
  /** Every relationship involving this account, as either coach or athlete - their own inbox of requests + active relationships. */
  listCoachRelationshipsFor(accountId: string): import("./types").CoachRelationshipRecord[] {
    return [...this.coachRelationships.values()].filter((c) => c.coachId === accountId || c.athleteId === accountId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /**
   * Requests a coaching relationship. Refuses a duplicate pending/active
   * request between the same two people in the same direction (returns the
   * existing one instead of creating a second), and refuses coaching
   * yourself. Either side can be the requester.
   */
  requestCoachRelationship(coachId: string, athleteId: string, requestedBy: "coach" | "athlete", now: Date): import("./types").CoachRelationshipRecord | null {
    if (coachId === athleteId) return null;
    const existing = [...this.coachRelationships.values()].find((c) => c.coachId === coachId && c.athleteId === athleteId && (c.status === "pending" || c.status === "active"));
    if (existing) return existing;
    const rec: import("./types").CoachRelationshipRecord = {
      id: newId(),
      coachId,
      athleteId,
      status: "pending",
      requestedBy,
      createdAt: now.toISOString(),
      respondedAt: null,
    };
    this.coachRelationships.set(rec.id, rec);
    return rec;
  }
  /** Only the party who did NOT send the request may respond - enforced by the caller (see the API handler), not here. */
  respondToCoachRelationship(id: string, accept: boolean, now: Date): import("./types").CoachRelationshipRecord | undefined {
    const rec = this.coachRelationships.get(id);
    if (!rec || rec.status !== "pending") return undefined;
    const updated: import("./types").CoachRelationshipRecord = { ...rec, status: accept ? "active" : "declined", respondedAt: now.toISOString() };
    this.coachRelationships.set(id, updated);
    return updated;
  }
  endCoachRelationship(id: string): boolean {
    return this.coachRelationships.delete(id);
  }
  getTrainingPlanDay(accountId: string, date: string, slot: import("./types").TrainingDaySlot = "primary"): import("./types").TrainingPlanDayRecord | undefined {
    return this.trainingPlanDays.get(`${accountId}-day-${date}-${slot}`);
  }
  /** Every day/slot for an account, sorted chronologically then by slot (am before pm) - the raw feed the calendar view (and PDF export, later) renders from. */
  listTrainingPlanDays(accountId: string): import("./types").TrainingPlanDayRecord[] {
    const slotOrder: Record<import("./types").TrainingDaySlot, number> = { primary: 0, am: 0, pm: 1 };
    return [...this.trainingPlanDays.values()].filter((d) => d.accountId === accountId).sort((a, b) => a.date.localeCompare(b.date) || slotOrder[a.slot] - slotOrder[b.slot]);
  }
  /** Just the days within a specific week - what the current week-focused UI actually needs, without the caller filtering the full list every time. */
  listTrainingPlanDaysInWeek(accountId: string, weekNumber: number): import("./types").TrainingPlanDayRecord[] {
    return this.listTrainingPlanDays(accountId).filter((d) => d.weekNumber === weekNumber);
  }
  /** All slots for one specific date - lets a day with both an AM and PM workout be fetched together. */
  listTrainingPlanDaySlots(accountId: string, date: string): import("./types").TrainingPlanDayRecord[] {
    return this.listTrainingPlanDays(accountId).filter((d) => d.date === date);
  }
  setTrainingPlanDay(day: import("./types").TrainingPlanDayRecord): import("./types").TrainingPlanDayRecord {
    this.trainingPlanDays.set(day.id, day);
    return day;
  }
  deleteTrainingPlanDay(accountId: string, date: string, slot: import("./types").TrainingDaySlot = "primary"): boolean {
    return this.trainingPlanDays.delete(`${accountId}-day-${date}-${slot}`);
  }
  listShoes(accountId: string): import("./types").ShoeRecord[] {
    return [...this.shoes.values()].filter((s) => s.accountId === accountId).sort((a, b) => a.name.localeCompare(b.name));
  }
  getShoe(id: string): import("./types").ShoeRecord | undefined {
    return this.shoes.get(id);
  }
  addShoe(shoe: import("./types").ShoeRecord): import("./types").ShoeRecord {
    // Only one default at a time - setting a new default silently un-defaults the rest, rather than requiring the caller to manage it.
    if (shoe.isDefault) for (const s of this.listShoes(shoe.accountId)) if (s.id !== shoe.id) this.shoes.set(s.id, { ...s, isDefault: false });
    this.shoes.set(shoe.id, shoe);
    return shoe;
  }
  setShoeDefault(accountId: string, shoeId: string): boolean {
    const target = this.shoes.get(shoeId);
    if (!target || target.accountId !== accountId) return false;
    for (const s of this.listShoes(accountId)) this.shoes.set(s.id, { ...s, isDefault: s.id === shoeId });
    return true;
  }
  deleteShoe(accountId: string, shoeId: string): boolean {
    const target = this.shoes.get(shoeId);
    if (!target || target.accountId !== accountId) return false;
    return this.shoes.delete(shoeId);
  }
  /**
   * Adjusts a shoe's cumulative mileage by a delta in miles (negative to
   * reverse a prior addition - e.g. a day gets un-marked done, or the shoe
   * on a completed day changes). No-ops silently if the shoe doesn't exist
   * or was deleted, since this always runs as a side effect of a day-save,
   * not a user-facing action that should itself fail.
   */
  adjustShoeMileage(shoeId: string, deltaMiles: number): void {
    const shoe = this.shoes.get(shoeId);
    if (!shoe) return;
    this.shoes.set(shoeId, { ...shoe, totalMiles: Math.max(0, shoe.totalMiles + deltaMiles) });
  }
  listNutritionItems(accountId: string): import("./types").NutritionItemRecord[] {
    return [...this.nutritionItems.values()].filter((n) => n.accountId === accountId).sort((a, b) => a.name.localeCompare(b.name));
  }
  getNutritionItem(id: string): import("./types").NutritionItemRecord | undefined {
    return this.nutritionItems.get(id);
  }
  addNutritionItem(item: import("./types").NutritionItemRecord): import("./types").NutritionItemRecord {
    this.nutritionItems.set(item.id, item);
    return item;
  }
  deleteNutritionItem(accountId: string, id: string): boolean {
    const target = this.nutritionItems.get(id);
    if (!target || target.accountId !== accountId) return false;
    return this.nutritionItems.delete(id);
  }
  listStrengthEntries(accountId: string, date?: string): import("./types").TrainingPlanStrengthEntryRecord[] {
    return [...this.trainingPlanStrengthEntries.values()].filter((e) => e.accountId === accountId && (!date || e.date === date)).sort((a, b) => a.date.localeCompare(b.date));
  }
  getStrengthEntry(id: string): import("./types").TrainingPlanStrengthEntryRecord | undefined {
    return this.trainingPlanStrengthEntries.get(id);
  }
  setStrengthEntry(entry: import("./types").TrainingPlanStrengthEntryRecord): import("./types").TrainingPlanStrengthEntryRecord {
    this.trainingPlanStrengthEntries.set(entry.id, entry);
    return entry;
  }
  deleteStrengthEntry(accountId: string, id: string): boolean {
    const target = this.trainingPlanStrengthEntries.get(id);
    if (!target || target.accountId !== accountId) return false;
    return this.trainingPlanStrengthEntries.delete(id);
  }
  listRecurrences(accountId: string): import("./types").TrainingPlanRecurrenceRecord[] {
    return [...this.trainingPlanRecurrences.values()].filter((r) => r.accountId === accountId).sort((a, b) => a.startDate.localeCompare(b.startDate));
  }
  getRecurrence(id: string): import("./types").TrainingPlanRecurrenceRecord | undefined {
    return this.trainingPlanRecurrences.get(id);
  }
  setRecurrence(rec: import("./types").TrainingPlanRecurrenceRecord): import("./types").TrainingPlanRecurrenceRecord {
    this.trainingPlanRecurrences.set(rec.id, rec);
    return rec;
  }
  deleteRecurrence(accountId: string, id: string): boolean {
    const target = this.trainingPlanRecurrences.get(id);
    if (!target || target.accountId !== accountId) return false;
    return this.trainingPlanRecurrences.delete(id);
  }
  /** Every day generated by this recurrence rule (whether overridden or not) - used both for "edit all" regeneration and for deciding what to clean up if the rule itself is deleted. */
  listDaysForRecurrence(accountId: string, recurrenceId: string): import("./types").TrainingPlanDayRecord[] {
    return this.listTrainingPlanDays(accountId).filter((d) => d.recurrenceId === recurrenceId);
  }
  /** Every proposal involving this person, as either athlete or coach - their own inbox. */
  listChangeProposalsFor(accountId: string): import("./types").TrainingPlanChangeProposalRecord[] {
    return [...this.trainingPlanChangeProposals.values()].filter((p) => p.athleteId === accountId || p.coachId === accountId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  getChangeProposal(id: string): import("./types").TrainingPlanChangeProposalRecord | undefined {
    return this.trainingPlanChangeProposals.get(id);
  }
  createChangeProposal(rec: import("./types").TrainingPlanChangeProposalRecord): import("./types").TrainingPlanChangeProposalRecord {
    this.trainingPlanChangeProposals.set(rec.id, rec);
    return rec;
  }
  respondToChangeProposal(id: string, approve: boolean, now: Date): import("./types").TrainingPlanChangeProposalRecord | undefined {
    const rec = this.trainingPlanChangeProposals.get(id);
    if (!rec || rec.status !== "pending") return undefined;
    const updated: import("./types").TrainingPlanChangeProposalRecord = { ...rec, status: approve ? "approved" : "declined", respondedAt: now.toISOString() };
    this.trainingPlanChangeProposals.set(id, updated);
    return updated;
  }
  /** Toggles the caller's upvote on a post — voting again removes it. Returns whether it's now upvoted. */
  toggleForumVote(accountId: string, postId: string, now: Date): boolean {
    const key = `${accountId}:${postId}`;
    if (this.forumVotes.has(key)) { this.forumVotes.delete(key); return false; }
    this.forumVotes.set(key, { accountId, postId, createdAt: now.toISOString() });
    return true;
  }
  forumVoteCount(postId: string): number {
    let count = 0;
    for (const v of this.forumVotes.values()) if (v.postId === postId) count++;
    return count;
  }
  hasForumVote(accountId: string, postId: string): boolean {
    return this.forumVotes.has(`${accountId}:${postId}`);
  }
  createAccountReport(input: { reporterId: string; reportedAccountId: string; reason: string; conversationId: string | null }, now: Date): import("./types").AccountReportRecord {
    const rec: import("./types").AccountReportRecord = { id: newId(), reporterId: input.reporterId, reportedAccountId: input.reportedAccountId, reason: input.reason, conversationId: input.conversationId, createdAt: now.toISOString(), status: "open" };
    this.accountReports.set(rec.id, rec);
    return rec;
  }
  /** Used for rate-limiting and duplicate-prevention — has this reporter already reported this account recently/at all while it's still open? */
  hasOpenAccountReport(reporterId: string, reportedAccountId: string): boolean {
    for (const r of this.accountReports.values()) if (r.reporterId === reporterId && r.reportedAccountId === reportedAccountId && r.status === "open") return true;
    return false;
  }
  listAccountReports(): import("./types").AccountReportRecord[] {
    return [...this.accountReports.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  createRoute(rec: import("./types").RouteRecord): import("./types").RouteRecord {
    this.routes.set(rec.id, rec);
    return rec;
  }
  getRoute(id: string): import("./types").RouteRecord | undefined {
    return this.routes.get(id);
  }
  listRoutes(cityId?: string): import("./types").RouteRecord[] {
    return [...this.routes.values()].filter((r) => !cityId || r.cityId === cityId).sort((a, b) => a.name.localeCompare(b.name));
  }
  /**
   * A sponsor "counts" for capacity/conflict purposes once it's paid
   * (active) — a pending, unpaid booking never blocks anyone else's dates.
   */
  private sponsorOccupiesDay(s: import("./types").SponsorRecord, day: string): boolean {
    return s.active && day >= s.startDate && day <= s.endDate;
  }

  /**
   * True if booking `tier` for [startDate, endDate] would fit within the
   * real capacity for every day in that range (1 featured / 3 standard).
   * excludeId lets an update check against itself without self-conflicting.
   */
  sponsorRangeAvailable(cityId: string, tier: "featured" | "standard", startDate: string, endDate: string, excludeId?: string): boolean {
    const cap = SPONSOR_TIER_CAPS[tier];
    const candidates = [...this.sponsors.values()].filter((s) => s.cityId === cityId && s.tier === tier && s.id !== excludeId);
    for (const day of daysInRange(startDate, endDate)) {
      const occupied = candidates.filter((s) => this.sponsorOccupiesDay(s, day)).length;
      if (occupied >= cap) return false;
    }
    return true;
  }

  /** Live sponsors for a city right now — paid AND within their date window. This is what the public Events page actually shows; a booking scheduled for next month or one that already ended doesn't render even though `active` is true. */
  listActiveSponsors(cityId: string): import("./types").SponsorRecord[] {
    const today = todayDateString();
    return [...this.sponsors.values()]
      .filter((s) => s.cityId === cityId && s.active && s.startDate <= today && s.endDate >= today)
      .sort((a, b) => (a.tier === b.tier ? a.createdAt.localeCompare(b.createdAt) : a.tier === "featured" ? -1 : 1));
  }
  listAllSponsors(cityId: string): import("./types").SponsorRecord[] {
    return [...this.sponsors.values()].filter((s) => s.cityId === cityId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  getSponsor(id: string): import("./types").SponsorRecord | undefined {
    return this.sponsors.get(id);
  }
  /**
   * Enforces real date-range capacity server-side (never just a UI
   * convention): a booking can only be created active (paid) if every day
   * in its range still has room in that tier. A pending (unpaid) booking is
   * always allowed to be created — it doesn't occupy a slot until paid, so
   * two people can hold overlapping pending inquiries at once; only the
   * first to actually pay wins the slot (see confirmSponsorPayment).
   */
  createSponsor(rec: import("./types").SponsorRecord): import("./types").SponsorRecord | null {
    if (rec.active && !this.sponsorRangeAvailable(rec.cityId, rec.tier, rec.startDate, rec.endDate)) return null;
    this.sponsors.set(rec.id, rec);
    return rec;
  }
  updateSponsor(id: string, patch: Partial<import("./types").SponsorRecord>): import("./types").SponsorRecord | null {
    const existing = this.sponsors.get(id);
    if (!existing) return null;
    const willBeActive = patch.active ?? existing.active;
    const tier = patch.tier ?? existing.tier;
    const startDate = patch.startDate ?? existing.startDate;
    const endDate = patch.endDate ?? existing.endDate;
    if (willBeActive && !this.sponsorRangeAvailable(existing.cityId, tier, startDate, endDate, id)) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.sponsors.set(id, updated);
    return updated;
  }
  deleteSponsor(id: string): boolean {
    return this.sponsors.delete(id);
  }
  /** True if this email is exempt from the 20-mile geofence (admin-added). Case-insensitive. */
  isGeofenceExempt(email: string | null | undefined): boolean {
    if (!email) return false;
    return this.geofenceAllowlist.has(email.trim().toLowerCase());
  }
  addGeofenceAllowlistEmail(email: string): void {
    this.geofenceAllowlist.add(email.trim().toLowerCase());
  }
  removeGeofenceAllowlistEmail(email: string): void {
    this.geofenceAllowlist.delete(email.trim().toLowerCase());
  }
  listGeofenceAllowlist(): string[] {
    return [...this.geofenceAllowlist].sort();
  }
  /** Called on each keystroke (client-debounced) — marks this person as typing for a few seconds. */
  setTyping(conversationId: string, accountId: string, now: Date, ttlMs = 5000): void {
    let m = this.typing.get(conversationId);
    if (!m) { m = new Map(); this.typing.set(conversationId, m); }
    m.set(accountId, now.getTime() + ttlMs);
  }
  /** Everyone currently typing in this conversation, excluding the caller and anyone whose signal has expired. */
  getTypingAccountIds(conversationId: string, excludeAccountId: string, now: Date): string[] {
    const m = this.typing.get(conversationId);
    if (!m) return [];
    const nowMs = now.getTime();
    const active: string[] = [];
    for (const [accountId, expiresAt] of m) {
      if (expiresAt < nowMs) m.delete(accountId);
      else if (accountId !== excludeAccountId) active.push(accountId);
    }
    return active;
  }
  getPrivacy(accountId: string): import("./types").PrivacySettingsRecord {
    return this.privacy.get(accountId) ?? { accountId, ...PRIVACY_DEFAULTS };
  }
  /** Upsert a privacy record, validating every patched value (throws on invalid). */
  setPrivacy(accountId: string, patch: Partial<Omit<import("./types").PrivacySettingsRecord, "accountId">>): import("./types").PrivacySettingsRecord {
    validatePrivacyPatch(patch as Record<string, unknown>);
    const next: import("./types").PrivacySettingsRecord = { ...this.getPrivacy(accountId), ...patch, accountId };
    this.privacy.set(accountId, next);
    return next;
  }
  // ---------------------------------------------------------------------- tags
  getTag(id: string): import("./types").TagRecord | undefined {
    return this.tags.get(id);
  }
  getTagsForContent(contentType: import("./types").TagContentType, contentId: string): import("./types").TagRecord[] {
    return [...this.tags.values()].filter((t) => t.contentType === contentType && t.contentId === contentId);
  }
  getTagsForUser(userId: string): import("./types").TagRecord[] {
    return [...this.tags.values()].filter((t) => t.taggedUserId === userId);
  }
  addTag(tag: import("./types").TagRecord): import("./types").TagRecord {
    this.tags.set(tag.id, tag);
    return tag;
  }
  updateTag(id: string, patch: Partial<import("./types").TagRecord>): import("./types").TagRecord | undefined {
    const t = this.tags.get(id);
    if (!t) return undefined;
    const next = { ...t, ...patch };
    this.tags.set(id, next);
    return next;
  }
  listPersonalRuns(accountId?: string) { return [...this.personalRuns.values()].filter(r => !accountId || r.accountId === accountId); }
  getPersonalRun(id: string) { return this.personalRuns.get(id); }
  addPersonalRun(r: import("./types").PersonalRunRecord) { this.personalRuns.set(r.id, r); return r; }
  updatePersonalRun(id: string, patch: Partial<import("./types").PersonalRunRecord>) { const r=this.personalRuns.get(id); if (!r) return undefined; const next={...r,...patch}; this.personalRuns.set(id,next); return next; }

  // ---------------------------------------------------------------- uploads
  private uploadDir(kind: "private" | "public"): string {
    return this.dataDir ? join(this.dataDir, "uploads", kind) : "";
  }

  async writePrivateUpload(filename: string, buffer: Buffer): Promise<void> {
    // Keep bytes in memory so in-memory/test stores can serve proofs back.
    this.privateUploads.set(filename, buffer);
    if (!this.dataDir) return;
    const dir = this.uploadDir("private");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), buffer);
  }
  async readPrivateUpload(filename: string): Promise<Buffer | null> {
    const mem = this.privateUploads.get(filename);
    if (mem) return mem;
    if (!this.dataDir) return null;
    try {
      return await readFile(join(this.uploadDir("private"), filename));
    } catch {
      return null;
    }
  }
  async deletePrivateUpload(filename: string): Promise<void> {
    this.privateUploads.delete(filename);
    if (!this.dataDir) return;
    try {
      await unlink(join(this.uploadDir("private"), filename));
    } catch {
      // already gone — fine
    }
  }
  async writePublicUpload(filename: string, buffer: Buffer): Promise<void> {
    if (!this.dataDir) return;
    const dir = this.uploadDir("public");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), buffer);
  }
  async readPublicUpload(filename: string): Promise<Buffer | null> {
    if (!this.dataDir) return null;
    try {
      return await readFile(join(this.uploadDir("public"), filename));
    } catch {
      return null;
    }
  }
  async deletePublicUpload(filename: string): Promise<void> {
    if (!this.dataDir) return;
    try {
      await unlink(join(this.uploadDir("public"), filename));
    } catch {
      // already gone — fine
    }
  }
}

/** In-memory store for tests / ephemeral runs. */
export function createMemoryStore(opts: Omit<DbOptions, "dataDir"> = {}): Db {
  return new Db({ ...opts, dataDir: null });
}
