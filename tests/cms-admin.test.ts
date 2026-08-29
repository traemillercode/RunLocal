/**
 * Global Admin CMS — endpoint-level tests (no jsdom; node environment).
 *
 * Covers authorization (key admin + owner, reason gating), settings
 * persistence & defaults, validation, city CRUD/deactivation, audit writes,
 * payload safety (no secrets / no data URLs), protected image-ref handling,
 * and provider enabled/disabled enforcement across the connection API.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, Db } from "../src/server/store";
import { ADMIN_KEY_VAR, ADMIN_EMAIL_VAR } from "../src/server/admin";
import { DEFAULT_OWNER_EMAIL, OWNER_EMAIL_VAR } from "../src/server/owner";
import { DEFAULT_SETTINGS, seedCmsCities } from "../src/server/cms";

const KEY = "test-cms-admin-key-1";
const ADMIN_EMAIL = "cms@runlocal.app";
const REASON = "routine site administration";
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// ------------------------------------------------------------ HTTP harness
function makeReq(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; reason?: string } = {},
): IncomingMessage {
  const raw = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const headers: Record<string, string> = { "x-forwarded-proto": "https" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.reason) headers["x-audit-reason"] = opts.reason;
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
  contentType: string | undefined;
}
function makeRes(): { res: ServerResponse; fake: FakeRes } {
  const fake: FakeRes = { status: 200, body: "", contentType: undefined };
  const res = {
    writeHead(status: number, headers?: Record<string, string | string[]>) {
      fake.status = status;
      if (headers) fake.contentType = typeof headers["content-type"] === "string" ? headers["content-type"] : undefined;
      return res;
    },
    setHeader(name: string, value: string | string[]) {
      if (name.toLowerCase() === "content-type" && typeof value === "string") fake.contentType = value;
      return res;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) fake.body += typeof chunk === "string" ? chunk : Buffer.from(chunk as Buffer).toString("binary");
      return res;
    },
  } as unknown as ServerResponse;
  return { res, fake };
}
async function call(db: Db, method: string, path: string, opts: { body?: unknown; cookie?: string; reason?: string } = {}) {
  const { res, fake } = makeRes();
  await apiHandler(makeReq(method, path, opts), res, db);
  let parsed: unknown = {};
  try {
    parsed = fake.body ? JSON.parse(fake.body) : {};
  } catch {
    // binary body (image bytes) — leave parsed empty
  }
  return { status: fake.status, body: parsed as any, raw: fake.body, contentType: fake.contentType };
}
/** Key-admin session cookie. */
function adminCookie(db: Db): string {
  const session = db.createSession("__admin__", "198.51.100.23");
  return `runlocal_admin=${session.id}`;
}
/** Signed-in account session cookie (any email). */
function userCookie(db: Db, email: string, status: "verified" | "pending" = "verified"): string {
  const rec = db.createAccount({ name: "Runner", email, username: "runner1" });
  db.updateAccount(rec.id, { status });
  const session = db.createSession(rec.id, "198.51.100.23");
  return `runlocal_sid=${session.id}`;
}
/** Owner (super-admin) session cookie — the signed-in owner path. */
function ownerCookie(db: Db): string {
  return userCookie(db, DEFAULT_OWNER_EMAIL);
}

