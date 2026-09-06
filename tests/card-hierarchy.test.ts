/**
 * One thing wins per surface, and it is a different thing on each.
 *
 * The question underneath the hierarchy is what the surface is FOR:
 *
 *   The board answers "am I free for this" — someone scanning a week filters
 *   on when, and 6am and 6pm are different answers. TIME WINS.
 *
 *   The detail page answers "what is this run" — you already know which one it
 *   is, or you would not have tapped through. TITLE WINS.
 *
 * Same content, opposite hierarchy. That looks inconsistent to anyone who reads
 * consistency as identical; it is the opposite — each surface answers its own
 * question.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { readCode } from "./helpers/source";

const BOARD = readCode(new URL("../src/components/DepartureBoard.tsx", import.meta.url));
const DETAIL = readCode(new URL("../src/pages/EventDetailPage.tsx", import.meta.url));

describe("time wins on the board", () => {
  it("the clock is display-sized, not the date", () => {
    /*
     * It was backwards: the date number at 28-34px and the time at 13-15px, so
     * the loudest thing was which DAY and the quietest was the thing people
     * actually filter on.
     */
    const at = BOARD.indexOf("{clock}");
    const element = BOARD.slice(BOARD.lastIndexOf("<span", at), at);
    expect(element).toContain('hero ? "var(--text-display)" : "28px"');
  });

  it("the date is demoted to the kicker line", () => {
    // Day and date now read as one quiet label above the time, rather than
    // competing with it.
    expect(BOARD).toContain("{dowFmt.format(event.startsAt)} {event.startsAt.getDate()}");
  });

  it("the two are genuinely different sizes", () => {
    /*
     * 28px against a 20px title. Two elements within a few px of each other
     * compete, and competing is what "no hierarchy" looks like from the inside
     * — it just has bigger text.
     */
    /*
     * Anchored on the h3 that holds the title rather than a character window —
     * my first version used 400 chars and landed in the RSVP label above it,
     * which is a guard reading something it was not watching. Third time this
     * session, and the fix is always to anchor on structure.
     */
    /*
     * Searched FORWARD from the h3, not backward from the title text. My
     * earlier versions did the latter, and the first `{event.name}` in the file
     * is inside an aria-label template — `\${event.name}` contains it — so the
     * search landed 160 lines above the card and read an empty slice.
     * A guard reading the wrong region passes or fails for reasons unrelated to
     * what it watches. Third time this session; anchoring on structure is the
     * fix, and the direction of the search is part of the structure.
     */
    const h3 = BOARD.indexOf("<h3");
    const titleBlock = BOARD.slice(h3, BOARD.indexOf("</h3>", h3));
    expect(titleBlock).toContain('hero ? "30px" : "20px"');
  });
});

describe("title wins on the detail page", () => {
  it("is display-sized", () => {
    expect(DETAIL).toContain('style={{ fontSize: "var(--text-display)" }}');
  });

  it("is no longer text-2xl", () => {
    const at = DETAIL.indexOf("{event.title}");
    expect(DETAIL.slice(Math.max(0, at - 300), at)).not.toContain("text-2xl");
  });
});

describe("the readability floor covers inline styles too", () => {
  it("no fontSize below 11px anywhere", () => {
    /*
     * THE GAP THIS FOUND. The meridiem was 9px, and it got there as an INLINE
     * STYLE — which the accessibility guard never saw, because that guard
     * matches Tailwind classes.
     *
     * A floor covering one of the two ways to set a size is half a floor, and
     * the half it missed is the one people reach for when a utility class does
     * not exist for the value they want.
     */
    const offenders: string[] = [];
    for (const dir of ["../src/pages", "../src/components"]) {
      const path = new URL(dir, import.meta.url).pathname;
      for (const f of readdirSync(path).filter((x) => x.endsWith(".tsx"))) {
        const src = readFileSync(`${path}/${f}`, "utf8");
        for (const m of src.matchAll(/fontSize:\s*"(\d+)px"/g)) {
          if (Number(m[1]) < 11) offenders.push(`${f}: ${m[1]}px`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
