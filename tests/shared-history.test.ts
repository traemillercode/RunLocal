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

describe("the mapper carries the pair fact to the card", () => {
  /*
   * IT DID NOT, and every server test passed anyway. The summary endpoint
   * returned runsWithYou, the card declared it, and mapRunEvent built its
   * Person objects from three fields — so the known-face line would have been
   * permanently invisible with nothing failing.
   *
   * The same shape as "a client path that stops one layer short of a user",
   * one layer further in: a field that stops one mapper short of the component.
   */
  it("Person is built with runsWithYou", () => {
    const mapper = readCode(new URL("../src/lib/mapRunEvent.ts", import.meta.url));
    expect(mapper).toContain("runsWithYou: a.runsWithYou ?? 0");
  });
});

describe("check-in names a person", () => {
  const API = readCode(new URL("../src/server/api.ts", import.meta.url));
  const PAGE = readCode(new URL("../src/pages/CheckinPage.tsx", import.meta.url));

  it("finds the strongest connection on this run, not a list", () => {
    // "Your 12th with CTC, and your 5th with Casey" is the same data as a tally
    // and it is about a person. A list of everyone is the record view again.
    expect(API).toContain("alsoHere: { name: account.name, runsTogether: best }");
  });

  it("goes through coAttendanceForOccurrence, so hiddenFrom applies", () => {
    // A blocked person must never be named in a confirmation.
    const at = API.indexOf("alsoHere:");
    expect(API.slice(Math.max(0, at - 900), at)).toContain("coAttendanceForOccurrence(db, runner.id, others)");
  });

  it("omits the field entirely when there is no shared history", () => {
    // Rather than sending zero and having the client decide — an absent fact
    // and a fact that is zero are different things.
    const at = API.indexOf("alsoHere:");
    expect(API.slice(at, at + 200)).toContain(": {}");
  });

  it("uses the first name only", () => {
    // A surname adds nothing to a sentence about someone you have run with
    // five times.
    expect(PAGE).toContain("also.name.trim().split(/\\s+/)[0]");
  });
});

describe("discussion activity is visible before committing", () => {
  const API = readCode(new URL("../src/server/api.ts", import.meta.url));
  const BOARD = readCode(new URL("../src/components/DepartureBoard.tsx", import.meta.url));

  it("sends the count and recency", () => {
    /*
     * The discussion was invisible until after RSVP, so the thing that makes a
     * run feel alive sat behind the decision it should inform.
     */
    expect(API).toContain("discussionCount: discussions.length");
    expect(API).toContain("lastDiscussionAt: lastAt || null");
  });

  it("sends NO content, author or identity", () => {
    /*
     * Metadata only. A count says a run is active; it does not say who is on
     * it, which is what keeps this off the identity surfaces entirely.
     */
    const at = API.indexOf("discussionCount: discussions.length");
    const block = API.slice(Math.max(0, at - 300), at + 300);
    expect(block).not.toContain("body");
    expect(block).not.toContain("authorId");
  });

  it("renders on the card", () => {
    expect(BOARD).toContain("event.discussionCount && event.discussionCount > 0");
    expect(BOARD).toContain("message{event.discussionCount === 1");
  });
});

