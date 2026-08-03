/**
 * HTTP-level tests for the auth-completion contract:
 *
 *  - POST /api/accounts with noSession:true creates a pending account WITHOUT
 *    issuing a Run Local session cookie (the email-confirmation-required
 *    signup path — never claim signed-in status without a Supabase session).
 *  - POST /api/login/check links the verified Supabase identity and CREATES
 *    the matching local pending account when it is missing (fixes the bug
 *    where Supabase auth.users existed but Run Local returned no_account).
 *  - A successful login advances a pending account from the email/code stage
 *    straight to the selfie step (no six-digit code in the primary flow).
 *
 * The server's token introspection is driven by a stubbed global fetch that
 * answers the Supabase /auth/v1/user endpoint; the anon key env vars are set
 * per-test. No provider secret or service_role key is involved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore } from "../src/server/store";
import { displayNameFromEmail } from "../src/server/api";

const ENV = {
  VITE_SUPABASE_URL: "https://abcd1234.supabase.co",
  VITE_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-anon",
};

const IDENTITY = { id: "supabase-user-1", email: "runner@example.com" };

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

function sessionCookie(fake: FakeRes): string | null {
  const header = fake.setCookieHeader;
  if (!header) return null;
  const m = /(?:^|;\s*)runlocal_sid=([^;]+)/.exec(header);
  return m ? m[1] : null;
}

beforeEach(() => {
  Object.assign(process.env, ENV);
  // A fresh Response per call — a Response body can only be consumed once.
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify(IDENTITY), { status: 200 })));
});
afterEach(() => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_ANON_KEY;
  vi.unstubAllGlobals();
});

describe("displayNameFromEmail", () => {
  it("derives a neutral placeholder name from the email local-part", () => {
    expect(displayNameFromEmail("jordan.lee@example.com")).toBe("Jordan Lee");
    expect(displayNameFromEmail("runner@example.com")).toBe("Runner");
    expect(displayNameFromEmail("x@example.com").length).toBeGreaterThan(0);
  });
});

describe("POST /api/accounts — signup completion", () => {
  it("creates a pending account with profile metadata only (no password field anywhere)", async () => {
    const db = createMemoryStore();
    const { res, fake } = makeRes();
    await apiHandler(
      makeReq("POST", "/api/accounts", {
        body: { name: "Jordan Lee", email: "runner@example.com", birthdate: "1998-05-05", phone: "(573) 555-0123" },
      }),
      res,
      db,
    );
    expect(fake.status).toBe(200);
    const payload = JSON.parse(fake.body) as { account: { status: string; phase: string } };
    expect(payload.account.status).toBe("pending");
    expect(payload.account.phase).toBe("email");
    expect(JSON.stringify(fake.body)).not.toContain("password");
    const rec = db.getAccountByEmail("runner@example.com")!;
    expect(rec.phone).toBe("+15735550123");
    expect(rec.birthdate).toBe("1998-05-05");
    expect(sessionCookie(fake)).not.toBeNull();
  });

  it("noSession:true creates the pending account WITHOUT a session cookie", async () => {
    const db = createMemoryStore();
    const { res, fake } = makeRes();
    await apiHandler(
      makeReq("POST", "/api/accounts", {
        body: { name: "Jordan Lee", email: "runner@example.com", birthdate: "1998-05-05", noSession: true },
      }),
      res,
      db,
    );
    expect(fake.status).toBe(200);
    expect(sessionCookie(fake)).toBeNull();
    expect(db.getAccountByEmail("runner@example.com")!.status).toBe("pending");
    expect(db.listAccounts().length).toBe(1);
  });

  it("rejects an underage birthdate even with noSession", async () => {
    const db = createMemoryStore();
    const { res, fake } = makeRes();
    await apiHandler(
      makeReq("POST", "/api/accounts", {
        body: { name: "Kid", email: "kid@example.com", birthdate: "2020-01-01", noSession: true },
      }),
      res,
      db,
    );
    expect(fake.status).toBe(400);
    expect(JSON.parse(fake.body)).toMatchObject({ error: "minimum_age" });
    expect(db.listAccounts().length).toBe(0);
  });
});

describe("POST /api/login/check — link/create on confirmed login", () => {
  it("creates the missing local pending account from the verified token identity (fixes no_account)", async () => {
    const db = createMemoryStore();
    const { res, fake } = makeRes();
    await apiHandler(
      makeReq("POST", "/api/login/check", { body: { token: "verified.token.123" } }),
      res,
      db,
    );
    expect(fake.status).toBe(200);
    const payload = JSON.parse(fake.body) as { status: string; account: { email: string; status: string; phase: string } };
    expect(payload.status).toBe("signed_in");
    expect(payload.account.email).toBe("runner@example.com");
    expect(payload.account.status).toBe("pending");
    // Email ownership was proven by the verified token → straight to selfie.
    expect(payload.account.phase).toBe("selfie");
    expect(sessionCookie(fake)).not.toBeNull();
    const rec = db.getAccountByEmail("runner@example.com")!;
    expect(rec.supabaseAuthId).toBe("supabase-user-1");
    // Repair path never fabricates verification data.
    expect(rec.birthdate).toBeNull();
    expect(rec.phone).toBeNull();
  });

  it("is idempotent: a second login re-links the same identity and keeps one account", async () => {
    const db = createMemoryStore();
    const { res: res1, fake: fake1 } = makeRes();
    await apiHandler(makeReq("POST", "/api/login/check", { body: { token: "t" } }), res1, db);
    const sid1 = sessionCookie(fake1);
    const { res: res2, fake: fake2 } = makeRes();
    await apiHandler(makeReq("POST", "/api/login/check", { body: { token: "t" } }), res2, db);
    expect(fake2.status).toBe(200);
    expect(sessionCookie(fake2)).not.toBeNull();
    expect(sid1).not.toBeNull();
    expect(db.listAccounts().length).toBe(1);
    expect(db.getAccountByEmail("runner@example.com")!.supabaseAuthId).toBe("supabase-user-1");
  });

  it("links an existing pending account and advances email/code phase to selfie", async () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "Jordan Lee", email: "runner@example.com", birthdate: "1998-05-05" });
    expect(rec.phase).toBe("email");
    const { res, fake } = makeRes();
    await apiHandler(makeReq("POST", "/api/login/check", { body: { token: "t" } }), res, db);
    expect(fake.status).toBe(200);
    const updated = db.getAccountByEmail("runner@example.com")!;
    expect(updated.phase).toBe("selfie");
    expect(updated.supabaseAuthId).toBe("supabase-user-1");
    // Real profile metadata is preserved — never overwritten by the repair path.
    expect(updated.name).toBe("Jordan Lee");
    expect(updated.birthdate).toBe("1998-05-05");
  });

  it.each([401, 403])("rejects an unverified token (HTTP %s) and creates nothing", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("invalid", { status })));
    const db = createMemoryStore();
    const { res, fake } = makeRes();
    await apiHandler(makeReq("POST", "/api/login/check", { body: { token: "bad.token" } }), res, db);
    expect(fake.status).toBe(401);
    expect(JSON.parse(fake.body)).toMatchObject({ error: "auth_failed" });
    expect(db.listAccounts().length).toBe(0);
    expect(sessionCookie(fake)).toBeNull();
  });

  it("never trusts a client-supplied email over the verified token identity", async () => {
    // The request body has no email field at all — and even if it did, the
    // server must use the token's identity. A token for another email must
    // not sign into an existing account created under a different address.
    const db = createMemoryStore();
    db.createAccount({ name: "Other", email: "other@example.com" });
    const { res, fake } = makeRes();
    await apiHandler(
      makeReq("POST", "/api/login/check", { body: { token: "t", email: "other@example.com" } }),
      res,
      db,
    );
    expect(fake.status).toBe(200);
    const payload = JSON.parse(fake.body) as { account: { email: string } };
    expect(payload.account.email).toBe("runner@example.com");
    expect(db.getAccountByEmail("other@example.com")!.supabaseAuthId).toBeNull();
    expect(db.getAccountByEmail("runner@example.com")!.supabaseAuthId).toBe("supabase-user-1");
  });
});

describe("POST /api/login/check — recovery session token is a real session", () => {
  it("still rejects an account whose status is rejected", async () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "R", email: "runner@example.com" });
    db.updateAccount(rec.id, { status: "rejected" });
    const { res, fake } = makeRes();
    await apiHandler(makeReq("POST", "/api/login/check", { body: { token: "t" } }), res, db);
    expect(fake.status).toBe(403);
    expect(JSON.parse(fake.body)).toMatchObject({ error: "account_rejected" });
  });
});
