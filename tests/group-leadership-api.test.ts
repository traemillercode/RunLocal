/**
 * Group leadership API tests — leader assignment/removal, ownership transfer,
 * own-group profile edits, city boundaries, the leader operational queue, and
 * the membership-request notification semantics. All server-side via
 * apiHandler; no UI dependency.
 */
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { DEFAULT_OWNER_EMAIL } from "../src/server/owner";
import type { AccountRecord, GroupModRecord } from "../src/server/types";

function req(method: string, path: string, cookie?: string, body?: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  let sent = false;
  return { method, url: path, headers: { "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}), ...(raw ? { "content-type": "application/json" } : {}) }, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]() { return { next: async () => sent ? { done: true as const, value: undefined } : (sent = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
function response() {
  const out = { status: 0, body: "" };
  const res = { writeHead(status: number) { out.status = status; return res; }, setHeader() { return res; }, end(value?: unknown) { if (value !== undefined) out.body += String(value); return res; } } as unknown as ServerResponse;
  return { res, out };
}
async function call(db: Db, method: string, path: string, cookie?: string, body?: unknown) {
  const { res, out } = response();
  await apiHandler(req(method, path, cookie, body), res, db);
  return { status: out.status, body: out.body ? (JSON.parse(out.body) as Record<string, any>) : {} };
}
function account(db: Db, email: string, cityId = "columbia-mo", patch: Partial<AccountRecord> = {}): { id: string; cookie: string; email: string } {
  const a = db.createAccount({ name: email, email, cityId });
  db.updateAccount(a.id, { status: "verified", ...patch });
  const s = db.createSession(a.id, "127.0.0.1");
  return { id: a.id, cookie: `runlocal_sid=${s.id}`, email: a.email };
}
function group(db: Db, id: string, ownerId?: string, leaderIds: string[] = [], membershipMode: "open" | "request" = "request", cityId = "columbia-mo"): GroupModRecord {
  const rec: GroupModRecord = { id, cityId, name: id, ownerId, leaderIds, membershipMode, rrcaBadge: false, rrcaNote: null, rrcaNoteUpdatedAt: null };
  db.upsertGroup(rec);
  return rec;
}
const REASON = "Leadership change with a proper reason";
const auditActions = (db: Db, action: string) => db.listAudit(100).filter((a) => a.action === action);

describe("leader assignment", () => {
  it("the group owner assigns a verified same-city leader, audited with the group city", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const target = account(db, "target@example.com");
    group(db, "g1", owner.id);
    const r = await call(db, "POST", "/api/groups/g1/leaders", owner.cookie, { email: target.email, reason: REASON });
    expect(r.status).toBe(200);
    expect(db.getGroup("g1")!.leaderIds).toContain(target.id);
    expect(r.body.leaders.some((l: { id: string }) => l.id === target.id)).toBe(true);
    const audit = auditActions(db, "group.leader_assign");
    expect(audit).toHaveLength(1);
    expect(audit[0].admin).toBe(owner.email);
    expect(audit[0].cityId).toBe("columbia-mo");
    expect(audit[0].change).toContain(target.email);
  });
  it("a plain leader cannot assign other leaders (owner-only ownership act)", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const leader = account(db, "leader@example.com");
    const target = account(db, "target@example.com");
    group(db, "g1", owner.id, [leader.id]);
    const r = await call(db, "POST", "/api/groups/g1/leaders", leader.cookie, { email: target.email, reason: REASON });
    expect(r.status).toBe(403);
    expect(db.getGroup("g1")!.leaderIds).not.toContain(target.id);
    expect(auditActions(db, "group.leader_assign")).toHaveLength(0);
  });
  it("cross-city targets, unverified targets, missing reasons, and unknown emails are rejected", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const cross = account(db, "cross@example.com", "stl-mo");
    const pending = account(db, "pending@example.com", "columbia-mo", { status: "pending" });
    group(db, "g1", owner.id);
    expect((await call(db, "POST", "/api/groups/g1/leaders", owner.cookie, { email: cross.email, reason: REASON })).status).toBe(400);
    expect((await call(db, "POST", "/api/groups/g1/leaders", owner.cookie, { email: pending.email, reason: REASON })).status).toBe(400);
    expect((await call(db, "POST", "/api/groups/g1/leaders", owner.cookie, { email: "nobody@example.com", reason: REASON })).status).toBe(404);
    expect((await call(db, "POST", "/api/groups/g1/leaders", owner.cookie, { email: cross.email })).status).toBe(400); // reason required
    expect(db.getGroup("g1")!.leaderIds ?? []).toHaveLength(0);
  });
  it("the scoped City Admin and the Global Admin can assign leaders", async () => {
    const db = createMemoryStore();
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const global = account(db, DEFAULT_OWNER_EMAIL);
    const target = account(db, "target@example.com");
    group(db, "g1"); // seeded group: no owner
    expect((await call(db, "POST", "/api/groups/g1/leaders", ca.cookie, { email: target.email, reason: REASON })).status).toBe(200);
    expect(db.getGroup("g1")!.leaderIds).toContain(target.id);
    expect((await call(db, "POST", "/api/groups/g1/leaders", global.cookie, { email: target.email, reason: REASON })).status).toBe(200);
  });
  it("a City Admin of ANOTHER city is denied", async () => {
    const db = createMemoryStore();
    const ca = account(db, "ca@example.com", "stl-mo", { role: "city_admin", adminCityId: "stl-mo" });
    const target = account(db, "target@example.com");
    group(db, "g1");
    const r = await call(db, "POST", "/api/groups/g1/leaders", ca.cookie, { email: target.email, reason: REASON });
    expect(r.status).toBe(403);
  });
});

