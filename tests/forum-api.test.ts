/**
 * Forum posting API — server-authoritative tests.
 *
 * Pins the production slice: verified members can actually POST to the forum
 * (server-persisted, city-scoped to the author's home city), while guests /
 * pending / rejected / suspended / deleted accounts are denied with explicit
 * errors, input is validated, posting is rate-limited, moderation-hiding
 * removes posts from the public read, and the public payload never leaks
 * account data (only the public display name).
 */
import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { apiHandler, SESSION_COOKIE } from "../src/server/api";
import { createMemoryStore } from "../src/server/store";
import { CITIES } from "../src/data/cities";
import { publicForumPosts } from "../src/server/forum";
import type { ForumPostRecord } from "../src/server/types";

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
  const db = createMemoryStore({ now: () => new Date("2026-08-03T12:00:00.000Z") });
  const city = CITIES[0]!;
  const account = db.createAccount({ name: "Taylor Runner", email: "taylor@example.com", cityId: city.id });
  account.status = "verified";
  const sid = db.createSession(account.id, "test");
  return { db, city, account, cookie: `${SESSION_COOKIE}=${sid.id}` };
}
const post = (overrides: Record<string, unknown> = {}) => ({ section: "community", title: "New group route", body: "We added a 5K loop along the river.", ...overrides });

describe("forum GET /api/forum", () => {
  it("serves an empty user-post list for a known city and rejects unknown cities", async () => {
    const f = setup();
    const r = await call(f.db, "GET", `/api/forum?city=${encodeURIComponent(f.city.id)}`);
    expect(r.status).toBe(200);
    expect(r.body.posts).toEqual([]);
    expect((await call(f.db, "GET", "/api/forum?city=not-a-city")).status).toBe(400);
  });

  it("is public — anonymous reads work and the payload carries only public fields", async () => {
    const f = setup();
    await call(f.db, "POST", "/api/forum", post(), f.cookie);
    const r = await call(f.db, "GET", `/api/forum?city=${encodeURIComponent(f.city.id)}`);
    expect(r.status).toBe(200);
    const p = r.body.posts[0];
    expect(p.title).toBe("New group route");
    expect(p.author).toBe("Taylor Runner");
    expect(p.replies).toBe(0);
    expect(p.section).toBe("community");
    expect(p.authorNote).toBeNull();
    expect(Object.keys(p).sort()).toEqual(["author", "authorId", "authorNote", "body", "capabilities", "category", "createdAt", "hasVoted", "id", "linkedEvent", "pinned", "replies", "section", "title", "voteCount"]);
    expect(JSON.stringify(r.body)).not.toContain("taylor@example.com");
  });
});

