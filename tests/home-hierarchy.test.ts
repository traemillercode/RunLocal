/**
 * Stage 3, page 1: Home.
 *
 * The inventory decided the work, and it was smaller and sharper than "convert
 * the page":
 *
 *   303 lines, 0 buttons, 3 hand-rolled cards.
 *   Arbitrary sizes present: 11, 12, 13, 14, 15px. NOTHING ABOVE 15.
 *   Six sections, every one with an identical 11px kicker.
 *
 * So Home had no display type at all and six equally-weighted sections. Nothing
 * was ranked, which is why it reads as a wall rather than a screen — and it is
 * the review's central finding appearing on the first page of the sweep.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

const HOME = readFileSync(new URL("../src/pages/HomePage.tsx", import.meta.url).pathname, "utf8");

describe("Home has an answer", () => {
  it("the next run's WHEN is display type", () => {
    /*
     * The question Home answers is "when is my next run". You already know
     * WHICH run — you RSVP'd.
     *
     * That completes a set of three deliberate inversions:
     *   board        time loud  — you are still choosing
     *   detail page  title loud — you have chosen and are reading about it
     *   Home         time loud  — you have chosen and want to know when
     */
    expect(HOME).toContain('style={{ fontSize: "var(--text-headline)" }}');
    const at = HOME.indexOf('fontSize: "var(--text-headline)"');
    expect(HOME.slice(at, at + 300)).toContain("whenLabel(");
  });

  it("only the FIRST row gets it", () => {
    /*
     * Three display-sized times compete and none wins — the same failure the
     * board card had with a loud title and a loud time before the hierarchy was
     * settled. "One thing is the answer" means one.
     */
    expect(HOME).toContain("{idx === 0 ? (");
    expect(HOME).toContain("nextUp.map((run, idx) =>");
  });

  it("the first row's title steps DOWN to make room", () => {
    /*
     * Not just the time going up. If the title stayed at 15px next to a 22px
     * time they would be close enough to compete, and contrast is the whole
     * point.
     */
    expect(HOME).toContain('idx === 0 ? "text-[14px]" : "text-[15px]"');
  });

  it("stays inside the six-value scale", () => {
    // No seventh size introduced while adding contrast — the display sizes are
    // tokens, not new literals.
    const sizes = new Set([...HOME.matchAll(/text-\[(\d+)px\]/g)].map((m) => m[1]));
    for (const s of sizes) expect(["11", "12", "13", "14", "15", "16"]).toContain(s);
  });
});

describe("the shadowless card was drift, and is closed", () => {
  it("no card omits shadow-sm", () => {
    /*
     * ASKED AND ANSWERED. I held this open as a visual decision I could not
     * evaluate: 57 cards with shadow-sm, 14 across 10 files without, no
     * semantic pattern.
     *
     * Trae's reasoning settles it from Stage 1, and it is better than my
     * hesitation. Elevation was deliberately NOT tokenised because 131 of 140
     * shadow uses are the same one — which means shadow-sm is not a LEVEL in a
     * system, it is what a card looks like. So 14 without it are 14 that missed
     * the default.
     *
     * Normalising does not invent an elevation system; it applies the single
     * default consistently. A `flat` variant is what would invent one, because
     * flat immediately raises the question of what sits above it.
     */
    const offenders: string[] = [];
    for (const dir of ["../src/pages", "../src/components"]) {
      const path = new URL(dir, import.meta.url).pathname;
      for (const f of readdirSync(path).filter((x) => x.endsWith(".tsx"))) {
        const src = readFileSync(`${path}/${f}`, "utf8");
        if (/rounded-2xl bg-white p-\d+ ring-1/.test(src)) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("Card carries the default, and the dominance guard still holds", () => {
    // The Stage 1 guard asserting shadow-sm dominates is what keeps this from
    // quietly becoming a system: if the spread ever returns, that fires.
    const card = readFileSync(new URL("../src/components/Card.tsx", import.meta.url).pathname, "utf8");
    expect(card).toContain("shadow-sm");
    /* No flat VARIANT — matched on the prop shape, not the word, because
       "flattened" appears in Card's own comment explaining why the densities
       were kept. A substring check on a common word reads the wrong thing. */
    expect(card).not.toMatch(/flat:\s*"/);
  });
});

describe("motion is functional", () => {
  it("the next-run row responds to hover", () => {
    // It is a link to the run. Nothing on Home moved at all before this.
    expect(HOME).toContain("transition-shadow duration-[120ms] hover:shadow-sm");
  });
});