describe("leader removal", () => {
  it("the owner removes a leader (audited); the owner cannot be removed from ownership via this route", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const leader = account(db, "leader@example.com");
    group(db, "g1", owner.id, [leader.id]);
    const r = await call(db, "DELETE", `/api/groups/g1/leaders/${leader.id}`, owner.cookie, { reason: REASON });
    expect(r.status).toBe(200);
    expect(db.getGroup("g1")!.leaderIds).not.toContain(leader.id);
    expect(db.getGroup("g1")!.ownerId).toBe(owner.id);
    expect(auditActions(db, "group.leader_remove")).toHaveLength(1);
    // removing a non-leader is rejected
    expect((await call(db, "DELETE", `/api/groups/g1/leaders/${owner.id}`, owner.cookie, { reason: REASON })).status).toBe(400);
  });
});

describe("ownership transfer", () => {
  it("the owner transfers to a current leader; the previous owner remains a leader", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const leader = account(db, "leader@example.com");
    group(db, "g1", owner.id, [leader.id]);
    const r = await call(db, "POST", "/api/groups/g1/ownership", owner.cookie, { accountId: leader.id, reason: REASON });
    expect(r.status).toBe(200);
    const g = db.getGroup("g1")!;
    expect(g.ownerId).toBe(leader.id);
    expect(g.leaderIds).toContain(owner.id); // previous owner stays a leader
    const audit = auditActions(db, "group.ownership_transfer");
    expect(audit).toHaveLength(1);
    expect(audit[0].change).toContain("->");
  });
  it("an owner cannot transfer to a non-leader; a plain leader cannot transfer at all", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const stranger = account(db, "stranger@example.com");
    const leader = account(db, "leader@example.com");
    group(db, "g1", owner.id, [leader.id]);
    expect((await call(db, "POST", "/api/groups/g1/ownership", owner.cookie, { accountId: stranger.id, reason: REASON })).status).toBe(400);
    expect((await call(db, "POST", "/api/groups/g1/ownership", leader.cookie, { accountId: stranger.id, reason: REASON })).status).toBe(403);
    expect(db.getGroup("g1")!.ownerId).toBe(owner.id);
  });
  it("the Global Admin can designate an owner for a seeded group (no ownerId)", async () => {
    const db = createMemoryStore();
    const global = account(db, DEFAULT_OWNER_EMAIL);
    const runner = account(db, "runner@example.com");
    group(db, "runcomo");
    const r = await call(db, "POST", "/api/groups/runcomo/ownership", global.cookie, { accountId: runner.id, reason: REASON });
    expect(r.status).toBe(200);
    expect(db.getGroup("runcomo")!.ownerId).toBe(runner.id);
    expect(db.getGroup("runcomo")!.leaderIds).toContain(runner.id);
  });
  it("cross-city transfer targets are rejected even for admins", async () => {
    const db = createMemoryStore();
    const global = account(db, DEFAULT_OWNER_EMAIL);
    const cross = account(db, "cross@example.com", "stl-mo");
    group(db, "g1");
    const r = await call(db, "POST", "/api/groups/g1/ownership", global.cookie, { accountId: cross.id, reason: REASON });
    expect(r.status).toBe(400);
    expect(db.getGroup("g1")!.ownerId).toBeUndefined();
  });
});

