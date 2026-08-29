/**
 * Home's empty state and the pending-account gate.
 *
 * The empty state is what every beta account sees on day one, so it is the
 * state worth testing first — the populated one is easier and less consequential.
 *
 * Tested at the logic level rather than by rendering, because HomePage fetches
 * five endpoints on mount and a static render resolves none of them. A render
 * test would assert against the loading state and pass regardless of what the
 * empty state actually shows — the same "passes for the wrong reason" trap as
 * asserting EventDetailPage contains no initials.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const RAW = readFileSync(new URL("../src/pages/HomePage.tsx", import.meta.url).pathname, "utf8");
/**
 * Comments stripped. The file DISCUSSES "0 runs" and lastSeenAt in comments
 * explaining why neither is used — searching raw text finds the explanation and
 * reports it as the offence. Same defect as the unused-constant guard counting
 * a comment as a reference.
 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("pending accounts are never offered an action the server will refuse", () => {
  it("gates on verified status, not merely signed-in", () => {
    // The defect this prevents: createAccount sets status "pending", and
    // /api/events/rsvp returns 403 verified_runner_required unless "verified".
    // Gating on signedIn would put a dead RSVP button on the first screen a
    // beta user sees, directly above the text explaining why it is dead.
    expect(SRC).toContain('const canRsvp = role === "verified"');
    expect(SRC).not.toMatch(/canRsvp\s*=\s*signedIn/);
  });

  it("sends a pending account to verification, not to an RSVP", () => {
    expect(SRC).toContain('canRsvp ? `/events/${encodeURIComponent(suggestion.id)}` : "/verify"');
    expect(SRC).toContain('canRsvp ? "See this run" : "Verify to RSVP"');
  });

  it("offers verification as the first next step when unverified", () => {
    // Ordered by what unblocks the most — verification gates RSVP entirely.
    const steps = SRC.slice(SRC.indexOf("function NextSteps"));
    const verifyAt = steps.indexOf('to: "/verify"');
    const groupsAt = steps.indexOf('to: "/groups"');
    const planAt = steps.indexOf('to: "/training-plan"');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(groupsAt);
    expect(groupsAt).toBeLessThan(planAt);
  });
});

describe("empty state shows something real, not a zero", () => {
  it("surfaces an actual upcoming run rather than an encouraging placeholder", () => {
    // The competitor failure: a leaderboard reading "The miles are adding up"
    // beside 0.00. The encouragement makes the emptiness louder. The fix is
    // showing a real run, not better copy.
    expect(SRC).toContain("upcomingRuns(city, canonical)[0]");
    for (const zero of ["0 runs", "No runs yet", "miles are adding up"]) {
      expect(SRC).not.toContain(zero);
    }
  });

  it("reports the genuinely-empty case as a dead end", () => {
    // Nothing to act on and nothing changed IS a dead end, and it is the state
    // every beta account starts in — so it should produce a signal rather than
    // being quietly tolerated.
    expect(SRC).toContain('useDeadEnd("home-nothing-to-do"');
  });
});

describe("panels hide rather than render empty", () => {
  it("each optional panel is conditional on having content", () => {
    // "Three panels where one is always blank is worse than two that work."
    expect(SRC).toContain("{unread.length > 0 ? (");
    expect(SRC).toContain("{plan ? (");
  });

  it("does not render a group panel, which was cut for lack of an endpoint", () => {
    // No endpoint returns upcoming runs across memberships, and in a
    // three-club city it would duplicate "Next up". Cut, not stubbed.
    expect(SRC).not.toContain("Your group");
    expect(SRC).not.toContain("getGroupRuns");
  });
});

describe("Home answers 'what now', not 'what exists'", () => {
  it("only shows commitments that are still upcoming", () => {
    // Past runs are history and belong in My Runs; Home is for what to do next.
    expect(SRC).toContain("(r.runDate ?? r.date) >= today");
  });

  it("labels the changed panel without claiming a timestamp it cannot support", () => {
    // There is no lastSeenAt, so this is really "unread". The heading implies
    // recency honestly instead of asserting a time.
    expect(SRC).toContain("Since you were here");
    expect(SRC).not.toContain("lastSeenAt");
  });
});
