/**
 * Block summary - the actual "how much Tailwind/how many gels/how much
 * shoe mileage did I use this training block" report. Critically computed
 * fresh from the days in the given range, not the shoe's lifetime running
 * totalMiles (which covers all time and would overcount a specific block).
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

describe("Block summary - shoe mileage, gels, drink mix over a real date range", () => {
  it("totals real shoe mileage from days IN the range, converted correctly, ignoring days outside it", async () => {
    const db = createMemoryStore();
    const u = account(db, "blockrunner@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 16, startDate: "2026-08-03" });
    const shoe = await call(db, "POST", "/api/profile/shoes", u.cookie, { name: "Pegasus" });

    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", distanceValue: 5, distanceUnit: "miles", shoeId: shoe.body.shoe.id });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { completionStatus: "done" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-10", u.cookie, { workoutType: "run", distanceValue: 10, distanceUnit: "km", shoeId: shoe.body.shoe.id });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-10", u.cookie, { completionStatus: "done" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-11-01", u.cookie, { workoutType: "run", distanceValue: 20, distanceUnit: "miles", shoeId: shoe.body.shoe.id });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-11-01", u.cookie, { completionStatus: "done" });

    const summary = await call(db, "GET", "/api/profile/training-plan/block-summary?start=2026-08-01&end=2026-08-31", u.cookie);
    expect(summary.status).toBe(200);
    expect(summary.body.shoeMiles).toHaveLength(1);
    expect(summary.body.shoeMiles[0].shoeName).toBe("Pegasus");
    expect(summary.body.shoeMiles[0].miles).toBeCloseTo(11.2, 1);
  });

  it("splits mileage across multiple shoes correctly when different days used different pairs", async () => {
    const db = createMemoryStore();
    const u = account(db, "twoshoes@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 16, startDate: "2026-08-03" });
    const shoeA = await call(db, "POST", "/api/profile/shoes", u.cookie, { name: "Shoe A" });
    const shoeB = await call(db, "POST", "/api/profile/shoes", u.cookie, { name: "Shoe B" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", distanceValue: 5, distanceUnit: "miles", shoeId: shoeA.body.shoe.id, completionStatus: "done" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-04", u.cookie, { workoutType: "run", distanceValue: 8, distanceUnit: "miles", shoeId: shoeB.body.shoe.id, completionStatus: "done" });

    const summary = await call(db, "GET", "/api/profile/training-plan/block-summary?start=2026-08-01&end=2026-08-31", u.cookie);
    const names = summary.body.shoeMiles.map((s: any) => s.shoeName).sort();
    expect(names).toEqual(["Shoe A", "Shoe B"]);
  });

  it("totals actual gels and counts real drink mix usage across the range - only from days marked done", async () => {
    const db = createMemoryStore();
    const u = account(db, "fueledup@example.com");
    await call(db, "PUT", "/api/profile/training-plan", u.cookie, { planType: "marathon", totalWeeks: 16, startDate: "2026-08-03" });
    const tailwind = await call(db, "POST", "/api/profile/nutrition-items", u.cookie, { kind: "drink_mix", name: "Tailwind" });

    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", u.cookie, { workoutType: "run", actualGelCount: 2, actualDrinkMixId: tailwind.body.item.id, completionStatus: "done" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-10", u.cookie, { workoutType: "run", actualGelCount: 3, actualDrinkMixId: tailwind.body.item.id, completionStatus: "done" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-17", u.cookie, { workoutType: "run", plannedGelCount: 5 });

    const summary = await call(db, "GET", "/api/profile/training-plan/block-summary?start=2026-08-01&end=2026-08-31", u.cookie);
    expect(summary.body.totalGels).toBe(5);
    expect(summary.body.drinkMixUsage).toHaveLength(1);
    expect(summary.body.drinkMixUsage[0].name).toBe("Tailwind");
    expect(summary.body.drinkMixUsage[0].uses).toBe(2);
  });

  it("one account's block summary never includes another account's shoes, gels, or days", async () => {
    const db = createMemoryStore();
    const a = account(db, "isolatedA@example.com");
    const b = account(db, "isolatedB@example.com");
    await call(db, "PUT", "/api/profile/training-plan", a.cookie, { planType: "marathon", totalWeeks: 16, startDate: "2026-08-03" });
    const shoe = await call(db, "POST", "/api/profile/shoes", a.cookie, { name: "A's shoe" });
    await call(db, "PUT", "/api/profile/training-plan/days/2026-08-03", a.cookie, { workoutType: "run", distanceValue: 5, distanceUnit: "miles", shoeId: shoe.body.shoe.id, completionStatus: "done" });

    const bSummary = await call(db, "GET", "/api/profile/training-plan/block-summary?start=2026-08-01&end=2026-08-31", b.cookie);
    expect(bSummary.body.shoeMiles).toHaveLength(0);
    expect(bSummary.body.totalGels).toBe(0);
  });
});
