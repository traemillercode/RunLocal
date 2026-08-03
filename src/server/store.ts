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
  CodeRecord,
  PersistedDb,
  SessionRecord,
  VerifyPhase,
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
  status: AccountRecord["status"];
  phase: VerifyPhase | null;
  badge: "verified" | null;
  /** Assigned runner role (label only — never a power source). */
  role: AccountRecord["role"];
  /** Server-derived super-admin flag (from RUN_LOCAL_OWNER_EMAIL). */
  isOwner: boolean;
  profilePhotoUrl: string | null;
}

export function toPublicAccount(rec: AccountRecord, isOwner = false): PublicAccount {
  return {
    id: rec.id,
    name: rec.name,
    email: rec.email,
    status: rec.status,
    phase: rec.status === "pending" ? rec.phase : null,
    badge: rec.status === "verified" ? "verified" : null,
    role: rec.role,
    isOwner,
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
      for (const a of parsed.accounts ?? []) this.accounts.set(a.id, a);
      for (const s of parsed.sessions ?? []) this.sessions.set(s.id, s);
      for (const c of parsed.codes ?? []) this.codes.set(c.accountId, c);
      this.audits = parsed.audits ?? [];
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
    };
    const file = join(this.dataDir, "db.json");
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
    await rename(tmp, file);
  }

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
  createAccount(input: {
    name: string;
    email: string;
    phone?: string | null;
    birthdate?: string | null;
    requestedRole?: "runner" | "group_leader" | null;
  }): AccountRecord {
    const rec: AccountRecord = {
      id: newId(),
      name: input.name.trim().slice(0, 60),
      email: input.email.trim().toLowerCase(),
      status: "pending",
      phase: "email",
      role: "runner",
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
  appendAudit(entry: Omit<AuditEntry, "id" | "at">, now = new Date()): AuditEntry {
    const rec: AuditEntry = { ...entry, id: newId(), at: nowIso(now) };
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

  // ---------------------------------------------------------------- uploads
  private uploadDir(kind: "private" | "public"): string {
    return this.dataDir ? join(this.dataDir, "uploads", kind) : "";
  }

  async writePrivateUpload(filename: string, buffer: Buffer): Promise<void> {
    if (!this.dataDir) return;
    const dir = this.uploadDir("private");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), buffer);
  }
  async readPrivateUpload(filename: string): Promise<Buffer | null> {
    if (!this.dataDir) return null;
    try {
      return await readFile(join(this.uploadDir("private"), filename));
    } catch {
      return null;
    }
  }
  async deletePrivateUpload(filename: string): Promise<void> {
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