describe("Group Lead own-group limits — profile edits", () => {
  it("a leader edits their own group's public profile; the edit is audited", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const leader = account(db, "leader@example.com");
    group(db, "g1", owner.id, [leader.id]);
    const r = await call(db, "PATCH", "/api/groups/g1/profile", leader.cookie, { description: "New blurb", membershipMode: "open", reason: REASON });
    expect(r.status).toBe(200);
    const g = db.getGroup("g1")!;
    expect(g.description).toBe("New blurb");
    expect(g.membershipMode).toBe("open");
    const audit = auditActions(db, "group.profile_edit");
    expect(audit).toHaveLength(1);
    expect(audit[0].admin).toBe(leader.email);
    expect(audit[0].cityId).toBe("columbia-mo");
  });
  it("a leader of group A CANNOT edit group B (own-group limit)", async () => {
    const db = createMemoryStore();
    const ownerA = account(db, "owner-a@example.com");
    const ownerB = account(db, "owner-b@example.com");
    const leaderA = account(db, "leader-a@example.com");
    group(db, "gA", ownerA.id, [leaderA.id]);
    group(db, "gB", ownerB.id);
    const r = await call(db, "PATCH", "/api/groups/gB/profile", leaderA.cookie, { description: "hacked", reason: REASON });
    expect(r.status).toBe(403);
    expect(db.getGroup("gB")!.description).toBeUndefined();
  });
  it("plain members, cross-city leaders, and guests cannot edit profiles", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const member = account(db, "member@example.com");
    const cross = account(db, "cross@example.com", "stl-mo");
    group(db, "g1", owner.id);
    db.addMembership({ id: "m1", groupId: "g1", accountId: member.id, cityId: "columbia-mo", status: "active", requestedAt: "", updatedAt: "", decidedAt: null, decidedBy: null });
    expect((await call(db, "PATCH", "/api/groups/g1/profile", member.cookie, { description: "x", reason: REASON })).status).toBe(403);
    expect((await call(db, "PATCH", "/api/groups/g1/profile", cross.cookie, { description: "x", reason: REASON })).status).toBe(403);
    expect((await call(db, "PATCH", "/api/groups/g1/profile", undefined, { description: "x", reason: REASON })).status).toBe(401);
    // name is NOT editable through this surface
    const nameEdit = await call(db, "PATCH", "/api/groups/g1/profile", owner.cookie, { name: "Renamed", reason: REASON });
    expect(nameEdit.status).toBe(200);
    expect(db.getGroup("g1")!.name).toBe("g1");
  });
  it("invalid URLs and missing reasons are rejected", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    group(db, "g1", owner.id);
    expect((await call(db, "PATCH", "/api/groups/g1/profile", owner.cookie, { websiteUrl: "javascript:alert(1)", reason: REASON })).status).toBe(400);
    expect((await call(db, "PATCH", "/api/groups/g1/profile", owner.cookie, { description: "ok" })).status).toBe(400); // reason required
  });
});

