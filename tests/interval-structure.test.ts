/**
 * Interval structure validation - track/distance repeats ("6x400m") and
 * time-based work/rest intervals ("5x(1:00 work/30s rest)"). Every branch
 * gets a real test: unit consistency (duration never carries a distance
 * unit), bounds checking, the no-rest case, and clearing an existing
 * structure back to a simple distance day.
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
async function setupPlan(db: Db) {
  const u = account(db, `runner-${Math.random()}@example.com`);
  await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
  return u;
}

describe("Interval structure - track/distance repeats", () => {
  it("accepts a real distance-based interval set: 6x400m with a 200m jog recovery", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, {
      workoutType: "run",
      intervalStructure: { repeatCount: 6, workMeasure: "distance", workValue: 400, workUnit: "meters", hasRest: true, restMeasure: "distance", restValue: 200, restUnit: "meters" },
    });
    expect(r.status).toBe(200);
    expect(r.body.day.intervalStructure).toEqual({
      warmupValue: null, warmupUnit: null,
      repeatCount: 6, workMeasure: "distance", workValue: 400, workUnit: "meters", workDurationUnit: null, workPaceTarget: null,
      hasRest: true, restType: "jog", restMeasure: "distance", restValue: 200, restUnit: "meters", restDurationUnit: null,
      cooldownValue: null, cooldownUnit: null,
    });
  });

  it("rejects a distance measure with no unit - a distance without a unit is meaningless", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, {
      workoutType: "run",
      intervalStructure: { repeatCount: 6, workMeasure: "distance", workValue: 400, hasRest: false },
    });
    expect(r.body.day.intervalStructure).toBeNull();
  });
});

describe("Warm-up, cool-down, pace target, and recovery type - the crucial elements real platforms include", () => {
  it("accepts a full real workout: 2mi warmup, 5x1000m at threshold pace with a walk recovery, 1mi cooldown", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, {
      workoutType: "run",
      intervalStructure: {
        warmupValue: 2, warmupUnit: "miles",
        repeatCount: 5, workMeasure: "distance", workValue: 1000, workUnit: "meters", workPaceTarget: "threshold",
        hasRest: true, restType: "walk", restMeasure: "distance", restValue: 400, restUnit: "meters",
        cooldownValue: 1, cooldownUnit: "miles",
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.day.intervalStructure.warmupValue).toBe(2);
    expect(r.body.day.intervalStructure.workPaceTarget).toBe("threshold");
    expect(r.body.day.intervalStructure.restType).toBe("walk");
    expect(r.body.day.intervalStructure.cooldownValue).toBe(1);
  });

  it("a warmup value with no unit is rejected entirely, not silently accepted without a unit", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, {
      intervalStructure: { warmupValue: 2, repeatCount: 4, workMeasure: "duration", workValue: 60, hasRest: false },
    });
    expect(r.body.day.intervalStructure).toBeNull();
  });

  it("recovery type defaults to jog when not specified, matching the most common real-world case", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, {
      intervalStructure: { repeatCount: 4, workMeasure: "distance", workValue: 400, workUnit: "meters", hasRest: true, restMeasure: "duration", restValue: 90 },
    });
    expect(r.body.day.intervalStructure.restType).toBe("jog");
  });

  it("rejects a bogus pace target outside the real four zones", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, {
      intervalStructure: { repeatCount: 4, workMeasure: "distance", workValue: 400, workUnit: "meters", workPaceTarget: "sonic_speed", hasRest: false },
    });
    expect(r.body.day.intervalStructure.workPaceTarget).toBeNull();
  });
});

describe("Duration in minutes, not just seconds", () => {
  it("accepts a real minutes-based interval: 4x4:00 at marathon pace with 2:00 rest", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, {
      intervalStructure: { repeatCount: 4, workMeasure: "duration", workValue: 4, workDurationUnit: "minutes", workPaceTarget: "marathon", hasRest: true, restMeasure: "duration", restValue: 2, restDurationUnit: "minutes" },
    });
    expect(r.status).toBe(200);
    expect(r.body.day.intervalStructure.workDurationUnit).toBe("minutes");
    expect(r.body.day.intervalStructure.restDurationUnit).toBe("minutes");
  });

  it("a duration measure with no explicit unit defaults to seconds, not left null", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, {
      intervalStructure: { repeatCount: 5, workMeasure: "duration", workValue: 60, hasRest: false },
    });
    expect(r.body.day.intervalStructure.workDurationUnit).toBe("seconds");
  });
});


describe("Interval structure - time-based work/rest", () => {
  it("accepts a real duration-based interval set: 5x(60s work / 30s rest)", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, {
      workoutType: "run",
      intervalStructure: { repeatCount: 5, workMeasure: "duration", workValue: 60, hasRest: true, restMeasure: "duration", restValue: 30 },
    });
    expect(r.status).toBe(200);
    expect(r.body.day.intervalStructure.workValue).toBe(60);
    expect(r.body.day.intervalStructure.restValue).toBe(30);
    expect(r.body.day.intervalStructure.workUnit).toBeNull();
    expect(r.body.day.intervalStructure.restUnit).toBeNull();
  });

  it("hasRest: false correctly nulls out every rest field, even if rest data is sent alongside it", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, {
      workoutType: "run",
      intervalStructure: { repeatCount: 8, workMeasure: "duration", workValue: 45, hasRest: false, restMeasure: "duration", restValue: 999 },
    });
    expect(r.body.day.intervalStructure.hasRest).toBe(false);
    expect(r.body.day.intervalStructure.restMeasure).toBeNull();
    expect(r.body.day.intervalStructure.restValue).toBeNull();
    expect(r.body.day.intervalStructure.restUnit).toBeNull();
  });
});

describe("Interval structure - bounds and malformed input", () => {
  it("rejects a repeat count of 0 and an absurdly high one", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    const zero = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { intervalStructure: { repeatCount: 0, workMeasure: "duration", workValue: 60, hasRest: false } });
    expect(zero.body.day.intervalStructure).toBeNull();
    const huge = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { intervalStructure: { repeatCount: 500, workMeasure: "duration", workValue: 60, hasRest: false } });
    expect(huge.body.day.intervalStructure).toBeNull();
  });

  it("rejects a negative or zero work value", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { intervalStructure: { repeatCount: 5, workMeasure: "duration", workValue: -10, hasRest: false } });
    expect(r.body.day.intervalStructure).toBeNull();
  });

  it("completely malformed input (not an object) is rejected without crashing", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { intervalStructure: "6x400m" });
    expect(r.status).toBe(200);
    expect(r.body.day.intervalStructure).toBeNull();
  });
});

describe("Clearing an interval structure", () => {
  it("explicit null clears a previously-set structure, reverting to a simple distance day", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { intervalStructure: { repeatCount: 6, workMeasure: "distance", workValue: 400, workUnit: "meters", hasRest: false } });
    expect(db.getTrainingPlanDay(u.id, "2026-08-03")!.intervalStructure).not.toBeNull();
    const cleared = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { intervalStructure: null, distanceValue: 5, distanceUnit: "miles" });
    expect(cleared.body.day.intervalStructure).toBeNull();
    expect(cleared.body.day.distanceValue).toBe(5);
  });

  it("omitting the field entirely preserves whatever structure already existed - not the same as sending null", async () => {
    const db = createMemoryStore();
    const u = await setupPlan(db);
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", intervalStructure: { repeatCount: 6, workMeasure: "distance", workValue: 400, workUnit: "meters", hasRest: false } });
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { title: "Track day" });
    expect(r.body.day.intervalStructure).not.toBeNull();
    expect(r.body.day.intervalStructure.repeatCount).toBe(6);
  });
});
