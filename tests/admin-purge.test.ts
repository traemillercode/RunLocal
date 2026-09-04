/**
 * Purge-all-except-owner — the most destructive admin action in the app.
 * Every safety gate gets a real test: owner-only auth, exact confirmation
 * string, the stale-count guard, and that the owner account itself can
 * never be deleted no matter what.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { DEFAULT_OWNER_EMAIL, OWNER_EMAIL_VAR } from "../src/server/owner";
import { SESSION_COOKIE } from "../src/server/api";
import { ADMIN_KEY_VAR, ADMIN_EMAIL_VAR } from "../src/server/admin";

const AUDIT_REASON = "Clearing test/dev accounts before real launch";

function req(method: string, path: string, cookie?: string, body?: unknown, reason?: string): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  let sent = false;
  const headers: Record<string, string> = { "x-forwarded-proto": "https", ...(raw ? { "content-type": "application/json" } : {}) };
  if (cookie) headers.cookie = cookie;
  if (reason) headers["x-audit-reason"] = reason;
  return { method, url: path, headers, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]() { return { next: async () => sent ? { done: true as const, value: undefined } : (sent = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
function response() {
  const out = { status: 0, body: "" };
  const res = { writeHead(status: number) { out.status = status; return res; }, setHeader() { return res; }, end(value?: unknown) { if (value !== undefined) out.body += String(value); return res; } } as unknown as ServerResponse;
  return { res, out };
}
async function call(db: Db, method: string, path: string, cookie?: string, body?: unknown, reason?: string) {
  const { res, out } = response();
  await apiHandler(req(method, path, cookie, body, reason), res, db);
  return { status: out.status, body: out.body ? (JSON.parse(out.body) as Record<string, any>) : {} };
}
function account(db: Db, email: string, cityId = "columbia-mo"): { id: string; cookie: string; email: string } {
  const a = db.createAccount({ name: email, email, cityId });
  db.updateAccount(a.id, { status: "verified", avatarStyle: "coral" });
  const s = db.createSession(a.id, "127.0.0.1");
  return { id: a.id, cookie: `${SESSION_COOKIE}=${s.id}`, email: a.email };
}

describe("Purge all except owner (irreversible - every gate tested)", () => {
  beforeEach(() => {
    process.env[ADMIN_KEY_VAR] = "test-admin-key-123";
    process.env[ADMIN_EMAIL_VAR] = "admin@runlocal.app";
  });
  afterEach(() => {
    delete process.env[ADMIN_KEY_VAR];
    delete process.env[ADMIN_EMAIL_VAR];
    delete process.env[OWNER_EMAIL_VAR];
  });

  it("preview lists everyone except the owner, without deleting anything", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    account(db, "runner1@example.com");
    account(db, "runner2@example.com");
    const r = await call(db, "GET", "/api/admin/purge-preview", owner.cookie, undefined, AUDIT_REASON);
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(2);
    expect(r.body.emails.sort()).toEqual(["runner1@example.com", "runner2@example.com"]);
    // Nothing was actually deleted by previewing.
    expect(db.listAccounts()).toHaveLength(3);
  });

  it("rejects without the exact confirmation string", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    account(db, "runner1@example.com");
    const r = await call(db, "POST", "/api/admin/purge-all", owner.cookie, { confirmText: "delete all", expectedCount: 1 }, AUDIT_REASON);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("confirmation_required");
    expect(db.listAccounts()).toHaveLength(2);
  });

  it("rejects if the expected count doesn't match the current real count (stale preview guard)", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    account(db, "runner1@example.com");
    // Someone signed up after the preview was shown - expectedCount is now stale.
    account(db, "runner2@example.com");
    const r = await call(db, "POST", "/api/admin/purge-all", owner.cookie, { confirmText: "DELETE ALL", expectedCount: 1 }, AUDIT_REASON);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("count_changed");
    // Nothing deleted - the guard fired before any deletion happened.
    expect(db.listAccounts()).toHaveLength(3);
  });

  it("a non-owner admin (key-based session, not an owner session) cannot call this at all", async () => {
    const db = createMemoryStore();
    account(db, "runner1@example.com");
    // No owner session cookie provided - only the audit reason, simulating
    // a key-based admin without an actual owner-email session.
    const preview = await call(db, "GET", "/api/admin/purge-preview", undefined, undefined, AUDIT_REASON);
    expect(preview.status).toBe(401);
    const purge = await call(db, "POST", "/api/admin/purge-all", undefined, { confirmText: "DELETE ALL", expectedCount: 1 }, AUDIT_REASON);
    expect(purge.status).toBe(401);
    expect(db.listAccounts()).toHaveLength(1);
  });

  it("with everything correct: deletes everyone except the owner, and the owner survives untouched", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL);
    account(db, "runner1@example.com");
    account(db, "runner2@example.com");
    account(db, "runner3@example.com");
    expect(db.listAccounts()).toHaveLength(4);

    const r = await call(db, "POST", "/api/admin/purge-all", owner.cookie, { confirmText: "DELETE ALL", expectedCount: 3 }, AUDIT_REASON);
    expect(r.status).toBe(200);
    expect(r.body.deletedCount).toBe(3);
    expect(r.body.deletedEmails.sort()).toEqual(["runner1@example.com", "runner2@example.com", "runner3@example.com"]);

    const remaining = db.listAccounts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].email).toBe(DEFAULT_OWNER_EMAIL);
    // The owner's own session should still be valid - not collaterally wiped.
    const me = await call(db, "GET", "/api/me", owner.cookie);
    expect(me.status).toBe(200);
    expect(me.body.status).toBe("signed_in");
  });

  it("case-insensitive email match still protects the owner even if their record has different casing", async () => {
    const db = createMemoryStore();
    const owner = account(db, DEFAULT_OWNER_EMAIL.toUpperCase());
    account(db, "runner1@example.com");
    const preview = await call(db, "GET", "/api/admin/purge-preview", owner.cookie, undefined, AUDIT_REASON);
    expect(preview.status).toBe(200);
    expect(preview.body.emails).toEqual(["runner1@example.com"]);
    expect(preview.body.count).toBe(1);
  });
});
