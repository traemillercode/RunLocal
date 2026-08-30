/**
 * The consent banner must not dominate the first fold.
 *
 * It sat over the live board — the whole argument for signing up — taking
 * roughly a third of a 390px viewport. The fix is proportion, not weakened
 * copy: every word is still present, the surprising part (session replay)
 * stays in the summary rather than being buried, and only the enumeration
 * moves behind an expander.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/*
 * Asserted against SOURCE, not a render. `visible` starts false and only flips
 * in a useEffect, which SSR never runs — so renderToStaticMarkup returns an
 * empty string and every assertion would pass on nothing. The same
 * "passes for the wrong reason" trap as testing EventDetailPage for absent
 * initials on an empty render.
 */
const SRC = readFileSync(new URL("../src/components/CookieBanner.tsx", import.meta.url).pathname, "utf8");
/** The collapsed summary: everything before the expander button. */
const SUMMARY = SRC.slice(SRC.indexOf("During the beta"), SRC.indexOf("onClick={() => setDetail"));

describe("collapsed banner", () => {
  it("keeps the session-replay disclosure visible before expanding", () => {
    // The one thing a user would be surprised by must not be behind a click.
    expect(SUMMARY).toContain("anonymized replay of your session");
  });

  it("is short enough not to dominate the fold", () => {
    // ~2 lines at 390px. The previous version ran to five.
    const words = SUMMARY.replace(/\s+/g, " ").trim();
    expect(words.length).toBeLessThan(200);
  });

  it("offers the detail rather than hiding it", () => {
    expect(SRC).toContain("What we collect");
    expect(SRC).toContain("aria-expanded={detail}");
  });

  it("still offers both choices, equally reachable", () => {
    // Decline must not be harder to find than Accept.
    expect(SRC).toContain(">\n            Decline\n          </button>");
    expect(SRC).toContain(">\n            Accept\n          </button>");
  });
});

describe("no copy was weakened", () => {
  it("every claim from the original survives somewhere in the component", () => {
    const src = SRC;
    for (const claim of [
      "which pages you visit",
      "errors you hit",
      "anonymized replay of your session",
      "Typing is never recorded",
      "Decline and nothing is collected at all",
    ]) {
      expect(src.toLowerCase()).toContain(claim.toLowerCase());
    }
  });
});

describe("the banner is the last surface through the brand system", () => {
  /*
   * IT WAS THE WHITE BAND. bg-white/97 pinned at z-60 across the bottom of
   * every page — five rounds of reports were seeing this, not the footer.
   * html, body, the footer background and the padding conditional were each a
   * real cause of a real gap and each was fixed correctly, and the symptom
   * never moved, because we kept painting the page while an overlay painted
   * over it.
   *
   * The lesson is the measurement, not the fix: elementFromPoint at the bottom
   * pixel answers "what is actually painting here", which is a different
   * question from "what should be painting here".
   */
  it("is ink, not white", () => {
    expect(SRC).toContain("bg-[#14161A]/97");
    expect(SRC).not.toContain("bg-white/97");
  });

  it("puts coral on Accept only", () => {
    // One primary action per surface. Accept is it.
    expect((SRC.match(/#FF5741/g) ?? []).length).toBe(1);
    const accept = SRC.slice(SRC.indexOf('choose("granted")') - 200, SRC.indexOf('choose("granted")') + 200);
    expect(accept).toContain("#FF5741");
  });

  it("keeps Decline equally findable", () => {
    /*
     * A visible outline, not a quieter shade of the background. Making the
     * refusal harder to see than the acceptance is the dark pattern this whole
     * banner exists to avoid.
     */
    const decline = SRC.slice(SRC.indexOf('choose("declined")') - 60, SRC.indexOf('choose("declined")') + 260);
    expect(decline).toContain("border border-white/25");
    expect(decline).toContain("h-11");
  });

  it("the choice persists, so it cannot reappear on every load", () => {
    // If consent were session-only, that bar would be on every page forever —
    // which would have looked exactly like the bug that was being chased.
    const analytics = readFileSync(new URL("../src/lib/analytics.ts", import.meta.url).pathname, "utf8");
    expect(analytics).toContain("localStorage.setItem(CONSENT_KEY");
    expect(analytics).not.toContain("sessionStorage.setItem(CONSENT_KEY");
  });
});
