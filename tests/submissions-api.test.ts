/**
 * HTTP-level tests for the submission API contract:
 *  - session-gated submission endpoints (race / group / event);
 *  - "my submissions" returns ONLY the caller's records with statuses and
 *    the rejection reason (never another user's);
 *  - admin queue requires an admin session + reason and returns safe
 *    summaries (no emails);
 *  - reject requires the reason (both header and stored rejection reason);
 *  - public /api/content exposes ONLY approved content.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { ADMIN_KEY_VAR, ADMIN_EMAIL_VAR } from "../src/server/admin";

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
      return {
        next: async () => (i < chunks.length ? { done: false as const, value: chunks[i++] } : { done: true as const, value: undefined }),
      };
    },
  };
  return req as unknown as IncomingMessage;
}
interface FakeRes {
  status: number;
  body: string;
  setCookieHeader: string | undefined;
}
function makeRes(): { res: ServerResponse; fake: FakeRes } {
  const fake: FakeRes = { status: 200, body: "", setCookieHeader: undefined };
  const res = {
    writeHead(status: number, headers?: Record<string, string | string[]>) {
      fake.status = status;
      if (headers) {
        const sc = headers["set-cookie"];
        if (Array.isArray(sc)) fake.setCookieHeader = sc[0];
        else if (typeof sc === "string") fake.setCookieHeader = sc;
      }
      return res;
    },
    setHeader(name: string, value: string | string[]) {
      if (name.toLowerCase() === "set-cookie") fake.setCookieHeader = Array.isArray(value) ? value[0] : value;
      return res;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) fake.body += String(chunk);
      return res;
    },
  } as unknown as ServerResponse;
  return { res, fake };
}

const RACE_BODY = { name: "River 5K", distances: "5K", date: "2026-10-01", location: "Flat Branch", registrationUrl: "https://example.com/r", description: "A 5K." };

function verifiedUser(db: Db, email = "runner@example.com") {
  const rec = db.createAccount({ name: "Runner", email, cityId: "columbia-mo" });
  db.updateAccount(rec.id, { status: "verified", phase: "pending_review", selfieRef: `${rec.id}_selfie.jpg` });
  const session = db.createSession(rec.id, "198.51.100.23");
  return { rec, cookie: `runlocal_sid=${session.id}` };
}

beforeEach(() => {
  process.env[ADMIN_KEY_VAR] = "test-admin-key-123";
  process.env[ADMIN_EMAIL_VAR] = "safety@runlocal.app";
});
afterEach(() => {
  delete process.env[ADMIN_KEY_VAR];
  delete process.env[ADMIN_EMAIL_VAR];
});

describe("POST /api/submissions/* — session + permission gating", () => {
  it("rejects guests with 401 sign_in_required", async () => {
    const db = createMemoryStore();
    const { res, fake } = makeRes();
    await apiHandler(makeReq("POST", "/api/submissions/race", { body: RACE_BODY }), res, db);
    expect(fake.status).toBe(401);
    expect(JSON.parse(fake.body).error).toBe("sign_in_required");
  });

  it("rejects pending accounts with 403 verification_required", async () => {
    const db = createMemoryStore();
    const pending = db.createAccount({ name: "P", email: "p@example.com", cityId: "columbia-mo" });
    const session = db.createSession(pending.id, "198.51.100.23");
    const { res, fake } = makeRes();
    await apiHandler(makeReq("POST", "/api/submissions/race", { body: RACE_BODY, cookie: `runlocal_sid=${session.id}` }), res, db);
    expect(fake.status).toBe(403);
    expect(JSON.parse(fake.body).error).toBe("verification_required");
  });

  it("verified runner submits a race → pending", async () => {
    const db = createMemoryStore();
    const { cookie } = verifiedUser(db);
    const { res, fake } = makeRes();
    await apiHandler(makeReq("POST", "/api/submissions/race", { body: RACE_BODY, cookie }), res, db);
    expect(fake.status).toBe(200);
    const payload = JSON.parse(fake.body) as { submission: { id: string; status: string } };
    expect(payload.submission.status).toBe("pending");
    expect(db.listSubmissions()).toHaveLength(1);
  });

  it("group leaders are blocked from the independent-event endpoint (403)", async () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "GL", email: "gl@example.com", cityId: "columbia-mo" });
    db.updateAccount(rec.id, { status: "verified", role: "group_leader", phase: "pending_review", selfieRef: "x.jpg" });
    const session = db.createSession(rec.id, "198.51.100.23");
    const { res, fake } = makeRes();
    await apiHandler(
      makeReq("POST", "/api/submissions/event", {
        body: { type: "recurring", title: "T", dayOfWeek: 2, time: "6:00 PM", location: "Park", distanceLabel: "3 mi", invite: "Open to all" },
        cookie: `runlocal_sid=${session.id}`,
      }),
      res,
      db,
    );
    expect(fake.status).toBe(403);
    expect(JSON.parse(fake.body).error).toBe("group_leader_independent");
  });
});

describe("group photo uploads persist into pending group submissions", () => {
  it("accepts both uploaded photo refs and keeps the group pending", async () => {
    const db = createMemoryStore();
    const { cookie } = verifiedUser(db, "group@example.com");
    const photo = "data:image/png;base64,iVBORw0KGgo=";
    const refs: string[] = [];
    for (const body of [{ photo }, { photo }]) {
      const { res, fake } = makeRes();
      await apiHandler(makeReq("POST", "/api/group/photo", { body, cookie }), res, db);
      expect(fake.status).toBe(200);
      refs.push((JSON.parse(fake.body) as { photoRef: string }).photoRef);
    }
    const { res, fake } = makeRes();
    await apiHandler(makeReq("POST", "/api/submissions/group", {
      cookie,
      body: { cityId: "columbia-mo", name: "River Runners", description: "A local group.", groupType: "community", coverPhoto: refs[0], logoPhoto: refs[1], membershipMode: "request" },
    }), res, db);
    expect(fake.status).toBe(200);
    expect(JSON.parse(fake.body)).toMatchObject({ submission: { status: "pending" } });
    expect(db.listSubmissions()).toHaveLength(1);
    expect(db.listSubmissions()[0].status).toBe("pending");
  });
});

describe("GET /api/my/submissions", () => {
  it("returns only the caller's records; rejection reason appears only to the submitter", async () => {
    const db = createMemoryStore();
    const a = verifiedUser(db, "a@example.com");
    const b = verifiedUser(db, "b@example.com");
    const { res: res1, fake: fake1 } = makeRes();
    await apiHandler(makeReq("POST", "/api/submissions/race", { body: RACE_BODY, cookie: a.cookie }), res1, db);
    const id = (JSON.parse(fake1.body) as { submission: { id: string } }).submission.id;
    // admin rejects it
    const adminSession = db.createSession("__admin__", "198.51.100.23");
    const { res: res2, fake: fake2 } = makeRes();
    await apiHandler(
      makeReq("POST", `/api/admin/submissions/${id}/reject`, { cookie: `runlocal_admin=${adminSession.id}`, reason: "duplicate listing" }),
      res2,
      db,
    );
    expect(fake2.status).toBe(200);
    // A's view: rejected + reason
    const { res: resA, fake: fakeA } = makeRes();
    await apiHandler(makeReq("GET", "/api/my/submissions", { cookie: a.cookie }), resA, db);
    expect(fakeA.status).toBe(200);
    const mine = (JSON.parse(fakeA.body) as { submissions: { status: string; rejectionReason: string | null }[] }).submissions;
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe("rejected");
    expect(mine[0].rejectionReason).toBe("duplicate listing");
    // B's view: empty — never sees A's record or rejection reason
    const { res: resB, fake: fakeB } = makeRes();
    await apiHandler(makeReq("GET", "/api/my/submissions", { cookie: b.cookie }), resB, db);
    expect((JSON.parse(fakeB.body) as { submissions: unknown[] }).submissions).toHaveLength(0);
  });
});

describe("admin submission queue + decisions over HTTP", () => {
  it("queue requires an admin session and a reason", async () => {
    const db = createMemoryStore();
    const { cookie } = verifiedUser(db);
    await apiHandler(makeReq("POST", "/api/submissions/race", { body: RACE_BODY, cookie }), makeRes().res, db);
    // no admin session
    const { res, fake } = makeRes();
    await apiHandler(makeReq("GET", "/api/admin/submissions", { reason: "review" }), res, db);
    expect(fake.status).toBe(401);
    // admin session but no reason
    const adminSession = db.createSession("__admin__", "198.51.100.23");
    const { res: res2, fake: fake2 } = makeRes();
    await apiHandler(makeReq("GET", "/api/admin/submissions", { cookie: `runlocal_admin=${adminSession.id}` }), res2, db);
    expect(fake2.status).toBe(400);
    expect(JSON.parse(fake2.body).error).toBe("reason_required");
    // with reason → safe summaries
    const { res: res3, fake: fake3 } = makeRes();
    await apiHandler(makeReq("GET", "/api/admin/submissions", { cookie: `runlocal_admin=${adminSession.id}`, reason: "queue review" }), res3, db);
    expect(fake3.status).toBe(200);
    const rows = (JSON.parse(fake3.body) as { results: { title: string; submitterName: string }[] }).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "River 5K", submitterName: "Runner" });
    expect(fake3.body).not.toContain("example.com");
  });

  it("reject without a reason header is rejected", async () => {
    const db = createMemoryStore();
    const { cookie } = verifiedUser(db);
    const { res: res0, fake: fake0 } = makeRes();
    await apiHandler(makeReq("POST", "/api/submissions/race", { body: RACE_BODY, cookie }), res0, db);
    const id = (JSON.parse(fake0.body) as { submission: { id: string } }).submission.id;
    const adminSession = db.createSession("__admin__", "198.51.100.23");
    const { res, fake } = makeRes();
    await apiHandler(makeReq("POST", `/api/admin/submissions/${id}/reject`, { cookie: `runlocal_admin=${adminSession.id}` }), res, db);
    expect(fake.status).toBe(400);
    expect(JSON.parse(fake.body).error).toBe("reason_required");
  });
});

describe("GET /api/content — public approved content", () => {
  it("shows only approved submissions and hides pending/rejected", async () => {
    const db = createMemoryStore();
    const { cookie } = verifiedUser(db);
    const { res: res0, fake: fake0 } = makeRes();
    await apiHandler(makeReq("POST", "/api/submissions/race", { body: RACE_BODY, cookie }), res0, db);
    const id = (JSON.parse(fake0.body) as { submission: { id: string } }).submission.id;
    // public before approval: empty
    const { res: resPub, fake: fakePub } = makeRes();
    await apiHandler(makeReq("GET", "/api/content?city=columbia-mo"), resPub, db);
    expect((JSON.parse(fakePub.body) as { races: unknown[] }).races).toHaveLength(0);
    // approve
    const adminSession = db.createSession("__admin__", "198.51.100.23");
    const { res: resA, fake: fakeA } = makeRes();
    await apiHandler(makeReq("POST", `/api/admin/submissions/${id}/approve`, { cookie: `runlocal_admin=${adminSession.id}`, reason: "approving" }), resA, db);
    expect(fakeA.status).toBe(200);
    const { res: resPub2, fake: fakePub2 } = makeRes();
    await apiHandler(makeReq("GET", "/api/content?city=columbia-mo"), resPub2, db);
    const pub = JSON.parse(fakePub2.body) as { races: { name: string; organizer: string }[] };
    expect(pub.races).toHaveLength(1);
    expect(pub.races[0]).toMatchObject({ name: "River 5K", organizer: "Runner" });
    // invalid city is rejected
    const { res: resBad, fake: fakeBad } = makeRes();
    await apiHandler(makeReq("GET", "/api/content?city=nope"), resBad, db);
    expect(fakeBad.status).toBe(400);
  });
});
