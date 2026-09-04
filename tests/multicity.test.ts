/**
 * Production multi-city administration — comprehensive contract tests.
 *
 * Covers the five pillars of the multi-city foundation:
 *  1. Runtime registry validation — city lifecycle status (active /
 *     coming_soon / invite_only / inactive) is decided server-side from the
 *     store + seeded defaults, never hardcoded; signup, home-city selection,
 *     submissions, and the public registry all go through it.
 *  2. city_admin role/scope — exactly one city per City Admin, enforced by
 *     authorizeScoped on every city-admin read and mutation.
 *  3. Global Admin assignment/revocation — Global Admin ONLY (owner or key
 *     admin), audited, with role restoration on revoke.
 *  4. Invite-only lifecycle & invitations — token shown once, HMAC-hashed at
 *     rest, one-time redemption, expiry, revocation, recipient binding.
 *  5. Strict cross-city denial — a City Admin scoped to one city can never
 *     read or mutate another city's records through any endpoint.
 * Plus public switcher behavior and persistence migration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { Db, createMemoryStore } from "../src/server/store";
import { ADMIN_KEY_VAR, ADMIN_EMAIL_VAR, adminLogin, authorizeScoped, assignCityAdmin, revokeCityAdmin, cityAdminAudit, type AdminCtx } from "../src/server/admin";
import { DEFAULT_OWNER_EMAIL, OWNER_EMAIL_VAR } from "../src/server/owner";
import {
  cityStatus,
  cityExists,
  cityEnterable,
  cityAcceptsSubmissions,
  publicCities,
  saveCity,
  seedCmsCities,
} from "../src/server/cms";
import { createInvitation, revokeInvitation, listInvitations, validateInvitation, INVITATION_TOKEN_PREFIX } from "../src/server/invitations";
import {
  cityDashboardOverview,
  cityModerateFlag,
  cityUnhideContent,
  citySetGroupRrca,
  citySetContentHighlight,
  dashboardOverview,
} from "../src/server/dashboard";
import { citySubmissionQueue, cityDecideSubmission } from "../src/server/submissions";
import { seedContentRegistry, seedSampleFlags } from "../src/server/contentSeed";
import { newId } from "../src/server/store";
import type { FlagRecord, SubmissionRecord, ContentRecord, GroupModRecord } from "../src/server/types";

const KEY = "test-multicity-key";
const ADMIN_EMAIL = "safety@runlocal.app";
const T0 = new Date("2026-08-03T00:00:00.000Z");
const COLUMBIA = "columbia-mo";
const STL = "stl-mo";

function ctx(adminSessionId: string | null, userSessionId?: string | null, reason?: string): AdminCtx {
  return { adminSessionId, userSessionId: userSessionId ?? null, reason, ip: "198.51.100.7" };
}

/** Key-admin session (GLOBAL scope). */
function keyCtx(db: Db, reason = "multicity test"): AdminCtx {
  const login = adminLogin(db, KEY, "198.51.100.7", T0);
  if (!login.ok) throw new Error("admin login failed");
  return ctx(login.data.sessionId, null, reason);
}

/** A signed-in City Admin scoped to exactly one city. */
function cityAdminCtx(db: Db, cityId: string, reason = "city review", email = "cityadmin@example.com"): AdminCtx {
  const rec = db.createAccount({ name: "City Admin", email });
  db.updateAccount(rec.id, { role: "city_admin", adminCityId: cityId, status: "verified" });
  const session = db.createSession(rec.id, "198.51.100.7", T0);
  return ctx(null, session.id, reason);
}

function ownerCtx(db: Db, reason = "owner review"): AdminCtx {
  const owner = db.createAccount({ name: "Owner", email: DEFAULT_OWNER_EMAIL });
  db.updateAccount(owner.id, { status: "verified", avatarStyle: "coral" });
  const session = db.createSession(owner.id, "198.51.100.7", T0);
  return ctx(null, session.id, reason);
}

function seedCities(db: Db): void {
  seedCmsCities(db);
  seedContentRegistry(db);
  seedSampleFlags(db, T0);
}

