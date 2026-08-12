/**
 * HTTP tests for the Connections & Privacy endpoints (part B):
 *   GET /api/connections, POST /api/connections/:id/request|accept|decline|
 *   remove|block, GET /api/people/search, GET /api/runners/:id (connection
 *   state + mutual fields), GET /api/events/:id/occurrences/:occ/
 *   connections-going, GET/PUT /api/profile/privacy.
 *
 * The full lifecycle is exercised over HTTP (in-memory store + call()
 * harness, same as tests/event-moderation-api.test.ts) and all six owner
 * edge cases are pinned at the API level:
 *   1. A requests B, B requests A -> single row, both see connected;
 *   2. A blocks B -> third party C's mutualConnectionsCount on A's AND B's
 *      profiles excludes the pair;
 *   3. decline then request from EITHER side -> pending again;
 *   4. remove -> row soft-deleted (store shows status "removed") and a new
 *      request works;
 *   5. visibilityOverride beats the global show_upcoming_events inside
 *      connections-going (canView resolves it);
 *   6. searchable_by_name=false -> absent from /api/people/search for
 *      strangers AND connections; profile-by-id + connection views unaffected.
 */
import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { apiHandler, SESSION_COOKIE } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { materializeSeedEvents } from "../src/server/events";
import { CITIES } from "../src/data/cities";
import { defaultOccurrenceDate, resolveOccurrence } from "../src/server/occurrences";
import type { AccountRecord } from "../src/server/types";

const NOW = new Date("2026-08-12T00:00:00.000Z");
const NOW_ISO = NOW.toISOString();

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

interface Acct { id: string; email: string; cookie: string; }
function account(db: Db, email: string, cityId = "columbia-mo", patch: Partial<AccountRecord> = {}): Acct {
  const rec = db.createAccount({ name: email, email, cityId });
  db.updateAccount(rec.id, { status: "verified", ...patch });
  const sid = db.createSession(rec.id, "test");
  return { id: rec.id, email: rec.email, cookie: `${SESSION_COOKIE}=${sid.id}` };
}
/** Full connect via the HTTP endpoints (accept takes the REQUEST id). */
async function connect(db: Db, from: Acct, to: Acct): Promise<void> {
  const r = await call(db, "POST", `/api/connections/${to.id}/request`, { cookie: from.cookie });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe("pending");
  const inbox = await call(db, "GET", "/api/connections", { cookie: to.cookie });
  const requestId = inbox.body.requests[0]?.requestId;
  expect(requestId).toBeTruthy();
  const a = await call(db, "POST", `/api/connections/${requestId}/accept`, { cookie: to.cookie });
  expect(a.status).toBe(200);
}

function setup() {
  const db = createMemoryStore();
  materializeSeedEvents(db, CITIES);
  return { db };
}
const seedByRef = (db: Db, refId: string) => db.listEvents().find((e) => e.seedRefId === refId)!;

/** Add an occurrence-exact RSVP attendance row directly (server-authoritative storage). */
function attend(db: Db, accountId: string, eventId: string, occurrenceId: string, visibilityOverride: "inherit" | "public" | "connections_only" | "private" = "inherit") {
  const runDate = occurrenceId.slice(occurrenceId.lastIndexOf(":") + 1);
  db.addAttendance({ id: `att-${accountId}-${eventId}-${runDate}`, accountId, eventId, role: "rsvp", createdAt: NOW_ISO, occurrenceId, runDate, startsAt: `${runDate}T17:00:00.000Z`, visibilityOverride });
}

