/**
 * My Runs / RSVP id-state regressions.
 *
 * Owner report: "Add to My Runs unsticks after switching tabs" — the button
 * reverted to un-RSVP'd after a reload/tab switch. Root cause: the RSVP API
 * persists attendance under the CANONICAL event id (`event:<id>`), while the
 * weekly feed renders seed refs / bare ids (`<id>`). The page compared them
 * verbatim, so every canonical RSVP appeared un-RSVP'd after a refetch.
 * These helpers normalize the comparison; the server remains the source of
 * truth (RSVP rows are fetched fresh on every mount).
 */
import { describe, expect, it } from "vitest";
import { bareEventId, occurrenceIdFor } from "../src/lib/dates";
import { isOccurrenceRsvped, rsvpedEventIds } from "../src/lib/myRuns";
import type { MyRunView } from "../src/lib/api";

const run = (overrides: Partial<MyRunView> = {}): MyRunView => ({
  id: "run-1",
  kind: "rsvp",
  cityId: "columbia-mo",
  groupId: "runcomo",
  eventId: "mon-social", // seed events come back BARE
  title: "Monday Social Run",
  date: "2026-08-03",
  time: "6:00 PM",
  location: "Courtyard",
  distanceLabel: "5K",
  rsvpedAt: "2026-08-01T12:00:00.000Z",
  kept: false,
  checkedIn: false,
  ...overrides,
});

describe("bareEventId — canonical prefix normalization", () => {
  it("strips exactly one canonical `event:` prefix", () => {
    expect(bareEventId("mon-social")).toBe("mon-social");
    expect(bareEventId("event:mon-social")).toBe("mon-social");
    expect(bareEventId("event:event:mon-social")).toBe("event:mon-social"); // one prefix only
  });
});

describe("occurrenceIdFor — canonical occurrence construction", () => {
  it("builds event:<id>:<date> without double-prefixing canonical ids", () => {
    expect(occurrenceIdFor("mon-social", "2026-08-03")).toBe("event:mon-social:2026-08-03");
    expect(occurrenceIdFor("event:mon-social", "2026-08-03")).toBe("event:mon-social:2026-08-03");
    // Colon-bearing canonical ids are preserved verbatim, never re-prefixed.
    expect(occurrenceIdFor("event:city:run", "2026-08-03")).toBe("event:city:run:2026-08-03");
  });
});

describe("rsvpedEventIds — Events feed button state after refetch", () => {
  it("matches seed ids against canonical `event:<id>` attendance rows", () => {
    const runs = [
      run({ id: "a1", eventId: "mon-social", occurrenceId: "event:mon-social:2026-08-03" }),
      run({ id: "a2", eventId: "event:trail-crew", occurrenceId: "event:trail-crew:2026-08-05" }),
      run({ id: "a3", eventId: "event:city:track", occurrenceId: "event:event:city:track:2026-08-06" }),
    ];
    const ids = rsvpedEventIds(runs);
    // The feed compares with bareEventId(e.id), so these must all be true.
    expect(ids.has(bareEventId("mon-social"))).toBe(true);
    expect(ids.has(bareEventId("trail-crew"))).toBe(true);
    expect(ids.has(bareEventId("event:trail-crew"))).toBe(true);
    expect(ids.has(bareEventId("city:track"))).toBe(true);
    // And a sibling id is not matched.
    expect(ids.has("thursday-track")).toBe(false);
  });

  it("never matches a run the runner did not RSVP", () => {
    expect(rsvpedEventIds([]).has("mon-social")).toBe(false);
  });
});

describe("isOccurrenceRsvped — exact-occurrence participation", () => {
  it("matches the exact occurrence only, tolerating id-prefix differences", () => {
    const runs = [run({ id: "a1", eventId: "event:mon-social", occurrenceId: "event:mon-social:2026-08-03" })];
    expect(isOccurrenceRsvped(runs, "mon-social", "event:mon-social:2026-08-03")).toBe(true);
    // Same event, different date — NOT participating.
    expect(isOccurrenceRsvped(runs, "mon-social", "event:mon-social:2026-08-10")).toBe(false);
    // Different event, same date — NOT participating.
    expect(isOccurrenceRsvped(runs, "trail-crew", "event:trail-crew:2026-08-03")).toBe(false);
  });

  it("never treats an event-level (occurrence-less) legacy row as participation", () => {
    const legacy = run({ id: "old", occurrenceId: undefined });
    expect(isOccurrenceRsvped([legacy], "mon-social", "event:mon-social:2026-08-03")).toBe(false);
  });
});
