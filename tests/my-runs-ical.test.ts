import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { Db, createMemoryStore } from "../src/server/store";
import { seedContentRegistry } from "../src/server/contentSeed";
import { materializeSeedEvents } from "../src/server/events";
import { CITIES } from "../src/data/cities";
import type { PersonalRunRecord } from "../src/server/types";
import { PERSONAL_RUN_CONSENT_VERSION } from "../src/server/types";
import { buildMyRunsIcs, escapeIcalText, foldIcalText, myRunsIcsFilename, toIcalDateTime } from "../src/server/ical";

/**
 * TIMEZONE ASSUMPTION (test-locked): Kimbio stores run start times as the
 * local wall-clock labels the app displays (e.g. "6:00 PM"), encoded in UTC
 * fields. The ICS export emits those wall-clock values as FLOATING local times
 * (no `Z`, no `TZID`) so Google/Outlook/Apple render the same wall-clock time
 * the app shows. These tests assert that contract so a future timezone-aware
 * change is a deliberate decision, not an accident.
 */

function req(method: string, path: string, cookie?: string, body?: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = { "x-forwarded-proto": "https" };
  if (cookie) headers.cookie = cookie;
  if (raw) headers["content-type"] = "application/json";
  let sent = false;
  return { method, url: path, headers, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]() { return { next: async () => sent ? { done: true as const, value: undefined } : (sent = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
function response() {
  const out = { status: 0, body: "", contentType: "", disposition: "" };
  const res = { writeHead(s: number, h?: Record<string, string | string[]>) { out.status = s; if (h) { const ct = h["content-type"]; out.contentType = Array.isArray(ct) ? ct[0] ?? "" : ct ?? ""; const cd = h["content-disposition"]; out.disposition = Array.isArray(cd) ? cd[0] ?? "" : cd ?? ""; } return res; }, end(v?: unknown) { if (v !== undefined) out.body += String(v); return res; } } as unknown as ServerResponse;
  return { res, out };
}
async function call(db: Db, method: string, path: string, cookie?: string, body?: unknown) { const { res, out } = response(); await apiHandler(req(method, path, cookie, body), res, db); return out; }
async function verified(db: Db, email: string) { const a = db.createAccount({ name: email, email, cityId: "columbia-mo" }); db.updateAccount(a.id, { status: "verified", verifiedAt: new Date().toISOString() }); const s = db.createSession(a.id, "127.0.0.1"); return { account: a, cookie: `runlocal_sid=${s.id}` }; }
function seeded(db: Db) { seedContentRegistry(db); materializeSeedEvents(db, CITIES); return db; }
function mondayOf(date: Date): string { const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number): string { const d = new Date(`${date}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
const pastMonday = addDays(mondayOf(new Date()), -7);
const upcomingMonday = addDays(mondayOf(new Date()), 7);
const icsDate = (date: string) => date.replace(/-/g, "");

function addSoloRun(db: Db, accountId: string, title: string, startsAt: string): PersonalRunRecord {
  const now = new Date().toISOString();
  const r: PersonalRunRecord = { id: `solo-${title.replace(/\s+/g, "-").toLowerCase()}`, accountId, cityId: "columbia-mo", title, startsAt, locationLabel: "Stephens Lake", distanceLabel: null, notes: null, visibility: "private", consentVersion: PERSONAL_RUN_CONSENT_VERSION, consentedAt: now, createdAt: now, updatedAt: now, deletedAt: null };
  db.addPersonalRun(r);
  return r;
}

describe("iCalendar generation (RFC 5545)", () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const run: Parameters<typeof buildMyRunsIcs>[0][number] = { id: "row-1", kind: "rsvp", title: "Monday social run", startsAt: "2026-08-10T18:00:00.000Z", location: "Downtown Columbia, MO" };

  it("escapes backslashes, semicolons, commas, and newlines in TEXT values", () => {
    expect(escapeIcalText(`Run, "Sun"; 5K \\ trail`)).toBe(`Run\\, "Sun"\\; 5K \\\\ trail`);
    expect(escapeIcalText("line1\nline2\r\nline3")).toBe("line1\\nline2\\nline3");
    expect(escapeIcalText("plain")).toBe("plain");
  });

  it("formats UTC instants as floating YYYYMMDDTHHMMSS local times (no Z, no TZID)", () => {
    expect(toIcalDateTime("2026-08-10T18:00:00.000Z")).toBe("20260810T180000");
    expect(toIcalDateTime("2026-08-10T00:05:00.000Z")).toBe("20260810T000500");
    expect(toIcalDateTime("2026-12-31T23:59:59.000Z")).toBe("20261231T235959");
    expect(toIcalDateTime("not-a-date")).toBe("");
  });

  it("builds a complete VCALENDAR with CRLF line endings and stable UIDs", () => {
    const ics = buildMyRunsIcs([run], now);
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("VERSION:2.0\r\n");
    expect(ics).toContain("PRODID:-//Kimbio//My Runs//EN\r\n");
    expect(ics).toContain("CALSCALE:GREGORIAN\r\n");
    expect(ics).toContain("X-WR-CALNAME:Kimbio — My Runs\r\n");
    expect(ics).toContain("BEGIN:VEVENT\r\n");
    expect(ics).toContain("UID:myrun-row-1@runlocal\r\n");
    expect(ics).toContain("DTSTAMP:20260809T120000Z\r\n"); // DTSTAMP is always UTC
    expect(ics).toContain("DTSTART:20260810T180000\r\n");
    expect(ics).toContain("DTEND:20260810T190000\r\n"); // +60 min default duration
    expect(ics).toContain("SUMMARY:Monday social run\r\n");
    expect(ics).toContain("LOCATION:Downtown Columbia\\, MO\r\n"); // comma escaped per RFC 5545
    expect(ics).toContain("DESCRIPTION:Added from Kimbio. Private RSVP for this occurrence.\r\n");
    expect(ics).toContain("CLASS:PRIVATE\r\n");
    expect(ics).toContain("END:VEVENT\r\nEND:VCALENDAR\r\n");
  });

  it("locks the timezone assumption: DTSTART/DTEND are floating local times, never UTC or TZID", () => {
    const ics = buildMyRunsIcs([run], now);
    expect(ics).not.toContain("TZID");
    expect(ics).not.toContain("DTSTART:20260810T180000Z");
    expect(ics).not.toContain("DTEND:20260810T190000Z");
    expect(ics).toMatch(/DTSTART:20260810T180000\r\n/);
    expect(ics).toMatch(/DTEND:20260810T190000\r\n/);
  });

  it("escapes user-supplied title/location text through the builder", () => {
    const ics = buildMyRunsIcs([{ id: "r", kind: "rsvp", title: `Tempo, hills; "fun" \\ race`, startsAt: "2026-08-10T18:00:00.000Z", location: "A, B; C \\ D\nE" }], now);
    expect(ics).toContain("SUMMARY:Tempo\\, hills\\; \"fun\" \\\\ race\r\n");
    expect(ics).toContain("LOCATION:A\\, B\\; C \\\\ D\\nE\r\n");
  });

  it("folds long lines at 75 octets with RFC 5545 continuations", () => {
    const long = "x".repeat(200);
    const folded = foldIcalText(`LOCATION:${long}\r\n`);
    expect(folded).toContain("\r\n ");
    for (const line of folded.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    // Unfolding reconstructs the original value exactly.
    expect(folded.replace(/\r\n /g, "")).toBe(`LOCATION:${long}\r\n`);
  });

  it("emits a valid empty calendar and skips rows without a start time", () => {
    const empty = buildMyRunsIcs([], now);
    expect(empty).toContain("BEGIN:VCALENDAR\r\n");
    expect(empty).toContain("END:VCALENDAR\r\n");
    expect(empty).not.toContain("BEGIN:VEVENT");
    const skipped = buildMyRunsIcs([{ id: "bad", kind: "rsvp", title: "No time", startsAt: null, location: "" }], now);
    expect(skipped).not.toContain("myrun-bad@runlocal");
  });

  it("marks solo runs with their own private description and floating time", () => {
    const ics = buildMyRunsIcs([{ id: "solo-1", kind: "solo", title: "Easy jog", startsAt: "2026-08-11T06:05:00.000Z", location: "Stephens Lake" }], now);
    expect(ics).toContain("DESCRIPTION:Added from Kimbio. Private solo run.\r\n");
    expect(ics).toContain("DTSTART:20260811T060500\r\n");
    expect(ics).toContain("DTEND:20260811T070500\r\n");
  });

  it("derives a date-stamped, ASCII-safe download filename from the LOCAL wall-clock date", () => {
    // Local-time constructor so the expectation is timezone-independent.
    expect(myRunsIcsFilename(new Date(2026, 7, 9, 12, 0, 0))).toBe("runlocal-my-runs-2026-08-09.ics");
    expect(myRunsIcsFilename(new Date(2026, 0, 5, 23, 59, 59))).toBe("runlocal-my-runs-2026-01-05.ics");
    // Matches the pattern the API's Content-Disposition and the UI download name use.
    expect(myRunsIcsFilename()).toMatch(/^runlocal-my-runs-\d{4}-\d{2}-\d{2}\.ics$/);
  });
});

describe("private My Runs ICS API", () => {
  it("denies guests and pending callers with the same auth contract as /api/my/runs", async () => {
    const db = seeded(createMemoryStore());
    const guest = await call(db, "GET", "/api/my/runs/ical");
    expect(guest.status).toBe(401);
    expect(JSON.parse(guest.body)).toMatchObject({ error: "sign_in_required" });
    const pending = db.createAccount({ name: "p", email: "p@example.com", cityId: "columbia-mo" });
    const sp = db.createSession(pending.id, "127.0.0.1");
    const blocked = await call(db, "GET", "/api/my/runs/ical", `runlocal_sid=${sp.id}`);
    expect(blocked.status).toBe(403);
    expect(JSON.parse(blocked.body)).toMatchObject({ error: "verified_runner_required" });
  });

  it("serves text/calendar as a no-store attachment for a verified caller", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: upcomingMonday });
    const out = await call(db, "GET", "/api/my/runs/ical", me.cookie);
    expect(out.status).toBe(200);
    expect(out.contentType).toContain("text/calendar");
    expect(out.disposition).toContain("attachment");
    expect(out.disposition).toMatch(/filename="runlocal-my-runs-\d{4}-\d{2}-\d{2}\.ics"/);
  });

  it("exports only the caller's UPCOMING occurrences — never past rows, even when kept/checked in", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: pastMonday });
    await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: upcomingMonday });
    const pastRow = db.listAttendance(me.account.id).find((a) => a.runDate === pastMonday)!;
    const upcomingRow = db.listAttendance(me.account.id).find((a) => a.runDate === upcomingMonday)!;
    // Keep the past row so it IS in the My Runs list — but never in the export.
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: pastRow.id, kept: true })).status).toBe(200);
    const runs = JSON.parse((await call(db, "GET", "/api/my/runs", me.cookie)).body).runs as Array<{ id: string }>;
    expect(runs).toHaveLength(2);
    const out = await call(db, "GET", "/api/my/runs/ical", me.cookie);
    expect(out.status).toBe(200);
    expect((out.body.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect(out.body).toContain(`UID:myrun-${upcomingRow.id}@runlocal`);
    expect(out.body).not.toContain(`UID:myrun-${pastRow.id}@runlocal`);
    expect(out.body).toContain(`DTSTART:${icsDate(upcomingMonday)}T180000`);
    expect(out.body).not.toContain(`DTSTART:${icsDate(pastMonday)}T180000`);
  });

  it("isolates callers: another runner's RSVPs never appear in my export", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    const other = await verified(db, "other@example.com");
    await call(db, "POST", "/api/events/rsvp", other.cookie, { eventId: "mon-social", runDate: upcomingMonday });
    addSoloRun(db, other.account.id, "Other secret solo", `${upcomingMonday}T06:00:00.000Z`);
    const out = await call(db, "GET", "/api/my/runs/ical", me.cookie);
    expect(out.status).toBe(200);
    expect(out.body).not.toContain("Other secret solo");
    expect(out.body).not.toContain("BEGIN:VEVENT");
    expect(out.body).toContain("END:VCALENDAR\r\n");
  });

  it("returns a valid empty calendar for a verified caller with no upcoming runs", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    const out = await call(db, "GET", "/api/my/runs/ical", me.cookie);
    expect(out.status).toBe(200);
    expect(out.contentType).toContain("text/calendar");
    expect(out.body).toContain("BEGIN:VCALENDAR\r\n");
    expect(out.body).toContain("END:VCALENDAR\r\n");
    expect(out.body).not.toContain("BEGIN:VEVENT");
  });

  it("includes upcoming solo runs with floating times and the solo description", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    addSoloRun(db, me.account.id, "Easy jog", `${upcomingMonday}T06:05:00.000Z`);
    const out = await call(db, "GET", "/api/my/runs/ical", me.cookie);
    expect(out.status).toBe(200);
    expect(out.body).toContain(`DTSTART:${icsDate(upcomingMonday)}T060500`);
    expect(out.body).toContain(`DTEND:${icsDate(upcomingMonday)}T070500`);
    expect(out.body).toContain("DESCRIPTION:Added from Kimbio. Private solo run.\r\n");
  });
});
