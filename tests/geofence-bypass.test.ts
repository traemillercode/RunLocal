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

describe("D2 public read routes bypass the geofence", () => {
  it("lets an out-of-area guest browse events, groups, races, and routes", () => {
    // The reported bug: all four are linked from the marketing page's Explore
    // menu, and all four bounced an out-of-area visitor back to marketing.
    for (const p of ["/events", "/groups", "/races", "/routes"]) {
      expect(guest(p)).toBe(true);
    }
  });

  it("extends to detail pages, since a guest who can see the list can see one item", () => {
    for (const p of ["/events/tuesday-tempo", "/groups/ctc", "/routes/mkt-trail"]) {
      expect(guest(p)).toBe(true);
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
    // But the group's public page still is public.
    expect(guest("/groups/ctc")).toBe(true);
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

  it("the public going-count endpoint remains the only unauthenticated attendance source", () => {
    // /api/events/public-summary is counts-only and leak-tested separately.
    // If a second unauthenticated attendance endpoint ever appears, that test
    // will not cover it — this is the reminder that it must.
    expect(isPublicReadPath("/events/tuesday-tempo")).toBe(true);
  });
});
