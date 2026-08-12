/**
 * Group Lead scoped moderation for group runs — server-side capability lists
 * (unit) + the public GET /api/events optional-actor wiring + the
 * PATCH /api/events/:id/moderation endpoint (HTTP-level, no UI dependency).
 *
 * Scope rule under test: leads get hide/restore/delete ONLY on recurring runs
 * of groups they lead (same city). Races and independent/community events stay
 * City/Global-admin-only; a lead never receives capabilities on them. City
 * Admins (scoped to the event's city) and the Global Admin get the three keys
 * on every event. Hidden events omit "hide"; archived events get [].
 * The moderation route re-validates the same predicate (403/404), transitions
 * the canonical event so publicEvents reflects it, and audits with the
 * distinct group_lead.event_hide / event_restore / event_delete actions,
 * recording the lead's account id.
 */
import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { apiHandler, SESSION_COOKIE } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { materializeSeedEvents } from "../src/server/events";
import { seedContentRegistry } from "../src/server/contentSeed";
import { eventCapabilities } from "../src/server/eventModeration";
import { DEFAULT_OWNER_EMAIL } from "../src/server/owner";
import { CITIES } from "../src/data/cities";
import type { AccountRecord, RunEventRecord } from "../src/server/types";

function req(method: string, path: string, opts: { body?: unknown; cookie?: string } = {}): any {
  const input = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const headers: Record<string, string> = { "x-forwarded-proto": "https" };
  if (opts.cookie) headers.cookie = opts.cookie;
  const r = Readable.from([input]) as any;
  r.method = method; r.url = path; r.headers = headers; r.socket = { remoteAddress: "198.51.100.42" };
  return r;
}
async function call(db: Db, method: string, path: string, opts: { body?: unknown; cookie?: string } = {}) {
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

/** Make the seeded group `id` owned by `ownerId` (the seed groups start ownerless). */
function leadGroup(db: Db, id: string, ownerId: string) {
  db.updateGroup(id, { ownerId, leaderIds: [] });
}

/** A canonical event record inserted directly (independent / race-like / other-city). */
function makeEvent(db: Db, id: string, patch: Partial<RunEventRecord> = {}): RunEventRecord {
  const rec: RunEventRecord = {
    id, seedRefId: null, cityId: "columbia-mo", groupId: "", title: id, dayOfWeek: 3,
    time: "6:00 PM", location: "Test location", distanceLabel: "3 mi", invite: "Open to all",
    externalUrl: null, provenance: "admin", status: "published", hidden: false,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "test", updatedBy: "test", archivedAt: null, ...patch,
  };
  db.setEvent(rec);
  return rec;
}

function setup() {
  const db = createMemoryStore();
  materializeSeedEvents(db, CITIES);
  seedContentRegistry(db, CITIES); // seeds groups ctc/runcomo/fleetfeet/mizzou + event registry rows
  return { db };
}
const seedByRef = (db: Db, refId: string) => db.listEvents().find((e) => e.seedRefId === refId)!;

describe("eventCapabilities (server-side predicate)", () => {
  it("the lead of the event's group gets hide/restore/delete", () => {
    const { db } = setup();
    const lead = account(db, "lead@example.com");
    leadGroup(db, "runcomo", lead.id);
    expect(eventCapabilities(db, db.getAccount(lead.id), seedByRef(db, "mon-social"))).toEqual(["hide", "restore", "delete"]);
  });

  it("a listed leader (not owner) gets the same keys", () => {
    const { db } = setup();
    const owner = account(db, "owner@example.com");
    const leader = account(db, "leader@example.com");
    leadGroup(db, "ctc", owner.id);
    db.updateGroup("ctc", { leaderIds: [leader.id] });
    expect(eventCapabilities(db, db.getAccount(leader.id), seedByRef(db, "tue-track"))).toEqual(["hide", "restore", "delete"]);
  });

  it("leads get NO capabilities on events of groups they don't lead", () => {
    const { db } = setup();
    const lead = account(db, "lead@example.com");
    leadGroup(db, "ctc", lead.id);
    // runcomo/fleetfeet/mizzou events are out of the lead's scope
    for (const ref of ["mon-social", "wed-hills", "wed-kickstart", "thu-mizzou", "sun-recovery"]) {
      expect(eventCapabilities(db, db.getAccount(lead.id), seedByRef(db, ref))).toEqual([]);
    }
  });

  it("leads get NO capabilities on independent events and race-like records (no resolvable group)", () => {
    const { db } = setup();
    const lead = account(db, "lead@example.com");
    leadGroup(db, "runcomo", lead.id);
    const independent = makeEvent(db, "independent-run", { groupId: "" });
    const raceLike = makeEvent(db, "race-like", { groupId: "not-a-group" });
    expect(eventCapabilities(db, db.getAccount(lead.id), independent)).toEqual([]);
    expect(eventCapabilities(db, db.getAccount(lead.id), raceLike)).toEqual([]);
  });

  it("cross-city leads get none (home city must equal the group's city)", () => {
    const { db } = setup();
    const cross = account(db, "cross@example.com", "stl-mo");
    leadGroup(db, "runcomo", cross.id); // owner record is set, but the lead is in another city
    expect(eventCapabilities(db, db.getAccount(cross.id), seedByRef(db, "mon-social"))).toEqual([]);
  });

  it("guests, unverified accounts, and deleted accounts get none", () => {
    const { db } = setup();
    const lead = account(db, "lead@example.com");
    leadGroup(db, "runcomo", lead.id);
    expect(eventCapabilities(db, null, seedByRef(db, "mon-social"))).toEqual([]);
    const pending = db.createAccount({ name: "Pending", email: "pending@example.com", cityId: "columbia-mo" }); // status pending
    db.updateGroup("runcomo", { ownerId: pending.id });
    expect(eventCapabilities(db, pending, seedByRef(db, "mon-social"))).toEqual([]);
    const deleted = account(db, "gone@example.com");
    leadGroup(db, "runcomo", deleted.id);
    db.updateAccount(deleted.id, { deletedAt: new Date().toISOString() });
    expect(eventCapabilities(db, db.getAccount(deleted.id), seedByRef(db, "mon-social"))).toEqual([]);
  });

  it("a plain verified runner (member, not lead) gets none", () => {
    const { db } = setup();
    const runner = account(db, "runner@example.com");
    // the seeded group stays ownerless and leaderless — membership alone is not leadership
    expect(db.getGroup("runcomo")!.ownerId).toBeUndefined();
    expect(eventCapabilities(db, db.getAccount(runner.id), seedByRef(db, "mon-social"))).toEqual([]);
  });

  it("a city admin of the event's city gets the keys on group runs, independent events, and race-like records", () => {
    const { db } = setup();
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const independent = makeEvent(db, "independent-run", { groupId: "" });
    const raceLike = makeEvent(db, "race-like", { groupId: "not-a-group" });
    expect(eventCapabilities(db, db.getAccount(ca.id), seedByRef(db, "mon-social"))).toEqual(["hide", "restore", "delete"]);
    expect(eventCapabilities(db, db.getAccount(ca.id), independent)).toEqual(["hide", "restore", "delete"]);
    expect(eventCapabilities(db, db.getAccount(ca.id), raceLike)).toEqual(["hide", "restore", "delete"]);
  });

  it("a city admin of ANOTHER city gets none", () => {
    const { db } = setup();
    const ca = account(db, "ca@example.com", "stl-mo", { role: "city_admin", adminCityId: "stl-mo" });
    expect(eventCapabilities(db, db.getAccount(ca.id), seedByRef(db, "mon-social"))).toEqual([]);
  });

  it("the global admin gets the keys everywhere (group runs, independent events, race-like records)", () => {
    const { db } = setup();
    const global = account(db, DEFAULT_OWNER_EMAIL);
    const independent = makeEvent(db, "independent-run", { groupId: "" });
    const raceLike = makeEvent(db, "race-like", { groupId: "not-a-group" });
    expect(eventCapabilities(db, db.getAccount(global.id), seedByRef(db, "mon-social"))).toEqual(["hide", "restore", "delete"]);
    expect(eventCapabilities(db, db.getAccount(global.id), independent)).toEqual(["hide", "restore", "delete"]);
    expect(eventCapabilities(db, db.getAccount(global.id), raceLike)).toEqual(["hide", "restore", "delete"]);
  });

  it("a hidden event omits hide; an archived event returns []", () => {
    const { db } = setup();
    const lead = account(db, "lead@example.com");
    leadGroup(db, "runcomo", lead.id);
    const hidden = { ...seedByRef(db, "mon-social"), hidden: true, status: "hidden" as const };
    expect(eventCapabilities(db, db.getAccount(lead.id), hidden)).toEqual(["restore", "delete"]);
    const archived = { ...seedByRef(db, "mon-social"), archivedAt: "2026-02-01T00:00:00.000Z", status: "archived" as const };
    expect(eventCapabilities(db, db.getAccount(lead.id), archived)).toEqual([]);
    expect(eventCapabilities(db, db.getAccount(lead.id), undefined)).toEqual([]);
  });
});

describe("GET /api/events (optional actor capability lists)", () => {
  it("anonymous reads stay public with empty capabilities", async () => {
    const { db } = setup();
    const r = await call(db, "GET", "/api/events?city=columbia-mo");
    expect(r.status).toBe(200);
    const events = r.body.events as Array<{ seedRefId: string; capabilities: string[] }>;
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.capabilities).toEqual([]);
  });

  it("a signed-in lead sees capabilities ONLY on the recurring runs of groups they lead", async () => {
    const { db } = setup();
    const lead = account(db, "lead@example.com");
    leadGroup(db, "ctc", lead.id);
    makeEvent(db, "independent-run", { groupId: "" }); // extra independent event
    const r = await call(db, "GET", "/api/events?city=columbia-mo", { cookie: lead.cookie });
    expect(r.status).toBe(200);
    const byRef = new Map((r.body.events as Array<{ id: string; seedRefId: string | null; groupId: string; capabilities: string[] }>).map((e) => [e.seedRefId ?? e.id, e]));
    expect(byRef.get("tue-track")!.capabilities).toEqual(["hide", "restore", "delete"]);
    expect(byRef.get("sat-long")!.capabilities).toEqual(["hide", "restore", "delete"]);
    for (const ref of ["mon-social", "wed-kickstart", "thu-mizzou", "independent-run"]) {
      expect(byRef.get(ref)!.capabilities).toEqual([]);
    }
  });
});

