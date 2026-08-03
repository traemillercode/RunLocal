/**
 * Username API contract tests — server-authoritative validation, deterministic
 * duplicate rejection, race behavior on the in-memory store, auth-linking
 * preservation, and payload safety.
 *
 * Same HTTP harness as api-login-check.test.ts: real apiHandler against a
 * memory store with a fake IncomingMessage/ServerResponse. The username
 * endpoints never call Supabase, so no fetch stub is needed here.
 */
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore } from "../src/server/store";

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
      return {
        next: async () => (i < chunks.length ? { done: false as const, value: chunks[i++] } : { done: true as const, value: undefined }),
      };
    },
  };
  return req as unknown as IncomingMessage;
}
interface FakeRes {
  status: number;
  body: string;
  setCookieHeader: string | undefined;
}
function makeRes(): { res: ServerResponse; fake: FakeRes } {
  const fake: FakeRes = { status: 200, body: "", setCookieHeader: undefined };
  const res = {
    writeHead(status: number, headers?: Record<string, string | string[]>) {
      fake.status = status;
      if (headers) {
        const sc = headers["set-cookie"];
        if (Array.isArray(sc)) fake.setCookieHeader = sc[0];
        else if (typeof sc === "string") fake.setCookieHeader = sc;
      }
      return res;
    },
    setHeader(name: string, value: string | string[]) {
      if (name.toLowerCase() === "set-cookie") {
        fake.setCookieHeader = Array.isArray(value) ? value[0] : value;
      }
      return res;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) fake.body += String(chunk);
      return res;
    },
  } as unknown as ServerResponse;
  return { res, fake };
}
async function post(db: ReturnType<typeof createMemoryStore>, path: string, body: unknown, cookie?: string): Promise<FakeRes> {
  const { res, fake } = makeRes();
  await apiHandler(makeReq("POST", path, { body, cookie }), res, db);
  return fake;
}
async function get(db: ReturnType<typeof createMemoryStore>, path: string, cookie?: string): Promise<FakeRes> {
  const { res, fake } = makeRes();
  await apiHandler(makeReq("GET", path, { cookie }), res, db);
  return fake;
}

const VALID = { name: "Jordan Lee", username: "jordanlee", email: "runner@example.com", birthdate: "1998-05-05" };

describe("POST /api/accounts — signup requires and normalizes the username", () => {
  it("rejects a missing username with 400 invalid_username and creates nothing", async () => {
    const db = createMemoryStore();
    const { username: _omit, ...noUsername } = VALID;
    const fake = await post(db, "/api/accounts", noUsername);
    expect(fake.status).toBe(400);
    expect(JSON.parse(fake.body)).toMatchObject({ error: "invalid_username" });
    expect(db.listAccounts().length).toBe(0);
  });
  it("rejects an invalid username (bad characters, too short) and creates nothing", async () => {
    const db = createMemoryStore();
    for (const bad of ["ab", "1jordan", "jordan lee", "jordan@lee", ""]) {
      const fake = await post(db, "/api/accounts", { ...VALID, email: `x-${bad.length}@example.com`, username: bad });
      expect(fake.status, `username=${JSON.stringify(bad)}`).toBe(400);
      expect(JSON.parse(fake.body).error, `username=${JSON.stringify(bad)}`).toBe("invalid_username");
    }
    expect(db.listAccounts().length).toBe(0);
  });
  it("normalizes case and whitespace server-side (client casing is never stored)", async () => {
    const db = createMemoryStore();
    const fake = await post(db, "/api/accounts", { ...VALID, username: "  JordanLee  " });
    expect(fake.status).toBe(200);
    const payload = JSON.parse(fake.body) as { account: { username: string } };
    expect(payload.account.username).toBe("jordanlee");
    expect(db.getAccountByEmail(VALID.email)!.username).toBe("jordanlee");
  });
  it("returns the public account shape (username included, nothing sensitive)", async () => {
    const db = createMemoryStore();
    const fake = await post(db, "/api/accounts", { ...VALID, phone: "+15735550123" });
    expect(fake.status).toBe(200);
    const payload = JSON.parse(fake.body) as { account: Record<string, unknown> };
    expect(payload.account.username).toBe("jordanlee");
    const raw = JSON.stringify(fake.body);
    expect(raw).not.toContain("573555");
    expect(raw).not.toContain("supabaseAuthId");
    expect(raw).not.toContain("selfie");
  });
});

