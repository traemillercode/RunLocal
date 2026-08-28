/**
 * Pace policy: the field that answers "will I get dropped?".
 *
 * Stored as a closed set rather than a numeric range because that is what
 * Columbia hosts actually advertise ("no-drop", "all paces"), and as an
 * optional field so the seven events written before it existed stay valid.
 * Legacy records resolve a policy from the old combined "Distance / pace"
 * free text at read time rather than rendering a blank badge.
 */
import { describe, expect, it } from "vitest";
import { PACE_POLICIES, PACE_POLICY_LABELS, isPacePolicy, pacePolicyFromLabel } from "../src/types";
import { createMemoryStore } from "../src/server/store";
import { publicEvents, withResolvedPacePolicy } from "../src/server/events";
import type { RunEventRecord } from "../src/server/types";

function record(over: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "evt-1", seedRefId: null, cityId: "columbia-mo", groupId: "g1", title: "Tuesday Speed",
    dayOfWeek: 1, time: "6:00 PM", location: "Stankowski Field", distanceLabel: "3–5 mi",
    invite: "Open to all", externalUrl: null, provenance: "community", status: "published",
    hidden: false, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    createdBy: "u1", updatedBy: "u1", archivedAt: null, ...over,
  };
}

describe("pace policy vocabulary", () => {
  it("labels every policy in the closed set, so no value can render blank", () => {
    for (const p of PACE_POLICIES) {
      expect(PACE_POLICY_LABELS[p]).toBeTruthy();
    }
  });

  it("accepts only known values", () => {
    expect(isPacePolicy("no_drop")).toBe(true);
    expect(isPacePolicy("No-drop")).toBe(false);
    expect(isPacePolicy("nodrop")).toBe(false);
    expect(isPacePolicy(null)).toBe(false);
    expect(isPacePolicy(7)).toBe(false);
  });
});

describe("deriving policy from the legacy combined label", () => {
  it.each([
    ["3–5 mi, no-drop pace", "no_drop"],
    ["6–12 mi, group splits by pace", "splits_by_pace"],
    ["1–8 mi intervals, all paces", "all_paces"],
    ["2–4 mi, walkers welcome", "walkers_welcome"],
    ["3–4 mi, easy", "easy"],
  ])("maps the real seed value %s", (label, expected) => {
    expect(pacePolicyFromLabel(label)).toBe(expected);
  });

  it("returns null rather than guessing when the text says nothing about pace", () => {
    expect(pacePolicyFromLabel("4–6 mi, hilly")).toBeNull();
    expect(pacePolicyFromLabel("")).toBeNull();
    expect(pacePolicyFromLabel(null)).toBeNull();
  });
});

describe("read-time resolution", () => {
  it("fills a policy for records written before the field existed", () => {
    const resolved = withResolvedPacePolicy(record({ distanceLabel: "3–5 mi, no-drop pace" }));
    expect(resolved.pacePolicy).toBe("no_drop");
  });

  it("never overrides what the host actually chose", () => {
    // Label says easy, host explicitly selected workout — the choice wins.
    const resolved = withResolvedPacePolicy(record({ distanceLabel: "3–4 mi, easy", pacePolicy: "workout" }));
    expect(resolved.pacePolicy).toBe("workout");
  });

  it("preserves an explicit null — the host said nothing and we do not invent it", () => {
    const resolved = withResolvedPacePolicy(record({ distanceLabel: "3–5 mi, no-drop pace", pacePolicy: null }));
    expect(resolved.pacePolicy).toBeNull();
  });

  it("resolves through the public read path", () => {
    const db = createMemoryStore();
    db.setEvent(record({ distanceLabel: "6–12 mi, group splits by pace" }));
    const [event] = publicEvents(db, "columbia-mo");
    expect(event.pacePolicy).toBe("splits_by_pace");
  });
});
