/**
 * Home-city API contract tests — required single home-city at signup, server
 * validation against known city entities (missing vs invalid are distinct,
 * clear errors), persistence on the account record, authenticated changes via
 * /api/profile/city, legacy (null/unset) backward compatibility, and payload
 * safety (cityId is public; nothing sensitive travels with it).
 *
 * Same HTTP harness as username-api.test.ts: real apiHandler against a memory
 * store with a fake IncomingMessage/ServerResponse. None of these endpoints
 * call Supabase, so no fetch stub is needed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, Db } from "../src/server/store";

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

const VALID = { name: "Jordan Lee", username: "jordanlee", email: "runner@example.com", birthdate: "1998-05-05", cityId: "columbia-mo" };

/** Sign up a real account and return the session cookie. */
async function signedUp(db: ReturnType<typeof createMemoryStore>, patch: Record<string, unknown> = {}) {
  const fake = await post(db, "/api/accounts", { ...VALID, ...patch });
  expect(fake.status).toBe(200);
  const sid = fake.setCookieHeader?.match(/^runlocal_sid=([^;]+)/)?.[1];
  expect(sid).toBeTruthy();
  return { cookie: `runlocal_sid=${sid}` };
}

describe("POST /api/accounts — home city is required and validated", () => {
  it("rejects a missing cityId with 400 city_required and creates nothing", async () => {
    const db = createMemoryStore();
    const { cityId: _omit, ...noCity } = VALID;
    const fake = await post(db, "/api/accounts", noCity);
    expect(fake.status).toBe(400);
    const body = JSON.parse(fake.body) as { error: string; message: string };
    expect(body.error).toBe("city_required");
    expect(body.message).toMatch(/home city/i);
    expect(db.listAccounts().length).toBe(0);
  });
  it("rejects a missing cityId even when noSession is set (no account, no session)", async () => {
    const db = createMemoryStore();
    const { cityId: _omit, ...noCity } = VALID;
    const fake = await post(db, "/api/accounts", { ...noCity, noSession: true });
    expect(fake.status).toBe(400);
    expect(JSON.parse(fake.body).error).toBe("city_required");
    expect(db.listAccounts().length).toBe(0);
  });
  it("rejects an unknown city id with 400 invalid_city and creates nothing", async () => {
    const db = createMemoryStore();
    for (const bad of ["atlantis", "columbia", "columbia-mo ", "  columbia-mo  ", "MO", "", "  "]) {
      const fake = await post(db, "/api/accounts", { ...VALID, email: `x-${bad.length}@example.com`, cityId: bad });
      expect(fake.status, `cityId=${JSON.stringify(bad)}`).toBe(400);
      const body = JSON.parse(fake.body) as { error: string; message: string };
      expect(body.error, `cityId=${JSON.stringify(bad)}`).toBe(bad.trim() ? "invalid_city" : "city_required");
      expect(body.message).toMatch(/city/i);
    }
    expect(db.listAccounts().length).toBe(0);
  });
  it("does not silently normalize whitespace at signup (a padded known id is malformed → 400 invalid_city)", async () => {
    const db = createMemoryStore();
    const fake = await post(db, "/api/accounts", { ...VALID, cityId: "  columbia-mo  " });
    expect(fake.status).toBe(400);
    expect(JSON.parse(fake.body).error).toBe("invalid_city");
    expect(db.listAccounts().length).toBe(0);
  });
  it("persists the chosen cityId on the account and returns it in the public payload", async () => {
    const db = createMemoryStore();
    const fake = await post(db, "/api/accounts", VALID);
    expect(fake.status).toBe(200);
    const payload = JSON.parse(fake.body) as { account: { cityId: string } };
    expect(payload.account.cityId).toBe("columbia-mo");
    expect(db.getAccountByEmail(VALID.email)!.cityId).toBe("columbia-mo");
  });
  it("a known-but-not-yet-live city entity is accepted (validation is entity-driven, never hardcoded to Columbia)", async () => {
    const db = createMemoryStore();
    const fake = await post(db, "/api/accounts", { ...VALID, email: "stl@example.com", username: "stl_runner", cityId: "stl-mo" });
    expect(fake.status).toBe(200);
    expect(JSON.parse(fake.body).account.cityId).toBe("stl-mo");
    expect(db.getAccountByEmail("stl@example.com")!.cityId).toBe("stl-mo");
  });
  it("the signup payload carries cityId but never sensitive fields", async () => {
    const db = createMemoryStore();
    const fake = await post(db, "/api/accounts", { ...VALID, phone: "+15735550123" });
    expect(fake.status).toBe(200);
    const raw = JSON.stringify(fake.body);
    expect(raw).toContain("columbia-mo");
    expect(raw).not.toContain("573555");
    expect(raw).not.toContain("supabaseAuthId");
    expect(raw).not.toContain("selfie");
  });
});

describe("/api/me — home city is public account identity", () => {
  it("returns the chosen cityId to the signed-in account", async () => {
    const db = createMemoryStore();
    const { cookie } = await signedUp(db);
    const me = await get(db, "/api/me", cookie);
    expect(me.status).toBe(200);
    const payload = JSON.parse(me.body) as { account: { cityId: string | null } };
    expect(payload.account.cityId).toBe("columbia-mo");
  });
});

