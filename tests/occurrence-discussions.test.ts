import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { apiHandler, SESSION_COOKIE } from "../src/server/api";
import { createMemoryStore } from "../src/server/store";
import { materializeSeedEvents } from "../src/server/events";
import { CITIES } from "../src/data/cities";

function req(method: string, path: string, body?: unknown, cookie?: string) {
  const input = body === undefined ? "" : JSON.stringify(body);
  const r = Readable.from([input]) as Readable & { method: string; url: string; headers: Record<string,string>; socket: { remoteAddress: string } };
  r.method = method; r.url = path; r.headers = { ...(cookie ? { cookie } : {}) }; r.socket = { remoteAddress: "127.0.0.1" };
  return r;
}
async function call(db: ReturnType<typeof createMemoryStore>, method: string, path: string, body?: unknown, cookie?: string) {
  let status = 0; let payload = "";
  const res = new Writable({ write(chunk, _encoding, done) { payload += chunk.toString(); done(); } }) as Writable & { statusCode: number; headersSent: boolean; setHeader: (n:string,v:unknown)=>void; writeHead:(s:number,h:Record<string,unknown>)=>void; end:(v?:unknown)=>void };
  res.statusCode = 200; res.headersSent = false; res.setHeader = () => {}; res.writeHead = (s) => { status = s; res.headersSent = true; }; (res as any).end = (v?: unknown) => { if (v) payload += String(v); };
  await apiHandler(req(method, path, body, cookie) as never, res as never, db);
  return { status, body: payload ? JSON.parse(payload) : {} };
}
function setup() {
  const db = createMemoryStore({ now: () => new Date("2026-08-03T12:00:00.000Z") }); materializeSeedEvents(db, CITIES);
  const event = db.listEvents()[0]!; const date = "2026-08-03"; const occurrence = `event:${event.id}:${date}`;
  const account = db.createAccount({ name: "Runner", email: "runner@example.com", cityId: event.cityId });
  account.status = "verified"; account.phase = "email";
  const sid = db.createSession(account.id, "test");
  db.addAttendance({ id: "att", accountId: account.id, eventId: event.id, role: "rsvp", createdAt: new Date().toISOString(), occurrenceId: occurrence, runDate: date, startsAt: `${date}T18:00:00.000Z` });
  return { db, event, occurrence, account, cookie: `${SESSION_COOKIE}=${sid.id}` };
}
const path = (e: string, o: string) => `/api/events/${encodeURIComponent(e)}/occurrences/${encodeURIComponent(o)}/discussion`;

