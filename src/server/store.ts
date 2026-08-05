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
import type {
  AccountRecord,
  AuditEntry,
  CityInvitationRecord,
  CodeRecord,
  ContentRecord,
  FlagRecord,
  GroupModRecord,
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
  status: AccountRecord["status"];
  phase: VerifyPhase | null;
  badge: "verified" | null;
  /** Assigned runner role (label only — never a power source). */
  role: AccountRecord["role"];
  /** Server-derived super-admin flag (from RUN_LOCAL_OWNER_EMAIL). */
  isOwner: boolean;
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

export function toPublicAccount(rec: AccountRecord, isOwner = false, now = new Date()): PublicAccount {
  return {
    id: rec.id,
    name: rec.name,
    email: rec.email,
    username: rec.username ?? null,
    cityId: rec.cityId ?? null,
    status: rec.status,
    phase: rec.status === "pending" ? rec.phase : null,
    badge: rec.status === "verified" ? "verified" : null,
    role: rec.role,
    isOwner,
    suspended: isSuspended(rec, now),
    underReview: rec.underReview === true,
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
  private groups = new Map<string, GroupModRecord>();
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
  private notificationPreferences = new Map<string, import("./types").NotificationPreferenceRecord>();
  private notifications = new Map<string, import("./types").NotificationRecord>();
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
        // Same for the community-trust review state: accounts persisted before
        // it existed lack the fields — treat as not under review.
        a.underReview = a.underReview === true;
        a.underReviewAt = a.underReviewAt ?? null;
        this.accounts.set(a.id, a);
      }
      for (const s of parsed.sessions ?? []) this.sessions.set(s.id, s);
      for (const c of parsed.codes ?? []) this.codes.set(c.accountId, c);
      // Pre-multi-city audit entries have no cityId — normalize to null.
      this.audits = (parsed.audits ?? []).map((a) => ({ ...a, cityId: a.cityId ?? null }));
      for (const r of parsed.content ?? []) this.content.set(r.id, r);
      for (const e of parsed.events ?? []) this.events.set(e.id, e);
      for (const g of parsed.groups ?? []) this.groups.set(g.id, g);
      this.flags = parsed.flags ?? [];
      for (const s of parsed.submissions ?? []) this.submissions.set(s.id, s);
      for (const a of parsed.activities ?? []) this.activities.set(a.id, a);
      for (const t of parsed.oauthTokens ?? []) this.oauthTokens.set(`${t.accountId}:${t.provider}`, t);
      this.settings = parsed.settings;
      for (const c of parsed.cities ?? []) this.cities.set(c.id, c);
      for (const i of parsed.invitations ?? []) this.invitations.set(i.id, i);
      for (const c of parsed.credentials ?? []) this.credentials.set(c.id, c);
      for (const r of parsed.ratings ?? []) this.ratings.set(r.id, r);
      for (const c of parsed.concerns ?? []) this.concerns.set(c.id, c);
      for (const a of parsed.appeals ?? []) this.appeals.set(a.id, a);
      for (const r of parsed.recognitions ?? []) this.recognitions.set(`${r.accountId}:${r.role}`, r);
      for (const a of parsed.attendance ?? []) this.attendance.set(a.id, a);
      for (const r of parsed.personalRuns ?? []) this.personalRuns.set(r.id, r);
      for (const p of parsed.matchingPreferences ?? []) this.matchingPreferences.set(p.accountId, p);
      for (const j of parsed.joinRequests ?? []) this.joinRequests.set(j.id, { ...j, requesterAccepted: j.requesterAccepted ?? false, recipientAccepted: j.recipientAccepted ?? false });
      for (const b of parsed.blocks ?? []) this.blocks.set(`${b.blockerId}:${b.blockedId}`, b);
      for (const r of parsed.safetyReports ?? []) this.safetyReports.set(r.id, r);
      for (const p of parsed.notificationPreferences ?? []) this.notificationPreferences.set(p.accountId, p);
      for (const n of parsed.notifications ?? []) this.notifications.set(n.id, n);
      for (const [accountId, timestamps] of Object.entries(parsed.safetyReportRate ?? {})) this.safetyReportRate.set(accountId, timestamps.filter((t) => Number.isFinite(t)));
      for (const [accountId, timestamps] of Object.entries(parsed.joinRequestRate ?? {})) {
        this.joinRequestRate.set(accountId, timestamps.filter((t) => Number.isFinite(t)));
      }
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
      groups: [...this.groups.values()],
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
      notificationPreferences: [...this.notificationPreferences.values()],
      notifications: [...this.notifications.values()],
    };
    const file = join(this.dataDir, "db.json");
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
    await rename(tmp, file);
  }

  getNotificationPreferences(accountId: string) { return this.notificationPreferences.get(accountId) ?? { accountId, run_reminders:false, community_updates:false, account_alerts:false, updatedAt:this.now().toISOString() }; }
  setNotificationPreferences(accountId: string, patch: Partial<Pick<import("./types").NotificationPreferenceRecord,"run_reminders"|"community_updates"|"account_alerts">>) { const next={...this.getNotificationPreferences(accountId),...patch,accountId,updatedAt:this.now().toISOString()}; this.notificationPreferences.set(accountId,next); return next; }
  listNotifications(accountId: string) { return [...this.notifications.values()].filter(n=>n.accountId===accountId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
  updateNotification(id: string, accountId: string, patch: {readAt:string|null}) { const n=this.notifications.get(id); if(!n||n.accountId!==accountId)return undefined; n.readAt=patch.readAt; return n; }
  markAllNotificationsRead(accountId:string) { const at=this.now().toISOString(); for(const n of this.notifications.values()) if(n.accountId===accountId)n.readAt=at; }
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
    const rec: AccountRecord = {
      id: newId(),
      name: input.name.trim().slice(0, 60),
      email: input.email.trim().toLowerCase(),
      // Uniqueness/validation live in the API layer (single-threaded store:
      // check-then-write is atomic in-process). The store keeps the value as
      // given — callers are expected to pass the normalized form.
      username: input.username ?? null,
      cityId: input.cityId ?? null,
      status: "pending",
      phase: "email",
      role: "runner",
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
      verifiedAt: null,
      deletedAt: null,
      purgeAt: null,
      purgedAt: null,
      retentionYears: this.retentionYears,
      suspended: false,
      suspendedUntil: null,
      suspensionReason: null,
      underReview: false,
      underReviewAt: null,
    };
    this.accounts.set(rec.id, rec);
    return rec;
  }
  updateAccount(id: string, patch: Partial<AccountRecord>): AccountRecord | undefined {
    const rec = this.accounts.get(id);
    if (!rec) return undefined;
    const next = { ...rec, ...patch };
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

  // ------------------------------------------------------------------- audit
  appendAudit(
    entry: Omit<AuditEntry, "id" | "at" | "cityId"> & { cityId?: string | null },
    now = new Date(),
  ): AuditEntry {
    const rec: AuditEntry = { ...entry, cityId: entry.cityId ?? null, id: newId(), at: nowIso(now) };
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
  listRatings() { return [...this.ratings.values()]; }
  addRating(r: import("./types").RatingRecord) { this.ratings.set(r.id,r); return r; }
  hasRating(reviewerId:string, revieweeId:string, eventId:string) { return [...this.ratings.values()].some(r=>r.reviewerId===reviewerId&&r.revieweeId===revieweeId&&r.eventId===eventId); }
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
  listAttendance(accountId?: string) { return [...this.attendance.values()].filter(a => !accountId || a.accountId === accountId); }
  listAttendanceByEvent(eventId: string) { return [...this.attendance.values()].filter(a => a.eventId === eventId); }
  hasAttendance(accountId: string, eventId: string) { return [...this.attendance.values()].some(a => a.accountId === accountId && a.eventId === eventId); }
  addAttendance(a: import("./types").AttendanceRecord) { this.attendance.set(a.id, a); return a; }
  removeAttendance(id: string) { this.attendance.delete(id); }
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
