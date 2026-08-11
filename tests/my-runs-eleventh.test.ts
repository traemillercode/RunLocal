/**
 * Regression: "Add to My Runs fails for the run dated the 11th".
 *
 * Owner report: RSVP works generally, but a recurring run occurrence dated the
 * 11th never appears in My Runs after a same-day RSVP.
 *
 * Root cause (reproduced against data/db.json): run start times are stored as
 * UTC-encoded wall-clock labels (`startsAt` = "2026-08-11T18:00:00.000Z" for a
 * 6:00 PM run), while the feed decides "has this run started" with the
 * BROWSER's local clock. For a Columbia runner (America/Chicago, UTC-5) the
 * feed still shows "Tuesday Night Track — Aug 11, 6:00 PM" as upcoming at
 * 4:41 PM local, but the server classified the persisted row PAST at 18:00Z
 * (13:00 local) and the past-visibility rule hid it — the RSVP "succeeded"
 * and the run vanished. The same happened for every run on its own day inside
 * the UTC-label → local-time window.
 *
 * Fix: the client sends its `getTimezoneOffset()` minutes with My Runs reads
 * (and the ICS export), and the server restores the label to the real local
 * instant before classifying upcoming/past — matching the feed, the My Runs
 * ordering, and the runner's own clock. Absent/invalid offsets fall back to
 * the previous UTC-frame behavior. Separately, the event detail page derives
 * the occurrence's `YYYY-MM-DD` label from the local wall clock (not the
 * UTC-shifted ISO date), so an occurrence dated the 11th stays the 11th for
 * runners east of UTC too (and a month-boundary Sep 1 never becomes Aug 31).
 */
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CITIES } from "../src/data/cities";
import { materializeSeedEvents } from "../src/server/events";
import { listMyRuns, parseTzOffsetMinutes } from "../src/server/myRuns";
import { resolveOccurrence } from "../src/server/occurrences";
import { createMemoryStore, Db } from "../src/server/store";
import { seedContentRegistry } from "../src/server/contentSeed";
import { apiHandler } from "../src/server/api";
import { localDateLabel } from "../src/lib/dates";

/** tue-track = Tuesday Night Track, dayOfWeek 1 (Tue), 6:00 PM → 18:00Z label. */
const TUESDAY_EVENT_ID = "tue-track";
/** The exact persisted row from data/db.json (created 2026-08-11T21:41Z). */
const ACCOUNT_ID = "d5116426937b7b6c37724b023f7db9bb";
/** Real moment the owner's row was persisted: 4:41 PM CDT — 1h19m before 6 PM local. */
const ROW_CREATED_AT = new Date("2026-08-11T21:41:00.000Z");
/** Columbia, MO in August = America/Chicago = UTC-5 → getTimezoneOffset() 300. */
const COLUMBIA_OFFSET = 300;

function seeded() {
  const db = createMemoryStore();
  seedContentRegistry(db);
  materializeSeedEvents(db, CITIES);
  return db;
}

/** Persist the tue-track 2026-08-11 attendance row exactly as the RSVP API
 * does: canonical event id from the materialized seed copy, UTC-encoded
 * wall-clock startsAt label. */
function addEleventhAttendance(db: Db) {
  const ev = db.listEvents().find((e) => e.seedRefId === TUESDAY_EVENT_ID);
  if (!ev) throw new Error("tue-track seed event missing");
  db.addAttendance({
    id: "98d93c668c7e43eba509e96fbfa1a876",
    accountId: ACCOUNT_ID,
    eventId: `event:${ev.id}`,
    role: "rsvp",
    createdAt: ROW_CREATED_AT.toISOString(),
    occurrenceId: `event:${ev.id}:2026-08-11`,
    runDate: "2026-08-11",
    startsAt: "2026-08-11T18:00:00.000Z",
  });
}

describe("parseTzOffsetMinutes — clamping and fallback", () => {
  it("parses numbers/strings, clamps to ±14h, and falls back to 0", () => {
    expect(parseTzOffsetMinutes(300)).toBe(300);
    expect(parseTzOffsetMinutes("300")).toBe(300);
    expect(parseTzOffsetMinutes(null)).toBe(0);
    expect(parseTzOffsetMinutes(undefined)).toBe(0);
    expect(parseTzOffsetMinutes("nonsense")).toBe(0);
    expect(parseTzOffsetMinutes(10_000)).toBe(840);
    expect(parseTzOffsetMinutes(-10_000)).toBe(-840);
  });
});

describe("recurring run occurrence dated the 11th — same-day RSVP must show in My Runs", () => {
  it("returns the 8/11 tue-track row as upcoming for a Columbia runner (offset 300)", () => {
    const db = seeded();
    addEleventhAttendance(db);
    const rows = listMyRuns(db, ACCOUNT_ID, "columbia-mo", ROW_CREATED_AT, COLUMBIA_OFFSET);
    const row = rows.find((r) => r.occurrenceId === `event:tue-track:2026-08-11`);
    expect(row).toBeDefined();
    expect(row?.upcoming).toBe(true);
    expect(row?.past).toBe(false);
    expect(row?.date).toBe("2026-08-11");
  });

  it("keeps the previous UTC-frame behavior when no offset is supplied", () => {
    const db = seeded();
    addEleventhAttendance(db);
    // No offset → the UTC-encoded label (18:00Z) is already past at 21:41Z, so
    // the row is hidden exactly as before this fix (offset-less clients).
    expect(listMyRuns(db, ACCOUNT_ID, "columbia-mo", ROW_CREATED_AT)).toEqual([]);
  });

  it("hides the row once the run's LOCAL start time has passed (past-visibility intact)", () => {
    const db = seeded();
    addEleventhAttendance(db);
    // 6:30 PM CDT = 23:30Z: 6:00 PM local has passed → past → hidden (not kept).
    const afterStart = new Date("2026-08-11T23:30:00.000Z");
    expect(listMyRuns(db, ACCOUNT_ID, "columbia-mo", afterStart, COLUMBIA_OFFSET)).toEqual([]);
    // Keeping it preserves it (exact row, existing rule unchanged).
    db.updateAttendance("98d93c668c7e43eba509e96fbfa1a876", { kept: true });
    const kept = listMyRuns(db, ACCOUNT_ID, "columbia-mo", afterStart, COLUMBIA_OFFSET);
    expect(kept.map((r) => r.occurrenceId)).toEqual([`event:tue-track:2026-08-11`]);
    expect(kept[0].past).toBe(true);
  });

  it("frames the boundary by the caller's offset, not a fixed constant", () => {
    const db = seeded();
    addEleventhAttendance(db);
    // A UTC+2 caller sees the same 6:00 PM label as 16:00Z: at 21:41Z it is
    // long past → hidden (correct for that runner's local clock).
    expect(listMyRuns(db, ACCOUNT_ID, "columbia-mo", ROW_CREATED_AT, -120)).toEqual([]);
  });
});

