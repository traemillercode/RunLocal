/**
 * The attendee list, expandable, with a block on every name.
 *
 * THE DECISION POINT. Every other block entry point is somewhere she has
 * already engaged; this is where she is looking at Saturday deciding whether to
 * go, and his name may be the fifth — past the four the card renders.
 */
import { describe, expect, it } from "vitest";
import { readCode } from "./helpers/source";
import { readFileSync } from "node:fs";

const API = readCode(new URL("../src/server/api.ts", import.meta.url));
const SHEET = readCode(new URL("../src/components/AttendeeListSheet.tsx", import.meta.url));
const BOARD = readCode(new URL("../src/components/DepartureBoard.tsx", import.meta.url));

describe("the full list is filtered, the count is not", () => {
  it("the endpoint filters through hiddenFrom", () => {
    /*
     * Expanding past four is safe BECAUSE of this, not despite the cap. The cap
     * stops the list length revealing how many are hiding; it was never a limit
     * on how many names a member may see.
     */
    const at = API.indexOf("const occAttendees =");
    const handler = API.slice(at, at + 1200);
    expect(handler).toContain("hiddenFrom(db, sess.accountId)");
    expect(handler).toContain("!hidden.has(a.accountId)");
  });

  it("the card's count does NOT come from this list", () => {
    /*
     * THE LEAK I COULD MOST EASILY HAVE INTRODUCED. If the count were derived
     * from the filtered list, a blocked person would see a smaller number than
     * everyone else and the block would be readable off the card.
     */
    expect(API).toContain("goingCount: bucket.goingAccountIds.length");
    expect(BOARD).not.toContain("count={rows.length}");
    expect(SHEET).not.toContain("goingCount");
  });

  it("respects the soft-delete on attendance rows", () => {
    // Archived rows are preserved for audit and must not resurface as people
    // who are going.
    const at = API.indexOf("const occAttendees =");
    expect(API.slice(at, at + 1200)).toContain("!a.deletedAt");
  });

  it("requires a session", () => {
    // Not a public identity list. A guest gets the card's count and nothing more.
    const at = API.indexOf("const occAttendees =");
    const handler = API.slice(at, at + 800);
    expect(handler).toContain('error: "sign_in_required"');
  });
});

describe("reachable without leaving the card", () => {
  it("the count opens the list", () => {
    // "12 going" that cannot be opened is a wall in front of exactly the thing
    // she is checking for.
    expect(BOARD).toContain("setListOpen(true)");
    expect(BOARD).toContain("<AttendeeListSheet occurrenceId={occurrenceId}");
  });

  it("blocking happens inline, not via a profile", () => {
    /*
     * Navigating to a profile to block someone means passing through his page,
     * which is the last place she wants to be.
     */
    expect(SHEET).toContain("<SafetyActions accountId={p.id}");
  });

  it("the expander is withheld when identities are", () => {
    // A signed-out viewer must not get an expandable list the card is already
    // declining to show names on.
    expect(BOARD).toContain("occurrenceId={showAttendees ? event.id : undefined}");
  });

  it("the tap does not trigger the card underneath", () => {
    // The card navigates. Opening the list must not also open the run.
    const at = BOARD.indexOf("setListOpen(true)");
    expect(BOARD.slice(Math.max(0, at - 200), at)).toContain("e.stopPropagation()");
  });
});

describe("the sheet behaves like every other sheet", () => {
  it("closes on Escape and on a backdrop tap", () => {
    expect(SHEET).toContain('e.key === "Escape"');
    const raw = readFileSync(new URL("../src/components/AttendeeListSheet.tsx", import.meta.url).pathname, "utf8");
    expect(raw).toContain("onClick={onClose}");
  });

  it("says so when nobody has RSVP'd", () => {
    // Distinguishable from a failed load, which would otherwise look identical.
    expect(SHEET).toContain("Nobody has RSVP");
  });
});