describe("connection lifecycle over HTTP", () => {
  it("guests are rejected everywhere (401)", async () => {
    const { db } = setup();
    const other = account(db, "other@example.com");
    expect((await call(db, "GET", "/api/connections")).status).toBe(401);
    expect((await call(db, "POST", `/api/connections/${other.id}/request`)).status).toBe(401);
    expect((await call(db, "POST", `/api/connections/${other.id}/accept`)).status).toBe(401);
    expect((await call(db, "POST", `/api/connections/${other.id}/decline`)).status).toBe(401);
    expect((await call(db, "POST", `/api/connections/${other.id}/remove`)).status).toBe(401);
    expect((await call(db, "POST", `/api/connections/${other.id}/block`)).status).toBe(401);
  });

  it("request -> inbox shows it -> accept -> connected; addressee-only accept (404 for others)", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    const b = account(db, "b@example.com");
    const c = account(db, "c@example.com");

    const r = await call(db, "POST", `/api/connections/${b.id}/request`, { cookie: a.cookie });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "pending", resolved: false });
    const requestId = r.body.requestId ?? (await call(db, "GET", "/api/connections", { cookie: b.cookie })).body.requests[0].requestId;

    const inbox = await call(db, "GET", "/api/connections", { cookie: b.cookie });
    expect(inbox.status).toBe(200);
    expect(inbox.body.pendingCount).toBe(1);
    expect(inbox.body.requests).toHaveLength(1);
    expect(inbox.body.requests[0].requestId).toBe(requestId);
    expect(inbox.body.requests[0].from.id).toBe(a.id);
    expect(inbox.body.requests[0].createdAt).toBeTruthy();
    expect(inbox.body.connections).toHaveLength(0);

    // requester and strangers cannot accept (existence never leaked)
    expect((await call(db, "POST", `/api/connections/${requestId}/accept`, { cookie: a.cookie })).status).toBe(404);
    expect((await call(db, "POST", `/api/connections/${requestId}/accept`, { cookie: c.cookie })).status).toBe(404);
    expect((await call(db, "POST", `/api/connections/${requestId}/accept`)).status).toBe(401);

    const acc = await call(db, "POST", `/api/connections/${requestId}/accept`, { cookie: b.cookie });
    expect(acc.status).toBe(200);
    expect(acc.body.status).toBe("accepted");

    const after = await call(db, "GET", "/api/connections", { cookie: a.cookie });
    expect(after.body.connections).toHaveLength(1);
    expect(after.body.connections[0]).toMatchObject({ id: b.id, connectionState: "connected" });
    expect(after.body.pendingCount).toBe(0);
  });

  it("request validation: unknown target 404, self 400, blocked pair 403, idempotent re-request", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    expect((await call(db, "POST", "/api/connections/does-not-exist/request", { cookie: a.cookie })).status).toBe(404);
    expect((await call(db, "POST", `/api/connections/${a.id}/request`, { cookie: a.cookie })).status).toBe(400);
    const b = account(db, "b@example.com");
    await call(db, "POST", `/api/connections/${a.id}/block`, { cookie: b.cookie });
    expect((await call(db, "POST", `/api/connections/${b.id}/request`, { cookie: a.cookie })).status).toBe(403);
    // same-direction duplicate is idempotent (still pending)
    const c = account(db, "c@example.com");
    const r1 = await call(db, "POST", `/api/connections/${c.id}/request`, { cookie: a.cookie });
    const r2 = await call(db, "POST", `/api/connections/${c.id}/request`, { cookie: a.cookie });
    expect(r1.body.status).toBe("pending");
    expect(r2.body.status).toBe("pending");
    expect(r2.body.resolved).toBe(false);
  });

  it("block writes a block, marks active rows removed, and unblock via POST /api/blocks DELETE restores", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    const b = account(db, "b@example.com");
    await connect(db, a, b);
    expect(db.getConnectionPair(a.id, b.id)?.status).toBe("accepted");

    const blk = await call(db, "POST", `/api/connections/${b.id}/block`, { cookie: a.cookie });
    expect(blk.status).toBe(200);
    expect(blk.body.status).toBe("blocked");
    expect(db.isBlocked(a.id, b.id)).toBe(true);
    expect(db.getConnectionPair(a.id, b.id)?.status).toBe("removed");
    expect((await call(db, "GET", "/api/connections", { cookie: a.cookie })).body.connections).toHaveLength(0);

    // blocked pair cannot request from either side
    expect((await call(db, "POST", `/api/connections/${a.id}/request`, { cookie: b.cookie })).status).toBe(403);

    // unblock via the EXISTING single block system
    const un = await call(db, "DELETE", "/api/blocks", { body: { accountId: b.id }, cookie: a.cookie });
    expect(un.status).toBe(200);
    expect(db.isBlocked(a.id, b.id)).toBe(false);
    // a fresh request now works (removed history never blocks)
    const r = await call(db, "POST", `/api/connections/${b.id}/request`, { cookie: a.cookie });
    expect(r.body.status).toBe("pending");
  });
});

