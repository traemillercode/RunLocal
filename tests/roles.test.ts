/**
 * Role & ownership boundary tests — the Task 6 permission matrix.
 *
 * Covers: Global Admin (owner email / key session), City Admin (one-city
 * scope), Group Lead (owner + leader), and plain runners; city boundaries at
 * every level; and the leader/owner separation on group leadership acts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore, type Db } from "../src/server/store";
import type { AccountRecord, GroupModRecord } from "../src/server/types";
import { DEFAULT_OWNER_EMAIL } from "../src/server/owner";
import {
  canManageGroupLeadership,
  canManageGroupOps,
  groupRoleFor,
  groupsLedBy,
  isCityAdminForGroup,
  isEligibleLeader,
  isGlobalAdmin,
  isGroupLead,
  leaderAccounts,
  type GroupRole,
} from "../src/server/roles";

let db: Db;
function account(email: string, patch: Partial<AccountRecord> = {}): AccountRecord {
  const a = db.createAccount({ name: email, email, cityId: "columbia-mo" });
  return db.updateAccount(a.id, { status: "verified", ...patch })!;
}
function group(id: string, cityId = "columbia-mo", ownerId?: string, leaderIds: string[] = []): GroupModRecord {
  const rec: GroupModRecord = { id, cityId, name: id, ownerId, leaderIds, membershipMode: "request", rrcaBadge: false, rrcaNote: null, rrcaNoteUpdatedAt: null };
  db.upsertGroup(rec);
  return rec;
}
beforeEach(() => {
  db = createMemoryStore();
});

describe("groupRoleFor — who holds a role on a group", () => {
  it("owner, leader, member, and none resolve correctly for verified same-city accounts", () => {
    const owner = account("owner@example.com");
    const leader = account("leader@example.com");
    const member = account("member@example.com");
    const stranger = account("stranger@example.com");
    const g = group("g1", "columbia-mo", owner.id, [leader.id]);
    db.addMembership({ id: "m1", groupId: g.id, accountId: member.id, cityId: g.cityId, status: "active", requestedAt: "", updatedAt: "", decidedAt: null, decidedBy: null });
    expect(groupRoleFor(db, g, owner)).toBe<GroupRole>("owner");
    expect(groupRoleFor(db, g, leader)).toBe<GroupRole>("leader");
    expect(groupRoleFor(db, g, member)).toBe<GroupRole>("member");
    expect(groupRoleFor(db, g, stranger)).toBe<GroupRole>("none");
  });
  it("city boundaries: an account from another city holds NO role even when listed as a leader", () => {
    const owner = account("owner@example.com");
    const crossCity = account("cross@example.com", { cityId: "stl-mo" });
    const g = group("g1", "columbia-mo", owner.id, [crossCity.id]);
    expect(groupRoleFor(db, g, crossCity)).toBe("none");
    expect(isGroupLead(db, g, crossCity)).toBe(false);
  });
  it("unverified/deleted accounts hold no role", () => {
    const owner = account("owner@example.com");
    const pending = account("pending@example.com", { status: "pending" });
    const deleted = account("gone@example.com", { deletedAt: "2026-01-01T00:00:00.000Z" });
    const g = group("g1", "columbia-mo", owner.id);
    expect(groupRoleFor(db, g, pending)).toBe("none");
    expect(groupRoleFor(db, g, deleted)).toBe("none");
    expect(groupRoleFor(db, g, null)).toBe("none");
    expect(groupRoleFor(db, undefined, owner)).toBe("none");
  });
});

describe("admin overrides — Global Admin and City Admin", () => {
  it("isGlobalAdmin is the owner email only (server-derived)", () => {
    const owner = account(DEFAULT_OWNER_EMAIL);
    const other = account("other@example.com");
    expect(isGlobalAdmin(owner)).toBe(true);
    expect(isGlobalAdmin(other)).toBe(false);
    expect(isGlobalAdmin(null)).toBe(false);
  });
  it("isCityAdminForGroup requires the city_admin role with the exact city scope", () => {
    const ca = account("ca@example.com", { role: "city_admin", adminCityId: "columbia-mo" });
    const caOtherCity = account("ca2@example.com", { role: "city_admin", adminCityId: "stl-mo" });
    const g = group("g1");
    expect(isCityAdminForGroup(ca, g)).toBe(true);
    expect(isCityAdminForGroup(caOtherCity, g)).toBe(false);
  });
  it("canManageGroupOps lets the owner, listed leaders, the scoped city admin, and the global admin act", () => {
    const owner = account("owner@example.com");
    const leader = account("leader@example.com");
    const member = account("member@example.com");
    const ca = account("ca@example.com", { role: "city_admin", adminCityId: "columbia-mo" });
    const global = account(DEFAULT_OWNER_EMAIL);
    const stranger = account("stranger@example.com");
    const g = group("g1", "columbia-mo", owner.id, [leader.id]);
    expect(canManageGroupOps(db, g, owner)).toBe(true);
    expect(canManageGroupOps(db, g, leader)).toBe(true);
    expect(canManageGroupOps(db, g, member)).toBe(false);
    expect(canManageGroupOps(db, g, ca)).toBe(true);
    expect(canManageGroupOps(db, g, global)).toBe(true);
    expect(canManageGroupOps(db, g, stranger)).toBe(false);
  });
  it("canManageGroupLeadership is owner/admin-only — plain leaders cannot assign or transfer", () => {
    const owner = account("owner@example.com");
    const leader = account("leader@example.com");
    const ca = account("ca@example.com", { role: "city_admin", adminCityId: "columbia-mo" });
    const global = account(DEFAULT_OWNER_EMAIL);
    const g = group("g1", "columbia-mo", owner.id, [leader.id]);
    expect(canManageGroupLeadership(db, g, owner)).toBe(true);
    expect(canManageGroupLeadership(db, g, leader)).toBe(false);
    expect(canManageGroupLeadership(db, g, ca)).toBe(true);
    expect(canManageGroupLeadership(db, g, global)).toBe(true);
  });
  it("seeded groups (no owner) are admin-managed; no leader can seize them", () => {
    const leader = account("leader@example.com");
    const ca = account("ca@example.com", { role: "city_admin", adminCityId: "columbia-mo" });
    const seeded = group("runcomo"); // no ownerId, no leaderIds
    expect(canManageGroupLeadership(db, seeded, leader)).toBe(false);
    expect(canManageGroupLeadership(db, seeded, ca)).toBe(true);
    expect(canManageGroupOps(db, seeded, ca)).toBe(true);
  });
});

describe("leader eligibility + leadership queries", () => {
  it("isEligibleLeader requires verified + same city; admins do not bypass city rules", () => {
    const ok = account("ok@example.com");
    const pending = account("p@example.com", { status: "pending" });
    const cross = account("x@example.com", { cityId: "stl-mo" });
    const ca = account("ca@example.com", { role: "city_admin", adminCityId: "columbia-mo" });
    const g = group("g1");
    expect(isEligibleLeader(ok, g)).toBe(true);
    expect(isEligibleLeader(pending, g)).toBe(false);
    expect(isEligibleLeader(cross, g)).toBe(false);
    expect(isEligibleLeader(ca, g)).toBe(true);
    expect(isEligibleLeader(null, g)).toBe(false);
  });
  it("groupsLedBy returns only same-city groups the account owns or leads", () => {
    const owner = account("owner@example.com");
    const leader = account("leader@example.com");
    group("own", "columbia-mo", owner.id);
    group("lead", "columbia-mo", undefined, [leader.id]);
    group("cross", "stl-mo", undefined, [leader.id]); // different city — excluded
    group("other", "columbia-mo"); // not led — excluded
    expect(groupsLedBy(db, owner).map((g) => g.id)).toEqual(["own"]);
    expect(groupsLedBy(db, leader).map((g) => g.id)).toEqual(["lead"]);
    expect(groupsLedBy(db, null)).toEqual([]);
  });
  it("leaderAccounts dedupes owner + leaders and skips deleted accounts", () => {
    const owner = account("owner@example.com");
    const leader = account("leader@example.com");
    const gone = account("gone@example.com", { deletedAt: "2026-01-01T00:00:00.000Z" });
    const g = group("g1", "columbia-mo", owner.id, [leader.id, owner.id, gone.id]);
    const ids = leaderAccounts(db, g).map((a) => a.id).sort();
    expect(ids).toEqual([leader.id, owner.id].sort());
  });
});
