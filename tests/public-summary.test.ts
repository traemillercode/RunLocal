/**
 * Public going-counts (roadmap 1.4 support).
 *
 * The privacy boundary is the whole point of this endpoint existing separately:
 * the marketing preview needs to prove the community is active, but an
 * anonymous visitor must never receive member identities. A count cannot
 * identify anyone; a name or a set of initials can.
 */
import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiHandler } from "../src/server/api";
import { createMemoryStore, type Db } from "../src/server/store";

function req(method: string, path: string, cookie?: string): IncomingMessage {
  let done = false;
  const headers: Record<string, string> = { "x-forwarded-proto": "https" };
  if (cookie) headers.cookie = cookie;
  return { method, url: path, headers, socket: { remoteAddress: "127.0.0.1" },
    [Symbol.asyncIterator]() { return { next: async () => done ? { done: true as const, value: undefined } : (done = true, { done: false as const, value: Buffer.from("") }) }; } } as unknown as IncomingMessage;
}
async function call(db: Db, path: string, cookie?: string) {
  const out = { status: 0, body: "", headers: {} as Record<string, string> };
  const res = { writeHead(s: number, h?: Record<string, string>) { out.status = s; Object.assign(out.headers, h ?? {}); return res; },
    setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = v; return res; },
    end(v?: unknown) { if (v !== undefined) out.body += String(v); return res; } } as unknown as ServerResponse;
  await apiHandler(req("GET", path, cookie), res, db);
  return { ...out, json: out.body ? JSON.parse(out.body) : {} };
}
function account(db: Db, name: string) {
  const a = db.createAccount({ name, email: `${name.replace(/\s/g, "").toLowerCase()}@example.com`, cityId: "columbia-mo" });
  db.updateAccount(a.id, { status: "verified" });
  return a.id;
}

const OCC = "event:tuesday-tempo:2026-09-01";

function seed(db: Db, goers: number, withHost = true) {
  if (withHost) db.addAttendance({ id: "att-host", accountId: account(db, "Casey Host"), eventId: "tuesday-tempo", role: "host", createdAt: new Date().toISOString(), occurrenceId: OCC } as never);
  for (let i = 0; i < goers; i++) {
    db.addAttendance({ id: `att-${i}`, accountId: account(db, `Runner ${i}`), eventId: "tuesday-tempo", role: "rsvp", createdAt: new Date().toISOString(), occurrenceId: OCC } as never);
  }
}

describe("public going-counts", () => {
  it("returns a real count with NO authentication", async () => {
    const db = createMemoryStore();
    seed(db, 12);
    const r = await call(db, `/api/events/public-summary?ids=${encodeURIComponent(OCC)}`);
    expect(r.status).toBe(200);
    expect(r.json.summaries).toEqual([{ eventId: OCC, goingCount: 12 }]);
  });

  it("leaks NOTHING beyond eventId and goingCount", async () => {
    const db = createMemoryStore();
    seed(db, 3);
    const r = await call(db, `/api/events/public-summary?ids=${encodeURIComponent(OCC)}`);
    // The failure this guards against is a well-meaning future edit adding
    // "just the host name" or "first four initials" for a richer preview.
    expect(Object.keys(r.json.summaries[0]).sort()).toEqual(["eventId", "goingCount"]);
    const raw = r.body.toLowerCase();
    for (const leak of ["runner", "casey", "host", "initials", "avatar", "email", "accountid"]) {
      expect(raw).not.toContain(leak);
    }
  });

  it("is cacheable, since every marketing view and crawler hit lands here", async () => {
    const db = createMemoryStore();
    seed(db, 1);
    const r = await call(db, `/api/events/public-summary?ids=${encodeURIComponent(OCC)}`);
    expect(r.headers["cache-control"]).toContain("max-age");
  });

  it("reports zero for an occurrence nobody has joined, rather than omitting it", async () => {
    const db = createMemoryStore();
    const r = await call(db, "/api/events/public-summary?ids=event:nobody:2026-09-01");
    // The marketing page needs a number for every card it renders; a missing
    // key would render as blank rather than as an honest 0.
    expect(r.json.summaries).toEqual([{ eventId: "event:nobody:2026-09-01", goingCount: 0 }]);
  });

  it("excludes the host from the going count", async () => {
    const db = createMemoryStore();
    seed(db, 2);
    const r = await call(db, `/api/events/public-summary?ids=${encodeURIComponent(OCC)}`);
    expect(r.json.summaries[0].goingCount).toBe(2);
  });

  it("caps the id list so the endpoint can't be used to sweep the whole store", async () => {
    const db = createMemoryStore();
    const many = Array.from({ length: 60 }, (_, i) => `event:x:${i}`).join(",");
    const r = await call(db, `/api/events/public-summary?ids=${many}`);
    expect(r.json.summaries).toHaveLength(20);
  });
});