describe("POST /api/accounts — deterministic duplicate rejection", () => {
  it("rejects a second account claiming a taken username (409 username_taken)", async () => {
    const db = createMemoryStore();
    const first = await post(db, "/api/accounts", VALID);
    expect(first.status).toBe(200);
    const second = await post(db, "/api/accounts", { ...VALID, email: "other@example.com" });
    expect(second.status).toBe(409);
    const body = JSON.parse(second.body) as { error: string; message: string };
    expect(body.error).toBe("username_taken");
    expect(body.message).toMatch(/taken/i);
    // The duplicate is rejected — only one account exists.
    expect(db.listAccounts().length).toBe(1);
  });
  it("treats any casing of a taken name as the same username", async () => {
    const db = createMemoryStore();
    await post(db, "/api/accounts", VALID);
    const dup = await post(db, "/api/accounts", { ...VALID, email: "other@example.com", username: "JORDANLEE" });
    expect(dup.status).toBe(409);
    expect(JSON.parse(dup.body).error).toBe("username_taken");
  });
  it("a different username on the same email still hits the email rule, not the username rule", async () => {
    const db = createMemoryStore();
    await post(db, "/api/accounts", VALID);
    const sameEmail = await post(db, "/api/accounts", { ...VALID, username: "another_name" });
    expect(sameEmail.status).toBe(409);
    expect(JSON.parse(sameEmail.body).error).toBe("email_taken");
  });
  it("only rejects on the normalized form — jordan_lee and jordan-lee are different names", async () => {
    const db = createMemoryStore();
    await post(db, "/api/accounts", VALID);
    const sibling = await post(db, "/api/accounts", { ...VALID, email: "other@example.com", username: "jordan-lee" });
    expect(sibling.status).toBe(200);
    expect(db.listAccounts().length).toBe(2);
  });
  it("a username held by a deleted (tombstoned) account is reusable, matching the email rule", async () => {
    const db = createMemoryStore();
    const first = await post(db, "/api/accounts", VALID);
    const rec = db.getAccountByEmail(VALID.email)!;
    db.updateAccount(rec.id, { deletedAt: new Date().toISOString() });
    const reuse = await post(db, "/api/accounts", { ...VALID, email: "new@example.com" });
    expect(reuse.status).toBe(200);
    expect(db.listAccounts().length).toBe(2);
    expect(first.status).toBe(200);
  });
});

describe("POST /api/accounts — race behavior on the in-memory store", () => {
  it("two concurrent signups for the same username yield exactly one winner", async () => {
    const db = createMemoryStore();
    const [a, b] = await Promise.all([
      post(db, "/api/accounts", VALID),
      post(db, "/api/accounts", { ...VALID, email: "other@example.com" }),
    ]);
    const statuses = [a.status, b.status].sort();
    // Deterministic: one 200, one 409 — never two 200s, never two 409s.
    expect(statuses).toEqual([200, 409]);
    expect(db.listAccounts().length).toBe(1);
    expect(db.getAccountByUsername("jordanlee")).toBeDefined();
  });
});

