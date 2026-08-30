/**
 * Exhaustive unit tests for the connections service (src/server/connections.ts)
 * against an in-memory store (createMemoryStore), pinning the owner's six
 * named edge cases plus the store-level invariants:
 *   1. cross-pending requests auto-accept to exactly ONE accepted row;
 *   2. blocked users are excluded from mutual counts (third-party view);
 *   3. decline then request from EITHER side succeeds;
 *   4. remove soft-deletes (row persists, removedAt set) and a new request
 *      works after;
 *   5. visibilityOverride beats show_upcoming_events in canView;
 *   6. searchable_by_name=false hides from search for everyone (connections
 *      included) while direct canView visibility is unaffected.
 * Plus: one-active-row invariant, blocked pair can never hold an active row,
 * addressee-only accept/decline, idempotency, and connectionState.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStore, type Db } from "../src/server/store";
import {
  acceptConnection,
  blockConnection,
  connectionState,
  declineConnection,
  mutualConnections,
  removeConnection,
  requestConnection,
  searchable,
} from "../src/server/connections";
import { canView } from "../src/server/privacy";

const NOW = "2026-08-12T00:00:00.000Z";

interface Fixture { db: Db; a: string; b: string; c: string; d: string; }
function makeFixture(): Fixture {
  const db = createMemoryStore();
  const a = db.createAccount({ name: "A", email: "a@example.com" }).id;
  const b = db.createAccount({ name: "B", email: "b@example.com" }).id;
  const c = db.createAccount({ name: "C", email: "c@example.com" }).id;
  const d = db.createAccount({ name: "D", email: "d@example.com" }).id;
  return { db, a, b, c, d };
}

/** Full connect via the service: request + accept. */
function connect(db: Db, x: string, y: string): void {
  const req = requestConnection(db, x, y, new Date(NOW));
  if (!req.ok || !req.connection) throw new Error("request failed in helper");
  const acc = acceptConnection(db, y, req.connection.id, new Date(NOW));
  if (!acc.ok) throw new Error("accept failed in helper");
}

describe("requestConnection", () => {
  it("creates a pending row and reports it", () => {
    const { db, a, b } = makeFixture();
    const r = requestConnection(db, a, b, new Date(NOW));
    expect(r.ok).toBe(true);
    expect(r.status).toBe("pending");
    expect(r.resolved).toBeUndefined();
    expect(r.connection).toMatchObject({ requesterId: a, addresseeId: b, status: "pending", respondedAt: null, removedAt: null });
    expect(connectionState(db, a, b)).toBe("requested_by_me");
    expect(connectionState(db, b, a)).toBe("requested_to_me");
  });

  it("is idempotent: a same-direction duplicate returns the same row", () => {
    const { db, a, b } = makeFixture();
    const r1 = requestConnection(db, a, b, new Date(NOW));
    const r2 = requestConnection(db, a, b, new Date(NOW));
    expect(r1.ok && r2.ok).toBe(true);
    expect(r1.status).toBe("pending");
    expect(r2.status).toBe("pending");
    expect(r2.connection?.id).toBe(r1.connection?.id);
  });

  it("refuses self-connection", () => {
    const { db, a } = makeFixture();
    const r = requestConnection(db, a, a, new Date(NOW));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("cannot_connect_self");
  });
});