// ------------------------------------------------------------ HTTP harness
function makeReq(method: string, path: string, opts: { body?: unknown; cookie?: string; reason?: string } = {}): IncomingMessage {
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
      if (name.toLowerCase() === "set-cookie") fake.setCookieHeader = Array.isArray(value) ? value[0] : value;
      return res;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) fake.body += String(chunk);
      return res;
    },
  } as unknown as ServerResponse;
  return { res, fake };
}
async function call(db: Db, method: string, path: string, opts: { body?: unknown; cookie?: string; reason?: string } = {}): Promise<FakeRes> {
  const { res, fake } = makeRes();
  await apiHandler(makeReq(method, path, opts), res, db);
  return fake;
}
const parse = (f: FakeRes): any => JSON.parse(f.body || "{}");

/** Signed-up, verified runner with a session cookie. */
async function runnerCookie(db: Db, email = "runner@example.com", cityId = COLUMBIA): Promise<{ cookie: string; accountId: string }> {
  const fake = await call(db, "POST", "/api/accounts", {
    body: { name: "Runner", username: `runner_${email.split("@")[0]}`, email, birthdate: "1998-05-05", cityId },
  });
  expect(fake.status, `signup failed: ${fake.body}`).toBe(200);
  const sid = fake.setCookieHeader?.match(/^runlocal_sid=([^;]+)/)?.[1];
  expect(sid).toBeTruthy();
  const rec = db.getAccountByEmail(email)!;
  db.updateAccount(rec.id, { status: "verified", phase: "pending_review", selfieRef: "x.jpg" });
  return { cookie: `runlocal_sid=${sid}`, accountId: rec.id };
}

function addFlag(db: Db, cityId: string, contentId: string): FlagRecord {
  return db.appendFlag(
    { cityId, contentId, kind: "event", refId: "ref", title: "Flagged", reason: "test", reporterName: "Reporter", reporterAccountId: null, status: "open", resolvedAt: null, resolvedAction: null },
    T0,
  );
}
function addContent(db: Db, cityId: string, id: string): ContentRecord {
  const rec: ContentRecord = { id, cityId, kind: "event", refId: id, title: `Content ${id}`, authorLabel: null, authorAccountId: null, featured: false, pinned: false, hidden: true, hiddenAt: T0.toISOString(), archived: false, archivedAt: null };
  db.upsertContent(rec);
  return rec;
}
function addGroup(db: Db, cityId: string, id: string): GroupModRecord {
  const rec: GroupModRecord = { id, cityId, name: `Group ${id}`, rrcaBadge: false, rrcaNote: null, rrcaNoteUpdatedAt: null };
  db.upsertGroup(rec);
  return rec;
}
function addPendingSubmission(db: Db, cityId: string, kind: "race" | "group" | "event" = "race"): SubmissionRecord {
  const rec: SubmissionRecord = {
    id: newId(),
    kind,
    cityId,
    status: "pending",
    submitterAccountId: "submitter-1",
    submittedAt: T0.toISOString(),
    decidedAt: null,
    decidedBy: null,
    rejectionReason: null,
    publicRefId: null,
    payload:
      kind === "race"
        ? { kind: "race", name: "Test Race", distances: "5K", date: "2026-09-01", location: "Downtown", registrationUrl: "https://example.com", description: "" }
        : kind === "group"
          ? { kind: "group", name: "Test Group", cityId, groupType: "community", description: "", facebookUrl: null, instagramUrl: null, websiteUrl: null }
          : { kind: "event", type: "one_time", title: "Test Event", date: "2026-09-01", dayOfWeek: null, time: "6:00 PM", location: "Park", distanceLabel: "3 mi", invite: "Open to all", externalUrl: null, description: "" },
  };
  db.appendSubmission(rec);
  return rec;
}

beforeEach(() => {
  /*
   * PIN THE CLOCK. This file creates invitations at T0 (2026-08-03) but the
   * HTTP handlers validate against `new Date()`, so once real time passed T0
   * plus the invitation window every invite-only signup test began returning
   * invitation_expired — on a specific calendar date, with no code change.
   *
   * A TIME BOMB, not a regression: it was green when written, went red a month
   * later, and looked exactly like something we had just broken. It cost a full
   * bisect through six commits to rule that out.
   *
   * Pinning both clocks to the same instant is the fix. Any test that pins one
   * clock and lets another run free has this shape.
   */
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  process.env[ADMIN_KEY_VAR] = KEY;
  process.env[ADMIN_EMAIL_VAR] = ADMIN_EMAIL;
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env[ADMIN_KEY_VAR];
  delete process.env[ADMIN_EMAIL_VAR];
  delete process.env[OWNER_EMAIL_VAR];
});

