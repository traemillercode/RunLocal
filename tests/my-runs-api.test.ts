import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { Db, createMemoryStore } from "../src/server/store";
import { seedContentRegistry } from "../src/server/contentSeed";

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

describe("private My Runs API", () => {
  it("denies guests and pending/unverified callers", async () => { const db = createMemoryStore(); seedContentRegistry(db); expect((await call(db, "GET", "/api/my/runs")).status).toBe(401); const pending = db.createAccount({ name: "p", email: "p@example.com", cityId: "columbia-mo" }); const s = db.createSession(pending.id, "127.0.0.1"); const out = await call(db, "GET", "/api/my/runs", `runlocal_sid=${s.id}`); expect(out.status).toBe(403); expect(payload(out).error).toBe("verified_runner_required"); });
  it("isolates accounts and ignores accountId/query manipulation", async () => { const db = createMemoryStore(); seedContentRegistry(db); const one = await verified(db, "one@example.com"); const two = await verified(db, "two@example.com"); await call(db, "POST", "/api/events/rsvp", one.cookie, { eventId: "mon-social" }); const out = await call(db, "GET", "/api/my/runs?accountId=" + two.account.id, two.cookie); expect(out.status).toBe(200); expect(payload(out).runs).toEqual([]); expect(JSON.stringify(payload(await call(db, "GET", "/api/my/runs", one.cookie)))).not.toContain(two.account.id); });
  it("supports duplicate/idempotent RSVP, persistence roundtrip, and caller-only removal", async () => { const dir = await mkdtemp(join(tmpdir(), "runlocal-my-runs-")); try { const db = new Db({ dataDir: dir }); await db.load(); seedContentRegistry(db); const one = await verified(db, "one@example.com"); const other = await verified(db, "other@example.com"); const first = await call(db, "POST", "/api/events/rsvp", one.cookie, { eventId: "mon-social" }); const second = await call(db, "POST", "/api/events/rsvp", one.cookie, { eventId: "event:mon-social" }); expect(first.status).toBe(200); expect(second.status).toBe(200); expect(db.listAttendance(one.account.id).filter((a) => a.role === "rsvp")).toHaveLength(1); db.addAttendance({ id: "host-record", accountId: one.account.id, eventId: "event:mon-social", role: "host", createdAt: new Date().toISOString() }); db.addAttendance({ id: "other-rsvp", accountId: other.account.id, eventId: "event:mon-social", role: "rsvp", createdAt: new Date().toISOString() }); await db.persist(); const loaded = new Db({ dataDir: dir }); await loaded.load(); expect(loaded.listAttendance(one.account.id)).toHaveLength(2); const removed = await call(loaded, "POST", "/api/events/rsvp", one.cookie, { eventId: "mon-social", rsvp: false }); expect(removed.status).toBe(200); expect(loaded.listAttendance(one.account.id).map((a) => a.role)).toEqual(["host"]); expect(loaded.listAttendance(other.account.id)).toHaveLength(1); const runs = payload(await call(loaded, "GET", "/api/my/runs", one.cookie)).runs ?? []; expect(runs).toEqual([]); } finally { await rm(dir, { recursive: true, force: true }); } });
});
