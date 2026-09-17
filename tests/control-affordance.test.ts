/**
 * "Nothing looks pressable" — measured, after three wrong measurements.
 *
 * THE HEADLINE NUMBER DID NOT SURVIVE CONTACT. The review counted 147 ghost
 * buttons of 311 — 47% — and called it the reason the product reads as flat.
 * Each attempt to locate the problem over-reported, and the reason each time
 * was the same: I used a proxy for "looks pressable" and the proxy was wrong.
 *
 *   ATTEMPT 1: "is any button filled?" Classified the board's RSVP button as
 *   ghost. It sets `background: bg` from a variable that resolves to ink or
 *   coral — filled, and the board's hierarchy was already correct.
 *
 *   ATTEMPT 2: "which pages have no filled button?" Six pages. Five were
 *   correct as they stood — VerifyPage's only button is "Back", ProfilePage's
 *   is an error-state "Retry", EventsPage's main action is a full-width card
 *   row with an icon and a chevron, which is visibly pressable without a fill.
 *
 *   ATTEMPT 3: "no affordance class?" 28 buttons, but the filter missed
 *   `active:bg` — so Settings' "Sign out" was flagged while having a perfectly
 *   good press state.
 *
 * Narrowing to controls with NO affordance in ANY state — no fill, border,
 * ring, underline, shadow, hover, active, or focus treatment — leaves 15.
 * Fifteen, not 147.
 *
 * So the ghost figure counts menu items, icon buttons, card rows and tertiary
 * actions that are all correctly unfilled. The real defect is a tenth the size
 * and it is a different defect: not "unfilled" but "no state at all".
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Any affordance, in any state. A control needs ONE of these — a fill, an
 * outline, an underline, an icon, or something that changes on hover, press or
 * focus. `active:` alone is enough on a touch surface, where hover does not
 * exist and the press is the only feedback available.
 */
const AFFORDANCES = [
  "#FF5741", "CORAL", "#14171C", "INK", "bg-slate-9", "bg-rose", "bg-emerald",
  "bg-white", "bg-slate-1", "ring-", "border", "underline", "shadow",
  "hover:", "active:", "focus-visible", "group-hover", "variant=",
  "aria-label", "background: bg", "rounded-full", "kb-anim",
];

function buttonTags(src: string): { tag: string; label: string }[] {
  const out: { tag: string; label: string }[] = [];
  let i = 0;
  for (;;) {
    i = src.indexOf("<button", i);
    if (i < 0) break;
    // Walk to the closing > while tracking braces — an arrow function's => is
    // inside braces and must not end the tag. A naive [^>]* stops there and
    // reads half a tag, which is how the first attempt misclassified things.
    let depth = 0;
    let j = i;
    for (; j < src.length; j += 1) {
      const c = src[j];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    const close = src.indexOf("</button>", j);
    const body = close > 0 ? src.slice(j + 1, close) : "";
    out.push({ tag: src.slice(i, j + 1), label: body.replace(/<[^>]*>/g, "").trim() });
    i = j + 1;
  }
  return out;
}

function bareControls(): string[] {
  const out: string[] = [];
  for (const dir of ["../src/pages", "../src/components"]) {
    const path = new URL(dir, import.meta.url).pathname;
    for (const f of readdirSync(path).filter((x) => x.endsWith(".tsx"))) {
      const src = readFileSync(`${path}/${f}`, "utf8");
      for (const { tag, label } of buttonTags(src)) {
        if (AFFORDANCES.some((a) => tag.includes(a))) continue;
        // Dynamic labels cannot be judged from source; skip rather than guess.
        if (!label || label.includes("{")) continue;
        out.push(`${f}: "${label.slice(0, 30)}"`);
      }
    }
  }
  return out;
}

describe("every control has an affordance in some state", () => {
  it("does not grow", () => {
    /*
     * A CEILING, not zero. Twelve remain and several are defensible — a
     * "Cancel" beside a filled confirm reads as the quiet option BECAUSE it is
     * quiet, and giving it equal weight would be worse.
     *
     * The value is directional: this only moves down as the Stage 3 sweep
     * routes buttons through the shared component, and it fails if someone adds
     * a new control that is static text pretending to be pressable.
     */
    expect(bareControls().length).toBeLessThanOrEqual(13);
  });

  it("the discussion actions have one", () => {
    /*
     * Reply, Delete and Try again were plain coloured text beside a post — the
     * clearest instance of "nothing looks pressable" in the product, on a
     * screen a beta user reaches.
     *
     * Underline-on-hover plus a press state rather than a fill: these are
     * tertiary actions next to content, and filling them would make them
     * compete with the RSVP button they sit under.
     */
    const detail = readFileSync(new URL("../src/pages/EventDetailPage.tsx", import.meta.url).pathname, "utf8");
    for (const label of ["Reply", "Delete", "Try again"]) {
      const at = detail.indexOf(`>${label}<`);
      expect(at, `${label} should exist`).toBeGreaterThan(-1);
      const tag = detail.slice(detail.lastIndexOf("<button", at), at);
      expect(tag, `${label} needs an affordance`).toContain("hover:decoration");
    }
  });

  it("they meet the touch target too", () => {
    // A 12px text button is a 15px tap target. The affordance and the target
    // are separate problems and both were present here.
    const detail = readFileSync(new URL("../src/pages/EventDetailPage.tsx", import.meta.url).pathname, "utf8");
    const at = detail.indexOf(">Reply<");
    expect(detail.slice(detail.lastIndexOf("<button", at), at)).toContain("min-h-11");
  });
});