// ============================================================================
// 1. Runtime registry validation
// ============================================================================
describe("runtime city registry (server-authoritative lifecycle)", () => {
  it("seeded defaults: launch city active, placeholders coming_soon", () => {
    const db = createMemoryStore();
    expect(cityStatus(db, COLUMBIA)).toBe("active");
    expect(cityStatus(db, STL)).toBe("coming_soon");
    expect(cityExists(db, COLUMBIA)).toBe(true);
    expect(cityExists(db, "atlantis-zz")).toBe(false);
    expect(cityEnterable(db, COLUMBIA)).toBe(true);
    expect(cityEnterable(db, STL)).toBe(false);
    expect(cityAcceptsSubmissions(db, COLUMBIA)).toBe(true);
    expect(cityAcceptsSubmissions(db, STL)).toBe(false);
  });

  it("admin status changes drive enterability + submissions everywhere", () => {
    const db = createMemoryStore();
    seedCities(db);
    // invite_only: enterable with invitation, submissions accepted.
    const r = saveCity(db, keyCtx(db), { id: STL, name: "St. Louis", state: "MO", slug: "stl-mo", status: "invite_only" });
    expect(r.ok).toBe(true);
    expect(cityStatus(db, STL)).toBe("invite_only");
    expect(cityEnterable(db, STL)).toBe(true);
    expect(cityAcceptsSubmissions(db, STL)).toBe(true);
    // inactive: history retained, no new entry, no submissions.
    const r2 = saveCity(db, keyCtx(db), { id: STL, name: "St. Louis", state: "MO", slug: "stl-mo", status: "inactive" });
    expect(r2.ok).toBe(true);
    expect(cityEnterable(db, STL)).toBe(false);
    expect(cityAcceptsSubmissions(db, STL)).toBe(false);
    expect(cityExists(db, STL)).toBe(true); // history retained
  });

  it("public registry serves every lifecycle state with status labels", () => {
    const db = createMemoryStore();
    seedCities(db);
    saveCity(db, keyCtx(db), { id: STL, name: "St. Louis", state: "MO", slug: "stl-mo", status: "invite_only" });
    const rows = publicCities(db);
    expect(rows.map((c) => c.id).sort()).toEqual(["columbia-mo", "jc-mo", "kc-mo", "springfield-mo", "stl-mo"]);
    expect(rows.find((c) => c.id === STL)?.status).toBe("invite_only");
    expect(rows.find((c) => c.id === COLUMBIA)?.status).toBe("active");
  });

  it("signup is gated by lifecycle status through the API", async () => {
    const db = createMemoryStore();
    seedCities(db);
    const base = { name: "R", username: "rr1", email: "rr1@example.com", birthdate: "1998-01-01" };
    // coming_soon → denied with a clear code, nothing created.
    const soon = await call(db, "POST", "/api/accounts", { body: { ...base, cityId: STL } });
    expect(soon.status).toBe(400);
    expect(parse(soon).error).toBe("city_coming_soon");
    expect(db.listAccounts().length).toBe(0);
    // invite_only without an invitation → denied, nothing created.
    saveCity(db, keyCtx(db), { id: STL, name: "St. Louis", state: "MO", slug: "stl-mo", status: "invite_only" });
    const noInvite = await call(db, "POST", "/api/accounts", { body: { ...base, email: "rr2@example.com", username: "rr2", cityId: STL } });
    expect(noInvite.status).toBe(403);
    expect(parse(noInvite).error).toBe("invitation_not_found");
    expect(db.listAccounts().length).toBe(0);
  });

  it("deactivated city history stays browsable via /api/content", async () => {
    const db = createMemoryStore();
    seedCities(db);
    saveCity(db, keyCtx(db), { id: STL, name: "St. Louis", state: "MO", slug: "stl-mo", status: "inactive" });
    const content = await call(db, "GET", `/api/content?city=${STL}`);
    expect(content.status).toBe(200); // known city → history retained
    const bogus = await call(db, "GET", "/api/content?city=atlantis-zz");
    expect(bogus.status).toBe(400);
  });

  it("submissions are denied for coming_soon/inactive cities but allowed for active", async () => {
    const db = createMemoryStore();
    seedCities(db);
    const { cookie } = await runnerCookie(db);
    const raceBody = { cityId: STL, name: "Race", distances: "5K", date: "2026-09-01", location: "X", registrationUrl: "https://example.com" };
    const denied = await call(db, "POST", "/api/submissions/race", { body: raceBody, cookie });
    expect(denied.status).toBe(400);
    expect(parse(denied).error).toBe("city_coming_soon");
    const ok = await call(db, "POST", "/api/submissions/race", { body: { ...raceBody, cityId: COLUMBIA }, cookie });
    expect(ok.status).toBe(200);
  });
});

