/**
 * Organizer check-in: per-event RSVP roster, check-in records, and the
 * new-runner QR session flow.
 *
 * Privacy & authorization model (all enforced server-side):
 *  - Roster and check-in management require the acting account to be a
 *    VERIFIED runner who manages the group (owner / listed leader / city
 *    admin of the group's city / platform owner). Same-city scope is
 *    enforced — a leader of a group in another city can never manage this
 *    group's check-ins, even with the group id.
 *  - The event must belong to the group (event.groupId === group.id) and to
 *    the same city; the occurrence must resolve against the canonical event
 *    schedule; hidden/archived/non-published events are never check-in
 *    targets.
 *  - Roster rows expose only public profile identity (name, username) plus
 *    RSVP / check-in / waiver facts. No email, phone, IP, or home city.
 *  - Check-in records are bound to the server-validated occurrenceId at
 *    write time (leader URL or QR session) — a QR session created for one
 *    occurrence can never produce a check-in for another event or date, and
 *    a runner can be checked in at most once per occurrence (idempotent).
 *  - QR tokens are 192-bit random values; only an HMAC-SHA256 hash is ever
 *    persisted (the raw token is returned exactly once at creation). Sessions
 *    expire (4h) and can be revoked; expired/revoked/unknown tokens are
 *    rejected with a distinct error. The token grants ONLY self-service
 *    actions on the bound occurrence (join/RSVP, sign the group's current
 *    waiver, check yourself in) — it never grants roster reads or any
 *    admin/leader power.
 *
 * Waiver behavior: the roster and the mobile flow SHOW the runner's waiver
 * status (unsigned / expired) as a warning, but a missing waiver never
 * blocks check-in — organizers decide on the ground.
 */
import { randomBytes } from "node:crypto";
import type { Db } from "./store";
import { hashCode, newId } from "./store";
import type { AccountRecord, GroupModRecord, RunEventRecord } from "./types";
import { resolveOccurrence, type EventOccurrence } from "./occurrences";
import { signWaiver, waiverStatus } from "./waivers";
import { canManageGroupOps } from "./roles";

/** How long a new-runner QR session stays valid (4 hours — a run-day window). */
export const CHECKIN_QR_TTL_MS = 4 * 60 * 60 * 1000;
/** Cap on simultaneously active QR sessions per occurrence (bounded storage). */
export const CHECKIN_QR_MAX_SESSIONS = 25;

export type CheckInSource = "leader" | "qr";

export interface EventCheckInRecord {
  id: string;
  /** Canonical event id (event:… form as resolved by occurrences.ts). */
  eventId: string;
  /** `${eventId}:${runDate}` — the concrete occurrence being checked in. */
  occurrenceId: string;
  runDate: string;
  groupId: string;
  cityId: string;
  /** The runner being checked in. */
  accountId: string;
  /** Leader account id that recorded it (or the session creator for QR). */
  checkedInBy: string;
  checkedInAt: string;
  source: CheckInSource;
}

