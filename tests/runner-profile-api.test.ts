/**
 * HTTP-level tests for the PUBLIC runner profile endpoint (GET /api/runners/:id):
 *  - guest-accessible read of a verified runner's public identity;
 *  - the payload NEVER contains email/phone/suspension/rejection/under-review
 *    or any admin/verification history — even when the caller is the owner
 *    (this route is public-safe by construction; /api/profile/trust is the
 *    only place owner extras appear);
 *  - deleted/suspended/unknown accounts are indistinguishable (404);
 *  - the qualitative trust view + non-ranked city recognitions ride along.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { ADMIN_EMAIL_VAR, ADMIN_KEY_VAR } from "../src/server/admin";
// ------------------------------------------------------------ HTTP harness
function makeReq(method: string, path: string, opts: { body?: unknown; cookie?: string } = {}): IncomingMessage {
  const raw = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const headers: Record<string, string> = { "x-forwarded-proto": "https" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (raw) headers["content-type"] = "application/json";
  const req = {
    method,
    url: path,
    headers,
    socket: { remoteAddress: "198.51.100.23" },
    [Symbol.asyncIterator]() {
      const chunks = raw ? [Buffer.from(raw)] : [];
      let i = 0;
      return { next: async () => (i < chunks.length ? { done: false as const, value: chunks[i++] } : { done: true as const, value: undefined }) };
    },
  };
  return req as unknown as IncomingMessage;
}
interface FakeRes { status: number; body: string; contentType: string | null; cookie: string; }
function makeRes(): { res: ServerResponse; fake: FakeRes } {
  const fake: FakeRes = { status: 200, body: "", contentType: null, cookie: "" };
  const res = {
    writeHead(status: number, headers?: Record<string, string | string[]>) {
      fake.status = status;
      const ct = headers?.["content-type"];
      fake.contentType = Array.isArray(ct) ? ct[0] : (ct ?? null);
      return res;
    },
    setHeader(name: string, value: unknown) { if (name.toLowerCase() === "set-cookie") fake.cookie = Array.isArray(value) ? String(value[0]) : String(value); return res; },
    end(chunk?: unknown) { if (chunk !== undefined) fake.body += String(chunk); return res; },
  } as unknown as ServerResponse;
  return { res, fake };
}
async function post(db: Db, path: string, body: unknown, cookie?: string): Promise<FakeRes> {
  const { res, fake } = makeRes();
  await apiHandler(makeReq("POST", path, { body, cookie }), res, db);
  return fake;
}
async function get(db: Db, path: string, cookie?: string): Promise<FakeRes> {
  const { res, fake } = makeRes();
  await apiHandler(makeReq("GET", path, { cookie }), res, db);
  return fake;
}
function json<T>(f: FakeRes): T { return JSON.parse(f.body) as T; }
function cookieFrom(f: FakeRes): string {
  const m = /runlocal_sid=([^;]+)/.exec(f.cookie);
  return m ? `runlocal_sid=${m[1]}` : "";
}
// ------------------------------------------------------------ fixtures
const KEY = "test-admin-key-123";
beforeEach(() => {
  process.env[ADMIN_KEY_VAR] = KEY;
  process.env[ADMIN_EMAIL_VAR] = "safety@runlocal.app";
});
afterEach(() => {
  delete process.env[ADMIN_KEY_VAR];
  delete process.env[ADMIN_EMAIL_VAR];
});
async function signup(db: Db, email: string, name = "Runner"): Promise<{ id: string; cookie: string }> {
  const f = await post(db, "/api/accounts", { name, username: email.split("@")[0] + Math.random().toString(36).slice(2, 8), email, birthdate: "1998-05-05", cityId: "columbia-mo" });
  const body = json<{ account: { id: string } }>(f);
  const cookie = cookieFrom(f);
  db.updateAccount(body.account.id, { status: "verified", phase: "pending_review" });
  return { id: body.account.id, cookie };
}
function runnerProfile<T>(f: FakeRes): T {
  return json<{ profile: T }>(f).profile;
}
// ------------------------------------------------------------ tests
describe("GET /api/runners/:id — public runner profile", () => {
  it("guest read of a verified runner returns public-safe identity fields", async () => {
    const db = createMemoryStore();
    const a = await signup(db, "runner@example.com", "Taylor Runner");
    db.updateAccount(a.id, { username: "taylor_runs", trustedMember: true, role: "group_leader", profilePhotoRef: "abc.jpg" });
    const f = await get(db, `/api/runners/${a.id}`);
    expect(f.status).toBe(200);
    const profile = runnerProfile<Record<string, unknown>>(f);
    expect(profile).toMatchObject({
      id: a.id,
      name: "Taylor Runner",
      username: "taylor_runs",
      profilePhotoUrl: "/uploads/public/abc.jpg",
      cityName: "Columbia",
      isVerified: true,
      isTrustedMember: true,
      isLeader: true,
    });
  });
  it("payload NEVER contains email, phone, suspension, rejection, or under-review data", async () => {
    const db = createMemoryStore();
    const a = await signup(db, "private@example.com", "Private Runner");
    db.updateAccount(a.id, {
      phone: "555-0100",
      phoneVerified: true,
      selfieRef: "selfie.jpg",
      signupIp: "203.0.113.9",
      loginIps: [{ ip: "203.0.113.9", at: "2026-08-01T00:00:00.000Z" }],
      supabaseAuthId: "auth-user-123",
      suspendedUntil: "2099-01-01T00:00:00.000Z",
      suspensionReason: "spam",
      rejectionReason: "photo mismatch",
      underReview: true,
      underReviewAt: "2026-08-01T00:00:00.000Z",
      trustedMemberAt: "2026-08-01T00:00:00.000Z",
      verifiedAt: "2026-08-01T00:00:00.000Z",
    });
    const f = await get(db, `/api/runners/${a.id}`);
    expect(f.status).toBe(200);
    const body = f.body;
    for (const forbidden of [
      "email", "phone", "selfie", "signupIp", "loginIps", "supabaseAuth", "suspended",
      "suspendedUntil", "suspensionReason", "rejectionReason", "underReview", "restrictions",
      "trustedMemberAt", "verifiedAt", "birthdate", "example.com", "555-0100",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });
  it("deleted, suspended, and unknown accounts all 404 identically", async () => {
    const db = createMemoryStore();
    const a = await signup(db, "gone@example.com", "Gone Runner");
    const b = await signup(db, "quiet@example.com", "Quiet Runner");
    db.updateAccount(a.id, { deletedAt: "2026-08-01T00:00:00.000Z" });
    db.updateAccount(b.id, { suspended: true });
    const deleted = await get(db, `/api/runners/${a.id}`);
    const suspended = await get(db, `/api/runners/${b.id}`);
    const unknown = await get(db, `/api/runners/${"f".repeat(32)}`);
    expect(deleted.status).toBe(404);
    expect(suspended.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(json<{ error: string }>(deleted).error).toBe("not_found");
    expect(json<{ error: string }>(suspended).error).toBe("not_found");
    expect(json<{ error: string }>(unknown).error).toBe("not_found");
  });
  it("own profile via /runners/:id is ALSO public-safe — no underReview/restrictions", async () => {
    const db = createMemoryStore();
    const a = await signup(db, "self@example.com", "Self Runner");
    db.updateAccount(a.id, { underReview: true });
    const f = await get(db, `/api/runners/${a.id}`, a.cookie);
    expect(f.status).toBe(200);
    const body = json<{ trust: Record<string, unknown>; profile: Record<string, unknown> }>(f);
    expect(body.trust.underReview).toBeUndefined();
    expect("restrictions" in body.trust).toBe(false);
    expect("underReview" in body.profile).toBe(false);
  });
  it("pending (unverified) accounts are visible but never claim the verified badge", async () => {
    const db = createMemoryStore();
    const f0 = await post(db, "/api/accounts", { name: "New Runner", username: "newbie" + Math.random().toString(36).slice(2, 8), email: "new@example.com", birthdate: "1998-05-05", cityId: "columbia-mo" });
    const id = json<{ account: { id: string } }>(f0).account.id;
    const f = await get(db, `/api/runners/${id}`);
    expect(f.status).toBe(200);
    const profile = runnerProfile<{ isVerified: boolean; phase?: unknown; status?: unknown }>(f);
    expect(profile.isVerified).toBe(false);
    expect("phase" in profile).toBe(false);
    expect("status" in profile).toBe(false);
  });
  it("returns the qualitative trust view and the city's non-ranked recognitions", async () => {
    const db = createMemoryStore();
    const a = await signup(db, "trust@example.com", "Trust Runner");
    const f = await get(db, `/api/runners/${a.id}`);
    const body = json<{ trust: { tier: string; coach: boolean; host: boolean; recognitions: unknown[] }; recognitions: unknown[] }>(f);
    expect(body.trust.tier).toBe("new");
    expect(body.trust.coach).toBe(false);
    expect(body.trust.host).toBe(false);
    expect(body.trust.recognitions).toEqual([]);
    expect(Array.isArray(body.recognitions)).toBe(true);
  });
});