// ============================================================================
// 2 + 3. City Admin role/scope + Global Admin assignment/revocation
// ============================================================================
describe("Global Admin city-admin assignment & revocation", () => {
  it("assigns the city_admin role with exactly one city scope, audited", () => {
    const db = createMemoryStore();
    seedCities(db);
    const target = db.createAccount({ name: "Pat", email: "pat@example.com" });
    db.updateAccount(target.id, { status: "verified", role: "group_leader" });
    const r = authorizeScoped(db, keyCtx(db), "admin.city_admin_assign", target.id, T0, { enforceCity: COLUMBIA });
    expect(r.ok).toBe(true);
    const res = assignCityAdmin(db, keyCtx(db), "pat@example.com", COLUMBIA, T0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.row.cityId).toBe(COLUMBIA);
      expect(res.data.row.roleBefore).toBe("group_leader");
    }
    const rec = db.getAccount(target.id)!;
    expect(rec.role).toBe("city_admin");
    expect(rec.adminCityId).toBe(COLUMBIA);
    expect(rec.rolePriorAdmin).toBe("group_leader");
    const entry = db.listAudit(500).find((a) => a.action === "admin.city_admin_assign" && a.targetId === target.id);
    expect(entry).toBeTruthy();
    expect(entry?.cityId).toBe(COLUMBIA);
  });

  it("revocation restores the prior role and clears the scope, audited", () => {
    const db = createMemoryStore();
    seedCities(db);
    const target = db.createAccount({ name: "Pat", email: "pat@example.com" });
    db.updateAccount(target.id, { status: "verified", role: "group_leader" });
    expect(assignCityAdmin(db, keyCtx(db), "pat@example.com", COLUMBIA, T0).ok).toBe(true);
    const rev = revokeCityAdmin(db, keyCtx(db), target.id, T0);
    expect(rev.ok).toBe(true);
    const rec = db.getAccount(target.id)!;
    expect(rec.role).toBe("group_leader");
    expect(rec.adminCityId).toBeNull();
    expect(rec.rolePriorAdmin).toBeNull();
    expect(db.listAudit(500).some((a) => a.action === "admin.city_admin_revoke" && a.targetId === target.id && a.cityId === COLUMBIA)).toBe(true);
    // Double revoke → 409 not_city_admin.
    const again = revokeCityAdmin(db, keyCtx(db), target.id, T0);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe("not_city_admin");
  });

  it("rejects unknown accounts (404) and unknown cities (400); never client-assignable", () => {
    const db = createMemoryStore();
    seedCities(db);
    const noAccount = assignCityAdmin(db, keyCtx(db), "ghost@example.com", COLUMBIA, T0);
    expect(noAccount.ok).toBe(false);
    if (!noAccount.ok) expect(noAccount.error).toBe("account_not_found");
    const target = db.createAccount({ name: "Pat", email: "pat@example.com" });
    db.updateAccount(target.id, { status: "verified", avatarStyle: "coral" });
    const badCity = assignCityAdmin(db, keyCtx(db), "pat@example.com", "atlantis-zz", T0);
    expect(badCity.ok).toBe(false);
    if (!badCity.ok) expect(badCity.error).toBe("invalid_city");
    // A plain verified runner can never self-assign through the API.
    const runner = db.createAccount({ name: "R", email: "r@example.com" });
    db.updateAccount(runner.id, { status: "verified", avatarStyle: "coral" });
    const session = db.createSession(runner.id, "198.51.100.7", T0);
    const denied = authorizeScoped(db, ctx(null, session.id, "self assign"), "admin.city_admin_assign", runner.id, T0);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toBe("unauthorized");
  });

  it("owner (global) and key admin can both assign; city admins cannot", () => {
    const db = createMemoryStore();
    seedCities(db);
    db.createAccount({ name: "T", email: "t@example.com" });
    expect(assignCityAdmin(db, ownerCtx(db), "t@example.com", COLUMBIA, T0).ok).toBe(true);
    const ca = db.getAccountByEmail("t@example.com")!;
    db.updateAccount(ca.id, { role: "city_admin", adminCityId: COLUMBIA, rolePriorAdmin: null });
    const session = db.createSession(ca.id, "198.51.100.7", T0);
    // A city admin session hitting a GLOBAL-only endpoint is denied.
    const denied = authorizeScoped(db, ctx(null, session.id, "I want to promote someone"), "admin.city_admin_assign", "someone", T0, { globalOnly: true });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toBe("unauthorized");
  });

  it("admin access probe: global_admin for key, city_admin with scope, none for guests", async () => {
    const db = createMemoryStore();
    seedCities(db);
    const g = await call(db, "GET", "/api/admin/access", { cookie: adminSessionCookie(db) });
    expect(g.status).toBe(200);
    expect(parse(g).level).toBe("global_admin");
    const ca = db.createAccount({ name: "CA", email: "ca@example.com" });
    db.updateAccount(ca.id, { role: "city_admin", adminCityId: COLUMBIA, status: "verified" });
    const s = db.createSession(ca.id, "198.51.100.7", T0);
    const c = await call(db, "GET", "/api/admin/access", { cookie: `runlocal_sid=${s.id}` });
    expect(parse(c)).toMatchObject({ level: "city_admin", cityId: COLUMBIA, accountId: ca.id });
    const n = await call(db, "GET", "/api/admin/access");
    expect(parse(n).level).toBe("none");
  });
});

