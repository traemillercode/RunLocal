/**
 * Weekly training plan content - the part that was missing from the plan
 * record itself before now (type/length/dates only, never actual weekly
 * targets). Covers bounds validation against the plan's own totalWeeks,
 * the no-plan-yet case, and that content actually persists per week.
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
  db.updateAccount(a.id, { status: "verified", avatarStyle: "coral" });
  const s = db.createSession(a.id, "127.0.0.1");
  return { id: a.id, cookie: `${SESSION_COOKIE}=${s.id}` };
}

describe("Weekly training plan content", () => {
  it("returns an empty list when no weeks have been filled in yet, without erroring", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner@example.com");
    const r = await call(db, "GET", "/api/profile/training-plan/weeks", u.cookie);
    expect(r.status).toBe(200);
    expect(r.body.weeks).toEqual([]);
  });

  it("refuses to set a week's content before a plan exists", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner2@example.com");
    const r = await call(db, "PUT", "/api/profile/training-plan/weeks/1", u.cookie, { targetMiles: 30 });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("no_plan");
  });

  it("sets and persists real weekly content once a plan exists", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner3@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 16, startDate: "2026-08-01" });
    const set = await call(db, "PUT", "/api/profile/training-plan/weeks/3", u.cookie, { targetMiles: 35, longRunMiles: 12, notes: "Tempo Tuesday, long run Saturday" });
    expect(set.status).toBe(200);
    expect(set.body.week.weekNumber).toBe(3);
    expect(set.body.week.targetMiles).toBe(35);
    expect(set.body.week.longRunMiles).toBe(12);
    expect(set.body.week.notes).toBe("Tempo Tuesday, long run Saturday");

    const list = await call(db, "GET", "/api/profile/training-plan/weeks", u.cookie);
    expect(list.body.weeks).toHaveLength(1);
    expect(list.body.weeks[0].weekNumber).toBe(3);
    expect(db.getTrainingPlanWeek(u.id, 3)!.targetMiles).toBe(35);
  });

  it("rejects a week number outside the plan's own totalWeeks", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner4@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "5k", totalWeeks: 8, startDate: "2026-08-01" });
    const tooHigh = await call(db, "PUT", "/api/profile/training-plan/weeks/9", u.cookie, { targetMiles: 20 });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error).toBe("invalid_week");
    const zero = await call(db, "PUT", "/api/profile/training-plan/weeks/0", u.cookie, { targetMiles: 20 });
    expect(zero.status).toBe(400);
  });

  it("deleting the whole plan clears its weekly content too, not just the plan record", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner5@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 16, startDate: "2026-08-01" });
    await call(db, "PUT", "/api/profile/training-plan/weeks/1", u.cookie, { targetMiles: 25 });
    expect(db.listTrainingPlanWeeks(u.id)).toHaveLength(1);

    await call(db, "DELETE", "/api/profile/training-plan", u.cookie);
    expect(db.listTrainingPlanWeeks(u.id)).toHaveLength(0);
  });

  it("one account's weekly content is never visible to another account", async () => {
    const db = createMemoryStore();
    const a = account(db, "a@example.com");
    const b = account(db, "b@example.com");
    await call(db, "PUT", "/api/profile/training-plan", a.cookie, { planType: "marathon", totalWeeks: 16, startDate: "2026-08-01" });
    await call(db, "PUT", "/api/profile/training-plan/weeks/1", a.cookie, { targetMiles: 40 });
    await call(db, "PUT", "/api/profile/training-plan", b.cookie, { planType: "5k", totalWeeks: 8, startDate: "2026-08-01" });
    const bWeeks = await call(db, "GET", "/api/profile/training-plan/weeks", b.cookie);
    expect(bWeeks.body.weeks).toEqual([]);
  });
});