describe("Global Admin CMS — authorization", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
    delete process.env[OWNER_EMAIL_VAR];
  });

  it("rejects an unauthenticated settings read with 401", async () => {
    const db = createMemoryStore();
    const r = await call(db, "GET", "/api/admin/cms/settings", { reason: REASON });
    expect(r.status).toBe(401);
    expect((r.body as { error: string }).error).toBe("unauthorized");
  });

  it("rejects a signed-in non-owner runner with 401", async () => {
    const db = createMemoryStore();
    const r = await call(db, "GET", "/api/admin/cms/settings", { cookie: userCookie(db, "runner@example.com"), reason: REASON });
    expect(r.status).toBe(401);
  });

  it("rejects an admin action without a reason (400) and writes no audit", async () => {
    const db = createMemoryStore();
    const r = await call(db, "GET", "/api/admin/cms/settings", { cookie: adminCookie(db) });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe("reason_required");
    expect(db.listAudit(10)).toHaveLength(0);
  });

  it("allows the key admin with a reason and returns settings, cities, and integrations", async () => {
    const db = createMemoryStore();
    seedCmsCities(db);
    const r = await call(db, "GET", "/api/admin/cms/settings", { cookie: adminCookie(db), reason: REASON });
    expect(r.status).toBe(200);
    expect(r.body.settings.title).toBe(DEFAULT_SETTINGS.title);
    expect(r.body.cities.some((c: { id: string }) => c.id === "columbia-mo")).toBe(true);
    expect(r.body.integrations.map((i: { provider: string }) => i.provider)).toEqual(["strava", "garmin", "coros", "suunto"]);
    // Only Strava is offered. Garmin/Coros/Suunto are deliberately "coming
    // soon" — the roadmap position is import, don't rebuild, and direct
    // connections to those three were never shipped. This previously asserted
    // every provider was offered, which was true of an older default set.
    const offered = Object.fromEntries(r.body.integrations.map((i: { provider: string; offered: boolean }) => [i.provider, i.offered]));
    expect(offered.strava).toBe(true);
    expect(offered.garmin).toBe(false);
    expect(offered.coros).toBe(false);
    expect(offered.suunto).toBe(false);
  });

  it("allows the signed-in owner without the admin key configured", async () => {
    delete process.env[ADMIN_KEY_VAR];
    const db = createMemoryStore();
    const r = await call(db, "GET", "/api/admin/cms/settings", { cookie: ownerCookie(db), reason: REASON });
    expect(r.status).toBe(200);
  });
});