describe("EDGE CASE 1 — cross-pending auto-accept (HTTP)", () => {
  it("A requests B then B requests A: single row, both see connected, resolved flag set", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    const b = account(db, "b@example.com");

    const r1 = await call(db, "POST", `/api/connections/${b.id}/request`, { cookie: a.cookie });
    expect(r1.body.status).toBe("pending");
    const r2 = await call(db, "POST", `/api/connections/${a.id}/request`, { cookie: b.cookie });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ status: "accepted", resolved: true });

    // exactly ONE row in the store
    const rows = [...(db as unknown as { connections: Map<string, unknown> }).connections.values()];
    expect(rows).toHaveLength(1);

    // both sides see connected
    const va = await call(db, "GET", "/api/connections", { cookie: a.cookie });
    const vb = await call(db, "GET", "/api/connections", { cookie: b.cookie });
    expect(va.body.connections.map((x: { id: string }) => x.id)).toContain(b.id);
    expect(vb.body.connections.map((x: { id: string }) => x.id)).toContain(a.id);
    expect(va.body.pendingCount).toBe(0);
    expect(vb.body.pendingCount).toBe(0);
  });
});

describe("EDGE CASE 3 — decline then request from EITHER side (HTTP)", () => {
  it("decline keeps the row as history; a later request from either side goes pending again", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    const b = account(db, "b@example.com");

    const r1 = await call(db, "POST", `/api/connections/${b.id}/request`, { cookie: a.cookie });
    const requestId = r1.body.requestId ?? (await call(db, "GET", "/api/connections", { cookie: b.cookie })).body.requests[0].requestId;
    const dec = await call(db, "POST", `/api/connections/${requestId}/decline`, { cookie: b.cookie });
    expect(dec.status).toBe(200);
    expect(dec.body.status).toBe("declined");
    expect(db.getConnectionPair(a.id, b.id)?.status).toBe("declined");
    expect((await call(db, "GET", "/api/connections", { cookie: b.cookie })).body.pendingCount).toBe(0);

    // requester retries
    const r2 = await call(db, "POST", `/api/connections/${b.id}/request`, { cookie: a.cookie });
    expect(r2.body.status).toBe("pending");
    const requestId2 = (await call(db, "GET", "/api/connections", { cookie: b.cookie })).body.requests[0].requestId;
    expect(requestId2).not.toBe(requestId);
    // decline again, then the OTHER side requests
    await call(db, "POST", `/api/connections/${requestId2}/decline`, { cookie: b.cookie });
    const r3 = await call(db, "POST", `/api/connections/${a.id}/request`, { cookie: b.cookie });
    expect(r3.body.status).toBe("pending");
    const inbox = await call(db, "GET", "/api/connections", { cookie: a.cookie });
    expect(inbox.body.requests[0].from.id).toBe(b.id);
  });
});

