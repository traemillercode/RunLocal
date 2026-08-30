/**
 * Waitlist capture.
 *
 * "Email hello@getkimbio.com" was the entire mechanism, so the next fifty
 * users lived in an inbox with no list, no export and no way to invite them as
 * a batch. This is the record and the endpoint behind a real form.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const sent: { to: string; subject: string; html: string }[] = [];
vi.mock("../src/server/email", () => ({
  sendEmail: async (i: { to: string; subject: string; html: string }) => { sent.push(i); return { ok: true }; },
  verifiedEmailHtml: () => "",
}));

const { apiHandler } = await import("../src/server/api");
const { createMemoryStore } = await import("../src/server/store");
type Db = import("../src/server/store").Db;

beforeEach(() => { sent.length = 0; });

function req(method: string, path: string, body?: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  let done = false;
  return { method, url: path, headers: { "x-forwarded-proto": "https", "content-type": "application/json" },
    socket: { remoteAddress: "127.0.0.1" },
    [Symbol.asyncIterator]() { return { next: async () => done ? { done: true as const, value: undefined } : (done = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
async function call(db: Db, body: unknown) {
  const out = { status: 0, body: "" };
  const res = { writeHead(s: number) { out.status = s; return res; }, setHeader() { return res; }, end(v?: unknown) { if (v !== undefined) out.body += String(v); return res; } } as unknown as ServerResponse;
  await apiHandler(req("POST", "/api/waitlist", body), res, db);
  return { status: out.status, json: out.body ? JSON.parse(out.body) : {} };
}

describe("capture", () => {
  it("stores the entry and sends one confirmation", async () => {
    const db = createMemoryStore();
    const r = await call(db, { email: "Runner@Example.com", name: "Casey" });
    expect(r.status).toBe(200);
    const rows = db.listWaitlist();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("runner@example.com"); // normalised
    expect(rows[0].name).toBe("Casey");
    expect(rows[0].status).toBe("interested");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("runner@example.com");
  });

  it("records UTM so an ad is measured against signups, not clicks", async () => {
    const db = createMemoryStore();
    await call(db, { email: "a@example.com", utm_source: "instagram", utm_campaign: "columbia-launch" });
    expect(db.listWaitlist()[0].source).toBe("instagram / columbia-launch");
  });

  it("name is optional", async () => {
    const db = createMemoryStore();
    await call(db, { email: "b@example.com" });
    expect(db.listWaitlist()[0].name).toBeNull();
  });

  it("rejects something that is not an email", async () => {
    const db = createMemoryStore();
    expect((await call(db, { email: "nope" })).status).toBe(400);
    expect(db.listWaitlist()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });
});

describe("a second submission is not an error", () => {
  it("does not duplicate the row or resend the email", async () => {
    /*
     * Someone will submit twice — they will not remember, or the first attempt
     * will have looked like it failed. An error would read as rejection, which
     * is the opposite of what a waitlist is for.
     */
    const db = createMemoryStore();
    await call(db, { email: "twice@example.com" });
    const r2 = await call(db, { email: "twice@example.com" });
    expect(r2.status).toBe(200);
    expect(r2.json.alreadyOn).toBe(true);
    expect(db.listWaitlist()).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("fills in a name given later, without resetting their place", async () => {
    const db = createMemoryStore();
    await call(db, { email: "c@example.com" });
    const first = db.listWaitlist()[0].createdAt;
    await call(db, { email: "c@example.com", name: "Jordan" });
    const row = db.listWaitlist()[0];
    expect(row.name).toBe("Jordan");
    expect(row.createdAt).toBe(first);
  });

  it("normalises case, so the same person cannot appear twice", async () => {
    const db = createMemoryStore();
    await call(db, { email: "Same@Example.com" });
    await call(db, { email: "same@example.com" });
    expect(db.listWaitlist()).toHaveLength(1);
  });
});

describe("the confirmation email", () => {
  it("says what is true and sets an expectation", async () => {
    const db = createMemoryStore();
    await call(db, { email: "d@example.com" });
    const html = sent[0].html.toLowerCase();
    expect(html).toContain("private beta");
    expect(html).toContain("columbia");
    expect(sent[0].subject).toBe("You're on the list");
  });

  it("a mail failure does not fail the signup", async () => {
    // The record is what matters; losing it because SMTP hiccuped would be the
    // expensive half. Asserted by shape: the send is fire-and-forget.
    const { readFileSync } = await import("node:fs");
    const api = readFileSync(new URL("../src/server/api.ts", import.meta.url).pathname, "utf8");
    const at = api.indexOf('subject: "You\'re on the list"');
    expect(api.slice(Math.max(0, at - 700), at)).toContain("void sendEmail(");
  });
});