describe("forum POST /api/forum", () => {
  it("denies guests, pending, rejected, suspended, and deleted accounts", async () => {
    const f = setup();
    expect((await call(f.db, "POST", "/api/forum", post())).status).toBe(401);
    f.account.status = "pending"; expect((await call(f.db, "POST", "/api/forum", post(), f.cookie)).status).toBe(403);
    f.account.status = "rejected"; expect((await call(f.db, "POST", "/api/forum", post(), f.cookie)).status).toBe(403);
    f.account.status = "verified"; f.account.suspended = true; f.account.suspendedUntil = null;
    expect((await call(f.db, "POST", "/api/forum", post(), f.cookie)).status).toBe(403);
    f.account.suspended = false; f.account.deletedAt = new Date().toISOString();
    expect((await call(f.db, "POST", "/api/forum", post(), f.cookie)).status).toBe(401);
  });

  it("accepts a verified member's post, persists it, and scopes it to their home city", async () => {
    const f = setup();
    const r = await call(f.db, "POST", "/api/forum", post(), f.cookie);
    expect(r.status).toBe(200);
    expect(r.body.post.title).toBe("New group route");
    const listed = publicForumPosts(f.db, f.city.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.title).toBe("New group route");
    const record: ForumPostRecord | undefined = f.db.getForumPost(listed[0]!.id);
    expect(record?.authorAccountId).toBe(f.account.id);
    expect(record?.cityId).toBe(f.city.id);
    expect(record?.state).toBe("visible");
    // Moderation registry row exists so existing admin hide/archive paths apply.
    expect(f.db.getContent(`post:${record!.id}`)?.kind).toBe("post");
  });

  it("rejects a member whose home city is not set (city-scoped community)", async () => {
    const f = setup();
    f.account.cityId = null;
    const r = await call(f.db, "POST", "/api/forum", post(), f.cookie);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("city_required");
  });

  it("validates section, title, and body", async () => {
    const f = setup();
    expect((await call(f.db, "POST", "/api/forum", post({ section: "spam" }), f.cookie)).status).toBe(400);
    expect((await call(f.db, "POST", "/api/forum", post({ title: "   " }), f.cookie)).status).toBe(400);
    expect((await call(f.db, "POST", "/api/forum", post({ body: "" }), f.cookie)).status).toBe(400);
    expect((await call(f.db, "POST", "/api/forum", post({ title: "x".repeat(121) }), f.cookie)).status).toBe(400);
    expect((await call(f.db, "POST", "/api/forum", post({ body: "y".repeat(2001) }), f.cookie)).status).toBe(400);
  });

  it("rate-limits posting (10/hour per account) and isolates other accounts", async () => {
    const f = setup();
    for (let i = 0; i < 10; i++) expect((await call(f.db, "POST", "/api/forum", post({ title: `t${i}` }), f.cookie)).status).toBe(200);
    expect((await call(f.db, "POST", "/api/forum", post({ title: "eleventh" }), f.cookie)).status).toBe(429);
    const other = await dbWithoutRate(f.db, f.city.id);
    expect(other.status).toBe(200);
  });

  it("linkedEventId: accepts a real published event in the author's city, silently drops a fabricated/cross-city/hidden one instead of rejecting the whole post", async () => {
    const f = setup();
    const realEvent = { id: "ev-real", seedRefId: null, cityId: f.city.id, groupId: "", title: "Thursday Group Run", dayOfWeek: 3, scheduleDate: null, time: "6:00 PM", location: "MKT Trailhead", distanceLabel: "4 mi", invite: "Open to all" as const, externalUrl: null, provenance: "community" as const, status: "published" as const, hidden: false, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", createdBy: f.account.id, updatedBy: f.account.id, archivedAt: null };
    f.db.setEvent(realEvent);
    const otherCityEvent = { ...realEvent, id: "ev-other-city", cityId: "not-" + f.city.id };
    f.db.setEvent(otherCityEvent);
    const hiddenEvent = { ...realEvent, id: "ev-hidden", hidden: true };
    f.db.setEvent(hiddenEvent);

    const good = await call(f.db, "POST", "/api/forum", post({ linkedEventId: "ev-real" }), f.cookie);
    expect(good.body.post.linkedEvent?.id).toBe("ev-real");
    expect(good.body.post.linkedEvent?.title).toBe("Thursday Group Run");

    const fabricated = await call(f.db, "POST", "/api/forum", post({ linkedEventId: "does-not-exist" }), f.cookie);
    expect(fabricated.status).toBe(200); // never rejects the whole post over a bad reference
    expect(fabricated.body.post.linkedEvent).toBeNull();

    const crossCity = await call(f.db, "POST", "/api/forum", post({ linkedEventId: "ev-other-city" }), f.cookie);
    expect(crossCity.body.post.linkedEvent).toBeNull();

    const hidden = await call(f.db, "POST", "/api/forum", post({ linkedEventId: "ev-hidden" }), f.cookie);
    expect(hidden.body.post.linkedEvent).toBeNull();

    // Re-validated at read time too: hide the previously-good event after posting, it should disappear from the public read.
    f.db.setEvent({ ...realEvent, hidden: true });
    const listed = publicForumPosts(f.db, f.city.id);
    const goodPost = listed.find((p) => p.id === good.body.post.id);
    expect(goodPost?.linkedEvent).toBeNull();
  });

  it("hides moderation-hidden posts from the public read while keeping the record", async () => {
    const f = setup();
    const r = await call(f.db, "POST", "/api/forum", post(), f.cookie);
    const id = r.body.post.id;
    expect(publicForumPosts(f.db, f.city.id)).toHaveLength(1);
    const content = f.db.getContent(`post:${id}`)!;
    f.db.upsertContent({ ...content, hidden: true, hiddenAt: "2026-08-03T13:00:00.000Z" });
    expect(publicForumPosts(f.db, f.city.id)).toHaveLength(0);
    expect(f.db.getForumPost(id)?.state).toBe("visible");
  });
});

function dbWithoutRate(db: ReturnType<typeof createMemoryStore>, cityId: string) {
  // The rate limit is per-account; a different account still posts fine.
  const account = db.createAccount({ name: "Other Runner", email: "other@example.com", cityId });
  account.status = "verified";
  const sid = db.createSession(account.id, "test");
  return call(db, "POST", "/api/forum", post({ title: "other post" }), `${SESSION_COOKIE}=${sid.id}`);
}
