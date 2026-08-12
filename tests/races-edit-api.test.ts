/**
 * Owner batch 5 — public edit/delete capabilities:
 *  - GET /api/races capability lists (scoped admins only)
 *  - PUT /api/races/:id (city/global admin, exact city scope; audited)
 *  - PUT /api/events/:id (group lead of the event's group, or scoped admin;
 *    submitters/runners CANNOT edit published events)
 *  - PATCH /api/my/submissions/:id (submitter edits own PENDING only;
 *    approved rows are history-only)
 *  - PATCH /api/admin/forum/post/:id (global or exact-city admin)
 *  - unknown capability strings (e.g. audit action names) render nothing
 *    via actionMenuItems — the client only renders server-granted keys.
 */
import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { apiHandler, SESSION_COOKIE } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { materializeSeedEvents } from "../src/server/events";
import { materializeSeedRaces, raceCapabilities, publicRaces } from "../src/server/races";
import { seedContentRegistry } from "../src/server/contentSeed";
import { DEFAULT_OWNER_EMAIL } from "../src/server/owner";
import { CITIES } from "../src/data/cities";
import { actionMenuItems } from "../src/lib/actionModel";
import type { AccountRecord, SubmissionRecord } from "../src/server/types";

function req(method: string, path: string, opts: { body?: unknown; cookie?: string; adminReason?: string } = {}): any {
  const input = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const headers: Record<string, string> = { "x-forwarded-proto": "https" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.adminReason) headers["x-audit-reason"] = opts.adminReason;
  const r = Readable.from([input]) as any;
  r.method = method; r.url = path; r.headers = headers; r.socket = { remoteAddress: "198.51.100.42" };
  return r;
}
async function call(db: Db, method: string, path: string, opts: { body?: unknown; cookie?: string; adminReason?: string } = {}) {
  let status = 0; let payload = "";
  const res = new Writable({ write(chunk, _e, done) { payload += chunk.toString(); done(); } }) as any;
  res.statusCode = 200; res.headersSent = false; res.setHeader = () => {}; res.writeHead = (s: number) => { status = s; res.headersSent = true; }; res.end = (v?: unknown) => { if (v !== undefined) payload += String(v); };
  await apiHandler(req(method, path, opts) as never, res as never, db);
  return { status, body: payload ? JSON.parse(payload) : {} };
}
/** Verified same-city account with a session cookie. */
function account(db: Db, email: string, cityId = "columbia-mo", patch: Partial<AccountRecord> = {}) {
  const rec = db.createAccount({ name: email, email, cityId });
  db.updateAccount(rec.id, { status: "verified", ...patch });
  const sid = db.createSession(rec.id, "test");
  return { id: rec.id, email: rec.email, cookie: `${SESSION_COOKIE}=${sid.id}` };
}
function leadGroup(db: Db, id: string, ownerId: string) {
  db.updateGroup(id, { ownerId, leaderIds: [] });
}
function setup() {
  const db = createMemoryStore();
  db.load();
  seedContentRegistry(db, CITIES);
  materializeSeedEvents(db);
  materializeSeedRaces(db);
  return { db };
}
function auditActions(db: Db): string[] {
  return (db as unknown as { audits: Array<{ action: string }> }).audits.map((a) => a.action);
}

describe("race capabilities + public listing", () => {
  it("admins get edit+delete on their city's races; verified runners and guests get []", () => {
    const { db } = setup();
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const runner = account(db, "runner@example.com");
    const seed = db.getRace(CITIES[0].races[0].id)!;
    expect(raceCapabilities(db, db.getAccount(ca.id), seed)).toEqual(["edit", "delete"]);
    expect(raceCapabilities(db, db.getAccount(runner.id), seed)).toEqual([]);
    expect(raceCapabilities(db, null, seed)).toEqual([]);
    const views = publicRaces(db, "columbia-mo", db.getAccount(ca.id));
    expect(views.length).toBeGreaterThan(0);
    expect(views[0].capabilities).toEqual(["edit", "delete"]);
  });
  it("a city admin of ANOTHER city gets no race capabilities", () => {
    const { db } = setup();
    const kc = account(db, "kc@example.com", "kansas-city", { role: "city_admin", adminCityId: "kansas-city" });
    const seed = db.getRace(CITIES[0].races[0].id)!;
    expect(raceCapabilities(db, db.getAccount(kc.id), seed)).toEqual([]);
  });
});