describe("EDGE CASE 1 — cross-pending auto-accept", () => {
  it("a reverse request auto-accepts to exactly one accepted row; both sides see connected", () => {
    const { db, a, b } = makeFixture();
    const r1 = requestConnection(db, a, b, new Date(NOW));
    expect(r1.status).toBe("pending");

    const r2 = requestConnection(db, b, a, new Date(NOW));
    expect(r2.ok).toBe(true);
    expect(r2.status).toBe("accepted");
    expect(r2.resolved).toBe(true); // reports the resolution
    // never a second row — the SAME row was updated
    expect(r2.connection?.id).toBe(r1.connection?.id);
    expect(r2.connection?.status).toBe("accepted");
    expect(r2.connection?.respondedAt).toBe(NOW);

    // exactly one row exists for the pair
    expect(db.listAcceptedConnections(a).length).toBe(1);
    expect(db.listAcceptedConnections(b).length).toBe(1);
    const pair = db.getConnectionPair(a, b);
    expect(pair).toBeDefined();
    expect(pair!.id).toBe(r1.connection!.id);

    // both sides see connected
    expect(connectionState(db, a, b)).toBe("connected");
    expect(connectionState(db, b, a)).toBe("connected");
  });

  it("store enforces the one-active-row invariant", () => {
    const { db, a, b } = makeFixture();
    requestConnection(db, a, b, new Date(NOW)); // active pending row
    expect(() =>
      db.upsertConnection({ id: "rogue", requesterId: b, addresseeId: a, status: "pending", createdAt: NOW, respondedAt: null, removedAt: null }),
    ).toThrow(/one-active-row/);
    // terminal history does NOT trigger the invariant (supersede is legal)
    db.upsertConnection({ id: "hist", requesterId: a, addresseeId: b, status: "declined", createdAt: NOW, respondedAt: NOW, removedAt: null });
    expect(db.getConnectionPair(a, b)?.status).toBe("declined");
  });
});

describe("EDGE CASE 2 — mutual counts exclude blocked users", () => {
  it("removes a blocked third party from the intersection for either profile", () => {
    const { db, a, b, c, d } = makeFixture();
    // a ↔ b connected, a ↔ c, a ↔ d; b ↔ c, b ↔ d
    connect(db, a, b);
    connect(db, a, c);
    connect(db, a, d);
    connect(db, b, c);
    connect(db, b, d);
    expect(mutualConnections(db, a, b).sort()).toEqual([c, d].sort());

    // a blocks c → c drops from the mutual count
    blockConnection(db, a, c, new Date(NOW));
    expect(mutualConnections(db, a, b)).toEqual([d]);
    // b blocks d → d drops from the mutual count (owner-side block)
    blockConnection(db, b, d, new Date(NOW));
    expect(mutualConnections(db, a, b)).toEqual([]);
  });

  it("never includes the viewer or the owner themselves", () => {
    const { db, a, b, c, d } = makeFixture();
    connect(db, a, b); // a ↔ b
    connect(db, a, c);
    connect(db, b, c);
    connect(db, b, d);
    // a's accepted: b, c | b's accepted: a, c, d → intersection incl. a and b
    expect(mutualConnections(db, a, b).sort()).toEqual([c]);
  });
});

describe("EDGE CASE 3 — decline then request from EITHER side", () => {
  it("decline retains the row, and a later request from either side creates a fresh pending row", () => {
    const { db, a, b } = makeFixture();
    const r1 = requestConnection(db, a, b, new Date(NOW));
    const dec = declineConnection(db, b, r1.connection!.id, new Date(NOW));
    expect(dec.ok).toBe(true);
    expect(dec.status).toBe("declined");
    expect(dec.connection?.respondedAt).toBe(NOW);
    expect(connectionState(db, a, b)).toBe("none");

    // requester side retries → fresh pending row
    const r2 = requestConnection(db, a, b, new Date(NOW));
    expect(r2.status).toBe("pending");
    expect(r2.connection?.id).not.toBe(r1.connection!.id);
    // decline again, then the OTHER side requests
    declineConnection(db, b, r2.connection!.id, new Date(NOW));
    const r3 = requestConnection(db, b, a, new Date(NOW));
    expect(r3.status).toBe("pending");
    expect(r3.connection?.requesterId).toBe(b);
    expect(connectionState(db, b, a)).toBe("requested_by_me");
  });
});

