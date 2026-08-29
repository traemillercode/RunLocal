/**
 * Accessibility guard (roadmap 0.11).
 *
 * Three legs, each a structural rule rather than a one-time cleanup, because
 * all three regress silently — nothing throws when a button is 40px tall or a
 * label is missing.
 *
 * Leg 3 has a second payoff beyond compliance: 0.7's feedback breadcrumbs
 * describe a control by its aria-label (never innerText, so a click on a
 * message bubble can't capture the message). An icon-only button with no
 * accessible name therefore produces a near-blank crumb like `button[]`, so
 * every label added here directly improves the quality of beta bug reports.
 *
 * Static analysis rather than axe-on-rendered-DOM: these three rules are
 * decidable from source, they cover every page including ones no test renders,
 * and they run in milliseconds. axe-core is installed for the render-time
 * checks (contrast, ARIA relationships) that source analysis genuinely cannot
 * decide — those belong with the Phase 2 component work, where there'll be a
 * design system to assert against rather than 41 hand-rolled pages.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname;
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}
const files = walk(SRC);
const rel = (f: string) => f.replace(SRC, "src");

describe("0.11 leg 1 — nothing below the 11px readability floor", () => {
  it("no text-[8px] / text-[9px] / text-[10px] anywhere", () => {
    // Read at arm's length before a 6am run, by an audience that skews older
    // than most tech products. 8-10px fails outright.
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        const m = /text-\[(8|9|10)px\]/.exec(line);
        if (m) offenders.push(`${rel(f)}:${i + 1} ${m[0]}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("0.11 leg 2 — touch targets meet the 44px minimum", () => {
  it("no <button> is shorter than h-11", () => {
    // Reads the BUTTON's own className only. A naive line-wide search matches
    // the nested <Icon className="h-5 w-5" /> instead and reports the icon's
    // size as the touch target - which produced 20+ false positives when this
    // test was first written.
    //
    // Known limit, stated rather than hidden: a button sized by padding alone
    // (p-1.5, no explicit height) can't be judged from source. Those are real
    // candidates but need rendered measurement, which belongs with the Phase 2
    // Button component where there'll be one place to fix them.
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const re = /<button\b([^>]*)>/gs;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(m[1]);
        if (!cls) continue;
        // `min-h-11` already satisfies the rule - exclude it, or its embedded
        // "h-11" is misread as a bare height (and a `min-h-8` would be missed).
        const clsText = (cls[1] ?? cls[2] ?? "").replace(/min-h-\d+/g, "");
        const h = /(?<![\w-])h-(\d+)(?![\w-])/.exec(clsText);
        if (h && Number(h[1]) < 11) {
          offenders.push(`${rel(f)}:${src.slice(0, m.index).split("\n").length} h-${h[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("0.11 leg 3 — every icon-only control has an accessible name", () => {
  it("no <button> whose only content is an <Icon> lacks aria-label or title", () => {
    // Re-derived from actual missing labels. The original audit claim (139
    // icon-only controls with no accessible name) inherited the false
    // "empty SVG" premise and was void; this measures the real thing.
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // "Icon-only" means genuinely no accessible text. A button rendering
      // `<Icon/> {busy ? "Accepting…" : "Accept Request"}` HAS a visible label
      // and needs no aria-label - an earlier version of this pattern allowed
      // any {...} expression as filler and reported four such buttons as
      // violations. Only whitespace and quote-free expressions (spacers like
      // {" "}) count as empty now.
      const re = /<button\b((?:[^>]|\n)*?)>((?:\s|\{["'\s]*\})*<Icon\b[^>]*\/>(?:\s|\{["'\s]*\})*)<\/button>/gs;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        if (/aria-label|title=/.test(m[1])) continue;
        offenders.push(`${rel(f)}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