describe("PUT /api/races/:id (admin edit, audited)", () => {
  it("a scoped city admin edits a seed race; audit carries admin.race_edit", async () => {
    const { db } = setup();
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const seedId = CITIES[0].races[0].id;
    const r = await call(db, "PUT", `/api/races/${seedId}`, { cookie: ca.cookie, body: { name: "Roots N Blues 10K (edited)", distances: "10K", date: "2026-09-01", location: "Stephens Lake Park", registrationUrl: "https://example.com/rnb" } });
    expect(r.status).toBe(200);
    expect(r.body.race.name).toBe("Roots N Blues 10K (edited)");
    expect(db.getRace(seedId)!.name).toBe("Roots N Blues 10K (edited)");
    expect(auditActions(db)).toContain("admin.race_edit");
  });
  it("a cross-city admin cannot edit; a verified runner cannot edit", async () => {
    const { db } = setup();
    const kc = account(db, "kc@example.com", "kansas-city", { role: "city_admin", adminCityId: "kansas-city" });
    const runner = account(db, "runner@example.com");
    const seedId = CITIES[0].races[0].id;
    const cross = await call(db, "PUT", `/api/races/${seedId}`, { cookie: kc.cookie, body: { name: "nope", distances: "5K", date: "2026-09-01", location: "X", registrationUrl: "https://example.com/x" } });
    expect(cross.status).toBe(403);
    const asRunner = await call(db, "PUT", `/api/races/${seedId}`, { cookie: runner.cookie, body: { name: "nope", distances: "5K", date: "2026-09-01", location: "X", registrationUrl: "https://example.com/x" } });
    expect(asRunner.status).toBe(401);
    expect(db.getRace(seedId)!.name).not.toBe("nope");
  });
});

