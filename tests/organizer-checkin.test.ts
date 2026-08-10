import { describe, expect, it } from "vitest";
import {
  canManageCheckins, resolveManagedOccurrence, rosterRows, leaderCheckin, leaderUndoCheckin,
  createQrSession, findSessionByToken, validSessionOccurrence, joinViaSession, checkinViaSession,
  sessionMeDto, signViaSession, CHECKIN_QR_TTL_MS,
} from "../src/server/checkins";
import { createMemoryStore } from "../src/server/store";
import type { AccountRecord, GroupModRecord } from "../src/server/types";
import { createWaiverVersion } from "../src/server/waivers";
import { resolveOccurrence } from "../src/server/occurrences";

function account(db: ReturnType<typeof createMemoryStore>, id: string, cityId: string): AccountRecord {
  const a = db.createAccount({ name: id, email: `${id}@example.com`, cityId });
  return db.updateAccount(a.id, { status: "verified", role: "group_leader" })!;
}
function group(id: string, cityId: string, ownerId: string): GroupModRecord {
  return { id, cityId, name: id, ownerId, leaderIds: [ownerId], membershipMode: "request", rrcaBadge: false, rrcaNote: null, rrcaNoteUpdatedAt: null };
}
/** A published group-owned recurring event in the store, resolving to an occurrence on the given date. */
function event(db: ReturnType<typeof createMemoryStore>, groupId: string, cityId: string, id = "run-event") {
  db.setEvent({ id, seedRefId: null, cityId, groupId, title: "Group Run", dayOfWeek: 1, time: "6:00 PM", location: "Memorial Park", distanceLabel: "3 mi", invite: "Open to all", externalUrl: null, provenance: "community", status: "published", hidden: false, createdAt: "", updatedAt: "", createdBy: "t", updatedBy: "t", archivedAt: null });
  return id;
}
function occ(db: ReturnType<typeof createMemoryStore>, eventId: string, runDate = "2026-01-06") {
  const r = resolveOccurrence(db, eventId, runDate);
  if (!r) throw new Error("occurrence must resolve");
  return r;
}
function rsvp(db: ReturnType<typeof createMemoryStore>, runner: AccountRecord, o: ReturnType<typeof occ>, date: string) {
  db.addAttendance({ id: `att-${runner.id}`, accountId: runner.id, eventId: o.eventId, role: "rsvp", createdAt: "2026-01-01T00:00:00.000Z", occurrenceId: o.occurrenceId, runDate: date, startsAt: o.startsAt });
}

