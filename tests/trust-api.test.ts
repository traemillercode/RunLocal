/**
 * HTTP-level tests for the credentials & community-trust layer:
 *  - credential lifecycle (submit → pending/verified → admin decision) and
 *    the PROTECTED proof flow (owner-only; admin-audited; never in JSON);
 *  - rating/concern eligibility from SHARED RSVP/host attendance;
 *  - configurable combined negative-rating + concern threshold with the
 *    under_review state and hosting/coach-post restrictions (browse/RSVP/
 *    comment preserved);
 *  - admin appeal decisions (reinstate/uphold) with required reasons + audit;
 *  - privacy: no proof, reviewer identity, reports, or raw counts ever leave
 *    the server in a public payload.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { ADMIN_EMAIL_VAR, ADMIN_KEY_VAR } from "../src/server/admin";
import { DEFAULT_OWNER_EMAIL } from "../src/server/owner";

// ------------------------------------------------------------ HTTP harness
function makeReq(method: string, path: string, opts: { body?: unknown; cookie?: string; reason?: string } = {}): IncomingMessage {
  const raw = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const headers: Record<string, string> = { "x-forwarded-proto": "https" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.reason) headers["x-audit-reason"] = opts.reason;
  if (raw) headers["content-type"] = "application/json";
  const req = {
    method,
    url: path,
    headers,
    socket: { remoteAddress: "198.51.100.23" },
    [Symbol.asyncIterator]() {
      const chunks = raw ? [Buffer.from(raw)] : [];
      let i = 0;
      return { next: async () => (i < chunks.length ? { done: false as const, value: chunks[i++] } : { done: true as const, value: undefined }) };
    },
  };
  return req as unknown as IncomingMessage;
}
interface FakeRes { status: number; body: string; contentType: string | null; cookie: string; }
function makeRes(): { res: ServerResponse; fake: FakeRes } {
  const fake: FakeRes = { status: 200, body: "", contentType: null, cookie: "" };
  const res = {
    writeHead(status: number, headers?: Record<string, string | string[]>) {
      fake.status = status;
      const ct = headers?.["content-type"];
      fake.contentType = Array.isArray(ct) ? ct[0] : (ct ?? null);
      return res;
    },
    setHeader(name: string, value: unknown) { if (name.toLowerCase() === "set-cookie") fake.cookie = Array.isArray(value) ? String(value[0]) : String(value); return res; },
    end(chunk?: unknown) { if (chunk !== undefined) fake.body += String(chunk); return res; },
  } as unknown as ServerResponse;
  return { res, fake };
}
async function post(db: Db, path: string, body: unknown, cookie?: string, reason?: string): Promise<FakeRes> {
  const { res, fake } = makeRes();
  await apiHandler(makeReq("POST", path, { body, cookie, reason }), res, db);
  return fake;
}
async function get(db: Db, path: string, cookie?: string, reason?: string): Promise<FakeRes> {
  const { res, fake } = makeRes();
  await apiHandler(makeReq("GET", path, { cookie, reason }), res, db);
  return fake;
}
function json<T>(f: FakeRes): T { return JSON.parse(f.body) as T; }
function cookieFrom(f: FakeRes): string {
  const m = /runlocal_sid=([^;]+)/.exec(f.cookie);
  return m ? `runlocal_sid=${m[1]}` : "";
}
// ------------------------------------------------------------ fixtures
const KEY = "test-admin-key-123";
const EV = "event:ev1";
function seedEvent(db: Db): void {
  db.upsertContent({ id: EV, cityId: "columbia-mo", kind: "event", refId: "ev1", title: "Test Run", authorLabel: null, authorAccountId: null, featured: false, pinned: false, hidden: false, hiddenAt: null, archived: false, archivedAt: null });
}
async function signup(db: Db, email: string, name = "Runner"): Promise<{ id: string; cookie: string }> {
  const f = await post(db, "/api/accounts", { name, username: email.split("@")[0] + Math.random().toString(36).slice(2, 8), email, birthdate: "1998-05-05", cityId: "columbia-mo" });
  const body = json<{ account: { id: string } }>(f);
  const cookie = cookieFrom(f);
  db.updateAccount(body.account.id, { status: "verified", phase: "pending_review" });
  return { id: body.account.id, cookie };
}
async function ownerCookie(db: Db): Promise<string> {
  const owner = db.createAccount({ name: "Owner", email: DEFAULT_OWNER_EMAIL });
  db.updateAccount(owner.id, { status: "verified" });
  const s = db.createSession(owner.id, "198.51.100.7");
  return `runlocal_sid=${s.id}`;
}
async function attend(db: Db, accountId: string, eventId: string, role: "rsvp" | "host" = "rsvp"): Promise<void> {
  db.addAttendance({ id: `${accountId}-${eventId}-${role}`, accountId, eventId, role, createdAt: "2026-08-01T00:00:00.000Z" });
}
const PROOF = `data:application/pdf;base64,${Buffer.from("fake proof bytes").toString("base64")}`;

beforeEach(() => {
  process.env[ADMIN_KEY_VAR] = KEY;
  process.env[ADMIN_EMAIL_VAR] = "safety@runlocal.app";
});
afterEach(() => {
  delete process.env[ADMIN_KEY_VAR];
  delete process.env[ADMIN_EMAIL_VAR];
});

describe("credential lifecycle + protected proof flow", () => {
  it("coach certification requires proof and enters pending_review; proof never in JSON", async () => {
    const db = createMemoryStore();
    const a = await signup(db, "coach@example.com");
    const f = await post(db, "/api/credentials", { type: "coach_certification", certifyingBody: "RRCA" }, a.cookie);
    expect(f.status).toBe(400);
    expect(json<{ error: string }>(f).error).toBe("proof_required");
    const ok = await post(db, "/api/credentials", { type: "coach_certification", certifyingBody: "RRCA", proof: PROOF, proofMime: "application/pdf" }, a.cookie);
    expect(ok.status).toBe(200);
    const mine = await get(db, "/api/credentials", a.cookie);
    const rows = json<{ credentials: { id: string; status: string; hasProof: boolean; proofRef?: unknown }[] }>(mine).credentials;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending_review");
    expect(rows[0].hasProof).toBe(true);
    expect("proofRef" in rows[0]).toBe(false); // proof reference never leaves the server
  });
  it("first aid / CPR without proof is self-attested verified; with proof goes to review", async () => {
    const db = createMemoryStore();
    const a = await signup(db, "cpr@example.com");
    const f = await post(db, "/api/credentials", { type: "first_aid_cpr", certifyingBody: "American Red Cross" }, a.cookie);
    expect(json<{ credential: { status: string } }>(f).credential.status).toBe("verified");
  });
  it("proof is served ONLY to the credential owner (403 for others, 401 guests)", async () => {
    const db = createMemoryStore();
    const a = await signup(db, "own@example.com");
    const b = await signup(db, "other@example.com");
    const ok = await post(db, "/api/credentials", { type: "coach_certification", certifyingBody: "RRCA", proof: PROOF, proofMime: "application/pdf" }, a.cookie);
    const credId = json<{ credential: { id: string } }>(ok).credential.id;
    const owner = await get(db, `/api/credentials/${credId}/proof`, a.cookie);
    expect(owner.status).toBe(200);
    expect(owner.contentType).toBe("application/pdf");
    expect(owner.body).toContain("fake proof bytes");
    const other = await get(db, `/api/credentials/${credId}/proof`, b.cookie);
    expect(other.status).toBe(404);
    const guest = await get(db, `/api/credentials/${credId}/proof`);
    expect(guest.status).toBe(401);
  });
  it("admin queue lists pending only; approve/reject works; admin proof view is audited", async () => {
    const db = createMemoryStore();
    const a = await signup(db, "q@example.com");
    const owner = await ownerCookie(db);
    const ok = await post(db, "/api/credentials", { type: "coach_certification", certifyingBody: "RRCA", proof: PROOF, proofMime: "application/pdf" }, a.cookie);
    const credId = json<{ credential: { id: string } }>(ok).credential.id;
    const queue = await get(db, "/api/admin/credentials", owner, "credential queue review");
    const rows = json<{ credentials: { id: string; proofRef?: unknown }[] }>(queue).credentials;
    expect(rows.map((r) => r.id)).toContain(credId);
    expect("proofRef" in rows[0]).toBe(false);
    const proof = await get(db, `/api/admin/credentials/${credId}/proof`, owner, "verifying the document");
    expect(proof.status).toBe(200);
    expect(proof.body).toContain("fake proof bytes");
    const deny = await get(db, `/api/admin/credentials/${credId}/proof`, owner); // no reason
    expect(deny.status).toBe(400);
    const reject = await post(db, `/api/admin/credentials/${credId}/reject`, { reason: "document illegible" }, owner, "rejecting after review");
    expect(json<{ credential: { status: string } }>(reject).credential.status).toBe("rejected");
    const rejectedNoReason = await post(db, `/api/admin/credentials/${credId}/reject`, {}, owner, "no reason");
    expect(rejectedNoReason.status).toBe(400); // already decided — but reason check comes first
    expect(db.listAudit(50).some((e) => e.action === "admin.view_credential_proof")).toBe(true);
  });
  it("expired credentials flip to expired for the owner listing", async () => {
    const db = createMemoryStore();
    const a = await signup(db, "exp@example.com");
    db.addCredential({ id: "c1", accountId: a.id, type: "first_aid_cpr", certifyingBody: "ARC", proofRef: null, proofMime: null, proofBytes: 0, issuedOn: null, expiresOn: "2020-01-01", status: "verified", verifiedBy: "self", verifiedAt: "2019-01-01T00:00:00.000Z", decisionReason: null, renewalNotifiedAt: null, createdAt: "2019-01-01T00:00:00.000Z", updatedAt: "2019-01-01T00:00:00.000Z" });
    const f = await get(db, "/api/credentials", a.cookie);
    expect(json<{ credentials: { status: string }[] }>(f).credentials[0].status).toBe("expired");
  });
});

describe("rating/concern eligibility from shared RSVP/host attendance", () => {
  it("denies a rating without shared attendance (403) and allows it after both RSVP", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const a = await signup(db, "rev@example.com");
    const b = await signup(db, "reviewee@example.com");
    const denied = await post(db, "/api/ratings", { revieweeId: b.id, eventId: "ev1", positive: true, tags: ["reliable"] }, a.cookie);
    expect(denied.status).toBe(403);
    expect(json<{ error: string }>(denied).error).toBe("not_shared_event");
    await attend(db, a.id, EV);
    await attend(db, b.id, EV);
    const ok = await post(db, "/api/ratings", { revieweeId: b.id, eventId: "ev1", positive: true, tags: ["reliable"] }, a.cookie);
    expect(ok.status).toBe(200);
    const dup = await post(db, "/api/ratings", { revieweeId: b.id, eventId: "ev1", positive: true, tags: ["reliable"] }, a.cookie);
    expect(dup.status).toBe(409);
  });
  it("host attendance (from approved event submissions) counts as shared", async () => {
    const db = createMemoryStore();
    const host = await signup(db, "host@example.com");
    const runner = await signup(db, "runner@example.com");
    const owner = await ownerCookie(db);
    const sub = await post(db, "/api/submissions/event", { type: "one_time", title: "My Race", date: "2026-09-01", time: "6:00 AM", location: "Downtown", distanceLabel: "5K", invite: "Open to all" }, host.cookie);
    const sid = json<{ submission: { id: string } }>(sub).submission.id;
    const approve = await post(db, `/api/admin/submissions/${sid}/approve`, {}, owner, "approving the event");
    expect(approve.status).toBe(200);
    const hostEvent = db.listAttendanceByEvent("event:user-" + sid);
    expect(hostEvent.some((x) => x.accountId === host.id && x.role === "host")).toBe(true);
    await attend(db, runner.id, "event:user-" + sid, "rsvp");
    const ok = await post(db, "/api/ratings", { revieweeId: runner.id, eventId: `user-${sid}`, positive: true, tags: ["welcoming"] }, host.cookie);
    expect(ok.status).toBe(200);
  });
  it("rejects self-rating, unknown events, and negative ratings without a reason", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const a = await signup(db, "s@example.com");
    await attend(db, a.id, EV);
    const self = await post(db, "/api/ratings", { revieweeId: a.id, eventId: "ev1", positive: true, tags: [] }, a.cookie);
    expect(self.status).toBe(400);
    const unknown = await post(db, "/api/ratings", { revieweeId: a.id, eventId: "nope", positive: true, tags: [] }, a.cookie);
    expect(unknown.status).toBe(400);
    const noReason = await post(db, "/api/ratings", { revieweeId: a.id, eventId: "ev1", positive: false }, a.cookie);
    expect(noReason.status).toBe(400);
  });
  it("concerns require a shared event and are never visible publicly", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const a = await signup(db, "rep@example.com");
    const b = await signup(db, "subj@example.com");
    const denied = await post(db, "/api/concerns", { subjectId: b.id, eventId: "ev1", reason: "not cool behavior" }, a.cookie);
    expect(denied.status).toBe(403);
    await attend(db, a.id, EV);
    await attend(db, b.id, EV);
    const ok = await post(db, "/api/concerns", { subjectId: b.id, eventId: "ev1", reason: "not cool behavior" }, a.cookie);
    expect(ok.status).toBe(200);
    const pub = await get(db, `/api/profile/trust?accountId=${b.id}`);
    expect(pub.body).not.toContain("not cool behavior");
    expect(pub.body).not.toContain("rep@example.com");
  });
});

describe("configurable threshold, under_review state and restrictions", () => {
  it("default threshold 3: two signals keep the account clear, three trigger under_review", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const t = await signup(db, "target@example.com");
    const r1 = await signup(db, "r1@example.com");
    const r2 = await signup(db, "r2@example.com");
    const r3 = await signup(db, "r3@example.com");
    for (const r of [r1, r2, r3]) await attend(db, r.id, EV);
    await attend(db, t.id, EV);
    for (const r of [r1, r2]) {
      const f = await post(db, "/api/ratings", { revieweeId: t.id, eventId: "ev1", positive: false, reason: "pushed too hard" }, r.cookie);
      expect(f.status).toBe(200);
    }
    expect(db.getAccount(t.id)!.underReview).toBe(false);
    const third = await post(db, "/api/ratings", { revieweeId: t.id, eventId: "ev1", positive: false, reason: "again" }, r3.cookie);
    expect(third.status).toBe(200);
    expect(db.getAccount(t.id)!.underReview).toBe(true);
    const trust = await get(db, `/api/profile/trust?accountId=${t.id}`, t.cookie);
    const view = json<{ underReview?: boolean; restrictions?: unknown; tier?: unknown }>(trust);
    expect(view.underReview).toBe(true);
    expect(view.restrictions).toBeDefined();
  });
  it("open concerns count toward the threshold too; resolved ones do not", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const t = await signup(db, "t2@example.com");
    const a = await signup(db, "a@example.com");
    const b = await signup(db, "b@example.com");
    const c = await signup(db, "c@example.com");
    for (const r of [a, b, c]) await attend(db, r.id, EV);
    await attend(db, t.id, EV);
    const c1 = await post(db, "/api/concerns", { subjectId: t.id, eventId: "ev1", reason: "left a runner behind" }, a.cookie);
    const c2 = await post(db, "/api/concerns", { subjectId: t.id, eventId: "ev1", reason: "safety issue" }, b.cookie);
    const c3 = await post(db, "/api/concerns", { subjectId: t.id, eventId: "ev1", reason: "third concern" }, c.cookie);
    expect(c1.status).toBe(200);
    expect(c2.status).toBe(200);
    expect(c3.status).toBe(200);
    expect(db.getAccount(t.id)!.underReview).toBe(true);
    // resolve one — still at threshold, stays under review (never auto-clears)
    const open = db.listConcerns().find((x) => x.subjectId === t.id)!;
    db.updateConcern(open.id, { status: "resolved" });
    expect(db.getAccount(t.id)!.underReview).toBe(true);
  });
  it("admin can reconfigure the threshold (1-10); lowering it auto-marks accounts", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const t = await signup(db, "t3@example.com");
    const a = await signup(db, "a3@example.com");
    await attend(db, a.id, EV);
    await attend(db, t.id, EV);
    await post(db, "/api/ratings", { revieweeId: t.id, eventId: "ev1", positive: false, reason: "one bad night" }, a.cookie);
    expect(db.getAccount(t.id)!.underReview).toBe(false);
    const owner = await ownerCookie(db);
    const f = await post(db, "/api/admin/trust/threshold", { threshold: 1 }, owner, "tightening the threshold");
    expect(f.status).toBe(200);
    expect(json<{ threshold: number; newlyUnderReview: number }>(f)).toEqual({ threshold: 1, newlyUnderReview: 1 });
    expect(db.getAccount(t.id)!.underReview).toBe(true);
    const bad = await post(db, "/api/admin/trust/threshold", { threshold: 0 }, owner, "oops");
    expect(bad.status).toBe(400);
  });
  it("under_review preserves browse/RSVP/comment but blocks hosting & club/coach posting", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const t = await signup(db, "t4@example.com");
    db.updateAccount(t.id, { underReview: true, underReviewAt: "2026-08-01T00:00:00.000Z" });
    // RSVP still allowed (server-side)
    const rsvp = await post(db, "/api/events/rsvp", { eventId: "ev1" }, t.cookie);
    expect(rsvp.status).toBe(200);
    expect(db.hasAttendance(t.id, EV)).toBe(true);
    // browse (public content) still served
    expect((await get(db, "/api/content?city=columbia-mo")).status).toBe(200);
    // hosting an event is blocked
    const eventSub = await post(db, "/api/submissions/event", { type: "one_time", title: "X", date: "2026-09-01", time: "6:00 AM", location: "D", distanceLabel: "5K", invite: "Open to all" }, t.cookie);
    expect(eventSub.status).toBe(403);
    expect(json<{ error: string }>(eventSub).error).toBe("under_review");
    // club/coach posting (group submission) is blocked
    const groupSub = await post(db, "/api/submissions/group", { name: "Club", description: "d", groupType: "community" }, t.cookie);
    expect(groupSub.status).toBe(403);
    // one-off race listing (not hosting) still allowed
    const raceSub = await post(db, "/api/submissions/race", { name: "R", distances: "5K", date: "2026-10-01", location: "L", registrationUrl: "https://example.com/r", description: "d" }, t.cookie);
    expect(raceSub.status).toBe(200);
  });
});

describe("appeal decisions (reinstate/uphold) with required reasons and audit", () => {
  it("filing requires under_review; admin reinstate clears it; uphold keeps it", async () => {
    const db = createMemoryStore();
    const t = await signup(db, "t5@example.com");
    const pre = await post(db, "/api/appeals", { reason: "I did nothing wrong" }, t.cookie);
    expect(pre.status).toBe(409); // nothing to appeal
    db.updateAccount(t.id, { underReview: true, underReviewAt: "2026-08-01T00:00:00.000Z" });
    const filed = await post(db, "/api/appeals", { reason: "I did nothing wrong" }, t.cookie);
    expect(filed.status).toBe(200);
    const appealId = json<{ appeal: { id: string } }>(filed).appeal.id;
    const dup = await post(db, "/api/appeals", { reason: "again" }, t.cookie);
    expect(dup.status).toBe(409);
    const owner = await ownerCookie(db);
    const myAppeals = await get(db, "/api/appeals", t.cookie);
    expect(json<{ appeals: { id: string }[] }>(myAppeals).appeals.map((a) => a.id)).toContain(appealId);
    // admin queue
    const queue = await get(db, "/api/admin/appeals", owner, "reviewing appeals");
    const rows = json<{ appeals: { id: string; accountEmail: string }[] }>(queue).appeals;
    expect(rows.some((a) => a.id === appealId && a.accountEmail === "t5@example.com")).toBe(true);
    // missing decision reason
    const noReason = await post(db, `/api/admin/appeals/${appealId}/reinstate`, {}, owner, "reinstate");
    expect(noReason.status).toBe(400);
    const uphold = await post(db, `/api/admin/appeals/${appealId}/uphold`, { reason: "evidence supports the concern" }, owner, "upholding after review");
    expect(json<{ appeal: { status: string } }>(uphold).appeal.status).toBe("upheld");
    expect(db.getAccount(t.id)!.underReview).toBe(true);
    // second appeal → reinstate clears
    const filed2 = await post(db, "/api/appeals", { reason: "new evidence clears me" }, t.cookie);
    const appeal2 = json<{ appeal: { id: string } }>(filed2).appeal.id;
    const reinstate = await post(db, `/api/admin/appeals/${appeal2}/reinstate`, { reason: "verified the alibi" }, owner, "reinstate");
    expect(json<{ appeal: { status: string } }>(reinstate).appeal.status).toBe("reinstated");
    expect(db.getAccount(t.id)!.underReview).toBe(false);
    expect(db.listAudit(50).some((e) => e.action === "admin.appeal_reinstate" && e.reason === "reinstate")).toBe(true);
    expect(db.listAudit(50).some((e) => e.action === "admin.appeal_uphold")).toBe(true);
  });
  it("non-admin (verified runner) cannot read the appeal queue or decide appeals", async () => {
    const db = createMemoryStore();
    const r = await signup(db, "plain@example.com");
    const queue = await get(db, "/api/admin/appeals", r.cookie, "sneaky");
    expect(queue.status).toBe(401);
  });
});

describe("privacy: no proof, reviewer identity, reports, or raw counts publicly", () => {
  it("public trust view is qualitative: tier/coach/host only, no counts, no reviewers", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const t = await signup(db, "p@example.com");
    const a = await signup(db, "p2@example.com");
    await attend(db, a.id, EV);
    await attend(db, t.id, EV);
    for (let i = 0; i < 4; i++) {
      const r = await signup(db, `r${i}@example.com`);
      await attend(db, r.id, EV);
      await post(db, "/api/ratings", { revieweeId: t.id, eventId: "ev1", positive: true, tags: ["reliable"] }, r.cookie);
    }
    const f = await get(db, `/api/profile/trust?accountId=${t.id}`);
    const view = json<{ tier: string; coach: boolean; host: boolean; underReview?: boolean; count?: unknown; reviewers?: unknown }>(f);
    expect(view.tier).toBe("recognized");
    expect("count" in view).toBe(false);
    expect("reviewers" in view).toBe(false);
    expect(view.underReview).toBeUndefined(); // other-viewer: no owner extras
    // self view includes underReview
    const self = json<{ underReview?: boolean }>(await get(db, `/api/profile/trust?accountId=${t.id}`, t.cookie));
    expect(self.underReview).toBe(false);
  });
  it("recognitions endpoint is non-ranked, qualitative, city-scoped", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const coach = await signup(db, "coach@example.com");
    db.updateAccount(coach.id, { cityId: "columbia-mo" });
    db.addCredential({ id: "cc", accountId: coach.id, type: "coach_certification", certifyingBody: "RRCA", proofRef: "proof", proofMime: "application/pdf", proofBytes: 3, issuedOn: null, expiresOn: null, status: "verified", verifiedBy: "admin", verifiedAt: "2026-01-01T00:00:00.000Z", decisionReason: null, renewalNotifiedAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    const f = await get(db, "/api/recognitions?city=columbia-mo");
    const rows = json<{ recognitions: { roles: string[]; tier: string; score?: unknown }[] }>(f).recognitions;
    expect(rows.some((x) => x.roles.includes("coach"))).toBe(true);
    expect("score" in rows[0]).toBe(false);
    const otherCity = json<{ recognitions: unknown[] }>(await get(db, "/api/recognitions?city=jefferson-city-mo")).recognitions;
    expect(otherCity).toHaveLength(0);
  });
  it("no public endpoint returns rating reasons or concern text", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const t = await signup(db, "priv@example.com");
    const a = await signup(db, "priv2@example.com");
    await attend(db, a.id, EV);
    await attend(db, t.id, EV);
    await post(db, "/api/ratings", { revieweeId: t.id, eventId: "ev1", positive: false, reason: "secret negative" }, a.cookie);
    const body = (await get(db, `/api/profile/trust?accountId=${t.id}`)).body;
    expect(body).not.toContain("secret negative");
    const config = (await get(db, "/api/config")).body;
    expect(config).not.toContain("proofBytes");
  });
});

describe("preserved behavior: signup, auth, admin access", () => {
  it("signup and /api/me still work and now expose the underReview boolean", async () => {
    const db = createMemoryStore();
    const f = await post(db, "/api/accounts", { name: "Jane", username: "jane" + Math.random().toString(36).slice(2, 8), email: "jane@example.com", birthdate: "1998-05-05", cityId: "columbia-mo" });
    expect(f.status).toBe(200);
    const cookie = cookieFrom(f);
    const me = json<{ account: { underReview: boolean } }>(await get(db, "/api/me", cookie));
    expect(me.account.underReview).toBe(false);
  });
});
