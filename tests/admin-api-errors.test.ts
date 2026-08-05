import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { DEFAULT_OWNER_EMAIL } from "../src/server/owner";
function request(method: string, path: string, cookie = "", reason = "reviewing verification"): IncomingMessage {
  const headers: Record<string, string> = { "x-forwarded-proto": "https", "x-audit-reason": reason };
  if (cookie) headers.cookie = cookie;
  return { method, url: path, headers, socket: { remoteAddress: "198.51.100.8" }, [Symbol.asyncIterator]() { return { next: async () => ({ done: true as const, value: undefined }) }; } } as unknown as IncomingMessage;
}
function call(db: Db, method: string, path: string, cookie = "", reason?: string) {
  const out = { status: 0, body: "", contentType: "" };
  const res = { writeHead(s: number, h?: Record<string, string>) { out.status = s; out.contentType = h?.["content-type"] ?? ""; return res; }, end(v?: unknown) { if (v !== undefined) out.body += String(v); return res; } } as unknown as ServerResponse;
  return apiHandler(request(method, path, cookie, reason), res, db).then(() => out);
}
describe("owner admin verification HTTP routes", () => {
  it("maps approve action correctly, refreshes state, and serves selfie only to owner", async () => {
    const db = createMemoryStore();
    const owner = db.createAccount({ name: "Owner", email: DEFAULT_OWNER_EMAIL });
    db.updateAccount(owner.id, { status: "verified" });
    const ownerSession = db.createSession(owner.id, "198.51.100.8");
    const target = db.createAccount({ name: "Runner", email: "runner@example.com" });
    db.updateAccount(target.id, { phase: "pending_review", selfieRef: `${target.id}_selfie.jpg` });
    await db.writePrivateUpload(`${target.id}_selfie.jpg`, Buffer.from("image-bytes"));
    const ownerCookie = `runlocal_sid=${ownerSession.id}`;
    const approved = await call(db, "POST", `/api/admin/records/${target.id}/approve?role=runner`, ownerCookie);
    expect(approved.status).toBe(200);
    expect(db.getAccount(target.id)?.status).toBe("verified");
    const preview = await call(db, "GET", `/api/admin/records/${target.id}/selfie`, ownerCookie);
    expect(preview.status).toBe(200);
    expect(preview.body).toBe("image-bytes");
    const other = db.createAccount({ name: "Other", email: "other@example.com" });
    db.updateAccount(other.id, { status: "verified" });
    const denied = await call(db, "GET", `/api/admin/records/${target.id}/selfie`, `runlocal_sid=${db.createSession(other.id, "198.51.100.9").id}`);
    expect(denied.status).toBe(401);
  });
  it("returns a privacy-safe missing-photo response", async () => {
    const db = createMemoryStore();
    const owner = db.createAccount({ name: "Owner", email: DEFAULT_OWNER_EMAIL });
    db.updateAccount(owner.id, { status: "verified" });
    const cookie = `runlocal_sid=${db.createSession(owner.id, "198.51.100.8").id}`;
    const target = db.createAccount({ name: "Runner", email: "runner@example.com" });
    const missing = await call(db, "GET", `/api/admin/records/${target.id}/selfie`, cookie);
    expect(missing.status).toBe(404);
    expect(JSON.parse(missing.body).error).toBe("no_selfie");
  });
});

describe("admin purge cookie separation", () => {
  it("rejects a normal user session placed in the admin cookie", async () => {
    process.env.RUN_LOCAL_ADMIN_KEY = "purge-test-key";
    process.env.RUN_LOCAL_ADMIN_EMAIL = "admin@test";
    const db = createMemoryStore();
    const user = db.createAccount({ name: "User", email: "user@example.com" });
    const userSession = db.createSession(user.id, "198.51.100.8");
    const response = await call(db, "POST", "/api/admin/purge", `runlocal_admin=${userSession.id}`, "retention review");
    expect(response.status).toBe(401);
    delete process.env.RUN_LOCAL_ADMIN_KEY;
    delete process.env.RUN_LOCAL_ADMIN_EMAIL;
  });
});
