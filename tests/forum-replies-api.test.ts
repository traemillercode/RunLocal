/**
 * Forum replies (comments on a post) — server-authoritative tests.
 *
 * Pins the production slice: verified members can actually REPLY to forum
 * posts (server-persisted, city-scoped to the author's home city — cross-city
 * targets are denied, never redirected), while guests / pending / rejected /
 * suspended / deleted accounts are denied with explicit errors. Reads are
 * public but moderation-aware: hidden/archived posts 404 and never leak their
 * replies, input is validated, replies survive a persistence roundtrip, reply
 * counts update, and the public payload never leaks account data (only the
 * public display name).
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { apiHandler, SESSION_COOKIE } from "../src/server/api";
import { createMemoryStore, Db } from "../src/server/store";
import { CITIES } from "../src/data/cities";
import { publicForumPosts, publicForumReplies, forumReplyCounts } from "../src/server/forum";
import type { ForumReplyRecord } from "../src/server/types";

function req(method: string, path: string, body?: unknown, cookie?: string) {
  const input = body === undefined ? "" : JSON.stringify(body);
  const r = Readable.from([input]) as Readable & { method: string; url: string; headers: Record<string,string>; socket: { remoteAddress: string } };
  r.method = method; r.url = path; r.headers = { ...(cookie ? { cookie } : {}) }; r.socket = { remoteAddress: "127.0.0.1" };
  return r;
}
async function call(db: ReturnType<typeof createMemoryStore> | Db, method: string, path: string, body?: unknown, cookie?: string) {
  let status = 0; let payload = "";
  const res = new Writable({ write(chunk, _encoding, done) { payload += chunk.toString(); done(); } }) as Writable & { statusCode: number; headersSent: boolean; setHeader: (n:string,v:unknown)=>void; writeHead:(s:number,h:Record<string,unknown>)=>void; end:(v?:unknown)=>void };
  res.statusCode = 200; res.headersSent = false; res.setHeader = () => {}; res.writeHead = (s) => { status = s; res.headersSent = true; }; (res as any).end = (v?: unknown) => { if (v) payload += String(v); };
  await apiHandler(req(method, path, body, cookie) as never, res as never, db as never);
  return { status, body: payload ? JSON.parse(payload) : {} };
}
function setup() {
  const db = createMemoryStore({ now: () => new Date("2026-08-03T12:00:00.000Z") });
  const city = CITIES[0]!; // columbia-mo (seed posts p1..p9)
  const account = db.createAccount({ name: "Taylor Runner", email: "taylor@example.com", cityId: city.id });
  account.status = "verified";
  const sid = db.createSession(account.id, "test");
  return { db, city, account, cookie: `${SESSION_COOKIE}=${sid.id}` };
}
/** A verified account in a different city (for cross-city denial). */
function otherCity(f: ReturnType<typeof setup>, cityId = "stl-mo") {
  const a = f.db.createAccount({ name: "Other City", email: "other@example.com", cityId });
  a.status = "verified";
  const sid = f.db.createSession(a.id, "test");
  return { account: a, cookie: `${SESSION_COOKIE}=${sid.id}` };
}
const reply = (overrides: Record<string, unknown> = {}) => ({ postId: "p1", body: "Count me in for the 6 PM group!", ...overrides });

describe("forum GET /api/forum/replies", () => {
  it("is public — anonymous reads return the persisted replies oldest-first", async () => {
    const f = setup();
    const r1 = await call(f.db, "POST", "/api/forum/replies", reply({ body: "First reply" }), f.cookie);
    const r2 = await call(f.db, "POST", "/api/forum/replies", reply({ body: "Second reply" }), f.cookie);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const r = await call(f.db, "GET", `/api/forum/replies?city=${encodeURIComponent(f.city.id)}&post=p1`);
    expect(r.status).toBe(200);
    expect(r.body.postId).toBe("p1");
    expect(r.body.replies.map((x: { body: string }) => x.body)).toEqual(["First reply", "Second reply"]);
    // No auth cookie needed — public browse like the forum itself.
    expect(r.body.replies[0]!.author).toBe("Taylor Runner");
  });

  it("404s unknown posts and posts outside the requested city, and 400s unknown cities", async () => {
    const f = setup();
    expect((await call(f.db, "GET", "/api/forum/replies?city=columbia-mo&post=nope")).status).toBe(404);
    expect((await call(f.db, "GET", "/api/forum/replies?city=stl-mo&post=p1")).status).toBe(404); // p1 is columbia's
    expect((await call(f.db, "GET", "/api/forum/replies?city=not-a-city&post=p1")).status).toBe(400);
  });

  it("hides replies of moderation-hidden posts (404 — never leaks the post or its replies)", async () => {
    const f = setup();
    await call(f.db, "POST", "/api/forum/replies", reply(), f.cookie);
    f.db.upsertContent({
      id: "post:p1", cityId: f.city.id, kind: "post", refId: "p1", title: "Welcome", authorLabel: "Run Local Team",
      authorAccountId: null, featured: false, pinned: false, hidden: true, hiddenAt: "2026-08-03T13:00:00.000Z", archived: false, archivedAt: null,
    });
    expect((await call(f.db, "GET", "/api/forum/replies?city=columbia-mo&post=p1")).status).toBe(404);
    expect(publicForumReplies(f.db, "p1")).toEqual([]);
    expect(forumReplyCounts(f.db, f.city.id)["p1"] ?? 0).toBe(0);
  });
});