describe("newcomers: an aggregate over others, made safe by three constraints", () => {
  /*
   * This is the first thing in the product that counts other people's history.
   * "4 people are new to this run too" is the most reassuring thing you can
   * tell someone in a car park deciding whether to get out — and it is only
   * safe because of what it withholds.
   */
  function withCheckins(attendees: { id: string; ranBefore: boolean }[]) {
    const db = createMemoryStore();
    for (const a of attendees) {
      db.createAccount({ name: a.id, email: `${a.id}@x.com`, cityId: "columbia-mo" });
      if (a.ranBefore) {
        db.addCheckin({
          id: `ci_${a.id}`, eventId: "event:tue", occurrenceId: "event:tue:2026-07-01",
          runDate: "2026-07-01", groupId: "ctc", cityId: "columbia-mo", accountId: a.id,
          checkedInBy: a.id, checkedInAt: new Date().toISOString(), source: "qr",
        } as never);
      }
    }
    return db;
  }
  const six = ["me", "n1", "n2", "n3", "r1", "r2"];

  it("counts other first-timers when the viewer is new", async () => {
    const { otherNewcomers } = await import("../src/server/sharedHistory");
    const db = withCheckins([
      { id: "me", ranBefore: false }, { id: "n1", ranBefore: false }, { id: "n2", ranBefore: false },
      { id: "n3", ranBefore: false }, { id: "r1", ranBefore: true }, { id: "r2", ranBefore: true },
    ]);
    expect(otherNewcomers(db, "me", "ctc", six, true)).toBe(3);
  });

  it("CONSTRAINT 1 — a regular gets zero, not the composition", async () => {
    /*
     * A regular does not need reassurance and has no business receiving the
     * group's makeup. The number answers "will I be the only new person", which
     * is a question only a new person has.
     */
    const { otherNewcomers } = await import("../src/server/sharedHistory");
    const db = withCheckins([
      { id: "me", ranBefore: true }, { id: "n1", ranBefore: false }, { id: "n2", ranBefore: false },
      { id: "n3", ranBefore: false }, { id: "r1", ranBefore: true }, { id: "r2", ranBefore: true },
    ]);
    expect(otherNewcomers(db, "me", "ctc", six, false)).toBe(0);
  });

  it("CONSTRAINT 3 — suppressed below five going", async () => {
    /*
     * At low N composition is inferable: with two attendees, "one other is new"
     * states that person's history exactly. Five is the same floor the
     * architecture uses for counts, for the same reason.
     */
    const { otherNewcomers } = await import("../src/server/sharedHistory");
    const four = ["me", "n1", "n2", "r1"];
    const db = withCheckins([
      { id: "me", ranBefore: false }, { id: "n1", ranBefore: false },
      { id: "n2", ranBefore: false }, { id: "r1", ranBefore: true },
    ]);
    expect(otherNewcomers(db, "me", "ctc", four, true)).toBe(0);
  });

  it("CONSTRAINT 2 — the card renders a count and no names", () => {
    // Who is new is the leader's business. On an attendee list it would point
    // at the newcomer for everyone.
    const board = readCode(new URL("../src/components/DepartureBoard.tsx", import.meta.url));
    expect(board).toContain("{otherNewcomers} others are new to this run too");
    const at = board.indexOf("others are new to this run too");
    expect(board.slice(Math.max(0, at - 400), at)).not.toContain("initials");
  });

  it("excludes hidden people from the count", async () => {
    // A blocked person must not be counted as a fellow newcomer.
    const { otherNewcomers } = await import("../src/server/sharedHistory");
    const db = withCheckins([
      { id: "me", ranBefore: false }, { id: "n1", ranBefore: false }, { id: "n2", ranBefore: false },
      { id: "n3", ranBefore: false }, { id: "r1", ranBefore: true }, { id: "r2", ranBefore: true },
    ]);
    const meAcc = [...db.listAccounts()].find((a) => a.name === "me")!;
    const n1 = [...db.listAccounts()].find((a) => a.name === "n1")!;
    db.addBlock({ blockerId: meAcc.id, blockedId: n1.id, createdAt: new Date().toISOString() } as never);
    const ids = [meAcc.id, n1.id, "n2", "n3", "r1", "r2"];
    expect(otherNewcomers(db, meAcc.id, "ctc", ids, true)).toBeLessThan(3);
  });

  it("takes precedence over the known-face line", () => {
    // If you have run with someone here you are not new, so the two cannot both
    // apply — and rendering both would say contradictory things.
    const board = readCode(new URL("../src/components/DepartureBoard.tsx", import.meta.url));
    expect(board).toContain("(otherNewcomers ?? 0) > 0 ? (");
    expect(board.indexOf("otherNewcomers ?? 0) > 0")).toBeLessThan(board.indexOf("knownFace ? ("));
  });
});
