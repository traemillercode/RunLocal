/**
 * The marketing mobile menu is a sheet, not a 73px strip.
 *
 * THE CSS WAS CORRECT THE WHOLE TIME. `.marketing-mobile-menu` said
 * `position: fixed; inset: 0` and compiled to exactly that — so reading the
 * stylesheet found nothing wrong, repeatedly.
 *
 * The cause was an ANCESTOR: `.marketing-header-sticky` has
 * `backdrop-filter: saturate(1.4) blur(10px)`, and backdrop-filter creates a
 * CONTAINING BLOCK for fixed-position descendants. So `inset: 0` resolved
 * against a 73px header instead of the viewport, and the menu rendered as a
 * strip with its items overflowing on top of the page — no background behind
 * them, page scrolling underneath.
 *
 * Found by walking the ancestor chain for containing-block properties, not by
 * reading CSS. Same lesson as elementFromPoint: ask what is actually happening,
 * not what the source says should happen.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const PAGE = readFileSync(new URL("../src/pages/MarketingPage.tsx", import.meta.url).pathname, "utf8");
const CSS = readFileSync(new URL("../src/styles/marketing.css", import.meta.url).pathname, "utf8");

describe("the sheet escapes the sticky header", () => {
  it("renders through a portal to document.body", () => {
    /*
     * The only durable fix. Removing backdrop-filter would work too and costs
     * the header its blur; portalling costs nothing and survives anyone adding
     * transform, filter or contain to the header later — all of which create
     * the same containing block.
     */
    expect(PAGE).toContain("createPortal(");
    expect(PAGE).toContain("document.body,");
  });

  it("still declares full-viewport positioning", () => {
    // The portal only matters because the CSS is right; assert both so a future
    // reader does not "fix" the CSS that was never broken.
    const rule = /\.marketing-mobile-menu \{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(rule).toContain("position: fixed");
    expect(rule).toContain("inset: 0");
  });

  it("records why, so the portal is not removed as redundant", () => {
    // It looks removable — the CSS alone reads as sufficient.
    expect(PAGE).toContain("backdrop-filter");
    expect(PAGE).toContain("CONTAINING");
    expect(PAGE).toContain("73px header");
  });
});

describe("it behaves like a sheet", () => {
  it("locks body scroll while open", () => {
    // Otherwise the page scrolls behind an overlay covering it, and you end up
    // somewhere else when the sheet closes.
    expect(PAGE).toContain('document.body.style.overflow = "hidden";');
  });

  it("restores the PREVIOUS overflow, not a hard-coded value", () => {
    /*
     * A hard-coded restore to "visible" is how one overlay silently un-does
     * another's lock — the attendee sheet can be open underneath.
     */
    expect(PAGE).toContain("const previous = document.body.style.overflow;");
    expect(PAGE).toContain("document.body.style.overflow = previous;");
  });

  it("closes on Escape and cleans up its listener", () => {
    expect(PAGE).toContain('e.key === "Escape"');
    expect(PAGE).toContain('document.removeEventListener("keydown", onKey);');
  });
});

describe("the menu is useful during the beta, not just navigational", () => {
  /*
   * Every item leads to the private-beta page, which is not four dead ends —
   * it is four paths into the waitlist. A stranger who taps Races and lands on
   * "Kimbio is in a private beta" with a form has been given something to do,
   * not refused.
   *
   * But the actions block was EMPTY while the beta is on: the login and signup
   * CTAs are correctly hidden and nothing replaced them, so the menu was purely
   * navigational at exactly the moment navigation leads everywhere and nowhere.
   */
  it("offers the waitlist when signup is closed", () => {
    expect(PAGE).toContain('<WaitlistForm tone="dark" />');
    const at = PAGE.indexOf('<WaitlistForm tone="dark" />');
    /*
     * In the signup-CLOSED branch, not shown alongside Sign up. Anchored on the
     * actions block rather than a character window — the explanatory comment
     * between the branch and the form is longer than any window I would pick,
     * and picking one to fit is how a guard stops asserting anything.
     */
    const actions = PAGE.indexOf("marketing-mobile-menu-actions");
    const branch = PAGE.indexOf("signupOpen === true ? (", actions);
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(at);
  });

  it("uses the real form, not a mailto or a link to one", () => {
    /*
     * A mailto loses everyone without a configured mail client and records
     * nothing — that is why the waitlist exists at all. A link would
     * reintroduce the detour this block removes.
     */
    const at = PAGE.indexOf('<WaitlistForm tone="dark" />');
    expect(PAGE.slice(Math.max(0, at - 900), at)).not.toContain("mailto:");
  });

  it("does not mark individual items as beta-gated", () => {
    /*
     * A marker per row is clutter that makes the product look shut, and the
     * destination already explains itself.
     */
    const start = PAGE.indexOf("marketing-mobile-menu-item");
    const end = PAGE.indexOf("marketing-mobile-menu-actions");
    const items = PAGE.slice(start, end);
    for (const marker of ["Beta", "Coming soon", "Locked"]) {
      expect(items).not.toContain(marker);
    }
  });
});