describe("EDGE CASE 4 — remove soft-deletes", () => {
  it("marks the active row removed (row persists, removedAt set, no hard delete) and a new request works after", () => {
    const { db, a, b } = makeFixture();
    connect(db, a, b);
    const before = db.getConnectionPair(a, b)!;
    const rm = removeConnection(db, a, b, new Date(NOW));
    expect(rm.ok).toBe(true);
    expect(rm.status).toBe("removed");

    // row persists — soft-deleted, not hard-deleted
    const after = db.getConnectionPair(a, b)!;
    expect(after).toBeDefined();
    expect(after.id).toBe(before.id); // SAME row
    expect(after.status).toBe("removed");
    expect(after.removedAt).toBe(NOW);
    expect(db.listActiveConnection(a, b)).toBeUndefined();
    expect(connectionState(db, a, b)).toBe("removed");

    // either side may request again
    const req = requestConnection(db, b, a, new Date(NOW));
    expect(req.status).toBe("pending");
    expect(req.connection?.requesterId).toBe(b);
    expect(connectionState(db, a, b)).toBe("requested_to_me");
  });

  it("remove on a non-existent/terminal pair is an error, not a crash", () => {
    const { db, a, b } = makeFixture();
    expect(removeConnection(db, a, b, new Date(NOW)).ok).toBe(false);
    const req = requestConnection(db, a, b, new Date(NOW));
    declineConnection(db, b, req.connection!.id, new Date(NOW));
    expect(removeConnection(db, a, b, new Date(NOW)).ok).toBe(false); // no ACTIVE row
  });
});

describe("EDGE CASE 5 — visibilityOverride beats show_upcoming_events in canView", () => {
  it("an accepted connection still cannot see an event the owner made private at the event level", () => {
    const { db, a, b } = makeFixture();
    connect(db, a, b);
    db.setPrivacy(a, { show_upcoming_events: "public" });
    db.addAttendance({ id: "att-ev1", accountId: a, eventId: "ev1", role: "rsvp", createdAt: NOW, visibilityOverride: "private" });
    expect(canView(db, b, a, "show_upcoming_events", { eventId: "ev1" })).toBe(false);
    expect(canView(db, b, a, "show_upcoming_events")).toBe(true); // global still public
  });

  it("a public event override opens an otherwise connections-only list to a stranger", () => {
    const { db, a, b } = makeFixture();
    db.setPrivacy(a, { show_upcoming_events: "connections_only" });
    db.addAttendance({ id: "att-ev2", accountId: a, eventId: "ev2", role: "rsvp", createdAt: NOW, visibilityOverride: "public" });
    expect(canView(db, b, a, "show_upcoming_events", { eventId: "ev2" })).toBe(true); // stranger sees it
    expect(canView(db, b, a, "show_upcoming_events")).toBe(false); // global still connections_only
  });
});

describe("EDGE CASE 6 — searchable_by_name is a search-index filter only", () => {
  it("hides the user from name search for strangers AND connections while canView stays true", () => {
    const { db, a, b, c } = makeFixture();
    connect(db, a, b);
    db.setPrivacy(a, { searchable_by_name: false, profile_visibility: "connections_only" });

    // search: nobody finds them — not strangers, not guests, not connections
    expect(searchable(db, c, a)).toBe(false);
    expect(searchable(db, b, a)).toBe(false);
    expect(searchable(db, null, a)).toBe(false);

    // direct visibility unaffected: the accepted connection still sees the profile
    expect(canView(db, b, a, "profile_visibility")).toBe(true);
    // public default still lets strangers view by id (connection list visibility follows the field)
    const { db: db2, a: a2, c: c2 } = makeFixture();
    db2.setPrivacy(a2, { searchable_by_name: false });
    expect(canView(db2, c2, a2, "profile_visibility")).toBe(true);

    // flipping it back restores searchability
    db.setPrivacy(a, { searchable_by_name: true });
    expect(searchable(db, c, a)).toBe(true);
  });
});

