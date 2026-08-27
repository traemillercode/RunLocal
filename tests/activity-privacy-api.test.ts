/**
 * HTTP tests for activity privacy (Build B1): run-activity data is
 * privacy-safe and renderable across three surfaces:
 *
 *   1. GET /api/activity/feed — viewer-aware public feed (session optional):
 *      shareMode "private" -> owner only; manual/auto -> canView(viewer, owner,
 *      show_past_activity) + bidirectional blocks; guests still see public
 *      cards (show_past_activity defaults to public).
 *   2. GET /api/runners/:id/activity — profile activity now carries the
 *      runner's activity cards alongside the (backward-compatible) forum
 *      posts, gated by canView + per-card shareMode + blocks.
 *   3. GET /api/connections/activity — cards from the caller's ACCEPTED
 *      connections only (same resolution as GET /api/connections), filtered
 *      by canView + shareMode + blocks; auth required.
 */
import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { apiHandler, SESSION_COOKIE } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import type { AccountRecord } from "../src/server/types";

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
  const inbox = await call(db, "GET", "/api/connections", { cookie: to.cookie });
  const requestId = inbox.body.requests[0]?.requestId;
  expect(requestId).toBeTruthy();
  const a = await call(db, "POST", `/api/connections/${requestId}/accept`, { cookie: to.cookie });
  expect(a.status).toBe(200);
}
/** POST /api/activity/manual — verified-only; strava is enabled by default. */
async function postManual(db: Db, acct: Acct, overrides: Record<string, unknown> = {}): Promise<{ id: string; distanceMeters: number }> {
  const r = await call(db, "POST", "/api/activity/manual", {
    cookie: acct.cookie,
    body: { provider: "strava", activity: { type: "run", distanceMeters: 5000, durationSeconds: 1800, completedAt: "2026-08-01T07:00:00.000Z" }, ...overrides },
  });
  expect(r.status).toBe(200);
  return { id: r.body.card.id, distanceMeters: r.body.card.distanceMeters };
}
/** Seed a card directly (e.g. shareMode "private", which the manual route never stamps). */
function seedCard(db: Db, acct: Acct, shareMode: "auto" | "manual" | "private"): string {
  const id = `act-${shareMode}-${acct.id.slice(0, 6)}-${Math.random().toString(36).slice(2, 8)}`;
  db.addActivity({ id, accountId: acct.id, provider: "strava", type: "run", distanceMeters: 1000, durationSeconds: 300, completedAt: "2026-08-02T07:00:00.000Z", shareMode });
  return id;
}
function feedCards(db: Db, city = "columbia-mo", cookie?: string) {
  return call(db, "GET", `/api/activity/feed?city=${encodeURIComponent(city)}`, cookie ? { cookie } : {});
}

