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

  it("cause 2 — no bottom-nav padding is reserved where there is no bottom nav", () => {
    expect(APP).toContain(".page-bottom-pad:has(.marketing-page)");
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
