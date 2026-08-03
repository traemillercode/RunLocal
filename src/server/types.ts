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

export type AccountStatus = "pending" | "verified" | "rejected";
/** Server-tracked stage of the verification funnel. */
export type VerifyPhase = "phone" | "code" | "selfie" | "pending_review";

export interface AccountRecord {
  id: string;
  name: string;
  email: string;
  status: AccountStatus;
  /** Funnel stage; only meaningful while status === "pending". */
  phase: VerifyPhase;
  /** Filename in uploads/public — the user's chosen public profile photo. */
  profilePhotoRef: string | null;
  /** E.164 phone number — sensitive, server-side only. */
  phone: string | null;
  phoneVerifiedAt: string | null;
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
  /** Phone the code was sent to (for the expiry/verification context). */
  phone: string;
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
  | "account.delete";

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
}

export interface PersistedDb {
  accounts: AccountRecord[];
  sessions: SessionRecord[];
  codes: CodeRecord[];
  audits: AuditEntry[];
}