function adminSessionCookie(db: Db): string {
  const login = adminLogin(db, KEY, "198.51.100.7", T0);
  if (!login.ok) throw new Error("login failed");
  return `runlocal_admin=${login.data.sessionId}`;
}

// ============================================================================
// 4. Invite-only lifecycle & invitations
// ============================================================================
describe("invitations (invite-only cities)", () => {
  it("creation returns the raw token EXACTLY ONCE; only the HMAC hash is stored", () => {
    const db = createMemoryStore();
    seedCities(db);
    const r = createInvitation(db, keyCtx(db), { cityId: STL, email: "guest@example.com" }, T0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.token.startsWith(INVITATION_TOKEN_PREFIX)).toBe(true);
    const rec = db.getInvitation(r.data.invitation.id)!;
    expect(rec.tokenHash).not.toContain(r.data.token); // raw token never stored
    expect(rec.salt).toBeTruthy();
    expect(rec.createdBy).toBe(ADMIN_EMAIL);
    expect(rec.revokedAt).toBeNull();
    expect(rec.usedAt).toBeNull();
    // Audited with recipient email as admin-facing context only.
    expect(db.listAudit(500).some((a) => a.action === "admin.invitation_create" && a.cityId === STL && a.targetId === rec.id)).toBe(true);
    // The raw token is NOT recoverable — only the hash exists.
    expect(validateInvitation(db, STL, "guest@example.com", "wrong-token", T0).ok).toBe(false);
  });

  it("home-city selection into an invite_only city requires the token and consumes it once", async () => {
    const db = createMemoryStore();
    seedCities(db);
    saveCity(db, keyCtx(db), { id: STL, name: "St. Louis", state: "MO", slug: "stl-mo", status: "invite_only" });
    const { cookie } = await runnerCookie(db);
    // No token → denied.
    const noToken = await call(db, "POST", "/api/profile/city", { body: { cityId: STL }, cookie });
    expect(noToken.status).toBe(403);
    expect(parse(noToken).error).toBe("invitation_not_found");
    expect(db.getAccountByEmail("runner@example.com")!.cityId).toBe(COLUMBIA);
    // With token → success + consumed.
    const created = createInvitation(db, keyCtx(db), { cityId: STL, email: "runner@example.com" }, T0);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ok = await call(db, "POST", "/api/profile/city", { body: { cityId: STL, invitationToken: created.data.token }, cookie });
    expect(ok.status).toBe(200);
    expect(parse(ok).account.cityId).toBe(STL);
    const rec = db.getInvitation(created.data.invitation.id)!;
    expect(rec.usedAt).toBeTruthy();
    expect(rec.usedByAccountId).toBe(db.getAccountByEmail("runner@example.com")!.id);
    // Re-submitting the already-selected city is an idempotent no-op; the
    // consumed invitation remains used and cannot be redeemed for a new entry.
    const again = await call(db, "POST", "/api/profile/city", { body: { cityId: STL, invitationToken: created.data.token }, cookie });
    expect(again.status).toBe(200);
    expect(db.getInvitation(created.data.invitation.id)!.usedAt).toBeTruthy();
    expect(validateInvitation(db, STL, "runner@example.com", created.data.token, T0).ok).toBe(false);
  });

  it("revoked / expired / wrong-recipient invitations are dead", () => {
    const db = createMemoryStore();
    seedCities(db);
    const r = createInvitation(db, keyCtx(db), { cityId: STL, email: "guest@example.com", expiresInDays: 1 }, T0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.data.invitation.id;
    // Wrong recipient.
    expect(validateInvitation(db, STL, "other@example.com", r.data.token, T0).ok).toBe(false);
    // Expired.
    const later = new Date(T0.getTime() + 2 * 24 * 60 * 60 * 1000);
    expect(validateInvitation(db, STL, "guest@example.com", r.data.token, later).ok).toBe(false);
    // Revoked.
    const rev = revokeInvitation(db, keyCtx(db), id, T0);
    expect(rev.ok).toBe(true);
    if (rev.ok) expect(rev.data.invitation.valid).toBe(false);
    expect(validateInvitation(db, STL, "guest@example.com", r.data.token, T0).ok).toBe(false);
    const listed = listInvitations(db, keyCtx(db), STL, T0);
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.data[0].invalidReason).toBe("revoked");
  });

  it("signup into an invite_only city works only with the token (and consumes it)", async () => {
    const db = createMemoryStore();
    seedCities(db);
    saveCity(db, keyCtx(db), { id: STL, name: "St. Louis", state: "MO", slug: "stl-mo", status: "invite_only" });
    const created = createInvitation(db, keyCtx(db), { cityId: STL, email: "invited@example.com" }, T0);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const fake = await call(db, "POST", "/api/accounts", {
      body: { name: "Invited", username: "invited1", email: "invited@example.com", birthdate: "1998-01-01", cityId: STL, invitationToken: created.data.token },
    });
    expect(fake.status).toBe(200);
    expect(parse(fake).account.cityId).toBe(STL);
    expect(db.getInvitation(created.data.invitation.id)!.usedAt).toBeTruthy();
  });
});

