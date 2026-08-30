/**
 * D2: public read, gated writes.
 *
 * This is security-adjacent, so it is tested in BOTH directions. A bypass that
 * is too narrow is a bug (the one being fixed: every public route was walled).
 * A bypass that is too wide is a hole — and the wide direction is the one that
 * fails silently, because nothing looks broken when a page loads that should
 * not have.
 */
import { describe, expect, it } from "vitest";
import { shouldBypassGeofence, isPublicReadPath } from "../src/lib/geofenceBypass";

const guest = (pathname: string) => shouldBypassGeofence({ pathname, signedIn: false });
const member = (pathname: string) => shouldBypassGeofence({ pathname, signedIn: true });

describe("D2 public read is SUSPENDED for the closed beta", () => {
  /*
   * These asserted the opposite until the beta flip, and both versions are
   * correct for their moment. D2 (public read, gated writes) is right for
   * launch and wrong for a closed beta about to be advertised: a stranger
   * arriving from an ad should read the landing page and understand the door
   * is shut, not browse a half-populated app they cannot join.
   *
   * The prefixes are COMMENTED OUT in geofenceBypass.ts rather than deleted,
   * so restoring this is uncommenting a list. It goes back with prerendering
   * (roadmap 2.12). See tests/closed-beta.test.ts for the posture as a whole.
   */
  it("app routes are not public during the beta", () => {
    for (const p of ["/events", "/groups", "/races", "/routes", "/events/tuesday-tempo", "/groups/ctc"]) {
      expect(guest(p)).toBe(false);
    }
  });
});

describe("write surfaces stay walled, even under a public prefix", () => {
  it("does not leak /events/manage just because /events is public", () => {
    // The trap in prefix matching: /events/manage is a MODERATION surface that
    // happens to live under a public prefix. Treating everything under /events
    // as public would hand an out-of-area visitor the edit and hide controls.
    expect(guest("/events/manage")).toBe(false);
    expect(member("/events/manage")).toBe(false);
    expect(isPublicReadPath("/events/manage")).toBe(false);
  });

  it("does not leak group management or rosters", () => {
    expect(guest("/groups/ctc/manage")).toBe(false);
    expect(guest("/groups/ctc/roster")).toBe(false);
    // The group's public page is ALSO walled during the beta. The exclusion
    // below is what still matters when D2 is restored: management and rosters
    // must stay private even once /groups/:id is public again.
    expect(isPublicReadPath("/groups/ctc/manage")).toBe(false);
    expect(isPublicReadPath("/groups/ctc/roster")).toBe(false);
  });

  it("keeps personal and member-only surfaces walled", () => {
    for (const p of [
      "/forum", "/profile", "/messages", "/connections", "/notifications",
      "/my-runs", "/my-groups", "/training-plan", "/training-summary",
      "/shoes", "/pace-calculator", "/coach-roster", "/coaches", "/admin",
    ]) {
      expect(guest(p)).toBe(false);
    }
  });
});

describe("pre-existing bypasses are preserved", () => {
  it("auth flows, legal, and marketing still bypass", () => {
    for (const p of ["/landing", "/legal", "/login", "/recovery", "/confirmation", "/callback"]) {
      expect(guest(p)).toBe(true);
    }
  });

  it("sponsorship is reachable from anywhere — it is a business enquiry", () => {
    expect(guest("/sponsor")).toBe(true);
    expect(guest("/sponsor/abc123")).toBe(true);
  });

  it("root bypasses for signed-out visitors only", () => {
    // Marketing is public; the signed-in board at the same path is not.
    expect(guest("/")).toBe(true);
    expect(member("/")).toBe(false);
  });

  it("owner and explicitly exempt accounts still bypass everywhere", () => {
    expect(shouldBypassGeofence({ pathname: "/training-plan", signedIn: true, isOwner: true })).toBe(true);
    expect(shouldBypassGeofence({ pathname: "/training-plan", signedIn: true, isGeofenceExempt: true })).toBe(true);
    expect(shouldBypassGeofence({ pathname: "/training-plan", signedIn: true })).toBe(false);
  });

  it("exemption flags do nothing for a signed-out visitor", () => {
    // Defensive: these come from the account, so they cannot be set without a
    // session — but the check should not depend on that being true elsewhere.
    expect(shouldBypassGeofence({ pathname: "/admin", signedIn: false, isOwner: true })).toBe(false);
  });
});

/**
 * Item A made /events/:eventId publicly reachable. That is correct per D2, but
 * it means any identity exposure on that page is now reachable by an
 * out-of-area guest — the same leak the board avoids by making
 * RunCard.attendees optional.
 *
 * Verified at the source rather than the surface: the page renders whatever
 * the API returns, so the question is what a guest can OBTAIN, not what the
 * component would draw if handed data. These assert the server gates, since
 * that is the boundary that actually holds.
 */
describe("public event detail exposes no identities (D2)", () => {
  it("the routes carrying identity are auth-gated server-side", async () => {
    const { readFileSync } = await import("node:fs");
    const api = readFileSync(new URL("../src/server/api.ts", import.meta.url).pathname, "utf8");

    // connections-going returns real names. Must require a session AND verified
    // status — a guest gets 401, so the row renders empty rather than leaking.
    const goingStart = api.indexOf("const goingPath =");
    const goingHandler = api.slice(goingStart, goingStart + 900);
    expect(goingHandler).toContain("sign_in_required");
    expect(goingHandler).toContain("verified_runner_required");

    // Discussion carries author names and free text. Stricter still: verified,
    // attending, and same city.
    const discStart = api.indexOf("const discussionPath =");
    const discussionHandler = api.slice(discStart, discStart + 3000);
    expect(discussionHandler).toContain("sign_in_required");
    expect(discussionHandler).toContain("participant_required");
  });

  it("event detail is not publicly reachable during the beta", () => {
    // Was asserting the opposite. /api/events/public-summary is still
    // counts-only and still leak-tested; what changed is that no signed-out
    // visitor reaches the page that would consume it.
    expect(isPublicReadPath("/events/tuesday-tempo")).toBe(false);
  });
});
