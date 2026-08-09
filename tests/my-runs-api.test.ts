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
function payload(out: { body: string }) { return JSON.parse(out.body) as { error?: string; runs?: Array<Record<string, string>>; rsvped?: boolean }; }
/** A real seeded Db exactly like serve.ts: moderation registry + materialized events. */
function seeded(db: Db) { seedContentRegistry(db); materializeSeedEvents(db, CITIES); return db; }
/** Disk-backed Db: load first (matches serve.ts), then seed. */
async function seededDisk(dir: string) { const db = new Db({ dataDir: dir }); await db.load(); return seeded(db); }

describe("private My Runs API", () => {
  it("denies guests and pending/unverified callers", async () => { const db = seeded(createMemoryStore()); expect((await call(db, "GET", "/api/my/runs")).status).toBe(401); const pending = db.createAccount({ name: "p", email: "p@example.com", cityId: "columbia-mo" }); const s = db.createSession(pending.id, "127.0.0.1"); const out = await call(db, "GET", "/api/my/runs", `runlocal_sid=${s.id}`); expect(out.status).toBe(403); expect(payload(out).error).toBe("verified_runner_required"); });
  it("isolates accounts and ignores accountId/query manipulation", async () => { const db = seeded(createMemoryStore()); const one = await verified(db, "one@example.com"); const two = await verified(db, "two@example.com"); await call(db, "POST", "/api/events/rsvp", one.cookie, { eventId: "mon-social" }); const out = await call(db, "GET", "/api/my/runs?accountId=" + two.account.id, two.cookie); expect(out.status).toBe(200); expect(payload(out).runs).toEqual([]); expect(JSON.stringify(payload(await call(db, "GET", "/api/my/runs", one.cookie)))).not.toContain(two.account.id); });
  it("supports duplicate/idempotent RSVP, persistence roundtrip, and caller-only removal", async () => { const dir = await mkdtemp(join(tmpdir(), "runlocal-my-runs-")); try { const db = await seededDisk(dir); const one = await verified(db, "one@example.com"); const other = await verified(db, "other@example.com"); const first = await call(db, "POST", "/api/events/rsvp", one.cookie, { eventId: "mon-social" }); const second = await call(db, "POST", "/api/events/rsvp", one.cookie, { eventId: "event:mon-social" }); expect(first.status).toBe(200); expect(second.status).toBe(200); expect(db.listAttendance(one.account.id).filter((a) => a.role === "rsvp")).toHaveLength(1); db.addAttendance({ id: "host-record", accountId: one.account.id, eventId: "event:mon-social", role: "host", createdAt: new Date().toISOString() }); db.addAttendance({ id: "other-rsvp", accountId: other.account.id, eventId: "event:mon-social", role: "rsvp", createdAt: new Date().toISOString() }); await db.persist(); const loaded = await seededDisk(dir); expect(loaded.listAttendance(one.account.id)).toHaveLength(2); const removed = await call(loaded, "POST", "/api/events/rsvp", one.cookie, { eventId: "mon-social", rsvp: false }); expect(removed.status).toBe(200); expect(loaded.listAttendance(one.account.id).map((a) => a.role)).toEqual(["host"]); expect(loaded.listAttendance(other.account.id)).toHaveLength(1); const runs = payload(await call(loaded, "GET", "/api/my/runs", one.cookie)).runs ?? []; expect(runs).toEqual([]); } finally { await rm(dir, { recursive: true, force: true }); } });

  it("removes exactly one occurrence, preserving sibling occurrences and host rows", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    const date1 = "2026-08-03"; const date2 = "2026-08-10"; // consecutive Mondays of mon-social
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: date1 })).status).toBe(200);
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: date2 })).status).toBe(200);
    const event = db.listEvents().find((e) => e.seedRefId === "mon-social")!;
    const before = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(before).toHaveLength(2);
    expect(before.map((r) => r.occurrenceId).sort()).toEqual([`event:${event.id}:${date1}`, `event:${event.id}:${date2}`].sort());
    const first = before.find((r) => r.date === date1)!;
    const removed = await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: first.eventId, runDate: date1, rsvp: false, runId: first.id });
    expect(removed.status).toBe(200);
    expect(payload(removed).rsvped).toBe(false);
    const remaining = db.listAttendance(me.account.id).filter((a) => a.role === "rsvp");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].runDate).toBe(date2);
    const after = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(after).toHaveLength(1);
    expect(after[0].date).toBe(date2);
    expect(after[0].occurrenceId).toBe(`event:${event.id}:${date2}`);
    // date-based removal of the remaining occurrence leaves zero RSVPs
    const last = await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: date2, rsvp: false });
    expect(last.status).toBe(200);
    expect(db.listAttendance(me.account.id).filter((a) => a.role === "rsvp")).toHaveLength(0);
  });

  it("keeps RSVPs across re-login (new session) and a server reload from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "runlocal-relogin-")); try {
      const db = await seededDisk(dir);
      const me = await verified(db, "me@example.com");
      expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: "2026-08-03" })).status).toBe(200);
      // Re-login: the old session is revoked and a fresh one is issued; the
      // RSVP is server-authoritative (keyed to the account, not the session).
      db.deleteSessionsForAccount(me.account.id);
      const s2 = db.createSession(me.account.id, "127.0.0.1");
      const relogin = payload(await call(db, "GET", "/api/my/runs", `runlocal_sid=${s2.id}`));
      expect(relogin.error).toBeUndefined();
      expect(relogin.runs).toHaveLength(1);
      expect(relogin.runs![0].date).toBe("2026-08-03");
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
    db.addAttendance({ id: "legacy-me", accountId: me.account.id, eventId: "event:mon-social", role: "rsvp", createdAt: "2026-01-05T00:00:00.000Z" });
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
    db.addAttendance({ id: "live-me", accountId: me.account.id, eventId: "event:mon-social", role: "rsvp", createdAt: "2026-01-05T00:00:00.000Z", occurrenceId: "event:mon-social:2026-08-03", runDate: "2026-08-03", startsAt: "2026-08-03T18:00:00.000Z" });
    const wrong = await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "tue-track", runDate: "2026-08-04", rsvp: false, runId: "live-me" });
    expect(wrong.status).toBe(400);
    expect(payload(wrong).error).toBe("invalid_run");
    expect(db.listAttendance(me.account.id).filter((a) => a.role === "rsvp")).toHaveLength(1);
  });

  it("returns clear errors and preserves state on a failed removal", async () => {
    const db = seeded(createMemoryStore());
    const me = await verified(db, "me@example.com");
    expect((await call(db, "POST", "/api/events/rsvp", undefined, { eventId: "mon-social", runDate: "2026-08-03", rsvp: false })).status).toBe(401);
    const pending = db.createAccount({ name: "p", email: "p@example.com", cityId: "columbia-mo" });
    const sp = db.createSession(pending.id, "127.0.0.1");
    expect((await call(db, "POST", "/api/events/rsvp", `runlocal_sid=${sp.id}`, { eventId: "mon-social", runDate: "2026-08-03", rsvp: false })).status).toBe(403);
    const bad = await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: "2026-02-30", rsvp: false });
    expect(bad.status).toBe(400);
    expect(payload(bad).error).toBe("invalid_occurrence");
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: "2026-08-03" })).status).toBe(200);
    expect(db.listAttendance(me.account.id).filter((a) => a.role === "rsvp")).toHaveLength(1);
    // A failed removal leaves the RSVP intact.
    expect((await call(db, "POST", "/api/events/rsvp", me.cookie, { eventId: "mon-social", runDate: "2026-02-30", rsvp: false })).status).toBe(400);
    expect(db.listAttendance(me.account.id).filter((a) => a.role === "rsvp")).toHaveLength(1);
    const runs = payload(await call(db, "GET", "/api/my/runs", me.cookie)).runs ?? [];
    expect(runs).toHaveLength(1);
    expect(runs[0].occurrenceId).toContain("2026-08-03");
  });
});
