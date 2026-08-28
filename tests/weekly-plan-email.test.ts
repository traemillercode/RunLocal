/**
 * Weekly plan email - the scheduling/idempotency logic (pure, no real
 * email dependency) plus the HTTP endpoints. Since RESEND_API_KEY isn't
 * configured in this test environment, sendEmail always returns ok:false -
 * which is exactly what's needed to verify the fix for a real bug found
 * while building this: a failed send must NEVER be recorded as sent, or
 * the idempotency check would permanently block any future retry.
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
  const a = db.createAccount({ name: "Test Runner", email, cityId });
  db.updateAccount(a.id, { status: "verified" });
  const s = db.createSession(a.id, "127.0.0.1");
  return { id: a.id, cookie: `${SESSION_COOKIE}=${s.id}` };
}

describe("weekStartDateFor", () => {
  it("finds the correct Sunday-start week for a mid-week date", () => {
    const db = createMemoryStore();
    expect(db.weekStartDateFor("2026-08-05", 0)).toBe("2026-08-02");
    expect(db.weekStartDateFor("2026-08-05", 1)).toBe("2026-08-03");
  });

  it("a date that IS the week-start day returns itself", () => {
    const db = createMemoryStore();
    expect(db.weekStartDateFor("2026-08-02", 0)).toBe("2026-08-02");
    expect(db.weekStartDateFor("2026-08-03", 1)).toBe("2026-08-03");
  });
});

describe("listAccountsDueForWeeklyPlanEmail", () => {
  it("only includes accounts whose own week-start day is today, and who have a plan", () => {
    const db = createMemoryStore();
    const sundayPerson = account(db, "sunday@example.com");
    const mondayPerson = account(db, "monday@example.com");
    db.updateAccount(mondayPerson.id, { weekStartDay: 1 });

    const now = new Date();
    for (const u of [sundayPerson, mondayPerson]) {
      db.setTrainingPlan({ accountId: u.id, planType: "marathon", customLabel: null, totalWeeks: 8, startDate: "2026-08-03", linkedRaceId: null, customRaceName: null, createdAt: now.toISOString(), updatedAt: now.toISOString() });
    }

    const sunday = new Date("2026-08-02T12:00:00Z");
    const dueSunday = db.listAccountsDueForWeeklyPlanEmail(sunday);
    expect(dueSunday.map((d) => d.accountId)).toEqual([sundayPerson.id]);

    const monday = new Date("2026-08-03T12:00:00Z");
    const dueMonday = db.listAccountsDueForWeeklyPlanEmail(monday);
    expect(dueMonday.map((d) => d.accountId)).toEqual([mondayPerson.id]);
  });

  it("skips an account that already has a weekly email recorded for that week - idempotent", () => {
    const db = createMemoryStore();
    const u = account(db, "already@example.com");
    const now = new Date();
    db.setTrainingPlan({ accountId: u.id, planType: "5k", customLabel: null, totalWeeks: 8, startDate: "2026-08-03", linkedRaceId: null, customRaceName: null, createdAt: now.toISOString(), updatedAt: now.toISOString() });
    const sunday = new Date("2026-08-02T12:00:00Z");
    expect(db.listAccountsDueForWeeklyPlanEmail(sunday)).toHaveLength(1);

    db.recordWeeklyPlanEmail({ id: `${u.id}-weekemail-2026-08-02`, accountId: u.id, weekStartDate: "2026-08-02", notes: "", sentAt: sunday.toISOString(), sentBy: "self", coachId: null });
    expect(db.listAccountsDueForWeeklyPlanEmail(sunday)).toHaveLength(0);
  });
});

describe("Weekly plan email HTTP endpoints", () => {
  it("without RESEND_API_KEY configured, the endpoint honestly reports failure and does NOT record a false-positive send", async () => {
    const db = createMemoryStore();
    const u = account(db, "sendtest@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    const r = await call(db, "POST", "/api/profile/training-plan/weekly-email", u.cookie, { weekStartDate: "2026-08-03", notes: "Great week ahead" });
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("email_failed");
    expect(db.getWeeklyPlanEmail(u.id, "2026-08-03")).toBeUndefined();
  });

  it("rejects a malformed or missing week start date", async () => {
    const db = createMemoryStore();
    const u = account(db, "baddate@example.com");
    const r = await call(db, "POST", "/api/profile/training-plan/weekly-email", u.cookie, { weekStartDate: "not-a-date" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_date");
  });

  it("a coach without an active relationship cannot send a weekly email to an athlete", async () => {
    const db = createMemoryStore();
    const coach = account(db, "coach@example.com");
    const athlete = account(db, "athlete@example.com");
    const r = await call(db, "POST", `/api/coach/athletes/${athlete.id}/weekly-email`, coach.cookie, { weekStartDate: "2026-08-03" });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("not_their_coach");
  });
});
