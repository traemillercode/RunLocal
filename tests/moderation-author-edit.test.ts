/**
 * HTTP-level tests for Phase 2a author-owned moderation endpoints:
 *  - PATCH/DELETE /api/forum/:id (author edit / soft-delete)
 *  - PATCH/DELETE /api/forum/replies/:id (author edit / soft-delete)
 *  - PATCH /api/events/:e/occurrences/:o/discussion/:id (author edit)
 *  - POST /api/my/submissions/:id/withdraw (submitter withdrawal)
 *  - admin audit-log read is a routine read (no operator reason required)
 *  - role revoked mid-session denies the next admin action (server-side)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { apiHandler, SESSION_COOKIE } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { materializeSeedEvents } from "../src/server/events";
import { CITIES } from "../src/data/cities";
import { ADMIN_EMAIL_VAR, ADMIN_KEY_VAR, adminAuditLog, assignCityAdmin, revokeCityAdmin, adminLogin } from "../src/server/admin";
import { publicForumPosts } from "../src/server/forum";
import { DEFAULT_OWNER_EMAIL, OWNER_EMAIL_VAR } from "../src/server/owner";
import { seedCmsCities } from "../src/server/cms";

const KEY = "phase2a-test-key";
let prevKey: string | undefined, prevEmail: string | undefined, prevOwner: string | undefined;
beforeEach(() => {
  prevKey = process.env[ADMIN_KEY_VAR]; prevEmail = process.env[ADMIN_EMAIL_VAR]; prevOwner = process.env[OWNER_EMAIL_VAR];
  process.env[ADMIN_KEY_VAR] = KEY;
  process.env[ADMIN_EMAIL_VAR] = "admin@example.com";
});
afterEach(() => {
  if (prevKey === undefined) delete process.env[ADMIN_KEY_VAR]; else process.env[ADMIN_KEY_VAR] = prevKey;
  if (prevEmail === undefined) delete process.env[ADMIN_EMAIL_VAR]; else process.env[ADMIN_EMAIL_VAR] = prevEmail;
  if (prevOwner === undefined) delete process.env[OWNER_EMAIL_VAR]; else process.env[OWNER_EMAIL_VAR] = prevOwner;
});

function req(method: string, path: string, opts: { body?: unknown; cookie?: string; reason?: string } = {}): any {
  const input = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const headers: Record<string, string> = { "x-forwarded-proto": "https" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.reason) headers["x-audit-reason"] = opts.reason;
  const r = Readable.from([input]) as any;
  r.method = method; r.url = path; r.headers = headers; r.socket = { remoteAddress: "198.51.100.42" };
  return r;
}
async function call(db: Db, method: string, path: string, opts: { body?: unknown; cookie?: string; reason?: string } = {}) {
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

function forumSetup() {
  const db = createMemoryStore();
  const author = verifiedUser(db, "author@example.com");
  const other = verifiedUser(db, "other@example.com");
  const post = db.addForumPost({ id: "post-1", section: "community", title: "Original title", body: "Original body", cityId: "columbia-mo", authorAccountId: author.rec.id, state: "visible", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  db.upsertContent({ id: "post:post-1", cityId: "columbia-mo", kind: "post", refId: "post-1", title: "Original title", authorLabel: "Runner", authorAccountId: author.rec.id, featured: false, pinned: false, hidden: false, hiddenAt: null, archived: false, archivedAt: null });
  const reply = db.addForumReply({ id: "reply-1", postId: post.id, cityId: "columbia-mo", authorAccountId: author.rec.id, body: "Original reply", state: "visible", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  return { db, author, other, post, reply };
}

describe("forum post author edit/delete", () => {
  it("author edits re-validate and audit; non-author 404; guest 401; pending 403", async () => {
    const f = forumSetup();
    // guest → 401
    expect((await call(f.db, "PATCH", `/api/forum/${f.post.id}`, { body: { title: "T", body: "B" } })).status).toBe(401);
    // author edit OK
    const ok = await call(f.db, "PATCH", `/api/forum/${f.post.id}`, { body: { title: "New title", body: "New body" }, cookie: f.author.cookie });
    expect(ok.status).toBe(200);
    expect(f.db.getForumPost(f.post.id)!.title).toBe("New title");
    expect(f.db.getForumPost(f.post.id)!.body).toBe("New body");
    // registry title follows the correction
    expect(f.db.getContent(`post:${f.post.id}`)!.title).toBe("New title");
    const entry = f.db.listAudit(50).find((a) => a.action === "forum.post_edit" && a.targetId === f.post.id);
    expect(entry).toBeTruthy();
    expect(entry!.admin).toBe("author@example.com");
    expect(entry!.cityId).toBe("columbia-mo");
    expect(entry!.owner).toBe("author@example.com");
    expect(entry!.change).toContain("New title");
    // non-author (verified, same city) → 404 (never leaked)
    expect((await call(f.db, "PATCH", `/api/forum/${f.post.id}`, { body: { title: "X", body: "Y" }, cookie: f.other.cookie })).status).toBe(404);
    // validation
    expect((await call(f.db, "PATCH", `/api/forum/${f.post.id}`, { body: { title: "", body: "ok" }, cookie: f.author.cookie })).status).toBe(400);
    expect((await call(f.db, "PATCH", `/api/forum/${f.post.id}`, { body: { title: "ok", body: "x".repeat(2001) }, cookie: f.author.cookie })).status).toBe(400);
    // pending → 403
    const pending = verifiedUser(f.db, "pending@example.com");
    pending.rec.status = "pending";
    expect((await call(f.db, "PATCH", `/api/forum/${f.post.id}`, { body: { title: "T", body: "B" }, cookie: pending.cookie })).status).toBe(403);
    // suspended author → 403
    const susp = verifiedUser(f.db, "susp@example.com");
    const sp = f.db.addForumPost({ id: "post-2", section: "community", title: "S", body: "B", cityId: "columbia-mo", authorAccountId: susp.rec.id, state: "visible", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    f.db.upsertContent({ id: "post:post-2", cityId: "columbia-mo", kind: "post", refId: "post-2", title: "S", authorLabel: "Runner", authorAccountId: susp.rec.id, featured: false, pinned: false, hidden: false, hiddenAt: null, archived: false, archivedAt: null });
    susp.rec.suspended = true; susp.rec.suspendedUntil = null;
    expect((await call(f.db, "PATCH", `/api/forum/${sp.id}`, { body: { title: "T", body: "B" }, cookie: susp.cookie })).status).toBe(403);
  });

  it("cross-city author edit is denied; edit after moderation-hide is post_unavailable", async () => {
    const f = forumSetup();
    // author moved cities after posting
    f.author.rec.cityId = "kc-mo";
    const moved = await call(f.db, "PATCH", `/api/forum/${f.post.id}`, { body: { title: "T", body: "B" }, cookie: f.author.cookie });
    expect(moved.status).toBe(403);
    expect(moved.body.error).toBe("cross_city_denied");
    f.author.rec.cityId = "columbia-mo";
    // moderation-hide (registry) → post_unavailable for author edits
    const content = f.db.getContent(`post:${f.post.id}`)!;
    f.db.upsertContent({ ...content, hidden: true });
    const hidden = await call(f.db, "PATCH", `/api/forum/${f.post.id}`, { body: { title: "T", body: "B" }, cookie: f.author.cookie });
    expect(hidden.status).toBe(403);
    expect(hidden.body.error).toBe("post_unavailable");
  });

  it("author delete soft-deletes (state deleted, blanked) and archives the registry row", async () => {
    const f = forumSetup();
    // a reply on the post so we can assert counts stop rendering
    const r2 = f.db.addForumReply({ id: "reply-2", postId: f.post.id, cityId: "columbia-mo", authorAccountId: f.other.rec.id, body: "another reply", state: "visible", createdAt: "2026-01-01T00:00:01.000Z", updatedAt: "2026-01-01T00:00:01.000Z" });
    expect(f.db.listForumReplies(f.post.id)).toHaveLength(2);
    const del = await call(f.db, "DELETE", `/api/forum/${f.post.id}`, { cookie: f.author.cookie });
    expect(del.status).toBe(200);
    const stored = f.db.getForumPost(f.post.id)!;
    expect(stored.state).toBe("deleted");
    expect(stored.title).toBe("");
    expect(stored.body).toBe("");
    const content = f.db.getContent(`post:${f.post.id}`)!;
    expect(content.archived).toBe(true);
    expect(content.archivedAt).toBeTruthy();
    // replies stay stored at the row level (trail preserved) but the post is
    // gone from public rendering (state deleted + registry archived)
    expect(f.db.listForumReplies(f.post.id)).toHaveLength(2);
    expect(f.db.getForumReply(r2.id)!.state).toBe("visible");
    expect(publicForumPosts(f.db, "columbia-mo").some((p) => p.id === f.post.id)).toBe(false);
    // audit
    const entry = f.db.listAudit(50).find((a) => a.action === "forum.post_delete" && a.targetId === f.post.id);
    expect(entry).toBeTruthy();
    expect(entry!.owner).toBe("author@example.com");
    // second delete → 404
    expect((await call(f.db, "DELETE", `/api/forum/${f.post.id}`, { cookie: f.author.cookie })).status).toBe(404);
    // non-author delete → 404
    const f2 = forumSetup();
    expect((await call(f2.db, "DELETE", `/api/forum/${f2.post.id}`, { cookie: f2.other.cookie })).status).toBe(404);
  });
});

describe("forum reply author edit/delete", () => {
  it("author edits/validates/audits; non-author 404", async () => {
    const f = forumSetup();
    const ok = await call(f.db, "PATCH", `/api/forum/replies/${f.reply.id}`, { body: { body: "Edited reply" }, cookie: f.author.cookie });
    expect(ok.status).toBe(200);
    expect(f.db.getForumReply(f.reply.id)!.body).toBe("Edited reply");
    expect((await call(f.db, "PATCH", `/api/forum/replies/${f.reply.id}`, { body: { body: "" }, cookie: f.author.cookie })).status).toBe(400);
    expect((await call(f.db, "PATCH", `/api/forum/replies/${f.reply.id}`, { body: { body: "x".repeat(1001) }, cookie: f.author.cookie })).status).toBe(400);
    expect((await call(f.db, "PATCH", `/api/forum/replies/${f.reply.id}`, { body: { body: "no" }, cookie: f.other.cookie })).status).toBe(404);
    const entry = f.db.listAudit(50).find((a) => a.action === "forum.reply_edit" && a.targetId === f.reply.id);
    expect(entry).toBeTruthy();
    expect(entry!.cityId).toBe("columbia-mo");
  });
  it("author delete flips visible -> deleted and audits; non-author 404", async () => {
    const f = forumSetup();
    expect((await call(f.db, "DELETE", `/api/forum/replies/${f.reply.id}`, { cookie: f.other.cookie })).status).toBe(404);
    expect((await call(f.db, "DELETE", `/api/forum/replies/${f.reply.id}`, { cookie: f.author.cookie })).status).toBe(200);
    const stored = f.db.getForumReply(f.reply.id)!;
    expect(stored.state).toBe("deleted");
    expect(stored.body).toBe("");
    expect((await call(f.db, "DELETE", `/api/forum/replies/${f.reply.id}`, { cookie: f.author.cookie })).status).toBe(404);
    const entry = f.db.listAudit(50).find((a) => a.action === "forum.reply_delete" && a.targetId === f.reply.id);
    expect(entry).toBeTruthy();
    expect(entry!.owner).toBe("author@example.com");
  });
});

describe("occurrence discussion author edit (PATCH)", () => {
  function setup() {
    const db = createMemoryStore();
    materializeSeedEvents(db, CITIES);
    const event = db.listEvents()[0]!;
    const date = "2026-08-03";
    const occurrence = `event:${event.id}:${date}`;
    const account = verifiedUser(db, "runner@example.com", event.cityId);
    db.addAttendance({ id: "att", accountId: account.rec.id, eventId: event.id, role: "rsvp", createdAt: "now", occurrenceId: occurrence, runDate: date, startsAt: `${date}T18:00:00.000Z` });
    return { db, event, occurrence, account };
  }
  const path = (e: string, o: string, id: string) => `/api/events/${encodeURIComponent(e)}/occurrences/${encodeURIComponent(o)}/discussion/${id}`;

  it("author edits own thread; non-participant and non-author are denied", async () => {
    const f = setup();
    const created = await call(f.db, "POST", `/api/events/${encodeURIComponent(f.event.id)}/occurrences/${encodeURIComponent(f.occurrence)}/discussion`, { body: { title: "Thread", body: "body" }, cookie: f.account.cookie });
    expect(created.status).toBe(200);
    const id = created.body.discussion.id;
    // guest → 401
    expect((await call(f.db, "PATCH", path(f.event.id, f.occurrence, id), { body: { body: "x" } })).status).toBe(401);
    // author edit OK, body 1-1000, title 1-120
    const ok = await call(f.db, "PATCH", path(f.event.id, f.occurrence, id), { body: { body: "edited body", title: "Edited thread" }, cookie: f.account.cookie });
    expect(ok.status).toBe(200);
    expect(ok.body.discussion.body).toBe("edited body");
    expect((await call(f.db, "PATCH", path(f.event.id, f.occurrence, id), { body: { body: "" }, cookie: f.account.cookie })).status).toBe(400);
    expect((await call(f.db, "PATCH", path(f.event.id, f.occurrence, id), { body: { body: "x".repeat(1001) }, cookie: f.account.cookie })).status).toBe(400);
    // non-author (verified, RSVP'd) → 404
    const stranger = verifiedUser(f.db, "stranger@example.com", f.event.cityId);
    f.db.addAttendance({ id: "att2", accountId: stranger.rec.id, eventId: f.event.id, role: "rsvp", createdAt: "now", occurrenceId: f.occurrence, runDate: "2026-08-03" });
    expect((await call(f.db, "PATCH", path(f.event.id, f.occurrence, id), { body: { body: "x" }, cookie: stranger.cookie })).status).toBe(404);
    // verified same-city runner with NO RSVP → 403 participant gate
    const outsider = verifiedUser(f.db, "outsider@example.com", f.event.cityId);
    expect((await call(f.db, "PATCH", path(f.event.id, f.occurrence, id), { body: { body: "x" }, cookie: outsider.cookie })).status).toBe(403);
    // audit
    const entry = f.db.listAudit(50).find((a) => a.action === "discussion.edit" && a.targetId === id);
    expect(entry).toBeTruthy();
    expect(entry!.owner).toBe("runner@example.com");
    expect(entry!.cityId).toBe(f.event.cityId);
  });
});

describe("submission withdrawal", () => {
  it("author withdraws pending -> withdrawn; queue excludes, my list keeps; decided -> 409", async () => {
    const db = createMemoryStore();
    const submitter = verifiedUser(db, "sub@example.com");
    const other = verifiedUser(db, "other@example.com");
    const created = await call(db, "POST", "/api/submissions/race", {
      body: { name: "River 5K", distances: "5K", date: "2026-10-01", location: "Flat Branch", registrationUrl: "https://example.com/r", description: "A 5K." },
      cookie: submitter.cookie,
    });
    expect(created.status).toBe(200);
    expect(created.status).toBe(200);
    // my submissions shows pending
    const mine = await call(db, "GET", "/api/my/submissions", { cookie: submitter.cookie });
    const rec = (mine.body.submissions as any[]).find((s) => s.status === "pending")!;
    const id = rec.id;
    expect(rec).toBeTruthy();
    expect(rec.status).toBe("pending");
    // withdraw
    const w = await call(db, "POST", `/api/my/submissions/${id}/withdraw`, { cookie: submitter.cookie });
    expect(w.status).toBe(200);
    expect(w.body.submission.status).toBe("withdrawn");
    const stored = db.getSubmission(id)!;
    expect(stored.status).toBe("withdrawn");
    // audit
    const entry = db.listAudit(50).find((a) => a.action === "submission.withdraw" && a.targetId === id);
    expect(entry).toBeTruthy();
    expect(entry!.cityId).toBe("columbia-mo");
    expect(entry!.owner).toBe("sub@example.com");
    // non-author → 404
    expect((await call(db, "POST", `/api/my/submissions/${id}/withdraw`, { cookie: other.cookie })).status).toBe(404);
    // already decided → 409
    expect((await call(db, "POST", `/api/my/submissions/${id}/withdraw`, { cookie: submitter.cookie })).status).toBe(409);
    // admin pending queue excludes withdrawn
    const adminLoginRes = adminLogin(db, KEY, "198.51.100.42");
    expect(adminLoginRes.ok).toBe(true);
    const adminCookie = `runlocal_admin=${adminLoginRes.ok ? adminLoginRes.data.sessionId : ""}`;
    const queue = await call(db, "GET", "/api/admin/submissions?status=pending", { cookie: adminCookie, reason: "review" });
    expect(queue.status).toBe(200);
    expect((queue.body.results as any[]).some((s) => s.id === id)).toBe(false);
    // my submissions retains it with withdrawn status
    const mine2 = await call(db, "GET", "/api/my/submissions", { cookie: submitter.cookie });
    expect((mine2.body.submissions as any[]).find((s) => s.id === id)!.status).toBe("withdrawn");
  });

  it("guest withdraw → 401", async () => {
    const db = createMemoryStore();
    expect((await call(db, "POST", "/api/my/submissions/x/withdraw")).status).toBe(401);
  });
});

describe("admin audit-log read is routine (no operator reason)", () => {
  it("adminAuditLog succeeds with a routine (server-generated) reason", () => {
    const db = createMemoryStore();
    const login = adminLogin(db, KEY, "198.51.100.1");
    expect(login.ok).toBe(true);
    const ctx = { userSessionId: null, adminSessionId: login.ok ? login.data.sessionId : "", ip: "198.51.100.1", reason: undefined as unknown as string };
    const res = adminAuditLog(db, ctx, 10);
    expect(res.ok).toBe(true);
    // The routine read must succeed WITHOUT an operator reason: the read itself
    // is audited with the server-generated "Routine admin read" reason, and no
    // reason-required rejection is raised even though ctx.reason is undefined.
    if (res.ok) {
      expect(Array.isArray(res.data)).toBe(true);
      const read = res.data.find((a) => a.action === "admin.audit");
      expect(read).toBeTruthy();
      expect(read!.reason).toBe("Routine admin read");
      expect(read!.ip).toBe("198.51.100.1");
    }
  });
  it("admin /api/admin/audit works without x-audit-reason (routine read)", async () => {
    const db = createMemoryStore();
    const loginRes = adminLogin(db, KEY, "198.51.100.42");
    expect(loginRes.ok).toBe(true);
    const adminCookie = `runlocal_admin=${loginRes.ok ? loginRes.data.sessionId : ""}`;
    const res = await call(db, "GET", "/api/admin/audit", { cookie: adminCookie });
    expect(res.status).toBe(200);
    expect(res.body.entries).toBeTruthy();
  });
});

describe("role revoked mid-session is enforced server-side", () => {
  it("a City Admin whose role is revoked is denied on the SAME session's next admin action", async () => {
    const db = createMemoryStore();
    seedCmsCities(db);
    // owner (global) for the revocation
    const owner = db.createAccount({ name: "Owner", email: DEFAULT_OWNER_EMAIL });
    owner.status = "verified";
    const ownerSid = db.createSession(owner.id, "test");
    const ownerCtx = { userSessionId: ownerSid.id, adminSessionId: null, ip: "198.51.100.2", reason: "revoking in test" };
    // city admin target
    const pat = db.createAccount({ name: "Pat", email: "pat@example.com", cityId: "columbia-mo" });
    pat.status = "verified";
    expect(assignCityAdmin(db, ownerCtx, "pat@example.com", "columbia-mo").ok).toBe(true);
    const patSid = db.createSession(pat.id, "test");
    const patCookie = `${SESSION_COOKIE}=${patSid.id}`;
    // city-scoped admin action with a valid reason succeeds first
    const before = await call(db, "GET", "/api/admin/events?city=columbia-mo", { cookie: patCookie, reason: "routine review" });
    expect(before.status).toBe(200);
    // revoke mid-session
    expect(revokeCityAdmin(db, ownerCtx, pat.id).ok).toBe(true);
    // same session, same cookie: now denied (401 unauthorized — no longer city_admin)
    const after = await call(db, "GET", "/api/admin/events?city=columbia-mo", { cookie: patCookie, reason: "routine review" });
    expect(after.status).toBe(401);
  });
});