export interface CheckInQrSession {
  id: string;
  /** HMAC-SHA256(token, salt) — the raw token is never stored. */
  tokenHash: string;
  salt: string;
  eventId: string;
  occurrenceId: string;
  runDate: string;
  groupId: string;
  cityId: string;
  /** Leader account id that created the session. */
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

/** Leader permission: verified + owner/city-admin/group-leader, same city. */
export function canManageCheckins(db: Db, group: GroupModRecord | undefined, actor: AccountRecord | undefined): boolean {
  return canManageGroupOps(db, group, actor);
}

/**
 * Validate that the requested occurrence belongs to the group and the city,
 * resolves against the canonical event schedule, and is publicly listed.
 * Returns null (404) for every mismatch — event id, occurrence id, group
 * ownership, city, or visibility.
 */
export function resolveManagedOccurrence(
  db: Db,
  group: GroupModRecord,
  eventId: string,
  occurrenceId: string,
): { occ: EventOccurrence; event: RunEventRecord } | null {
  const sep = occurrenceId.lastIndexOf(":");
  if (sep <= 0) return null;
  const occEventId = occurrenceId.slice(0, sep);
  const rawEvent = eventId.replace(/^event:/, "");
  if (occEventId !== `event:${rawEvent}` && occEventId !== rawEvent) return null;
  const runDate = occurrenceId.slice(sep + 1);
  const occ = resolveOccurrence(db, eventId, runDate);
  if (!occ || !occ.event || occ.occurrenceId !== occurrenceId) return null;
  const event = occ.event;
  if (event.groupId !== group.id || event.cityId !== group.cityId) return null;
  if (event.status !== "published" || event.hidden || event.archivedAt) return null;
  return { occ, event };
}

/** Roster row — RSVPed verified runners joined with their check-in + waiver facts. */
export interface RosterRow {
  accountId: string;
  name: string;
  username: string | null;
  rsvpedAt: string;
  checkedIn: boolean;
  checkedInAt: string | null;
  checkedInBy: string | null;
  waiver: { status: "not_required" | "unsigned" | "signed" | "expired"; version: number | null; expiresAt: string | null };
}

export function rosterRows(db: Db, occ: EventOccurrence, now = new Date()): RosterRow[] {
  const ev = occ.event;
  if (!ev) return [];
  const checkins = db.listCheckins(occ.occurrenceId);
  return db
    .listAttendance()
    .filter((a) => a.role === "rsvp" && a.occurrenceId === occ.occurrenceId && !a.deletedAt)
    .flatMap((a): RosterRow[] => {
      const acct = db.getAccount(a.accountId);
      if (!acct || acct.deletedAt) return [];
      const ci = checkins.find((c) => c.accountId === acct.id);
      const w = waiverStatus(db, ev.groupId, acct.id, now);
      return [{
        accountId: acct.id,
        name: acct.name,
        username: acct.username ?? null,
        rsvpedAt: a.createdAt,
        checkedIn: Boolean(ci),
        checkedInAt: ci?.checkedInAt ?? null,
        checkedInBy: ci?.checkedInBy ?? null,
        waiver: { status: w.status, version: w.version, expiresAt: w.expiresAt },
      }];
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.rsvpedAt.localeCompare(b.rsvpedAt));
}

/** Leader manual check-in: target must be a verified runner ON this occurrence's roster. */
export function leaderCheckin(
  db: Db,
  group: GroupModRecord,
  occ: EventOccurrence,
  leader: AccountRecord,
  targetId: string,
  now = new Date(),
): { record: EventCheckInRecord } | { error: "invalid_target" | "not_on_roster" } {
  const target = db.getAccount(targetId);
  if (!target || target.deletedAt || target.status !== "verified") return { error: "invalid_target" };
  const onRoster = db.listAttendance().some((a) => a.role === "rsvp" && a.occurrenceId === occ.occurrenceId && a.accountId === targetId && !a.deletedAt);
  if (!onRoster) return { error: "not_on_roster" };
  const existing = db.getCheckin(occ.occurrenceId, targetId);
  if (existing) return { record: existing }; // idempotent — no duplicate records
  const record: EventCheckInRecord = {
    id: newId(),
    eventId: occ.eventId,
    occurrenceId: occ.occurrenceId,
    runDate: occ.runDate,
    groupId: group.id,
    cityId: group.cityId,
    accountId: targetId,
    checkedInBy: leader.id,
    checkedInAt: now.toISOString(),
    source: "leader",
  };
  db.addCheckin(record);
  return { record };
}

export function leaderUndoCheckin(db: Db, occ: EventOccurrence, targetId: string): boolean {
  const existing = db.getCheckin(occ.occurrenceId, targetId);
  if (!existing) return false;
  db.removeCheckin(existing.id);
  return true;
}

/** Create a QR session; the raw token is returned exactly once (only its hash is stored). */
export function createQrSession(
  db: Db,
  group: GroupModRecord,
  occ: EventOccurrence,
  leader: AccountRecord,
  now = new Date(),
): { id: string; eventId: string; occurrenceId: string; runDate: string; groupId: string; expiresAt: string; token: string } {
  pruneQrSessions(db, occ.occurrenceId, now);
  const token = randomBytes(24).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  const rec: CheckInQrSession = {
    id: newId(),
    tokenHash: hashCode(token, salt),
    salt,
    eventId: occ.eventId,
    occurrenceId: occ.occurrenceId,
    runDate: occ.runDate,
    groupId: group.id,
    cityId: group.cityId,
    createdBy: leader.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CHECKIN_QR_TTL_MS).toISOString(),
    revokedAt: null,
    revokedBy: null,
  };
  db.addQrSession(rec);
  return { id: rec.id, eventId: rec.eventId, occurrenceId: rec.occurrenceId, runDate: rec.runDate, groupId: rec.groupId, expiresAt: rec.expiresAt, token };
}

/** Revoke expired sessions and, if needed, the oldest active ones over the cap. */
export function pruneQrSessions(db: Db, occurrenceId?: string, now = new Date()): void {
  const sessions = db.listQrSessions(occurrenceId);
  const active = sessions.filter((s) => !s.revokedAt && new Date(s.expiresAt) > now);
  const expired = sessions.filter((s) => !s.revokedAt && new Date(s.expiresAt) <= now);
  for (const s of expired) db.updateQrSession(s.id, { revokedAt: s.expiresAt, revokedBy: "system" });
  if (active.length > CHECKIN_QR_MAX_SESSIONS) {
    const overflow = [...active].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, active.length - CHECKIN_QR_MAX_SESSIONS);
    for (const s of overflow) db.updateQrSession(s.id, { revokedAt: now.toISOString(), revokedBy: "system" });
  }
}