describe("EDGE CASE 4 — remove soft-deletes (HTTP + store)", () => {
  it("remove marks the row 'removed' (never hard-deleted) and a new request works after", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    const b = account(db, "b@example.com");
    await connect(db, a, b);
    const before = db.getConnectionPair(a.id, b.id)!;

    const rm = await call(db, "POST", `/api/connections/${b.id}/remove`, { cookie: a.cookie });
    expect(rm.status).toBe(200);
    expect(rm.body.status).toBe("removed");

    // SOFT-DELETE semantics persist at the store level: same row, status removed
    const after = db.getConnectionPair(a.id, b.id)!;
    expect(after.id).toBe(before.id);
    expect(after.status).toBe("removed");
    expect(after.removedAt).toBeTruthy();
    expect((await call(db, "GET", "/api/connections", { cookie: a.cookie })).body.connections).toHaveLength(0);
    // removing again (not connected) -> 404
    expect((await call(db, "POST", `/api/connections/${b.id}/remove`, { cookie: a.cookie })).status).toBe(404);

    // either side may request again
    const r = await call(db, "POST", `/api/connections/${a.id}/request`, { cookie: b.cookie });
    expect(r.body.status).toBe("pending");
    expect((await call(db, "GET", "/api/connections", { cookie: a.cookie })).body.pendingCount).toBe(1);
  });
});

describe("EDGE CASE 2 — mutual counts exclude blocked pairs (HTTP profile views)", () => {
  it("after A blocks B, third party C's mutualConnectionsCount on A's AND B's profiles drops", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    const b = account(db, "b@example.com");
    const c = account(db, "c@example.com");
    await connect(db, a, b);
    await connect(db, a, c);
    await connect(db, b, c);

    const beforeA = await call(db, "GET", `/api/runners/${a.id}`, { cookie: c.cookie });
    expect(beforeA.body.profile).toMatchObject({ id: a.id, connectionState: "connected", mutualVisible: true, mutualConnectionsCount: 1 });

    await call(db, "POST", `/api/connections/${b.id}/block`, { cookie: a.cookie });

    const viewA = await call(db, "GET", `/api/runners/${a.id}`, { cookie: c.cookie });
    const viewB = await call(db, "GET", `/api/runners/${b.id}`, { cookie: c.cookie });
    expect(viewA.body.profile.mutualConnectionsCount).toBe(0);
    expect(viewB.body.profile.mutualConnectionsCount).toBe(0);
    expect(viewA.body.profile.mutualVisible).toBe(true);
  });
});

describe("EDGE CASE 6 — searchable_by_name is a search filter only (HTTP)", () => {
  it("searchable_by_name=false hides from /api/people/search for strangers AND connections; profile + connection views unaffected", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    const b = account(db, "b@example.com");
    const c = account(db, "c@example.com");
    await connect(db, a, b);

    await call(db, "PUT", "/api/profile/privacy", { body: { searchable_by_name: false }, cookie: a.cookie });

    // absent from search for both the connection and a stranger
    for (const viewer of [b, c]) {
      const s = await call(db, "GET", `/api/people/search?q=${encodeURIComponent(a.email.split("@")[0])}`, { cookie: viewer.cookie });
      expect(s.status).toBe(200);
      expect(s.body.people.map((p: { id: string }) => p.id)).not.toContain(a.id);
    }
    // profile-by-id still works for the connection (state included)
    const prof = await call(db, "GET", `/api/runners/${a.id}`, { cookie: b.cookie });
    expect(prof.status).toBe(200);
    expect(prof.body.profile.connectionState).toBe("connected");
    // connection view unaffected
    const conns = await call(db, "GET", "/api/connections", { cookie: b.cookie });
    expect(conns.body.connections.map((x: { id: string }) => x.id)).toContain(a.id);

    // flipping it back restores searchability
    await call(db, "PUT", "/api/profile/privacy", { body: { searchable_by_name: true }, cookie: a.cookie });
    const s2 = await call(db, "GET", `/api/people/search?q=${encodeURIComponent(a.email.split("@")[0])}`, { cookie: c.cookie });
    expect(s2.body.people.map((p: { id: string }) => p.id)).toContain(a.id);
  });
});

