/**
 * Guard: a skipped test is a failing test with the alarm switched off.
 *
 * The suite went from 30 failures to 24 partly because 6 tests were SKIPPED,
 * not fixed. That is a legitimate move — they cover a removed route we intend
 * to restore (roadmap 6.1) — but it is a subtraction from the safety net, and
 * subtractions must be visible. Without this, the honest way to a green suite
 * is to keep skipping, and nobody notices until something real is silenced.
 *
 * Every skip must be listed below WITH A REASON and an unskip condition. A new
 * describe.skip is then a build failure rather than a quiet win.
 *
 * `.only` is treated as far more serious: it silences every OTHER test in its
 * file. A committed `.only` can turn a whole suite green while running three
 * assertions, so it is never allowed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TESTS = new URL(".", import.meta.url).pathname;
const SELF = "skip-registry.test.ts";
const files = readdirSync(TESTS).filter((f) => /\.test\.tsx?$/.test(f) && f !== SELF);

/**
 * The ONLY sanctioned skips. Keyed by file, valued by why and when it ends.
 * Adding an entry is a deliberate act with a written justification; that is
 * the entire point.
 */
const SANCTIONED_SKIPS: Record<string, { count: number; reason: string; unskipWhen: string }> = {
  "cms-admin.test.ts": {
    count: 1,
    reason:
      "Covers /api/connections/strava, a route removed from src/ entirely. Not a stale assertion — a test for a deleted feature, and the surviving spec for how CMS enable/disable gates a connection attempt.",
    unskipWhen: "roadmap 6.1 lands read-only import (Apple Health first, then Strava/Garmin)",
  },
};

function skipsIn(src: string): number {
  return (src.match(/\b(?:describe|it|test)\.skip\s*\(/g) ?? []).length;
}

describe("skip registry", () => {
  it("every skip is sanctioned, with a reason and an unskip condition", () => {
    const unsanctioned: string[] = [];
    for (const f of files) {
      const n = skipsIn(readFileSync(join(TESTS, f), "utf8"));
      if (n === 0) continue;
      const entry = SANCTIONED_SKIPS[f];
      if (!entry) {
        unsanctioned.push(`${f} has ${n} skip(s) with no entry in SANCTIONED_SKIPS`);
      } else if (n !== entry.count) {
        unsanctioned.push(`${f} has ${n} skip(s), registry says ${entry.count}`);
      }
    }
    expect(unsanctioned).toEqual([]);
  });

  it("the registry cannot rot — every sanctioned file still exists and still skips", () => {
    // Without this, an entry outlives the skip it describes and the registry
    // becomes a list of names nobody trusts.
    const stale: string[] = [];
    for (const [f, entry] of Object.entries(SANCTIONED_SKIPS)) {
      if (!files.includes(f)) { stale.push(`${f} no longer exists`); continue; }
      const n = skipsIn(readFileSync(join(TESTS, f), "utf8"));
      if (n === 0) stale.push(`${f} no longer skips anything — remove its entry`);
      expect(entry.reason.length).toBeGreaterThan(30);
      expect(entry.unskipWhen.length).toBeGreaterThan(10);
    }
    expect(stale).toEqual([]);
  });

  it("no .only anywhere — it silences every other test in its file", () => {
    // Strictly worse than a skip: a skip removes one test, a committed .only
    // removes all but one while still reporting green.
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(TESTS, f), "utf8");
      if (/\b(?:describe|it|test)\.only\s*\(/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
