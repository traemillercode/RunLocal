/**
 * HTTP-level tests for GET /api/runners/:id/shared-events — the shared-run
 * basis for the runner feedback (ratings + concerns) sheet:
 *  - verified pair with a shared RSVP → one row {eventId, title, date};
 *  - host attendance counts as shared (host + RSVP mix);
 *  - one row per event (most recent shared occurrence) with "TBD" for
 *    events whose public title can't be resolved;
 *  - guests 401, unverified callers 403, unverified reviewees 403;
 *  - unknown/deleted reviewees 404 identically;
 *  - the payload is minimal: only eventId/title/date, no identities or
 *    attendance history beyond the shared pair.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { ADMIN_EMAIL_VAR, ADMIN_KEY_VAR } from "../src/server/admin";

// ------------------------------------------------------------ HTTP harness
function makeReq(method: string, path: string, opts: { body?: unknown; cookie?: string } = {}): IncomingMessage {
  const raw = opts.body === undefined ? "" : JSON.stringify(opts.body);
  const headers: Record<string, string> = { "x-forwarded-proto": "https" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (raw) headers["content-type"] = "application/json";
  const req = {
    method,
    url: path,
    headers,
    socket: { remoteAddress: "198.51.100.23" },
    [Symbol.asyncIterator]() {
      const chunks = raw ? [Buffer.from(raw)] : [];
      let i = 0;
      return { next: async () => (i < chunks.length ? { done: false as const, value: chunks[i++] } : { done: true as const, value: undefined }) };
    },
  };
  return req as unknown as IncomingMessage;
}
interface FakeRes { status: number; body: string; contentType: string | null; cookie: string; }
function makeRes(): { res: ServerResponse; fake: FakeRes } {
  const fake: FakeRes = { status: 200, body: "", contentType: null, cookie: "" };
  const res = {
    writeHead(status: number, headers?: Record<string, string | string[]>) {
      fake.status = status;
      const ct = headers?.["content-type"];
      fake.contentType = Array.isArray(ct) ? ct[0] : (ct ?? null);
      return res;
    },
    setHeader(name: string, value: unknown) { if (name.toLowerCase() === "set-cookie") fake.cookie = Array.isArray(value) ? String(value[0]) : String(value); return res; },
    end(chunk?: unknown) { if (chunk !== undefined) fake.body += String(chunk); return res; },
  } as unknown as ServerResponse;
  return { res, fake };
}
async function post(db: Db, path: string, body: unknown, cookie?: string): Promise<FakeRes> {
  const { res, fake } = makeRes();
  await apiHandler(makeReq("POST", path, { body, cookie }), res, db);
  return fake;
}
async function get(db: Db, path: string, cookie?: string): Promise<FakeRes> {
  const { res, fake } = makeRes();
  await apiHandler(makeReq("GET", path, { cookie }), res, db);
  return fake;
}
function json<T>(f: FakeRes): T { return JSON.parse(f.body) as T; }
function cookieFrom(f: FakeRes): string {
  const m = /runlocal_sid=([^;]+)/.exec(f.cookie);
  return m ? `runlocal_sid=${m[1]}` : "";
}
// ------------------------------------------------------------ fixtures
const KEY = "test-admin-key-123";
const EV = "event:ev1";
function seedEvent(db: Db): void {
  db.upsertContent({ id: EV, cityId: "columbia-mo", kind: "event", refId: "ev1", title: "Test Run", authorLabel: null, authorAccountId: null, featured: false, pinned: false, hidden: false, hiddenAt: null, archived: false, archivedAt: null });
}
async function signup(db: Db, email: string, name = "Runner"): Promise<{ id: string; cookie: string }> {
  const f = await post(db, "/api/accounts", { name, username: email.split("@")[0] + Math.random().toString(36).slice(2, 8), email, birthdate: "1998-05-05", cityId: "columbia-mo" });
  const body = json<{ account: { id: string } }>(f);
  const cookie = cookieFrom(f);
  db.updateAccount(body.account.id, { status: "verified", phase: "pending_review" });
  return { id: body.account.id, cookie };
}
function attend(db: Db, accountId: string, eventId: string, role: "rsvp" | "host" = "rsvp"): void {
  db.addAttendance({ id: `${accountId}-${eventId}-${role}`, accountId, eventId, role, createdAt: "2026-08-01T00:00:00.000Z" });
}
interface SharedRow { eventId: string; title: string; date: string; }

beforeEach(() => {
  process.env[ADMIN_KEY_VAR] = KEY;
  process.env[ADMIN_EMAIL_VAR] = "safety@runlocal.app";
});
afterEach(() => {
  delete process.env[ADMIN_KEY_VAR];
  delete process.env[ADMIN_EMAIL_VAR];
});

describe("GET /api/runners/:id/shared-events", () => {
  it("verified pair with a shared RSVP gets the event with public title and date", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const a = await signup(db, "rev@example.com");
    const b = await signup(db, "reviewee@example.com");
    await attend(db, a.id, EV);
    await attend(db, b.id, EV);
    const f = await get(db, `/api/runners/${b.id}/shared-events`, a.cookie);
    expect(f.status).toBe(200);
    expect(json<{ events: SharedRow[] }>(f).events).toEqual([{ eventId: "ev1", title: "Test Run", date: "2026-08-01" }]);
  });
  it("returns an empty list when the pair has never shared an event", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const a = await signup(db, "only@example.com");
    const b = await signup(db, "other@example.com");
    await attend(db, a.id, EV); // only the caller attended
    const f = await get(db, `/api/runners/${b.id}/shared-events`, a.cookie);
    expect(f.status).toBe(200);
    expect(json<{ events: SharedRow[] }>(f).events).toEqual([]);
  });
  it("host attendance counts as shared (host + RSVP mix)", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const host = await signup(db, "host@example.com");
    const runner = await signup(db, "runner@example.com");
    await attend(db, host.id, EV, "host");
    await attend(db, runner.id, EV, "rsvp");
    const f = await get(db, `/api/runners/${runner.id}/shared-events`, host.cookie);
    expect(f.status).toBe(200);
    expect(json<{ events: SharedRow[] }>(f).events).toEqual([{ eventId: "ev1", title: "Test Run", date: "2026-08-01" }]);
  });
  it("dedupes sibling occurrences (one row per event, most recent date) and uses TBD for unknown titles", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const a = await signup(db, "dup@example.com");
    const b = await signup(db, "duptarget@example.com");
    for (const accountId of [a.id, b.id]) {
      db.addAttendance({ id: `${accountId}-1`, accountId, eventId: EV, role: "rsvp", createdAt: "2026-08-01T00:00:00.000Z", occurrenceId: "event:ev1:2026-08-01", runDate: "2026-08-01", startsAt: "2026-08-01T12:00:00.000Z" });
      db.addAttendance({ id: `${accountId}-2`, accountId, eventId: EV, role: "rsvp", createdAt: "2026-08-08T00:00:00.000Z", occurrenceId: "event:ev1:2026-08-08", runDate: "2026-08-08", startsAt: "2026-08-08T12:00:00.000Z" });
      db.addAttendance({ id: `${accountId}-3`, accountId, eventId: "event:ghost-run", role: "rsvp", createdAt: "2026-07-01T00:00:00.000Z" });
    }
    const f = await get(db, `/api/runners/${b.id}/shared-events`, a.cookie);
    expect(f.status).toBe(200);
    expect(json<{ events: SharedRow[] }>(f).events).toEqual([
      { eventId: "ev1", title: "Test Run", date: "2026-08-08" },
      { eventId: "ghost-run", title: "TBD", date: "2026-07-01" },
    ]);
  });
  it("guests get 401 and unverified callers get 403", async () => {
    const db = createMemoryStore();
    const b = await signup(db, "target@example.com");
    const guest = await get(db, `/api/runners/${b.id}/shared-events`);
    expect(guest.status).toBe(401);
    const pendingF = await post(db, "/api/accounts", { name: "New", username: "pending" + Math.random().toString(36).slice(2, 8), email: "pending@example.com", birthdate: "1998-05-05", cityId: "columbia-mo" });
    const pendingCookie = cookieFrom(pendingF); // never verified
    const pending = await get(db, `/api/runners/${b.id}/shared-events`, pendingCookie);
    expect(pending.status).toBe(403);
    expect(json<{ error: string }>(pending).error).toBe("verified_runner_required");
  });
  it("unknown and deleted reviewees 404 identically", async () => {
    const db = createMemoryStore();
    const a = await signup(db, "caller@example.com");
    const gone = await signup(db, "gone@example.com");
    db.updateAccount(gone.id, { deletedAt: "2026-08-01T00:00:00.000Z" });
    const unknown = await get(db, `/api/runners/${"f".repeat(32)}/shared-events`, a.cookie);
    const deleted = await get(db, `/api/runners/${gone.id}/shared-events`, a.cookie);
    expect(unknown.status).toBe(404);
    expect(deleted.status).toBe(404);
    expect(json<{ error: string }>(unknown).error).toBe("not_found");
  });
  it("rejects unverified reviewees with an honest 403", async () => {
    const db = createMemoryStore();
    const a = await signup(db, "verified@example.com");
    const pendingF = await post(db, "/api/accounts", { name: "Pending", username: "pend" + Math.random().toString(36).slice(2, 8), email: "pend@example.com", birthdate: "1998-05-05", cityId: "columbia-mo" });
    const pendingId = json<{ account: { id: string } }>(pendingF).account.id;
    const f = await get(db, `/api/runners/${pendingId}/shared-events`, a.cookie);
    expect(f.status).toBe(403);
    expect(json<{ error: string; message: string }>(f)).toMatchObject({ error: "verified_runner_required", message: "You can only share feedback with verified runners." });
  });
  it("payload exposes only eventId/title/date — never identities or attendance history", async () => {
    const db = createMemoryStore();
    seedEvent(db);
    const a = await signup(db, "priv@example.com");
    const b = await signup(db, "privtarget@example.com");
    await attend(db, a.id, EV);
    await attend(db, b.id, EV);
    const f = await get(db, `/api/runners/${b.id}/shared-events`, a.cookie);
    const events = json<{ events: Record<string, unknown>[] }>(f).events;
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]).sort()).toEqual(["date", "eventId", "title"]);
    expect(f.body).not.toContain("priv@example.com");
    expect(f.body).not.toContain("privtarget@example.com");
    expect(f.body).not.toContain("occurrenceId");
    expect(f.body).not.toContain("createdAt");
  });
});