// ============================================================================
// 5. Strict cross-city denial on every read & mutation
// ============================================================================
describe("strict cross-city denial (City Admin scope)", () => {
  function scopedDb() {
    const db = createMemoryStore();
    seedCities(db);
    // A second city with real content + records.
    addContent(db, STL, "event:stl-e1");
    addGroup(db, STL, "stl-group");
    addFlag(db, STL, "event:stl-e1");
    addPendingSubmission(db, STL);
    addContent(db, COLUMBIA, "event:col-e1");
    addFlag(db, COLUMBIA, "event:col-e1");
    return db;
  }

  it("authorizeScoped denies enforceCity mismatches (403 city_scope_denied)", () => {
    const db = scopedDb();
    const r = authorizeScoped(db, cityAdminCtx(db, COLUMBIA), "cityadmin.content_unhide", "x", T0, { enforceCity: STL, auditCity: STL });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("city_scope_denied");
  });

  it("dashboard is scoped: own city loads, suspensions always empty, other city denied", () => {
    const db = scopedDb();
    const own = cityDashboardOverview(db, cityAdminCtx(db, COLUMBIA), T0);
    expect(own.ok).toBe(true);
    if (own.ok) {
      expect(own.data.cityId).toBe(COLUMBIA);
      expect(own.data.suspensions).toEqual([]); // suspensions are GLOBAL-only
    }
    // The client cannot widen the scope by passing a city param — the API has
    // no such param; the server binds to the session.
    const stlCtx = cityAdminCtx(db, COLUMBIA);
    const stlRec = addPendingSubmission(db, STL);
    // Submissions queue: only the scope city's pending rows.
    const queue = citySubmissionQueue(db, stlCtx, T0);
    expect(queue.ok).toBe(true);
    if (queue.ok) expect(queue.data.every((s) => s.cityId === COLUMBIA)).toBe(true);
    expect(queue.ok && queue.data.length).toBe(0);
    // Deciding a submission from another city → denied before any write.
    const decide = cityDecideSubmission(db, stlCtx, stlRec.id, "approve", T0);
    expect(decide.ok).toBe(false);
    if (!decide.ok) expect(decide.error).toBe("city_scope_denied");
    expect(db.getSubmission(stlRec.id)!.status).toBe("pending");
  });

  it("every city-admin mutation is denied cross-city: flag, unhide, rrca, highlight", () => {
    const db = scopedDb();
    const stlFlag = addFlag(db, STL, "event:stl-e1");
    const stlContent = addContent(db, STL, "event:stl-e2");
    const stlGroup = addGroup(db, STL, "stl-group-2");
    const ca = cityAdminCtx(db, COLUMBIA, "cross-city attempt");
    const flag = cityModerateFlag(db, ca, stlFlag.id, "hide", T0);
    expect(flag.ok).toBe(false);
    if (!flag.ok) expect(flag.error).toBe("city_scope_denied");
    expect(db.getFlag(stlFlag.id)!.status).toBe("open");
    const unhide = cityUnhideContent(db, ca, stlContent.id, T0);
    expect(unhide.ok).toBe(false);
    if (!unhide.ok) expect(unhide.error).toBe("city_scope_denied");
    expect(db.getContent(stlContent.id)!.hidden).toBe(true);
    const rrca = citySetGroupRrca(db, ca, stlGroup.id, { badge: true }, T0);
    expect(rrca.ok).toBe(false);
    if (!rrca.ok) expect(rrca.error).toBe("city_scope_denied");
    expect(db.getGroup(stlGroup.id)!.rrcaBadge).toBe(false);
    const hl = citySetContentHighlight(db, ca, stlContent.id, { featured: true }, T0);
    expect(hl.ok).toBe(false);
    if (!hl.ok) expect(hl.error).toBe("city_scope_denied");
    expect(db.getContent(stlContent.id)!.featured).toBe(false);
  });

  it("same-city mutations succeed for the scoped City Admin", () => {
    const db = scopedDb();
    const colFlag = addFlag(db, COLUMBIA, "event:col-e1");
    const colGroup = addGroup(db, COLUMBIA, "col-group");
    const colContent = addContent(db, COLUMBIA, "event:col-e3");
    const ca = cityAdminCtx(db, COLUMBIA);
    expect(cityModerateFlag(db, ca, colFlag.id, "dismiss", T0).ok).toBe(true);
    expect(db.getFlag(colFlag.id)!.status).toBe("dismissed");
    expect(citySetGroupRrca(db, ca, colGroup.id, { badge: true, note: "charter #123" }, T0).ok).toBe(true);
    expect(db.getGroup(colGroup.id)!.rrcaBadge).toBe(true);
    expect(cityUnhideContent(db, ca, colContent.id, T0).ok).toBe(true);
    expect(db.getContent(colContent.id)!.hidden).toBe(false);
    expect(citySetContentHighlight(db, ca, colContent.id, { featured: true }, T0).ok).toBe(true);
    expect(db.getContent(colContent.id)!.featured).toBe(true);
    // Every same-city action was audited with the scope city.
    const audits = db.listAudit(500);
    expect(audits.filter((a) => a.action.startsWith("cityadmin.") && a.cityId === COLUMBIA).length).toBe(4);
    expect(audits.some((a) => a.cityId === STL)).toBe(false);
  });

  it("city-admin audit view shows ONLY the scope city's entries (never global)", () => {
    const db = scopedDb();
    // Global (owner) action writes a cityId-less entry.
    dashboardOverview(db, ownerCtx(db), COLUMBIA, T0);
    const ca = cityAdminCtx(db, COLUMBIA);
    cityModerateFlag(db, ca, addFlag(db, COLUMBIA, "event:col-e1").id, "dismiss", T0);
    const view = cityAdminAudit(db, ca, 100, T0);
    expect(view.ok).toBe(true);
    if (view.ok) {
      expect(view.data.length).toBeGreaterThan(0);
      for (const e of view.data) expect(e.cityId).toBe(COLUMBIA);
    }
  });

  it("global-only endpoints reject city-admin sessions (HTTP-level)", async () => {
    const db = scopedDb();
    const ca = db.createAccount({ name: "CA", email: "ca@example.com" });
    db.updateAccount(ca.id, { role: "city_admin", adminCityId: COLUMBIA, status: "verified" });
    const s = db.createSession(ca.id, "198.51.100.7", T0);
    const cookie = `runlocal_sid=${s.id}`;
    const cityAdmins = await call(db, "GET", "/api/admin/cityadmins", { cookie, reason: "curious" });
    expect(cityAdmins.status).toBe(401);
    const invs = await call(db, "POST", "/api/admin/invitations", { cookie, reason: "curious", body: { cityId: STL, email: "x@example.com" } });
    expect(invs.status).toBe(401);
    // Scoped endpoint works with the city-admin session.
    const dash = await call(db, "GET", "/api/admin/city/dashboard", { cookie, reason: "city review" });
    expect(dash.status).toBe(200);
    expect(parse(dash).cityId).toBe(COLUMBIA);
    expect(parse(dash).suspensions).toEqual([]);
  });
});

