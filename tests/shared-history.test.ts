/**
 * Shared history — the thing the product did not know.
 *
 * Kimbio stores attendance, group membership, connections and run-day history,
 * and rendered every one as a record rather than as people. Nothing knew you
 * had run with someone before, which is the fact that turns a headcount into a
 * reason to go and a stranger into a not-stranger.
 *
 * A query, not a schema: co-attendance is the intersection of two calls that
 * already existed.
 */
import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/server/store";
import { coAttendanceCount, coAttendanceForOccurrence, sharedGroups } from "../src/server/sharedHistory";
import { readCode } from "./helpers/source";

function attend(db: ReturnType<typeof createMemoryStore>, accountId: string, occurrenceId: string) {
  db.addAttendance({
    id: `att_${accountId}_${occurrenceId}`,
    accountId,
    eventId: occurrenceId.split(":").slice(0, 2).join(":"),
    occurrenceId,
    role: "rsvp",
    createdAt: new Date().toISOString(),
  } as never);
}

function fixture() {
  const db = createMemoryStore();
  const me = db.createAccount({ name: "Me", email: "me@x.com", cityId: "columbia-mo" });
  const casey = db.createAccount({ name: "Casey Lee", email: "c@x.com", cityId: "columbia-mo" });
  const stranger = db.createAccount({ name: "Stranger", email: "s@x.com", cityId: "columbia-mo" });
  for (const a of [me, casey, stranger]) db.updateAccount(a.id, { status: "verified" });
  return { db, me, casey, stranger };
}

describe("counting runs together", () => {
  it("counts occurrences both attended", () => {
    const { db, me, casey } = fixture();
    for (const d of ["01", "08", "15"]) { attend(db, me.id, `event:tue:2026-08-${d}`); attend(db, casey.id, `event:tue:2026-08-${d}`); }
    expect(coAttendanceCount(db, me.id, casey.id)).toBe(3);
  });

  it("does not count runs only one of you attended", () => {
    // WITH DATA ON BOTH SIDES — a zero from an empty store passes for the wrong
    // reason and keeps passing when the intersection is removed.
    const { db, me, casey } = fixture();
    attend(db, me.id, "event:tue:2026-08-01");
    attend(db, casey.id, "event:tue:2026-08-01");
    attend(db, me.id, "event:tue:2026-08-08");   // only me
    attend(db, casey.id, "event:sat:2026-08-09"); // only Casey
    expect(coAttendanceCount(db, me.id, casey.id)).toBe(1);
  });

  it("is zero for someone you have never run with", () => {
    const { db, me, stranger } = fixture();
    attend(db, me.id, "event:tue:2026-08-01");
    attend(db, stranger.id, "event:sat:2026-08-09");
    expect(coAttendanceCount(db, me.id, stranger.id)).toBe(0);
  });

  it("is zero against yourself", () => {
    // Otherwise every run you attended would count as shared with yourself.
    const { db, me } = fixture();
    attend(db, me.id, "event:tue:2026-08-01");
    expect(coAttendanceCount(db, me.id, me.id)).toBe(0);
  });

  it("ignores legacy rows with no occurrenceId", () => {
    /*
     * Comparing an event id to an occurrence id would inflate the number, and
     * an inflated shared-history count is worse than none — it claims a
     * relationship that did not happen.
     */
    const { db, me, casey } = fixture();
    db.addAttendance({ id: "legacy_me", accountId: me.id, eventId: "event:tue", role: "rsvp", createdAt: new Date().toISOString() } as never);
    db.addAttendance({ id: "legacy_c", accountId: casey.id, eventId: "event:tue", role: "rsvp", createdAt: new Date().toISOString() } as never);
    expect(coAttendanceCount(db, me.id, casey.id)).toBe(0);
  });
});

