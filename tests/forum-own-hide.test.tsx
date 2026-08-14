/**
 * Forum author self-service hide/restore — server-authoritative tests.
 *
 * Locks the owner-directed contract: creators can Hide/Restore their OWN forum
 * posts; Pin/Unpin stays City Admin + Global Admin only.
 *
 *  - capabilities: a verified author gets hide_own on a visible post and
 *    restore_own once it is hidden (plus the existing edit_own/delete_own/tag)
 *    and NEVER pin/unpin; a Group Lead who is not the author gets report at
 *    most; City Admins get pin/unpin in their own city only; Global Admins
 *    anywhere.
 *  - endpoint (PATCH /api/forum/:id/hide with { hidden }): author hide removes
 *    the post from public reads and zeroes/404s its replies; restore brings
 *    both back; non-authors 404 (never leaked); seed/unknown posts 404; guests
 *    401; malformed/same-state bodies 400; every mutation is audited
 *    (forum.hide_own / forum.restore_own) with the author identity.
 *  - client: actionModel metadata (Hide/Restore, reversible, matching the
 *    admin iconography) and the ForumPage render contract (Hide/Restore for
 *    author capabilities, Pin only when present).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Readable, Writable } from "node:stream";
import { apiHandler, SESSION_COOKIE } from "../src/server/api";
import { createMemoryStore } from "../src/server/store";
import { CITIES } from "../src/data/cities";
import { DEFAULT_OWNER_EMAIL } from "../src/server/owner";
import { forumPostCapabilities, publicForumPosts } from "../src/server/forum";
import type { AccountRecord } from "../src/server/types";
import { ACTION_META, actionMenuItems } from "../src/lib/actionModel";
import { ActionMenuPanel } from "../src/components/ActionMenu";
import { PostCard, type ForumPostRow } from "../src/pages/ForumPage";

function req(method: string, path: string, body?: unknown, cookie?: string) {
  const input = body === undefined ? "" : JSON.stringify(body);
  const r = Readable.from([input]) as Readable & { method: string; url: string; headers: Record<string, string>; socket: { remoteAddress: string } };
  r.method = method; r.url = path; r.headers = { ...(cookie ? { cookie } : {}) }; r.socket = { remoteAddress: "127.0.0.1" };
  return r;
}
async function call(db: ReturnType<typeof createMemoryStore>, method: string, path: string, body?: unknown, cookie?: string) {
  let status = 0; let payload = "";
  const res = new Writable({ write(chunk, _encoding, done) { payload += chunk.toString(); done(); } }) as Writable & { statusCode: number; headersSent: boolean; setHeader: (n: string, v: unknown) => void; writeHead: (s: number, h: Record<string, unknown>) => void; end: (v?: unknown) => void };
  res.statusCode = 200; res.headersSent = false; res.setHeader = () => {}; res.writeHead = (s) => { status = s; res.headersSent = true; }; (res as any).end = (v?: unknown) => { if (v) payload += String(v); };
  await apiHandler(req(method, path, body, cookie) as never, res as never, db);
  return { status, body: payload ? JSON.parse(payload) : {} };
}

const T0 = new Date("2026-08-03T12:00:00.000Z");
const CITY_ID = CITIES[0]!.id;
const OTHER_CITY = "jefferson-city-mo";

function setup() {
  const db = createMemoryStore({ now: () => T0 });
  const member = db.createAccount({ name: "Taylor Runner", email: "taylor@example.com", cityId: CITY_ID });
  db.updateAccount(member.id, { status: "verified" });
  const other = db.createAccount({ name: "Jordan Lee", email: "jordan@example.com", cityId: CITY_ID });
  db.updateAccount(other.id, { status: "verified" });
  // Group Lead: verified, owns a group in the post's city — but is NOT the
  // post author and NOT an admin. Group-lead scope is events/groups; forum
  // posts stay author/admin-only.
  const lead = db.createAccount({ name: "Casey Lead", email: "lead@example.com", cityId: CITY_ID });
  db.updateAccount(lead.id, { status: "verified" });
  db.upsertGroup({ id: "g1", cityId: CITY_ID, name: "Lead Club", ownerId: lead.id, leaderIds: [], membershipMode: "open", rrcaBadge: false, rrcaNote: null, rrcaNoteUpdatedAt: null });
  const owner = db.createAccount({ name: "Trae Owner", email: DEFAULT_OWNER_EMAIL, cityId: CITY_ID });
  db.updateAccount(owner.id, { status: "verified" });
  const cityAdmin = db.createAccount({ name: "City Admin", email: "cityadmin@example.com", cityId: CITY_ID });
  db.updateAccount(cityAdmin.id, { status: "verified", role: "city_admin", adminCityId: CITY_ID });
  const otherCityAdmin = db.createAccount({ name: "Other City Admin", email: "otherca@example.com", cityId: OTHER_CITY });
  db.updateAccount(otherCityAdmin.id, { status: "verified", role: "city_admin", adminCityId: OTHER_CITY });
  // updateAccount replaces the record — re-read so the returned objects carry
  // the verified status / roles (the pre-update references are stale).
  const session = (rec: AccountRecord) => `${SESSION_COOKIE}=${db.createSession(rec.id, "test").id}`;
  const memberRec = db.getAccount(member.id)!;
  const otherRec = db.getAccount(other.id)!;
  const leadRec = db.getAccount(lead.id)!;
  const ownerRec = db.getAccount(owner.id)!;
  const cityAdminRec = db.getAccount(cityAdmin.id)!;
  const otherCityAdminRec = db.getAccount(otherCityAdmin.id)!;
  return {
    db,
    member: memberRec,
    other: otherRec,
    lead: leadRec,
    owner: ownerRec,
    cityAdmin: cityAdminRec,
    otherCityAdmin: otherCityAdminRec,
    memberCookie: session(memberRec),
    otherCookie: session(otherRec),
    leadCookie: session(leadRec),
    ownerCookie: session(ownerRec),
    cityAdminCookie: session(cityAdminRec),
    otherCityAdminCookie: session(otherCityAdminRec),
  };
}

async function createPost(f: ReturnType<typeof setup>): Promise<string> {
  const r = await call(f.db, "POST", "/api/forum", { section: "community", title: "New group route", body: "We added a 5K loop along the river." }, f.memberCookie);
  expect(r.status).toBe(200);
  return r.body.post.id as string;
}

async function addReply(f: ReturnType<typeof setup>, postId: string): Promise<void> {
  const r = await call(f.db, "POST", "/api/forum/replies", { postId, body: "I'm in for the 5K loop." }, f.otherCookie);
  expect(r.status).toBe(200);
}

describe("forum post capabilities — author hide_own/restore_own", () => {
  it("author of their own visible post gets hide_own + edit_own/delete_own/tag and NEVER pin/unpin", () => {
    const f = setup();
    const post = { authorAccountId: f.member.id, cityId: CITY_ID, pinned: false };
    const caps = forumPostCapabilities(f.member, post, T0);
    expect(caps).toContain("hide_own");
    expect(caps).not.toContain("restore_own");
    expect(caps).toContain("edit_own");
    expect(caps).toContain("delete_own");
    expect(caps).toContain("tag");
    expect(caps).not.toContain("pin");
    expect(caps).not.toContain("unpin");
    expect(caps).not.toContain("report");
    // Order is stable: existing author actions first, hide_own appended last.
    expect(caps).toEqual(["edit_own", "delete_own", "tag", "hide_own"]);
  });

  it("author of their own HIDDEN post gets restore_own instead of hide_own", () => {
    const f = setup();
    const hidden = { authorAccountId: f.member.id, cityId: CITY_ID, pinned: false, hidden: true };
    const caps = forumPostCapabilities(f.member, hidden, T0);
    expect(caps).toContain("restore_own");
    expect(caps).not.toContain("hide_own");
    expect(caps).not.toContain("pin");
    expect(caps).not.toContain("unpin");
  });

  it("Group Lead who is not the author gets report at most — never pin/unpin or hide/restore", () => {
    const f = setup();
    // The lead owns a group in the post's city but did not author the post.
    const caps = forumPostCapabilities(f.lead, { authorAccountId: f.member.id, cityId: CITY_ID, pinned: false }, T0);
    expect(caps).toEqual(["report"]);
    expect(caps).not.toContain("pin");
    expect(caps).not.toContain("unpin");
    expect(caps).not.toContain("hide_own");
    expect(caps).not.toContain("restore_own");
    expect(caps).not.toContain("edit_own");
  });

  it("City Admin gets pin/unpin in their own city only; Global Admin anywhere", () => {
    const f = setup();
    const inCity = { authorAccountId: f.member.id, cityId: CITY_ID, pinned: false };
    const outCity = { authorAccountId: f.member.id, cityId: OTHER_CITY, pinned: false };
    // In-scope City Admin: pin in own city, nothing in the other city.
    expect(forumPostCapabilities(f.cityAdmin, inCity, T0)).toContain("pin");
    expect(forumPostCapabilities(f.cityAdmin, inCity, T0)).not.toContain("unpin");
    const outCaps = forumPostCapabilities(f.cityAdmin, outCity, T0);
    expect(outCaps).not.toContain("pin");
    expect(outCaps).not.toContain("unpin");
    // Out-of-scope City Admin never sees pin/unpin anywhere.
    expect(forumPostCapabilities(f.otherCityAdmin, inCity, T0)).not.toContain("pin");
    // Global Admin: pin anywhere (unpin while pinned).
    expect(forumPostCapabilities(f.owner, inCity, T0)).toContain("pin");
    expect(forumPostCapabilities(f.owner, outCity, T0)).toContain("pin");
    expect(forumPostCapabilities(f.owner, { ...inCity, pinned: true }, T0)).toContain("unpin");
    // Guests get [].
    expect(forumPostCapabilities(null, inCity, T0)).toEqual([]);
  });
});

describe("PATCH /api/forum/:id/hide — author hide/restore", () => {
  it("author hide removes the post from public reads; replies stop counting and rendering; restore brings it back", async () => {
    const f = setup();
    const postId = await createPost(f);
    await addReply(f, postId);
    // Baseline: post visible with 1 persisted reply.
    expect((await call(f.db, "GET", `/api/forum?city=${encodeURIComponent(CITY_ID)}`)).body.posts.map((p: any) => p.id)).toContain(postId);
    expect(f.db.getContent(`post:${postId}`)!.hidden).toBe(false);
    expect(publicForumPosts(f.db, CITY_ID).find((p) => p.id === postId)!.replies).toBe(1);

    const hide = await call(f.db, "PATCH", `/api/forum/${postId}/hide`, { hidden: true }, f.memberCookie);
    expect(hide.status).toBe(200);
    expect(hide.body.post.capabilities).toContain("restore_own");
    expect(hide.body.post.capabilities).not.toContain("hide_own");
    expect(hide.body.post.replies).toBe(0);
    // Registry flag set — the same row the admin hide path uses.
    expect(f.db.getContent(`post:${postId}`)!.hidden).toBe(true);
    expect(f.db.getContent(`post:${postId}`)!.hiddenAt).toBe(T0.toISOString());
    // Gone from public reads (direct fn + HTTP).
    expect(publicForumPosts(f.db, CITY_ID).find((p) => p.id === postId)).toBeUndefined();
    const listed = await call(f.db, "GET", `/api/forum?city=${encodeURIComponent(CITY_ID)}`);
    expect(listed.body.posts.map((p: any) => p.id)).not.toContain(postId);
    expect(listed.body.replyCounts[postId]).toBe(0);
    // Replies stop rendering (404 — never leaked) and new replies are rejected.
    expect((await call(f.db, "GET", `/api/forum/replies?city=${encodeURIComponent(CITY_ID)}&post=${postId}`)).status).toBe(404);
    const reply = await call(f.db, "POST", "/api/forum/replies", { postId, body: "Too late — post is hidden." }, f.otherCookie);
    expect(reply.status).toBe(403);
    expect(reply.body.error).toBe("post_unavailable");

    // Restore brings everything back.
    const restore = await call(f.db, "PATCH", `/api/forum/${postId}/hide`, { hidden: false }, f.memberCookie);
    expect(restore.status).toBe(200);
    expect(restore.body.post.capabilities).toContain("hide_own");
    expect(restore.body.post.capabilities).not.toContain("restore_own");
    expect(restore.body.post.replies).toBe(1);
    expect(f.db.getContent(`post:${postId}`)!.hidden).toBe(false);
    expect(f.db.getContent(`post:${postId}`)!.hiddenAt).toBeNull();
    const listed2 = await call(f.db, "GET", `/api/forum?city=${encodeURIComponent(CITY_ID)}`);
    expect(listed2.body.posts.map((p: any) => p.id)).toContain(postId);
    expect(listed2.body.replyCounts[postId]).toBe(1);
    expect((await call(f.db, "GET", `/api/forum/replies?city=${encodeURIComponent(CITY_ID)}&post=${postId}`)).status).toBe(200);
  });

  it("non-author hide/restore is 404 — the post is never leaked (verified member AND group lead)", async () => {
    const f = setup();
    const postId = await createPost(f);
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/hide`, { hidden: true }, f.otherCookie)).status).toBe(404);
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/hide`, { hidden: true }, f.leadCookie)).status).toBe(404);
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/hide`, { hidden: false }, f.otherCookie)).status).toBe(404);
    expect(f.db.getContent(`post:${postId}`)!.hidden).toBe(false);
  });

  it("seed posts and unknown posts are 404 (no server record — never an 'own' target)", async () => {
    const f = setup();
    const seed = CITIES[0]!.forum[0]!;
    expect((await call(f.db, "PATCH", `/api/forum/${seed.id}/hide`, { hidden: true }, f.memberCookie)).status).toBe(404);
    expect((await call(f.db, "PATCH", "/api/forum/no-such-post/hide", { hidden: true }, f.memberCookie)).status).toBe(404);
  });

  it("guests get 401; malformed and same-state bodies get 400", async () => {
    const f = setup();
    const postId = await createPost(f);
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/hide`, { hidden: true })).status).toBe(401);
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/hide`, { hidden: "yes" }, f.memberCookie)).status).toBe(400);
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/hide`, {}, f.memberCookie)).status).toBe(400);
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/hide`, { hidden: true }, f.memberCookie)).status).toBe(200);
    // Already hidden → same-state 400.
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/hide`, { hidden: true }, f.memberCookie)).status).toBe(400);
    // Restore then restore again → same-state 400.
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/hide`, { hidden: false }, f.memberCookie)).status).toBe(200);
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/hide`, { hidden: false }, f.memberCookie)).status).toBe(400);
  });

  it("audits forum.hide_own and forum.restore_own with the author identity, city, and change summary", async () => {
    const f = setup();
    const postId = await createPost(f);
    await call(f.db, "PATCH", `/api/forum/${postId}/hide`, { hidden: true }, f.memberCookie);
    await call(f.db, "PATCH", `/api/forum/${postId}/hide`, { hidden: false }, f.memberCookie);
    const hide = f.db.listAudit(50).find((a) => a.action === "forum.hide_own" && a.targetId === postId);
    const restore = f.db.listAudit(50).find((a) => a.action === "forum.restore_own" && a.targetId === postId);
    expect(hide).toBeTruthy();
    expect(restore).toBeTruthy();
    expect(hide!.admin).toBe("taylor@example.com");
    expect(hide!.owner).toBe("taylor@example.com");
    expect(hide!.cityId).toBe(CITY_ID);
    expect(hide!.ip).toBe("author-action");
    expect(hide!.change).toContain("hidden by author");
    expect(restore!.change).toContain("restored by author");
  });
});

describe("client — actionModel + ForumPage render contract", () => {
  it("hide_own/restore_own metadata: reversible, matching the admin iconography", () => {
    expect(ACTION_META.hide_own).toEqual({ key: "hide_own", label: "Hide", icon: "eyeOff", danger: false });
    expect(ACTION_META.restore_own).toEqual({ key: "restore_own", label: "Restore", icon: "clock", danger: false });
    expect(actionMenuItems(["edit_own", "delete_own", "tag", "hide_own"]).map((m) => m.label)).toEqual(["Edit", "Delete", "Tag a runner", "Hide"]);
    expect(actionMenuItems(["edit_own", "delete_own", "tag", "restore_own"]).map((m) => m.label)).toEqual(["Edit", "Delete", "Tag a runner", "Restore"]);
  });

  it("ForumPage renders Hide/Restore for author capabilities and Pin only when the server sends it", () => {
    // Author capabilities (server-computed) → Hide row, never Pin.
    const authorPanel = renderToStaticMarkup(
      <ActionMenuPanel items={actionMenuItems(["edit_own", "delete_own", "tag", "hide_own"])} onSelect={() => {}} />,
    );
    expect(authorPanel).toContain("Hide");
    expect(authorPanel).not.toContain("Pin");
    // Hidden post → Restore row instead of Hide.
    const restorePanel = renderToStaticMarkup(
      <ActionMenuPanel items={actionMenuItems(["edit_own", "delete_own", "tag", "restore_own"])} onSelect={() => {}} />,
    );
    expect(restorePanel).toContain("Restore");
    expect(restorePanel).not.toContain("Hide");
    // Admin list with pin → Pin row renders; author list without it never does.
    const adminPanel = renderToStaticMarkup(
      <ActionMenuPanel items={actionMenuItems(["hide", "restore", "delete", "pin"])} onSelect={() => {}} />,
    );
    expect(adminPanel).toContain("Pin");
  });

  it("PostCard renders the action trigger for an author with hide_own capabilities", () => {
    const post: ForumPostRow = {
      id: "p1",
      section: "community",
      title: "New group route",
      body: "We added a 5K loop along the river.",
      author: "Taylor Runner",
      createdAt: "Aug 1",
      replies: 2,
      pinned: false,
      capabilities: ["edit_own", "delete_own", "tag", "hide_own"],
    };
    const html = renderToStaticMarkup(
      <PostCard post={post} section="community" onReply={() => {}} verified onAction={() => {}} />,
    );
    expect(html).toContain('aria-label="Actions for New group route"');
    expect(html).toContain('aria-haspopup="menu"');
  });
});
