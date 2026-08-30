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

  it("says what is true and captures the person properly", () => {
    // The mailto is gone: it lost anyone without a configured mail client,
    // recorded nothing, and left the next fifty users in an inbox with no list.
    expect(PAGE).toContain("private beta");
    expect(PAGE).toContain("api.joinWaitlist(");
    expect(PAGE).not.toContain("mailto:");
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

describe("no login affordance survives anywhere while the beta is closed", () => {
  /*
   * Caught by running the flip checks against production rather than trusting
   * the code: check 1 showed "Log in" in the header ON the private-beta page —
   * sitting directly above the text explaining the visitor cannot get in.
   *
   * The marketing nav was gated for this and the app header was not. Two
   * separate surfaces, one rule, and only one of them had it.
   */
  it("the app header's guest CTA is gated on signup status", () => {
    const header = readCode(new URL("../src/components/Header.tsx", import.meta.url));
    expect(header).toContain("getSignupStatus");
    expect(header).toContain("if (signupOpen !== true) return null;");
  });

  it("both surfaces gate on the same server answer, not separate flags", () => {
    // A second switch is a second thing to forget. Both read
    // /api/signup-status, so flipping the CMS moves them together.
    const header = readCode(new URL("../src/components/Header.tsx", import.meta.url));
    const marketing = readCode(new URL("../src/pages/MarketingPage.tsx", import.meta.url));
    for (const src of [header, marketing]) expect(src).toContain('getSignupStatus("columbia-mo")');
  });
});

describe("EVERY signup surface is gated, not the ones with obvious copy", () => {
  /*
   * Four surfaces carry a path to signup: the header, the mobile menu, the hero
   * and the closing CTA. I gated three and missed the fourth, because its text
   * is "Join Kimbio" — it matched no search for "sign up" or "create account".
   *
   * Found by enumerating every href containing "login" on the rendered page
   * rather than by searching for copy. Asserted the same way here: count the
   * LINKS, not the words.
   */
  it("no /login link renders in the marketing tree without a signupOpen gate", () => {
    const src = readCode(new URL("../src/pages/MarketingPage.tsx", import.meta.url));
    const links = [...src.matchAll(/to="\/login[^"]*"/g)];
    expect(links.length).toBeGreaterThan(0); // else vacuous
    for (const m of links) {
      // Each must sit inside a signupOpen === true branch. Look back far enough
      // to clear the surrounding comment block.
      const before = src.slice(Math.max(0, m.index! - 900), m.index!);
      expect(before, `ungated /login link at ${m.index}`).toContain("signupOpen === true");
    }
  });
});
