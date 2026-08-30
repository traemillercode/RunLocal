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

  it("the three inks agree, so a seam cannot appear between them", () => {
    // Different shades would produce a visible band rather than an invisible
    // gap — the same defect wearing a subtler coat.
    const footer = /\.marketing-footer\{([^}]*)\}/.exec(MARKETING)?.[1] ?? "";
    const body = /body:has\(\.marketing-page\)\s*\{([^}]*)\}/.exec(APP)?.[1] ?? "";
    const page = /\.marketing-page\{([^}]*)\}/.exec(MARKETING)?.[1] ?? "";
    for (const rule of [footer, body, page]) {
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
