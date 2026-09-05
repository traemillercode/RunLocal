/**
 * Phase 2, Stage 1 — tokens.
 *
 * The finding that shaped this: 973 arbitrary font sizes across the app resolve
 * to SIX values. The scale already exists and has been consistent for months.
 * It has no NAMES, which is why every new component re-derives it from whatever
 * was nearby — and why it will drift the moment someone eyeballs a seventh.
 *
 * So Stage 1 is naming, not redesign. Nothing is converted here: the sweep is
 * Stage 3, page by page, and converting 973 call sites in one commit would be
 * untestable in exactly the way a page-at-a-time conversion is not.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../src/styles/app.css", import.meta.url).pathname, "utf8");

function uiSources(): string[] {
  const out: string[] = [];
  for (const dir of ["../src/pages", "../src/components"]) {
    const path = new URL(dir, import.meta.url).pathname;
    for (const f of readdirSync(path).filter((x) => x.endsWith(".tsx"))) {
      out.push(readFileSync(`${path}/${f}`, "utf8"));
    }
  }
  return out;
}

function countAll(re: RegExp): Map<string, number> {
  const counts = new Map<string, number>();
  for (const src of uiSources()) {
    for (const m of src.matchAll(re)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  }
  return counts;
}

describe("the type scale is named", () => {
  it("defines a token for every size actually in use", () => {
    for (const token of ["--text-meta", "--text-caption", "--text-body", "--text-body-lg", "--text-subhead", "--text-title"]) {
      expect(CSS).toContain(token);
    }
  });

  it("names by role, not by size", () => {
    /*
     * "text-meta" survives a decision to make metadata 12px; "text-11" does
     * not, and renaming every call site is how a scale ossifies.
     */
    expect(CSS).not.toContain("--text-11");
    expect(CSS).not.toContain("--text-13");
  });
});

describe("no seventh font size appears", () => {
  it("stays within the six measured values", () => {
    /*
     * THE GUARD THAT MATTERS during Stage 3. The sweep will take months of
     * commits; what must not happen meanwhile is a seventh size arriving
     * because someone eyeballed it. Six is the scale — anything else is either
     * a decision worth discussing or a typo.
     *
     * 17px (once) and 18px (twice) are the existing accidents. They are listed
     * so they can be removed deliberately rather than grandfathered silently.
     */
    const KNOWN = new Set(["11px", "12px", "13px", "14px", "15px", "16px", "17px", "18px"]);
    const sizes = new Set<string>();
    for (const src of uiSources()) {
      for (const m of src.matchAll(/text-\[(\d+px)\]/g)) sizes.add(m[1]);
    }
    expect([...sizes].filter((s) => !KNOWN.has(s))).toEqual([]);
  });

  it("records the two accidents so they are not grandfathered", () => {
    // 17px once and 18px twice, against 973 total. Almost certainly typos for
    // 16 and 20 rather than decisions — and worth deleting during the sweep.
    const counts = countAll(/text-\[1[78]px\]/g);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(3);
  });
});

describe("elevation is one value, not five", () => {
  it("is recorded rather than tokenised", () => {
    /*
     * 131 of 140 shadow uses are shadow-sm; the other nine are 2xl, lg and md
     * scattered across unrelated components.
     *
     * Naming five levels would invent a system that does not exist and invite
     * people to use it. The comment says what is true; there is no token,
     * deliberately.
     */
    expect(CSS).toContain("NOT FIVE SHADOWS");
    expect(CSS).not.toContain("--shadow-lg");
    expect(CSS).not.toContain("--shadow-2xl");
  });

  it("shadow-sm still dominates", () => {
    // If this ever stops being true, elevation has become a real system and
    // deserves real tokens — which is a decision, not a drift.
    const counts = countAll(/shadow-(sm|md|lg|xl|2xl)/g);
    const sm = counts.get("shadow-sm") ?? 0;
    const rest = [...counts].filter(([k]) => k !== "shadow-sm").reduce((a, [, v]) => a + v, 0);
    expect(sm).toBeGreaterThan(rest * 5);
  });
});

describe("the control radius has a name", () => {
  it("is a token, because 61 uses is not an arbitrary value", () => {
    /*
     * rounded-[10px] appeared 61 times — more than rounded-md and rounded-3xl
     * combined — which makes it a token nobody named. It is the button and
     * input radius.
     */
    expect(CSS).toContain("--radius-control: 10px;");
  });
});
