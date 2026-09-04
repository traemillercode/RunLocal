/**
 * Red/Yellow/Green weekly scoring - run and strength graded separately
 * (a bad lifting week shouldn't hide behind good running, or vice versa),
 * overall taking the worse of the two. Only days that have actually
 * happened count; a future "pending" day isn't judged, but a past-due one
 * (never confirmed either way) counts as missed - silence isn't neutral.
 * Plus the mandatory review gate for a red week.
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
const NOW = new Date("2026-08-09T12:00:00Z");

describe("Week scoring - runs", () => {
  it("scores green when most run days are done", async () => {
    const db = createMemoryStore();
    const u = account(db, "greenrunner@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    for (const date of ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"]) {
      await call(db, "PUT", `/api/profile/training-plan/days/${date}`, u.cookie, { workoutType: "run", completionStatus: "done" });
    }
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-07", u.cookie, { workoutType: "run", completionStatus: "missed", missedReason: "sick" });
    const score = db.computeWeekScore(u.id, "2026-08-03", NOW);
    expect(score.runColor).toBe("green");
  });

  it("scores red when a large share of run days are missed or never confirmed", async () => {
    const db = createMemoryStore();
    const u = account(db, "redrunner@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", completionStatus: "done" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-04", u.cookie, { workoutType: "run", completionStatus: "missed", missedReason: "too_busy" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-05", u.cookie, { workoutType: "run" });
    const score = db.computeWeekScore(u.id, "2026-08-03", NOW);
    expect(score.runColor).toBe("red");
  });

  it("a future pending day is never judged - doesn't drag the score down", async () => {
    const db = createMemoryStore();
    const u = account(db, "futureplanner@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", completionStatus: "done" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-14", u.cookie, { workoutType: "run" });
    const score = db.computeWeekScore(u.id, "2026-08-03", NOW);
    expect(score.runColor).toBe("green");
  });

  it("no run days scheduled at all scores green by default - nothing to fail", () => {
    const db = createMemoryStore();
    const u = account(db, "resttest@example.com");
    const score = db.computeWeekScore(u.id, "2026-08-03", NOW);
    expect(score.runColor).toBe("green");
  });
});

describe("Week scoring - overall takes the worse category", () => {
  it("great running but a bad strength week still scores the week red overall", async () => {
    const db = createMemoryStore();
    const u = account(db, "mixedweek@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    for (const date of ["2026-08-03", "2026-08-04", "2026-08-05"]) {
      await call(db, "PUT", `/api/profile/training-plan/days/${date}`, u.cookie, { workoutType: "run", completionStatus: "done" });
    }
    await call(db, "POST", "/api/profile/training-plan/strength", u.cookie, { date: "2026-08-03", title: "Leg day" });
    await call(db, "POST", "/api/profile/training-plan/strength", u.cookie, { date: "2026-08-04", title: "Upper body" });
    const score = db.computeWeekScore(u.id, "2026-08-03", NOW);
    expect(score.runColor).toBe("green");
    expect(score.strengthColor).toBe("red");
    expect(score.overallColor).toBe("red");
  });
});

describe("Mandatory review gate", () => {
  it("cannot submit a review for a week that wasn't actually red", async () => {
    const db = createMemoryStore();
    const u = account(db, "goodweek@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", completionStatus: "done" });
    const r = await call(db, "POST", "/api/profile/training-plan/week-review", u.cookie, { weekStartDate: "2026-08-03", notes: "All good" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("not_red");
  });

  it("requires real notes, not an empty review", async () => {
    const db = createMemoryStore();
    const u = account(db, "badweek@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", completionStatus: "missed", missedReason: "sick" });
    const r = await call(db, "POST", "/api/profile/training-plan/week-review", u.cookie, { weekStartDate: "2026-08-03", notes: "" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("notes_required");
  });

  it("a genuinely red week accepts a real review, and the prior-week-blocking flag clears once reviewed", async () => {
    const db = createMemoryStore();
    const u = account(db, "reviewer@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", completionStatus: "missed", missedReason: "injured" });

    const beforeReview = await call(db, "GET", "/api/profile/training-plan/week-score?weekStartDate=2026-08-10", u.cookie);
    expect(beforeReview.body.priorWeekBlocking).toBe(true);

    const review = await call(db, "POST", "/api/profile/training-plan/week-review", u.cookie, { weekStartDate: "2026-08-03", notes: "Taking it easier this week, doctor cleared me Wednesday" });
    expect(review.status).toBe(200);

    const afterReview = await call(db, "GET", "/api/profile/training-plan/week-score?weekStartDate=2026-08-10", u.cookie);
    expect(afterReview.body.priorWeekBlocking).toBe(false);
  });
});

describe("Coach roster", () => {
  it("shows every active athlete's current week color at a glance", async () => {
    const db = createMemoryStore();
    const coach = account(db, "rostercoach@example.com");
    const athlete1 = account(db, "athlete1@example.com");
    const athlete2 = account(db, "athlete2@example.com");
    for (const a of [athlete1, athlete2]) {
      await call(db, "PUT", "/api/profile/training-plan", a.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
      const reqResult = await call(db, "POST", `/api/coach/${a.id}/request`, coach.cookie, { asCoach: true });
      await call(db, "POST", `/api/coach/${reqResult.body.relationship.id}/accept`, a.cookie);
    }
    const roster = await call(db, "GET", "/api/coach/roster", coach.cookie);
    expect(roster.status).toBe(200);
    expect(roster.body.athletes).toHaveLength(2);
    expect(roster.body.athletes.map((a: any) => a.athleteId).sort()).toEqual([athlete1.id, athlete2.id].sort());
  });

  it("only shows active relationships, never pending ones", async () => {
    const db = createMemoryStore();
    const coach = account(db, "pendingcoach@example.com");
    const athlete = account(db, "pendingathlete@example.com");
    await call(db, "POST", `/api/coach/${athlete.id}/request`, coach.cookie, { asCoach: true });
    const roster = await call(db, "GET", "/api/coach/roster", coach.cookie);
    expect(roster.body.athletes).toHaveLength(0);
  });
});
