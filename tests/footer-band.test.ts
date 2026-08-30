/**
 * The white band below the marketing footer.
 *
 * Reported four times with accurate measurements each time, and survived
 * because it had THREE independent causes, each producing an identical
 * symptom, and fixing any one alone left the band:
 *
 *   1. .marketing-footer set no background — transparent over a dark page.
 *   2. --page-bottom-pad reserved ~100px for a bottom nav the marketing page
 *      does not have.
 *   3. body is paper (#f7f7f5) for the app, and the marketing page paints ink
 *      OVER it — so any gap at all, from any cause, shows paper through.
 *
 * (3) is the root: it is what turns every other gap into a visible defect.
 * The first two were correctly diagnosed and were genuinely real; they were
 * just not sufficient.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const MARKETING = readFileSync(new URL("../src/styles/marketing.css", import.meta.url).pathname, "utf8");
const APP = readFileSync(new URL("../src/styles/app.css", import.meta.url).pathname, "utf8");

describe("nothing paper can show on a marketing view", () => {
  it("cause 1 — the footer paints its own background", () => {
    const rule = /\.marketing-footer\{([^}]*)\}/.exec(MARKETING)?.[1] ?? "";
    expect(rule).toContain("background:#14161a");
  });

  it("cause 2 — bottom-nav padding is reserved only where a nav exists", () => {
    // This asserted :has(.marketing-page), which was the WRONG key — the
    // marketing page does render a bottom nav. See the both-directions block
    // below; the padding now follows data-has-nav.
    expect(APP).toContain('.page-bottom-pad[data-has-nav="false"]');
  });

  it("cause 3 — the body itself is ink while a marketing page is mounted", () => {
    /*
     * The one that makes the other two sufficient rather than necessary. With
     * this, a gap below the footer is invisible instead of white — so a fourth
     * cause nobody has found yet cannot reproduce the symptom.
     */
    expect(APP).toContain("body:has(.marketing-page)");
    const rule = /body:has\(\.marketing-page\)\s*\{([^}]*)\}/.exec(APP)?.[1] ?? "";
    expect(rule.replace(/\s/g, "")).toContain("#14161a");
  });

  it("cause 4 — HTML is ink, which is what makes the other three sufficient", () => {
    /*
     * THE ROOT, and the reason three correct fixes did not remove the band.
     * body is ink but only extends as far as its CONTENT; below that the
     * browser paints its default canvas — white — through a TRANSPARENT html.
     * Painting the footer, the padding, or body could never have fixed that.
     */
    expect(APP).toContain("html:has(.marketing-page)");
    const rule = /html:has\(\.marketing-page\)\s*\{([^}]*)\}/.exec(APP)?.[1] ?? "";
    expect(rule.replace(/\s/g, "")).toContain("#14161a");
  });

  it("the FOUR inks agree, so a seam cannot appear between them", () => {
    // Different shades would produce a visible band rather than an invisible
    // gap — the same defect wearing a subtler coat.
    const footer = /\.marketing-footer\{([^}]*)\}/.exec(MARKETING)?.[1] ?? "";
    const body = /body:has\(\.marketing-page\)\s*\{([^}]*)\}/.exec(APP)?.[1] ?? "";
    const page = /\.marketing-page\{([^}]*)\}/.exec(MARKETING)?.[1] ?? "";
    const html = /html:has\(\.marketing-page\)\s*\{([^}]*)\}/.exec(APP)?.[1] ?? "";
    for (const rule of [footer, body, page, html]) {
      expect(rule.toLowerCase().replace(/\s/g, "")).toContain("#14161a");
    }
  });
});

