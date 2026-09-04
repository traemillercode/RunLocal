/** Focused authorization and lifecycle coverage for persisted group memberships. */
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import type { GroupModRecord } from "../src/server/types";

function request(method: "GET" | "POST", url: string, body: unknown = {}, cookie?: string): IncomingMessage {
  const raw = JSON.stringify(body);
  return { method, url, headers: { "content-type": "application/json", "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}) }, socket: { remoteAddress: "198.51.100.23" },
    [Symbol.asyncIterator]() { let done = false; return { next: async () => done ? { done: true as const, value: undefined } : (done = true, { done: false as const, value: Buffer.from(raw) }) }; },
  } as unknown as IncomingMessage;
}
function response() { const result = { status: 200, body: "" }; const res = { writeHead(status: number) { result.status = status; return res; }, setHeader() { return res; }, end(chunk?: unknown) { if (chunk !== undefined) result.body += String(chunk); return res; } } as unknown as ServerResponse; return { res, result }; }
async function call(db: Db, method: "GET" | "POST", url: string, body: unknown = {}, cookie?: string) { const out = response(); await apiHandler(request(method, url, body, cookie), out.res, db); return { ...out, json: JSON.parse(out.result.body) }; }
function account(db: Db, email: string, cityId = "columbia-mo", role: "runner" | "leader" = "runner") { const a = db.createAccount({ name: email, email, cityId }); db.updateAccount(a.id, { status: "verified", ...(role === "leader" ? { role: "group_leader" as const } : {}) }); const s = db.createSession(a.id, "198.51.100.23"); return { a, cookie: `runlocal_sid=${s.id}` }; }
function group(db: Db, id: string, ownerId: string, cityId = "columbia-mo", mode: "open" | "request" = "request"): GroupModRecord { const g: GroupModRecord = { id, cityId, name: id, ownerId, leaderIds: [ownerId], membershipMode: mode, rrcaBadge: false, rrcaNote: null, rrcaNoteUpdatedAt: null }; db.upsertGroup(g); return g; }

describe("group membership authorization and lifecycle", () => {
  it("isolates My Groups to the authenticated account and does not infer seeded groups", async () => {
    const db = createMemoryStore(); const one = account(db, "one@example.com"); const two = account(db, "two@example.com");
    group(db, "seeded-group", one.a.id, "columbia-mo", "open");
    expect((await call(db, "GET", "/api/me/groups", {}, one.cookie)).json.memberships).toEqual([]);
    await call(db, "POST", "/api/groups/seeded-group/membership", {}, one.cookie);
    expect((await call(db, "GET", "/api/me/groups", {}, one.cookie)).json.memberships).toHaveLength(1);
    expect((await call(db, "GET", "/api/me/groups", {}, two.cookie)).json.memberships).toEqual([]);
  });

  it("denies requests and administration across cities", async () => {
    const db = createMemoryStore(); const columbia = account(db, "columbia@example.com"); const springfield = account(db, "springfield@example.com", "springfield-mo", "leader");
    group(db, "springfield-group", springfield.a.id, "springfield-mo");
    expect((await call(db, "POST", "/api/groups/springfield-group/membership", {}, columbia.cookie)).result.status).toBe(403);
    const pending = db.createAccount({ name: "target", email: "target@example.com", cityId: "columbia-mo" }); db.updateAccount(pending.id, { status: "verified", avatarStyle: "coral" });
    const g = group(db, "columbia-group", columbia.a.id); db.addMembership({ id: "m1", groupId: g.id, accountId: pending.id, cityId: g.cityId, status: "pending", requestedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), decidedAt: null, decidedBy: null });
    expect((await call(db, "POST", "/api/groups/columbia-group/membership/approve", { accountId: pending.id }, springfield.cookie)).result.status).toBe(403);
  });

  it("supports request, approve, decline, leave, remove, and re-request", async () => {
    const db = createMemoryStore(); const leader = account(db, "leader@example.com", "columbia-mo", "leader"); const member = account(db, "member@example.com"); group(db, "request-group", leader.a.id);
    const requested = await call(db, "POST", "/api/groups/request-group/membership", {}, member.cookie); expect(requested.result.status).toBe(200); expect(requested.json.membership.status).toBe("pending");
    expect((await call(db, "POST", "/api/groups/request-group/membership/approve", { accountId: member.a.id }, leader.cookie)).json.membership.status).toBe("active");
    expect((await call(db, "POST", "/api/groups/request-group/membership/leave", {}, member.cookie)).json.membership.status).toBe("left");
    expect((await call(db, "POST", "/api/groups/request-group/membership", {}, member.cookie)).json.membership.status).toBe("pending");
    expect((await call(db, "POST", "/api/groups/request-group/membership/decline", { accountId: member.a.id }, leader.cookie)).json.membership.status).toBe("declined");
    expect((await call(db, "POST", "/api/groups/request-group/membership", {}, member.cookie)).json.membership.status).toBe("pending");
    expect((await call(db, "POST", "/api/groups/request-group/membership/remove", { accountId: member.a.id }, leader.cookie)).json.membership.status).toBe("revoked");
  });
});