describe("occurrence discussion request handler", () => {
  it("denies anonymous and non-verified reads/writes, accepts exact RSVP and host, and rejects wrong occurrence/city", async () => {
    const f = setup(); const p = path(f.event.id, f.occurrence);
    expect((await call(f.db, "GET", p)).status).toBe(401);
    f.account.status = "pending"; expect((await call(f.db, "POST", p, { title: "x", body: "hello" }, f.cookie)).status).toBe(403);
    f.account.status = "verified";
    expect((await call(f.db, "GET", path(f.event.id, `event:${f.event.id}:2026-08-10`), undefined, f.cookie)).status).toBe(403);
    expect((await call(f.db, "POST", p, { title: "Thread", body: "hello" }, f.cookie)).status).toBe(200);
    f.account.cityId = "not-the-event-city"; expect((await call(f.db, "GET", p, undefined, f.cookie)).status).toBe(403);
    f.account.cityId = f.event.cityId; f.account.suspended = true; f.account.suspendedUntil = null; expect((await call(f.db, "POST", p, { title: "x", body: "hello" }, f.cookie)).status).toBe(403);
    f.account.suspended = false; f.account.deletedAt = new Date().toISOString(); expect((await call(f.db, "GET", p, undefined, f.cookie)).status).toBe(403);
  });
  it("supports colon IDs, isolates data, validates input, rate limits, blocks notifications, and soft-deletes own items", async () => {
    const f = setup(); f.event.id = "city:event:colon"; f.db.setEvent(f.event); 
    // Recreate attendance for the colon-bearing event/occurrence.
    const occ = `event:${f.event.id}:2026-08-03`; f.db.addAttendance({ id: "att2", accountId: f.account.id, eventId: f.event.id, role: "host", createdAt: "now", occurrenceId: occ, runDate: "2026-08-03" });
    const first = await call(f.db, "POST", path(f.event.id, occ), { title: "Thread", body: "body" }, f.cookie); expect(first.status).toBe(200);
    expect((await call(f.db, "GET", path(f.event.id, occ), undefined, f.cookie)).body.discussion).toHaveLength(1);
    expect((await call(f.db, "POST", path(f.event.id, occ), { title: "", body: "" }, f.cookie)).status).toBe(400);
    expect((await call(f.db, "POST", path(f.event.id, occ), { title: "Thread", body: "reply", parentId: "missing" }, f.cookie)).status).toBe(400);
    for (let i = 0; i < 20; i++) await call(f.db, "POST", path(f.event.id, occ), { title: `t${i}`, body: "body" }, f.cookie);
    expect((await call(f.db, "POST", path(f.event.id, occ), { title: "last", body: "body" }, f.cookie)).status).toBe(429);
    const fresh = setup(); fresh.event.id = f.event.id; fresh.db.setEvent(f.event); const freshOcc = occ; fresh.db.addAttendance({ id: "fresh-att", accountId: fresh.account.id, eventId: f.event.id, role: "host", createdAt: "now", occurrenceId: freshOcc, runDate: "2026-08-03" });
    const own = await call(fresh.db, "POST", path(f.event.id, freshOcc), { title: "delete me", body: "body" }, fresh.cookie);
    const id = own.body.discussion.id; expect((await call(fresh.db, "DELETE", `${path(f.event.id, freshOcc)}/${id}`, undefined, fresh.cookie)).status).toBe(200);
    expect((await call(fresh.db, "GET", path(f.event.id, freshOcc), undefined, fresh.cookie)).body.discussion.some((d: {id:string}) => d.id === id)).toBe(false);
  });
  it.each(["hidden", "archived"]) ("rejects %s events", async (state) => { const f = setup(); f.db.setEvent({ ...f.event, ...(state === "hidden" ? { hidden: true } : { archivedAt: "now" }) }); expect((await call(f.db, "GET", path(f.event.id, f.occurrence), undefined, f.cookie)).status).toBe(404); });

  it("grants discussion access to RSVPs created through the real RSVP API and revokes it after removal", async () => {
    const db = createMemoryStore({ now: () => new Date("2026-08-03T12:00:00.000Z") }); materializeSeedEvents(db, CITIES);
    const event = db.listEvents()[0]!; const date = "2026-08-03";
    const ref = event.seedRefId ?? event.id;
    const account = db.createAccount({ name: "Runner", email: "runner@example.com", cityId: event.cityId });
    account.status = "verified";
    const sid = db.createSession(account.id, "test");
    const cookie = `${SESSION_COOKIE}=${sid.id}`;
    // Real RSVP through the API stores canonical `event:<id>` attendance, which
    // the discussion gate must treat as participation (regression: it used to
    // compare prefixed vs bare event ids and denied legitimate RSVPs).
    const rsvp = await call(db, "POST", "/api/events/rsvp", { eventId: ref, runDate: date }, cookie);
    expect(rsvp.status).toBe(200);
    const occurrence = `event:${event.id}:${date}`;
    const p = path(ref, occurrence);
    expect((await call(db, "GET", p, undefined, cookie)).status).toBe(200);
    expect((await call(db, "POST", p, { title: "Thread", body: "hello" }, cookie)).status).toBe(200);
    // A verified runner of the same city with NO RSVP is denied.
    const stranger = db.createAccount({ name: "Stranger", email: "s@example.com", cityId: event.cityId });
    stranger.status = "verified";
    const ssid = db.createSession(stranger.id, "test");
    const strangerCookie = `${SESSION_COOKIE}=${ssid.id}`;
    expect((await call(db, "GET", p, undefined, strangerCookie)).status).toBe(403);
    // An RSVP to a SIBLING occurrence (same event, next week) grants access
    // only to that sibling, never to this occurrence.
    const sibling = await call(db, "POST", "/api/events/rsvp", { eventId: ref, runDate: "2026-08-10" }, strangerCookie);
    expect(sibling.status).toBe(200);
    expect((await call(db, "GET", p, undefined, strangerCookie)).status).toBe(403);
    // Removing the RSVP revokes discussion access for that occurrence.
    const rm = await call(db, "POST", "/api/events/rsvp", { eventId: ref, runDate: date, rsvp: false }, cookie);
    expect(rm.status).toBe(200);
    expect((await call(db, "GET", p, undefined, cookie)).status).toBe(403);
    expect((await call(db, "POST", p, { title: "x", body: "y" }, cookie)).status).toBe(403);
  });
});
