import { describe, expect, it } from "vitest";
import { canManageWaiver, createWaiverVersion, processWaiverExpiry, signWaiver, waiverStatus, WAIVER_TERM_MS } from "../src/server/waivers";
import { createMemoryStore } from "../src/server/store";
import type { AccountRecord, GroupModRecord } from "../src/server/types";

function account(db: ReturnType<typeof createMemoryStore>, id: string, cityId: string): AccountRecord {
  const a = db.createAccount({ name: id, email: `${id}@example.com`, cityId });
  return db.updateAccount(a.id, { status: "verified", role: "group_leader" })!;
}
function group(id: string, cityId: string, ownerId: string): GroupModRecord {
  return { id, cityId, name: id, ownerId, leaderIds: [ownerId], membershipMode: "request", rrcaBadge: false, rrcaNote: null, rrcaNoteUpdatedAt: null };
}

describe("group waivers", () => {
  it("limits Group Leader management to owned groups in the leader's city", () => {
    const db = createMemoryStore();
    const leader = account(db, "leader", "columbia-mo");
    const foreign = group("foreign", "springfield-mo", leader.id);
    expect(canManageWaiver(db, foreign, leader)).toBe(false);
    expect(createWaiverVersion(db, foreign, leader, "terms")).toBeNull();
    const own = group("own", "columbia-mo", leader.id);
    expect(createWaiverVersion(db, own, leader, "terms")?.version).toBe(1);
  });

  it("increments versions, invalidates prior signatures, and gives private status", () => {
    const db = createMemoryStore();
    const leader = account(db, "leader", "columbia-mo");
    const member = account(db, "member", "columbia-mo");
    const other = account(db, "other", "columbia-mo");
    const g = group("run", "columbia-mo", leader.id); db.upsertGroup(g);
    const first = createWaiverVersion(db, g, leader, "first", new Date("2026-01-01T00:00:00Z"))!;
    const signature = signWaiver(db, g.id, member, new Date("2026-01-02T00:00:00Z"))!;
    expect(signature.expiresAt).toBe(new Date(new Date("2026-01-02T00:00:00Z").getTime() + WAIVER_TERM_MS).toISOString());
    expect(waiverStatus(db, g.id, member.id, new Date("2026-01-03T00:00:00Z"))).toMatchObject({ status: "signed", version: 1 });
    const second = createWaiverVersion(db, g, leader, "second", new Date("2026-02-01T00:00:00Z"))!;
    expect(second.version).toBe(2); expect(second.id).not.toBe(first.id);
    expect(waiverStatus(db, g.id, member.id, new Date("2026-02-02T00:00:00Z"))).toMatchObject({ status: "unsigned", version: 2, expiresAt: null });
    expect(waiverStatus(db, g.id, other.id)).toMatchObject({ status: "unsigned", version: 2 });
  });

  it("expires signatures once and remains idempotent", () => {
    const db = createMemoryStore(); const leader = account(db, "leader", "columbia-mo"); const member = account(db, "member", "columbia-mo");
    const g = group("run", "columbia-mo", leader.id); db.upsertGroup(g);
    createWaiverVersion(db, g, leader, "terms", new Date("2026-01-01T00:00:00Z"));
    const signed = signWaiver(db, g.id, member, new Date("2026-01-01T00:00:00Z"))!;
    const atExpiry = new Date(signed.expiresAt);
    expect(processWaiverExpiry(db, atExpiry)).toBe(1); expect(processWaiverExpiry(db, atExpiry)).toBe(0);
    expect(waiverStatus(db, g.id, member.id, atExpiry).status).toBe("expired");
  });
});