describe("GET /api/activity/feed — viewer-aware privacy", () => {
  it("guest sees a public manual card for the same city (default show_past_activity public)", async () => {
    const db = createMemoryStore();
    const runner = account(db, "runner@example.com");
    await postManual(db, runner);
    const f = await feedCards(db);
    expect(f.status).toBe(200);
    expect(f.body.cards).toHaveLength(1);
    expect(f.body.cards[0]).toMatchObject({ provider: "strava", attribution: "Strava", distanceMeters: 5000 });
    expect(f.body.cards[0]).not.toHaveProperty("accountId");
    expect(f.body.cards[0]).not.toHaveProperty("caption");
  });

  it("excludes cards from other cities", async () => {
    const db = createMemoryStore();
    const runner = account(db, "runner@example.com", "columbia-mo");
    const otherCity = account(db, "other@example.com", "st-louis-mo");
    await postManual(db, runner);
    await postManual(db, otherCity);
    const f = await feedCards(db, "columbia-mo");
    expect(f.body.cards).toHaveLength(1);
    const g = await feedCards(db, "st-louis-mo");
    expect(g.body.cards).toHaveLength(1);
  });

  it("a blocked viewer never sees the blocker's card (bidirectional), strangers still do", async () => {
    const db = createMemoryStore();
    const a = account(db, "a@example.com");
    const b = account(db, "b@example.com");
    const c = account(db, "c@example.com");
    const cardB = await postManual(db, b);
    await call(db, "POST", `/api/connections/${b.id}/block`, { cookie: a.cookie }); // a blocks b

    const viewA = await feedCards(db, "columbia-mo", a.cookie);
    const viewC = await feedCards(db, "columbia-mo", c.cookie);
    expect(viewA.body.cards).toHaveLength(0); // b's card hidden from a
    expect(viewC.body.cards).toHaveLength(1); // stranger unaffected

    // add a's own card -> b (blocked by a) must not see it either, but keeps own
    const cardA = await postManual(db, a);
    const viewB2 = await feedCards(db, "columbia-mo", b.cookie);
    const viewC2 = await feedCards(db, "columbia-mo", c.cookie);
    const bIds = viewB2.body.cards.map((card: { id: string }) => card.id);
    expect(bIds).toContain(cardB.id); // b still sees own card (self always passes)
    expect(bIds).not.toContain(cardA.id); // a's card hidden from b
    expect(viewC2.body.cards).toHaveLength(2); // stranger sees both
  });

  it("a private shareMode card is visible only to its owner", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const other = account(db, "other@example.com");
    seedCard(db, owner, "private");

    const guest = await feedCards(db);
    const stranger = await feedCards(db, "columbia-mo", other.cookie);
    const self = await feedCards(db, "columbia-mo", owner.cookie);
    expect(guest.body.cards).toHaveLength(0);
    expect(stranger.body.cards).toHaveLength(0);
    expect(self.body.cards).toHaveLength(1);
    expect(self.body.cards[0].id).toMatch(/^act-private-/);
  });

  it("show_past_activity=false hides the owner's cards from everyone except the owner", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const other = account(db, "other@example.com");
    await postManual(db, owner);
    await call(db, "PUT", "/api/profile/privacy", { body: { show_past_activity: "private" }, cookie: owner.cookie });

    const guest = await feedCards(db);
    const stranger = await feedCards(db, "columbia-mo", other.cookie);
    const self = await feedCards(db, "columbia-mo", owner.cookie);
    expect(guest.body.cards).toHaveLength(0);
    expect(stranger.body.cards).toHaveLength(0);
    expect(self.body.cards).toHaveLength(1); // owner always sees own card
  });
});

describe("GET /api/runners/:id/activity — profile activity cards", () => {
  it("guest sees the runner's public manual card AND the forum posts (backward-compatible payload)", async () => {
    const db = createMemoryStore();
    const runner = account(db, "runner@example.com");
    await postManual(db, runner);
    const post = await call(db, "POST", "/api/forum", { cookie: runner.cookie, body: { section: "community", title: "Morning miles", body: "Great sunrise run today." } });
    expect(post.status).toBe(200);

    const f = await call(db, "GET", `/api/runners/${runner.id}/activity`);
    expect(f.status).toBe(200);
    expect(f.body.activity).toHaveLength(1);
    expect(f.body.activity[0]).toMatchObject({ title: "Morning miles", section: "community" });
    expect(f.body.activityCards).toHaveLength(1);
    expect(f.body.activityCards[0]).toMatchObject({ distanceMeters: 5000, attribution: "Strava" });
  });

  it("show_past_activity=false hides cards (and posts) from a guest", async () => {
    const db = createMemoryStore();
    const runner = account(db, "runner@example.com");
    await postManual(db, runner);
    await call(db, "PUT", "/api/profile/privacy", { body: { show_past_activity: "private" }, cookie: runner.cookie });

    const f = await call(db, "GET", `/api/runners/${runner.id}/activity`);
    expect(f.status).toBe(200);
    expect(f.body).toEqual({ activity: [], activityCards: [] });
  });

  it("private shareMode cards are hidden from others and shown to the owner", async () => {
    const db = createMemoryStore();
    const runner = account(db, "runner@example.com");
    const other = account(db, "other@example.com");
    seedCard(db, runner, "private");

    const stranger = await call(db, "GET", `/api/runners/${runner.id}/activity`, { cookie: other.cookie });
    expect(stranger.body.activityCards).toHaveLength(0);

    const self = await call(db, "GET", `/api/runners/${runner.id}/activity`, { cookie: runner.cookie });
    expect(self.body.activityCards).toHaveLength(1);
    expect(self.body.activityCards[0].id).toMatch(/^act-private-/);
  });

  it("a blocked viewer sees no activityCards (canView blocked beats everything)", async () => {
    const db = createMemoryStore();
    const runner = account(db, "runner@example.com");
    const viewer = account(db, "viewer@example.com");
    await postManual(db, runner);
    await call(db, "POST", `/api/connections/${runner.id}/block`, { cookie: viewer.cookie });

    const f = await call(db, "GET", `/api/runners/${runner.id}/activity`, { cookie: viewer.cookie });
    expect(f.status).toBe(200);
    expect(f.body).toEqual({ activity: [], activityCards: [] });
  });
});