describe("POST /api/profile/username — set/change the handle", () => {
  async function signedInDb() {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "Jordan Lee", username: "jordanlee", email: "runner@example.com", birthdate: "1998-05-05" });
    // Simulate a Supabase-linked account: the link must survive username edits.
    db.updateAccount(rec.id, { supabaseAuthId: "11111111-2222-3333-4444-555555555555" });
    const session = db.createSession(rec.id, "198.51.100.23");
    return { db, rec, cookie: `runlocal_sid=${session.id}` };
  }

  it("requires a signed-in session (401 for guests)", async () => {
    const db = createMemoryStore();
    const fake = await post(db, "/api/profile/username", { username: "new_name" });
    expect(fake.status).toBe(401);
    expect(JSON.parse(fake.body).error).toBe("sign_in_required");
  });
  it("rejects an invalid username with 400 and leaves the account untouched", async () => {
    const { db, rec, cookie } = await signedInDb();
    const fake = await post(db, "/api/profile/username", { username: "not valid!" }, cookie);
    expect(fake.status).toBe(400);
    expect(JSON.parse(fake.body).error).toBe("invalid_username");
    expect(db.getAccount(rec.id)!.username).toBe("jordanlee");
  });
  it("rejects a duplicate with 409 and a clear message; nothing changes", async () => {
    const { db, rec, cookie } = await signedInDb();
    db.createAccount({ name: "Other", username: "taken_name", email: "other@example.com" });
    const fake = await post(db, "/api/profile/username", { username: "Taken_Name" }, cookie);
    expect(fake.status).toBe(409);
    const body = JSON.parse(fake.body) as { error: string; message: string };
    expect(body.error).toBe("username_taken");
    expect(body.message).toMatch(/taken/i);
    expect(db.getAccount(rec.id)!.username).toBe("jordanlee");
  });
  it("updates the username (normalized) and preserves the Supabase auth link", async () => {
    const { db, rec, cookie } = await signedInDb();
    const fake = await post(db, "/api/profile/username", { username: "  JordanRuns  " }, cookie);
    expect(fake.status).toBe(200);
    const payload = JSON.parse(fake.body) as { account: { username: string } };
    expect(payload.account.username).toBe("jordanruns");
    const updated = db.getAccount(rec.id)!;
    expect(updated.username).toBe("jordanruns");
    // Auth linking is untouched by a username edit — the account is not re-homed.
    expect(updated.supabaseAuthId).toBe("11111111-2222-3333-4444-555555555555");
    // Only public fields travel in the response.
    expect(JSON.stringify(fake.body)).not.toContain("11111111-2222-3333-4444-555555555555");
    expect(JSON.stringify(fake.body)).not.toContain("supabase");
  });
  it("re-submitting your own current username is a harmless 200 no-op", async () => {
    const { db, rec, cookie } = await signedInDb();
    const fake = await post(db, "/api/profile/username", { username: "JordanLee" }, cookie);
    expect(fake.status).toBe(200);
    expect(db.getAccount(rec.id)!.username).toBe("jordanlee");
  });
});

describe("legacy accounts (no username) — backward compatibility", () => {
  it("a legacy account is served with username: null and can claim one later", async () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "Legacy", email: "legacy@example.com" });
    const session = db.createSession(rec.id, "198.51.100.23");
    const cookie = `runlocal_sid=${session.id}`;
    const me = await get(db, "/api/me", cookie);
    expect(me.status).toBe(200);
    const payload = JSON.parse(me.body) as { account: { username: string | null; name: string; email: string } };
    expect(payload.account.username).toBeNull();
    expect(payload.account.name).toBe("Legacy");
    expect(payload.account.email).toBe("legacy@example.com");
    const set = await post(db, "/api/profile/username", { username: "legacy_runner" }, cookie);
    expect(set.status).toBe(200);
    expect(db.getAccount(rec.id)!.username).toBe("legacy_runner");
  });
  it("a signup that omits the username is still rejected even with noSession", async () => {
    const db = createMemoryStore();
    const { username: _omit, ...noUsername } = VALID;
    const fake = await post(db, "/api/accounts", { ...noUsername, noSession: true });
    expect(fake.status).toBe(400);
    expect(JSON.parse(fake.body).error).toBe("invalid_username");
    expect(db.listAccounts().length).toBe(0);
  });
});
