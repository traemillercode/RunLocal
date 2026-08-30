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