describe("Global Admin CMS — settings persistence & defaults", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
  });

  it("serves defaults before anything is saved", async () => {
    const db = createMemoryStore();
    const r = await call(db, "GET", "/api/config");
    expect(r.status).toBe(200);
    expect(r.body.settings.title).toBe("Kimbio"); // rebrand: was "Run Local"
    expect(r.body.settings.primary).toBe("#0b2b22");
    expect(r.body.settings.bottomNav).toEqual(["home", "races", "clubs", "forum"]);
    // Asserts DEFAULT_SETTINGS.providers as actually shipped: only Strava is
    // enabled. The other three were flipped to false when direct connections
    // were dropped in favour of import-don't-rebuild.
    expect(r.body.settings.providers).toEqual({ strava: true, garmin: false, coros: false, suunto: false });
  });

  it("persists a settings update and returns it on the next read", async () => {
    const db = createMemoryStore();
    const cookie = adminCookie(db);
    const save = await call(db, "POST", "/api/admin/cms/settings", {
      cookie,
      reason: REASON,
      body: { title: "Mizzou Running", tagline: "Tiger trails.", primary: "#123456", announcement: { text: "Big race week!", link: "https://example.com/races" } },
    });
    expect(save.status).toBe(200);
    expect(save.body.settings.title).toBe("Mizzou Running");
    const read = await call(db, "GET", "/api/admin/cms/settings", { cookie, reason: REASON });
    expect(read.body.settings.title).toBe("Mizzou Running");
    expect(read.body.settings.tagline).toBe("Tiger trails.");
    expect(read.body.settings.primary).toBe("#123456");
    expect(read.body.settings.announcement).toEqual({ text: "Big race week!", link: "https://example.com/races" });
    // Unrelated fields keep their defaults
    expect(read.body.settings.accent).toBe(DEFAULT_SETTINGS.accent);
    expect(read.body.settings.providers.strava).toBe(true);
  });

  it("merges records (strings/tags/providers) and replaces scalars on partial updates", async () => {
    const db = createMemoryStore();
    const cookie = adminCookie(db);
    await call(db, "POST", "/api/admin/cms/settings", { cookie, reason: REASON, body: { strings: { a: "1" }, tags: { runTypes: ["Social run"] }, providers: { strava: false } } });
    const r = await call(db, "POST", "/api/admin/cms/settings", { cookie, reason: REASON, body: { strings: { b: "2" }, tags: { runTypes: ["Track"] }, providers: { garmin: false } } });
    expect(r.body.settings.strings).toEqual({ a: "1", b: "2" });
    expect(r.body.settings.tags.runTypes).toEqual(["Track"]);
    expect(r.body.settings.providers.strava).toBe(false);
    expect(r.body.settings.providers.garmin).toBe(false);
    expect(r.body.settings.providers.coros).toBe(true);
  });

  it("persists across Db instances on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cms-test-"));
    try {
      const db1 = new Db({ dataDir: dir });
      await db1.load();
      const r = await call(db1, "POST", "/api/admin/cms/settings", {
        cookie: adminCookie(db1),
        reason: REASON,
        body: { title: "Disk-Persisted Title" },
      });
      expect(r.status).toBe(200);
      const db2 = new Db({ dataDir: dir });
      await db2.load();
      const read = await call(db2, "GET", "/api/admin/cms/settings", { cookie: adminCookie(db2), reason: REASON });
      expect(read.body.settings.title).toBe("Disk-Persisted Title");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Global Admin CMS — validation", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
  });
  const cookie = (db: Db) => adminCookie(db);

  it.each([
    [{ primary: "red" }, "invalid_color"],
    [{ accent: "#12" }, "invalid_color"],
    [{ surface: "rgb(1,2,3)" }, "invalid_color"],
  ])("rejects bad colors %j", async (body, code) => {
    const db = createMemoryStore();
    const r = await call(db, "POST", "/api/admin/cms/settings", { cookie: cookie(db), reason: REASON, body });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe(code);
  });

  it("rejects non-https announcement links", async () => {
    const db = createMemoryStore();
    const r = await call(db, "POST", "/api/admin/cms/settings", {
      cookie: cookie(db),
      reason: REASON,
      body: { announcement: { text: "hi", link: "http://insecure.example" } },
    });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe("invalid_url");
  });

  it("rejects announcement text that is missing or too long", async () => {
    const db = createMemoryStore();
    const empty = await call(db, "POST", "/api/admin/cms/settings", { cookie: cookie(db), reason: REASON, body: { announcement: { text: "   " } } });
    expect(empty.status).toBe(400);
    expect((empty.body as { error: string }).error).toBe("invalid_announcement");
    const long = await call(db, "POST", "/api/admin/cms/settings", { cookie: cookie(db), reason: REASON, body: { announcement: { text: "x".repeat(301) } } });
    expect(long.status).toBe(400);
    expect((long.body as { error: string }).error).toBe("invalid_announcement");
  });

  it.each([
    [{ bottomNav: ["home", "spam"] }, "invalid_bottom_nav"],
    [{ bottomNav: ["home", "home"] }, "invalid_bottom_nav"],
    [{ bottomNav: "home" }, "invalid_bottom_nav"],
  ])("rejects bad bottom navigation %j", async (body, code) => {
    const db = createMemoryStore();
    const r = await call(db, "POST", "/api/admin/cms/settings", { cookie: cookie(db), reason: REASON, body });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe(code);
  });

  it.each([
    [{ providers: { strava: "yes" } }, "invalid_provider_flags"],
    [{ providers: { unknown: true } }, "invalid_provider_flags"],
  ])("rejects bad provider flags %j", async (body, code) => {
    const db = createMemoryStore();
    const r = await call(db, "POST", "/api/admin/cms/settings", { cookie: cookie(db), reason: REASON, body });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe(code);
  });

  it.each([
    [{ tags: { runTypes: [42] } }, "invalid_tags"],
    [{ tags: { bogus: ["x"] } }, "invalid_tags"],
    [{ tags: { runTypes: ["x".repeat(61)] } }, "invalid_tags"],
  ])("rejects bad tag lists %j", async (body, code) => {
    const db = createMemoryStore();
    const r = await call(db, "POST", "/api/admin/cms/settings", { cookie: cookie(db), reason: REASON, body });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe(code);
  });

  it.each([
    [{ strings: { k: 42 } }, "invalid_strings"],
    [{ strings: { ["x".repeat(61)]: "v" } }, "invalid_strings"],
  ])("rejects bad content strings %j", async (body, code) => {
    const db = createMemoryStore();
    const r = await call(db, "POST", "/api/admin/cms/settings", { cookie: cookie(db), reason: REASON, body });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe(code);
  });

  it("rejects an empty title and an oversized ref", async () => {
    const db = createMemoryStore();
    const t = await call(db, "POST", "/api/admin/cms/settings", { cookie: cookie(db), reason: REASON, body: { title: "   " } });
    expect(t.status).toBe(400);
    expect((t.body as { error: string }).error).toBe("invalid_text");
    const ref = await call(db, "POST", "/api/admin/cms/settings", { cookie: cookie(db), reason: REASON, body: { logoRef: "x".repeat(250) } });
    expect(ref.status).toBe(400);
    expect((ref.body as { error: string }).error).toBe("invalid_ref");
  });

  it("rejects an invalid city and a duplicate slug", async () => {
    const db = createMemoryStore();
    const cookie = adminCookie(db);
    const bad = await call(db, "POST", "/api/admin/cms/city", { cookie, reason: REASON, body: { name: "Bad", state: "MO", slug: "Bad Slug!" } });
    expect(bad.status).toBe(400);
    expect((bad.body as { error: string }).error).toBe("invalid_city");
    const ok = await call(db, "POST", "/api/admin/cms/city", { cookie, reason: REASON, body: { name: "Rolla", state: "MO", slug: "rolla-mo" } });
    expect(ok.status).toBe(200);
    const dup = await call(db, "POST", "/api/admin/cms/city", { cookie, reason: REASON, body: { name: "Rolla II", state: "MO", slug: "rolla-mo" } });
    expect(dup.status).toBe(400);
    expect((dup.body as { error: string }).error).toBe("duplicate_slug");
  });
});

