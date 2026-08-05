import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, Db } from "../src/server/store";
import type { NotificationRecord } from "../src/server/types";

function req(method: string, path: string, cookie?: string, body?: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  let sent = false;
  return { method, url: path, headers: { "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}), ...(raw ? { "content-type": "application/json" } : {}) }, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]() { return { next: async () => sent ? { done: true as const, value: undefined } : (sent = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
function response() {
  const out = { status: 0, body: "" };
  const res = { writeHead(status: number) { out.status = status; return res; }, setHeader() { return res; }, end(value?: unknown) { if (value !== undefined) out.body += String(value); return res; } } as unknown as ServerResponse;
  return { res, out };
}
async function call(db: Db, method: string, path: string, cookie?: string, body?: unknown) { const { res, out } = response(); await apiHandler(req(method, path, cookie, body), res, db); return { status: out.status, body: JSON.parse(out.body) as Record<string, any> }; }
function account(db: Db, email: string) { const a = db.createAccount({ name: email, email, cityId: "columbia-mo" }); db.updateAccount(a.id, { status: "verified", verifiedAt: new Date().toISOString() }); const s = db.createSession(a.id, "127.0.0.1"); return { id: a.id, cookie: `runlocal_sid=${s.id}` }; }
function notification(accountId: string, id: string, readAt: string | null = null): NotificationRecord { return { id, accountId, category: "account_alerts", title: id, body: `Body ${id}`, createdAt: `2026-01-0${id === "one" ? "1" : "2"}T00:00:00.000Z`, readAt }; }

describe("notification preferences and inbox API", () => {
  it("isolates preferences by authenticated account", async () => {
    const db = createMemoryStore(); const one = account(db, "one@example.com"); const two = account(db, "two@example.com");
    expect((await call(db, "PATCH", "/api/notifications/preferences", one.cookie, { run_reminders: true })).status).toBe(200);
    expect((await call(db, "GET", "/api/notifications/preferences", one.cookie)).body.preferences).toMatchObject({ run_reminders: true, community_updates: false });
    expect((await call(db, "GET", "/api/notifications/preferences", two.cookie)).body.preferences).toMatchObject({ run_reminders: false, community_updates: false, account_alerts: false });
    expect((await call(db, "PATCH", "/api/notifications/preferences", two.cookie, { community_updates: true })).body.preferences).toMatchObject({ run_reminders: false, community_updates: true });
    expect((await call(db, "GET", "/api/notifications/preferences", one.cookie)).body.preferences.community_updates).toBe(false);
  });

  it("supports unread, single-read, read-all, and cross-account isolation", async () => {
    const db = createMemoryStore(); const one = account(db, "one@example.com"); const two = account(db, "two@example.com");
    db.addNotification(notification(one.id, "one")); db.addNotification(notification(one.id, "two")); db.addNotification(notification(two.id, "other"));
    const initial = await call(db, "GET", "/api/notifications", one.cookie);
    expect(initial.body.unreadCount).toBe(2); expect(initial.body.notifications).toHaveLength(2); expect(JSON.stringify(initial.body)).not.toContain("other");
    expect((await call(db, "POST", "/api/notifications/one/read", one.cookie)).status).toBe(200);
    expect((await call(db, "GET", "/api/notifications", one.cookie)).body.unreadCount).toBe(1);
    expect((await call(db, "POST", "/api/notifications/other/read", one.cookie)).status).toBe(404);
    expect((await call(db, "GET", "/api/notifications", two.cookie)).body.unreadCount).toBe(1);
    expect((await call(db, "POST", "/api/notifications/read-all", one.cookie)).status).toBe(200);
    expect((await call(db, "GET", "/api/notifications", one.cookie)).body.unreadCount).toBe(0);
    expect((await call(db, "GET", "/api/notifications", two.cookie)).body.unreadCount).toBe(1);
  });
});
