/**
 * Multi-role account hierarchy + audited admin role assignment.
 *
 * Server core under test (owner-approved semantics — do not redesign):
 *   - Roles glue together: runner(0) < group_leader(1) < city_admin(2) <
 *     site_admin(3); hasRole implies every lower role.
 *   - The owner email is ALWAYS an effective site_admin (server-derived).
 *   - PATCH /api/admin/accounts/:id/roles carries the FULL desired set and an
 *     audit reason; Global Admin (owner) may assign any role; City Admin may
 *     only toggle group_leader for accounts in their own city; the owner can
 *     never be demoted below site_admin; admin roles require an
 *     identity-verified target. Every success is audited as
 *     admin.roles_assign with a before/after change summary.
 */
import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { apiHandler, SESSION_COOKIE } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { seedCmsCities } from "../src/server/cms";
import { DEFAULT_OWNER_EMAIL } from "../src/server/owner";
import {
  ALL_ACCOUNT_ROLES,
  accountRoles,
  effectiveRole,
  hasRole,
  highestRole,
  normalizeRoles,
  rolesPatch,
  storedRoles,
} from "../src/server/accountRoles";
import type { AccountRecord, AccountRole } from "../src/server/types";

function req(method: string, path: string, opts: { body?: unknown; cookie?: string; reason?: string } = {}): any {
  const input = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const headers: Record<string, string> = { "x-forwarded-proto": "https" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.reason) headers["x-audit-reason"] = opts.reason;
  const r = Readable.from([input]) as any;
  r.method = method;
  r.url = path;
  r.headers = headers;
  r.socket = { remoteAddress: "198.51.100.42" };
  return r;
}
async function call(db: Db, method: string, path: string, opts: { body?: unknown; cookie?: string; reason?: string } = {}) {
  let status = 0;
  let payload = "";
  const res = new Writable({ write(chunk, _e, done) { payload += chunk.toString(); done(); } }) as any;
  res.statusCode = 200;
  res.headersSent = false;
  res.setHeader = () => {};
  res.writeHead = (s: number) => { status = s; res.headersSent = true; };
  res.end = (v?: unknown) => { if (v !== undefined) payload += String(v); };
  await apiHandler(req(method, path, opts) as never, res as never, db);
  return { status, body: payload ? JSON.parse(payload) : {} };
}
/** Verified account with a session cookie; the owner email yields a global-scope admin session. */
function account(db: Db, email: string, cityId = "columbia-mo", patch: Partial<AccountRecord> = {}) {
  const rec = db.createAccount({ name: email, email, cityId });
  db.updateAccount(rec.id, { status: "verified", ...patch });
  const sid = db.createSession(rec.id, "test");
  return { id: rec.id, email: rec.email, cookie: `${SESSION_COOKIE}=${sid.id}` };
}
/** Identity-ready target: verified status (admin roles require this). */
function setup() {
  const db = createMemoryStore();
  seedCmsCities(db); // registry cities (columbia-mo, stl-mo, …)
  return { db };
}
const rolesPath = (id: string) => `/api/admin/accounts/${id}/roles`;
const REASON = "Role review for moderation coverage";