describe("GET /api/people/search", () => {
  it("searches verified accounts by name/username (case-insensitive), excludes the viewer, empty q -> []", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    account(db, "zoe-runner@example.com");
    const pending = db.createAccount({ name: "pending-person", email: "pending@example.com", cityId: "columbia-mo" }); // not verified
    db.createSession(pending.id, "test");

    const r = await call(db, "GET", "/api/people/search?q=ZOE", { cookie: a.cookie });
    expect(r.status).toBe(200);
    expect(r.body.people).toHaveLength(1);
    expect(r.body.people[0].name).toBe("zoe-runner@example.com");
    expect(r.body.people[0]).toHaveProperty("connectionState");

    // the viewer never appears in their own results
    const self = await call(db, "GET", `/api/people/search?q=${encodeURIComponent(a.email.split("@")[0])}`, { cookie: a.cookie });
    expect(self.body.people.map((p: { id: string }) => p.id)).not.toContain(a.id);
    // pending accounts are not searchable
    const pend = await call(db, "GET", "/api/people/search?q=pending", { cookie: a.cookie });
    expect(pend.body.people).toHaveLength(0);
    // empty q -> empty list
    expect((await call(db, "GET", "/api/people/search?q=", { cookie: a.cookie })).body.people).toHaveLength(0);
    // guests 401
    expect((await call(db, "GET", "/api/people/search?q=zoe")).status).toBe(401);
  });

  it("excludes anyone the viewer blocked or who blocked the viewer", async () => {
    const { db } = setup();
    const a = account(db, "alice@example.com");
    const b = account(db, "bob@example.com");
    const c = account(db, "carol@example.com");
    await call(db, "POST", `/api/connections/${b.id}/block`, { cookie: a.cookie }); // a blocks b
    await call(db, "POST", `/api/connections/${c.id}/block`, { cookie: c.cookie }); // c blocks... c blocks a? no: c blocks a
    // a blocks b -> b invisible to a; a blocks... let's also make c block a
    const sA = await call(db, "GET", "/api/people/search?q=bob", { cookie: a.cookie });
    expect(sA.body.people).toHaveLength(0);
    const sB = await call(db, "GET", "/api/people/search?q=alice", { cookie: b.cookie });
    expect(sB.body.people).toHaveLength(0);
    // a stranger unaffected by the a<->b block
    const d = account(db, "dave@example.com");
    const sD = await call(db, "GET", "/api/people/search?q=bob", { cookie: d.cookie });
    expect(sD.body.people.map((p: { id: string }) => p.id)).toContain(b.id);
  });
});

describe("GET /api/runners/:id — profile additions", () => {
  it("guest sees connectionState null and mutualVisible false for connections_only default", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    const g = await call(db, "GET", `/api/runners/${a.id}`);
    expect(g.status).toBe(200);
    expect(g.body.profile.connectionState).toBeNull();
    expect(g.body.profile.mutualVisible).toBe(false);
    expect(g.body.profile.mutualConnectionsCount).toBe(0);
  });

  it("mutualVisible opens for guests when show_connections_list is public", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    await call(db, "PUT", "/api/profile/privacy", { body: { show_connections_list: "public" }, cookie: a.cookie });
    const g = await call(db, "GET", `/api/runners/${a.id}`);
    expect(g.body.profile.mutualVisible).toBe(true);
    expect(g.body.profile.mutualConnectionsCount).toBe(0); // guests have no connections
  });
});

