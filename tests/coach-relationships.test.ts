/**
 * Coach-athlete relationships - consent-based (either side proposes, the
 * other must accept), scoped per-person rather than a global role. Every
 * safety property gets a real test: only an ACTIVE relationship grants
 * plan access, the requester can never accept their own request, a
 * duplicate request doesn't create a second pending row, and both
 * request directions (coach-initiated, athlete-initiated) work.
 */
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { SESSION_COOKIE } from "../src/server/api";

function req(method: string, path: string, cookie?: string, body?: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  let sent = false;
  const headers: Record<string, string> = { "x-forwarded-proto": "https", ...(raw ? { "content-type": "application/json" } : {}) };
  if (cookie) headers.cookie = cookie;
  return { method, url: path, headers, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]() { return { next: async () => sent ? { done: true as const, value: undefined } : (sent = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
function response() {
  const out = { status: 0, body: "" };
  const res = { writeHead(status: number) { out.status = status; return res; }, setHeader() { return res; }, end(value?: unknown) { if (value !== undefined) out.body += String(value); return res; } } as unknown as ServerResponse;
  return { res, out };
}
async function call(db: Db, method: string, path: string, cookie?: string, body?: unknown) {
  const { res, out } = response();
  await apiHandler(req(method, path, cookie, body), res, db);
  return { status: out.status, body: out.body ? (JSON.parse(out.body) as Record<string, any>) : {} };
}
function account(db: Db, email: string, cityId = "columbia-mo"): { id: string; cookie: string } {
  const a = db.createAccount({ name: email, email, cityId });
  db.updateAccount(a.id, { status: "verified" });
  const s = db.createSession(a.id, "127.0.0.1");
  return { id: a.id, cookie: `${SESSION_COOKIE}=${s.id}` };
}

describe("Coach-athlete relationships", () => {
  it("coach-initiated request, athlete accepts, coach gains plan access", async () => {
    const db = createMemoryStore();
    const coach = account(db, "coach@example.com");
    const athlete = account(db, "athlete@example.com");
    await call(db, "PUT", "/api/profile/training-plan", athlete.cookie, { planType: "marathon", totalWeeks: 16, startDate: "2026-08-01" });

    const request = await call(db, "POST", `/api/coach/${athlete.id}/request`, coach.cookie, { asCoach: true });
    expect(request.status).toBe(200);
    expect(request.body.relationship.status).toBe("pending");
    const relId = request.body.relationship.id;

    const before = await call(db, "GET", `/api/coach/athletes/${athlete.id}/training-plan`, coach.cookie);
    expect(before.status).toBe(403);
    expect(before.body.error).toBe("not_their_coach");

    const accepted = await call(db, "POST", `/api/coach/${relId}/accept`, athlete.cookie);
    expect(accepted.status).toBe(200);
    expect(accepted.body.relationship.status).toBe("active");

    const after = await call(db, "GET", `/api/coach/athletes/${athlete.id}/training-plan`, coach.cookie);
    expect(after.status).toBe(200);
    expect(after.body.plan.totalWeeks).toBe(16);
  });

  it("athlete-initiated request works the same way (asCoach: false)", async () => {
    const db = createMemoryStore();
    const athlete = account(db, "athlete2@example.com");
    const coach = account(db, "coach2@example.com");
    const request = await call(db, "POST", `/api/coach/${coach.id}/request`, athlete.cookie, { asCoach: false });
    expect(request.status).toBe(200);
    expect(request.body.relationship.coachId).toBe(coach.id);
    expect(request.body.relationship.athleteId).toBe(athlete.id);
    expect(request.body.relationship.requestedBy).toBe("athlete");
  });

  it("the requester can never accept or decline their own request", async () => {
    const db = createMemoryStore();
    const coach = account(db, "coach3@example.com");
    const athlete = account(db, "athlete3@example.com");
    const request = await call(db, "POST", `/api/coach/${athlete.id}/request`, coach.cookie, { asCoach: true });
    const relId = request.body.relationship.id;

    const selfAccept = await call(db, "POST", `/api/coach/${relId}/accept`, coach.cookie);
    expect(selfAccept.status).toBe(403);
    expect(selfAccept.body.error).toBe("cannot_respond_to_own_request");
    expect(db.getCoachRelationship(relId)!.status).toBe("pending");
  });

  it("a random third party cannot accept someone else's request", async () => {
    const db = createMemoryStore();
    const coach = account(db, "coach4@example.com");
    const athlete = account(db, "athlete4@example.com");
    const outsider = account(db, "outsider@example.com");
    const request = await call(db, "POST", `/api/coach/${athlete.id}/request`, coach.cookie, { asCoach: true });
    const relId = request.body.relationship.id;
    const r = await call(db, "POST", `/api/coach/${relId}/accept`, outsider.cookie);
    expect(r.status).toBe(404);
    expect(db.getCoachRelationship(relId)!.status).toBe("pending");
  });

  it("declining leaves the relationship inactive - no plan access granted", async () => {
    const db = createMemoryStore();
    const coach = account(db, "coach5@example.com");
    const athlete = account(db, "athlete5@example.com");
    const request = await call(db, "POST", `/api/coach/${athlete.id}/request`, coach.cookie, { asCoach: true });
    const relId = request.body.relationship.id;
    const declined = await call(db, "POST", `/api/coach/${relId}/decline`, athlete.cookie);
    expect(declined.status).toBe(200);
    expect(declined.body.relationship.status).toBe("declined");
    const access = await call(db, "GET", `/api/coach/athletes/${athlete.id}/training-plan`, coach.cookie);
    expect(access.status).toBe(403);
  });

  it("a duplicate pending request returns the existing one, never creates a second row", async () => {
    const db = createMemoryStore();
    const coach = account(db, "coach6@example.com");
    const athlete = account(db, "athlete6@example.com");
    const first = await call(db, "POST", `/api/coach/${athlete.id}/request`, coach.cookie, { asCoach: true });
    const second = await call(db, "POST", `/api/coach/${athlete.id}/request`, coach.cookie, { asCoach: true });
    expect(second.body.relationship.id).toBe(first.body.relationship.id);
    expect(db.listCoachRelationshipsFor(coach.id)).toHaveLength(1);
  });

  it("an active coach can write weekly content for their athlete, gated the same way as read access", async () => {
    const db = createMemoryStore();
    const coach = account(db, "coach7@example.com");
    const athlete = account(db, "athlete7@example.com");
    await call(db, "PUT", "/api/profile/training-plan", athlete.cookie, { planType: "marathon", totalWeeks: 16, startDate: "2026-08-01" });
    const request = await call(db, "POST", `/api/coach/${athlete.id}/request`, coach.cookie, { asCoach: true });

    const beforeWrite = await call(db, "PUT", `/api/coach/athletes/${athlete.id}/training-plan/weeks/1`, coach.cookie, { targetMiles: 30 });
    expect(beforeWrite.status).toBe(403);

    await call(db, "POST", `/api/coach/${request.body.relationship.id}/accept`, athlete.cookie);
    const afterWrite = await call(db, "PUT", `/api/coach/athletes/${athlete.id}/training-plan/weeks/1`, coach.cookie, { targetMiles: 30, longRunMiles: 10, notes: "Coach-assigned long run" });
    expect(afterWrite.status).toBe(200);
    expect(afterWrite.body.week.targetMiles).toBe(30);
    const athleteView = await call(db, "GET", "/api/profile/training-plan/weeks", athlete.cookie);
    expect(athleteView.body.weeks[0].notes).toBe("Coach-assigned long run");
  });

  it("cannot coach yourself", async () => {
    const db = createMemoryStore();
    const u = account(db, "solo@example.com");
    const r = await call(db, "POST", `/api/coach/${u.id}/request`, u.cookie, { asCoach: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("cannot_coach_self");
  });
});
