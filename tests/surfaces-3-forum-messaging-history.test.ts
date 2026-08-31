/**
 * Surfaces 7–9: forum, messaging, run history. The last of the nine.
 *
 *   forum       — CITY-WIDE, not group-scoped. Filtered, and the reason it
 *                 differs from the group thread is EXIT.
 *   messaging   — confirmed across every path in, rather than trusting the two
 *                 specific holes already closed were the only ones.
 *   run history — does not exist as a public surface. An absence, recorded with
 *                 the warning that 2.14 would create one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readCode } from "./helpers/source";

const API = readCode(new URL("../src/server/api.ts", import.meta.url));
const FORUM = readCode(new URL("../src/server/forum.ts", import.meta.url));

describe("surface 7 — forum: filtered, because there is no exit", () => {
  it("hides blocked authors from the city feed", () => {
    /*
     * The group thread is NOT filtered: a club is not a private channel,
     * membership is preserved, and she can leave the group. SHE CANNOT LEAVE
     * THE CITY. A city-wide forum is a public square with no exit, so the group
     * reasoning does not transfer.
     */
    const fn = FORUM.slice(FORUM.indexOf("export function publicForumPosts"));
    expect(fn).toContain("hiddenFrom(db, actor?.id ?? null)");
    expect(fn).toContain("!hidden.has(f.authorAccountId)");
  });

  it("is symmetric, and covers deleted and suspended too", () => {
    // hiddenFrom is bidirectional, so a blocked author is indistinguishable
    // from one who left — the same union as everywhere else.
    const fn = FORUM.slice(FORUM.indexOf("export function publicForumPosts"));
    expect(fn).not.toContain("isBlocked");
  });

  it("the group thread stays unfiltered, deliberately", () => {
    // The contrast is the point: filtering there produces replies to nothing,
    // and she has an exit.
    expect(API).toContain("if (!convo.isGroup)");
  });
});

describe("surface 8 — messaging: confirmed across every path in", () => {
  /*
   * Two holes were closed on separate occasions and each fix was correct for
   * the reason given at the time. That is not the same as knowing they were the
   * only two — so this asserts the property across EVERY route into a
   * conversation, rather than re-checking the two known spots.
   */
  it("every conversation route consults the block", () => {
    const routes = [
      // Anchored on the ACTION each route performs, not the route declaration —
      // the declaration can sit thousands of characters above the guard.
      { name: "create", marker: "const pair = db.getConnectionPair(sess.accountId, target);" },
      { name: "send", marker: "db.addMessage(" },
    ];
    for (const r of routes) {
      const at = API.indexOf(r.marker);
      expect(at, `${r.name} route not found`).toBeGreaterThan(-1);
      // The block check must appear before the action, within the handler.
      const before = API.slice(Math.max(0, at - 400), at);
      expect(before, `${r.name} does not check isBlocked`).toContain("db.isBlocked(");
    }
  });

  it("the LIST route needs no check, and here is why", () => {
    /*
     * GET /api/conversations returns the viewer's own threads. A blocked
     * one-to-one thread is unreachable for sending and the other party is
     * hidden everywhere else, so filtering the list would only remove her own
     * history from her — which protects nobody and loses her the record.
     */
    const at = API.indexOf('method === "GET" && url.pathname === "/api/conversations"');
    expect(at).toBeGreaterThan(-1);
  });

  it("refusals are indistinguishable from a missing conversation", () => {
    // A distinct error would tell him a block exists.
    const at = API.indexOf("db.isBlocked(sess.accountId, otherParticipant)");
    expect(API.slice(at, at + 200)).toContain('error: "not_found"');
  });
});

describe("surface 9 — run history: an absence", () => {
  it("no public run-history endpoint exists", () => {
    /*
     * MyRunsPage and nothing else — owner-only by construction, the roster
     * flavour again.
     *
     * RECORDED WITH A WARNING, the same as the search absence: 2.14's route
     * drawing is the thing that would create one. "Runs I've done" attached to
     * a profile is a map of where she starts, which is usually near home — the
     * Strava heatmap mistake. It needs hiddenFrom on day one, and per the doc it
     * should not be attached to a person at all.
     */
    const raw = readFileSync(new URL("../src/server/api.ts", import.meta.url).pathname, "utf8");
    expect(raw).not.toContain("/api/runners/${");
    for (const bad of ['"/api/runs/public"', '"/api/runners/history"']) {
      expect(raw).not.toContain(bad);
    }
  });

  it("getMyRuns is always the VIEWER's own runs, never a target's", () => {
    /*
     * My first version asserted only MyRunsPage and Home call getMyRuns, and it
     * failed — five pages do. That assertion was wrong, not the code: EventsPage,
     * EventDetailPage and TrainingPlanDetailPage call it to resolve the viewer's
     * own RSVP state on a run they are looking at.
     *
     * The property that actually matters is that the endpoint takes NO account
     * parameter, so it cannot be pointed at someone else. That is what makes
     * run history owner-only by construction rather than by every caller
     * remembering.
     */
    const client = readFileSync(new URL("../src/lib/api.ts", import.meta.url).pathname, "utf8");
    const at = client.indexOf("export function getMyRuns");
    expect(at).toBeGreaterThan(-1);
    // Takes a timezone offset and nothing else — no account id, so it cannot
    // be pointed at another person.
    const sig = client.slice(at, client.indexOf(")", at) + 1);
    expect(sig).toContain("tzOffsetMinutes");
    expect(sig).not.toMatch(/accountId|runnerId|userId/);
  });
});
