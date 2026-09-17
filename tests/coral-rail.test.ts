/**
 * The coral rail.
 *
 * The most distinctive device in the product, and it was on three surfaces:
 * the active nav item, the marketing live-board, and DepartureBoard's gutter
 * flooding coral when you are going.
 *
 * Naming it is what lets it spread without becoming decoration — and the
 * meaning is what makes it spreadable at all. Read across the three original
 * uses:
 *
 *   active nav       you are HERE
 *   going gutter     you are ATTENDING this
 *   marketing board  this is the live thing
 *
 * THE CORAL EDGE MARKS THE ITEM THAT CONCERNS THE VIEWER. Not "important",
 * not "new", not "accent" — there is a relationship between this person and
 * this row, and the rail is where it is stated.
 *
 * That rules things out, which is the entire point. Decoration applied
 * uniformly is the template look the rail exists to avoid, so the tests below
 * that assert ABSENCE matter more than the ones asserting presence.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../src/styles/app.css", import.meta.url).pathname, "utf8");
const NOTIFICATIONS = readFileSync(new URL("../src/pages/NotificationsPage.tsx", import.meta.url).pathname, "utf8");
const HOME = readFileSync(new URL("../src/pages/HomePage.tsx", import.meta.url).pathname, "utf8");

describe("the rail is a named device", () => {
  it("is defined once, as an inset shadow", () => {
    /*
     * Inset rather than border so it does not change the box size — a rail can
     * be added to an existing row without reflowing it, which is why this
     * could be applied to two live surfaces without touching their layout.
     */
    expect(CSS).toContain(".rail {");
    expect(CSS).toContain("box-shadow: inset 3px 0 var(--color-volt");
  });

  it("records the meaning, not just the value", () => {
    /*
     * A colour utility with no rule becomes an accent, and an accent applied
     * everywhere is decoration. The rule is the thing being preserved here.
     */
    expect(CSS).toContain("CONCERNS THE VIEWER");
  });
});

describe("it is applied where the relationship exists", () => {
  it("unread notifications carry it", () => {
    /*
     * Unread IS a relationship — this row concerns you and you have not dealt
     * with it. It was an orange background wash, which says "different" rather
     * than "yours", and a wash across a whole row competes with the text in it.
     */
    expect(NOTIFICATIONS).toContain('n.readAt ? "" : "rail bg-orange-50/40"');
  });

  it("your own clubs carry it", () => {
    expect(HOME).toContain('className="rail rounded-2xl bg-white px-4 py-3');
  });
});

describe("it is NOT applied as decoration", () => {
  /*
   * The half that matters. Every one of these would look fine and each would
   * cost the device its meaning — once a heading has a rail, a rail stops
   * telling you anything.
   */
  it("no heading or section title carries it", () => {
    const offenders: string[] = [];
    for (const dir of ["../src/pages", "../src/components"]) {
      const path = new URL(dir, import.meta.url).pathname;
      for (const f of readdirSync(path).filter((x) => x.endsWith(".tsx"))) {
        const src = readFileSync(`${path}/${f}`, "utf8");
        for (const m of src.matchAll(/<(h1|h2|h3|h4)[^>]*className="[^"]*\brail\b/g)) {
          offenders.push(`${f}: <${m[1]}>`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("Button does not accept it as a variant", () => {
    /*
     * A railed button would be a fifth treatment meaning nothing — the button's
     * job is stated by its variant, and "concerns you" is not a button state.
     */
    const button = readFileSync(new URL("../src/components/Button.tsx", import.meta.url).pathname, "utf8");
    expect(button).not.toContain("rail");
  });

  it("stays rare enough to mean something", () => {
    /*
     * Five uses across the app: three original plus two added. A ceiling rather
     * than an exact pin, because the number will grow as genuine cases appear —
     * but if it ever reaches twenty, it has become an accent and the meaning is
     * gone whether or not anyone decided that.
     */
    let uses = 0;
    for (const dir of ["../src/pages", "../src/components"]) {
      const path = new URL(dir, import.meta.url).pathname;
      for (const f of readdirSync(path).filter((x) => x.endsWith(".tsx"))) {
        uses += (readFileSync(`${path}/${f}`, "utf8").match(/className="[^"]*\brail\b/g) ?? []).length;
      }
    }
    expect(uses).toBeLessThanOrEqual(12);
  });
});