describe("Global Admin CMS — city CRUD & deactivation", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
    delete process.env[OWNER_EMAIL_VAR];
  });

  it("creates a city and lists it in the admin overview", async () => {
    const db = createMemoryStore();
    const cookie = adminCookie(db);
    const r = await call(db, "POST", "/api/admin/cms/city", { cookie, reason: REASON, body: { name: "Rolla", state: "MO", slug: "rolla-mo", accent: "#123456" } });
    expect(r.status).toBe(200);
    expect(r.body.city.status).toBe("active");
    expect(r.body.city.accent).toBe("#123456");
    const overview = await call(db, "GET", "/api/admin/cms/settings", { cookie, reason: REASON });
    expect(overview.body.cities.some((c: { slug: string }) => c.slug === "rolla-mo")).toBe(true);
  });

  it("updates an existing city in place", async () => {
    const db = createMemoryStore();
    seedCmsCities(db);
    const cookie = adminCookie(db);
    const r = await call(db, "POST", "/api/admin/cms/city", {
      cookie,
      reason: REASON,
      body: { id: "columbia-mo", name: "Columbia", state: "MO", slug: "columbia-mo", accent: "#101010", status: "active" },
    });
    expect(r.status).toBe(200);
    expect(r.body.city.id).toBe("columbia-mo");
    expect(r.body.city.accent).toBe("#101010");
    expect(db.getCity("columbia-mo")?.accent).toBe("#101010");
  });

  it("deactivates a city: gone from public config, blocked for signups, and reactivatable", async () => {
    const db = createMemoryStore();
    const cookie = adminCookie(db);
    const created = await call(db, "POST", "/api/admin/cms/city", { cookie, reason: REASON, body: { name: "Springfield", state: "MO", slug: "springfield-mo" } });
    const id = created.body.city.id as string;
    const deact = await call(db, "POST", `/api/admin/cms/city/${id}/deactivate`, { cookie, reason: REASON });
    expect(deact.status).toBe(200);
    expect(deact.body.city.status).toBe("inactive");
    const config = await call(db, "GET", "/api/config");
    // Deactivated cities stay VISIBLE in the public registry (history
    // retained) but are no longer enterable — presence and enterability are
    // independent, decided by status.
    expect(config.body.cities.find((c: { id: string }) => c.id === id)?.status).toBe("inactive");
    // New signups cannot choose an inactive CMS city…
    const signup = await call(db, "POST", "/api/accounts", {
      body: { name: "New Runner", username: "newrunner", email: "new@example.com", birthdate: "1998-01-01", cityId: id },
    });
    expect(signup.status).toBe(400);
    expect((signup.body as { error: string }).error).toBe("city_inactive");
    // …but reactivating makes it public and selectable again.
    const react = await call(db, "POST", "/api/admin/cms/city", { cookie, reason: REASON, body: { id, name: "Springfield", state: "MO", slug: "springfield-mo", status: "active" } });
    expect(react.status).toBe(200);
    const config2 = await call(db, "GET", "/api/config");
    expect(config2.body.cities.some((c: { id: string }) => c.id === id)).toBe(true);
    const signup2 = await call(db, "POST", "/api/accounts", {
      body: { name: "New Runner", username: "newrunner2", email: "new2@example.com", birthdate: "1998-01-01", cityId: id },
    });
    expect(signup2.status).toBe(200);
  });

  it("deactivating an unknown city returns 404", async () => {
    const db = createMemoryStore();
    const r = await call(db, "POST", "/api/admin/cms/city/nope-123/deactivate", { cookie: adminCookie(db), reason: REASON });
    expect(r.status).toBe(404);
  });

  it("seeds known city entities once, preserving admin state", async () => {
    const db = createMemoryStore();
    seedCmsCities(db);
    seedCmsCities(db); // idempotent
    expect(db.listCities().length).toBe(5);
    expect(db.getCity("columbia-mo")?.status).toBe("active");
    expect(db.getCity("stl-mo")?.status).toBe("coming_soon"); // non-live placeholder — visible but not enterable
    const config = await call(db, "GET", "/api/config");
    // The public registry serves every lifecycle state (active / coming_soon);
    // enterability is decided by status, not by presence in the list.
    expect(config.body.cities.map((c: { id: string }) => c.id).sort()).toEqual(["columbia-mo", "jc-mo", "kc-mo", "springfield-mo", "stl-mo"]);
  });
});

