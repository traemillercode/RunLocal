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
