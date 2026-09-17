/**
 * The card — the one Stage 2 primitive that genuinely did not exist.
 *
 * AUDITED FIRST, and the audit is why this is worth reading: Sheet existed and
 * did all six things, Metric existed and was private to one component. Card did
 * not. What exists is RailCard, a STRUCTURED sidebar card with kicker, title
 * and footer — far too opinionated for 52 generic surfaces.
 *
 * MEASURED: `rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70`,
 * 52 exact matches, every near-miss differing only in padding — p-5 (40),
 * p-4 (9), p-6 (3) — or dropping the ring opacity.
 *
 * Not chaos. A system with one name missing, the same shape as the type scale:
 * a consistent choice made by hand 52 times, which drifts the moment someone
 * eyeballs a fourth padding.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const CARD = readFileSync(new URL("../src/components/Card.tsx", import.meta.url).pathname, "utf8");
const PURGE = readFileSync(new URL("../src/components/PurgeSection.tsx", import.meta.url).pathname, "utf8");
const FORUM = readFileSync(new URL("../src/pages/ForumPage.tsx", import.meta.url).pathname, "utf8");

describe("the three densities are named, not flattened", () => {
  it("keeps all three measured values", () => {
    /*
     * THE DENSITIES ARE THE POINT. The template look uses one padding
     * everywhere; real interfaces have rhythm — a metric group is tight, a card
     * is generous, a section break is airy.
     *
     * The measured distribution already encodes that, so normalising to a
     * single padding would have destroyed the one thing the cards were getting
     * right by hand.
     */
    expect(CARD).toContain('compact: "p-4"');
    expect(CARD).toContain('default: "p-5"');
    expect(CARD).toContain('generous: "p-6"');
  });

  it("offers exactly three", () => {
    // Three is a decision; a fourth should be an argument someone makes, not a
    // class someone types.
    expect((CARD.match(/^\s{2}(compact|default|generous):/gm) ?? []).length).toBe(3);
  });

  it("records why the distribution was not normalised", () => {
    expect(CARD).toContain("THE THREE DENSITIES ARE THE POINT");
  });
});

describe("it does not accumulate variants", () => {
  it("has no tone or danger variant", () => {
    /*
     * PurgeSection needs a rose ring and passes it through className. A
     * "danger" card variant would invite a second, and then a "success" one,
     * and the component becomes the place every page states its exception.
     *
     * className is the escape hatch here for the same reason it is on Button:
     * one-offs stay one-offs instead of becoming API.
     */
    expect(CARD).not.toContain("tone");
    expect(CARD).not.toContain("danger");
    expect(CARD).toContain("className");
  });

  it("can be the semantic element rather than wrapping one", () => {
    /*
     * `as="section"` matters: a div wrapping a section is the kind of nesting
     * that makes a page unreadable to a screen reader while changing nothing
     * visible, and it is what happens when a card component only renders divs.
     */
    expect(CARD).toContain('as?: "div" | "section" | "li" | "article"');
    expect(PURGE).toContain('<Card as="section"');
  });
});

describe("adoption", () => {
  it("PurgeSection uses it, with its one-off via className", () => {
    expect(PURGE).toContain('className="mt-4 ring-rose-200"');
    expect(PURGE).not.toContain("rounded-2xl bg-white p-5 shadow-sm");
  });

  it("the forum empty state uses the generous density", () => {
    // A card that is the only thing on its screen earns the extra padding —
    // which is the case the p-6 measurement was describing.
    expect(FORUM).toContain('<Card density="generous"');
  });
});