describe("Global Admin CMS — audits", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
  });

  it("writes an admin.cms_settings audit entry with reason, admin, and IP", async () => {
    const db = createMemoryStore();
    await call(db, "POST", "/api/admin/cms/settings", { cookie: adminCookie(db), reason: "updating the tagline", body: { tagline: "New tagline" } });
    const entry = db.listAudit(10).find((a) => a.action === "admin.cms_settings");
    expect(entry).toBeTruthy();
    expect(entry!.reason).toBe("updating the tagline");
    expect(entry!.admin).toBe(ADMIN_EMAIL);
    expect(entry!.targetId).toBeNull();
    expect(entry!.ip).toBe("198.51.100.23");
  });

  it("writes an admin.cms_city audit entry targeting the city id (creates and updates)", async () => {
    const db = createMemoryStore();
    const cookie = adminCookie(db);
    const r = await call(db, "POST", "/api/admin/cms/city", { cookie, reason: "adding a launch city", body: { name: "Rolla", state: "MO", slug: "rolla-mo" } });
    const id = r.body.city.id as string;
    const create = db.listAudit(10).find((a) => a.action === "admin.cms_city");
    expect(create).toBeTruthy();
    expect(create!.targetId).toBe(id);
    // Updating the same city audits with the same target id.
    await call(db, "POST", "/api/admin/cms/city", { cookie, reason: "renaming the city", body: { id, name: "Rolla", state: "MO", slug: "rolla-mo", accent: "#123456" } });
    const update = db.listAudit(10).find((a) => a.action === "admin.cms_city" && a.reason === "renaming the city");
    expect(update!.targetId).toBe(id);
  });

  it("writes one audit entry per deactivation with the city as target", async () => {
    const db = createMemoryStore();
    const created = await call(db, "POST", "/api/admin/cms/city", { cookie: adminCookie(db), reason: "adding a city", body: { name: "Rolla", state: "MO", slug: "rolla-mo" } });
    const id = created.body.city.id as string;
    await call(db, "POST", `/api/admin/cms/city/${id}/deactivate`, { cookie: adminCookie(db), reason: "pausing the market" });
    const deact = db.listAudit(10).filter((a) => a.action === "admin.cms_city");
    expect(deact).toHaveLength(2);
    expect(deact[0].targetId).toBe(id); // newest first — the deactivation
    expect(deact[0].reason).toBe("pausing the market");
    expect(deact[1].targetId).toBe(id); // the create
  });

  it("failed validation returns 400, leaves settings unchanged, and still records the authorized attempt", async () => {
    const db = createMemoryStore();
    await call(db, "POST", "/api/admin/cms/settings", { cookie: adminCookie(db), reason: REASON, body: { primary: "nope" } });
    // The attempt was authorized (reason present) so it IS audited, but nothing changed.
    const entry = db.listAudit(10).find((a) => a.action === "admin.cms_settings");
    expect(entry).toBeTruthy();
    expect(db.getSettings(DEFAULT_SETTINGS).primary).toBe(DEFAULT_SETTINGS.primary);
  });

  it("reads are audited too (admin.cms_settings on GET)", async () => {
    const db = createMemoryStore();
    await call(db, "GET", "/api/admin/cms/settings", { cookie: adminCookie(db), reason: "reviewing current settings" });
    const entry = db.listAudit(10).find((a) => a.action === "admin.cms_settings");
    expect(entry).toBeTruthy();
    expect(entry!.reason).toBe("reviewing current settings");
  });
});

