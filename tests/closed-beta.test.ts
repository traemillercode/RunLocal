/**
 * Closed-beta posture.
 *
 * The requirement: a stranger can find the site and read the landing page, and
 * has NO path to an account. The owner keeps full access. Google sees the
 * landing page only.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { shouldBypassGeofence, isPublicReadPath } from "../src/lib/geofenceBypass";
import { readCode } from "./helpers/source";

const guest = (p: string) => shouldBypassGeofence({ pathname: p, signedIn: false });

describe("a signed-out stranger reaches only the landing page", () => {
  it("app routes are no longer public", () => {
    // D2 partially reversed for the beta — recorded in geofenceBypass.ts rather
    // than done silently, and restored by uncommenting a list.
    for (const p of ["/events", "/events/tuesday-tempo", "/groups", "/races", "/routes"]) {
      expect(isPublicReadPath(p)).toBe(false);
      expect(guest(p)).toBe(false);
    }
  });

  it("the landing page and legal still are", () => {
    expect(guest("/")).toBe(true);
    expect(guest("/legal")).toBe(true);
  });

  it("/login stays reachable, so invite links and the owner still work", () => {
    // Hidden, not removed. An invite link is /login?mode=signup&invite=… and
    // must not break; the owner needs it to sign in at all.
    expect(guest("/login")).toBe(true);
  });
});

describe("the owner's access cannot be gated by the flip", () => {
  it("no sign-in path consults city status or invitations", () => {
    /*
     * The one that matters. Sign-in runs through Supabase and never touches
     * cityStatus or validateInvitation, so flipping a city to invite_only
     * cannot lock the owner out. Asserted structurally because discovering
     * otherwise mid-beta would be unrecoverable without console access.
     */
    const sb = readCode(new URL("../src/lib/supabase.ts", import.meta.url));
    for (const t of ["cityStatus", "invitation", "invite_only"]) {
      expect(sb.toLowerCase()).not.toContain(t.toLowerCase());
    }
  });

  it("the owner email is hardcoded as a fallback, not env-only", () => {
    // If RUN_LOCAL_OWNER_EMAIL were ever unset or mistyped, an env-only owner
    // check would silently remove the only account that can fix it.
    const owner = readCode(new URL("../src/server/owner.ts", import.meta.url));
    expect(owner).toContain("traemiller.email@gmail.com");
  });

  it("the owner bypasses the geofence everywhere", () => {
    expect(shouldBypassGeofence({ pathname: "/admin", signedIn: true, isOwner: true })).toBe(true);
    expect(shouldBypassGeofence({ pathname: "/training-plan", signedIn: true, isOwner: true })).toBe(true);
  });
});

describe("a stranger sees a real page, not a wall or an error", () => {
  const PAGE = readCode(new URL("../src/pages/PrivateBetaPage.tsx", import.meta.url));

  it("says what is true and offers a way to ask", () => {
    expect(PAGE).toContain("private beta");
    expect(PAGE).toContain("mailto:hello@getkimbio.com");
  });

  it("offers no sign-in or signup, which would advertise a shut door", () => {
    expect(PAGE).not.toContain('to="/login"');
    expect(PAGE).not.toContain("mode=signup");
  });
});

describe("Google sees the landing page only", () => {
  const ROBOTS = readFileSync(new URL("../public/robots.txt", import.meta.url).pathname, "utf8");
  const SITEMAP = readFileSync(new URL("../public/sitemap.xml", import.meta.url).pathname, "utf8");

  it("robots allows the landing page and legal, disallows the rest", () => {
    expect(ROBOTS).toContain("Allow: /$");
    expect(ROBOTS).toContain("Allow: /legal");
    expect(ROBOTS).toContain("Disallow: /");
  });

  it("the sitemap lists only those two", () => {
    const locs = [...SITEMAP.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(["https://getkimbio.com/", "https://getkimbio.com/legal"]);
  });

  it("no app route is advertised in the sitemap", () => {
    for (const p of ["/events", "/groups", "/races", "/routes", "/login"]) {
      expect(SITEMAP).not.toContain(`getkimbio.com${p}`);
    }
  });
});