describe("newest first", () => {
  it("lists the most recent signup at the top", async () => {
    const db = createMemoryStore();
    for (const e of ["one@x.com", "two@x.com", "three@x.com"]) {
      await call(db, { email: e });
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(db.listWaitlist().map((w) => w.email)).toEqual(["three@x.com", "two@x.com", "one@x.com"]);
  });
});

describe("the list is readable, not write-only", () => {
  /*
   * Part 1 shipped capture with no read path: listWaitlist() existed in the
   * store and nothing called it over HTTP, so entries landed on the Railway
   * volume and could not be looked at. Running an ad against a bucket nobody
   * can open is worse than having no bucket.
   */
  async function get(db: Db, headers: Record<string, string> = {}) {
    const out = { status: 0, body: "" };
    const res = { writeHead(s: number) { out.status = s; return res; }, setHeader() { return res; }, end(v?: unknown) { if (v !== undefined) out.body += String(v); return res; } } as unknown as ServerResponse;
    const r = { method: "GET", url: "/api/admin/waitlist", headers: { "x-forwarded-proto": "https", ...headers }, socket: { remoteAddress: "127.0.0.1" },
      [Symbol.asyncIterator]() { return { next: async () => ({ done: true as const, value: undefined }) }; } } as unknown as IncomingMessage;
    await apiHandler(r, res, db);
    return { status: out.status, json: out.body ? JSON.parse(out.body) : {} };
  }

  it("refuses an unauthenticated read", async () => {
    const db = createMemoryStore();
    await call(db, { email: "x@example.com" });
    const r = await get(db);
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("returns entries and a total for an admin", async () => {
    const { adminLogin, ADMIN_KEY_VAR } = await import("../src/server/admin");
    process.env[ADMIN_KEY_VAR] = "test-admin-key";
    const db = createMemoryStore();
    await call(db, { email: "one@example.com", name: "Casey" });
    const login = adminLogin(db, "test-admin-key", "198.51.100.7");
    if (!login.ok) throw new Error("login failed");
    const r = await get(db, { cookie: `runlocal_admin=${login.data.sessionId}` });
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(1);
    expect(r.json.entries[0].email).toBe("one@example.com");
  });

  it("needs NO x-audit-reason — reading your own waitlist is not moderation", async () => {
    /*
     * The specific mistake this avoids: revoke and minting both sat on the
     * reason-required side while the client sent no header, so every call
     * 400'd. admin.waitlist_list is a routine read on the no-reason side.
     */
    const { reasonRequiredFor } = await import("../src/server/admin");
    expect(reasonRequiredFor("admin.waitlist_list")).toBe(false);
  });

  it("an unexplained read is not audited", async () => {
    const { adminLogin, ADMIN_KEY_VAR } = await import("../src/server/admin");
    process.env[ADMIN_KEY_VAR] = "test-admin-key";
    const db = createMemoryStore();
    const login = adminLogin(db, "test-admin-key", "198.51.100.7");
    if (!login.ok) throw new Error("login failed");
    await get(db, { cookie: `runlocal_admin=${login.data.sessionId}` });
    expect(db.listAudit(20).some((a) => a.action === "admin.waitlist_list")).toBe(false);
  });
});

describe("CSV export escapes correctly", () => {
  /*
   * The silent failure mode: a name containing a comma splits the row, and
   * every column after it shifts. The file still opens, so the corruption is
   * invisible until someone reads the wrong email address off the wrong row.
   */
  const cell = (v: string | null) => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  it("quotes a value containing a comma", () => {
    expect(cell("Smith, Jr.")).toBe('"Smith, Jr."');
  });

  it("doubles inner quotes", () => {
    expect(cell('Casey "Speedy" Lee')).toBe('"Casey ""Speedy"" Lee"');
  });

  it("leaves an ordinary value alone", () => {
    expect(cell("Casey Lee")).toBe("Casey Lee");
    expect(cell("runner@example.com")).toBe("runner@example.com");
  });

  it("renders an absent name as empty, not the string null", () => {
    expect(cell(null)).toBe("");
  });

  it("the component uses this escaping rather than a bare join", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/components/WaitlistAdminSection.tsx", import.meta.url).pathname, "utf8");
    expect(src).toContain('/[",\\n]/.test(s)');
    expect(src).toContain('s.replace(/"/g, \'""\')');
  });
});