describe("hierarchy helpers (accountRoles)", () => {
  it("hasRole implies every lower role — site_admin glues together all roles", () => {
    const rec = { roles: ["site_admin"] as AccountRole[], role: "site_admin" as const, email: "a@x.com" };
    expect(hasRole(rec, "site_admin")).toBe(true);
    expect(hasRole(rec, "city_admin")).toBe(true);
    expect(hasRole(rec, "group_leader")).toBe(true);
    expect(hasRole(rec, "runner")).toBe(true);
    expect(effectiveRole(rec)).toBe("site_admin");
  });
  it("legacy single-role records fall back to role as the full set", () => {
    const legacy = { roles: [] as AccountRole[], role: "group_leader" as const, email: "b@x.com" };
    expect(storedRoles(legacy)).toEqual(["group_leader"]);
    expect(accountRoles(legacy)).toEqual(["group_leader"]);
    expect(effectiveRole(legacy)).toBe("group_leader");
  });
  it("the owner email is always an effective site_admin, even with no stored roles", () => {
    const owner = { roles: ["runner"] as AccountRole[], role: "runner" as const, email: DEFAULT_OWNER_EMAIL };
    expect(accountRoles(owner)).toContain("site_admin");
    expect(effectiveRole(owner)).toBe("site_admin");
    expect(hasRole(owner, "city_admin")).toBe(true);
  });
  it("normalizeRoles dedupes and returns canonical order; unknown roles are dropped", () => {
    expect(normalizeRoles(["city_admin", "runner", "city_admin", "group_leader"])).toEqual(["runner", "group_leader", "city_admin"]);
    expect(normalizeRoles(["bogus" as never])).toEqual([]);
  });
  it("rolesPatch keeps the legacy role field synced to the highest role and always includes runner", () => {
    expect(rolesPatch(["group_leader"])).toEqual({ roles: ["runner", "group_leader"], role: "group_leader" });
    expect(rolesPatch(["site_admin"])).toEqual({ roles: ["runner", "site_admin"], role: "site_admin" });
    expect(rolesPatch([]).roles).toEqual(["runner"]);
  });
  it("highestRole picks the top-ranked role", () => {
    expect(highestRole(["runner", "city_admin"])).toBe("city_admin");
    expect(ALL_ACCOUNT_ROLES).toEqual(["runner", "group_leader", "city_admin", "site_admin"]);
  });
});