describe("accept/decline — addressee-only", () => {
  it("only the addressee of a pending row may act; existence is not leaked", () => {
    const { db, a, b, c } = makeFixture();
    const req = requestConnection(db, a, b, new Date(NOW));
    const rid = req.connection!.id;

    // requester and strangers get not_found
    expect(acceptConnection(db, a, rid, new Date(NOW)).error).toBe("not_found");
    expect(acceptConnection(db, c, rid, new Date(NOW)).error).toBe("not_found");
    expect(declineConnection(db, a, rid, new Date(NOW)).error).toBe("not_found");
    // unknown request id → not_found
    expect(acceptConnection(db, b, "nope", new Date(NOW)).error).toBe("not_found");

    // addressee accepts
    const acc = acceptConnection(db, b, rid, new Date(NOW));
    expect(acc.ok).toBe(true);
    expect(acc.status).toBe("accepted");
    expect(acc.connection?.respondedAt).toBe(NOW);
    expect(connectionState(db, a, b)).toBe("connected");

    // acting again on the resolved row → it is no longer an incoming request
    // (existence is not leaked): not_found
    expect(acceptConnection(db, b, rid, new Date(NOW)).error).toBe("not_found");
    expect(declineConnection(db, b, rid, new Date(NOW)).error).toBe("not_found");
  });

  it("accept refuses a blocked pair", () => {
    const { db, a, b } = makeFixture();
    const req = requestConnection(db, a, b, new Date(NOW));
    db.addBlock({ blockerId: b, blockedId: a, createdAt: NOW });
    const acc = acceptConnection(db, b, req.connection!.id, new Date(NOW));
    expect(acc.ok).toBe(false);
    /*
     * Was `.toBe("blocked")`. That assertion encoded the leak as correct: it
     * required the API to TELL a blocked person he was blocked, which is the
     * one thing the safety architecture forbids. Now indistinguishable from a
     * target that does not exist.
     */
    expect(acc.status).toBe("error");
    expect(acc.ok === false && acc.error).toBe("not_found");
    expect(db.getConnectionPair(a, b)?.status).toBe("pending"); // unchanged
  });
});

describe("blockConnection", () => {
  it("writes a block and marks any active connection row removed (pending or accepted)", () => {
    const { db, a, b } = makeFixture();
    // accepted pair
    connect(db, a, b);
    blockConnection(db, a, b, new Date(NOW));
    expect(db.isBlocked(a, b)).toBe(true);
    expect(db.isBlocked(b, a)).toBe(true); // bidirectional
    expect(db.getConnectionPair(a, b)?.status).toBe("removed");
    expect(db.listActiveConnection(a, b)).toBeUndefined();
    expect(connectionState(db, a, b)).toBe("removed");
    expect(canView(db, a, b, "profile_visibility")).toBe(false);

    // pending pair (reverse direction block)
    const { db: db2, a: a2, b: b2 } = makeFixture();
    const req = requestConnection(db2, a2, b2, new Date(NOW));
    expect(req.status).toBe("pending");
    blockConnection(db2, b2, a2, new Date(NOW));
    expect(db2.getConnectionPair(a2, b2)?.status).toBe("removed");
    expect(db2.listActiveConnection(b2, a2)).toBeUndefined();

    // a declined history row is left untouched
    const { db: db3, a: a3, b: b3 } = makeFixture();
    const req3 = requestConnection(db3, a3, b3, new Date(NOW));
    declineConnection(db3, b3, req3.connection!.id, new Date(NOW));
    blockConnection(db3, a3, b3, new Date(NOW));
    expect(db3.getConnectionPair(a3, b3)?.status).toBe("declined");
  });

  it("blocked pairs cannot create new requests from either side", () => {
    const { db, a, b } = makeFixture();
    blockConnection(db, a, b, new Date(NOW));
    // Both directions refuse identically, and identically to a missing person.
    expect(requestConnection(db, a, b, new Date(NOW)).status).toBe("error");
    expect(requestConnection(db, b, a, new Date(NOW)).status).toBe("error");
  });
});

describe("connectionState", () => {
  it("walks the full lifecycle and returns null for guests", () => {
    const { db, a, b } = makeFixture();
    expect(connectionState(db, null, a)).toBeNull();
    expect(connectionState(db, b, a)).toBe("none");

    const req = requestConnection(db, a, b, new Date(NOW));
    expect(connectionState(db, a, b)).toBe("requested_by_me");
    expect(connectionState(db, b, a)).toBe("requested_to_me");

    acceptConnection(db, b, req.connection!.id, new Date(NOW));
    expect(connectionState(db, a, b)).toBe("connected");

    removeConnection(db, a, b, new Date(NOW));
    expect(connectionState(db, a, b)).toBe("removed");

    // declined → nothing newer → "none"
    const { db: db2, a: a2, b: b2 } = makeFixture();
    const req2 = requestConnection(db2, a2, b2, new Date(NOW));
    declineConnection(db2, b2, req2.connection!.id, new Date(NOW));
    expect(connectionState(db2, a2, b2)).toBe("none");
  });
});