describe("leader operational queue", () => {
  it("leaders see pending requests for THEIR groups only, with public identity only", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const leader = account(db, "leader@example.com");
    const requester = account(db, "requester@example.com");
    db.updateAccount(requester.id, { name: "Requester Person" });
    const otherOwner = account(db, "other-owner@example.com");
    group(db, "mine", owner.id, [leader.id]);
    group(db, "theirs", otherOwner.id);
    const req1 = await call(db, "POST", "/api/groups/mine/membership", requester.cookie);
    expect(req1.status).toBe(200);
    await call(db, "POST", "/api/groups/theirs/membership", requester.cookie);
    const queue = await call(db, "GET", "/api/me/leader/queue", leader.cookie);
    expect(queue.status).toBe(200);
    expect(queue.body.pending).toHaveLength(1);
    expect(queue.body.pending[0].name).toBe("Requester Person");
    // no email/phone/home-city in the queue payload
    const json = JSON.stringify(queue.body);
    expect(json).not.toContain(requester.email);
    expect(json).not.toContain("phone");
    expect(queue.body.pending[0].accountId).toBe(requester.id);
    // led-groups list exposes role + pending count + canManageLeaders flag
    const led = await call(db, "GET", "/api/me/leader/groups", leader.cookie);
    expect(led.body.groups).toHaveLength(1);
    expect(led.body.groups[0]).toMatchObject({ groupId: "mine", role: "leader", pendingCount: 1, canManageLeaders: false });
    const ledOwner = await call(db, "GET", "/api/me/leader/groups", owner.cookie);
    expect(ledOwner.body.groups[0]).toMatchObject({ role: "owner", canManageLeaders: true });
    // a non-leader sees an empty queue
    const outsider = account(db, "outsider@example.com");
    expect((await call(db, "GET", "/api/me/leader/queue", outsider.cookie)).body.pending).toHaveLength(0);
  });
  it("approving a request removes it from the queue", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const requester = account(db, "requester@example.com");
    group(db, "mine", owner.id);
    await call(db, "POST", "/api/groups/mine/membership", requester.cookie);
    const queue = await call(db, "GET", "/api/me/leader/queue", owner.cookie);
    const membershipId = queue.body.pending[0].membershipId;
    const approve = await call(db, "POST", "/api/groups/mine/membership/approve", owner.cookie, { accountId: requester.id });
    expect(approve.status).toBe(200);
    expect((await call(db, "GET", "/api/me/leader/queue", owner.cookie)).body.pending).toHaveLength(0);
    expect(db.getMembershipById(membershipId)!.status).toBe("active");
  });
  it("a City Admin of the group's city can also approve membership requests", async () => {
    const db = createMemoryStore();
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const requester = account(db, "requester@example.com");
    group(db, "mine"); // seeded — no owner/leaders
    await call(db, "POST", "/api/groups/mine/membership", requester.cookie);
    const r = await call(db, "POST", "/api/groups/mine/membership/approve", ca.cookie, { accountId: requester.id });
    expect(r.status).toBe(200);
    const otherCa = account(db, "other-ca@example.com", "stl-mo", { role: "city_admin", adminCityId: "stl-mo" });
    expect((await call(db, "POST", "/api/groups/mine/membership/approve", otherCa.cookie, { accountId: requester.id })).status).toBe(403);
  });
});

describe("membership-request notification semantics", () => {
  it("leaders receive a pref-gated community_updates notification; the requester never does", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const quietLeader = account(db, "quiet@example.com"); // community_updates OFF (default)
    const requester = account(db, "requester@example.com");
    group(db, "mine", owner.id, [quietLeader.id]);
    db.setNotificationPreferences(owner.id, { run_reminders: false, community_updates: true, account_alerts: false });
    await call(db, "POST", "/api/groups/mine/membership", requester.cookie);
    const ownerInbox = db.listNotifications(owner.id);
    expect(ownerInbox).toHaveLength(1);
    expect(ownerInbox[0].category).toBe("community_updates");
    expect(ownerInbox[0].title).toBe("New membership request");
    expect(ownerInbox[0].body).toContain("mine");
    // preference OFF → no notification
    expect(db.listNotifications(quietLeader.id)).toHaveLength(0);
    // the requester never gets their own request notification
    expect(db.listNotifications(requester.id)).toHaveLength(0);
    // approval is not a notification event (narrowest scope)
    await call(db, "POST", "/api/groups/mine/membership/approve", owner.cookie, { accountId: requester.id });
    expect(db.listNotifications(owner.id)).toHaveLength(1);
  });
  it("open-membership groups (auto-active) send no leader notification", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const joiner = account(db, "joiner@example.com");
    group(db, "open-g", owner.id, [], "open");
    db.setNotificationPreferences(owner.id, { run_reminders: false, community_updates: true, account_alerts: false });
    await call(db, "POST", "/api/groups/open-g/membership", joiner.cookie);
    expect(db.listNotifications(owner.id)).toHaveLength(0);
  });
});

