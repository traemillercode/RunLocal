import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { Db, createMemoryStore } from "../src/server/store";
import { seedContentRegistry } from "../src/server/contentSeed";
import { materializeSeedEvents } from "../src/server/events";
import { CITIES } from "../src/data/cities";
import type { PersonalRunRecord } from "../src/server/types";
import { PERSONAL_RUN_CONSENT_VERSION } from "../src/server/types";

function req(method: string, path: string, cookie?: string, body?: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = { "x-forwarded-proto": "https" };
  if (cookie) headers.cookie = cookie;
  if (raw) headers["content-type"] = "application/json";
  let sent = false;
  return { method, url: path, headers, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]() { return { next: async () => sent ? { done: true as const, value: undefined } : (sent = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
function response() { const out = { status: 0, body: "", cookie: "" }; const res = { writeHead(s: number, h?: Record<string, string | string[]>) { out.status = s; const c = h?.["set-cookie"]; out.cookie = Array.isArray(c) ? c[0] ?? "" : c ?? ""; return res; }, setHeader(n: string, v: string | string[]) { if (n.toLowerCase() === "set-cookie") out.cookie = Array.isArray(v) ? v[0] ?? "" : v; return res; }, end(v?: unknown) { if (v !== undefined) out.body += String(v); return res; } } as unknown as ServerResponse; return { res, out }; }
async function call(db: Db, method: string, path: string, cookie?: string, body?: unknown) { const { res, out } = response(); await apiHandler(req(method, path, cookie, body), res, db); return out; }
async function verified(db: Db, email: string) { const a = db.createAccount({ name: email, email, cityId: "columbia-mo" }); db.updateAccount(a.id, { status: "verified", verifiedAt: new Date().toISOString() }); const s = db.createSession(a.id, "127.0.0.1"); return { account: a, cookie: `runlocal_sid=${s.id}` }; }
function payload(out: { body: string }) { return JSON.parse(out.body) as { error?: string; runs?: Array<Record<string, unknown>>; rsvped?: boolean; kept?: boolean }; }
/** A real seeded Db exactly like serve.ts: moderation registry + materialized events. */
function seeded(db: Db) { seedContentRegistry(db); materializeSeedEvents(db, CITIES); return db; }
/** Disk-backed Db: load first (matches serve.ts), then seed. */
async function seededDisk(dir: string) { const db = new Db({ dataDir: dir }); await db.load(); return seeded(db); }
/** Monday (UTC) on/before the given date, as YYYY-MM-DD. */
function mondayOf(date: Date): string { const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); }
function addDays(date: string, days: number): string { const d = new Date(`${date}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
/** A Monday guaranteed to be in the past and one guaranteed to be upcoming. */
const pastMonday = addDays(mondayOf(new Date()), -7);
const upcomingMonday = addDays(mondayOf(new Date()), 7);

/** Add a personal (solo) run directly to the store, like the API would. */
function addSoloRun(db: Db, accountId: string, title: string, startsAt: string, distanceLabel: string | null = null): PersonalRunRecord {
  const now = new Date().toISOString();
  const r: PersonalRunRecord = { id: `solo-${title.replace(/\s+/g, "-").toLowerCase()}`, accountId, cityId: "columbia-mo", title, startsAt, locationLabel: "Stephens Lake", distanceLabel, notes: null, visibility: "private", consentVersion: PERSONAL_RUN_CONSENT_VERSION, consentedAt: now, createdAt: now, updatedAt: now, deletedAt: null };
  db.addPersonalRun(r);
  return r;
}

describe("private My Runs API", () => {
  it("denies guests and pending/unverified callers", async () => { const db = seeded(createMemoryStore()); expect((await call(db, "GET", "/api/my/runs")).status).toBe(401); expect((await call(db, "POST", "/api/my/runs/keep", undefined, { runId: "x", kept: true })).status).toBe(401); const pending = db.createAccount({ name: "p", email: "p@example.com", cityId: "columbia-mo" }); const s = db.createSession(pending.id, "127.0.0.1"); const out = await call(db, "GET", "/api/my/runs", `runlocal_sid=${s.id}`); expect(out.status).toBe(403); expect(payload(out).error).toBe("verified_runner_required"); expect((await call(db, "POST", "/api/my/runs/keep", `runlocal_sid=${s.id}`, { runId: "x", kept: true })).status).toBe(403); });
  it("surfaces DISPLAY-space ids from the RSVP API and My Runs so feed/detail state survives tab switches", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    // RSVP with the SEED (bare) id — exactly what the weekly feed passes.
    const rsvp = await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: upcomingMonday });
    expect(rsvp.status).toBe(200);
    const body = JSON.parse(rsvp.body) as { rsvped: boolean; occurrenceId: string; runDate: string };
    expect(body.rsvped).toBe(true);
    // Seed events surface the SEED id (the feed renders "mon-social"), NOT the
    // server's canonical hex id — the client can compare verbatim after any
    // reload or tab switch.
    expect(body.occurrenceId).toBe(`event:mon-social:${upcomingMonday}`);
    expect(body.runDate).toBe(upcomingMonday);
    // My Runs returns the same display-space event id + exact occurrenceId.
    const runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    const mine = runs.find((r) => r.eventId === "mon-social")!;
    expect(mine).toBeTruthy();
    expect(mine.occurrenceId).toBe(`event:mon-social:${upcomingMonday}`);
    expect(mine.date).toBe(upcomingMonday);
    // The discussion endpoint accepts the display-space occurrence id and the
    // RSVP'd runner can read the occurrence discussion (exact occurrence only).
    const event = db.listEvents().find((e) => e.seedRefId === "mon-social")!;
    const discussion = await call(db, "GET", `/api/events/mon-social/occurrences/${encodeURIComponent(`event:mon-social:${upcomingMonday}`)}/discussion`, me.cookie);
    expect(discussion.status).toBe(200);
    // A sibling occurrence of the same event is NOT accessible (exact-occurrence privacy).
    const sibling = await call(db, "GET", `/api/events/mon-social/occurrences/${encodeURIComponent(`event:mon-social:${addDays(upcomingMonday, 7)}`)}/discussion`, me.cookie);
    expect(sibling.status).toBe(403);
    // The canonical hex spelling still works too.
    const canonical = await call(db, "GET", `/api/events/${event.id}/occurrences/${encodeURIComponent(`event:${event.id}:${upcomingMonday}`)}/discussion`, me.cookie);
    expect(canonical.status).toBe(200);
  });
it("isolates accounts and ignores accountId/query manipulation", async () => { const db = seeded(createMemoryStore()); const one = await verified(db, "one@example.com"); const two = await verified(db, "two@example.com"); await call(db, "POST", "/api/events/rsvp", one.cookie, { eventId: "mon-social", runDate: upcomingMonday }); const out = await call(db, "GET", "/api/my/runs?accountId=" + two.account.id, two.cookie); expect(out.status).toBe(200); expect(payload(out).runs).toEqual([]); expect(JSON.stringify(payload(await call(db, "GET", "/api/my/runs", one.cookie)))).not.toContain(two.account.id); });
  it("supports duplicate/idempotent RSVP, persistence roundtrip, and caller-only removal", async () => { const dir = await mkdtemp(join(tmpdir(), "runlocal-my-runs-")); try { const db = await seededDisk(dir); const one = await verified(db, "one@example.com"); const other = await verified(db, "other@example.com"); const first = await call(db, "POST", "/api/events/rsvp", one.cookie, { eventId: "mon-social" }); const second = await call(db, "POST", "/api/events/rsvp", one.cookie, { eventId: "event:mon-social" }); expect(first.status).toBe(200); expect(second.status).toBe(200); expect(db.listAttendance(one.account.id).filter((a) => a.role === "rsvp")).toHaveLength(1); db.addAttendance({ id: "host-record", accountId: one.account.id, eventId: "event:mon-social", role: "host", createdAt: new Date().toISOString() }); db.addAttendance({ id: "other-rsvp", accountId: other.account.id, eventId: "event:mon-social", role: "rsvp", createdAt: new Date().toISOString() }); await db.persist(); const loaded = await seededDisk(dir); expect(loaded.listAttendance(one.account.id)).toHaveLength(2); const removed = await call(loaded, "POST", "/api/events/rsvp", one.cookie, { eventId: "mon-social", rsvp: false }); expect(removed.status).toBe(200); expect(loaded.listAttendance(one.account.id).map((a) => a.role)).toEqual(["host"]); expect(loaded.listAttendance(other.account.id)).toHaveLength(1); const runs = payload(await call(loaded, "GET", "/api/my/runs", one.cookie)).runs ?? []; expect(runs).toEqual([]); } finally { await rm(dir, { recursive: true, force: true }); } });

  it("removes exactly one occurrence, preserving sibling occurrences and host rows", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    // Two consecutive Mondays: the first is guaranteed past, the second upcoming.
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: pastMonday })).status).toBe(200);
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: upcomingMonday })).status).toBe(200);
    // The past occurrence would be hidden by the past-visibility rule; keep it
    // so the removal contract can assert on both occurrences.
    const pastRow = db.listAttendance(me.account.id).find((a) => a.runDate === pastMonday)!;
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: pastRow.id, kept: true })).status).toBe(200);
    const before = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(before).toHaveLength(2);
    expect(before.map((r) => r.occurrenceId).sort()).toEqual([`event:mon-social:${pastMonday}`, `event:mon-social:${upcomingMonday}`].sort());
    const first = before.find((r) => r.date === pastMonday)!;
    const removed = await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: first.eventId, runDate: pastMonday, rsvp: false, runId: first.id });
    expect(removed.status).toBe(200);
    expect(payload(removed).rsvped).toBe(false);
    const remaining = db.listAttendance(me.account.id).filter((a) => a.role === "rsvp");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].runDate).toBe(upcomingMonday);
    const after = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(after).toHaveLength(1);
    expect(after[0].date).toBe(upcomingMonday);
    expect(after[0].occurrenceId).toBe(`event:mon-social:${upcomingMonday}`);
    // date-based removal of the remaining occurrence leaves zero RSVPs
    const last = await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: upcomingMonday, rsvp: false });
    expect(last.status).toBe(200);
    expect(db.listAttendance(me.account.id).filter((a) => a.role === "rsvp")).toHaveLength(0);
  });

  it("keeps RSVPs across re-login (new session) and a server reload from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runlocal-relogin-")); try {
      const db = await seededDisk(dir);
      const me = await verified(db, "me@example.com");
      expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: upcomingMonday })).status).toBe(200);
      // Re-login: the old session is revoked and a fresh one is issued; the
      // RSVP is server-authoritative (keyed to the account, not the session).
      db.deleteSessionsForAccount(me.account.id);
      const s2 = db.createSession(me.account.id, "127.0.0.1");
      const relogin = payload(await call(db, "GET", "/api/my/runs", `runlocal_sid=${s2.id}`));
      expect(relogin.error).toBeUndefined();
      expect(relogin.runs).toHaveLength(1);
      expect(relogin.runs![0].date).toBe(upcomingMonday);
      await db.persist();
      // Server restart: a brand-new Db instance reloads the same data dir.
      const loaded = await seededDisk(dir);
      const s3 = loaded.createSession(me.account.id, "127.0.0.1");
      const afterReload = payload(await call(loaded, "GET", "/api/my/runs", `runlocal_sid=${s3.id}`));
      expect(afterReload.error).toBeUndefined();
      expect(afterReload.runs).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("removes legacy rows by attendance id idempotently and never another caller's row", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com"); const other = await verified(db, "other@example.com");
    // Legacy pre-occurrence rows: no occurrenceId/runDate, registry-style eventId.
    db.addAttendance({ id: "legacy-me", accountId: me.account.id, eventId: "event:mon-social", role: "rsvp", createdAt: "2026-01-05T00:00:00.000Z", kept: true });
    db.addAttendance({ id: "legacy-other", accountId: other.account.id, eventId: "event:mon-social", role: "rsvp", createdAt: "2026-01-05T00:00:00.000Z" });
    const runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("legacy-me");
    // runId removal works even though the fallback date (createdAt) is not a
    // scheduled occurrence — the row itself is the authority.
    const rm = await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: runs[0].eventId, runDate: runs[0].date, rsvp: false, runId: runs[0].id });
    expect(rm.status).toBe(200);
    expect(db.listAttendance(me.account.id).filter((a) => a.role === "rsvp")).toHaveLength(0);
    expect(db.listAttendance(other.account.id)).toHaveLength(1);
    // Idempotent: removing the already-gone row is a no-op success.
    const again = await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", rsvp: false, runId: "legacy-me" });
    expect(again.status).toBe(200);
    // A runId belonging to another caller is never touched (idempotent no-op).
    const steal = await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", rsvp: false, runId: "legacy-other" });
    expect(steal.status).toBe(200);
    expect(db.listAttendance(other.account.id)).toHaveLength(1);
    // A runId pointing at a DIFFERENT event is rejected without side effects.
    db.addAttendance({ id: "live-me", accountId: me.account.id, eventId: "event:mon-social", role: "rsvp", createdAt: "2026-01-05T00:00:00.000Z", occurrenceId: `event:mon-social:${pastMonday}`, runDate: pastMonday, startsAt: `${pastMonday}T18:00:00.000Z`, kept: true });
    const wrong = await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "tue-track", runDate: addDays(pastMonday, 1), rsvp: false, runId: "live-me" });
    expect(wrong.status).toBe(400);
    expect(payload(wrong).error).toBe("invalid_run");
    expect(db.listAttendance(me.account.id).filter((a) => a.role === "rsvp")).toHaveLength(1);
  });

  it("returns clear errors and preserves state on a failed removal", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    expect((await call(db, "POST", "/api/events/rsvp", undefined, { eventId: "mon-social", runDate: pastMonday, rsvp: false })).status).toBe(401);
    const pending = db.createAccount({ name: "p", email: "p@example.com", cityId: "columbia-mo" });
    const sp = db.createSession(pending.id, "127.0.0.1");
    expect((await call(db, "POST", "/api/events/rsvp", `runlocal_sid=${sp.id}`, { eventId: "mon-social", runDate: pastMonday, rsvp: false })).status).toBe(403);
    const bad = await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: "2026-02-30", rsvp: false });
    expect(bad.status).toBe(400);
    expect(payload(bad).error).toBe("invalid_occurrence");
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: pastMonday })).status).toBe(200);
    expect(db.listAttendance(me.account.id).filter((a) => a.role === "rsvp")).toHaveLength(1);
    // A failed removal leaves the RSVP intact.
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: "2026-02-30", rsvp: false })).status).toBe(400);
    expect(db.listAttendance(me.account.id).filter((a) => a.role === "rsvp")).toHaveLength(1);
    // The past RSVP is hidden by default, so keep it to assert on the row.
    const row = db.listAttendance(me.account.id).find((a) => a.role === "rsvp")!;
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: row.id, kept: true })).status).toBe(200);
    const runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].occurrenceId).toContain(pastMonday);
  });

  it("shows past runs ONLY when checked in or kept; upcoming runs are always visible", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    // RSVP to one past and one upcoming occurrence of the same event.
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: pastMonday })).status).toBe(200);
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: upcomingMonday })).status).toBe(200);
    // Past + not checked in + not kept → hidden. Upcoming → visible.
    let runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].date).toBe(upcomingMonday);
    expect(runs[0].upcoming).toBe(true);
    expect(runs[0].past).toBe(false);
    expect(runs[0].checkedIn).toBe(false);
    expect(runs[0].kept).toBe(false);
    // Check-in makes the past occurrence visible, with the exact flag.
    const event = db.listEvents().find((e) => e.seedRefId === "mon-social")!;
    const pastAtt = db.listAttendance(me.account.id).find((a) => a.runDate === pastMonday)!;
    db.addCheckin({ id: "ci-1", eventId: `event:${event.id}`, occurrenceId: `event:${event.id}:${pastMonday}`, runDate: pastMonday, groupId: event.groupId, cityId: "columbia-mo", accountId: me.account.id, checkedInBy: me.account.id, checkedInAt: new Date().toISOString(), source: "leader" });
    runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(runs).toHaveLength(2);
    const pastRow = runs.find((r) => r.date === pastMonday)!;
    expect(pastRow.past).toBe(true);
    expect(pastRow.checkedIn).toBe(true);
    expect(pastRow.kept).toBe(false);
    // Kept also makes a past run visible (no check-in needed).
    db.removeCheckin("ci-1");
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: pastAtt.id, kept: true })).status).toBe(200);
    runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.date === pastMonday)!.kept).toBe(true);
    // Toggling keep off hides the non-checked-in past run again.
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: pastAtt.id, kept: false })).status).toBe(200);
    runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].date).toBe(upcomingMonday);
  });

  it("scopes check-in to the exact occurrence — a sibling occurrence never counts", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    const otherPast = addDays(pastMonday, -7);
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: pastMonday })).status).toBe(200);
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: otherPast })).status).toBe(200);
    const event = db.listEvents().find((e) => e.seedRefId === "mon-social")!;
    // Check in ONLY to `otherPast`.
    db.addCheckin({ id: "ci-sib", eventId: `event:${event.id}`, occurrenceId: `event:${event.id}:${otherPast}`, runDate: otherPast, groupId: event.groupId, cityId: "columbia-mo", accountId: me.account.id, checkedInBy: me.account.id, checkedInAt: new Date().toISOString(), source: "leader" });
    const runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].date).toBe(otherPast);
    expect(runs[0].checkedIn).toBe(true);
  });

  it("persists the keep toggle across re-login and a server reload (indefinite history)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runlocal-kept-")); try {
      const db = await seededDisk(dir);
      const me = await verified(db, "me@example.com");
      expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: pastMonday })).status).toBe(200);
      const row = db.listAttendance(me.account.id).find((a) => a.role === "rsvp")!;
      expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: row.id, kept: true })).status).toBe(200);
      // Re-login (fresh session): the kept flag is keyed to the row, not the session.
      db.deleteSessionsForAccount(me.account.id);
      const s2 = db.createSession(me.account.id, "127.0.0.1");
      const relogin = payload(await call(db, "GET", "/api/my/runs", `runlocal_sid=${s2.id}`));
      expect(relogin.runs).toHaveLength(1);
      expect(relogin.runs![0].kept).toBe(true);
      await db.persist();
      // Server reload from disk: history is indefinite — nothing prunes kept rows.
      const loaded = await seededDisk(dir);
      const s3 = loaded.createSession(me.account.id, "127.0.0.1");
      const afterReload = payload(await call(loaded, "GET", "/api/my/runs", `runlocal_sid=${s3.id}`));
      expect(afterReload.runs).toHaveLength(1);
      expect(afterReload.runs![0].kept).toBe(true);
      expect(afterReload.runs![0].date).toBe(pastMonday);
      // Un-keep survives reload too: the row goes back to hidden.
      expect((await call(loaded, "POST", "/api/my/runs/keep", `runlocal_sid=${s3.id}`, { runId: row.id, kept: false })).status).toBe(200);
      await loaded.persist();
      const reloaded2 = await seededDisk(dir);
      const s4 = reloaded2.createSession(me.account.id, "127.0.0.1");
      expect(payload(await call(reloaded2, "GET", "/api/my/runs", `runlocal_sid=${s4.id}`)).runs).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("applies the same past visibility + keep flow to solo (personal) runs", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    const pastSolo = addSoloRun(db, me.account.id, "Long run", `${pastMonday}T12:30:00.000Z`, "10 miles");
    const upcomingSolo = addSoloRun(db, me.account.id, "Easy jog", `${upcomingMonday}T06:05:00.000Z`);
    // Past solo run: hidden unless kept. Upcoming solo run: always visible.
    let runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].kind).toBe("solo");
    expect(runs[0].id).toBe(upcomingSolo.id);
    expect(runs[0].upcoming).toBe(true);
    // Keep the past solo run → visible with kind/kept flags and derived fields.
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: pastSolo.id, kept: true })).status).toBe(200);
    runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(runs).toHaveLength(2);
    const keptRow = runs.find((r) => r.id === pastSolo.id)!;
    expect(keptRow.kind).toBe("solo");
    expect(keptRow.past).toBe(true);
    expect(keptRow.kept).toBe(true);
    expect(keptRow.checkedIn).toBe(false);
    expect(keptRow.date).toBe(pastMonday);
    expect(keptRow.time).toBe("12:30 PM");
    expect(keptRow.location).toBe("Stephens Lake");
    expect(keptRow.distanceLabel).toBe("10 miles");
    expect(keptRow.eventId).toBe("");
    expect(keptRow.occurrenceId).toBeNull();
    // Upcoming solo run keeps its 24h-clock-free label too.
    const upcomingRow = runs.find((r) => r.id === upcomingSolo.id)!;
    expect(upcomingRow.time).toBe("6:05 AM");
    // Un-keep hides the past solo run again.
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: pastSolo.id, kept: false })).status).toBe(200);
    runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(upcomingSolo.id);
  });

  it("keeps the kept flag occurrence-specific and caller-scoped", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    const other = await verified(db, "other@example.com");
    const otherPast = addDays(pastMonday, -7);
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: pastMonday })).status).toBe(200);
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: otherPast })).status).toBe(200);
    const myRows = db.listAttendance(me.account.id).filter((a) => a.role === "rsvp");
    const otherAtt = db.addAttendance({ id: "other-row", accountId: other.account.id, eventId: "event:mon-social", role: "rsvp", createdAt: "2026-01-05T00:00:00.000Z", occurrenceId: `event:mon-social:${pastMonday}`, runDate: pastMonday, startsAt: `${pastMonday}T18:00:00.000Z` });
    // Keeping exactly ONE of my occurrences reveals only that occurrence.
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: myRows[0].id, kept: true })).status).toBe(200);
    let runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(myRows[0].id);
    // Another caller's attendance id is never kept (404, no side effects).
    const steal = await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: otherAtt.id, kept: true });
    expect(steal.status).toBe(404);
    expect(db.listAttendance(other.account.id)[0].kept).toBeUndefined();
    // Missing runId → 400; unknown runId → 404.
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { kept: true })).status).toBe(400);
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: "nope", kept: true })).status).toBe(404);
    // Another caller's solo run id is never kept either.
    const otherSolo = addSoloRun(db, other.account.id, "Other solo", `${pastMonday}T08:00:00.000Z`);
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: otherSolo.id, kept: true })).status).toBe(404);
    // Un-keeping my only kept row hides it (and never touched the sibling).
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: myRows[0].id, kept: false })).status).toBe(200);
    runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(runs).toEqual([]);
  });

  it("keeps host rows untouched and never keeps a row of a deleted personal run", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    db.addAttendance({ id: "host-row", accountId: me.account.id, eventId: "event:mon-social", role: "host", createdAt: new Date().toISOString(), occurrenceId: `event:mon-social:${pastMonday}`, runDate: pastMonday, startsAt: `${pastMonday}T18:00:00.000Z` });
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: "host-row", kept: true })).status).toBe(404);
    const solo = addSoloRun(db, me.account.id, "Deleted solo", `${pastMonday}T08:00:00.000Z`);
    db.updatePersonalRun(solo.id, { deletedAt: new Date().toISOString() });
    expect((await call(db, "POST", "/api/my/runs/keep", me.cookie, { runId: solo.id, kept: true })).status).toBe(404);
  });
});
