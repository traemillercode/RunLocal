/**
 * Coach identity - the actual missing discovery layer. Separate from the
 * coach-athlete relationship mechanism (request/accept), which stays
 * exactly as built and tested. This is purely "can people find a coach at
 * all," which they genuinely couldn't before.
 */
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";
import { SESSION_COOKIE } from "../src/server/api";

function req(method: string, path: string, cookie?: string, body?: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  let sent = false;
  const headers: Record<string, string> = { "x-forwarded-proto": "https", ...(raw ? { "content-type": "application/json" } : {}) };
  if (cookie) headers.cookie = cookie;
  return { method, url: path, headers, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]() { return { next: async () => sent ? { done: true as const, value: undefined } : (sent = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
function response() {
  const out = { status: 0, body: "" };
  const res = { writeHead(status: number) { out.status = status; return res; }, setHeader() { return res; }, end(value?: unknown) { if (value !== undefined) out.body += String(value); return res; } } as unknown as ServerResponse;
  return { res, out };
}
async function call(db: Db, method: string, path: string, cookie?: string, body?: unknown) {
  const { res, out } = response();
  await apiHandler(req(method, path, cookie, body), res, db);
  return { status: out.status, body: out.body ? (JSON.parse(out.body) as Record<string, any>) : {} };
}
function account(db: Db, email: string, cityId = "columbia-mo"): { id: string; cookie: string } {
  const a = db.createAccount({ name: "Test Runner", email, cityId });
  db.updateAccount(a.id, { status: "verified", avatarStyle: "coral" });
  const s = db.createSession(a.id, "127.0.0.1");
  return { id: a.id, cookie: `${SESSION_COOKIE}=${s.id}` };
}

describe("Coach identity toggle", () => {
  it("a new account defaults to not-a-coach with no bio", () => {
    const db = createMemoryStore();
    const u = account(db, "default@example.com");
    const rec = db.getAccount(u.id)!;
    expect(rec.isAvailableAsCoach).toBe(false);
    expect(rec.coachBio).toBeNull();
  });

  it("toggling isAvailableAsCoach and setting a bio actually persists both", async () => {
    const db = createMemoryStore();
    const u = account(db, "coach@example.com");
    const r = await call(db, "PUT", "/api/profile/details", u.cookie, { isAvailableAsCoach: true, coachBio: "I coach 5K to marathon, new-runner friendly." });
    expect(r.status).toBe(200);
    expect(r.body.profile.isAvailableAsCoach).toBe(true);
    expect(r.body.profile.coachBio).toBe("I coach 5K to marathon, new-runner friendly.");
  });

  it("rejects a non-boolean value for isAvailableAsCoach", async () => {
    const db = createMemoryStore();
    const u = account(db, "badtoggle@example.com");
    const r = await call(db, "PUT", "/api/profile/details", u.cookie, { isAvailableAsCoach: "yes" });
    expect(r.status).toBe(400);
  });
});

describe("Coach directory", () => {
  it("only lists accounts that have actually opted in, never a random account", async () => {
    const db = createMemoryStore();
    const viewer = account(db, "viewer@example.com");
    const notACoach = account(db, "notacoach@example.com");
    const realCoach = account(db, "realcoach@example.com");
    await call(db, "PUT", "/api/profile/details", realCoach.cookie, { isAvailableAsCoach: true, coachBio: "Marathon specialist" });
    void notACoach;

    const directory = await call(db, "GET", "/api/coaches", viewer.cookie);
    expect(directory.status).toBe(200);
    expect(directory.body.coaches).toHaveLength(1);
    expect(directory.body.coaches[0].accountId).toBe(realCoach.id);
    expect(directory.body.coaches[0].coachBio).toBe("Marathon specialist");
  });

  it("never lists yourself in your own directory view", async () => {
    const db = createMemoryStore();
    const u = account(db, "selfcoach@example.com");
    await call(db, "PUT", "/api/profile/details", u.cookie, { isAvailableAsCoach: true });
    const directory = await call(db, "GET", "/api/coaches", u.cookie);
    expect(directory.body.coaches).toHaveLength(0);
  });

  it("surfaces the existing verified coach_certification credential as isVerifiedCoach, and sorts verified coaches first", async () => {
    const db = createMemoryStore();
    const viewer = account(db, "viewer2@example.com");
    const unverified = account(db, "unverified@example.com");
    const verified = account(db, "verified@example.com");
    await call(db, "PUT", "/api/profile/details", unverified.cookie, { isAvailableAsCoach: true });
    await call(db, "PUT", "/api/profile/details", verified.cookie, { isAvailableAsCoach: true });
    db.addCredential({ id: "cred-1", accountId: verified.id, type: "coach_certification", status: "verified", proofRef: "x", expiresOn: null, submittedAt: new Date().toISOString(), reviewedAt: new Date().toISOString(), reviewedBy: null, renewalNotifiedAt: null } as any);

    const directory = await call(db, "GET", "/api/coaches", viewer.cookie);
    expect(directory.body.coaches).toHaveLength(2);
    expect(directory.body.coaches[0].accountId).toBe(verified.id);
    expect(directory.body.coaches[0].isVerifiedCoach).toBe(true);
    expect(directory.body.coaches[1].isVerifiedCoach).toBe(false);
  });
});
