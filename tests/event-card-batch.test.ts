/**
 * Four things specific to how run clubs work, all on one component.
 *
 * Three of the four were already declared in the type layer and consumed by
 * NOTHING — paceNote, meetTime and the no_drop enum value all existed and no
 * code path read them. Another instance of a capability with no path to it,
 * this time in a data model rather than an endpoint.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/server/store";
import { readCode } from "./helpers/source";

const MAPPER = readCode(new URL("../src/lib/mapRunEvent.ts", import.meta.url));
const BOARD = readCode(new URL("../src/components/DepartureBoard.tsx", import.meta.url));
const CHECKINS = readCode(new URL("../src/server/checkins.ts", import.meta.url));
const ROSTER = readCode(new URL("../src/pages/RosterPage.tsx", import.meta.url));

describe("no-drop is a badge, not prose", () => {
  it("derives from the enum rather than parsing the distance string", () => {
    /*
     * It already existed as a pacePolicy value and was only ever rendered
     * inside a pace label. Clubs ALSO write it into distanceLabel by hand —
     * "3–5 mi, no-drop pace" is the seeded example — where it is invisible at a
     * glance to the person it matters most to.
     */
    expect(MAPPER).toContain('noDrop: event.pacePolicy === "no_drop"');
    // Not string-matched out of prose, which would be a proxy for the fact.
    expect(MAPPER).not.toContain('distanceLabel.includes("no-drop")');
  });

  it("renders beside the name, where the decision is made", () => {
    expect(BOARD).toContain("No-drop");
    const badge = BOARD.indexOf("No-drop");
    const metrics = BOARD.indexOf('<Metric label="Pace"');
    expect(badge).toBeLessThan(metrics);
  });
});

describe("the pace note sits beside the enum, not instead of it", () => {
  it("keeps pacePolicy for filtering and adds the human line", () => {
    /*
     * "All paces" is a claim; "12:00/mi group led by Dana" is a promise with a
     * person attached. Replacing the enum with free text would break filtering
     * and make the machine-readable value unrecoverable.
     */
    expect(MAPPER).toContain("paceLow: event.pacePolicy ? PACE_POLICY_LABELS[event.pacePolicy]");
    expect(MAPPER).toContain("paceNote: event.paceNote ?? null");
  });

  it("renders it on the card", () => {
    expect(BOARD).toContain("{event.paceNote}");
  });
});

describe("meet time is a qualifier, not a headline", () => {
  it("renders only when it differs from the start", () => {
    /*
     * The run time is what someone plans around; the meet time stops them
     * missing the part where newcomers introduce themselves. Repeating the
     * start as "arrive 6:00" is noise, so absent means absent.
     */
    expect(BOARD).toContain("{event.meetTime ? (");
    expect(BOARD).toContain("· arrive {event.meetTime}");
  });

  it("does not replace the start time", () => {
    // The headline stays the run time.
    expect(MAPPER).toContain("meetTime: event.meetTime ?? null");
    expect(MAPPER).toContain("startsAt,");
  });
});

describe("the first-time flag is derived and leader-only", () => {
  it("is computed from the check-in count, not stored", () => {
    /*
     * A stored flag would need setting at RSVP time and clearing after the run,
     * and would drift the moment either step was missed. Derived is also
     * correct for someone who joined months ago and never showed up — which a
     * signup-time flag would get wrong.
     */
    expect(CHECKINS).toContain("firstTimeWithGroup: (lifetimeCheckins(db, acct.id).byGroup[ev.groupId] ?? 0) === 0");
  });

  it("is scoped to the group, not global", () => {
    // Someone with fifty runs at another club is still new to this one, and
    // that is what changes how the run goes.
    expect(CHECKINS).toContain("byGroup[ev.groupId]");
    expect(CHECKINS).not.toContain("lifetimeCheckins(db, acct.id).total === 0");
  });

  it("lives only on the roster, which is role-gated", () => {
    /*
     * Not surveillance: the roster is behind canManageCheckins, so this is
     * visible to a run leader and nobody else. If it ever appeared on an
     * attendee list it would tell everyone who the newcomer is.
     */
    expect(ROSTER).toContain("row.firstTimeWithGroup");
    const board = readCode(new URL("../src/components/DepartureBoard.tsx", import.meta.url));
    expect(board).not.toContain("firstTime");
  });

  it("is true for a real first-timer and false after one run", async () => {
    // With data on both sides, not an empty store.
    const db = createMemoryStore();
    db.addCheckin({
      id: "ci_1", eventId: "event:tue", occurrenceId: "event:tue:2026-08-01", runDate: "2026-08-01",
      groupId: "ctc", cityId: "columbia-mo", accountId: "acc_returning",
      checkedInBy: "acc_returning", checkedInAt: new Date().toISOString(), source: "qr",
    } as never);
    const { lifetimeCheckins } = await import("../src/server/checkins");
    expect((lifetimeCheckins(db, "acc_returning").byGroup.ctc ?? 0) === 0).toBe(false);
    expect((lifetimeCheckins(db, "acc_new").byGroup.ctc ?? 0) === 0).toBe(true);
  });
});