describe("PATCH /api/events/:id/moderation", () => {
  it("rejects guests (401), unknown ids (404), and invalid actions (400)", async () => {
    const { db } = setup();
    expect((await call(db, "PATCH", "/api/events/missing/moderation", { body: { action: "hide" } })).status).toBe(404);
    expect((await call(db, "PATCH", `/api/events/${seedByRef(db, "mon-social").id}/moderation`, { body: { action: "hide" } })).status).toBe(401);
    const lead = account(db, "lead@example.com");
    leadGroup(db, "runcomo", lead.id);
    expect((await call(db, "PATCH", `/api/events/${seedByRef(db, "mon-social").id}/moderation`, { body: { action: "explode" }, cookie: lead.cookie })).status).toBe(400);
  });

  it("403 for leads on independent events, race-like records, and events of groups they don't lead", async () => {
    const { db } = setup();
    const lead = account(db, "lead@example.com");
    leadGroup(db, "runcomo", lead.id);
    const independent = makeEvent(db, "independent-run", { groupId: "" });
    const raceLike = makeEvent(db, "race-like", { groupId: "not-a-group" });
    const otherGroup = seedByRef(db, "tue-track"); // ctc event — runcomo lead has no scope
    for (const ev of [independent, raceLike, otherGroup]) {
      const r = await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "hide" }, cookie: lead.cookie });
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("forbidden");
      // nothing changed and nothing was audited
      expect(db.getEvent(ev.id)!.hidden).toBe(false);
    }
    expect(db.listAudit(100).filter((a) => a.action.startsWith("group_lead."))).toHaveLength(0);
  });

  it("403 for cross-city leads and plain verified runners", async () => {
    const { db } = setup();
    const cross = account(db, "cross@example.com", "stl-mo");
    leadGroup(db, "runcomo", cross.id);
    const ev = seedByRef(db, "mon-social");
    expect((await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "hide" }, cookie: cross.cookie })).status).toBe(403);
    const runner = account(db, "runner@example.com"); // verified, but no group role
    expect((await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "hide" }, cookie: runner.cookie })).status).toBe(403);
  });

  it("a lead hides/restores/deletes their own group's recurring run; hide drops it from publicEvents; delete archives it", async () => {
    const { db } = setup();
    const lead = account(db, "lead@example.com");
    leadGroup(db, "runcomo", lead.id);
    const ev = seedByRef(db, "mon-social");

    const hidden = await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "hide" }, cookie: lead.cookie });
    expect(hidden.status).toBe(200);
    expect(hidden.body.event.hidden).toBe(true);
    expect(hidden.body.event.status).toBe("hidden");
    let pub = await call(db, "GET", "/api/events?city=columbia-mo");
    expect((pub.body.events as Array<{ id: string }>).some((e) => e.id === ev.id)).toBe(false);

    // hidden → restore
    const restored = await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "restore" }, cookie: lead.cookie });
    expect(restored.status).toBe(200);
    expect(restored.body.event.hidden).toBe(false);
    expect(restored.body.event.status).toBe("published");
    pub = await call(db, "GET", "/api/events?city=columbia-mo");
    expect((pub.body.events as Array<{ id: string }>).some((e) => e.id === ev.id)).toBe(true);

    // delete → archived, gone from publicEvents forever
    const deleted = await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "delete" }, cookie: lead.cookie });
    expect(deleted.status).toBe(200);
    expect(deleted.body.event.status).toBe("archived");
    expect(deleted.body.event.archivedAt).toBeTruthy();
    pub = await call(db, "GET", "/api/events?city=columbia-mo");
    expect((pub.body.events as Array<{ id: string }>).some((e) => e.id === ev.id)).toBe(false);
  });

  it("state guards: already-hidden → 409, restore on visible → 409, archive terminal (delete on archived → 409)", async () => {
    const { db } = setup();
    const lead = account(db, "lead@example.com");
    leadGroup(db, "runcomo", lead.id);
    const ev = seedByRef(db, "mon-social");
    expect((await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "restore" }, cookie: lead.cookie })).status).toBe(409);
    await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "hide" }, cookie: lead.cookie });
    expect((await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "hide" }, cookie: lead.cookie })).status).toBe(409);
    await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "delete" }, cookie: lead.cookie });
    expect((await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "delete" }, cookie: lead.cookie })).status).toBe(409);
  });

  it("a city admin of the event's city can moderate group runs, independent events, and race-like records", async () => {
    const { db } = setup();
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const independent = makeEvent(db, "independent-run", { groupId: "" });
    const raceLike = makeEvent(db, "race-like", { groupId: "not-a-group" });
    for (const ev of [seedByRef(db, "mon-social"), independent, raceLike]) {
      const r = await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "hide" }, cookie: ca.cookie });
      expect(r.status).toBe(200);
      expect(db.getEvent(ev.id)!.hidden).toBe(true);
    }
    // a city admin of another city is denied
    const other = account(db, "other@example.com", "stl-mo", { role: "city_admin", adminCityId: "stl-mo" });
    const fresh = makeEvent(db, "fresh-run", { groupId: "" });
    expect((await call(db, "PATCH", `/api/events/${fresh.id}/moderation`, { body: { action: "hide" }, cookie: other.cookie })).status).toBe(403);
  });

  it("the global admin can moderate any event, including independent and race-like records", async () => {
    const { db } = setup();
    const global = account(db, DEFAULT_OWNER_EMAIL);
    const independent = makeEvent(db, "independent-run", { groupId: "" });
    const raceLike = makeEvent(db, "race-like", { groupId: "not-a-group" });
    for (const ev of [seedByRef(db, "mon-social"), independent, raceLike]) {
      const r = await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "delete" }, cookie: global.cookie });
      expect(r.status).toBe(200);
      expect(db.getEvent(ev.id)!.archivedAt).toBeTruthy();
    }
  });

  it("audits every action with the distinct group_lead.* names, the actor identity, and no reason prompt", async () => {
    const { db } = setup();
    const lead = account(db, "lead@example.com");
    leadGroup(db, "runcomo", lead.id);
    const ev = seedByRef(db, "mon-social");
    await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "hide" }, cookie: lead.cookie });
    await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "restore" }, cookie: lead.cookie });
    await call(db, "PATCH", `/api/events/${ev.id}/moderation`, { body: { action: "delete" }, cookie: lead.cookie });

    const entries = db.listAudit(100).filter((a) => a.action.startsWith("group_lead."));
    expect(entries.map((e) => e.action).sort()).toEqual(["group_lead.event_delete", "group_lead.event_hide", "group_lead.event_restore"]);
    for (const entry of entries) {
      expect(entry.targetId).toBe(ev.id);
      expect(entry.cityId).toBe("columbia-mo");
      expect(entry.admin).toBe(lead.email);
      expect(entry.accountId).toBe(lead.id);
      expect(entry.reason.length).toBeGreaterThan(0); // routine context — no operator prompt
    }
    // no operator admin.* event actions were written by the lead
    expect(db.listAudit(100).some((a) => a.action.startsWith("admin.event_"))).toBe(false);
    // admin actions via this endpoint also use the distinct names
    const ca = account(db, "ca@example.com", "columbia-mo", { role: "city_admin", adminCityId: "columbia-mo" });
    const ev2 = seedByRef(db, "tue-track");
    await call(db, "PATCH", `/api/events/${ev2.id}/moderation`, { body: { action: "hide" }, cookie: ca.cookie });
    const adminEntry = db.listAudit(100).find((a) => a.action === "group_lead.event_hide" && a.targetId === ev2.id)!;
    expect(adminEntry.admin).toBe(ca.email);
    expect(adminEntry.cityId).toBe("columbia-mo");
  });
});