describe("Global Admin CMS — payload safety & image refs", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
  });

  it("settings payloads never contain secrets keys or data URLs", async () => {
    const db = createMemoryStore();
    const r = await call(db, "GET", "/api/admin/cms/settings", { cookie: adminCookie(db), reason: REASON });
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain("secrets");
    expect(raw).not.toContain("data:image");
    expect(raw).not.toContain("base64");
  });

  it("stores an upload under an opaque ref and never returns the bytes", async () => {
    const db = createMemoryStore();
    const r = await call(db, "POST", "/api/admin/cms/upload", { cookie: adminCookie(db), reason: REASON, body: { ref: PNG_1PX } });
    expect(r.status).toBe(200);
    const ref = r.body.ref as string;
    expect(ref).toMatch(/^cms-[a-f0-9]+\.png$/);
    expect(JSON.stringify(r.body)).not.toContain("iVBOR");
    const bytes = await db.readRef(ref);
    expect(bytes).not.toBeNull();
    expect(bytes!.length).toBeGreaterThan(0);
  });

  it("rejects malformed and oversize uploads", async () => {
    const db = createMemoryStore();
    const bad = await call(db, "POST", "/api/admin/cms/upload", { cookie: adminCookie(db), reason: REASON, body: { ref: "https://example.com/logo.png" } });
    expect(bad.status).toBe(400);
    expect((bad.body as { error: string }).error).toBe("invalid_image");
    // ~4.1MB decoded (fits under the 6MB JSON cap) → decoded-size rejection.
    const bigEnough = "data:image/png;base64," + "A".repeat(Math.ceil((4 * 1024 * 1024 + 100 * 1024) * 1.34));
    const big = await call(db, "POST", "/api/admin/cms/upload", { cookie: adminCookie(db), reason: REASON, body: { ref: bigEnough } });
    expect(big.status).toBe(400);
    expect((big.body as { error: string }).error).toBe("image_too_large");
    // >6MB raw body → rejected at the JSON body cap before decode.
    const huge = "data:image/png;base64," + "A".repeat(6 * 1024 * 1024);
    const tooBig = await call(db, "POST", "/api/admin/cms/upload", { cookie: adminCookie(db), reason: REASON, body: { ref: huge } });
    expect(tooBig.status).toBe(413);
    expect((tooBig.body as { error: string }).error).toBe("body_too_large");
  });

  it("only serves publicly the refs referenced by the public config", async () => {
    const db = createMemoryStore();
    const cookie = adminCookie(db);
    const up = await call(db, "POST", "/api/admin/cms/upload", { cookie, reason: REASON, body: { ref: PNG_1PX } });
    const ref = up.body.ref as string;
    // Not referenced yet → public route 404s.
    const before = await call(db, "GET", `/api/cms/refs/${ref}`);
    expect(before.status).toBe(404);
    // Reference it as the logo → public route serves image bytes.
    await call(db, "POST", "/api/admin/cms/settings", { cookie, reason: REASON, body: { logoRef: ref } });
    const after = await call(db, "GET", `/api/cms/refs/${ref}`);
    expect(after.status).toBe(200);
    expect(after.contentType).toBe("image/png");
    expect(after.raw.length).toBeGreaterThan(0);
    // A made-up ref never resolves.
    const fake = await call(db, "GET", "/api/cms/refs/cms-abcdef1234567890.png");
    expect(fake.status).toBe(404);
  });

  it("serves unreferenced refs only via the audited admin route", async () => {
    const db = createMemoryStore();
    const cookie = adminCookie(db);
    const up = await call(db, "POST", "/api/admin/cms/upload", { cookie, reason: REASON, body: { ref: PNG_1PX } });
    const ref = up.body.ref as string;
    const anon = await call(db, "GET", `/api/admin/cms/refs/${ref}`, { reason: REASON });
    expect(anon.status).toBe(401);
    const admin = await call(db, "GET", `/api/admin/cms/refs/${ref}`, { cookie, reason: REASON });
    expect(admin.status).toBe(200);
    expect(admin.contentType).toBe("image/png");
    const entry = db.listAudit(10).find((a) => a.targetId === ref);
    expect(entry?.action).toBe("admin.cms_settings");
  });
});

