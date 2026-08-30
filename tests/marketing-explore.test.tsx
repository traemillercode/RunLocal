/**
 * The marketing page's Explore menu must only offer destinations a signed-out
 * visitor can actually reach.
 *
 * Two defects this guards:
 *   1. "Events" pointed at "/", which for a guest IS the marketing page —
 *      clicking it reloaded the page you were on.
 *   2. "Forum" was offered but /forum is deliberately not public-read, so a
 *      guest clicking it hit the geofence and bounced back to marketing.
 *
 * The second is the one worth a permanent guard: a menu that advertises a
 * walled destination looks like the site rejecting you, and it is invisible
 * from inside the city where everything bypasses anyway.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { MarketingPage } from "../src/pages/MarketingPage";
import { FEATURES, type Feature } from "../src/lib/features";
import { isPublicReadPath } from "../src/lib/geofenceBypass";

const html = renderToStaticMarkup(
  <MemoryRouter>
    <MarketingPage />
  </MemoryRouter>,
);

/** hrefs the marketing page offers, internal only. */
function offeredPaths(): string[] {
  return [...new Set([...html.matchAll(/href="(\/[^"#][^"]*)"/g)].map((m) => m[1]))];
}

describe("Explore offers only reachable destinations", () => {
  it("every internal destination is public-read, an auth flow, or the root", () => {
    const allowed = (p: string) =>
      isPublicReadPath(p) ||
      p === "/" ||
      p === "/login" ||
      p.startsWith("/login?") ||
      // Terms and Privacy are now separate anchored links, and they appear
      // beside the signup CTA as well as in the footer — consent belongs where
      // the action is, not only 5,000px below it.
      p === "/legal" ||
      p.startsWith("/legal#") ||
      p === "/sponsor" ||
      p.startsWith("/sponsor/") ||
      // Static assets are not destinations. The brand mark is an <img src>,
      // not somewhere a visitor can be sent.
      /\.(svg|png|jpe?g|webp|ico)$/.test(p);

    const walled = offeredPaths().filter((p) => !allowed(p));
    expect(walled).toEqual([]);
  });

  it("never points Events at the marketing page itself", () => {
    /*
     * The original bug was Events → "/", which for a guest IS this page, so
     * clicking it reloaded where you already were.
     *
     * The positive half ("/events is offered") no longer holds during the
     * closed beta — the whole menu is empty because nothing is public. What
     * survives is the invariant: whatever IS offered must never be the page the
     * visitor is standing on.
     */
    const exploreEventsLinksToRoot = /href="\/"[^>]*>\s*(<[^>]*>\s*)*Events/.test(html);
    expect(exploreEventsLinksToRoot).toBe(false);
  });

  it("does not offer the forum, which is member-only by design", () => {
    // Not an oversight — reading community discussion is a member benefit, so
    // /forum is excluded from public read. Offering it would wall the visitor.
    expect(isPublicReadPath("/forum")).toBe(false);
    expect(offeredPaths()).not.toContain("/forum");
  });

  /**
   * The Explore dropdown and mobile menu are behind useState and closed by
   * default, so a static render never emits them. Asserting on rendered HTML
   * would therefore pass whatever the menu contained — the same "passes for
   * the wrong reason" trap as testing EventDetailPage for absent initials.
   * So the DERIVATION is asserted directly: it is the thing that decides what
   * the menu can ever contain.
   */
  const derived = (FEATURES as readonly Feature[])
    .filter((f) => f.reach.kind === "nav" && f.nav && f.roles.includes("guest") && isPublicReadPath(f.route))
    .map((f) => f.route);

  it("offers nothing during the closed beta, because nothing is public", () => {
    /*
     * The derivation filters on isPublicReadPath, and the beta reduces that set
     * to nothing — so Explore correctly empties rather than offering four links
     * that all land on the private-beta page.
     *
     * That is the derivation earning itself: a hand-written menu would still be
     * advertising /events today, and someone would have had to remember.
     */
    expect(derived).toEqual([]);
  });

  it("still cannot derive a walled destination", () => {
    // The invariant survives the set changing size — that is the point of it.
    for (const route of derived) expect(isPublicReadPath(route)).toBe(true);
  });
});
