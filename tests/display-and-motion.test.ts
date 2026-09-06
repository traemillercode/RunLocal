/**
 * The two changes that carry most of the perceived difference, and neither
 * needs a dependency.
 *
 * TWO TYPE SYSTEMS, NOT ONE — the correction that shaped this. 737 named
 * Tailwind sizes AND 990 arbitrary px values, running in parallel and unaware
 * of each other. 1,727 type declarations total, and Stage 1's six tokens named
 * only the arbitrary half.
 *
 * Of the named half, 615 of 737 are 12px or 14px — 83% — and seven uses in the
 * whole application exceed 24px.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readCode } from "./helpers/source";

const CSS = readFileSync(new URL("../src/styles/app.css", import.meta.url).pathname, "utf8");
const BUTTON = readCode(new URL("../src/components/Button.tsx", import.meta.url));
const CHECKIN = readCode(new URL("../src/pages/CheckinPage.tsx", import.meta.url));

describe("the app has display type", () => {
  it("defines headline and display above the body scale", () => {
    /*
     * The six Stage 1 tokens span 11px to 16px — body and below. Nothing is
     * loud, so nothing is important. Contrast is what reads as designed.
     */
    expect(CSS).toContain("--text-headline: 22px;");
    expect(CSS).toContain("--text-display: 34px;");
  });

  it("records the rule that uses them", () => {
    // A token with no rule becomes a seventh size. The rule is per-screen and
    // it is a design judgment, so it lives where someone will read it.
    expect(CSS).toContain("ONE\n   * THING IS THE ANSWER TO WHY YOU OPENED THIS PAGE");
  });
});

describe("the check-in confirmation is the answer on its screen", () => {
  it("is no longer body size", () => {
    /*
     * "That's your 12th run with Columbia Track Club" is the thing someone
     * screenshots, and it rendered at text-sm — the same size as a form label,
     * in a green box.
     */
    /*
     * Scoped to the notice element itself, not a character window — a 400-char
     * window reached the next heading and matched its text-sm, which would have
     * been a guard failing on something it was not watching.
     */
    const at = CHECKIN.indexOf('role="status"');
    const close = CHECKIN.indexOf(">", CHECKIN.indexOf("className", at));
    const element = CHECKIN.slice(at, close);
    expect(element).not.toContain("text-sm");
    expect(element).toContain("var(--text-headline)");
  });
});

describe("motion is functional, not decorative", () => {
  it("defines the durations and one easing", () => {
    for (const t of ["--m-fast: 120ms;", "--m-base: 200ms;", "--m-slow: 320ms;", "--ease-spring:"]) {
      expect(CSS).toContain(t);
    }
  });

  it("Button presses", () => {
    /*
     * One change reaching 311 buttons as the sweep routes them here. The thing
     * that moves is the one being touched, and it moves because state changed
     * rather than because it appeared.
     */
    expect(BUTTON).toContain("active:scale-[0.97]");
    expect(BUTTON).toContain("duration-[120ms]");
  });

  it("does not animate every property", () => {
    // transition-all animates properties nobody meant to, including layout
    // ones, which is how a press becomes a reflow.
    expect(BUTTON).not.toContain("transition-all");
    expect(BUTTON).toContain("transition-[transform,background-color]");
  });

  it("respects reduced motion", () => {
    // A press animation is exactly the kind of thing that makes a product
    // unusable for someone with vestibular sensitivity.
    expect(BUTTON).toContain("motion-reduce:active:scale-100");
  });

  it("nothing animates on scroll", () => {
    /*
     * The most recognisable template signature there is, and it makes every
     * section feel identical. Asserted as an absence so it stays one.
     */
    const src = readCode(new URL("../src/components/Button.tsx", import.meta.url));
    expect(src).not.toContain("animate-fade-up");
    expect(CSS).not.toContain("@keyframes fadeUp");
  });
});