/**
 * SKIPPED — tests a REMOVED endpoint, not a stale assertion.
 *
 * These call /api/connections/strava and /api/connections/strava/disconnect,
 * neither of which exists anywhere in src/ any more; the provider-connection
 * route was removed (see KIMBIO-STRUCTURAL-AUDIT.md §8).
 *
 * Skipped rather than deleted because roadmap 6.1 brings provider integration
 * back as READ-ONLY IMPORT — Apple Health first, then Strava/Garmin — and this
 * block is the surviving written spec for how CMS enable/disable gates a
 * connection attempt. Deleting it would produce the same green suite and throw
 * away a design we will want.
 *
 * Only this block is skipped. The other six describe blocks in this file cover
 * live CMS behaviour and still run.
 *
 * UNSKIP WHEN: 6.1 lands a connection endpoint. The CMS gating contract
 * (403 provider_disabled, and reaching the normal configuration check when
 * enabled) should hold for import exactly as it did for direct connection.
 */
describe.skip("Global Admin CMS — provider enabled/disabled enforcement (removed route; see roadmap 6.1)", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = KEY;
    process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;
    delete process.env.STRAVA_REDIRECT_URI;
  });

  it("rejects connections to a disabled provider with 403 provider_disabled", async () => {
    const db = createMemoryStore();
    const cookie = adminCookie(db);
    await call(db, "POST", "/api/admin/cms/settings", { cookie, reason: REASON, body: { providers: { strava: false } } });
    const r = await call(db, "GET", "/api/connections/strava", { cookie: userCookie(db, "runner@example.com") });
    expect(r.status).toBe(403);
    expect((r.body as { error: string }).error).toBe("provider_disabled");
  });

  it("rejects manual activity posting with a disabled provider", async () => {
    const db = createMemoryStore();
    const cookie = adminCookie(db);
    await call(db, "POST", "/api/admin/cms/settings", { cookie, reason: REASON, body: { providers: { garmin: false } } });
    const r = await call(db, "POST", "/api/activity/manual", {
      cookie: userCookie(db, "runner@example.com"),
      body: { provider: "garmin", activity: { type: "run", distanceMeters: 5000, durationSeconds: 1800 } },
    });
    expect(r.status).toBe(403);
    expect((r.body as { error: string }).error).toBe("provider_disabled");
  });

  it("enabled providers still reach the normal configuration check (503 in tests, no env)", async () => {
    const db = createMemoryStore();
    const r = await call(db, "GET", "/api/connections/strava", { cookie: userCookie(db, "runner@example.com") });
    expect(r.status).toBe(503);
    expect((r.body as { error: string }).error).toBe("provider_not_configured");
  });

  it("manual posting with an enabled provider succeeds", async () => {
    const db = createMemoryStore();
    const r = await call(db, "POST", "/api/activity/manual", {
      cookie: userCookie(db, "runner@example.com"),
      body: { provider: "strava", activity: { type: "run", distanceMeters: 5000, durationSeconds: 1800 } },
    });
    expect(r.status).toBe(200);
    expect(r.body.card.distanceMeters).toBe(5000);
  });

  it("disconnect remains available for a disabled provider (cleanup path)", async () => {
    const db = createMemoryStore();
    const cookie = adminCookie(db);
    const user = userCookie(db, "runner@example.com");
    await call(db, "POST", "/api/admin/cms/settings", { cookie, reason: REASON, body: { providers: { strava: false } } });
    const r = await call(db, "POST", "/api/connections/strava/disconnect", { cookie: user });
    expect(r.status).toBe(200);
  });

  it("public config reports offered=false and names of missing vars only", async () => {
    const db = createMemoryStore();
    const cookie = adminCookie(db);
    await call(db, "POST", "/api/admin/cms/settings", { cookie, reason: REASON, body: { providers: { strava: false } } });
    const r = await call(db, "GET", "/api/config");
    const strava = r.body.integrations.find((i: { provider: string }) => i.provider === "strava");
    expect(strava.offered).toBe(false);
    expect(strava.configured).toBe(false);
    expect(strava.missing).toContain("STRAVA_CLIENT_ID");
    // no values ever leak
    expect(JSON.stringify(r.body)).not.toContain("CLIENT_SECRET=");
  });
});
