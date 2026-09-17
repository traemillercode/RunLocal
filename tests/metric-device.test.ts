/**
 * The quiet label, the loud value — one implementation.
 *
 * AUDITED BEFORE BUILDING, which is the lesson from Sheet: a correct
 * implementation already existed and was PRIVATE to DepartureBoard, while 43
 * other files hand-rolled the uppercase-tracked label across 110 uses.
 *
 * Most of those 110 are section headings, not metrics, and the distinction is
 * the thing worth keeping: a Metric is a label ABOVE A VALUE. A heading is just
 * a label. Over-reporting that difference is how the ghost audit went wrong
 * three times, so this guard counts the device rather than the class.
 *
 * It reads as designed because it is a considered choice about THIS content — a
 * run's pace is a fact you scan, so the fact is loud and its name is quiet.
 * That is specificity rather than style, and specificity is the only reliable
 * way out of the templated look.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const METRIC = readFileSync(new URL("../src/components/Metric.tsx", import.meta.url).pathname, "utf8");
const BOARD = readFileSync(new URL("../src/components/DepartureBoard.tsx", import.meta.url).pathname, "utf8");
const PROFILE = readFileSync(new URL("../src/pages/ProfilePage.tsx", import.meta.url).pathname, "utf8");

describe("there is one implementation", () => {
  it("DepartureBoard delegates rather than keeping a copy", () => {
    /*
     * This was the original and the good one. Extracting it and leaving the
     * copy behind would have made two implementations of the strongest device
     * in the product — which is exactly how the seven-overlay problem started,
     * and the fix then had to be found seven times.
     */
    expect(BOARD).toContain("<SharedMetric label={label} value={value}");
    // The old body is gone, not commented out beside the delegation.
    expect(BOARD).not.toContain('<Kicker color={muted}>{label}</Kicker>');
  });

  it("the local signature is kept, so call sites did not churn", () => {
    // A rename touching every call site turns a consolidation into a diff
    // nobody can review.
    expect(BOARD).toContain("function Metric({ label, value, inverted }: MetricProps)");
  });
});

describe("it uses the tokens rather than literals", () => {
  it("draws from the named type scale", () => {
    for (const t of ["var(--text-meta)", "var(--text-subhead)", "var(--text-display)"]) {
      expect(METRIC).toContain(t);
    }
  });

  it("declares no px font size of its own", () => {
    /*
     * The Stage 1 rule: a component that names its own size is how a seventh
     * value appears. The guard on arbitrary text-[Npx] classes would not catch
     * an inline fontSize, which is the gap the board card's 9px meridiem got
     * through.
     */
    expect(METRIC).not.toMatch(/fontSize:\s*"\d+px"/);
  });

  it("uses tabular numerals", () => {
    /*
     * Not decoration. A column of paces or distances whose digits do not align
     * reads as sloppy at a glance, and every value this renders is a number or
     * a short measurement.
     */
    expect(METRIC).toContain("tabular-nums");
  });
});

describe("display size is rationed", () => {
  it("the profile count uses it", () => {
    // The count IS the answer to why someone opened their own profile.
    expect(PROFILE).toContain('size="display"');
  });

  it("records that it is one per screen", () => {
    /*
     * Two display metrics side by side compete and neither wins, which is the
     * same failure as the board card having a loud title AND a loud time before
     * the hierarchy was settled.
     */
    expect(METRIC).toContain("One per screen at most");
  });

  it("the board does not use it", () => {
    // The board's loud element is the clock in the gutter, not a metric. A
    // display metric in the card body would compete with it.
    const at = BOARD.indexOf("<SharedMetric");
    expect(BOARD.slice(at, at + 200)).not.toContain('size="display"');
  });
});