describe("manage surface — led-groups rows carry server profile truth", () => {
  it("rows include the group's description and membership mode so the manage form initializes from the row", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    group(db, "g1", owner.id);
    db.updateGroup("g1", { description: "Weekly social runs", membershipMode: "open" });
    const led = await call(db, "GET", "/api/me/leader/groups", owner.cookie);
    expect(led.status).toBe(200);
    expect(led.body.groups[0]).toMatchObject({ groupId: "g1", description: "Weekly social runs", membershipMode: "open" });
  });
  it("seeded/legacy groups without a stored mode surface the effective request default", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    group(db, "legacy", owner.id); // no membershipMode / description stored
    const led = await call(db, "GET", "/api/me/leader/groups", owner.cookie);
    expect(led.body.groups[0]).toMatchObject({ membershipMode: "request", description: "" });
  });
});

describe("admin manage reach — authorized admins can reach eligible groups in the UI", () => {
  it("the Global Admin sees every non-archived group across cities as global_admin", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL, "columbia-mo"); // owner email => Global Admin
    group(db, "columbia-g", undefined, [], "request", "columbia-mo");
    group(db, "stl-g", undefined, [], "open", "stl-mo");
    group(db, "kc-g", undefined, [], "request", "kc-mo");
    db.updateGroup("stl-g", { archived: true, archivedAt: new Date().toISOString() });
    const led = await call(db, "GET", "/api/me/leader/groups", owner.cookie);
    expect(led.status).toBe(200);
    const ids = led.body.groups.map((g: { groupId: string }) => g.groupId);
    expect(ids).toContain("columbia-g");
    expect(ids).toContain("kc-g");
    expect(ids).not.toContain("stl-g"); // archived stays out
    expect(led.body.groups.every((g: { role: string }) => g.role === "global_admin")).toBe(true);
    expect(led.body.groups.every((g: { canManageLeaders: boolean }) => g.canManageLeaders)).toBe(true);
  });
  it("a City Admin sees every group in their scoped city — led or not — and never another city's groups", async () => {
    const db = createMemoryStore();
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const otherOwner = account(db, "other@example.com");
    group(db, "mine", otherOwner.id);
    group(db, "not-led", undefined, [], "open"); // ca is not a leader of this one
    group(db, "stl-g", undefined, [], "request", "stl-mo");
    const led = await call(db, "GET", "/api/me/leader/groups", ca.cookie);
    expect(led.status).toBe(200);
    const ids = led.body.groups.map((g: { groupId: string }) => g.groupId);
    expect(ids).toEqual(expect.arrayContaining(["mine", "not-led"]));
    expect(ids).not.toContain("stl-g");
    expect(led.body.groups.every((g: { role: string }) => g.role === "city_admin")).toBe(true);
    expect(led.body.groups.every((g: { canManageLeaders: boolean }) => g.canManageLeaders)).toBe(true);
  });
  it("a plain verified runner sees only groups they lead — no admin reach", async () => {
    const db = createMemoryStore();
    const runner = account(db, "runner@example.com");
    const otherOwner = account(db, "other@example.com");
    group(db, "theirs", otherOwner.id);
    group(db, "theirs-2", undefined, [], "open", "stl-mo");
    const led = await call(db, "GET", "/api/me/leader/groups", runner.cookie);
    expect(led.body.groups).toHaveLength(0);
    expect((await call(db, "GET", "/api/me/leader/queue", runner.cookie)).body.pending).toHaveLength(0);
  });
});

