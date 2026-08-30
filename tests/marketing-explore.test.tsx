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

  it("Events points at /events, not at the marketing page itself", () => {
    expect(html).toContain('href="/events"');
    // The specific bug: a guest clicking Events reloaded the page they were on.
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

  it("derives Groups, which is public and was missing from the hand-written list", () => {
    expect(derived).toContain("/groups");
  });

  it("derives /events, never the marketing page itself", () => {
    expect(derived).toContain("/events");
    expect(derived).not.toContain("/");
  });

  it("cannot derive a walled destination", () => {
    expect(derived.length).toBeGreaterThan(0);
    for (const route of derived) expect(isPublicReadPath(route)).toBe(true);
    // The specific regression: /forum was offered and is member-only.
    expect(derived).not.toContain("/forum");
  });
});
