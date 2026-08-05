/** HTTP contract tests for verified-runner-only group photo uploads. */
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";

function req(body: unknown, cookie?: string): IncomingMessage {
  const raw = JSON.stringify(body);
  return {
    method: "POST", url: "/api/group/photo",
    headers: { "content-type": "application/json", "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}) },
    socket: { remoteAddress: "198.51.100.23" },
    [Symbol.asyncIterator]() {
      let done = false;
      return { next: async () => done ? { done: true as const, value: undefined } : (done = true, { done: false as const, value: Buffer.from(raw) }) };
    },
  } as unknown as IncomingMessage;
}
function response() {
  const result = { status: 200, body: "" };
  const res = {
    writeHead(status: number) { result.status = status; return res; },
    setHeader() { return res; },
    end(chunk?: unknown) { if (chunk !== undefined) result.body += String(chunk); return res; },
  } as unknown as ServerResponse;
  return { res, result };
}
function session(db: Db, status: "verified" | "pending" = "verified", suspended = false) {
  const account = db.createAccount({ name: "Runner", email: `${Math.random()}@example.com`, cityId: "columbia-mo" });
  db.updateAccount(account.id, { status, phase: "pending_review", selfieRef: "selfie.jpg", suspended });
  const s = db.createSession(account.id, "198.51.100.23");
  return `runlocal_sid=${s.id}`;
}
const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("POST /api/group/photo", () => {
  it("uploads a supported image for a verified runner", async () => {
    const db = createMemoryStore(); const { res, result } = response();
    await apiHandler(req({ photo: PNG }, session(db)), res, db);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).photoRef).toMatch(/^\w+_group_.*\.png$/);
  });
  it("rejects unauthenticated callers", async () => {
    const db = createMemoryStore(); const { res, result } = response();
    await apiHandler(req({ photo: PNG }), res, db);
    expect(result.status).toBe(401); expect(JSON.parse(result.body).error).toBe("sign_in_required");
  });
  it.each([["unverified", "pending", false], ["suspended", "verified", true]] as const)("rejects %s accounts before inspecting the image", async (_label, status, suspended) => {
    const db = createMemoryStore(); const { res, result } = response();
    await apiHandler(req({ photo: PNG }, session(db, status, suspended)), res, db);
    expect(result.status).toBe(403);
    expect(JSON.parse(result.body).error).toBe(suspended ? "suspended" : "verification_required");
  });
  it("rejects unsupported MIME types", async () => {
    const db = createMemoryStore(); const { res, result } = response();
    await apiHandler(req({ photo: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP" }, session(db)), res, db);
    expect(result.status).toBe(400); expect(JSON.parse(result.body).error).toBe("invalid_image");
  });
  it("rejects decoded images over the size limit", async () => {
    const db = createMemoryStore(); const { res, result } = response();
    const oversized = `data:image/png;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64")}`;
    await apiHandler(req({ photo: oversized }, session(db)), res, db);
    expect(result.status).toBe(400); expect(JSON.parse(result.body).error).toBe("image_too_large");
  });
});
