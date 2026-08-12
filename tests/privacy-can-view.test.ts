/**
 * Exhaustive unit tests for canView — THE single visibility gate
 * (src/server/privacy.ts). Every visibility decision in the system must go
 * through this function; these tests pin the owner-locked semantics:
 *  - verbatim defaults per field;
 *  - blocked-beats-accepted (both directions);
 *  - directionality (connections_only passes only with an accepted row,
 *    either direction);
 *  - self always passes;
 *  - guests (null viewer) only see "public";
 *  - show_saved_events can never resolve to "public";
 *  - event-level visibilityOverride replaces the global setting for
 *    show_upcoming_events ("inherit" falls through — EDGE CASE 5 at unit
 *    level).
 */
import { describe, expect, it } from "vitest";
import { createMemoryStore, type Db } from "../src/server/store";
import { canView, PRIVACY_DEFAULTS, type PrivacyField } from "../src/server/privacy";
import type { AttendanceVisibility, ConnectionRecord, PrivacySettingsRecord } from "../src/server/types";

const FIELDS: PrivacyField[] = ["profile_visibility", "show_upcoming_events", "show_saved_events", "show_past_activity", "show_connections_list", "show_tagged_content"];
const NOW = "2026-08-12T00:00:00.000Z";

interface Fixture { db: Db; a: string; b: string; c: string; }
function makeFixture(): Fixture {
  const db = createMemoryStore();
  const a = db.createAccount({ name: "A Runner", email: "a@example.com" }).id;
  const b = db.createAccount({ name: "B Runner", email: "b@example.com" }).id;
  const c = db.createAccount({ name: "C Runner", email: "c@example.com" }).id;
  return { db, a, b, c };
}

/** Directly create an ACCEPTED connection row (store-level, keeps canView tests independent). */
function connect(db: Db, x: string, y: string): void {
  const rec: ConnectionRecord = { id: `c-${x}-${y}`, requesterId: x, addresseeId: y, status: "accepted", createdAt: NOW, respondedAt: NOW, removedAt: null };
  db.upsertConnection(rec);
}

function block(db: Db, x: string, y: string): void {
  db.addBlock({ blockerId: x, blockedId: y, createdAt: NOW });
}

function attend(db: Db, accountId: string, eventId: string, override: AttendanceVisibility = "inherit", occurrenceId?: string): void {
  db.addAttendance({ id: `att-${accountId}-${eventId}-${occurrenceId ?? "evt"}`, accountId, eventId, role: "rsvp", createdAt: NOW, occurrenceId, visibilityOverride: override });
}

describe("PRIVACY_DEFAULTS", () => {
  it("matches the verbatim owner spec", () => {
    expect(PRIVACY_DEFAULTS).toEqual({
      profile_visibility: "public",
      show_upcoming_events: "connections_only",
      show_saved_events: "private",
      show_past_activity: "public",
      show_connections_list: "connections_only",
      show_tagged_content: "connections_only",
      searchable_by_name: true,
    });
  });
  it("getPrivacy returns the defaults for an account with no record", () => {
    const { db, a } = makeFixture();
    const p = db.getPrivacy(a);
    expect(p).toEqual({ accountId: a, ...PRIVACY_DEFAULTS });
  });
});

describe("canView — default resolution per field", () => {
  it("resolves every default field exactly (stranger / guest / connection / self)", () => {
    const { db, a, b } = makeFixture();
    // profile_visibility: default public → everyone
    expect(canView(db, b, a, "profile_visibility")).toBe(true);
    expect(canView(db, null, a, "profile_visibility")).toBe(true);
    // show_upcoming_events: default connections_only → strangers and guests blocked
    expect(canView(db, b, a, "show_upcoming_events")).toBe(false);
    expect(canView(db, null, a, "show_upcoming_events")).toBe(false);
    // show_saved_events: default private → blocked even for connections
    connect(db, a, b);
    expect(canView(db, b, a, "show_saved_events")).toBe(false);
    // show_past_activity: default public → everyone
    expect(canView(db, b, a, "show_past_activity")).toBe(true);
    expect(canView(db, null, a, "show_past_activity")).toBe(true);
    // show_connections_list: default connections_only
    expect(canView(db, b, a, "show_connections_list")).toBe(true);
    // show_tagged_content: default connections_only
    expect(canView(db, b, a, "show_tagged_content")).toBe(true);
    // a stranger for the connections_only fields
    expect(canView(db, "stranger", a, "show_connections_list")).toBe(false);
    expect(canView(db, "stranger", a, "show_tagged_content")).toBe(false);
  });
});

