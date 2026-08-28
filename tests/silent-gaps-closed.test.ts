/**
 * Closing the silent gaps found by auditing every store method against
 * actual HTTP wiring: propose-a-change (the real path forward after a
 * coached athlete hits coach_managed), the nutrition item library,
 * strength/gym entries, and ending a coach relationship - all had full
 * store-layer CRUD but zero HTTP access before now.
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
async function setupCoachedAthlete(db: Db) {
  const coach = account(db, "coach@example.com");
  const athlete = account(db, "athlete@example.com");
  await call(db, "PUT", "/api/profile/training-plan", athlete.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
  const request = await call(db, "POST", `/api/coach/${athlete.id}/request`, coach.cookie, { asCoach: true });
  await call(db, "POST", `/api/coach/${request.body.relationship.id}/accept`, athlete.cookie);
  return { coach, athlete };
}

describe("Propose-a-change (the real path forward from coach_managed)", () => {
  it("a coached athlete proposes a change, the coach sees it, approves it, and it actually applies to the real day", async () => {
    const db = createMemoryStore();
    const { coach, athlete } = await setupCoachedAthlete(db);
    await call(db, "PUT", `/api/coach/athletes/${athlete.id}/training-plan/days/2026-08-03`, coach.cookie, { workoutType: "run", title: "Coach's plan", distanceValue: 5, distanceUnit: "miles" });

    const propose = await call(db, "POST", "/api/profile/training-plan/days/2026-08-03/propose", athlete.cookie, {
      coachId: coach.id, proposedChanges: { distanceValue: 8 }, note: "Feeling strong, want to go longer",
    });
    expect(propose.status).toBe(200);
    expect(propose.body.proposal.status).toBe("pending");

    const inbox = await call(db, "GET", "/api/coach/proposals", coach.cookie);
    expect(inbox.body.proposals).toHaveLength(1);
    expect(inbox.body.proposals[0].athleteName).toBe("Test Runner");
    expect(inbox.body.proposals[0].note).toBe("Feeling strong, want to go longer");

    const approve = await call(db, "POST", `/api/coach/proposals/${propose.body.proposal.id}/approve`, coach.cookie);
    expect(approve.status).toBe(200);
    expect(approve.body.applied).toBe(true);
    expect(db.getTrainingPlanDay(athlete.id, "2026-08-03")!.distanceValue).toBe(8);
  });

  it("declining a proposal never applies the changes", async () => {
    const db = createMemoryStore();
    const { coach, athlete } = await setupCoachedAthlete(db);
    await call(db, "PUT", `/api/coach/athletes/${athlete.id}/training-plan/days/2026-08-03`, coach.cookie, { workoutType: "run", distanceValue: 5, distanceUnit: "miles" });
    const propose = await call(db, "POST", "/api/profile/training-plan/days/2026-08-03/propose", athlete.cookie, { coachId: coach.id, proposedChanges: { distanceValue: 12 } });
    await call(db, "POST", `/api/coach/proposals/${propose.body.proposal.id}/decline`, coach.cookie);
    expect(db.getTrainingPlanDay(athlete.id, "2026-08-03")!.distanceValue).toBe(5);
  });

  it("cannot propose to someone who isn't actually your active coach", async () => {
    const db = createMemoryStore();
    const athlete = account(db, "lonewolf@example.com");
    const notMyCoach = account(db, "stranger@example.com");
    const r = await call(db, "POST", "/api/profile/training-plan/days/2026-08-03/propose", athlete.cookie, { coachId: notMyCoach.id, proposedChanges: { title: "hi" } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("not_your_coach");
  });

  it("a third party cannot approve someone else's proposal", async () => {
    const db = createMemoryStore();
    const { coach, athlete } = await setupCoachedAthlete(db);
    const outsider = account(db, "outsider@example.com");
    const propose = await call(db, "POST", "/api/profile/training-plan/days/2026-08-03/propose", athlete.cookie, { coachId: coach.id, proposedChanges: { title: "x" } });
    const r = await call(db, "POST", `/api/coach/proposals/${propose.body.proposal.id}/approve`, outsider.cookie);
    expect(r.status).toBe(404);
  });
});

describe("Nutrition item library", () => {
  it("adds, lists, and deletes real gel/drink-mix items", async () => {
    const db = createMemoryStore();
    const u = account(db, "fueler@example.com");
    const add = await call(db, "POST", "/api/profile/nutrition-items", u.cookie, { kind: "drink_mix", name: "Tailwind Endurance Fuel" });
    expect(add.status).toBe(200);
    const list = await call(db, "GET", "/api/profile/nutrition-items", u.cookie);
    expect(list.body.items).toHaveLength(1);
    const del = await call(db, "DELETE", `/api/profile/nutrition-items/${add.body.item.id}`, u.cookie);
    expect(del.status).toBe(200);
    expect((await call(db, "GET", "/api/profile/nutrition-items", u.cookie)).body.items).toHaveLength(0);
  });

  it("a day can now actually reference a real nutrition item, closing the gap where validation existed but nothing could ever be created", async () => {
    const db = createMemoryStore();
    const u = account(db, "fueler2@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 8, startDate: "2026-08-03" });
    const mix = await call(db, "POST", "/api/profile/nutrition-items", u.cookie, { kind: "drink_mix", name: "Tailwind" });
    const day = await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", plannedDrinkMixId: mix.body.item.id, plannedGelCount: 3 });
    expect(day.body.day.plannedDrinkMixId).toBe(mix.body.item.id);
    expect(day.body.day.plannedGelCount).toBe(3);
  });

  it("one account can never delete another's nutrition item", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner@example.com");
    const intruder = account(db, "intruder@example.com");
    const item = await call(db, "POST", "/api/profile/nutrition-items", owner.cookie, { kind: "gel", name: "Maurten" });
    const r = await call(db, "DELETE", `/api/profile/nutrition-items/${item.body.item.id}`, intruder.cookie);
    expect(r.status).toBe(404);
  });
});

describe("Strength/gym entries (unlimited per day)", () => {
  it("adds multiple strength entries on the same date without any cap, unlike the 2-run limit", async () => {
    const db = createMemoryStore();
    const u = account(db, "lifter@example.com");
    await call(db, "POST", "/api/profile/training-plan/strength", u.cookie, { date: "2026-08-03", title: "Upper body" });
    await call(db, "POST", "/api/profile/training-plan/strength", u.cookie, { date: "2026-08-03", title: "Core" });
    await call(db, "POST", "/api/profile/training-plan/strength", u.cookie, { date: "2026-08-03", title: "Mobility" });
    const list = await call(db, "GET", "/api/profile/training-plan/strength?date=2026-08-03", u.cookie);
    expect(list.body.entries).toHaveLength(3);
  });

  it("updates completion status on a real entry, and rejects an update to someone else's", async () => {
    const db = createMemoryStore();
    const owner = account(db, "owner2@example.com");
    const intruder = account(db, "intruder2@example.com");
    const created = await call(db, "POST", "/api/profile/training-plan/strength", owner.cookie, { date: "2026-08-03", title: "Leg day" });
    const update = await call(db, "PUT", `/api/profile/training-plan/strength/${created.body.entry.id}`, owner.cookie, { completionStatus: "done" });
    expect(update.body.entry.completionStatus).toBe("done");
    const hijack = await call(db, "PUT", `/api/profile/training-plan/strength/${created.body.entry.id}`, intruder.cookie, { completionStatus: "missed" });
    expect(hijack.status).toBe(404);
  });
});

describe("Ending a coach relationship", () => {
  it("either the coach or the athlete can end an active relationship, and access is revoked immediately", async () => {
    const db = createMemoryStore();
    const { coach, athlete } = await setupCoachedAthlete(db);
    const relationships = await call(db, "GET", "/api/coach/relationships", coach.cookie);
    const relId = relationships.body.relationships[0].id;

    const beforeEnd = await call(db, "GET", `/api/coach/athletes/${athlete.id}/training-plan`, coach.cookie);
    expect(beforeEnd.status).toBe(200);

    const end = await call(db, "POST", `/api/coach/relationships/${relId}/end`, athlete.cookie);
    expect(end.status).toBe(200);

    const afterEnd = await call(db, "GET", `/api/coach/athletes/${athlete.id}/training-plan`, coach.cookie);
    expect(afterEnd.status).toBe(403);
  });

  it("a random third party cannot end someone else's relationship", async () => {
    const db = createMemoryStore();
    const { coach, athlete } = await setupCoachedAthlete(db);
    const outsider = account(db, "outsider2@example.com");
    const relationships = await call(db, "GET", "/api/coach/relationships", coach.cookie);
    const relId = relationships.body.relationships[0].id;
    const r = await call(db, "POST", `/api/coach/relationships/${relId}/end`, outsider.cookie);
    expect(r.status).toBe(404);
    void athlete;
  });
});