describe("forum POST /api/forum/replies", () => {
  it("accepts a verified member's reply to a seed post, persists it, and updates counts", async () => {
    const f = setup();
    const r = await call(f.db, "POST", "/api/forum/replies", reply(), f.cookie);
    expect(r.status).toBe(200);
    expect(r.body.reply.body).toBe("Count me in for the 6 PM group!");
    expect(r.body.reply.postId).toBe("p1");
    const listed = publicForumReplies(f.db, "p1");
    expect(listed).toHaveLength(1);
    const record: ForumReplyRecord | undefined = f.db.getForumReply(listed[0]!.id);
    expect(record?.authorAccountId).toBe(f.account.id);
    expect(record?.cityId).toBe(f.city.id);
    expect(record?.state).toBe("visible");
    // Counts reflect the persisted reply everywhere.
    expect(forumReplyCounts(f.db, f.city.id)["p1"]).toBe(1);
    const posts = await call(f.db, "GET", `/api/forum?city=${encodeURIComponent(f.city.id)}`);
    expect(posts.body.replyCounts["p1"]).toBe(1);
  });

  it("accepts replies to user-created posts too, and isolates counts per post", async () => {
    const f = setup();
    const post = await call(f.db, "POST", "/api/forum", { section: "community", title: "New route", body: "River loop" }, f.cookie);
    const postId = post.body.post.id as string;
    const a = await call(f.db, "POST", "/api/forum/replies", reply({ postId, body: "Nice loop" }), f.cookie);
    expect(a.status).toBe(200);
    expect(publicForumPosts(f.db, f.city.id)[0]!.replies).toBe(1);
    expect(forumReplyCounts(f.db, f.city.id)[postId]).toBe(1);
    // p1 untouched.
    expect(forumReplyCounts(f.db, f.city.id)["p1"] ?? 0).toBe(0);
  });

  it("survives a persistence roundtrip (db.json reload)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runlocal-forum-replies-"));
    try {
      const db = new Db({ dataDir: dir, now: () => new Date("2026-08-03T12:00:00.000Z") });
      await db.load();
      const account = db.createAccount({ name: "Taylor Runner", email: "taylor@example.com", cityId: "columbia-mo" });
      account.status = "verified";
      const sid = db.createSession(account.id, "test");
      const cookie = `${SESSION_COOKIE}=${sid.id}`;
      const created = await call(db, "POST", "/api/forum/replies", reply(), cookie);
      expect(created.status).toBe(200);
      await db.persist();

      const loaded = new Db({ dataDir: dir, now: () => new Date("2026-08-03T12:00:00.000Z") });
      await loaded.load();
      const out = await call(loaded, "GET", "/api/forum/replies?city=columbia-mo&post=p1");
      expect(out.status).toBe(200);
      expect(out.body.replies).toHaveLength(1);
      expect(out.body.replies[0]!.body).toBe("Count me in for the 6 PM group!");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("denies guests, pending, rejected, suspended, and deleted accounts", async () => {
    const f = setup();
    expect((await call(f.db, "POST", "/api/forum/replies", reply())).status).toBe(401);
    f.account.status = "pending"; expect((await call(f.db, "POST", "/api/forum/replies", reply(), f.cookie)).status).toBe(403);
    f.account.status = "rejected"; expect((await call(f.db, "POST", "/api/forum/replies", reply(), f.cookie)).status).toBe(403);
    f.account.status = "verified"; f.account.suspended = true; f.account.suspendedUntil = null;
    expect((await call(f.db, "POST", "/api/forum/replies", reply(), f.cookie)).status).toBe(403);
    f.account.suspended = false; f.account.deletedAt = new Date().toISOString();
    expect((await call(f.db, "POST", "/api/forum/replies", reply(), f.cookie)).status).toBe(401);
  });

  it("denies cross-city replies with an explicit error (never redirects)", async () => {
    const f = setup();
    const stl = otherCity(f, "stl-mo");
    // stl user replying to columbia's seed post p1.
    const r1 = await call(f.db, "POST", "/api/forum/replies", reply(), stl.cookie);
    expect(r1.status).toBe(403);
    expect(r1.body.error).toBe("cross_city_denied");
    expect(publicForumReplies(f.db, "p1")).toEqual([]);
    // stl user replying to a columbia user's post.
    const post = await call(f.db, "POST", "/api/forum", { section: "community", title: "Columbia run", body: "Local loop" }, f.cookie);
    const r2 = await call(f.db, "POST", "/api/forum/replies", reply({ postId: post.body.post.id, body: "hi" }), stl.cookie);
    expect(r2.status).toBe(403);
    expect(r2.body.error).toBe("cross_city_denied");
    // columbia user replying to an stl user's post — same denial in the other direction.
    const stlPost = await call(f.db, "POST", "/api/forum", { section: "community", title: "STL run", body: "Arch loop" }, stl.cookie);
    const r3 = await call(f.db, "POST", "/api/forum/replies", reply({ postId: stlPost.body.post.id, body: "hi" }), f.cookie);
    expect(r3.status).toBe(403);
    expect(r3.body.error).toBe("cross_city_denied");
  });

  it("validates the target post and body", async () => {
    const f = setup();
    expect((await call(f.db, "POST", "/api/forum/replies", reply({ postId: "" }), f.cookie)).status).toBe(400);
    expect((await call(f.db, "POST", "/api/forum/replies", reply({ postId: "ghost-post" }), f.cookie)).status).toBe(404);
    expect((await call(f.db, "POST", "/api/forum/replies", reply({ body: "   " }), f.cookie)).status).toBe(400);
    expect((await call(f.db, "POST", "/api/forum/replies", reply({ body: "y".repeat(1001) }), f.cookie)).status).toBe(400);
    expect(publicForumReplies(f.db, "p1")).toEqual([]);
  });

  it("rejects replies to moderation-hidden or archived posts", async () => {
    const f = setup();
    f.db.upsertContent({
      id: "post:p1", cityId: f.city.id, kind: "post", refId: "p1", title: "Welcome", authorLabel: "Run Local Team",
      authorAccountId: null, featured: false, pinned: false, hidden: true, hiddenAt: "2026-08-03T13:00:00.000Z", archived: false, archivedAt: null,
    });
    const r = await call(f.db, "POST", "/api/forum/replies", reply(), f.cookie);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("post_unavailable");
    expect(publicForumReplies(f.db, "p1")).toEqual([]);
    // Archived (not just hidden) is equally unavailable.
    f.db.upsertContent({ id: "post:p1", cityId: f.city.id, kind: "post", refId: "p1", title: "Welcome", authorLabel: "Run Local Team", authorAccountId: null, featured: false, pinned: false, hidden: false, hiddenAt: null, archived: true, archivedAt: "2026-08-03T13:00:00.000Z" });
    expect((await call(f.db, "POST", "/api/forum/replies", reply(), f.cookie)).status).toBe(403);
  });

  it("rate-limits replies alongside posting (10/hour shared)", async () => {
    const f = setup();
    for (let i = 0; i < 10; i++) expect((await call(f.db, "POST", "/api/forum/replies", reply({ body: `r${i}` }), f.cookie)).status).toBe(200);
    expect((await call(f.db, "POST", "/api/forum/replies", reply({ body: "eleventh" }), f.cookie)).status).toBe(429);
  });

  it("never leaks private account data in the public payload", async () => {
    const f = setup();
    const r = await call(f.db, "POST", "/api/forum/replies", reply(), f.cookie);
    expect(r.status).toBe(200);
    const replyObj = r.body.reply;
    expect(Object.keys(replyObj).sort()).toEqual(["author", "authorId", "body", "capabilities", "createdAt", "id", "postId"]);
    const out = await call(f.db, "GET", "/api/forum/replies?city=columbia-mo&post=p1");
    expect(JSON.stringify(out.body)).not.toContain("taylor@example.com");
    expect(JSON.stringify(out.body)).not.toContain(f.account.id);
  });
});
