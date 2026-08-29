/**
 * Guard against clock-dependent tests.
 *
 * WHY THIS EXISTS: submissions-ui.test.tsx passed for days, then failed on a
 * Saturday morning with no commit in between — EventsPage correctly hides a
 * 7:00 AM Saturday seed run once it has started, and the test asserted that
 * run's title. Its own comment called it "a deterministic upcoming seed
 * event", which was the mistake made explicit.
 *
 * The cost is not the two tests. It is that "diff the failing list against a
 * baseline" — the method that has caught every real regression — becomes
 * unreliable when a failure can appear or vanish with the hour rather than
 * with a commit. During a beta week, hot-fixing against a shifting baseline is
 * how a real regression gets waved through as "that one was already failing".
 *
 * This asserts the narrow, decidable rule: a test that asserts on a seeded
 * WEEKDAY run's title must pin the clock, because those titles are only
 * present for part of the week.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TESTS = new URL(".", import.meta.url).pathname;
// This file necessarily names every seed title, so it would flag itself.
const SELF = "clock-dependence.test.ts";
const files = readdirSync(TESTS).filter((f) => /\.test\.tsx?$/.test(f) && f !== SELF);

/** Seeded weekly run titles. Present only while that day's run is still upcoming. */
const WEEKDAY_SEED_TITLES = [
  "Monday Evening Social Run",
  "Tuesday Night Track",
  "Wednesday Hills @ Grindstone",
  "Saturday Long Run",
  "Sunday Recovery Run",
];

describe("clock dependence", () => {
  it("any test asserting a seeded weekday run title pins the clock", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(TESTS, f), "utf8");
      const asserts = WEEKDAY_SEED_TITLES.filter((t) => src.includes(`"${t}`) || src.includes(`'${t}`));
      if (asserts.length === 0) continue;
      // A pinned clock is the fix; a test may also legitimately construct its
      // own fixture dates, but if it names a SEED title it depends on today.
      // Two legitimate ways to be safe, and both must count or the guard is
      // over-broad and gets ignored:
      //   1. pin the clock outright, or
      //   2. construct an explicit date literal and drive resolution from it,
      //      which several suites already do (events-weekly-merge passes
      //      new Date(2026, 7, 12) straight into resolveWeekEvents).
      // Unsafe is naming a seed title while depending on the REAL clock.
      const pinned = /setSystemTime\s*\(/.test(src);
      const explicitDate = /new Date\((?:2\d{3}|["'`]2\d{3})/.test(src);
      if (!pinned && !explicitDate) {
        offenders.push(`${f} asserts ${asserts.join(", ")} using the real clock`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the seed titles this guard watches still exist, so it can't silently stop guarding", () => {
    // If a seed run is renamed, the list above goes stale and the guard passes
    // vacuously — exactly the failure mode it exists to prevent.
    const cities = readFileSync(new URL("../src/data/cities.ts", import.meta.url).pathname, "utf8");
    for (const t of WEEKDAY_SEED_TITLES) expect(cities).toContain(t);
  });
});
