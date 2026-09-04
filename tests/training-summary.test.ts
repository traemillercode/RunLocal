/**
 * The day/week/month training summary - the actual "end of week update"
 * asked for: what's planned, what was actually logged, and critically
 * which logged activities were linked to the plan vs solo/extra runs that
 * weren't. Also covers completedRunId, which existed as a field description
 * ("set once a real run is linked") but nothing ever actually set it before
 * now - a real gap, same pattern as the others found this session.
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
  db.updateAccount(a.id, { status: "verified", avatarStyle: "coral" });
  const s = db.createSession(a.id, "127.0.0.1");
  return { id: a.id, cookie: `${SESSION_COOKIE}=${s.id}` };
}

describe("completedRunId real linking", () => {
  it("links a plan day to a real activity belonging to the account", async () => {
    const db = createMemoryStore();
    const u = account(db, "linker@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    const activity = db.addActivity({ id: "act-1", accountId: u.id, provider: "strava", type: "run", distanceMeters: 8046, durationSeconds: 3000, completedAt: "2026-08-03T08:00:00.000Z", shareMode: "connections" } as any);
    const day = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", completedRunId: activity.id });
    expect(day.body.day.completedRunId).toBe(activity.id);
  });

  it("cannot link to another account's activity", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const intruder = account(db, "intruder@example.com");
    await call(db, "PUT", "/api/profile/training-plan", intruder.cookie, { planType: "5k", totalWeeks: 4, startDate: "2026-08-03" });
    const activity = db.addActivity({ id: "act-2", accountId: owner.id, provider: "strava", type: "run", distanceMeters: 5000, durationSeconds: 1800, completedAt: "2026-08-03T08:00:00.000Z", shareMode: "connections" } as any);
    const day = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", intruder.cookie, { workoutType: "run", completedRunId: activity.id });
    expect(day.body.day.completedRunId).toBeNull();
  });
});

describe("Training summary (day/week/month view)", () => {
  it("correctly separates linked activities from unlinked solo runs, and totals real miles", async () => {
    const db = createMemoryStore();
    const u = account(db, "summary@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });

    const linked = db.addActivity({ id: "act-linked", accountId: u.id, provider: "strava", type: "run", distanceMeters: 8046.72, durationSeconds: 3000, completedAt: "2026-08-03T08:00:00.000Z", shareMode: "connections" } as any);
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", distanceValue: 5, distanceUnit: "miles", completionStatus: "done", completedRunId: linked.id });

    db.addActivity({ id: "act-solo", accountId: u.id, provider: "strava", type: "run", distanceMeters: 3218.69, durationSeconds: 1200, completedAt: "2026-08-04T08:00:00.000Z", shareMode: "connections" } as any);

    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-05", u.cookie, { workoutType: "run", distanceValue: 6, distanceUnit: "miles", completionStatus: "missed", missedReason: "weather" });

    const summary = await call(db, "GET", "/api/profile/training-plan/summary?start=2026-08-03&end=2026-08-09", u.cookie);
    expect(summary.status).toBe(200);
    expect(summary.body.linkedActivities.map((a: any) => a.id)).toEqual(["act-linked"]);
    expect(summary.body.unlinkedActivities.map((a: any) => a.id)).toEqual(["act-solo"]);
    expect(summary.body.totals.daysDone).toBe(1);
    expect(summary.body.totals.daysMissed).toBe(1);
    expect(summary.body.totals.plannedMiles).toBeCloseTo(11, 1);
    expect(summary.body.totals.loggedMiles).toBeCloseTo(7, 1);
  });

  it("respects the date range - a day/week/month view is just a different range on the same endpoint", async () => {
    const db = createMemoryStore();
    const u = account(db, "rangetest@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", distanceValue: 5, distanceUnit: "miles" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-20", u.cookie, { workoutType: "run", distanceValue: 8, distanceUnit: "miles" });

    const dayView = await call(db, "GET", "/api/profile/training-plan/summary?start=2026-08-03&end=2026-08-03", u.cookie);
    expect(dayView.body.planDays).toHaveLength(1);

    const monthView = await call(db, "GET", "/api/profile/training-plan/summary?start=2026-08-01&end=2026-08-31", u.cookie);
    expect(monthView.body.planDays).toHaveLength(2);
  });

  it("one account's summary never includes another account's activities or plan days", async () => {
    const db = createMemoryStore();
    const a = account(db, "a@example.com");
    const b = account(db, "b@example.com");
    await call(db, "PUT", "/api/profile/training-plan", a.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", a.cookie, { workoutType: "run", distanceValue: 5, distanceUnit: "miles" });
    db.addActivity({ id: "act-a", accountId: a.id, provider: "strava", type: "run", distanceMeters: 5000, durationSeconds: 1800, completedAt: "2026-08-03T08:00:00.000Z", shareMode: "connections" } as any);

    const bSummary = await call(db, "GET", "/api/profile/training-plan/summary?start=2026-08-01&end=2026-08-31", b.cookie);
    expect(bSummary.body.planDays).toHaveLength(0);
    expect(bSummary.body.unlinkedActivities).toHaveLength(0);
  });
});
