/**
 * Retention & deletion policy — "never keep data indefinitely".
 *
 * Rules:
 *  - `computePurgeAt`: an account is eligible for purge `retentionYears` after
 *    its last activity (or its deletion, whichever is later).
 *  - `deleteAccount`: user-initiated deletion scrubs sensitive fields
 *    (phone, selfie, public photo, signup IP, IP history) immediately and
 *    leaves a tombstone so audit references stay resolvable. The tombstone
 *    itself is removed by `purgeEligible` once the retention window passes.
 *  - `purgeEligible`: removes selfie file + phone + photo + IP history and
 *    drops the record entirely once eligible. Audit entries (which contain no
 *    phone/selfie data) are also pruned past the same window.
 *
 * Everything here is a pure function of (record, now) so it can be unit
 * tested and run by: (a) the server on boot + daily interval,
 * (b) `bun run retention:purge`, or (c) the admin panel "Run purge" action.
 */
import type { AccountRecord } from "./types";
import type { Db } from "./store";

export const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000; // 365-day years, documented

export function computePurgeAt(now: Date, lastActivityAt: string, retentionYears: number): string {
  const base = new Date(lastActivityAt).getTime() + retentionYears * MS_PER_YEAR;
  if (base < now.getTime()) return now.toISOString();
  return new Date(base).toISOString();
}

export function isPurgeEligible(rec: AccountRecord, now: Date): boolean {
  const reference = rec.deletedAt ?? rec.lastActivityAt;
  return new Date(reference).getTime() + rec.retentionYears * MS_PER_YEAR <= now.getTime();
}

export interface PurgeResult {
  /** Account ids whose sensitive data was scrubbed / records removed. */
  purged: string[];
  /** Accounts still retained (not yet eligible). */
  retained: string[];
}

/**
 * Scrubs a single account's sensitive fields immediately (account deletion).
 * Keeps a tombstone (id/name/email/timestamps) for audit linkage; the
 * tombstone is removed by `purgeEligible` after the retention window.
 */
export function deleteAccount(rec: AccountRecord, now = new Date()): AccountRecord {
  const tombstone: AccountRecord = {
    ...rec,
    phone: null,
    phoneVerifiedAt: null,
    selfieRef: null,
    selfieCapturedAt: null,
    profilePhotoRef: null,
    supabaseAuthId: null,
    signupIp: null,
    loginIps: [],
    deletedAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
  };
  return tombstone;
}

/**
 * Removes selfie + phone records for all eligible accounts and returns the
 * outcome. Also prunes audit entries older than the retention window.
 * `purged` ids are REMOVED from the store (tombstones included).
 */
export async function purgeEligible(db: Db, now = new Date()): Promise<PurgeResult> {
  const purged: string[] = [];
  const retained: string[] = [];
  for (const rec of db.listAccounts()) {
    if (isPurgeEligible(rec, now)) {
      // Delete sensitive artifacts first (best-effort, before the record goes).
      if (rec.selfieRef) await db.deletePrivateUpload(rec.selfieRef).catch(() => {});
      if (rec.profilePhotoRef) await db.deletePublicUpload(rec.profilePhotoRef).catch(() => {});
      db.removeAccount(rec.id);
      db.deleteSessionsForAccount(rec.id);
      db.deleteCode(rec.id);
      purged.push(rec.id);
    } else {
      retained.push(rec.id);
    }
  }
  const retentionMs = (db.retentionYears * MS_PER_YEAR);
  db.pruneAudits(retentionMs, now);
  await db.persist();
  return { purged, retained };
}

/** Count of currently eligible accounts (numbers only — no PII). */
export function countEligible(db: Db, now = new Date()): number {
  return db.listAccounts().filter((r) => isPurgeEligible(r, now)).length;
}

/** Non-sensitive status summary used by /api/health and admin. */
export function retentionStatus(db: Db, now = new Date()): {
  retentionYears: number;
  eligibleForPurge: number;
  totalAccounts: number;
} {
  return {
    retentionYears: db.retentionYears,
    eligibleForPurge: countEligible(db, now),
    totalAccounts: db.listAccounts().length,
  };
}
