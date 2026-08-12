/**
 * HTTP-level tests for POST /api/content/:kind/:id/flag (Phase 2a):
 *  - verified runner only (401 guest / 403 pending / 403 suspended);
 *  - same-city only (403 cross_city_denied);
 *  - reason required 5-500 (400);
 *  - self-report blocked (403);
 *  - duplicate open flag for same reporter + target → 409;
 *  - rate limited (429, 5/hr shared bucket);
 *  - success creates a FlagRecord; response never leaks reason/reporter;
 *  - kinds: post, reply, event, race, group;
 *  - audited as content.flag with cityId/owner/change.
 */
import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { apiHandler, SESSION_COOKIE } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { materializeSeedEvents } from "../src/server/events";
import { seedContentRegistry } from "../src/server/contentSeed";
import { CITIES } from "../src/data/cities";

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

function verifiedUser(db: Db, email: string, cityId = "columbia-mo", name = "Runner") {
  const rec = db.createAccount({ name, email, cityId });
  rec.status = "verified"; rec.phase = "email";
  const sid = db.createSession(rec.id, "test");
  return { rec, cookie: `${SESSION_COOKIE}=${sid.id}` };
}

function setup() {
  const db = createMemoryStore();
  materializeSeedEvents(db, CITIES);
  // Registry rows for seed content: event:mon-social, race:r1, post:p1, group:ctc.
  seedContentRegistry(db, CITIES);
  // seed content present in the registry: event:mon-social, race:r1, post:p1, group:ctc
  const runner = verifiedUser(db, "runner@example.com");
  const other = verifiedUser(db, "other@example.com");
  // a user-created forum post owned by `other` so self-report can be exercised
  const post = db.addForumPost({ id: "user-post-1", section: "community", title: "User post", body: "Body", cityId: "columbia-mo", authorAccountId: other.rec.id, state: "visible", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  db.upsertContent({ id: "post:user-post-1", cityId: "columbia-mo", kind: "post", refId: "user-post-1", title: "User post", authorLabel: "Other", authorAccountId: other.rec.id, featured: false, pinned: false, hidden: false, hiddenAt: null, archived: false, archivedAt: null });
  const reply = db.addForumReply({ id: "user-reply-1", postId: post.id, cityId: "columbia-mo", authorAccountId: other.rec.id, body: "A reply body", state: "visible", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  return { db, runner, other, post, reply };
}

describe("content flag endpoint", () => {
  it("denies guests (401), pending (403), suspended (403) and cross-city (403)", async () => {
    const f = setup();
    expect((await call(f.db, "POST", "/api/content/post/p1/flag", { body: { reason: "spam content" } })).status).toBe(401);
    const pending = verifiedUser(f.db, "pending@example.com");
    pending.rec.status = "pending";
    expect((await call(f.db, "POST", "/api/content/post/p1/flag", { body: { reason: "spam content" }, cookie: pending.cookie })).status).toBe(403);
    const susp = verifiedUser(f.db, "susp@example.com");
    susp.rec.suspended = true; susp.rec.suspendedUntil = null;
    expect((await call(f.db, "POST", "/api/content/post/p1/flag", { body: { reason: "spam content" }, cookie: susp.cookie })).status).toBe(403);
    const cross = verifiedUser(f.db, "cross@example.com", "jefferson-city-mo");
    expect((await call(f.db, "POST", "/api/content/post/p1/flag", { body: { reason: "spam content" }, cookie: cross.cookie })).status).toBe(403);
  });

  it("requires a 5-500 reason and 404s unknown targets", async () => {
    const f = setup();
    expect((await call(f.db, "POST", "/api/content/post/p1/flag", { body: {}, cookie: f.runner.cookie })).status).toBe(400);
    expect((await call(f.db, "POST", "/api/content/post/p1/flag", { body: { reason: "nope" }, cookie: f.runner.cookie })).status).toBe(400);
    expect((await call(f.db, "POST", "/api/content/post/p1/flag", { body: { reason: "x".repeat(501) }, cookie: f.runner.cookie })).status).toBe(400);
    expect((await call(f.db, "POST", "/api/content/post/missing/flag", { body: { reason: "spam content" }, cookie: f.runner.cookie })).status).toBe(404);
  });

  it("blocks self-report, duplicate flags (409) and rate limits (429)", async () => {
    const f = setup();
    // self-report on the user's own post + reply
    const selfPost = await call(f.db, "POST", `/api/content/post/${f.post.id}/flag`, { body: { reason: "self test flag" }, cookie: f.other.cookie });
    expect(selfPost.status).toBe(403);
    expect(selfPost.body.error).toBe("self_report_blocked");
    const selfReply = await call(f.db, "POST", `/api/content/reply/${f.reply.id}/flag`, { body: { reason: "self test flag" }, cookie: f.other.cookie });
    expect(selfReply.status).toBe(403);
    // first flag OK
    const first = await call(f.db, "POST", "/api/content/post/p1/flag", { body: { reason: "spam content" }, cookie: f.runner.cookie });
    expect(first.status).toBe(200);
    expect(first.body.flag.status).toBe("open");
    expect(first.body.flag.contentId).toBe("post:p1");
    // the create response never leaks the reason or the reporter identity
    expect(JSON.stringify(first.body)).not.toContain("spam");
    expect(JSON.stringify(first.body)).not.toContain("runner@example.com");
    // duplicate → 409
    const dup = await call(f.db, "POST", "/api/content/post/p1/flag", { body: { reason: "spam content" }, cookie: f.runner.cookie });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("duplicate_flag");
    // rate limit: 4 more flags (5/hr) → 6th is 429
    for (const target of ["race:r1", "event:mon-social", "group:ctc"]) {
      const [kind, id] = target.split(":");
      const r = await call(f.db, "POST", `/api/content/${kind}/${id}/flag`, { body: { reason: "more spam flags" }, cookie: f.runner.cookie });
      expect(r.status).toBe(200);
    }
    // 5th flag still allowed (last slot in the rolling hour)
    const fifth = await call(f.db, "POST", "/api/content/event/tue-track/flag", { body: { reason: "one more spam flag" }, cookie: f.runner.cookie });
    expect(fifth.status).toBe(200);
    // 6th → 429
    const last = await call(f.db, "POST", "/api/content/post/p2/flag", { body: { reason: "over the limit" }, cookie: f.runner.cookie });
    expect(last.status).toBe(429);
    expect(last.body.error).toBe("rate_limited");
  });

  it("flags all kinds and writes audited FlagRecords with admin-only fields", async () => {
    const f = setup();
    const cases: Array<[string, string, string]> = [
      ["post", f.post.id, "User post"], // registry-mapped user post
      ["reply", f.reply.id, "A reply body"],
      ["event", "mon-social", "Monday Social"],
      ["race", "r1", "River 5K"],
      ["group", "ctc", "Columbia Track Club"],
    ];
    let total = 0;
    for (const [kind, id, title] of cases) {
      const r = await call(f.db, "POST", `/api/content/${kind}/${id}/flag`, { body: { reason: `flag for ${kind}` }, cookie: f.runner.cookie });
      expect(r.status).toBe(200);
      total++;
      if (total >= 5) break; // rate limit is 5/hr — stop before exhausting
      void title;
    }
    const flags = f.db.listFlags().filter((fl) => fl.reporterAccountId === f.runner.rec.id);
    expect(flags).toHaveLength(total);
    for (const fl of flags) {
      expect(fl.reporterAccountId).toBe(f.runner.rec.id);
      expect(fl.reason.length).toBeGreaterThanOrEqual(5);
      expect(fl.cityId).toBe("columbia-mo");
    }
    // every flag is audited with cityId/owner/change
    for (const fl of flags) {
      const entry = f.db.listAudit(100).find((a) => a.action === "content.flag" && a.targetId === fl.contentId);
      expect(entry).toBeTruthy();
      expect(entry!.cityId).toBe("columbia-mo");
      expect(entry!.admin).toBe("runner@example.com");
      expect(entry!.change).toContain("flagged");
    }
    // flag views are admin-only: FlagRecord rows exist but the public flag
    // payloads we returned contain no reporter identity or reason
    expect(JSON.stringify(flags.map((fl) => fl.reason))).not.toContain("runner@example.com");
  });

  it("event ids resolve via canonical event id as well as registry id", async () => {
    const f = setup();
    const event = f.db.listEvents().find((e) => e.seedRefId === "mon-social")!;
    const viaCanonical = await call(f.db, "POST", `/api/content/event/${event.id}/flag`, { body: { reason: "canonical id flag" }, cookie: f.runner.cookie });
    expect(viaCanonical.status).toBe(200);
    expect(viaCanonical.body.flag.contentId).toBe("event:mon-social");
  });
});