describe("PATCH /api/admin/accounts/:id/roles — Global Admin (owner)", () => {
  it("assigns site_admin and city_admin (with city scope) on the happy path", async () => {
    const { db } = setup();
    const admin = account(db, DEFAULT_OWNER_EMAIL);
    const target = account(db, "target@example.com");
    const r1 = await call(db, "PATCH", rolesPath(target.id), { cookie: admin.cookie, reason: REASON, body: { roles: ["city_admin"], cityId: "columbia-mo" } });
    expect(r1.status).toBe(200);
    expect(r1.body.account.roles).toEqual(["runner", "city_admin"]);
    expect(r1.body.account.adminCityId).toBe("columbia-mo");
    const r2 = await call(db, "PATCH", rolesPath(target.id), { cookie: admin.cookie, reason: REASON, body: { roles: ["site_admin"] } });
    expect(r2.status).toBe(200);
    expect(r2.body.account.roles).toEqual(["runner", "site_admin"]);
    const rec = db.getAccount(target.id)!;
    expect(rec.role).toBe("site_admin"); // legacy field stays in sync
    expect(rec.adminCityId).toBe(null); // site_admin alone clears the city scope
  });
  it("rejects an invalid roles payload with 400", async () => {
    const { db } = setup();
    const admin = account(db, DEFAULT_OWNER_EMAIL);
    const target = account(db, "target@example.com");
    for (const body of [{ roles: [] }, { roles: ["bogus"] }, {}, { roles: "site_admin" }]) {
      const r = await call(db, "PATCH", rolesPath(target.id), { cookie: admin.cookie, reason: REASON, body });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("invalid_roles");
    }
  });
  it("returns 404 for an unknown account", async () => {
    const { db } = setup();
    const admin = account(db, DEFAULT_OWNER_EMAIL);
    const r = await call(db, "PATCH", rolesPath("0".repeat(32)), { cookie: admin.cookie, reason: REASON, body: { roles: ["group_leader"] } });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("account_not_found");
  });
  it("requires a valid registry city for city_admin (400 invalid_city)", async () => {
    const { db } = setup();
    const admin = account(db, DEFAULT_OWNER_EMAIL);
    const target = account(db, "target@example.com");
    const r = await call(db, "PATCH", rolesPath(target.id), { cookie: admin.cookie, reason: REASON, body: { roles: ["city_admin"], cityId: "nowhere-xx" } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_city");
  });
  it("rejects admin roles on an unverified target with 409 verification_incomplete", async () => {
    const { db } = setup();
    const admin = account(db, DEFAULT_OWNER_EMAIL);
    const rec = db.createAccount({ name: "P", email: "p@x.com", cityId: "columbia-mo" }); // status pending, phase email
    const sid = db.createSession(rec.id, "test");
    const cookie = `${SESSION_COOKIE}=${sid.id}`;
    const r = await call(db, "PATCH", rolesPath(rec.id), { cookie: admin.cookie, reason: REASON, body: { roles: ["city_admin"], cityId: "columbia-mo" } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("verification_incomplete");
    expect(db.getAccount(rec.id)!.roles).toEqual(["runner"]);
    void cookie;
  });
  it("cannot demote the owner below site_admin (409)", async () => {
    const { db } = setup();
    const admin = account(db, DEFAULT_OWNER_EMAIL);
    const r = await call(db, "PATCH", rolesPath(admin.id), { cookie: admin.cookie, reason: REASON, body: { roles: ["group_leader"] } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("owner_cannot_demote");
    expect(accountRoles(db.getAccount(admin.id)!)).toContain("site_admin");
  });
  it("writes an audited admin.roles_assign entry with a before/after change summary", async () => {
    const { db } = setup();
    const admin = account(db, DEFAULT_OWNER_EMAIL);
    const target = account(db, "target@example.com");
    await call(db, "PATCH", rolesPath(target.id), { cookie: admin.cookie, reason: REASON, body: { roles: ["group_leader"] } });
    const entry = db.listAudit(50).find((a) => a.action === "admin.roles_assign" && a.targetId === target.id);
    expect(entry).toBeDefined();
    expect(entry!.reason).toBe(REASON);
    expect(entry!.change).toContain("roles: runner -> group_leader");
    expect(entry!.admin).toBe(DEFAULT_OWNER_EMAIL);
    expect(db.listAudit(50).filter((a) => a.action === "admin.roles_assign").length).toBe(1);
  });
});

describe("PATCH /api/admin/accounts/:id/roles — City Admin scope", () => {
  it("may add group_leader for an account in their own city", async () => {
    const { db } = setup();
    const cityAdmin = account(db, "ca@example.com", "columbia-mo", { roles: ["runner", "city_admin"], adminCityId: "columbia-mo" });
    const member = account(db, "member@example.com", "columbia-mo");
    const r = await call(db, "PATCH", rolesPath(member.id), { cookie: cityAdmin.cookie, reason: REASON, body: { roles: ["runner", "group_leader"] } });
    expect(r.status).toBe(200);
    expect(r.body.account.roles).toEqual(["runner", "group_leader"]);
  });
  it("cannot manage an account outside their city (403 city_scope_denied)", async () => {
    const { db } = setup();
    const cityAdmin = account(db, "ca@example.com", "columbia-mo", { roles: ["runner", "city_admin"], adminCityId: "columbia-mo" });
    const other = account(db, "other@example.com", "stl-mo");
    const r = await call(db, "PATCH", rolesPath(other.id), { cookie: cityAdmin.cookie, reason: REASON, body: { roles: ["group_leader"] } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("city_scope_denied");
  });
  it("cannot grant city_admin or site_admin (403 roles_out_of_scope)", async () => {
    const { db } = setup();
    const cityAdmin = account(db, "ca@example.com", "columbia-mo", { roles: ["runner", "city_admin"], adminCityId: "columbia-mo" });
    const member = account(db, "member@example.com", "columbia-mo");
    const r = await call(db, "PATCH", rolesPath(member.id), { cookie: cityAdmin.cookie, reason: REASON, body: { roles: ["city_admin"], cityId: "columbia-mo" } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("roles_out_of_scope");
    expect(db.getAccount(member.id)!.roles).toEqual(["runner"]);
  });
  it("requires an audit reason (400 reason_required) and rejects plain runners (401)", async () => {
    const { db } = setup();
    const admin = account(db, DEFAULT_OWNER_EMAIL);
    const target = account(db, "target@example.com");
    const noReason = await call(db, "PATCH", rolesPath(target.id), { cookie: admin.cookie, body: { roles: ["group_leader"] } });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe("reason_required");
    const runner = account(db, "runner@example.com");
    const unauth = await call(db, "PATCH", rolesPath(target.id), { cookie: runner.cookie, reason: REASON, body: { roles: ["group_leader"] } });
    expect(unauth.status).toBe(401);
  });
});
