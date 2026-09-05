/**
 * The marketing footer at 390px.
 *
 * Reported as "squished". Measured, it was two separate problems:
 *
 *   Every link was 13px tall — under a third of the 44px touch minimum.
 *   The five links sat EDGE TO EDGE, reading as one run-together string:
 *   "FacebookInstagramSponsor KimbioTermsPrivacy".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../src/styles/marketing.css", import.meta.url).pathname, "utf8");

describe("the links have a real touch target", () => {
  it("is at least 44px tall", () => {
    // 13px is not a target, it is a hope. Measured at 44 after the fix.
    const rule = /\.marketing-footer-links a\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(rule).toContain("min-height:44px");
    expect(rule).toContain("display:inline-flex");
  });

  it("gets the height from padding, not from font size", () => {
    // 44px of tappable box without 44px of visual weight — the footer is
    // secondary and should not shout.
    expect(CSS).toContain("padding:0 2px");
  });
});

describe("the container is actually a flex container", () => {
  it("beats the more specific span rule", () => {
    /*
     * THE REAL CAUSE, and the reason `gap` appeared to do nothing.
     *
     * `.marketing-footer span{display:block}` is class + element — MORE
     * specific than the bare `.marketing-footer-links` class — so the container
     * rendered as a block, the flex layout never applied, and the gap was
     * ignored. The links were inline text sitting adjacent.
     *
     * Reading the stylesheet showed `display:flex;gap:18px` and looked correct;
     * measuring the boxes showed them touching at 0px. That gap between what
     * the source says and what the browser does is the same shape as the
     * backdrop-filter containing block on the mobile menu.
     */
    expect(CSS).toContain("span.marketing-footer-links{display:flex");
  });

  it("wraps rather than overflowing", () => {
    // Five links do not fit on one 390px line at a 44px target. Wrapping keeps
    // them all reachable; the alternative is a horizontal scroll nobody finds.
    const rule = /span\.marketing-footer-links\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(rule).toContain("flex-wrap:wrap");
    // Row gap smaller than column gap, so wrapped rows still read as one group.
    expect(rule).toContain("gap:4px 18px");
  });
});
