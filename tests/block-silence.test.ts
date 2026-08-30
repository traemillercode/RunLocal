/**
 * A blocked person must never learn that he is blocked.
 *
 * "A stalker who learns he is blocked escalates, and often escalates offline."
 * So every refusal caused by a block must be byte-identical to the ordinary
 * refusal for a thing that is not there — same code, same status, same shape.
 *
 * Six places returned an explicit `blocked` error. The worst was the join
 * request: he asks to connect and the product tells him she blocked him.
 */
import { describe, expect, it } from "vitest";
import { readCode } from "./helpers/source";
import { createMemoryStore } from "../src/server/store";
import { requestConnection, acceptConnection } from "../src/server/connections";

const SERVER = readCode(new URL("../src/server/api.ts", import.meta.url));
const CONN = readCode(new URL("../src/server/connections.ts", import.meta.url));

describe("no refusal names the block", () => {
  it("no server file returns a 'blocked' error code", () => {
    // Structural, because a single new one reopens the whole hole.
    for (const [name, src] of [["api.ts", SERVER], ["connections.ts", CONN]] as const) {
      expect(src, name).not.toContain('error: "blocked"');
      expect(src, name).not.toContain('error:"blocked"');
    }
  });

  it("a blocked connection request is indistinguishable from a missing person", () => {
    /*
     * WITH REAL DATA AND A BLOCKED VIEWER, not an empty store. An empty render
     * passes for the wrong reason and keeps passing when the filter is removed
     * — that has caught us on EventDetailPage initials, the Explore dropdown,
     * and the notifications banner.
     *
     * Here: two accounts that genuinely exist, one blocking the other. The
     * refusal must match the refusal for an id that was never real.
     */
    const db = createMemoryStore();
    const alice = db.createAccount({ name: "Alice", email: "a@x.com", cityId: "columbia-mo" });
    const bob = db.createAccount({ name: "Bob", email: "b@x.com", cityId: "columbia-mo" });
    db.addBlock({ blockerId: alice.id, blockedId: bob.id, createdAt: new Date().toISOString() } as never);

    const blocked = requestConnection(db, bob.id, alice.id);
    const missing = requestConnection(db, bob.id, "acc_never_existed");

    expect(blocked.ok).toBe(false);
    expect(missing.ok).toBe(false);
    if (!blocked.ok && !missing.ok) {
      // The whole property, in one line: he cannot tell these apart.
      expect(blocked.error).toBe(missing.error);
      expect(blocked.status).toBe(missing.status);
    }
  });

  it("accepting a request from someone who blocked you looks like no request", () => {
    const db = createMemoryStore();
    const alice = db.createAccount({ name: "Alice", email: "a2@x.com", cityId: "columbia-mo" });
    const bob = db.createAccount({ name: "Bob", email: "b2@x.com", cityId: "columbia-mo" });
    const req = requestConnection(db, bob.id, alice.id);
    expect(req.ok).toBe(true); // a real pending request exists first
    db.addBlock({ blockerId: alice.id, blockedId: bob.id, createdAt: new Date().toISOString() } as never);

    const afterBlock = acceptConnection(db, alice.id, req.ok && req.connection ? req.connection.id : "");
    const neverExisted = acceptConnection(db, alice.id, "conn_never_existed");
    expect(afterBlock.ok).toBe(false);
    if (!afterBlock.ok && !neverExisted.ok) {
      expect(afterBlock.error).toBe(neverExisted.error);
    }
  });

  it("the join-request path returns 404 not_found, matching its neighbours", () => {
    // It returned 403 "blocked" two lines below a 404 not_found for a target
    // that does not exist — the difference was the entire tell.
    const at = SERVER.indexOf("db.isBlocked(s.accountId,target)");
    expect(at).toBeGreaterThan(-1);
    expect(SERVER.slice(at, at + 120)).toContain('status:404,error:"not_found"');
  });
});

describe("counts are computed identically for every viewer", () => {
  it("no count or summary function takes a viewer", () => {
    /*
     * The constraint that keeps blocks un-inferable: if he sees 11 where
     * everyone else sees 12, the block is readable and we have made things
     * worse. Filtering happens at the IDENTITY layer, never the aggregate.
     *
     * Structural rather than remembered — a count that accepts a viewer is a
     * count that can differ by viewer.
     */
    const offenders: string[] = [];
    for (const src of [SERVER, CONN]) {
      for (const m of src.matchAll(/function (\w*(?:[Cc]ount|[Ss]ummary)\w*)\s*\(([^)]*)\)/g)) {
        if (/viewer|viewerId/i.test(m[2])) offenders.push(m[1]);
      }
    }
    expect(offenders).toEqual([]);
  });
});