describe("canView — blocked beats everything", () => {
  it("blocked beats accepted: false in BOTH directions for every field", () => {
    const { db, a, b } = makeFixture();
    connect(db, a, b);
    block(db, a, b); // a blocked b
    for (const field of FIELDS) {
      expect(canView(db, a, b, field), `viewer a → owner b (${field})`).toBe(false);
      expect(canView(db, b, a, field), `viewer b → owner a (${field})`).toBe(false);
    }
  });
  it("blocked beats an event-level public override", () => {
    const { db, a, b } = makeFixture();
    attend(db, a, "ev1", "public");
    block(db, a, b);
    expect(canView(db, b, a, "show_upcoming_events", { eventId: "ev1" })).toBe(false);
  });
});

describe("canView — directionality of connections_only", () => {
  it("connections_only passes only when an accepted row exists, either direction", () => {
    const { db, a, b } = makeFixture();
    // no row
    expect(canView(db, b, a, "show_connections_list")).toBe(false);
    // pending only (never accepted) → still false
    db.upsertConnection({ id: "c-pending", requesterId: a, addresseeId: b, status: "pending", createdAt: NOW, respondedAt: null, removedAt: null });
    expect(canView(db, b, a, "show_connections_list")).toBe(false);
    // resolve the pending row to terminal history (a fresh pending can never
    // coexist with an active row — the invariant), then accept
    db.upsertConnection({ id: "c-pending", requesterId: a, addresseeId: b, status: "declined", createdAt: NOW, respondedAt: NOW, removedAt: null });
    connect(db, a, b);
    // accepted a→b: both directions pass (store keys by sorted pair)
    expect(canView(db, b, a, "show_connections_list")).toBe(true);
    expect(canView(db, a, b, "show_connections_list")).toBe(true);
  });
});

describe("canView — self", () => {
  it("self always passes for every field (even private defaults)", () => {
    const { db, a } = makeFixture();
    for (const field of FIELDS) {
      expect(canView(db, a, a, field), field).toBe(true);
    }
    // ... even with event context and an override that would block others
    attend(db, a, "ev1", "private");
    expect(canView(db, a, a, "show_upcoming_events", { eventId: "ev1" })).toBe(true);
  });
});

describe("canView — guests (null viewer)", () => {
  it("guests only ever see public", () => {
    const { db, a } = makeFixture();
    // public fields pass
    expect(canView(db, null, a, "profile_visibility")).toBe(true);
    expect(canView(db, null, a, "show_past_activity")).toBe(true);
    // connections_only / private defaults fail
    expect(canView(db, null, a, "show_upcoming_events")).toBe(false);
    expect(canView(db, null, a, "show_connections_list")).toBe(false);
    expect(canView(db, null, a, "show_tagged_content")).toBe(false);
    expect(canView(db, null, a, "show_saved_events")).toBe(false);
    // an accepted connection never helps a guest
    connect(db, a, "x");
    expect(canView(db, null, a, "show_connections_list")).toBe(false);
  });
});

describe("canView — show_saved_events can never resolve to public", () => {
  it("setPrivacy rejects public for show_saved_events (write guard)", () => {
    const { db, a } = makeFixture();
    expect(() => db.setPrivacy(a, { show_saved_events: "public" as never })).toThrow();
    // valid values still work
    expect(db.setPrivacy(a, { show_saved_events: "connections_only" }).show_saved_events).toBe("connections_only");
    expect(db.setPrivacy(a, { show_saved_events: "private" }).show_saved_events).toBe("private");
  });
  it("canView clamps a corrupt stored public to false (read guard)", () => {
    const { db, a, b } = makeFixture();
    // White-box: inject a record that bypassed validation (corrupt/legacy data).
    const corrupt: PrivacySettingsRecord = { accountId: a, ...PRIVACY_DEFAULTS, show_saved_events: "public" as never };
    (db as unknown as { privacy: Map<string, PrivacySettingsRecord> }).privacy.set(a, corrupt);
    connect(db, a, b);
    expect(canView(db, b, a, "show_saved_events")).toBe(false);
    expect(canView(db, null, a, "show_saved_events")).toBe(false);
    // self still passes (self beats everything)
    expect(canView(db, a, a, "show_saved_events")).toBe(true);
  });
  it("setPrivacy validates every field and rejects unknown ones", () => {
    const { db, a } = makeFixture();
    expect(() => db.setPrivacy(a, { profile_visibility: "private" as never })).toThrow();
    expect(() => db.setPrivacy(a, { show_upcoming_events: "bogus" as never })).toThrow();
    expect(() => db.setPrivacy(a, { searchable_by_name: "yes" as never })).toThrow();
    expect(() => db.setPrivacy(a, { not_a_field: "x" } as never)).toThrow();
  });
});

