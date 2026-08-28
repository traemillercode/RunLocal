/**
 * Day-level training plan content - the real foundation the calendar view,
 * PDF export, and "what do I do today" widgets all need. Covers the
 * date-range validation (a date must fall within the plan's actual span,
 * unlike currentTrainingWeek which clamps), that coach write access is
 * gated the same way as weeks, and that a plan delete cleans up days too.
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

describe("Day-level training plan content", () => {
  it("sets real daily content - workout type, shoe from the library, fuel, hydration, notes", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    const shoe = db.addShoe({ id: "shoe-1", accountId: u.id, name: "Trail shoes", isDefault: true, totalMiles: 0, createdAt: new Date().toISOString() });
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-08", u.cookie, {
      workoutType: "run", title: "Long run", distanceValue: 12, distanceUnit: "miles", shoeId: shoe.id, fuelNotes: "1 gel at mile 6", hydrationNotes: "Handheld bottle", notes: "Hilly route",
    });
    expect(r.status).toBe(200);
    expect(r.body.day.weekNumber).toBe(1);
    expect(r.body.day.workoutType).toBe("run");
    expect(r.body.day.shoeId).toBe(shoe.id);
    expect(r.body.day.distanceValue).toBe(12);
    expect(r.body.day.distanceUnit).toBe("miles");
    expect(r.body.day.fuelNotes).toBe("1 gel at mile 6");
  });

  it("rejects a date before the plan starts, and a date past the plan's real end (not clamped)", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner2@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "5k", totalWeeks: 2, startDate: "2026-08-03" });
    const before = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-01", u.cookie, { workoutType: "rest" });
    expect(before.status).toBe(400);
    expect(before.body.error).toBe("invalid_date");
    const after = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-17", u.cookie, { workoutType: "rest" });
    expect(after.status).toBe(400);
    expect(after.body.error).toBe("invalid_date");
    const lastDay = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-16", u.cookie, { workoutType: "rest" });
    expect(lastDay.status).toBe(200);
    expect(lastDay.body.day.weekNumber).toBe(2);
  });

  it("filters the day list by a real date range for calendar-view style queries", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner3@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 3, startDate: "2026-08-03" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-10", u.cookie, { workoutType: "cross_training" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-17", u.cookie, { workoutType: "rest" });
    const r = await call(db, "GET", "/api/profile/training-plan/days?start=2026-08-05&end=2026-08-15", u.cookie);
    expect(r.body.days).toHaveLength(1);
    expect(r.body.days[0].date).toBe("2026-08-10");
  });

  it("a coach without an active relationship cannot read or write a specific athlete's days", async () => {
    const db = createMemoryStore();
    const coach = account(db, "coach@example.com");
    const athlete = account(db, "athlete@example.com");
    await call(db, "PUT", "/api/profile/training-plan", athlete.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    const read = await call(db, "GET", `/api/coach/athletes/${athlete.id}/training-plan/days`, coach.cookie);
    expect(read.status).toBe(403);
    const write = await call(db, "PUT", `/api/coach/athletes/${athlete.id}/training-plan/days/2026-08-08`, coach.cookie, { workoutType: "run" });
    expect(write.status).toBe(403);
  });

  it("an active coach can prescribe a real day's workout, and the athlete sees it through their own endpoint", async () => {
    const db = createMemoryStore();
    const coach = account(db, "coach2@example.com");
    const athlete = account(db, "athlete2@example.com");
    await call(db, "PUT", "/api/profile/training-plan", athlete.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    const request = await call(db, "POST", `/api/coach/${athlete.id}/request`, coach.cookie, { asCoach: true });
    await call(db, "POST", `/api/coach/${request.body.relationship.id}/accept`, athlete.cookie);

    const write = await call(db, "PUT", `/api/coach/athletes/${athlete.id}/training-plan/days/2026-08-08`, coach.cookie, {
      workoutType: "run", title: "Coach's long run", distanceMiles: 14,
    });
    expect(write.status).toBe(200);
    expect(write.body.day.title).toBe("Coach's long run");

    const athleteView = await call(db, "GET", "/api/profile/training-plan/days", athlete.cookie);
    expect(athleteView.body.days).toHaveLength(1);
    expect(athleteView.body.days[0].title).toBe("Coach's long run");
  });

  it("deleting the whole plan clears its daily content too", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner4@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run" });
    expect(db.listTrainingPlanDays(u.id)).toHaveLength(1);
    await call(db, "DELETE", "/api/profile/training-plan", u.cookie);
    expect(db.listTrainingPlanDays(u.id)).toHaveLength(0);
  });

  it("a linked route must actually exist - a fabricated route id is silently dropped, not stored", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner5@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", linkedRouteId: "does-not-exist" });
    expect(r.status).toBe(200);
    expect(r.body.day.linkedRouteId).toBeNull();
  });

  it("plan-vs-actual: logs done/missed/modified with a real dropdown reason, and defaults to pending", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner6@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    const created = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run" });
    expect(created.body.day.completionStatus).toBe("pending");

    const missed = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { completionStatus: "missed", missedReason: "injured", completionNotes: "Tweaked my knee" });
    expect(missed.body.day.completionStatus).toBe("missed");
    expect(missed.body.day.missedReason).toBe("injured");
    expect(missed.body.day.completionNotes).toBe("Tweaked my knee");

    const done = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { completionStatus: "done" });
    expect(done.body.day.completionStatus).toBe("done");
  });

  it("marking a day done clears any prior missed reason - never shows a stale reason on a completed day", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner7@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", completionStatus: "missed", missedReason: "weather" });
    expect(db.getTrainingPlanDay(u.id, "2026-08-03")!.missedReason).toBe("weather");

    const done = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { completionStatus: "done" });
    expect(done.body.day.missedReason).toBeNull();
    expect(db.getTrainingPlanDay(u.id, "2026-08-03")!.missedReason).toBeNull();
  });

  it("rejects a fabricated missed reason not in the fixed dropdown set", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner8@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { completionStatus: "missed", missedReason: "aliens_abducted_me" });
    // Falls back to null rather than storing a value outside the fixed set.
    expect(r.body.day.missedReason).toBeNull();
  });
});