describe("GET /api/connections/activity — connections-scoped feed", () => {
  it("guests are rejected (401)", async () => {
    const db = createMemoryStore();
    expect((await call(db, "GET", "/api/connections/activity")).status).toBe(401);
  });

  it("caller sees an accepted connection's public manual card, with owner attribution", async () => {
    const db = createMemoryStore();
    const viewer = account(db, "viewer@example.com");
    const conn = account(db, "conn@example.com");
    await connect(db, viewer, conn);
    await postManual(db, conn);

    const f = await call(db, "GET", "/api/connections/activity", { cookie: viewer.cookie });
    expect(f.status).toBe(200);
    expect(f.body.cards).toHaveLength(1);
    expect(f.body.cards[0]).toMatchObject({ distanceMeters: 5000, owner: { accountId: conn.id, name: conn.email } });
  });

  it("never includes a non-connection's card", async () => {
    const db = createMemoryStore();
    const viewer = account(db, "viewer@example.com");
    const conn = account(db, "conn@example.com");
    const stranger = account(db, "stranger@example.com");
    await connect(db, viewer, conn);
    await postManual(db, conn);
    await postManual(db, stranger);

    const f = await call(db, "GET", "/api/connections/activity", { cookie: viewer.cookie });
    expect(f.body.cards).toHaveLength(1);
    expect(f.body.cards[0].owner.accountId).toBe(conn.id);
  });

  it("a blocked connection's card is hidden", async () => {
    const db = createMemoryStore();
    const viewer = account(db, "viewer@example.com");
    const conn = account(db, "conn@example.com");
    await connect(db, viewer, conn);
    await postManual(db, conn);
    await call(db, "POST", `/api/connections/${conn.id}/block`, { cookie: viewer.cookie });

    const f = await call(db, "GET", "/api/connections/activity", { cookie: viewer.cookie });
    expect(f.status).toBe(200);
    expect(f.body.cards).toHaveLength(0);
  });

  it("private cards and show_past_activity=false connections are hidden", async () => {
    const db = createMemoryStore();
    const viewer = account(db, "viewer@example.com");
    const connA = account(db, "conna@example.com");
    const connB = account(db, "connb@example.com");
    await connect(db, viewer, connA);
    await connect(db, viewer, connB);
    seedCard(db, connA, "private"); // private -> hidden
    await postManual(db, connB);
    await call(db, "PUT", "/api/profile/privacy", { body: { show_past_activity: "private" }, cookie: connB.cookie }); // owner hid past activity

    const f = await call(db, "GET", "/api/connections/activity", { cookie: viewer.cookie });
    expect(f.status).toBe(200);
    expect(f.body.cards).toHaveLength(0);
  });

  it("connections_only privacy still shows cards to the accepted connection", async () => {
    const db = createMemoryStore();
    const viewer = account(db, "viewer@example.com");
    const conn = account(db, "conn@example.com");
    await connect(db, viewer, conn);
    await postManual(db, conn);
    await call(db, "PUT", "/api/profile/privacy", { body: { show_past_activity: "connections_only" }, cookie: conn.cookie });

    const f = await call(db, "GET", "/api/connections/activity", { cookie: viewer.cookie });
    expect(f.status).toBe(200);
    expect(f.body.cards).toHaveLength(1); // accepted connection passes connections_only
  });
});
