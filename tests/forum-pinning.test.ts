/**
 * Forum pin/unpin — server-authoritative tests.
 *
 * Pins the production slice: Global Admins and in-scope City Admins can pin a
 * user-created forum post (PATCH /api/forum/:id/pin), the change persists on
 * the post record (survives reads and the registry mirror), every mutation is
 * audited (forum.pin / forum.unpin), and everyone else is denied — guests 401,
 * signed-in non-admins and out-of-scope City Admins 403, unknown/seed posts
 * 404, same-state requests and malformed bodies 400. The capability list the
 * client renders mirrors the same rules: admins see "pin" while unpinned and
 * "unpin" while pinned; non-admins never see either.
 */
import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { apiHandler, SESSION_COOKIE } from "../src/server/api";
import { createMemoryStore } from "../src/server/store";
import { CITIES } from "../src/data/cities";
import { DEFAULT_OWNER_EMAIL } from "../src/server/owner";
import { forumPostCapabilities, publicForumPosts } from "../src/server/forum";
import type { AccountRecord } from "../src/server/types";

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

function setup() {
  const db = createMemoryStore({ now: () => T0 });
  const member = db.createAccount({ name: "Taylor Runner", email: "taylor@example.com", cityId: CITY_ID });
  member.status = "verified";
  const owner = db.createAccount({ name: "Trae Owner", email: DEFAULT_OWNER_EMAIL, cityId: CITY_ID });
  owner.status = "verified";
  const cityAdmin = db.createAccount({ name: "City Admin", email: "cityadmin@example.com", cityId: CITY_ID });
  cityAdmin.status = "verified";
  db.updateAccount(cityAdmin.id, { role: "city_admin", adminCityId: CITY_ID });
  const otherCityAdmin = db.createAccount({ name: "Other City Admin", email: "otherca@example.com", cityId: "jefferson-city-mo" });
  otherCityAdmin.status = "verified";
  db.updateAccount(otherCityAdmin.id, { role: "city_admin", adminCityId: "jefferson-city-mo" });
  // updateAccount replaces the record — re-read so the returned objects carry the role.
  const cityAdminRec = db.getAccount(cityAdmin.id)!;
  const otherCityAdminRec = db.getAccount(otherCityAdmin.id)!;
  const session = (rec: AccountRecord) => `${SESSION_COOKIE}=${db.createSession(rec.id, "test").id}`;
  return {
    db,
    member,
    owner,
    cityAdmin: cityAdminRec,
    otherCityAdmin: otherCityAdminRec,
    memberCookie: session(member),
    ownerCookie: session(owner),
    cityAdminCookie: session(cityAdminRec),
    otherCityAdminCookie: session(otherCityAdminRec),
  };
}

async function createPost(f: ReturnType<typeof setup>): Promise<string> {
  const r = await call(f.db, "POST", "/api/forum", { section: "community", title: "New group route", body: "We added a 5K loop along the river." }, f.memberCookie);
  expect(r.status).toBe(200);
  return r.body.post.id as string;
}

describe("forum pin/unpin capabilities", () => {
  it("admin gets pin while unpinned, unpin while pinned; non-admins never do", () => {
    const f = setup();
    const unpinned = { authorAccountId: f.member.id, cityId: CITY_ID, pinned: false };
    const pinned = { authorAccountId: f.member.id, cityId: CITY_ID, pinned: true };
    const ownerCaps = forumPostCapabilities(f.owner, unpinned, T0);
    expect(ownerCaps).toContain("pin");
    expect(ownerCaps).not.toContain("unpin");
    expect(forumPostCapabilities(f.owner, pinned, T0)).toContain("unpin");
    expect(forumPostCapabilities(f.owner, pinned, T0)).not.toContain("pin");
    // In-scope City Admin sees the same admin set.
    expect(forumPostCapabilities(f.cityAdmin, unpinned, T0)).toContain("pin");
    expect(forumPostCapabilities(f.cityAdmin, pinned, T0)).toContain("unpin");
    // A verified member (not the author) never gets pin/unpin — Report only.
    const memberCaps = forumPostCapabilities(f.member, { authorAccountId: f.owner.id, cityId: CITY_ID, pinned: false }, T0);
    expect(memberCaps).not.toContain("pin");
    expect(memberCaps).not.toContain("unpin");
    expect(memberCaps).toContain("report");
    // Out-of-scope City Admin never gets pin/unpin.
    const outCaps = forumPostCapabilities(f.otherCityAdmin, unpinned, T0);
    expect(outCaps).not.toContain("pin");
    expect(outCaps).not.toContain("unpin");
    // Guests get [].
    expect(forumPostCapabilities(null, unpinned, T0)).toEqual([]);
  });
});