describe("event detail date label — local wall clock, never UTC-shifted", () => {
  it("keeps an occurrence dated the 11th on the 11th (and Sep 1 on Sep 1)", () => {
    // dateForWeekday builds LOCAL-midnight dates; the local getters are stable
    // in every process timezone, so these assertions are deterministic.
    expect(localDateLabel(new Date(2026, 7, 11))).toBe("2026-08-11");
    expect(localDateLabel(new Date(2026, 8, 1))).toBe("2026-09-01");
    // The old expression shifted the label for east-of-UTC runners:
    // new Date(2026,7,11).toISOString() is 2026-08-10T22:00:00Z in UTC+2.
  });

  it("resolves the server occurrence for the fixed label, and rejects the shifted one", () => {
    const db = seeded();
    // 2026-08-11 is a Tuesday: the local wall-clock label resolves to the
    // exact occurrence (canonical occurrenceId, 18:00Z wall-clock start).
    const occ = resolveOccurrence(db, TUESDAY_EVENT_ID, "2026-08-11");
    expect(occ).not.toBeNull();
    expect(occ?.runDate).toBe("2026-08-11");
    expect(occ?.startsAt).toBe("2026-08-11T18:00:00.000Z");
    // The previous-day label (what the old UTC-shifted code sent for runners
    // east of UTC) is a Monday — the server correctly rejects it.
    expect(resolveOccurrence(db, TUESDAY_EVENT_ID, "2026-08-10")).toBeNull();
    // Month-boundary occurrence (2026-09-01 is also a Tuesday) resolves too.
    const sep = resolveOccurrence(db, TUESDAY_EVENT_ID, "2026-09-01");
    expect(sep).not.toBeNull();
    expect(sep?.runDate).toBe("2026-09-01");
  });
});

// ---- API-level plumbing: the offset param flows through the RSVP + My Runs reads.
function req(method: string, path: string, cookie?: string, body?: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = { "x-forwarded-proto": "https" };
  if (cookie) headers.cookie = cookie;
  if (raw) headers["content-type"] = "application/json";
  let sent = false;
  return { method, url: path, headers, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]() { return { next: async () => sent ? { done: true as const, value: undefined } : (sent = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
function response() { const out = { status: 0, body: "" }; const res = { writeHead(s: number) { out.status = s; return res; }, setHeader() { return res; }, end(v?: unknown) { if (v !== undefined) out.body += String(v); return res; } } as unknown as ServerResponse; return { res, out }; }
async function call(db: Db, method: string, path: string, cookie?: string, body?: unknown) { const { res, out } = response(); await apiHandler(req(method, path, cookie, body), res, db); return out; }
async function verified(db: Db, email: string) { const a = db.createAccount({ name: email, email, cityId: "columbia-mo" }); db.updateAccount(a.id, { status: "verified", verifiedAt: new Date().toISOString() }); const s = db.createSession(a.id, "127.0.0.1"); return { account: a, cookie: `runlocal_sid=${s.id}` }; }
function mondayOf(date: Date): string { const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number): string { const d = new Date(`${date}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
const upcomingMonday = addDays(mondayOf(new Date()), 7);

describe("API plumbing — tzOffsetMinutes on My Runs reads", () => {
  it("RSVP + GET with the offset returns the occurrence, including for a row the UTC frame would hide", async () => {
    const db = seeded();
    const me = await verified(db, "eleventh@example.com");
    const rsvp = await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: upcomingMonday });
    expect(rsvp.status).toBe(200);
    const out = await call(db, "GET", `/api/my/runs?tzOffsetMinutes=300`, me.cookie);
    expect(out.status).toBe(200);
    const runs = JSON.parse(out.body).runs as Array<{ occurrenceId: string; upcoming: boolean }>;
    expect(runs.map((r) => r.occurrenceId)).toContain(`event:mon-social:${upcomingMonday}`);
    // Invalid offset values fall back to the UTC frame and never error.
    const fallback = await call(db, "GET", "/api/my/runs?tzOffsetMinutes=not-a-number", me.cookie);
    expect(fallback.status).toBe(200);
    expect((JSON.parse(fallback.body).runs as unknown[]).length).toBe(1);
    // The ICS export accepts the same param and includes the upcoming row.
    const ics = await call(db, "GET", `/api/my/runs/ical?tzOffsetMinutes=300`, me.cookie);
    expect(ics.status).toBe(200);
    expect(ics.body).toContain(`DTSTART:${upcomingMonday.replace(/-/g, "")}T180000`);
  });
});
