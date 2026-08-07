/**
 * Admin override regressions (verification + moderation):
 *  - cross-owner edit/delete (admin acts on another account's content)
 *  - city boundaries for content + discussion + announcement overrides
 *  - audit entries carry actor/action/target/owner/change/time
 *  - soft-delete cascade: RSVPs/discussions/ratings stamped, never purged
 *  - posting works without a fresh login after server-side verification
 *  - City Admin grant auto-verifies completed funnels, never bypasses them
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { ADMIN_EMAIL_VAR, ADMIN_KEY_VAR, assignCityAdmin } from "../src/server/admin";
import { DEFAULT_OWNER_EMAIL, OWNER_EMAIL_VAR } from "../src/server/owner";
import { seedCmsCities } from "../src/server/cms";

// Key-admin authz is env-driven; pin the vars so the audit actor identity and
// admin availability are deterministic regardless of the ambient shell env.
// The previous values are restored afterwards so a shared worker never leaks
// the pinned admin identity (or a missing key) into other test files.
const KEY = "test-admin-overrides-key";
let prevAdminKey: string | undefined;
let prevAdminEmail: string | undefined;
let prevOwnerEmail: string | undefined;
beforeEach(() => {
  prevAdminKey = process.env[ADMIN_KEY_VAR];
  prevAdminEmail = process.env[ADMIN_EMAIL_VAR];
  prevOwnerEmail = process.env[OWNER_EMAIL_VAR];
  process.env[ADMIN_KEY_VAR] = KEY;
  process.env[ADMIN_EMAIL_VAR] = "admin@example.com";
});
afterEach(() => {
  if (prevAdminKey === undefined) delete process.env[ADMIN_KEY_VAR];
  else process.env[ADMIN_KEY_VAR] = prevAdminKey;
  if (prevAdminEmail === undefined) delete process.env[ADMIN_EMAIL_VAR];
  else process.env[ADMIN_EMAIL_VAR] = prevAdminEmail;
  if (prevOwnerEmail === undefined) delete process.env[OWNER_EMAIL_VAR];
  else process.env[OWNER_EMAIL_VAR] = prevOwnerEmail;
});

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
function json(body: string): any { return JSON.parse(body); }

const RACE = {
  cityId: "columbia-mo", name: "River 5K", distances: "5K / 10K", date: "2027-06-01",
  location: "Stephens Lake Park", registrationUrl: "https://example.com/signup", description: "A test race.",
};
const EVENT = {
  cityId: "columbia-mo", type: "one_time", title: "Sunday Long Run", date: "2027-03-14", time: "7:00 AM",
  location: "Cosmo Park", distanceLabel: "10 mi", invite: "Open to all", description: "Long run",
};

function makeAdminDb(): { db: Db; keyCookie: string; ownerCookie: string; cityCookie: string; runnerCookie: string; runner: { id: string; email: string } } {
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
  return { db, keyCookie, ownerCookie, cityCookie, runnerCookie, runner: { id: runner.id, email: runner.email } };
}

async function approveRace(db: Db, runnerCookie: string, keyCookie: string): Promise<{ id: string; contentId: string }> {
  await call(db, "POST", "/api/submissions/race", { body: RACE, cookie: runnerCookie });
  const queue = await call(db, "GET", "/api/admin/submissions", { cookie: keyCookie });
  const id = json(queue.body).results[0].id;
  await call(db, "POST", `/api/admin/submissions/${id}/approve`, { cookie: keyCookie, reason: "approving race" });
  return { id, contentId: `race:user-${id}` };
}

describe("admin overrides: cross-owner, city boundaries, audit", () => {
  it("admin edits and soft-deletes content owned by another account; audit carries owner+change", async () => {
    const { db, keyCookie, runnerCookie } = makeAdminDb();
    const { contentId } = await approveRace(db, runnerCookie, keyCookie);
    // cross-owner retitle
    const edit = await call(db, "PATCH", `/api/admin/content/${contentId}`, { body: { title: "River 5K (admin)" }, cookie: keyCookie, reason: "correcting organizer name" });
    expect(edit.status).toBe(200);
    // cross-owner soft-delete
    const del = await call(db, "POST", `/api/admin/content/${contentId}/delete`, { cookie: keyCookie, reason: "no longer exists" });
    expect(del.status).toBe(200);
    expect(json(del.body).content.archived).toBe(true);
    const entry = db.listAudit(50).find((a) => a.action === "admin.content_delete" && a.targetId === contentId);
    expect(entry).toBeDefined();
    expect(entry!.admin).toBe("admin@example.com");
    expect(entry!.owner).toBe("runner@example.com");
    expect(entry!.change).toContain("deleted (soft)");
    expect(entry!.at).toBeTruthy();
    expect(entry!.reason).toBe("no longer exists");
  });

  it("city admin: discussion overrides are in-city only; announcement overrides are global-only", async () => {
    const { db, keyCookie, cityCookie, runnerCookie, runner } = makeAdminDb();
    await approveRace(db, runnerCookie, keyCookie);
    const columbiaDisc = "disc-1";
    const foreignDisc = "disc-2";
    for (const d of [
      { id: columbiaDisc, eventId: "event:seed-1", occurrenceId: "event:seed-1:2027-03-14", cityId: "columbia-mo" as const },
      { id: foreignDisc, eventId: "event:seed-2", occurrenceId: "event:seed-2:2027-03-14", cityId: "jefferson-city-mo" as const },
    ]) {
      db.addDiscussion({ id: d.id, eventId: d.eventId, occurrenceId: d.occurrenceId, cityId: d.cityId, kind: "thread", parentId: null, title: "Who's in?", body: "Weather looks good.", authorId: runner.id, state: "visible", createdAt: "2027-03-01T00:00:00.000Z", updatedAt: "2027-03-01T00:00:00.000Z" });
    }
    // routine read: key admin lists all; city admin list is pinned to columbia
    const list = await call(db, "GET", "/api/admin/discussions", { cookie: keyCookie });
    expect(list.status).toBe(200);
    expect(json(list.body).results.length).toBe(2);
    const cityList = await call(db, "GET", "/api/admin/discussions", { cookie: cityCookie });
    expect(json(cityList.body).results.map((r: { id: string }) => r.id)).toEqual([columbiaDisc]);
    // in-city edit + delete OK for the city admin
    const edit = await call(db, "PATCH", `/api/admin/discussion/${columbiaDisc}`, { body: { body: "Edited body" }, cookie: cityCookie, reason: "moderating text" });
    expect(edit.status).toBe(200);
    expect(json(edit.body).discussion.body).toBe("Edited body");
    const del = await call(db, "DELETE", `/api/admin/discussion/${columbiaDisc}`, { cookie: cityCookie, reason: "removing comment" });
    expect(del.status).toBe(200);
    const audit = db.listAudit(50);
    const editEntry = audit.find((a) => a.action === "admin.discussion_edit" && a.targetId === columbiaDisc);
    expect(editEntry!.owner).toBe(runner.email);
    expect(editEntry!.change).toBe("body edited by admin");
    expect(audit.some((a) => a.action === "admin.discussion_delete" && a.targetId === columbiaDisc)).toBe(true);
    // cross-city discussion mutation is denied
    const cross = await call(db, "DELETE", `/api/admin/discussion/${foreignDisc}`, { cookie: cityCookie, reason: "cross-city attempt" });
    expect(cross.status).toBe(403);
    expect(json(cross.body).error).toBe("city_scope_denied");
    // announcement: global admin sets and clears; city admin is denied
    const setAnn = await call(db, "PATCH", "/api/admin/announcement", { body: { text: "Summer series is live!" }, cookie: keyCookie, reason: "publishing announcement" });
    expect(setAnn.status).toBe(200);
    const setAudit = db.listAudit(50).find((a) => a.action === "admin.announcement_edit");
    expect(setAudit!.change).toContain("Summer series is live!");
    const cityAnn = await call(db, "PATCH", "/api/admin/announcement", { body: { text: "nope" }, cookie: cityCookie, reason: "city banner attempt" });
    expect(cityAnn.status).toBe(401);
    const clearAnn = await call(db, "DELETE", "/api/admin/announcement", { cookie: keyCookie, reason: "announcement over" });
    expect(clearAnn.status).toBe(200);
    expect(db.listAudit(50).some((a) => a.action === "admin.announcement_remove")).toBe(true);
  });

  it("soft-delete cascade preserves rows but removes them from every active surface", async () => {
    const { db, keyCookie, runnerCookie, runner } = makeAdminDb();
    // submit + approve an event
    await call(db, "POST", "/api/submissions/event", { body: EVENT, cookie: runnerCookie });
    const queue = await call(db, "GET", "/api/admin/submissions", { cookie: keyCookie });
    const id = json(queue.body).results[0].id;
    await call(db, "POST", `/api/admin/submissions/${id}/approve`, { cookie: keyCookie, reason: "approving run" });
    const contentId = `event:user-${id}`;
    // RSVP + discussion + rating on that event (explicit occurrence — the
    // approved event is a one_time run on 2027-03-14)
    const rsvp = await call(db, "POST", "/api/events/rsvp", { body: { eventId: contentId, runDate: "2027-03-14" }, cookie: runnerCookie });
    expect(rsvp.status).toBe(200);
    db.addDiscussion({ id: "disc-1", eventId: contentId, occurrenceId: `${contentId}:2027-03-14`, cityId: "columbia-mo", kind: "thread", parentId: null, title: "Who's in?", body: "Weather looks good.", authorId: runner.id, state: "visible", createdAt: "2027-03-01T00:00:00.000Z", updatedAt: "2027-03-01T00:00:00.000Z" });
    db.addRating({ id: "rating-1", reviewerId: runner.id, revieweeId: runner.id, eventId: contentId, positive: true, tags: ["reliable"], createdAt: "2027-03-02T00:00:00.000Z", reason: null });
    // host + RSVP rows for the submitter (admin approval grants host attendance)
    expect(db.listAttendance(runner.id)).toHaveLength(2);
    expect(db.listRatings()).toHaveLength(1);
    // admin soft-deletes the event
    const del = await call(db, "POST", `/api/admin/content/${contentId}/delete`, { cookie: keyCookie, reason: "duplicate listing" });
    expect(del.status).toBe(200);
    // dependents stamped, never purged
    const attendance = db.listAllAttendanceByEvent(contentId);
    expect(attendance.length).toBeGreaterThan(0);
    for (const a of attendance) expect(a.deletedAt).toBeTruthy();
    expect(db.listAttendance(runner.id)).toHaveLength(0);
    expect(db.hasAttendance(runner.id, contentId)).toBe(false);
    const discussion = db.getDiscussion("disc-1")!;
    expect(discussion.state).toBe("deleted");
    expect(discussion.body).toBe("");
    expect(db.listActiveDiscussions(contentId)).toHaveLength(0);
    expect(db.listRatings()).toHaveLength(0);
    expect(db.listAllRatings()[0].deletedAt).toBeTruthy();
    // public events exclude it
    const pub = await call(db, "GET", "/api/events?city=columbia-mo");
    expect(json(pub.body).events.some((e: { id: string }) => e.id === contentId)).toBe(false);
    const entry = db.listAudit(50).find((a) => a.action === "admin.content_delete" && a.targetId === contentId);
    expect(entry!.change).toContain("RSVP/attendance");
    expect(entry!.change).toContain("discussion(s)");
  });
});

describe("verification freshness: posting without a fresh login", () => {
  it("a session created while pending can post immediately after server-side approval (no relogin)", async () => {
    const db = createMemoryStore();
    const pending = db.createAccount({ name: "Pending", email: "pending@example.com" });
    db.updateAccount(pending.id, { status: "pending", phase: "pending_review", selfieRef: "selfie-1" });
    const cookie = `runlocal_sid=${db.createSession(pending.id, "198.51.100.20").id}`;
    // before approval: posting is denied (signed in, but not yet verified)
    const denied = await call(db, "POST", "/api/submissions/race", { body: RACE, cookie });
    expect(denied.status).toBe(403);
    // owner approves server-side while the same session is still live
    db.updateAccount(pending.id, { status: "verified", verifiedAt: new Date().toISOString() });
    // same session, no relogin, no new cookie: posting now succeeds
    const ok = await call(db, "POST", "/api/submissions/race", { body: RACE, cookie });
    expect(ok.status).toBe(200);
    // and the same session can submit a group without relogin
    const group = await call(db, "POST", "/api/submissions/group", {
      body: { cityId: "columbia-mo", name: "Mizzou Runners", description: "Campus club", groupType: "community", websiteUrl: "https://example.com/club", membershipMode: "open", coverPhoto: "cover-ref", logoPhoto: "logo-ref" },
      cookie,
    });
    expect(group.status).toBe(200);
  });
});

describe("city-admin grant and the verification funnel", () => {
  it("grant auto-verifies an account that completed the funnel; never bypasses an incomplete funnel", async () => {
    const db = createMemoryStore();
    seedCmsCities(db); // city registry — assignCityAdmin validates against it
    const owner = db.createAccount({ name: "Owner", email: DEFAULT_OWNER_EMAIL });
    db.updateAccount(owner.id, { status: "verified" });
    const ownerSession = db.createSession(owner.id, "198.51.100.30");
    const ctx = { userSessionId: ownerSession.id, adminSessionId: null, ip: "198.51.100.30", reason: "granting city admin" };
    const completed = db.createAccount({ name: "Done", email: "done@example.com" });
    db.updateAccount(completed.id, { status: "pending", phase: "pending_review", selfieRef: "selfie-2" });
    const incomplete = db.createAccount({ name: "Early", email: "early@example.com" });
    db.updateAccount(incomplete.id, { status: "pending", phase: "email", selfieRef: null });
    const a = assignCityAdmin(db, ctx, "done@example.com", "columbia-mo");
    expect(a.ok).toBe(true);
    expect(db.getAccount(completed.id)!.status).toBe("verified");
    expect(db.getAccount(completed.id)!.verifiedAt).toBeTruthy();
    const b = assignCityAdmin(db, ctx, "early@example.com", "columbia-mo");
    expect(b.ok).toBe(true);
    expect(db.getAccount(incomplete.id)!.status).toBe("pending");
    expect(db.getAccount(incomplete.id)!.role).toBe("city_admin");
  });
});