// ============================================================================
// 6. Public switcher behavior
// ============================================================================
describe("public city switcher surface", () => {
  it("/api/config serves every status so the switcher can render enterability", async () => {
    const db = createMemoryStore();
    seedCities(db);
    saveCity(db, keyCtx(db), { id: STL, name: "St. Louis", state: "MO", slug: "stl-mo", status: "invite_only" });
    const config = await call(db, "GET", "/api/config");
    expect(config.status).toBe(200);
    const statuses = new Map((parse(config).cities as { id: string; status: string }[]).map((c) => [c.id, c.status]));
    expect(statuses.get(COLUMBIA)).toBe("active");
    expect(statuses.get(STL)).toBe("invite_only");
    expect(statuses.get("kc-mo")).toBe("coming_soon");
    // No payload leaks: rows carry only public registry fields.
    const raw = JSON.stringify(parse(config));
    expect(raw).not.toContain("tokenHash");
    expect(raw).not.toContain("secret");
  });

  it("deactivated city stays listed with status inactive (history visible, not enterable)", async () => {
    const db = createMemoryStore();
    seedCities(db);
    saveCity(db, keyCtx(db), { id: STL, name: "St. Louis", state: "MO", slug: "stl-mo", status: "inactive" });
    const config = await call(db, "GET", "/api/config");
    const stl = (parse(config).cities as { id: string; status: string }[]).find((c) => c.id === STL);
    expect(stl?.status).toBe("inactive");
    expect(cityEnterable(db, STL)).toBe(false);
  });
});

