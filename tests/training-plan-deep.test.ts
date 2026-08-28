/**
 * The deeper training-plan features added on top of the day-level
 * foundation: two independent workouts per day (AM/PM), a real shoe
 * library (never someone else's shoe), group-run linking gated on actually
 * being RSVP'd, a coach's freeze locking a day against athlete edits, and
 * the propose-a-change restriction for an athlete who has an active coach.
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

describe("AM/PM slots", () => {
  it("stores two independent workouts for the same date, editable separately", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    const am = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03/am", u.cookie, { workoutType: "run", title: "Easy shakeout", distanceValue: 3, distanceUnit: "miles" });
    const pm = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03/pm", u.cookie, { workoutType: "cross_training", title: "Yoga" });
    expect(am.status).toBe(200);
    expect(pm.status).toBe(200);
    expect(am.body.day.slot).toBe("am");
    expect(pm.body.day.slot).toBe("pm");

    const list = await call(db, "GET", "/api/profile/training-plan/days", u.cookie);
    expect(list.body.days).toHaveLength(2);
    expect(list.body.days[0].slot).toBe("am");
    expect(list.body.days[1].slot).toBe("pm");
  });
});

describe("Shoe library", () => {
  it("a shoe id belonging to a different account is silently rejected, never stored", async () => {
    const db = createMemoryStore();
    const owner = account(db, "shoeowner@example.com");
    const intruder = account(db, "intruder@example.com");
    await call(db, "PUT", "/api/profile/training-plan", intruder.cookie, { planType: "5k", totalWeeks: 4, startDate: "2026-08-03" });
    const otherShoe = db.addShoe({ id: "not-yours", accountId: owner.id, name: "Owner's shoe", isDefault: true, createdAt: new Date().toISOString() });
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", intruder.cookie, { workoutType: "run", shoeId: otherShoe.id });
    expect(r.status).toBe(200);
    expect(r.body.day.shoeId).toBeNull();
  });

  it("setting a new default un-defaults the previous one", () => {
    const db = createMemoryStore();
    const u = account(db, "shoefan@example.com");
    const a = db.addShoe({ id: "shoe-a", accountId: u.id, name: "Shoe A", isDefault: true, createdAt: new Date().toISOString() });
    db.addShoe({ id: "shoe-b", accountId: u.id, name: "Shoe B", isDefault: true, createdAt: new Date().toISOString() });
    const shoes = db.listShoes(u.id);
    expect(shoes.find((s) => s.id === a.id)!.isDefault).toBe(false);
    expect(shoes.find((s) => s.id === "shoe-b")!.isDefault).toBe(true);
  });

  it("the real HTTP endpoints: add, auto-default the first one, list, set a new default, and delete", async () => {
    const db = createMemoryStore();
    const u = account(db, "shoehttp@example.com");
    const first = await call(db, "POST", "/api/profile/shoes", u.cookie, { name: "Pegasus 40" });
    expect(first.status).toBe(200);
    expect(first.body.shoe.isDefault).toBe(true); // first shoe auto-defaults

    const second = await call(db, "POST", "/api/profile/shoes", u.cookie, { name: "Vaporfly" });
    expect(second.body.shoe.isDefault).toBe(false); // not auto-default once one exists

    const list = await call(db, "GET", "/api/profile/shoes", u.cookie);
    expect(list.body.shoes).toHaveLength(2);

    const setDefault = await call(db, "POST", `/api/profile/shoes/${second.body.shoe.id}/default`, u.cookie);
    expect(setDefault.status).toBe(200);
    const afterDefault = await call(db, "GET", "/api/profile/shoes", u.cookie);
    expect(afterDefault.body.shoes.find((s: any) => s.id === first.body.shoe.id).isDefault).toBe(false);
    expect(afterDefault.body.shoes.find((s: any) => s.id === second.body.shoe.id).isDefault).toBe(true);

    const del = await call(db, "DELETE", `/api/profile/shoes/${first.body.shoe.id}`, u.cookie);
    expect(del.status).toBe(200);
    const afterDelete = await call(db, "GET", "/api/profile/shoes", u.cookie);
    expect(afterDelete.body.shoes).toHaveLength(1);
  });

  it("cannot set another account's shoe as your default, or delete it", async () => {
    const db = createMemoryStore();
    const owner = account(db, "shoeowner2@example.com");
    const intruder = account(db, "intruder2@example.com");
    const shoe = await call(db, "POST", "/api/profile/shoes", owner.cookie, { name: "Owner's shoe" });
    const setDefault = await call(db, "POST", `/api/profile/shoes/${shoe.body.shoe.id}/default`, intruder.cookie);
    expect(setDefault.status).toBe(404);
    const del = await call(db, "DELETE", `/api/profile/shoes/${shoe.body.shoe.id}`, intruder.cookie);
    expect(del.status).toBe(404);
    // Still there, untouched.
    const list = await call(db, "GET", "/api/profile/shoes", owner.cookie);
    expect(list.body.shoes).toHaveLength(1);
  });
});

describe("Group-run linking", () => {
  it("only links to an occurrence the account is actually RSVP'd/attending - a fabricated occurrence id is rejected", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner2@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { linkedEventOccurrenceId: "fake-occurrence" });
    expect(r.body.day.linkedEventOccurrenceId).toBeNull();
  });

  it("links successfully once a real attendance record exists for that occurrence", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner3@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    db.addAttendance({ id: "att-1", accountId: u.id, eventId: "event-1", role: "rsvp", occurrenceId: "event-1:2026-08-03", createdAt: new Date().toISOString() } as any);
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { linkedEventOccurrenceId: "event-1:2026-08-03" });
    expect(r.body.day.linkedEventOccurrenceId).toBe("event-1:2026-08-03");
  });
});

describe("Coach freeze and propose-a-change", () => {
  async function setupCoachedAthlete(db: Db) {
    const coach = account(db, "coach@example.com");
    const athlete = account(db, "athlete@example.com");
    await call(db, "PUT", "/api/profile/training-plan", athlete.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    const request = await call(db, "POST", `/api/coach/${athlete.id}/request`, coach.cookie, { asCoach: true });
    await call(db, "POST", `/api/coach/${request.body.relationship.id}/accept`, athlete.cookie);
    return { coach, athlete };
  }

  it("a frozen day rejects every athlete edit, even after the coach set it", async () => {
    const db = createMemoryStore();
    const { coach, athlete } = await setupCoachedAthlete(db);
    await call(db, "PUT", `/api/coach/athletes/${athlete.id}/training-plan/days/2026-08-03`, coach.cookie, { workoutType: "run", title: "Coach's workout", frozen: true });
    expect(db.getTrainingPlanDay(athlete.id, "2026-08-03")!.frozen).toBe(true);

    const attempt = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", athlete.cookie, { linkedEventOccurrenceId: "anything" });
    expect(attempt.status).toBe(403);
    expect(attempt.body.error).toBe("day_frozen");
  });

  it("an athlete cannot set frozen themselves, even by sending it in the request body", async () => {
    const db = createMemoryStore();
    const u = account(db, "solo@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", frozen: true });
    expect(r.body.day.frozen).toBe(false);
  });

  it("a coached athlete cannot directly edit the prescribed content - blocked with coach_managed", async () => {
    const db = createMemoryStore();
    const { coach, athlete } = await setupCoachedAthlete(db);
    await call(db, "PUT", `/api/coach/athletes/${athlete.id}/training-plan/days/2026-08-03`, coach.cookie, { workoutType: "run", title: "Coach's plan" });
    const attempt = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", athlete.cookie, { title: "I want to change this myself" });
    expect(attempt.status).toBe(403);
    expect(attempt.body.error).toBe("coach_managed");
  });

  it("a coached athlete CAN still log plan-vs-actual and link a group run without restriction", async () => {
    const db = createMemoryStore();
    const { coach, athlete } = await setupCoachedAthlete(db);
    await call(db, "PUT", `/api/coach/athletes/${athlete.id}/training-plan/days/2026-08-03`, coach.cookie, { workoutType: "run", title: "Coach's plan" });
    db.addAttendance({ id: "att-2", accountId: athlete.id, eventId: "event-2", role: "rsvp", occurrenceId: "event-2:2026-08-03", createdAt: new Date().toISOString() } as any);

    const logIt = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", athlete.cookie, { completionStatus: "done" });
    expect(logIt.status).toBe(200);
    expect(logIt.body.day.completionStatus).toBe("done");

    const linkRun = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", athlete.cookie, { linkedEventOccurrenceId: "event-2:2026-08-03" });
    expect(linkRun.status).toBe(200);
    expect(linkRun.body.day.linkedEventOccurrenceId).toBe("event-2:2026-08-03");
  });

  it("a self-coached athlete (no active coach) edits their own content freely, unaffected by any of this", async () => {
    const db = createMemoryStore();
    const u = account(db, "independent@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 4, startDate: "2026-08-03" });
    const r = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", title: "My own plan" });
    expect(r.status).toBe(200);
    expect(r.body.day.title).toBe("My own plan");
  });
});
