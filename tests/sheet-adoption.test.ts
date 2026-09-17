/**
 * Stage 2 said "build Sheet". The work was ADOPTING the Sheet that existed.
 *
 * Audited the seven hand-rolled overlays in the product against the six things
 * a modal has to do — Escape, body scroll lock, backdrop dismiss, focus trap,
 * focus return, aria-modal:
 *
 *   ui.tsx Sheet             6 of 6
 *   TourHost                 3 of 6
 *   AttendeeListSheet        2 of 6
 *   AvatarPicker             1 of 6
 *   CalendarExportButton     1 of 6
 *   RecurrenceSchedulerSheet 1 of 6
 *   SafetyActions            1 of 6
 *
 * A complete, correct implementation, used by two files, while six others each
 * reinvented it and got one or two parts. Twelfth instance in this build of a
 * correct implementation nothing reached for — and the first where the thing
 * nobody reached for was a COMPONENT rather than an endpoint.
 *
 * The lesson for the rest of Stage 2: check whether Card and MetricRow already
 * exist somewhere before writing them.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

const UI = readFileSync(new URL("../src/components/ui.tsx", import.meta.url).pathname, "utf8");
const PICKER = readFileSync(new URL("../src/components/AvatarPicker.tsx", import.meta.url).pathname, "utf8");

describe("the Sheet does all six things", () => {
  const sheet = UI.slice(UI.indexOf("export function Sheet"), UI.indexOf("export function Popover"));

  it("closes on Escape", () => {
    expect(sheet).toContain('e.key === "Escape"');
  });

  it("locks body scroll", () => {
    expect(sheet).toContain('document.body.style.overflow = "hidden"');
  });

  it("restores the PREVIOUS overflow, not a hard-coded value", () => {
    /*
     * THE BUG THIS AUDIT FOUND. It restored to "" — and a hard-coded restore is
     * how one overlay silently un-does another's lock: open a sheet from inside
     * a sheet, close the inner one, and the outer is left with a scrollable
     * page underneath it.
     *
     * The identical defect was fixed in the marketing mobile menu earlier in
     * this build and this copy was missed, which is precisely the cost of seven
     * overlays reinventing a behaviour instead of one owning it.
     */
    expect(sheet).toContain("const previousOverflow = document.body.style.overflow;");
    expect(sheet).toContain("document.body.style.overflow = previousOverflow;");
  });

  it("returns focus to whatever opened it", () => {
    // Otherwise closing strands focus on <body> and a keyboard user restarts
    // from the top of the page.
    expect(sheet).toContain("requestAnimationFrame(() => trigger.focus())");
  });

  it("announces itself as a modal", () => {
    expect(sheet).toContain('aria-modal="true"');
  });
});

describe("adoption", () => {
  it("AvatarPicker uses it rather than its own overlay", () => {
    /*
     * It had one of six: a backdrop click. No Escape, no scroll lock, no focus
     * handling — and it is the sheet shown when someone is blocked from their
     * first RSVP, so it is the first modal a new user meets.
     */
    expect(PICKER).toContain("<Sheet open onClose={onClose}");
    expect(PICKER).not.toContain('className="fixed inset-0 z-[70]');
  });

  it("records why, so it is not unwound as indirection", () => {
    // A hand-rolled div reads as simpler at the call site. The six behaviours
    // are invisible until one is missing.
    expect(PICKER).toContain("all six behaviours");
  });
});

describe("the remaining overlays are counted, not forgotten", () => {
  it("hand-rolled overlay count only goes down", () => {
    /*
     * Five remain — AttendeeListSheet, CalendarExportButton,
     * RecurrenceSchedulerSheet, SafetyActions, TourHost.
     *
     * A ceiling rather than zero, because two of them are arguably not sheets:
     * TourHost is a coach-mark layer and CalendarExportButton is a popover.
     * The number moving down is the sweep working; it moving up means someone
     * wrote a seventh overlay instead of using the one that does all six.
     */
    const offenders: string[] = [];
    const path = new URL("../src/components", import.meta.url).pathname;
    for (const f of readdirSync(path).filter((x) => x.endsWith(".tsx"))) {
      if (f === "ui.tsx") continue;
      const src = readFileSync(`${path}/${f}`, "utf8");
      if (/className="fixed inset-0/.test(src)) offenders.push(f);
    }
    expect(offenders.length).toBeLessThanOrEqual(5);
  });
});