describe("bottom padding follows the bottom nav, both directions", () => {
  /*
   * BOTH ASSERTIONS, because this flipped once already.
   *
   * The first conditional keyed on :has(.marketing-page) — and "/" is NOT in
   * NO_NAV_PATHS, so the marketing page renders a bottom nav after all. Zeroing
   * its padding put the bar over the last ~100px of the footer: the same
   * symptom as the original bug, produced by the fix for it.
   *
   * A one-directional test would have passed the whole time. Hence one
   * assertion each way, as specified.
   */
  const APP_CSS = readFileSync(new URL("../src/styles/app.css", import.meta.url).pathname, "utf8");
  const APP_TSX = readFileSync(new URL("../src/App.tsx", import.meta.url).pathname, "utf8");

  it("WITH a bottom nav: reserves nav + gap + safe area", () => {
    const rule = /\.page-bottom-pad\[data-has-nav="true"\]\s*\{([^}]*)\}/.exec(APP_CSS)?.[1] ?? "";
    expect(rule).toContain("var(--page-bottom-pad)");
    const token = /--page-bottom-pad:\s*calc\(([^;]*)\)/.exec(APP_CSS)?.[1] ?? "";
    for (const term of ["--page-nav-h", "--page-bottom-gap", "safe-area-inset-bottom"]) {
      expect(token).toContain(term);
    }
    // The FAB overhang term went with the FAB. Asserted absent so it cannot
    // creep back and silently reserve 28px for a control that no longer exists.
    expect(token).not.toContain("--page-fab-overhang");
  });

  it("WITHOUT a bottom nav: reserves nothing", () => {
    const rule = /\.page-bottom-pad\[data-has-nav="false"\]\s*\{([^}]*)\}/.exec(APP_CSS)?.[1] ?? "";
    expect(rule.replace(/\s/g, "")).toContain("padding-bottom:0");
  });

  it("keys off the SAME value that decides whether the nav renders", () => {
    /*
     * The root fix. Keying on the page identity let the two disagree about
     * whether a bar exists; keying both on `noNav` makes that impossible.
     */
    expect(APP_TSX).toContain("data-has-nav={!noNav}");
    expect(APP_TSX).toContain("{!noNav ? <BottomNav /> : null}");
  });

  it("does not decide padding by page identity", () => {
    // The specific mistake, guarded so it cannot come back by the same route.
    expect(APP_CSS).not.toContain(".page-bottom-pad:has(.marketing-page)");
  });
});


describe("the sidebar's bottom items stay reachable", () => {
  /*
   * overflow-y was `visible`, so at 15 signed-in items the last four — Admin,
   * Notifications, Settings, Sign out — rendered BELOW the viewport and could
   * not be reached at all.
   *
   * This is the gap Morgan named: the four reachability guards assert entries
   * are RETURNED. None asserted they were VISIBLE, and returned-but-off-screen
   * looks identical to working from inside a unit test.
   */
  const CSS = readFileSync(new URL("../src/styles/app.css", import.meta.url).pathname, "utf8");

  it("the nav scrolls rather than overflowing off-screen", () => {
    const rule = /\.desktop-nav\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(rule).toContain("overflow-y: auto");
    /*
     * min-height:0 is load-bearing, not decoration. .desktop-sidebar is a flex
     * column and a flex child defaults to min-height:auto, refusing to shrink
     * below its content — so overflow-y:auto ALONE would still not scroll.
     */
    expect(rule).toContain("min-height: 0");
  });

  it("the account group is pinned outside the scroll area", () => {
    // Sign out must not depend on the viewport being tall enough.
    const rule = /\.desktop-account\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(rule).toContain("flex: 0 0 auto");
  });
});

describe("the private-beta page is a door, not a shell", () => {
  it("renders before the app chrome mounts", () => {
    /*
     * It rendered INSIDE the shell, so a stranger on /races saw "Kimbio is in a
     * private beta" beside the full member sidebar, with an active state on
     * Races and every link leading back to the same page. That undercuts hiding
     * Log in and Sign up while rendering an entire app navigation next to them.
     */
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url).pathname, "utf8");
    const early = app.indexOf("if (showPrivateBeta) return <PrivateBetaPage />;");
    expect(early).toBeGreaterThan(-1);
    // Before Header, DesktopSidebar and BottomNav, so none of them mount.
    for (const chrome of ["<Header city=", "<DesktopSidebar city=", "<BottomNav />"]) {
      expect(early).toBeLessThan(app.indexOf(chrome));
    }
  });
});