describe("the safety property is the SHAPE of the question", () => {
  it("only ever counts runs the VIEWER attended", () => {
    /*
     * THE REASON THIS IS SAFE RATHER THAN MERELY FILTERED. Every occurrence
     * counted is one the viewer was standing at, so it is impossible for the
     * number to reveal a run they could not otherwise see. No filter is doing
     * that work — the definition is.
     *
     * Asserted structurally: the viewer's own set is the one being intersected
     * against, and an empty viewer history can only produce zero.
     */
    const { db, me, casey } = fixture();
    for (const d of ["01", "08"]) attend(db, casey.id, `event:secret:2026-08-${d}`);
    // The viewer attended nothing, so there is nothing to learn about Casey.
    expect(coAttendanceCount(db, me.id, casey.id)).toBe(0);

    const src = readCode(new URL("../src/server/sharedHistory.ts", import.meta.url));
    expect(src).toContain("if (mine.size === 0) return 0;");
  });

  it("a hidden person never surfaces on an occurrence", () => {
    // Blocked, deleted or suspended — hiddenFrom covers all three, so a blocked
    // person cannot appear as shared history.
    const { db, me, casey } = fixture();
    for (const d of ["01", "08"]) { attend(db, me.id, `event:tue:2026-08-${d}`); attend(db, casey.id, `event:tue:2026-08-${d}`); }
    expect(coAttendanceForOccurrence(db, me.id, [casey.id]).get(casey.id)).toBe(2);

    db.addBlock({ blockerId: me.id, blockedId: casey.id, createdAt: new Date().toISOString() } as never);
    expect(coAttendanceForOccurrence(db, me.id, [casey.id]).has(casey.id)).toBe(false);
  });

  it("excludes the viewer from their own occurrence map", () => {
    const { db, me } = fixture();
    attend(db, me.id, "event:tue:2026-08-01");
    expect(coAttendanceForOccurrence(db, me.id, [me.id]).has(me.id)).toBe(false);
  });
});

describe("shared groups", () => {
  it("reports groups you are both ACTIVE in", () => {
    const { db, me, casey } = fixture();
    db.upsertGroup({ id: "ctc", name: "Columbia Track Club", cityId: "columbia-mo", ownerId: me.id } as never);
    for (const accountId of [me.id, casey.id]) {
      db.addMembership({
        id: `m_${accountId}`, groupId: "ctc", accountId, cityId: "columbia-mo",
        status: "active", requestedAt: new Date().toISOString(),
      } as never);
    }
    const names = sharedGroups(db, me.id, casey.id).map((x) => x.name);
    expect(names).toContain("Columbia Track Club");
  });

  it("is reported alongside co-attendance, not folded into it", () => {
    /*
     * Being in a club together is weaker evidence than having run together, so
     * one number covering both would overstate the weaker case.
     */
    const src = readCode(new URL("../src/server/sharedHistory.ts", import.meta.url));
    expect(src).toContain("runsTogether: coAttendanceCount(db, viewerId, otherId)");
    expect(src).toContain("groups: sharedGroups(db, viewerId, otherId)");
  });
});

describe("the board names who you know", () => {
  const API = readCode(new URL("../src/server/api.ts", import.meta.url));
  const BOARD = readCode(new URL("../src/components/DepartureBoard.tsx", import.meta.url));

  it("sorts the visible attendees by co-attendance", () => {
    // So the four names shown are the four you know, rather than the first four
    // in insertion order. That is the difference between a headcount and a
    // reason to go.
    expect(API).toContain("coAttendanceForOccurrence(db, s.accountId, bucket.goingAccountIds)");
    expect(API).toContain(".sort((a, b) => (coAttendance.get(b) ?? 0) - (coAttendance.get(a) ?? 0))");
  });

  it("does NOT change the count or the cap", () => {
    /*
     * Reordering which names fill the four is all this does. If the count moved
     * with the viewer, a blocked person would see a different number and the
     * block would be readable off the card.
     */
    expect(API).toContain("goingCount: bucket.goingAccountIds.length");
    expect(API).toContain(".slice(0, 4)");
  });

  it("names one person, not a list", () => {
    // A list of everyone you have met is a roster again, and the point is one
    // recognisable person.
    expect(BOARD).toContain("const knownFace = (attendees ?? []).find((p) => (p.runsWithYou ?? 0) > 0) ?? null;");
  });

  it("uses initials, keeping Person nameless", () => {
    /*
     * Person deliberately carries no name — the identity-surface decision from
     * the safety work. Widening it to make a sentence read better would undo
     * that on every card.
     */
    const at = BOARD.indexOf("knownFace.initials");
    expect(at).toBeGreaterThan(-1);
    expect(BOARD).not.toContain("knownFace.name");
  });
});

describe("the profile shows the pair fact", () => {
  const PAGE = readCode(new URL("../src/pages/RunnerProfilePage.tsx", import.meta.url));

  it("renders runs together and shared groups", () => {
    expect(PAGE).toContain("of the same run");
    expect(PAGE).toContain("Both in {sharedGroupNames.join");
  });

  it("puts shared history above mutual connections", () => {
    // Having RUN with someone is stronger evidence than sharing a contact, and
    // stronger facts go first.
    expect(PAGE.indexOf("of the same run")).toBeLessThan(PAGE.indexOf("mutual connection"));
  });

  it("shows nothing when there is no shared history", () => {
    // An empty "0 runs together" panel on every stranger's profile is furniture.
    expect(PAGE).toContain("runsTogether > 0 || sharedGroupNames.length > 0 ?");
  });
});
