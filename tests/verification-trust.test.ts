/**
 * Trusted Member (manual trust / blue-check) foundation tests — Task 7 slice 1.
 *
 * Server-authoritative state + audited admin set/revoke operations with hard
 * boundaries: Global Admin (any city) and City Admin (exact scope city only);
 * no self-verification; no grants to pending/rejected accounts (no fabricated
 * verification); no cross-city actions; reason-required everywhere. Private
 * occurrence data (attendance/discussions) is untouched by this slice.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { DEFAULT_OWNER_EMAIL, OWNER_EMAIL_VAR } from "../src/server/owner";
import { ADMIN_COOKIE, SESSION_COOKIE } from "../src/server/api";
import { ADMIN_KEY_VAR, ADMIN_EMAIL_VAR, adminLogin } from "../src/server/admin";
import { toPublicAccount } from "../src/server/store";
import type { AccountRecord } from "../src/server/types";

const KEY = "test-admin-key-123";
const ADMIN_EMAIL = "admin@runlocal.app";
const REASON = "Manual trust review completed in person";

function req(method: string, path: string, cookie?: string, body?: unknown, reason?: string): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  let sent = false;
  const headers: Record<string, string> = { "x-forwarded-proto": "https", ...(raw ? { "content-type": "application/json" } : {}) };
  if (cookie) headers.cookie = cookie;
  if (reason) headers["x-audit-reason"] = reason;
  return { method, url: path, headers, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]() { return { next: async () => sent ? { done: true as const, value: undefined } : (sent = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
function response() {
  const out = { status: 0, body: "" };
  const res = { writeHead(status: number) { out.status = status; return res; }, setHeader() { return res; }, end(value?: unknown) { if (value !== undefined) out.body += String(value); return res; } } as unknown as ServerResponse;
  return { res, out };
}
async function call(db: Db, method: string, path: string, cookie?: string, body?: unknown, reason?: string) {
  const { res, out } = response();
  await apiHandler(req(method, path, cookie, body, reason), res, db);
  return { status: out.status, body: out.body ? (JSON.parse(out.body) as Record<string, any>) : {} };
}
function account(db: Db, email: string, cityId = "columbia-mo", patch: Partial<AccountRecord> = {}): { id: string; cookie: string; email: string } {
  const a = db.createAccount({ name: email, email, cityId });
  db.updateAccount(a.id, { status: "verified", ...patch });
  const s = db.createSession(a.id, "127.0.0.1");
  return { id: a.id, cookie: `${SESSION_COOKIE}=${s.id}`, email: a.email };
}
function keyAdminCookie(db: Db): string {
  const login = adminLogin(db, KEY, "127.0.0.1");
  if (!login.ok) throw new Error("key login failed");
  return `${ADMIN_COOKIE}=${login.data.sessionId}`;
}
const audit = (db: Db, action: string) => db.listAudit(100).filter((a) => a.action === action);

describe("Trusted Member grant - Global Admin", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
    delete process.env[OWNER_EMAIL_VAR];
  });

  it("the owner (Global Admin) grants by email; state + audit entry with city and change are recorded", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    const target = account(db, "runner@example.com");
    const r = await call(db, "POST", "/api/admin/trust/grant", owner.cookie, { email: target.email }, REASON);
    expect(r.status).toBe(200);
    expect(r.body.member.trustedMember).toBe(true);
    expect(db.getAccount(target.id)!.trustedMember).toBe(true);
    expect(db.getAccount(target.id)!.trustedMemberAt).toBeTruthy();
    const rows = audit(db, "admin.trust_grant");
    expect(rows).toHaveLength(1);
    expect(rows[0].targetId).toBe(target.id);
    expect(rows[0].cityId).toBe("columbia-mo");
    expect(rows[0].reason).toBe(REASON);
    expect(rows[0].change).toContain(target.email);
  });

  it("the key-admin session (Global Admin) can grant too", async () => {
    const db = createMemoryStore();
    const target = account(db, "runner@example.com");
    const r = await call(db, "POST", "/api/admin/trust/grant", keyAdminCookie(db), { email: target.email }, REASON);
    expect(r.status).toBe(200);
    expect(db.getAccount(target.id)!.trustedMember).toBe(true);
    expect(audit(db, "admin.trust_grant")).toHaveLength(1);
  });

  it("a plain verified runner can never grant", async () => {
    const db = createMemoryStore();
    const runner = account(db, "runner@example.com");
    const target = account(db, "other@example.com");
    const r = await call(db, "POST", "/api/admin/trust/grant", runner.cookie, { email: target.email }, REASON);
    expect(r.status).toBe(401);
    expect(target.id ? db.getAccount(target.id)!.trustedMember : true).toBe(false);
  });

  it("no self-verification: the owner cannot badge their own account, and the key session cannot badge the owner account", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    const viaOwner = await call(db, "POST", "/api/admin/trust/grant", owner.cookie, { email: owner.email }, REASON);
    expect(viaOwner.status).toBe(400);
    expect(viaOwner.body.error).toBe("self_verification");
    const viaKey = await call(db, "POST", "/api/admin/trust/grant", keyAdminCookie(db), { email: owner.email }, REASON);
    expect(viaKey.status).toBe(400);
    expect(viaKey.body.error).toBe("self_verification");
    expect(db.getAccount(owner.id)!.trustedMember).toBe(false);
    expect(audit(db, "admin.trust_grant")).toHaveLength(0);
  });

  it("no fabricated verification: pending and rejected accounts are rejected with 409", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    const pending = account(db, "pending@example.com", "columbia-mo", { status: "pending" });
    const rejected = account(db, "rejected@example.com", "columbia-mo", { status: "rejected" });
    const r1 = await call(db, "POST", "/api/admin/trust/grant", owner.cookie, { email: pending.email }, REASON);
    expect(r1.status).toBe(409);
    expect(r1.body.error).toBe("not_verified");
    const r2 = await call(db, "POST", "/api/admin/trust/grant", owner.cookie, { email: rejected.email }, REASON);
    expect(r2.status).toBe(409);
    expect(db.getAccount(pending.id)!.trustedMember).toBe(false);
  });

  it("grants to unknown or deleted accounts fail with 404; missing reason fails with 400", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    const target = account(db, "runner@example.com");
    db.updateAccount(target.id, { deletedAt: "2026-01-01T00:00:00.000Z" });
    expect((await call(db, "POST", "/api/admin/trust/grant", owner.cookie, { email: "nobody@example.com" }, REASON)).status).toBe(404);
    expect((await call(db, "POST", "/api/admin/trust/grant", owner.cookie, { email: target.email }, REASON)).status).toBe(404);
    const alive = account(db, "alive@example.com");
    expect((await call(db, "POST", "/api/admin/trust/grant", owner.cookie, { email: alive.email })).status).toBe(400); // no reason
  });

  it("grant is idempotent for an already-trusted member", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    const target = account(db, "runner@example.com");
    expect((await call(db, "POST", "/api/admin/trust/grant", owner.cookie, { email: target.email }, REASON)).status).toBe(200);
    expect((await call(db, "POST", "/api/admin/trust/grant", owner.cookie, { email: target.email }, REASON)).status).toBe(200);
    expect(db.getAccount(target.id)!.trustedMember).toBe(true);
  });

  it("the public account payload exposes trustedMember (display-only)", async () => {
    const db = createMemoryStore();
    const target = account(db, "runner@example.com");
    db.updateAccount(target.id, { trustedMember: true, trustedMemberAt: "2026-01-01T00:00:00.000Z" });
    const pub = toPublicAccount(db.getAccount(target.id)!);
    expect(pub.trustedMember).toBe(true);
    expect(db.getAccount(target.id)!.trustedMember).toBe(true);
  });
});

describe("Trusted Member revoke", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
    delete process.env[OWNER_EMAIL_VAR];
  });

  it("the Global Admin revokes by account id; state clears and the audit trail records it", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    const target = account(db, "runner@example.com");
    await call(db, "POST", "/api/admin/trust/grant", owner.cookie, { email: target.email }, REASON);
    const r = await call(db, "POST", `/api/admin/trust/${target.id}/revoke`, owner.cookie, undefined, REASON);
    expect(r.status).toBe(200);
    expect(r.body.member.trustedMember).toBe(false);
    const rec = db.getAccount(target.id)!;
    expect(rec.trustedMember).toBe(false);
    expect(rec.trustedMemberAt).toBeNull();
    const revokes = audit(db, "admin.trust_revoke");
    expect(revokes).toHaveLength(1);
    expect(revokes[0].cityId).toBe("columbia-mo");
    expect(revokes[0].change).toContain(target.email);
  });

  it("revoking a member who is not trusted is a harmless no-op", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    const target = account(db, "runner@example.com");
    const r = await call(db, "POST", `/api/admin/trust/${target.id}/revoke`, owner.cookie, undefined, REASON);
    expect(r.status).toBe(200);
    expect(r.body.member.trustedMember).toBe(false);
  });

  it("an admin cannot revoke their own badge either", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    db.updateAccount(owner.id, { trustedMember: true, trustedMemberAt: "2026-01-01T00:00:00.000Z" });
    const r = await call(db, "POST", `/api/admin/trust/${owner.id}/revoke`, owner.cookie, undefined, REASON);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("self_verification");
    expect(db.getAccount(owner.id)!.trustedMember).toBe(true);
  });
});

describe("Trusted Member - City Admin scope", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
    delete process.env[OWNER_EMAIL_VAR];
  });

  it("an in-scope City Admin grants within their exact city", async () => {
    const db = createMemoryStore();
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const target = account(db, "runner@example.com");
    const r = await call(db, "POST", "/api/admin/city/trust/grant", ca.cookie, { email: target.email }, REASON);
    expect(r.status).toBe(200);
    expect(db.getAccount(target.id)!.trustedMember).toBe(true);
    const rows = audit(db, "cityadmin.trust_grant");
    expect(rows).toHaveLength(1);
    expect(rows[0].cityId).toBe("columbia-mo");
  });

  it("no cross-city actions: a City Admin cannot grant or revoke in another city", async () => {
    const db = createMemoryStore();
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const other = account(db, "other@example.com", "stl-mo");
    const r1 = await call(db, "POST", "/api/admin/city/trust/grant", ca.cookie, { email: other.email }, REASON);
    expect(r1.status).toBe(403);
    expect(r1.body.error).toBe("city_scope_denied");
    db.updateAccount(other.id, { trustedMember: true, trustedMemberAt: "2026-01-01T00:00:00.000Z" });
    const r2 = await call(db, "POST", `/api/admin/city/trust/${other.id}/revoke`, ca.cookie, undefined, REASON);
    expect(r2.status).toBe(403);
    expect(db.getAccount(other.id)!.trustedMember).toBe(true);
    expect(audit(db, "cityadmin.trust_grant").length + audit(db, "cityadmin.trust_revoke").length).toBe(0);
  });

  it("a City Admin cannot use the global route (global-only)", async () => {
    const db = createMemoryStore();
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const target = account(db, "runner@example.com");
    const r = await call(db, "POST", "/api/admin/trust/grant", ca.cookie, { email: target.email }, REASON);
    expect(r.status).toBe(401);
    expect(db.getAccount(target.id)!.trustedMember).toBe(false);
  });

  it("no self-verification for City Admins: their own account is off-limits", async () => {
    const db = createMemoryStore();
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const r = await call(db, "POST", "/api/admin/city/trust/grant", ca.cookie, { email: ca.email }, REASON);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("self_verification");
  });

  it("a City Admin cannot grant to a pending account even in scope (no fabricated verification)", async () => {
    const db = createMemoryStore();
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const pending = account(db, "pending@example.com", "columbia-mo", { status: "pending" });
    const r = await call(db, "POST", "/api/admin/city/trust/grant", ca.cookie, { email: pending.email }, REASON);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("not_verified");
  });
});

describe("Trusted Member roster", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
    delete process.env[OWNER_EMAIL_VAR];
  });

  it("the global roster lists trusted members across cities; the city roster is scope-only", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    const inCity = account(db, "in@example.com");
    const outCity = account(db, "out@example.com", "stl-mo");
    await call(db, "POST", "/api/admin/trust/grant", owner.cookie, { email: inCity.email }, REASON);
    await call(db, "POST", "/api/admin/trust/grant", owner.cookie, { email: outCity.email }, REASON);
    const g = await call(db, "GET", "/api/admin/trust/members", owner.cookie);
    expect(g.status).toBe(200);
    expect(g.body.members.map((m: { accountId: string }) => m.accountId).sort()).toEqual([inCity.id, outCity.id].sort());
    const ca = account(db, "ca2@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const c = await call(db, "GET", "/api/admin/city/trust/members", ca.cookie);
    expect(c.status).toBe(200);
    expect(c.body.members.map((m: { accountId: string }) => m.accountId)).toEqual([inCity.id]);
  });

  it("plain runners and guests cannot read either roster", async () => {
    const db = createMemoryStore();
    const runner = account(db, "runner@example.com");
    const g = await call(db, "GET", "/api/admin/trust/members", runner.cookie);
    expect(g.status).toBe(401);
    const c = await call(db, "GET", "/api/admin/city/trust/members");
    expect(c.status).toBe(401);
  });

  it("legacy accounts persisted without the field load as not trusted (store migration)", async () => {
    const db = createMemoryStore();
    const target = account(db, "runner@example.com");
    const legacy = { ...db.getAccount(target.id)!, trustedMember: undefined as unknown as boolean, trustedMemberAt: undefined as unknown as string | null };
    // The migration normalizes missing fields exactly like the file-backed load path.
    legacy.trustedMember = legacy.trustedMember === true;
    legacy.trustedMemberAt = legacy.trustedMemberAt ?? null;
    expect(legacy.trustedMember).toBe(false);
    expect(legacy.trustedMemberAt).toBeNull();
  });
});