describe("PATCH /api/forum/:id/pin", () => {
  it("Global Admin pins a user post — persisted, public read reflects it, registry mirrored", async () => {
    const f = setup();
    const postId = await createPost(f);
    const r = await call(f.db, "PATCH", `/api/forum/${postId}/pin`, { pinned: true }, f.ownerCookie);
    expect(r.status).toBe(200);
    expect(r.body.post.pinned).toBe(true);
    expect(r.body.post.capabilities).toContain("unpin");
    // Record persisted.
    expect(f.db.getForumPost(postId)!.pinned).toBe(true);
    // Public read reflects the pin.
    const listed = publicForumPosts(f.db, CITY_ID);
    expect(listed[0]!.pinned).toBe(true);
    const viaApi = await call(f.db, "GET", `/api/forum?city=${encodeURIComponent(CITY_ID)}`);
    expect(viaApi.body.posts[0].pinned).toBe(true);
    // Registry row mirrored so admin surfaces stay in sync.
    expect(f.db.getContent(`post:${postId}`)!.pinned).toBe(true);
  });

  it("unpin flips the post back and audits forum.unpin with the admin identity", async () => {
    const f = setup();
    const postId = await createPost(f);
    await call(f.db, "PATCH", `/api/forum/${postId}/pin`, { pinned: true }, f.ownerCookie);
    const r = await call(f.db, "PATCH", `/api/forum/${postId}/pin`, { pinned: false }, f.ownerCookie);
    expect(r.status).toBe(200);
    expect(r.body.post.pinned).toBe(false);
    expect(r.body.post.capabilities).toContain("pin");
    expect(f.db.getForumPost(postId)!.pinned).toBe(false);
    expect(f.db.getContent(`post:${postId}`)!.pinned).toBe(false);
    const pin = f.db.listAudit(50).find((a) => a.action === "forum.pin" && a.targetId === postId);
    const unpin = f.db.listAudit(50).find((a) => a.action === "forum.unpin" && a.targetId === postId);
    expect(pin).toBeTruthy();
    expect(unpin).toBeTruthy();
    expect(unpin!.admin).toBe(DEFAULT_OWNER_EMAIL);
    expect(unpin!.owner).toBe(DEFAULT_OWNER_EMAIL);
    expect(unpin!.cityId).toBe(CITY_ID);
    expect(unpin!.change).toContain("New group route");
  });

  it("in-scope City Admin can pin; same-state and malformed bodies are 400", async () => {
    const f = setup();
    const postId = await createPost(f);
    const r = await call(f.db, "PATCH", `/api/forum/${postId}/pin`, { pinned: true }, f.cityAdminCookie);
    expect(r.status).toBe(200);
    expect(r.body.post.pinned).toBe(true);
    // Same state is rejected.
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/pin`, { pinned: true }, f.cityAdminCookie)).status).toBe(400);
    // Non-boolean pinned is rejected.
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/pin`, { pinned: "yes" }, f.cityAdminCookie)).status).toBe(400);
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/pin`, {}, f.cityAdminCookie)).status).toBe(400);
  });

  it("verified non-admin gets 403", async () => {
    const f = setup();
    const postId = await createPost(f);
    const r = await call(f.db, "PATCH", `/api/forum/${postId}/pin`, { pinned: true }, f.memberCookie);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("admin_required");
    expect(f.db.getForumPost(postId)!.pinned).toBe(false);
  });

  it("out-of-scope City Admin gets 403", async () => {
    const f = setup();
    const postId = await createPost(f);
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/pin`, { pinned: true }, f.otherCityAdminCookie)).status).toBe(403);
  });

  it("guest gets 401", async () => {
    const f = setup();
    const postId = await createPost(f);
    expect((await call(f.db, "PATCH", `/api/forum/${postId}/pin`, { pinned: true })).status).toBe(401);
  });

  it("unknown post gets 404 (seed posts too — only user records are pinnable)", async () => {
    const f = setup();
    expect((await call(f.db, "PATCH", "/api/forum/no-such-post/pin", { pinned: true }, f.ownerCookie)).status).toBe(404);
    // Seed posts live in the client city data — no server record, so 404.
    const seed = CITIES[0]!.forum[0]!;
    expect((await call(f.db, "PATCH", `/api/forum/${seed.id}/pin`, { pinned: true }, f.ownerCookie)).status).toBe(404);
  });

  it("audits forum.pin with actor identity, city, and change summary", async () => {
    const f = setup();
    const postId = await createPost(f);
    await call(f.db, "PATCH", `/api/forum/${postId}/pin`, { pinned: true }, f.cityAdminCookie);
    const entry = f.db.listAudit(50).find((a) => a.action === "forum.pin" && a.targetId === postId);
    expect(entry).toBeTruthy();
    expect(entry!.admin).toBe("cityadmin@example.com");
    expect(entry!.cityId).toBe(CITY_ID);
    expect(entry!.reason).toBe("Pinned forum post");
    expect(entry!.change).toContain("pinned:");
  });
});