describe("organizer check-in", () => {
  it("enforces group ownership + same-city scope for leader access", () => {
    const db = createMemoryStore();
    const leader = account(db, "leader", "columbia-mo");
    const foreignGroup = group("foreign", "springfield-mo", leader.id);
    const own = group("own", "columbia-mo", leader.id);
    expect(canManageCheckins(db, foreignGroup, leader)).toBe(false);
    expect(canManageCheckins(db, own, leader)).toBe(true);
    const stranger = account(db, "stranger", "columbia-mo");
    expect(canManageCheckins(db, own, stranger)).toBe(false);
    const pending = db.updateAccount(leader.id, { status: "pending" })!;
    expect(canManageCheckins(db, own, pending)).toBe(false);
  });

  it("rejects cross-event/cross-group/cross-city occurrence resolution", () => {
    const db = createMemoryStore();
    const leader = account(db, "leader", "columbia-mo");
    const g = group("run", "columbia-mo", leader.id); db.upsertGroup(g);
    const e1 = event(db, g.id, g.cityId, "e1");
    const other = group("other", "columbia-mo", leader.id); db.upsertGroup(other);
    event(db, other.id, other.cityId, "e2");
    const o1 = occ(db, e1);
    // event id of another group
    expect(resolveManagedOccurrence(db, g, "e2", o1.occurrenceId)).toBeNull();
    // mismatched occurrence id (cross-event reuse)
    const o2 = occ(db, "e2");
    expect(resolveManagedOccurrence(db, g, "e1", o2.occurrenceId)).toBeNull();
    // occurrence for a date that isn't a schedule match
    expect(resolveManagedOccurrence(db, g, "e1", `event:${e1}:2026-01-05`)).toBeNull();
    // hidden events are never check-in targets
    const hiddenEvent = db.getEvent(e1)!;
    db.setEvent({ ...hiddenEvent, hidden: true });
    expect(resolveManagedOccurrence(db, g, "e1", o1.occurrenceId)).toBeNull();
  });

  it("roster carries public identity + check-in/waiver facts only, and waivers never block check-in", () => {
    const db = createMemoryStore();
    const leader = account(db, "leader", "columbia-mo");
    const g = group("run", "columbia-mo", leader.id); db.upsertGroup(g);
    const e = event(db, g.id, g.cityId);
    const date = "2026-01-06";
    const o = occ(db, e, date);
    const runner = account(db, "runner", "columbia-mo");
    db.updateAccount(runner.id, { username: "runner1" });
    rsvp(db, runner, o, date);
    createWaiverVersion(db, g, leader, "terms", new Date("2026-01-01T00:00:00Z"));
    const rows = rosterRows(db, o);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.name).toBe("runner"); expect(row.username).toBe("runner1");
    expect(row.checkedIn).toBe(false);
    expect(row.waiver.status).toBe("unsigned"); // warning state, not a gate
    expect(JSON.stringify(row)).not.toContain("example.com"); // no email/phone leakage
    const res = leaderCheckin(db, g, o, leader, runner.id);
    if ("error" in res) throw new Error("waiver must not block check-in");
    expect(res.record.source).toBe("leader");
    expect(leaderCheckin(db, g, o, leader, runner.id)).toEqual({ record: res.record }); // idempotent, no duplicates
    expect(db.listCheckins(o.occurrenceId)).toHaveLength(1);
    expect(leaderUndoCheckin(db, o, runner.id)).toBe(true);
    expect(db.listCheckins(o.occurrenceId)).toHaveLength(0);
    // non-roster verified runners cannot be checked in by a leader
    const outsider = account(db, "outsider", "columbia-mo");
    expect(leaderCheckin(db, g, o, leader, outsider.id)).toEqual({ error: "not_on_roster" });
  });

  it("QR sessions are occurrence-bound, expiring, and reject unknown/expired/replayed tokens", () => {
    const db = createMemoryStore();
    const leader = account(db, "leader", "columbia-mo");
    const g = group("run", "columbia-mo", leader.id); db.upsertGroup(g);
    const e = event(db, g.id, g.cityId);
    const date = "2026-01-06";
    const o = occ(db, e, date);
    const created = createQrSession(db, g, o, leader, new Date("2026-01-06T08:00:00Z"));
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(created.expiresAt).toBe(new Date("2026-01-06T08:00:00Z").getTime() + CHECKIN_QR_TTL_MS ? new Date(new Date("2026-01-06T08:00:00Z").getTime() + CHECKIN_QR_TTL_MS).toISOString() : "");
    // raw token is not stored — only its hash
    expect(db.listQrSessions().every((s) => !s.tokenHash.includes(created.token.slice(0, 8)))).toBe(true);
    // unknown token
    expect(findSessionByToken(db, "definitely-not-a-token")).toBeNull();
    // valid token within TTL
    const found = findSessionByToken(db, created.token, new Date("2026-01-06T09:00:00Z"));
    expect(found?.valid).toBe(true);
    // expired token
    const late = findSessionByToken(db, created.token, new Date(new Date("2026-01-06T08:00:00Z").getTime() + CHECKIN_QR_TTL_MS + 1));
    expect(late?.valid).toBe(false);
    // replay-safe: session still resolves to the SAME occurrence; never a different one
    const otherEvent = event(db, g.id, g.cityId, "other-event");
    const o2 = occ(db, otherEvent, date);
    expect(validSessionOccurrence(db, found!.session)?.occ.occurrenceId).toBe(o.occurrenceId);
    expect(validSessionOccurrence(db, found!.session)?.occ.occurrenceId).not.toBe(o2.occurrenceId);
  });

  it("mobile flow: join → sign current waiver → check in, once per runner per occurrence", () => {
    const db = createMemoryStore();
    const leader = account(db, "leader", "columbia-mo");
    const g = group("run", "columbia-mo", leader.id); db.upsertGroup(g);
    const e = event(db, g.id, g.cityId);
    const date = "2026-01-06";
    const o = occ(db, e, date);
    const runner = account(db, "runner", "columbia-mo");
    createWaiverVersion(db, g, leader, "terms", new Date("2026-01-01T00:00:00Z"));
    const created = createQrSession(db, g, o, leader, new Date("2026-01-06T08:00:00Z"));
    const found = findSessionByToken(db, created.token, new Date("2026-01-06T08:30:00Z"))!;
    expect(joinViaSession(db, found.session, runner)).toEqual({ rsvped: true });
    expect(sessionMeDto(db, found.session, runner.id)!.rsvped).toBe(true);
    // unsigned waiver shows as a warning state and signing is available
    expect(sessionMeDto(db, found.session, runner.id)!.waiver.status).toBe("unsigned");
    const sig = signViaSession(db, found.session, runner, new Date("2026-01-06T08:35:00Z"));
    expect(sig?.waiverVersionId).toBeTruthy();
    expect(sessionMeDto(db, found.session, runner.id)!.waiver.status).toBe("signed");
    // check-in is possible even without signing (waiver never blocks)
    const noWaiver = account(db, "nowaiver", "columbia-mo");
    joinViaSession(db, found.session, noWaiver);
    const ci = checkinViaSession(db, found.session, noWaiver, new Date("2026-01-06T08:40:00Z"));
    expect(ci.duplicate).toBe(false);
    const ci2 = checkinViaSession(db, found.session, noWaiver, new Date("2026-01-06T08:41:00Z"));
    expect(ci2.duplicate).toBe(true);
    expect(db.listCheckins(o.occurrenceId)).toHaveLength(1);
    // a second occurrence of the same event is a SEPARATE check-in target
    const o2 = occ(db, e, "2026-01-13");
    expect(db.listCheckins(o2.occurrenceId)).toHaveLength(0);
  });
});