describe("admin manage reach — leader queue", () => {
  it("a City Admin sees pending requests for every group in their city (led or not); a cross-city admin sees only their own city", async () => {
    const db = createMemoryStore();
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const otherCa = account(db, "stl-ca@example.com", "stl-mo", { role: "city_admin", adminCityId: "stl-mo" });
    const requester = account(db, "requester@example.com"); // columbia-mo
    const stlRequester = account(db, "stl-requester@example.com", "stl-mo");
    db.updateAccount(requester.id, { name: "Columbia Person" });
    db.updateAccount(stlRequester.id, { name: "Stl Person" });
    group(db, "mine"); // seeded — no owner/leaders
    group(db, "stl-g", undefined, [], "request", "stl-mo");
    await call(db, "POST", "/api/groups/mine/membership", requester.cookie);
    await call(db, "POST", "/api/groups/stl-g/membership", stlRequester.cookie);
    const queue = await call(db, "GET", "/api/me/leader/queue", ca.cookie);
    expect(queue.body.pending).toHaveLength(1);
    expect(queue.body.pending[0].groupId).toBe("mine");
    const otherQueue = await call(db, "GET", "/api/me/leader/queue", otherCa.cookie);
    expect(otherQueue.body.pending.map((p: { groupId: string }) => p.groupId)).toEqual(["stl-g"]);
    // public identity only — never the requester's email or phone
    const json = JSON.stringify(queue.body);
    expect(json).not.toContain(requester.email);
    expect(json).not.toContain("phone");
  });
  it("the Global Admin sees pending requests across cities", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL, "columbia-mo");
    const requester = account(db, "requester@example.com");
    const stlRequester = account(db, "stl-requester@example.com", "stl-mo");
    db.updateAccount(requester.id, { name: "Public Person" });
    db.updateAccount(stlRequester.id, { name: "Stl Person" });
    group(db, "g-a", undefined, [], "request", "columbia-mo");
    group(db, "g-b", undefined, [], "request", "stl-mo");
    await call(db, "POST", "/api/groups/g-a/membership", requester.cookie);
    await call(db, "POST", "/api/groups/g-b/membership", stlRequester.cookie);
    const queue = await call(db, "GET", "/api/me/leader/queue", owner.cookie);
    expect(queue.body.pending).toHaveLength(2);
    expect(queue.body.pending.map((p: { groupId: string }) => p.groupId).sort()).toEqual(["g-a", "g-b"]);
    expect(JSON.stringify(queue.body)).not.toContain(requester.email);
  });
});

describe("partial profile edits preserve untouched fields", () => {
  it("PATCH with only the description leaves membership mode and links untouched", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    group(db, "g1", owner.id);
    db.updateGroup("g1", { description: "Old desc", membershipMode: "open", websiteUrl: "https://example.com" });
    const r = await call(db, "PATCH", "/api/groups/g1/profile", owner.cookie, { description: "New desc", reason: REASON });
    expect(r.status).toBe(200);
    const g = db.getGroup("g1")!;
    expect(g.description).toBe("New desc");
    expect(g.membershipMode).toBe("open"); // untouched
    expect(g.websiteUrl).toBe("https://example.com"); // untouched
    expect(auditActions(db, "group.profile_edit")).toHaveLength(1);
  });
  it("PATCH with only membership mode leaves the description untouched", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    group(db, "g1", owner.id);
    db.updateGroup("g1", { description: "Keep me", membershipMode: "open" });
    const r = await call(db, "PATCH", "/api/groups/g1/profile", owner.cookie, { membershipMode: "request", reason: REASON });
    expect(r.status).toBe(200);
    expect(db.getGroup("g1")!.description).toBe("Keep me");
    expect(db.getGroup("g1")!.membershipMode).toBe("request");
  });
  it("a no-op PATCH (no changed fields) writes nothing and records no audit", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    group(db, "g1", owner.id);
    db.updateGroup("g1", { description: "Same", membershipMode: "request" });
    const r = await call(db, "PATCH", "/api/groups/g1/profile", owner.cookie, { description: "Same", membershipMode: "request", reason: REASON });
    expect(r.status).toBe(200);
    expect(db.getGroup("g1")!.description).toBe("Same");
    expect(auditActions(db, "group.profile_edit")).toHaveLength(0);
  });
});