describe("EDGE CASE 5 — connections-going respects visibilityOverride via canView", () => {
  function goingSetup() {
    const { db } = setup();
    const viewer = account(db, "viewer@example.com");
    const a1 = account(db, "attendee1@example.com");
    const a2 = account(db, "attendee2@example.com");
    const a3 = account(db, "attendee3@example.com");
    const stranger = account(db, "stranger@example.com");
    const ev = seedByRef(db, "mon-social");
    const runDate = defaultOccurrenceDate(ev, NOW);
    const occ = resolveOccurrence(db, ev.id, runDate)!;
    return { db, viewer, a1, a2, a3, stranger, ev, occ };
  }

  it("override 'private' + global 'public' hides; override 'public' + global 'private' shows for a connection", async () => {
    const { db, viewer, a1, a2, a3, stranger, occ } = goingSetup();
    for (const u of [a1, a2, a3, stranger]) await connect(db, viewer, u);

    // a1: global public, event override private -> hidden
    await call(db, "PUT", "/api/profile/privacy", { body: { show_upcoming_events: "public" }, cookie: a1.cookie });
    attend(db, a1.id, occ.eventId, occ.occurrenceId, "private");
    // a2: global private, event override public -> visible (the override flips it)
    await call(db, "PUT", "/api/profile/privacy", { body: { show_upcoming_events: "private" }, cookie: a2.cookie });
    attend(db, a2.id, occ.eventId, occ.occurrenceId, "public");
    // a3: global default connections_only, no override -> visible to the connected viewer
    attend(db, a3.id, occ.eventId, occ.occurrenceId, "inherit");
    // nobody is NOT a connection of the viewer but attends -> never included
    const nobody = account(db, "nobody@example.com");
    attend(db, nobody.id, occ.eventId, occ.occurrenceId, "inherit");

    const url = `/api/events/${occ.eventId}/occurrences/${encodeURIComponent(occ.occurrenceId)}/connections-going`;
    const r = await call(db, "GET", url, { cookie: viewer.cookie });
    expect(r.status).toBe(200);
    const ids = (r.body as Array<{ accountId: string }>).map((x) => x.accountId).sort();
    expect(ids).toEqual([a2.id, a3.id].sort()); // a1 hidden by override, nobody not connected
  });

  it("auth: guests 401, pending accounts 403; unknown occurrence 404", async () => {
    const { db, occ } = goingSetup();
    const url = `/api/events/${occ.eventId}/occurrences/${encodeURIComponent(occ.occurrenceId)}/connections-going`;
    expect((await call(db, "GET", url)).status).toBe(401);
    const pending = db.createAccount({ name: "pending", email: "pend@example.com", cityId: "columbia-mo" });
    const sid = db.createSession(pending.id, "test");
    expect((await call(db, "GET", url, { cookie: `${SESSION_COOKIE}=${sid.id}` })).status).toBe(403);
    expect((await call(db, "GET", "/api/events/missing/occurrences/event:missing:2026-08-17/connections-going", { cookie: (await account(db, "x@example.com")).cookie })).status).toBe(404);
  });
});

describe("GET/PUT /api/profile/privacy", () => {
  it("GET returns the full defaults; PUT merges partial updates", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    const g = await call(db, "GET", "/api/profile/privacy", { cookie: a.cookie });
    expect(g.status).toBe(200);
    expect(g.body.settings).toMatchObject({
      profile_visibility: "public",
      show_upcoming_events: "connections_only",
      show_saved_events: "private",
      show_past_activity: "public",
      show_connections_list: "connections_only",
      show_tagged_content: "connections_only",
      searchable_by_name: true,
    });

    const put = await call(db, "PUT", "/api/profile/privacy", { body: { show_upcoming_events: "private" }, cookie: a.cookie });
    expect(put.status).toBe(200);
    expect(put.body.settings.show_upcoming_events).toBe("private");
    expect(put.body.settings.profile_visibility).toBe("public"); // untouched field preserved

    // guests 401
    expect((await call(db, "GET", "/api/profile/privacy")).status).toBe(401);
    expect((await call(db, "PUT", "/api/profile/privacy", { body: {} })).status).toBe(401);
  });

  it("validation: show_saved_events never public; unknown fields rejected; bad values rejected", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    const bad = async (body: Record<string, unknown>) => (await call(db, "PUT", "/api/profile/privacy", { body, cookie: a.cookie })).status;
    expect(await bad({ show_saved_events: "public" })).toBe(400);
    expect(await bad({ show_saved_events: "connections_only" })).toBe(200);
    expect(await bad({ bogus_field: true })).toBe(400);
    expect(await bad({ show_upcoming_events: "everyone" })).toBe(400);
    expect(await bad({ searchable_by_name: "yes" })).toBe(400);
  });
});
