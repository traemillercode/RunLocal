/**
 * Training plan race linking - a plan can point at a real race
 * (linkedRaceId) or, when the race isn't in the system yet, a plain display
 * name (customRaceName) submitted separately for admin review. The two are
 * mutually exclusive - setting a real linkedRaceId later must clear any
 * customRaceName, never show both.
 */
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { SESSION_COOKIE } from "../src/server/api";
import type { RaceRecord } from "../src/server/types";

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
function race(db: Db, name: string): RaceRecord {
  const now = new Date().toISOString();
  return db.setRace({
    id: `race-${name.replace(/\s+/g, "-").toLowerCase()}`, cityId: "columbia-mo", refId: "seed-1", source: "submission",
    name, distances: "Marathon", date: "2026-11-01", location: "Columbia, MO", registrationUrl: "", description: "", organizer: "",
    price: "", registrationOpen: true, registrationNote: "", createdAt: now, updatedAt: now, updatedBy: "test",
  });
}

describe("Training plan race linking", () => {
  it("links to a real existing race", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner@example.com");
    const r = race(db, "Columbia Marathon");
    const res = await call(db, "PUT", "/api/profile/training-plan", u.cookie, {
      planType: "marathon", totalWeeks: 16, startDate: "2026-08-01", linkedRaceId: r.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.plan.linkedRaceId).toBe(r.id);
    expect(res.body.plan.linkedRaceName).toBe("Columbia Marathon");
    expect(res.body.plan.customRaceName).toBeNull();
  });

  it("stores a custom race name when the race isn't in the system, without a real linkedRaceId", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner2@example.com");
    const res = await call(db, "PUT", "/api/profile/training-plan", u.cookie, {
      planType: "marathon", totalWeeks: 16, startDate: "2026-08-01", customRaceName: "Backwoods 50K",
    });
    expect(res.status).toBe(200);
    expect(res.body.plan.linkedRaceId).toBeNull();
    expect(res.body.plan.customRaceName).toBe("Backwoods 50K");
    expect(db.getTrainingPlan(u.id)!.customRaceName).toBe("Backwoods 50K");
  });

  it("setting a real linkedRaceId later clears any prior customRaceName - never shows both", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner3@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, {
      planType: "marathon", totalWeeks: 16, startDate: "2026-08-01", customRaceName: "My Local Race",
    });
    expect(db.getTrainingPlan(u.id)!.customRaceName).toBe("My Local Race");

    const r = race(db, "Now Approved Race");
    const res = await call(db, "PUT", "/api/profile/training-plan", u.cookie, {
      planType: "marathon", totalWeeks: 16, startDate: "2026-08-01", linkedRaceId: r.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.plan.linkedRaceId).toBe(r.id);
    expect(res.body.plan.customRaceName).toBeNull();
    expect(db.getTrainingPlan(u.id)!.customRaceName).toBeNull();
  });

  it("still rejects a fabricated or nonexistent linkedRaceId, unchanged from before this feature", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner4@example.com");
    const res = await call(db, "PUT", "/api/profile/training-plan", u.cookie, {
      planType: "marathon", totalWeeks: 16, startDate: "2026-08-01", linkedRaceId: "does-not-exist",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_race");
  });
});
