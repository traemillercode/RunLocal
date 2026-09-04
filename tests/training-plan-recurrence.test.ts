/**
 * Recurring workout scheduling (Outlook-style) - creating a rule generates
 * real day records; editing one directly ("this instance only") marks it
 * overridden and protects it from the rule's "edit all instances" ever
 * regenerating over it again.
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

describe("Recurring workout scheduling", () => {
  it("generates real day records for every matching day-of-week in range - Mon/Wed/Fri across two weeks = 6 days", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    const r = await call(db, "POST", "/api/profile/training-plan/recurrences", u.cookie, {
      daysOfWeek: [1, 3, 5], startDate: "2026-08-03", endDate: "2026-08-16", workoutType: "run", runLabel: "easy", title: "Easy run", distanceValue: 5, distanceUnit: "miles",
    });
    expect(r.status).toBe(200);
    expect(r.body.generatedCount).toBe(6);
    const days = await call(db, "GET", "/api/profile/training-plan/days", u.cookie);
    expect(days.body.days.map((d: any) => d.date).sort()).toEqual(["2026-08-03", "2026-08-05", "2026-08-07", "2026-08-10", "2026-08-12", "2026-08-14"]);
    expect(days.body.days[0].recurrenceId).toBe(r.body.recurrence.id);
    expect(days.body.days[0].runLabel).toBe("easy");
  });

  it("editing a single generated instance directly marks it overridden and protects it from later regeneration", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner2@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    const rec = await call(db, "POST", "/api/profile/training-plan/recurrences", u.cookie, {
      daysOfWeek: [1], startDate: "2026-08-03", endDate: "2026-08-17", workoutType: "run", title: "Easy run", distanceValue: 5, distanceUnit: "miles",
    });
    const editOne = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-10", u.cookie, { title: "Actually a rest day", workoutType: "rest" });
    expect(editOne.body.day.recurrenceOverridden).toBe(true);

    await call(db, "PUT", `/api/profile/training-plan/recurrences/${rec.body.recurrence.id}`, u.cookie, { title: "Tempo run instead", distanceValue: 6 });
    const days = await call(db, "GET", "/api/profile/training-plan/days", u.cookie);
    const untouched = days.body.days.find((d: any) => d.date === "2026-08-10");
    const regenerated = days.body.days.find((d: any) => d.date === "2026-08-03");
    expect(untouched.title).toBe("Actually a rest day");
    expect(untouched.workoutType).toBe("rest");
    expect(regenerated.title).toBe("Tempo run instead");
    expect(regenerated.distanceValue).toBe(6);
  });

  it("a recurrence extending past the plan's own end date simply stops generating there, without erroring", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner3@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "5k", totalWeeks: 2, startDate: "2026-08-03" });
    const r = await call(db, "POST", "/api/profile/training-plan/recurrences", u.cookie, {
      daysOfWeek: [1], startDate: "2026-08-03", endDate: "2026-09-30", workoutType: "run", title: "Weekly long run",
    });
    expect(r.status).toBe(200);
    const days = await call(db, "GET", "/api/profile/training-plan/days", u.cookie);
    expect(days.body.days).toHaveLength(2);
  });

  it("rejects an empty days-of-week selection and an invalid date range", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner4@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    const noDays = await call(db, "POST", "/api/profile/training-plan/recurrences", u.cookie, { daysOfWeek: [], startDate: "2026-08-03", endDate: "2026-08-10" });
    expect(noDays.status).toBe(400);
    const badRange = await call(db, "POST", "/api/profile/training-plan/recurrences", u.cookie, { daysOfWeek: [1], startDate: "2026-08-10", endDate: "2026-08-03" });
    expect(badRange.status).toBe(400);
  });

  it("one account can never edit or delete another account's recurrence rule", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const intruder = account(db, "intruder@example.com");
    await call(db, "PUT", "/api/profile/training-plan", owner.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    const rec = await call(db, "POST", "/api/profile/training-plan/recurrences", owner.cookie, { daysOfWeek: [1], startDate: "2026-08-03", endDate: "2026-08-10", workoutType: "run" });
    const editAttempt = await call(db, "PUT", `/api/profile/training-plan/recurrences/${rec.body.recurrence.id}`, intruder.cookie, { title: "Hijacked" });
    expect(editAttempt.status).toBe(404);
    const deleteAttempt = await call(db, "DELETE", `/api/profile/training-plan/recurrences/${rec.body.recurrence.id}`, intruder.cookie);
    expect(deleteAttempt.status).toBe(404);
  });
});
