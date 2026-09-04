/**
 * Product feedback (roadmap 0.7).
 *
 * The rule that matters most and is easiest to regress: ONLY "broken" emails
 * immediately. Idea/confusing/praise are stored silently. A notification that
 * fires for praise trains the owner to ignore notifications within a week,
 * which costs more than the notification was ever worth.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const sent: { to: string; subject: string; from?: string; replyTo?: string; html: string }[] = [];
vi.mock("../src/server/email", () => ({
  sendEmail: async (input: { to: string; subject: string; from?: string; replyTo?: string; html: string }) => {
    sent.push(input);
    return { ok: true };
  },
  verifiedEmailHtml: () => "",
}));

const { apiHandler, SESSION_COOKIE } = await import("../src/server/api");
const { createMemoryStore } = await import("../src/server/store");
type Db = import("../src/server/store").Db;

beforeEach(() => { sent.length = 0; });

function req(method: string, path: string, cookie?: string, body?: unknown, ua = "TestAgent/1.0"): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  let done = false;
  const headers: Record<string, string> = { "x-forwarded-proto": "https", "user-agent": ua, ...(raw ? { "content-type": "application/json" } : {}) };
  if (cookie) headers.cookie = cookie;
  return { method, url: path, headers, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]() { return { next: async () => done ? { done: true as const, value: undefined } : (done = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
function response() {
  const out = { status: 0, body: "" };
  const res = { writeHead(s: number) { out.status = s; return res; }, setHeader() { return res; }, end(v?: unknown) { if (v !== undefined) out.body += String(v); return res; } } as unknown as ServerResponse;
  return { res, out };
}
async function call(db: Db, method: string, path: string, cookie?: string, body?: unknown) {
  const { res, out } = response();
  await apiHandler(req(method, path, cookie, body), res, db);
  return { status: out.status, body: out.body ? (JSON.parse(out.body) as Record<string, any>) : {} };
}
function account(db: Db, email: string, name = "Test Runner") {
  const a = db.createAccount({ name, email, cityId: "columbia-mo" });
  db.updateAccount(a.id, { status: "verified", avatarStyle: "coral" });
  const s = db.createSession(a.id, "127.0.0.1");
  return { id: a.id, email, cookie: `${SESSION_COOKIE}=${s.id}` };
}

const CONTEXT = {
  path: "/training-plan",
  role: "coach",
  viewport: "390x844",
  appVersion: "abc123",
  recentActions: ["opened /training-plan", "tapped Add run", "typed distance"],
  onScreenError: "Couldn't save.",
};

describe("Feedback — notification rules", () => {
  it("'broken' sends immediately, with route and reporter in the subject", async () => {
    const db = createMemoryStore();
    const u = account(db, "runner@example.com", "Casey Runner");
    const r = await call(db, "POST", "/api/feedback", u.cookie, { category: "broken", message: "Save button does nothing", ...CONTEXT });
    expect(r.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("[Kimbio] Broken — /training-plan — Casey Runner");
  });

  it("idea, confusing, and praise are stored but send NO email", async () => {
    const db = createMemoryStore();
    const u = account(db, "quiet@example.com");
    for (const category of ["idea", "confusing", "praise"] as const) {
      await call(db, "POST", "/api/feedback", u.cookie, { category, message: `a ${category} note`, ...CONTEXT });
    }
    expect(sent).toHaveLength(0);
    expect(db.listFeedback()).toHaveLength(3);
  });

  it("sends from the verified domain and sets reply-to to the reporter, not the from address", async () => {
    const db = createMemoryStore();
    const u = account(db, "reporter@example.com");
    await call(db, "POST", "/api/feedback", u.cookie, { category: "broken", message: "broken thing", ...CONTEXT });
    expect(sent[0].from).toContain("feedback@getkimbio.com");
    // Delivered to the role address now that Google Workspace receives it —
    // not the owner's personal inbox.
    expect(sent[0].to).toBe("feedback@getkimbio.com");
    // Receiving is disabled on the domain, so replying to From would go nowhere.
    expect(sent[0].replyTo).toBe("reporter@example.com");

  });

  it("a signed-out report still sends, with no reply-to rather than a broken one", async () => {
    const db = createMemoryStore();
    const r = await call(db, "POST", "/api/feedback", undefined, { category: "broken", message: "cannot sign in at all", path: "/login" });
    expect(r.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].replyTo).toBeUndefined();
    expect(db.listFeedback()[0].accountId).toBeNull();
  });
});

describe("Feedback — captured context", () => {
  it("stores the auto-captured context that makes a report actionable", async () => {
    const db = createMemoryStore();
    const u = account(db, "ctx@example.com");
    await call(db, "POST", "/api/feedback", u.cookie, { category: "broken", message: "m", ...CONTEXT });
    const rec = db.listFeedback()[0];
    expect(rec.path).toBe("/training-plan");
    expect(rec.role).toBe("coach");
    expect(rec.viewport).toBe("390x844");
    expect(rec.recentActions).toEqual(CONTEXT.recentActions);
    expect(rec.onScreenError).toBe("Couldn't save.");
    expect(rec.userAgent).toBe("TestAgent/1.0");
  });

  it("keeps only the last 3 actions even if more are sent", async () => {
    const db = createMemoryStore();
    const u = account(db, "many@example.com");
    await call(db, "POST", "/api/feedback", u.cookie, {
      category: "idea", message: "m",
      recentActions: ["a1", "a2", "a3", "a4", "a5"],
    });
    expect(db.listFeedback()[0].recentActions).toEqual(["a3", "a4", "a5"]);
  });
});

describe("Feedback — validation and access", () => {
  it("rejects an unknown category and an empty message", async () => {
    const db = createMemoryStore();
    const u = account(db, "bad@example.com");
    expect((await call(db, "POST", "/api/feedback", u.cookie, { category: "rant", message: "x" })).status).toBe(400);
    expect((await call(db, "POST", "/api/feedback", u.cookie, { category: "idea", message: "   " })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("only the owner can read the feedback table", async () => {
    const db = createMemoryStore();
    const stranger = account(db, "stranger@example.com");
    const owner = account(db, "traemiller.email@gmail.com", "Owner");
    await call(db, "POST", "/api/feedback", stranger.cookie, { category: "idea", message: "hi" });

    expect((await call(db, "GET", "/api/feedback", stranger.cookie)).status).toBe(403);
    expect((await call(db, "GET", "/api/feedback", undefined)).status).toBe(401);
    const asOwner = await call(db, "GET", "/api/feedback", owner.cookie);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.feedback).toHaveLength(1);
  });
});
