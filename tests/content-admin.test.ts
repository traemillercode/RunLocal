/**
 * Super-admin content management (Task 3): edit / hide / restore / archive for
 * races, runs/events, groups, and forum posts, plus pending-submission edit and
 * remove. Permission boundaries: Global Admins (owner session OR key admin)
 * pass; Verified Runners and City Admins are denied server-side. Mutations are
 * reason-required and audited; routine reads (content list, queue) need no
 * operator reason. Public rendering respects hide/archive for
 * community-submitted content.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { DEFAULT_OWNER_EMAIL } from "../src/server/owner";
import { ADMIN_EMAIL_VAR, ADMIN_KEY_VAR } from "../src/server/admin";
import { publicModerated } from "../src/server/dashboard";
import { publicApprovedContent } from "../src/server/submissions";
import { publicGroups } from "../src/server/groups";

function req(method: string, path: string, opts: { body?: unknown; cookie?: string; reason?: string } = {}): IncomingMessage {
  const headers: Record<string, string> = { "x-forwarded-proto": "https" };
  if (opts.reason) headers["x-audit-reason"] = opts.reason;
  if (opts.cookie) headers.cookie = opts.cookie;
  return {
    method,
    url: path,
    headers,
    socket: { remoteAddress: "198.51.100.9" },
    [Symbol.asyncIterator]() {
      const chunks = opts.body === undefined ? [] : [JSON.stringify(opts.body)];
      let i = 0;
      return {
        next: async () => (i < chunks.length ? { done: false as const, value: chunks[i++] } : { done: true as const, value: undefined }),
      };
    },
  } as unknown as IncomingMessage;
}
function call(db: Db, method: string, path: string, opts: { body?: unknown; cookie?: string; reason?: string } = {}) {
  const out = { status: 0, body: "", contentType: "" };
  const res = {
    writeHead(s: number, h?: Record<string, string>) { out.status = s; out.contentType = h?.["content-type"] ?? ""; return res; },
    end(v?: unknown) { if (v !== undefined) out.body += String(v); return res; },
  } as unknown as ServerResponse;
  return apiHandler(req(method, path, opts), res, db).then(() => out);
}

// The key-admin session (`runlocal_admin`) only authenticates when the admin key
// and email are configured in the environment, matching how the server is
// actually deployed. Without these the session resolves to no operator and every
// admin route below returns an error body with no payload.
beforeEach(() => {
  process.env[ADMIN_KEY_VAR] = "content-admin-test-key";
  process.env[ADMIN_EMAIL_VAR] = "admin@runlocal.app";
});
afterEach(() => {
  delete process.env[ADMIN_KEY_VAR];
  delete process.env[ADMIN_EMAIL_VAR];
});

const RACE = {
  cityId: "columbia-mo", name: "River 5K", distances: "5K / 10K", date: "2027-06-01",
  location: "Stephens Lake Park", registrationUrl: "https://example.com/signup", description: "A test race.",
};

function makeAdminDb(): { db: Db; keyCookie: string; ownerCookie: string; cityCookie: string; runnerCookie: string } {
  const db = createMemoryStore();
  const owner = db.createAccount({ name: "Owner", email: DEFAULT_OWNER_EMAIL });
  db.updateAccount(owner.id, { status: "verified" });
  const ownerCookie = `runlocal_sid=${db.createSession(owner.id, "198.51.100.10").id}`;
  const keyCookie = `runlocal_admin=${db.createSession("__admin__", "198.51.100.11").id}`;
  const runner = db.createAccount({ name: "Runner", email: "runner@example.com" });
  db.updateAccount(runner.id, { status: "verified" });
  const runnerCookie = `runlocal_sid=${db.createSession(runner.id, "198.51.100.12").id}`;
  const cityAdmin = db.createAccount({ name: "City Admin", email: "city@example.com" });
  db.updateAccount(cityAdmin.id, { status: "verified", role: "city_admin", adminCityId: "columbia-mo" });
  const cityCookie = `runlocal_sid=${db.createSession(cityAdmin.id, "198.51.100.13").id}`;
  return { db, keyCookie, ownerCookie, cityCookie, runnerCookie };
}

async function approveRace(db: Db, runnerCookie: string, keyCookie: string): Promise<{ id: string; contentId: string }> {
  await call(db, "POST", "/api/submissions/race", { body: RACE, cookie: runnerCookie });
  const queue = await call(db, "GET", "/api/admin/submissions", { cookie: keyCookie });
  const rows = (JSON.parse(queue.body) as { results: { id: string; title: string }[] }).results;
  const id = rows[0].id;
  await call(db, "POST", `/api/admin/submissions/${id}/approve`, { cookie: keyCookie, reason: "approving race" });
  return { id, contentId: `race:user-${id}` };
}

describe("content management: permission boundaries", () => {
  it("list: guest and runner denied; owner, key admin, and in-city city admin pass; cross-city city admin is denied", async () => {
    const { db, keyCookie, ownerCookie, cityCookie, runnerCookie } = makeAdminDb();
    await approveRace(db, runnerCookie, keyCookie);
    for (const cookie of [undefined, runnerCookie]) {
      const r = await call(db, "GET", "/api/admin/content?city=columbia-mo", { cookie });
      expect(r.status).toBe(401);
    }
    for (const cookie of [keyCookie, ownerCookie, cityCookie]) {
      const r = await call(db, "GET", "/api/admin/content?city=columbia-mo", { cookie });
      expect(r.status).toBe(200);
      const rows = (JSON.parse(r.body) as { results: unknown[] }).results;
      expect(rows.length).toBeGreaterThan(0);
      expect(r.body).not.toContain("example.com");
    }
    // City Admin pinned to own city: requesting a foreign city is denied.
    const foreign = await call(db, "GET", "/api/admin/content?city=jefferson-city-mo", { cookie: cityCookie });
    expect(foreign.status).toBe(403);
    expect(JSON.parse(foreign.body).error).toBe("city_scope_denied");
  });

  it("mutations require a reason and reject runners; city admins may act inside their city, denied cross-city", async () => {
    const { db, keyCookie, runnerCookie, cityCookie } = makeAdminDb();
    const { contentId } = await approveRace(db, runnerCookie, keyCookie);
    // no reason
    const noReason = await call(db, "POST", `/api/admin/content/${contentId}/hide`, { cookie: keyCookie });
    expect(noReason.status).toBe(400);
    expect(JSON.parse(noReason.body).error).toBe("reason_required");
    // runner denied with reason
    const runnerDenied = await call(db, "POST", `/api/admin/content/${contentId}/hide`, { cookie: runnerCookie, reason: "inappropriate" });
    expect(runnerDenied.status).toBe(401);
    // city admin (columbia-mo) may hide columbia-mo content with a reason
    const cityOk = await call(db, "POST", `/api/admin/content/${contentId}/hide`, { cookie: cityCookie, reason: "removing inappropriate content" });
    expect(cityOk.status).toBe(200);
    expect(JSON.parse(cityOk.body).content.hidden).toBe(true);
    const ok = await call(db, "POST", `/api/admin/content/${contentId}/restore`, { cookie: keyCookie, reason: "restore after review" });
    expect(ok.status).toBe(200);
    // city admin cross-city (jc-mo content id) is denied even with a reason.
    // Register Jefferson City as an active city in the runtime registry (its
    // seeded id is `jc-mo` — the seed fallback is only "coming_soon", which
    // rejects submissions) so the foreign submission itself is valid.
    db.setCity({ id: "jc-mo", name: "Jefferson City", state: "MO", slug: "jc-mo", status: "active", headerImageRef: null, accent: null });
    const sub = await call(db, "POST", "/api/submissions/race", {
      body: { cityId: "jc-mo", name: "Capital 5K", distances: "5K", date: "2027-07-01", location: "Memorial Park", registrationUrl: "https://example.com/capital", description: "State capitol race." },
      cookie: runnerCookie,
    });
    const jcId = (JSON.parse(sub.body) as { submission: { id: string } }).submission.id;
    await call(db, "POST", `/api/admin/submissions/${jcId}/approve`, { cookie: keyCookie, reason: "approving race" });
    const cross = await call(db, "POST", `/api/admin/content/race:user-${jcId}/hide`, { cookie: cityCookie, reason: "trying to hide another city" });
    expect(cross.status).toBe(403);
    expect(JSON.parse(cross.body).error).toBe("city_scope_denied");
  });
});

describe("content management: hide / restore / archive public effect", () => {
  it("hidden community races disappear from /api/content; restore brings them back", async () => {
    const { db, keyCookie, runnerCookie } = makeAdminDb();
    const { contentId } = await approveRace(db, runnerCookie, keyCookie);
    expect(publicApprovedContent(db, "columbia-mo").races).toHaveLength(1);
    await call(db, "POST", `/api/admin/content/${contentId}/hide`, { cookie: keyCookie, reason: "verified as a duplicate" });
    expect(publicApprovedContent(db, "columbia-mo").races).toHaveLength(0);
    expect(publicModerated(db, "columbia-mo").hidden).toContain(contentId);
    await call(db, "POST", `/api/admin/content/${contentId}/restore`, { cookie: keyCookie, reason: "duplicate confirmed not" });
    expect(publicApprovedContent(db, "columbia-mo").races).toHaveLength(1);
    expect(publicModerated(db, "columbia-mo").hidden).not.toContain(contentId);
  });

  it("archiving is terminal and also excluded from public; hide on archived is refused", async () => {
    const { db, keyCookie, runnerCookie } = makeAdminDb();
    const { contentId } = await approveRace(db, runnerCookie, keyCookie);
    await call(db, "POST", `/api/admin/content/${contentId}/archive`, { cookie: keyCookie, reason: "cancelled race — no longer exists" });
    expect(publicApprovedContent(db, "columbia-mo").races).toHaveLength(0);
    expect(publicModerated(db, "columbia-mo").archived).toContain(contentId);
    expect(publicModerated(db, "columbia-mo").hidden).toContain(contentId);
    const again = await call(db, "POST", `/api/admin/content/${contentId}/archive`, { cookie: keyCookie, reason: "again" });
    expect(again.status).toBe(409);
    const hide = await call(db, "POST", `/api/admin/content/${contentId}/hide`, { cookie: keyCookie, reason: "whatever" });
    expect(hide.status).toBe(409);
    const restore = await call(db, "POST", `/api/admin/content/${contentId}/restore`, { cookie: keyCookie, reason: "whatever" });
    expect(restore.status).toBe(409);
  });

  it("editing a community race title propagates to the submission payload and public listing", async () => {
    const { db, keyCookie, runnerCookie } = makeAdminDb();
    const { id, contentId } = await approveRace(db, runnerCookie, keyCookie);
    const r = await call(db, "PATCH", `/api/admin/content/${contentId}`, { body: { title: "River 5K — rescheduled" }, cookie: keyCookie, reason: "correcting name per organizer" });
    expect(r.status).toBe(200);
    expect((JSON.parse(r.body) as { content: { title: string } }).content.title).toBe("River 5K — rescheduled");
    expect(publicApprovedContent(db, "columbia-mo").races[0].name).toBe("River 5K — rescheduled");
    const my = await call(db, "GET", "/api/my/submissions", { cookie: runnerCookie });
    const mine = (JSON.parse(my.body) as { submissions: { id: string; status: string }[] }).submissions.find((s) => s.id === id);
    expect(mine?.status).toBe("approved");
  });

  it("hiding a community group removes it from /api/groups; restore returns it", async () => {
    const { db, keyCookie, runnerCookie } = makeAdminDb();
    const submit = await call(db, "POST", "/api/submissions/group", {
      body: { cityId: "columbia-mo", name: "Mizzou Runners", description: "Campus club", groupType: "community", websiteUrl: "https://example.com/club", membershipMode: "open", coverPhoto: "cover-ref", logoPhoto: "logo-ref" },
      cookie: runnerCookie,
    });
    expect(submit.status).toBe(200);
    const queue = await call(db, "GET", "/api/admin/submissions", { cookie: keyCookie });
    const id = (JSON.parse(queue.body) as { results: { id: string; title: string }[] }).results.find((r) => r.title === "Mizzou Runners")!.id;
    await call(db, "POST", `/api/admin/submissions/${id}/approve`, { cookie: keyCookie, reason: "approving club" });
    const groupId = `user-${id}`;
    expect(publicGroups(db, "columbia-mo").some((g) => g.id === groupId)).toBe(true);
    await call(db, "POST", `/api/admin/content/${groupId}/hide`, { cookie: keyCookie, reason: "club asked to delist temporarily" });
    expect(publicGroups(db, "columbia-mo").some((g) => g.id === groupId)).toBe(false);
    await call(db, "POST", `/api/admin/content/${groupId}/restore`, { cookie: keyCookie, reason: "listing restored" });
    expect(publicGroups(db, "columbia-mo").some((g) => g.id === groupId)).toBe(true);
  });

  it("canonical events sync: hiding an event content row hides the public event", async () => {
    const { db, keyCookie, runnerCookie } = makeAdminDb();
    const submit = await call(db, "POST", "/api/submissions/event", {
      body: { cityId: "columbia-mo", type: "one_time", title: "Sunday Long Run", date: "2027-03-14", time: "7:00 AM", location: "Cosmo Park", distanceLabel: "10 mi", invite: "Open to all", description: "Long run" },
      cookie: runnerCookie,
    });
    expect(submit.status).toBe(200);
    const queue = await call(db, "GET", "/api/admin/submissions", { cookie: keyCookie });
    const id = (JSON.parse(queue.body) as { results: { id: string; title: string }[] }).results.find((r) => r.title === "Sunday Long Run")!.id;
    await call(db, "POST", `/api/admin/submissions/${id}/approve`, { cookie: keyCookie, reason: "approving run" });
    const contentId = `event:user-${id}`;
    const pub = await call(db, "GET", "/api/events?city=columbia-mo");
    expect((JSON.parse(pub.body) as { events: { id: string }[] }).events.some((e) => e.id === contentId)).toBe(true);
    await call(db, "POST", `/api/admin/content/${contentId}/hide`, { cookie: keyCookie, reason: "weather hazards" });
    const pub2 = await call(db, "GET", "/api/events?city=columbia-mo");
    expect((JSON.parse(pub2.body) as { events: { id: string }[] }).events.some((e) => e.id === contentId)).toBe(false);
  });
});

describe("super-admin submission edit + remove", () => {
  it("edits a pending submission payload with full validation; removes it afterwards", async () => {
    const { db, keyCookie, runnerCookie } = makeAdminDb();
    const submit = await call(db, "POST", "/api/submissions/race", { body: RACE, cookie: runnerCookie });
    const id = (JSON.parse(submit.body) as { submission: { id: string } }).submission.id;
    // unauthenticated session cannot edit
    const denied = await call(db, "PATCH", `/api/admin/submissions/${id}`, { body: { ...RACE, name: "Hacked" }, cookie: "runlocal_sid=missing", reason: "unauthorized attempt" });
    expect(denied.status).toBe(401);
    // edit with invalid URL is rejected
    const bad = await call(db, "PATCH", `/api/admin/submissions/${id}`, { body: { ...RACE, registrationUrl: "not-a-url" }, cookie: keyCookie, reason: "fixing typo" });
    expect(bad.status).toBe(400);
    // edit successfully
    const ok = await call(db, "PATCH", `/api/admin/submissions/${id}`, { body: { ...RACE, name: "River 5K (updated)" }, cookie: keyCookie, reason: "correcting name per organizer" });
    expect(ok.status).toBe(200);
    // decided submissions cannot be edited
    await call(db, "POST", `/api/admin/submissions/${id}/approve`, { cookie: keyCookie, reason: "approve" });
    const after = await call(db, "PATCH", `/api/admin/submissions/${id}`, { body: { ...RACE, name: "X" }, cookie: keyCookie, reason: "late fix" });
    expect(after.status).toBe(409);
    // remove only works on pending
    const removeApproved = await call(db, "POST", `/api/admin/submissions/${id}/remove`, { cookie: keyCookie, reason: "cleanup" });
    expect(removeApproved.status).toBe(409);
  });

  it("removes a pending submission from the queue entirely (audited, global-only)", async () => {
    const { db, keyCookie, runnerCookie } = makeAdminDb();
    const submit = await call(db, "POST", "/api/submissions/race", { body: RACE, cookie: runnerCookie });
    const id = (JSON.parse(submit.body) as { submission: { id: string } }).submission.id;
    const r = await call(db, "POST", `/api/admin/submissions/${id}/remove`, { cookie: keyCookie, reason: "obvious spam" });
    expect(r.status).toBe(200);
    const my = await call(db, "GET", "/api/my/submissions", { cookie: runnerCookie });
    expect((JSON.parse(my.body) as { submissions: unknown[] }).submissions).toHaveLength(0);
    const audit = db.listAudit(20);
    expect(audit.some((a) => a.action === "admin.submission_remove")).toBe(true);
  });
});