describe("POST /api/profile/city — authenticated home-city change", () => {
  it("requires a signed-in session (401 for guests)", async () => {
    const db = createMemoryStore();
    const fake = await post(db, "/api/profile/city", { cityId: "columbia-mo" });
    expect(fake.status).toBe(401);
    expect(JSON.parse(fake.body).error).toBe("sign_in_required");
  });
  it("rejects a missing cityId with 400 city_required and leaves the account untouched", async () => {
    const db = createMemoryStore();
    const { cookie } = await signedUp(db);
    const fake = await post(db, "/api/profile/city", {}, cookie);
    expect(fake.status).toBe(400);
    expect(JSON.parse(fake.body).error).toBe("city_required");
    expect(db.getAccountByEmail(VALID.email)!.cityId).toBe("columbia-mo");
  });
  it("rejects an unknown city id with 400 invalid_city and leaves the account untouched", async () => {
    const db = createMemoryStore();
    const { cookie } = await signedUp(db);
    const fake = await post(db, "/api/profile/city", { cityId: "not-a-city" }, cookie);
    expect(fake.status).toBe(400);
    expect(JSON.parse(fake.body).error).toBe("invalid_city");
    expect(db.getAccountByEmail(VALID.email)!.cityId).toBe("columbia-mo");
  });
  it("changes the home city, persists it, and returns the updated public account", async () => {
    const db = createMemoryStore();
    const { cookie } = await signedUp(db);
    const fake = await post(db, "/api/profile/city", { cityId: "stl-mo" }, cookie);
    expect(fake.status).toBe(200);
    const payload = JSON.parse(fake.body) as { account: { cityId: string } };
    expect(payload.account.cityId).toBe("stl-mo");
    expect(db.getAccountByEmail(VALID.email)!.cityId).toBe("stl-mo");
    // Only public fields travel — never the session or sensitive records.
    expect(JSON.stringify(fake.body)).not.toContain("supabase");
    expect(JSON.stringify(fake.body)).not.toContain("selfie");
  });
  it("re-submitting your own current city is a harmless 200 no-op", async () => {
    const db = createMemoryStore();
    const { cookie } = await signedUp(db);
    const fake = await post(db, "/api/profile/city", { cityId: "columbia-mo" }, cookie);
    expect(fake.status).toBe(200);
    expect(db.getAccountByEmail(VALID.email)!.cityId).toBe("columbia-mo");
  });
  it("normalizes surrounding whitespace on the id before validating", async () => {
    const db = createMemoryStore();
    const { cookie } = await signedUp(db);
    const fake = await post(db, "/api/profile/city", { cityId: "  columbia-mo  " }, cookie);
    expect(fake.status).toBe(200);
    expect(db.getAccountByEmail(VALID.email)!.cityId).toBe("columbia-mo");
  });
});

describe("legacy accounts (no home city) — backward compatibility", () => {
  it("serves cityId: null for accounts created before home cities existed and lets them choose one", async () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "Legacy", username: "legacy_runner", email: "legacy@example.com" });
    expect(rec.cityId).toBeNull();
    const session = db.createSession(rec.id, "198.51.100.23");
    const cookie = `runlocal_sid=${session.id}`;
    const me = await get(db, "/api/me", cookie);
    expect(me.status).toBe(200);
    const payload = JSON.parse(me.body) as { account: { cityId: string | null; name: string; email: string } };
    expect(payload.account.cityId).toBeNull();
    expect(payload.account.name).toBe("Legacy");
    expect(payload.account.email).toBe("legacy@example.com");
    // The legacy account can claim a home city through the same endpoint.
    const set = await post(db, "/api/profile/city", { cityId: "columbia-mo" }, cookie);
    expect(set.status).toBe(200);
    expect(db.getAccount(rec.id)!.cityId).toBe("columbia-mo");
  });
  it("survives a disk round-trip (db.json persists cityId, missing field loads as null)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runlocal-city-"));
    try {
      const a = new Db({ dataDir: dir });
      await a.load();
      const rec = a.createAccount({ name: "Disk", email: "disk@example.com", cityId: "columbia-mo" });
      expect(rec.cityId).toBe("columbia-mo");
      await a.persist();

      const b = new Db({ dataDir: dir });
      await b.load();
      expect(b.getAccount(rec.id)!.cityId).toBe("columbia-mo");

      // Legacy record: strip the field out of the persisted file to simulate an
      // account created before home cities existed — it must load as null.
      const file = join(dir, "db.json");
      const { readFile, writeFile } = await import("node:fs/promises");
      const db = JSON.parse(await readFile(file, "utf8")) as { accounts: (Record<string, unknown> & { id: string })[] };
      const legacyId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      db.accounts.push({
        id: legacyId,
        name: "Old",
        email: "old@example.com",
        username: null,
        status: "pending",
        phase: "email",
        role: "runner",
        requestedRole: null,
        profilePhotoRef: null,
        supabaseAuthId: null,
        phone: null,
        phoneVerified: false,
        phoneVerifiedAt: null,
        birthdate: null,
        selfieRef: null,
        selfieCapturedAt: null,
        signupIp: null,
        signupAt: "2026-01-01T00:00:00.000Z",
        lastActivityAt: "2026-01-01T00:00:00.000Z",
        loginIps: [],
        verifiedAt: null,
        deletedAt: null,
        purgeAt: null,
        purgedAt: null,
        retentionYears: 3,
        suspended: false,
        suspendedUntil: null,
        suspensionReason: null,
        // deliberately NO cityId field — the pre-home-city shape
      });
      await writeFile(file, JSON.stringify(db, null, 2), "utf8");

      const c = new Db({ dataDir: dir });
      await c.load();
      expect(c.getAccount(legacyId)!.cityId).toBeNull();
      expect(c.getAccount(rec.id)!.cityId).toBe("columbia-mo");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

afterEach(() => {
  // No global state to reset — memory stores are per-test.
});