describe("PUT /api/events/:id (scoped edit, audited)", () => {
  it("a group lead edits an event of their own group; audit carries group_lead.event_edit", async () => {
    const { db } = setup();
    const lead = account(db, "lead@example.com");
    leadGroup(db, "runcomo", lead.id);
    const seed = db.listEvents().find((e) => e.seedRefId === "mon-social")!;
    const r = await call(db, "PUT", `/api/events/${seed.id}`, { cookie: lead.cookie, body: { title: "Monday Social (edited)", time: "6:30 PM" } });
    expect(r.status).toBe(200);
    expect(r.body.event.title).toBe("Monday Social (edited)");
    expect(auditActions(db)).toContain("group_lead.event_edit");
  });
  it("a lead of ANOTHER group and a verified runner cannot edit", async () => {
    const { db } = setup();
    const lead = account(db, "lead@example.com");
    leadGroup(db, "ctc", lead.id);
    const runner = account(db, "runner@example.com");
    const seed = db.listEvents().find((e) => e.seedRefId === "mon-social")!;
    const wrong = await call(db, "PUT", `/api/events/${seed.id}`, { cookie: lead.cookie, body: { title: "nope" } });
    expect(wrong.status).toBe(403);
    const asRunner = await call(db, "PUT", `/api/events/${seed.id}`, { cookie: runner.cookie, body: { title: "nope" } });
    expect(asRunner.status).toBe(403);
    expect(db.getEvent(seed.id)!.title).not.toBe("nope");
  });
  it("invalid fields are rejected (400) without mutating", async () => {
    const { db } = setup();
    const global = account(db, DEFAULT_OWNER_EMAIL);
    const seed = db.listEvents().find((e) => e.seedRefId === "mon-social")!;
    const r = await call(db, "PUT", `/api/events/${seed.id}`, { cookie: global.cookie, body: { title: "   " } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_title");
  });
});

describe("PATCH /api/my/submissions/:id (submitter edits own pending only)", () => {
  function pendingRace(db: Db, ownerId: string): SubmissionRecord {
    const rec: SubmissionRecord = {
      id: "sub-pending-1", kind: "race", cityId: "columbia-mo", status: "pending",
      submitterAccountId: ownerId, submittedAt: "2026-01-01T00:00:00.000Z", decidedAt: null, decidedBy: null, rejectionReason: null, publicRefId: null,
      payload: { kind: "race", name: "Original Race", distances: "5K", date: "2026-09-01", location: "A Place", registrationUrl: "https://example.com", description: "" },
    };
    db.appendSubmission(rec);
    return rec;
  }
  it("the submitter edits their own pending race; approved rows are history-only (409)", async () => {
    const { db } = setup();
    const owner = account(db, "owner@example.com");
    const rec = await pendingRace(db, owner.id);
    const r = await call(db, "PATCH", `/api/my/submissions/${rec.id}`, { cookie: owner.cookie, body: { name: "Renamed Race", distances: "5K / 10K", date: "2026-09-01", location: "A Place", registrationUrl: "https://example.com" } });
    expect(r.status).toBe(200);
    expect((db.getSubmission(rec.id)!.payload as { name: string }).name).toBe("Renamed Race");
    expect(auditActions(db)).toContain("submission.edit_pending");
    // Approve it — now editing is forbidden.
    db.updateSubmission(rec.id, { status: "approved", decidedAt: "2026-01-02T00:00:00.000Z", decidedBy: "admin" });
    const after = await call(db, "PATCH", `/api/my/submissions/${rec.id}`, { cookie: owner.cookie, body: { name: "Too Late" } });
    expect(after.status).toBe(409);
  });
  it("another account cannot edit the submitter's pending record (404)", async () => {
    const { db } = setup();
    const owner = account(db, "owner@example.com");
    const stranger = account(db, "stranger@example.com");
    const rec = await pendingRace(db, owner.id);
    const r = await call(db, "PATCH", `/api/my/submissions/${rec.id}`, { cookie: stranger.cookie, body: { name: "Hijack" } });
    expect(r.status).toBe(404);
    expect((db.getSubmission(rec.id)!.payload as { name: string }).name).toBe("Original Race");
  });
});

describe("PATCH /api/admin/forum/post/:id (scoped admin post edit)", () => {
  it("a global admin edits any post; a cross-city city admin is denied", async () => {
    const { db } = setup();
    const author = account(db, "author@example.com");
    const post = await call(db, "POST", "/api/forum", { cookie: author.cookie, body: { section: "community", title: "Original Title", body: "Original body text." } });
    expect(post.status).toBe(200);
    const postId = post.body.post.id;
    const global = account(db, DEFAULT_OWNER_EMAIL);
    const edited = await call(db, "PATCH", `/api/admin/forum/post/${postId}`, { cookie: global.cookie, adminReason: "routine correction", body: { title: "Corrected Title", body: "Corrected body text." } });
    expect(edited.status).toBe(200);
    expect(edited.body.post.title).toBe("Corrected Title");
    expect(auditActions(db)).toContain("admin.forum_post_edit");
    const kc = account(db, "kc@example.com", "kansas-city", { role: "city_admin", adminCityId: "kansas-city" });
    const denied = await call(db, "PATCH", `/api/admin/forum/post/${postId}`, { cookie: kc.cookie, adminReason: "out of scope", body: { title: "Nope", body: "Nope." } });
    expect(denied.status).toBe(403);
  });
});

describe("actionModel — only server-granted capability keys render", () => {
  it("audit-style action names and unknown keys render nothing", () => {
    expect(actionMenuItems(["group_lead.event_edit", "admin.race_edit", "submission.edit_pending"] as unknown as string[])).toEqual([]);
    expect(actionMenuItems(["edit"])).toEqual([{ key: "edit", label: "Edit", icon: "pencil", danger: false }]);
    expect(actionMenuItems(["fly_to_moon"])).toEqual([]);
  });
});
