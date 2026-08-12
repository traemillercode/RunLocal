/**
 * HTTP tests for the runner-tagging endpoints (part B):
 *   POST /api/tags, GET /api/tags, PATCH /api/tags/:id/self,
 *   GET /api/runners/:id/tagged, GET /api/runners/:id/activity.
 *
 * Pins: tags lifecycle over HTTP, list visibility with self-hide (hidden rows
 * drop for everyone except the tagged user), self-hide is tagged-user-only
 * (403 for others, 404 unknown), blocked pairs rejected on create and
 * excluded on read, verified-actor gating, canView gating for the Tagged and
 * Activity tabs (show_tagged_content / show_past_activity), and moderation/
 * deletion filtering of the resolved content.
 */
import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { apiHandler, SESSION_COOKIE } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { materializeSeedEvents } from "../src/server/events";
import { CITIES } from "../src/data/cities";
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

function setup() {
  const db = createMemoryStore();
  materializeSeedEvents(db, CITIES);
  return { db };
}
const seedByRef = (db: Db, refId: string) => db.listEvents().find((e) => e.seedRefId === refId)!;

function addPost(db: Db, author: Acct, title: string, opts: { state?: "visible" | "deleted" } = {}) {
  const id = `post-${title.replace(/\W+/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
  db.addForumPost({ id, cityId: "columbia-mo", section: "community", title, body: `Body of ${title} — a longer description to truncate.`, authorAccountId: author.id, state: opts.state ?? "visible", pinned: false, createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z" });
  return id;
}

describe("POST /api/tags", () => {
  it("verified actor tags another runner on content; no approval needed", async () => {
    const { db } = setup();
    const tagger = account(db, "tagger@example.com");
    const target = account(db, "target@example.com");
    const postId = addPost(db, tagger, "Morning miles");

    const r = await call(db, "POST", "/api/tags", { body: { contentType: "post", contentId: postId, taggedUserId: target.id }, cookie: tagger.cookie });
    expect(r.status).toBe(200);
    expect(r.body.tag).toMatchObject({ contentType: "post", contentId: postId, taggedUserId: target.id, taggedByUserId: tagger.id, hiddenByTaggedUser: false });
    expect(r.body.tag.id).toBeTruthy();
    expect(db.getTagsForContent("post", postId)).toHaveLength(1);
  });

  it("auth + validation: guest 401, pending actor 403, unknown target 404, self-tag 400, invalid contentType 400, blocked pair 403", async () => {
    const { db } = setup();
    const a = account(db, "a@example.com");
    const b = account(db, "b@example.com");
    const postId = addPost(db, a, "Post one");

    expect((await call(db, "POST", "/api/tags", { body: { contentType: "post", contentId: postId, taggedUserId: b.id } })).status).toBe(401);

    const pending = db.createAccount({ name: "pending", email: "pending@example.com", cityId: "columbia-mo" });
    const sid = db.createSession(pending.id, "test");
    const pendingCookie = `${SESSION_COOKIE}=${sid.id}`;
    expect((await call(db, "POST", "/api/tags", { body: { contentType: "post", contentId: postId, taggedUserId: b.id }, cookie: pendingCookie })).status).toBe(403);

    expect((await call(db, "POST", "/api/tags", { body: { contentType: "post", contentId: postId, taggedUserId: "missing-account" }, cookie: a.cookie })).status).toBe(404);
    expect((await call(db, "POST", "/api/tags", { body: { contentType: "post", contentId: postId, taggedUserId: a.id }, cookie: a.cookie })).status).toBe(400);
    expect((await call(db, "POST", "/api/tags", { body: { contentType: "meme", contentId: postId, taggedUserId: b.id }, cookie: a.cookie })).status).toBe(400);

    // blocked pair rejected
    await call(db, "POST", `/api/connections/${b.id}/block`, { cookie: a.cookie });
    expect((await call(db, "POST", "/api/tags", { body: { contentType: "post", contentId: postId, taggedUserId: b.id }, cookie: a.cookie })).status).toBe(403);
    expect((await call(db, "POST", "/api/tags", { body: { contentType: "post", contentId: postId, taggedUserId: a.id }, cookie: b.cookie })).status).toBe(403);
  });
});

describe("GET /api/tags — list visibility", () => {
  it("hidden_by_tagged_user rows drop for everyone except the tagged user; blocked pairs excluded; taggedUser profile included", async () => {
    const { db } = setup();
    const tagger = account(db, "tagger@example.com");
    const t1 = account(db, "t1@example.com");
    const t2 = account(db, "t2@example.com");
    const stranger = account(db, "stranger@example.com");
    const postId = addPost(db, tagger, "Post with tags");

    await call(db, "POST", "/api/tags", { body: { contentType: "post", contentId: postId, taggedUserId: t1.id }, cookie: tagger.cookie });
    await call(db, "POST", "/api/tags", { body: { contentType: "post", contentId: postId, taggedUserId: t2.id }, cookie: tagger.cookie });

    // stranger sees both with taggedUser profiles
    const list = await call(db, "GET", `/api/tags?contentType=post&contentId=${encodeURIComponent(postId)}`, { cookie: stranger.cookie });
    expect(list.status).toBe(200);
    expect(list.body.tags.map((t: { taggedUserId: string }) => t.taggedUserId).sort()).toEqual([t1.id, t2.id].sort());
    expect(list.body.tags[0].taggedUser.id).toBeTruthy();
    expect(list.body.tags[0].taggedUser).not.toHaveProperty("email");

    // t1 self-hides their tag
    const hide = await call(db, "PATCH", `/api/tags/${list.body.tags.find((t: { taggedUserId: string }) => t.taggedUserId === t1.id).id}/self`, { body: { hiddenByTaggedUser: true }, cookie: t1.cookie });
    expect(hide.status).toBe(200);
    expect(hide.body.tag.hiddenByTaggedUser).toBe(true);

    // stranger now sees only t2; guests too
    const list2 = await call(db, "GET", `/api/tags?contentType=post&contentId=${encodeURIComponent(postId)}`, { cookie: stranger.cookie });
    expect(list2.body.tags.map((t: { taggedUserId: string }) => t.taggedUserId)).toEqual([t2.id]);
    const guestList = await call(db, "GET", `/api/tags?contentType=post&contentId=${encodeURIComponent(postId)}`);
    expect(guestList.body.tags.map((t: { taggedUserId: string }) => t.taggedUserId)).toEqual([t2.id]);

    // t1 (the tagged user) still sees their own hidden tag
    const selfList = await call(db, "GET", `/api/tags?contentType=post&contentId=${encodeURIComponent(postId)}`, { cookie: t1.cookie });
    expect(selfList.body.tags.map((t: { taggedUserId: string }) => t.taggedUserId).sort()).toEqual([t1.id, t2.id].sort());

    // blocked pair: stranger blocks t2 -> t2's tag drops for the stranger
    await call(db, "POST", `/api/connections/${t2.id}/block`, { cookie: stranger.cookie });
    const blockedList = await call(db, "GET", `/api/tags?contentType=post&contentId=${encodeURIComponent(postId)}`, { cookie: stranger.cookie });
    expect(blockedList.body.tags).toHaveLength(0);

    // invalid query -> 400
    expect((await call(db, "GET", "/api/tags?contentType=post")).status).toBe(400);
    expect((await call(db, "GET", "/api/tags?contentType=bogus&contentId=x", { cookie: stranger.cookie })).status).toBe(400);
  });
});

describe("PATCH /api/tags/:id/self", () => {
  it("only the tagged user may set their own flag (403 for others); unknown 404; non-boolean 400", async () => {
    const { db } = setup();
    const tagger = account(db, "tagger@example.com");
    const t1 = account(db, "t1@example.com");
    const other = account(db, "other@example.com");
    const postId = addPost(db, tagger, "Tagged post");
    const created = await call(db, "POST", "/api/tags", { body: { contentType: "post", contentId: postId, taggedUserId: t1.id }, cookie: tagger.cookie });
    const tagId = created.body.tag.id;

    expect((await call(db, "PATCH", `/api/tags/${tagId}/self`, { body: { hiddenByTaggedUser: true }, cookie: other.cookie })).status).toBe(403);
    expect((await call(db, "PATCH", `/api/tags/${tagId}/self`, { body: { hiddenByTaggedUser: true }, cookie: tagger.cookie })).status).toBe(403); // the tagger is not the tagged user
    expect((await call(db, "PATCH", `/api/tags/${tagId}/self`, { body: { hiddenByTaggedUser: true } })).status).toBe(401);
    expect((await call(db, "PATCH", `/api/tags/unknown-tag/self`, { body: { hiddenByTaggedUser: true }, cookie: t1.cookie })).status).toBe(404);
    expect((await call(db, "PATCH", `/api/tags/${tagId}/self`, { body: { hiddenByTaggedUser: "yes" }, cookie: t1.cookie })).status).toBe(400);

    // the tagged user can toggle both ways
    const on = await call(db, "PATCH", `/api/tags/${tagId}/self`, { body: { hiddenByTaggedUser: true }, cookie: t1.cookie });
    expect(on.body.tag.hiddenByTaggedUser).toBe(true);
    const off = await call(db, "PATCH", `/api/tags/${tagId}/self`, { body: { hiddenByTaggedUser: false }, cookie: t1.cookie });
    expect(off.body.tag.hiddenByTaggedUser).toBe(false);
  });
});

describe("GET /api/runners/:id/tagged", () => {
  function taggedSetup() {
    const { db } = setup();
    const owner = account(db, "owner@example.com");
    const connected = account(db, "connected@example.com");
    const stranger = account(db, "stranger@example.com");
    const tagger = account(db, "tagger@example.com");
    const postId = addPost(db, tagger, "Tagged post title");
    const ev = seedByRef(db, "mon-social");
    return { db, owner, connected, stranger, tagger, postId, ev };
  }

  it("gated by show_tagged_content (connections_only default): strangers/guests see nothing, connections see posts+events", async () => {
    const { db, owner, connected, stranger, tagger, postId, ev } = taggedSetup();
    // connect owner <-> connected
    const req = await call(db, "POST", `/api/connections/${owner.id}/request`, { cookie: connected.cookie });
    const inbox = await call(db, "GET", "/api/connections", { cookie: owner.cookie });
    await call(db, "POST", `/api/connections/${inbox.body.requests[0].requestId}/accept`, { cookie: owner.cookie });
    expect(req.status).toBe(200);

    await call(db, "POST", "/api/tags", { body: { contentType: "post", contentId: postId, taggedUserId: owner.id }, cookie: tagger.cookie });
    await call(db, "POST", "/api/tags", { body: { contentType: "event", contentId: ev.seedRefId, taggedUserId: owner.id }, cookie: tagger.cookie });

    // stranger + guest: hidden (connections_only)
    const s = await call(db, "GET", `/api/runners/${owner.id}/tagged`, { cookie: stranger.cookie });
    expect(s.status).toBe(200);
    expect(s.body.tagged).toHaveLength(0);
    expect((await call(db, "GET", `/api/runners/${owner.id}/tagged`)).body.tagged).toHaveLength(0);

    // connected viewer sees both, resolved to post + event titles
    const c = await call(db, "GET", `/api/runners/${owner.id}/tagged`, { cookie: connected.cookie });
    const kinds = c.body.tagged.map((t: { content: { kind: string; title: string } }) => ({ kind: t.content.kind, title: t.content.title })).sort((a: { kind: string }, b: { kind: string }) => a.kind.localeCompare(b.kind));
    expect(kinds).toEqual([
      { kind: "event", title: ev.title },
      { kind: "post", title: "Tagged post title" },
    ]);
  });

  it("hidden rows drop for everyone except the owner; blocked pair sees nothing; public setting opens to strangers", async () => {
    const { db, owner, connected, tagger, postId } = taggedSetup();
    await call(db, "POST", "/api/tags", { body: { contentType: "post", contentId: postId, taggedUserId: owner.id }, cookie: tagger.cookie });
    // owner self-hides their own tag
    const list = await call(db, "GET", `/api/tags?contentType=post&contentId=${encodeURIComponent(postId)}`, { cookie: owner.cookie });
    const tagId = list.body.tags.find((t: { taggedUserId: string }) => t.taggedUserId === owner.id).id;
    await call(db, "PATCH", `/api/tags/${tagId}/self`, { body: { hiddenByTaggedUser: true }, cookie: owner.cookie });

    // owner (self) still sees it; a connected viewer does NOT
    const ownerList = await call(db, "GET", `/api/runners/${owner.id}/tagged`, { cookie: owner.cookie });
    expect(ownerList.body.tagged).toHaveLength(1);
    const connList = await call(db, "GET", `/api/runners/${owner.id}/tagged`, { cookie: connected.cookie });
    expect(connList.body.tagged).toHaveLength(0);

    // owner blocks the connected viewer -> blocked beats everything
    await call(db, "POST", `/api/connections/${connected.id}/block`, { cookie: owner.cookie });
    expect((await call(db, "GET", `/api/runners/${owner.id}/tagged`, { cookie: connected.cookie })).body.tagged).toHaveLength(0);

    // show_tagged_content public -> a stranger sees the (unhidden) tags
    const fresh = account(db, "fresh@example.com");
    const post2 = addPost(db, tagger, "Another tagged post");
    await call(db, "POST", "/api/tags", { body: { contentType: "post", contentId: post2, taggedUserId: owner.id }, cookie: tagger.cookie });
    await call(db, "PUT", "/api/profile/privacy", { body: { show_tagged_content: "public" }, cookie: owner.cookie });
    const pub = await call(db, "GET", `/api/runners/${owner.id}/tagged`, { cookie: fresh.cookie });
    expect(pub.body.tagged.map((t: { content: { title: string } }) => t.content.title)).toContain("Another tagged post");
  });
});

describe("GET /api/runners/:id/activity", () => {
  it("shows the runner's visible forum posts gated by show_past_activity; excludes deleted posts", async () => {
    const { db } = setup();
    const author = account(db, "author@example.com");
    const stranger = account(db, "stranger@example.com");
    const connected = account(db, "connected@example.com");
    addPost(db, author, "Public post one");
    addPost(db, author, "Public post two");
    addPost(db, author, "Deleted post", { state: "deleted" });
    addPost(db, stranger, "Not mine");

    // default public: guests and strangers see the two visible posts
    const guest = await call(db, "GET", `/api/runners/${author.id}/activity`);
    expect(guest.status).toBe(200);
    expect(guest.body.activity.map((a: { title: string }) => a.title).sort()).toEqual(["Public post one", "Public post two"]);
    expect(guest.body.activity[0]).toHaveProperty("excerpt");
    expect(guest.body.activity[0]).toHaveProperty("createdAt");

    // private: strangers/guests see nothing; the author still sees their own
    await call(db, "PUT", "/api/profile/privacy", { body: { show_past_activity: "private" }, cookie: author.cookie });
    expect((await call(db, "GET", `/api/runners/${author.id}/activity`, { cookie: stranger.cookie })).body.activity).toHaveLength(0);
    expect((await call(db, "GET", `/api/runners/${author.id}/activity`)).body.activity).toHaveLength(0);
    const self = await call(db, "GET", `/api/runners/${author.id}/activity`, { cookie: author.cookie });
    expect(self.body.activity).toHaveLength(2);

    // connections_only: a connection sees the posts, strangers still do not
    const req = await call(db, "POST", `/api/connections/${connected.id}/request`, { cookie: author.cookie });
    const inbox = await call(db, "GET", "/api/connections", { cookie: connected.cookie });
    await call(db, "POST", `/api/connections/${inbox.body.requests[0].requestId}/accept`, { cookie: connected.cookie });
    expect(req.status).toBe(200);
    await call(db, "PUT", "/api/profile/privacy", { body: { show_past_activity: "connections_only" }, cookie: author.cookie });
    const conn = await call(db, "GET", `/api/runners/${author.id}/activity`, { cookie: connected.cookie });
    expect(conn.body.activity).toHaveLength(2);
    expect((await call(db, "GET", `/api/runners/${author.id}/activity`, { cookie: stranger.cookie })).body.activity).toHaveLength(0);

    // unknown runner -> 404
    expect((await call(db, "GET", "/api/runners/deadbeefdeadbeefdeadbeefdeadbeef/activity")).status).toBe(404);
  });
});