describe("canView — event-level visibilityOverride", () => {
  it("override private + global public → false (with event context)", () => {
    const { db, a, b } = makeFixture();
    db.setPrivacy(a, { show_upcoming_events: "public" });
    attend(db, a, "ev1", "private");
    expect(canView(db, b, a, "show_upcoming_events", { eventId: "ev1" })).toBe(false);
    expect(canView(db, null, a, "show_upcoming_events", { eventId: "ev1" })).toBe(false);
    // same account, no event context → global public applies
    expect(canView(db, b, a, "show_upcoming_events")).toBe(true);
  });
  it("override public + global connections_only → true for a non-connection", () => {
    const { db, a, b } = makeFixture();
    db.setPrivacy(a, { show_upcoming_events: "connections_only" });
    attend(db, a, "ev1", "public");
    expect(canView(db, b, a, "show_upcoming_events", { eventId: "ev1" })).toBe(true); // stranger
    expect(canView(db, null, a, "show_upcoming_events", { eventId: "ev1" })).toBe(true); // guest
    expect(canView(db, b, a, "show_upcoming_events")).toBe(false); // no context → global
  });
  it("override inherit → global applies (EDGE CASE 5 at unit level)", () => {
    const { db, a, b } = makeFixture();
    db.setPrivacy(a, { show_upcoming_events: "public" });
    attend(db, a, "ev1", "inherit");
    expect(canView(db, b, a, "show_upcoming_events", { eventId: "ev1" })).toBe(true);
    db.setPrivacy(a, { show_upcoming_events: "connections_only" });
    expect(canView(db, b, a, "show_upcoming_events", { eventId: "ev1" })).toBe(false);
  });
  it("occurrence context refines the override to the exact occurrence", () => {
    const { db, a, b } = makeFixture();
    db.setPrivacy(a, { show_upcoming_events: "public" });
    attend(db, a, "ev1", "private", "event:ev1:2026-08-12");
    // exact occurrence → private override wins
    expect(canView(db, b, a, "show_upcoming_events", { eventId: "ev1", occurrenceId: "event:ev1:2026-08-12" })).toBe(false);
    // a different occurrence of the same event → falls back to the event-level
    // rows (still private) — no global leak for the same event
    expect(canView(db, b, a, "show_upcoming_events", { eventId: "ev1", occurrenceId: "event:ev1:2026-08-19" })).toBe(false);
    // an event with NO attendance rows → global applies
    expect(canView(db, b, a, "show_upcoming_events", { eventId: "ev2" })).toBe(true);
  });
  it("override only affects show_upcoming_events, never other fields", () => {
    const { db, a, b } = makeFixture();
    db.setPrivacy(a, { show_upcoming_events: "public", show_past_activity: "public" });
    attend(db, a, "ev1", "private");
    // show_past_activity ignores the event override entirely
    expect(canView(db, b, a, "show_past_activity", { eventId: "ev1" })).toBe(true);
    expect(canView(db, b, a, "show_upcoming_events", { eventId: "ev1" })).toBe(false);
  });
  it("attendance override lookup normalizes the event: prefix", () => {
    const { db, a, b } = makeFixture();
    db.setPrivacy(a, { show_upcoming_events: "public" });
    attend(db, a, "event:ev1", "private");
    expect(canView(db, b, a, "show_upcoming_events", { eventId: "ev1" })).toBe(false);
    expect(canView(db, b, a, "show_upcoming_events", { eventId: "event:ev1" })).toBe(false);
  });
});