/** Look up a session by raw token; `valid` distinguishes unknown vs expired/revoked. */
export function findSessionByToken(db: Db, token: string, now = new Date()): { session: CheckInQrSession; valid: boolean } | null {
  for (const s of db.listQrSessions()) {
    if (s.tokenHash === hashCode(token, s.salt)) {
      const valid = !s.revokedAt && new Date(s.expiresAt) > now;
      return { session: s, valid };
    }
  }
  return null;
}

/** Re-validate the bound occurrence at use time (event still published & group-owned). */
export function validSessionOccurrence(db: Db, session: CheckInQrSession): { occ: EventOccurrence; event: RunEventRecord } | null {
  const occ = resolveOccurrence(db, session.eventId, session.runDate);
  if (!occ || !occ.event || occ.occurrenceId !== session.occurrenceId) return null;
  const event = occ.event;
  if (event.groupId !== session.groupId || event.cityId !== session.cityId) return null;
  if (event.status !== "published" || event.hidden || event.archivedAt) return null;
  return { occ, event };
}

/** QR self-service join: RSVP for the session's occurrence (idempotent). */
export function joinViaSession(db: Db, session: CheckInQrSession, runner: AccountRecord, now = new Date()): { rsvped: boolean } {
  const mine = db.listAttendance().filter((a) => a.role === "rsvp" && a.occurrenceId === session.occurrenceId && a.accountId === runner.id && !a.deletedAt);
  if (!mine.length) {
    db.addAttendance({ id: newId(), accountId: runner.id, eventId: session.eventId, role: "rsvp", createdAt: now.toISOString(), occurrenceId: session.occurrenceId, runDate: session.runDate, startsAt: new Date(session.runDate + "T00:00:00.000Z").toISOString() });
  }
  return { rsvped: true };
}

/** QR self-service check-in: one record per runner per occurrence; bound to the session's occurrence only. */
export function checkinViaSession(db: Db, session: CheckInQrSession, runner: AccountRecord, now = new Date()): { record: EventCheckInRecord; duplicate: boolean } {
  const existing = db.getCheckin(session.occurrenceId, runner.id);
  if (existing) return { record: existing, duplicate: true };
  const record: EventCheckInRecord = {
    id: newId(),
    eventId: session.eventId,
    occurrenceId: session.occurrenceId,
    runDate: session.runDate,
    groupId: session.groupId,
    cityId: session.cityId,
    accountId: runner.id,
    checkedInBy: session.createdBy,
    checkedInAt: now.toISOString(),
    source: "qr",
  };
  db.addCheckin(record);
  return { record, duplicate: false };
}

/** Public session peek (guest-safe) — event facts only. */
export function sessionPublicDto(db: Db, session: CheckInQrSession, occ: EventOccurrence, event: RunEventRecord) {
  const group = db.getGroup(session.groupId);
  return {
    session: {
      eventId: session.eventId,
      occurrenceId: session.occurrenceId,
      runDate: session.runDate,
      groupId: session.groupId,
      cityId: session.cityId,
      expiresAt: session.expiresAt,
      event: {
        title: event.title,
        time: event.time,
        location: event.location,
        distanceLabel: event.distanceLabel,
        startsAt: occ.startsAt,
        groupName: group?.name ?? "Group",
      },
    },
  };
}

/** The caller's own state for a session (verified runners only; guests get null). */
export function sessionMeDto(db: Db, session: CheckInQrSession, accountId: string | undefined, now = new Date()) {
  const acct = accountId ? db.getAccount(accountId) : undefined;
  if (!acct || acct.deletedAt || acct.status !== "verified") return null;
  const ci = db.getCheckin(session.occurrenceId, acct.id);
  return {
    rsvped: db.listAttendance().some((a) => a.role === "rsvp" && a.occurrenceId === session.occurrenceId && a.accountId === acct.id && !a.deletedAt),
    checkedIn: Boolean(ci),
    checkedInAt: ci?.checkedInAt ?? null,
    waiver: waiverStatus(db, session.groupId, acct.id, now),
  };
}

/** Convenience: sign the group's current waiver through a QR session (idempotent). */
export function signViaSession(db: Db, session: CheckInQrSession, runner: AccountRecord, now = new Date()) {
  return signWaiver(db, session.groupId, runner, now);
}
