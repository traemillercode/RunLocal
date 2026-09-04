import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { ADMIN_EMAIL_VAR, ADMIN_KEY_VAR } from "../src/server/admin";

const KEY = "provider-test-key";
const REASON = "provider availability test";

type Options = { body?: unknown; cookie?: string; reason?: string };
async function call(db: Db, method: string, path: string, options: Options = {}) {
  const raw = options.body === undefined ? "" : JSON.stringify(options.body);
  const req = { method, url: path, headers: { ...(raw ? { "content-type": "application/json" } : {}), ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.reason ? { "x-audit-reason": options.reason } : {}) }, socket: { remoteAddress: "198.51.100.23" }, [Symbol.asyncIterator]() { let done = false; return { next: async () => done ? { done: true as const, value: undefined } : (done = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
  const result = { status: 200, body: "" };
  const res = { writeHead(status: number) { result.status = status; return res; }, setHeader() { return res; }, end(value?: unknown) { if (value !== undefined) result.body += String(value); return res; } } as unknown as ServerResponse;
  await apiHandler(req, res, db);
  return { status: result.status, body: result.body ? JSON.parse(result.body) : {} };
}
function user(db: Db, email = "runner@example.com") { const a = db.createAccount({ name: "Runner", email, username: `runner-${Math.random()}` }); db.updateAccount(a.id, { status: "verified", avatarStyle: "coral" }); return { cookie: `runlocal_sid=${db.createSession(a.id, "198.51.100.23").id}`, id: a.id }; }
function admin(db: Db) { return `runlocal_admin=${db.createSession("__admin__", "198.51.100.23").id}`; }

beforeEach(() => { process.env[ADMIN_KEY_VAR] = KEY; process.env[ADMIN_EMAIL_VAR] = "admin@runlocal.app"; });
afterEach(() => { for (const key of [ADMIN_KEY_VAR, ADMIN_EMAIL_VAR, "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REDIRECT_URI"]) delete process.env[key]; });

describe("Phase 1 provider availability", () => {
  it("requires authentication and reports configured Strava as available", async () => {
    const db = createMemoryStore();
    expect((await call(db, "GET", "/api/connections/strava")).status).toBe(401);
    Object.assign(process.env, { STRAVA_CLIENT_ID: "client", STRAVA_CLIENT_SECRET: "secret", STRAVA_REDIRECT_URI: "https://runlocal.example/callback" });
    const r = await call(db, "GET", "/api/connections/strava", { cookie: user(db).cookie });
    expect(r.status).toBe(200); expect(r.body.state).toBe("available"); expect(r.body.configured).toBe(true); expect(r.body.authorizeUrl).toContain("strava.com");
  });
  it("reports missing Strava configuration without exposing values", async () => {
    const db = createMemoryStore(); const r = await call(db, "GET", "/api/connections/strava", { cookie: user(db).cookie });
    expect(r.status).toBe(200); expect(r.body.state).toBe("not_configured"); expect(r.body.missing).toContain("STRAVA_CLIENT_ID");
  });
  it("reports CMS-disabled providers as unavailable", async () => {
    const db = createMemoryStore(); const u = user(db); const a = admin(db);
    await call(db, "POST", "/api/admin/cms/settings", { cookie: a, reason: REASON, body: { providers: { strava: false } } });
    const r = await call(db, "GET", "/api/connections/strava", { cookie: u.cookie });
    expect(r.body).toMatchObject({ offered: false, state: "unavailable" });
  });
  it.each(["garmin", "coros", "suunto"]) ("denies %s direct connection as coming soon", async (provider) => {
    const db = createMemoryStore(); const cookie = user(db).cookie;
    await call(db, "POST", "/api/admin/cms/settings", { cookie: admin(db), reason: REASON, body: { providers: { [provider]: true } } });
    const get = await call(db, "GET", `/api/connections/${provider}`, { cookie });
    expect(get.body).toMatchObject({ state: "coming_soon", error: "provider_coming_soon" });
    const post = await call(db, "POST", `/api/connections/${provider}`, { cookie });
    expect(post.status).toBe(409); expect(post.body.error).toBe("provider_coming_soon");
  });
  it("shows persisted token connected only for its owning account", async () => {
    const db = createMemoryStore(); Object.assign(process.env, { STRAVA_CLIENT_ID: "client", STRAVA_CLIENT_SECRET: "secret", STRAVA_REDIRECT_URI: "https://runlocal.example/callback" });
    const owner = user(db, "owner@example.com"); const other = user(db, "other@example.com");
    db.setToken({ accountId: owner.id, provider: "strava", accessToken: "persisted-token", refreshToken: null, expiresAt: null, providerUserId: "athlete-1" });
    expect((await call(db, "GET", "/api/connections/strava", { cookie: owner.cookie })).body).toMatchObject({ state: "connected", connected: true });
    expect((await call(db, "GET", "/api/connections/strava", { cookie: other.cookie })).body).toMatchObject({ state: "available", connected: false });
  });
});
