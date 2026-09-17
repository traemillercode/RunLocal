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
import { readFileSync } from "node:fs";

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

describe("the shadowless card is recorded, not flattened", () => {
  it("Home's cards are left as they are", () => {
    /*
     * A FINDING RATHER THAN A CONVERSION, and this is the decision Trae has to
     * make rather than me.
     *
     * The card recipe splits: 57 uses carry `shadow-sm`, 14 across 10 files do
     * not. Home's three are in the shadowless group, and the ten files show no
     * semantic pattern — PaceCalculator, MyGroups, PastEvents, CoachRoster,
     * TrainingSummary and the rest. It reads as two people with two habits.
     *
     * Converting them to Card would ADD a shadow to Home. Adding a `flat`
     * option to Card would invent the elevation system that Stage 1
     * deliberately did not name, on the evidence that 131 of 140 shadow uses
     * are the same one.
     *
     * Either choice is a visual decision I cannot evaluate from source, so the
     * cards stay and the split is written down. This test exists to keep the
     * question open rather than to enforce an answer.
     */
    expect(HOME).toContain("rounded-2xl bg-white p-4 ring-1 ring-slate-200/70");
  });

  it("Card still assumes the majority form", () => {
    // 57 of 71. If the shadowless form ever becomes the majority, Card is wrong
    // and that is worth noticing rather than absorbing.
    const card = readFileSync(new URL("../src/components/Card.tsx", import.meta.url).pathname, "utf8");
    expect(card).toContain("shadow-sm");
  });
});

describe("motion is functional", () => {
  it("the next-run row responds to hover", () => {
    // It is a link to the run. Nothing on Home moved at all before this.
    expect(HOME).toContain("transition-shadow duration-[120ms] hover:shadow-sm");
  });
});