// ============================================================================
// 7. Persistence migration
// ============================================================================
describe("persistence migration (multi-city fields)", () => {
  it("legacy records load with cityId/scope fields defaulted, and invitations round-trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rl-multicity-"));
    try {
      const legacy = {
        accounts: [
          {
            id: "a1", name: "Legacy", email: "legacy@example.com", username: null, phone: null, birthdate: "1990-01-01",
            status: "verified", phase: "pending_review", role: "runner", requestedRole: null, profilePhotoRef: null,
            supabaseAuthId: null, signupIp: null, signupAt: "2026-01-01T00:00:00.000Z", lastActivityAt: "2026-01-01T00:00:00.000Z",
            verifiedAt: null, deletedAt: null, purgeAt: null, purgedAt: null, retentionYears: 3, selfieRef: null, selfieCapturedAt: null, loginIps: [],
            // NOTE: no cityId, no adminCityId, no rolePriorAdmin — pre-multi-city shape.
          },
        ],
        sessions: [],
        codes: [],
        audits: [{ id: "au1", at: "2026-01-01T00:00:00.000Z", admin: "safety@runlocal.app", action: "admin.search", reason: "x", targetId: null, ip: "1.2.3.4" }],
        content: [], groups: [], flags: [], submissions: [], activities: [], oauthTokens: [],
      };
      await writeFile(join(dir, "db.json"), JSON.stringify(legacy), "utf8");
      const db = new Db({ dataDir: dir });
      await db.load();
      const acc = db.listAccounts()[0];
      expect(acc.cityId).toBeNull();
      expect(acc.adminCityId).toBeNull();
      expect(acc.rolePriorAdmin).toBeNull();
      expect(acc.role).toBe("runner");
      expect(db.listAudit(10)[0].cityId).toBeNull();
      // Invitations persist round-trip.
      db.appendInvitation({
        id: "inv1", cityId: STL, email: "x@example.com", tokenHash: "abc", salt: "salt", createdAt: T0.toISOString(),
        createdBy: ADMIN_EMAIL, expiresAt: "2026-09-01T00:00:00.000Z", usedAt: null, usedByAccountId: null, revokedAt: null, revokedBy: null, token: null,
      });
      await db.persist();
      const db2 = new Db({ dataDir: dir });
      await db2.load();
      expect(db2.getInvitation("inv1")).toMatchObject({ id: "inv1", cityId: STL, email: "x@example.com" });
      const reloaded = db2.listAccounts()[0];
      expect(reloaded.adminCityId).toBeNull();
      expect(reloaded.rolePriorAdmin).toBeNull();
      expect(reloaded.cityId).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
