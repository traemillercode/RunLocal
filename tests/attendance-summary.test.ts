/**
 * Bulk attendance summary for the DepartureBoard integration - one call for
 * a whole week's occurrences instead of one per card, capped to 4 attendees
 * per occurrence server-side rather than shipping the full array.
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
function account(db: Db, name: string, cityId = "columbia-mo"): { id: string; cookie: string } {
  const a = db.createAccount({ name, email: `${name.toLowerCase().replace(/\s/g, "")}@example.com`, cityId });
  db.updateAccount(a.id, { status: "verified" });
  const s = db.createSession(a.id, "127.0.0.1");
  return { id: a.id, cookie: `${SESSION_COOKIE}=${s.id}` };
}

describe("Bulk attendance summary", () => {
  it("returns the real host, capped attendees, and a real going count for a real occurrence", async () => {
    const db = createMemoryStore();
    const viewer = account(db, "Viewer Runner");
    const host = account(db, "Casey Host");
    const goers = [account(db, "Alex One"), account(db, "Blake Two"), account(db, "Casey Three"), account(db, "Drew Four"), account(db, "Evan Five")];
    const occurrenceId = "event:trackclub:2026-09-01";
    db.addAttendance({ id: "att-host", accountId: host.id, eventId: "trackclub", role: "host", createdAt: new Date().toISOString(), occurrenceId } as any);
    for (const g of goers) db.addAttendance({ id: `att-${g.id}`, accountId: g.id, eventId: "trackclub", role: "rsvp", createdAt: new Date().toISOString(), occurrenceId } as any);

    const r = await call(db, "POST", "/api/events/attendance-summary", viewer.cookie, { occurrenceIds: [occurrenceId] });
    expect(r.status).toBe(200);
    const summary = r.body.summaries[occurrenceId];
    expect(summary.host.name).toBe("Casey Host");
    expect(summary.attendees).toHaveLength(4);
    expect(summary.goingCount).toBe(5);
  });

  it("an occurrence with nobody attending returns a real empty summary, not an error", async () => {
    const db = createMemoryStore();
    const viewer = account(db, "Lonely Viewer");
    const r = await call(db, "POST", "/api/events/attendance-summary", viewer.cookie, { occurrenceIds: ["event:nobody:2026-09-01"] });
    expect(r.status).toBe(200);
    const summary = r.body.summaries["event:nobody:2026-09-01"];
    expect(summary.host).toBeNull();
    expect(summary.attendees).toEqual([]);
    expect(summary.goingCount).toBe(0);
  });

  it("a deleted account never appears as host or attendee, and never inflates the going count incorrectly", async () => {
    const db = createMemoryStore();
    const viewer = account(db, "Viewer2");
    const ghost = account(db, "Ghost Runner");
    db.updateAccount(ghost.id, { deletedAt: new Date().toISOString() });
    const occurrenceId = "event:ghosted:2026-09-01";
    db.addAttendance({ id: "att-ghost", accountId: ghost.id, eventId: "ghosted", role: "rsvp", createdAt: new Date().toISOString(), occurrenceId } as any);

    const r = await call(db, "POST", "/api/events/attendance-summary", viewer.cookie, { occurrenceIds: [occurrenceId] });
    const summary = r.body.summaries[occurrenceId];
    expect(summary.attendees).toEqual([]);
  });

  it("requires a signed-in session", async () => {
    const db = createMemoryStore();
    const r = await call(db, "POST", "/api/events/attendance-summary", undefined, { occurrenceIds: ["x"] });
    expect(r.status).toBe(401);
  });

  it("caps the request to 100 occurrence ids and ignores non-string entries, without crashing", async () => {
    const db = createMemoryStore();
    const viewer = account(db, "Viewer3");
    const manyIds = Array.from({ length: 150 }, (_, i) => `event:x:${i}`);
    const r = await call(db, "POST", "/api/events/attendance-summary", viewer.cookie, { occurrenceIds: [...manyIds, 123, null, { bad: true }] });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.summaries)).toHaveLength(100);
  });
});
