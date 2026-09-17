#!/usr/bin/env bash
#
# Runs the suite with the clock advanced, to find tests that will fail on a
# calendar date rather than on a code change.
#
# WHY THIS AND NOT A DATE SCANNER. The obvious version greps fixtures for
# hardcoded future dates and complains about them. I wrote that first: it found
# 47 and flagged 14 as imminent.
#
# Then I advanced the clock and measured. At two months out, ZERO of them broke
# anything. At nine months, exactly ONE did — a waiver version created at a
# fixed instant, whose validity window elapsed so a freshly signed waiver read
# as expired.
#
# So the scanner was wrong about 46 of 47. Fixing what it flagged would have
# meant changing 46 fixtures that were fine, and a guard that is wrong 98% of
# the time gets ignored, which is worse than no guard.
#
# Advancing the clock is a direct measurement instead of a heuristic. Same
# lesson as reaching for the browser instead of the stylesheet: for a claim
# about what the system does, run the system.
#
# Requires root to set the clock, so this is a CI job rather than a local
# pre-commit hook.
set -euo pipefail

ORIGINAL="$(date -u +'%Y-%m-%d %H:%M:%S')"
restore() { date -s "$ORIGINAL" >/dev/null 2>&1 || true; }
trap restore EXIT

BASELINE="tests/FAILING-BASELINE.txt"
FAILED=0

for OFFSET in "+2 months" "+9 months" "+18 months"; do
  TARGET="$(date -u -d "$OFFSET" +'%Y-%m-%d')"
  date -s "$TARGET" >/dev/null 2>&1
  echo "=== suite at ${TARGET} (${OFFSET}) ==="
  rm -rf dist
  bun run test > /tmp/tb-run.log 2>&1 || true
  grep "FAIL" /tmp/tb-run.log | sed 's/^ *FAIL *//;s/ >.*//' | sort -u > /tmp/tb-failed.txt
  NEW="$(comm -13 <(sort "$BASELINE") /tmp/tb-failed.txt || true)"
  if [ -n "$NEW" ]; then
    echo "TIME BOMB — these fail at ${TARGET} but not today:"
    echo "$NEW" | sed 's/^/  /'
    FAILED=1
  else
    echo "  clean against baseline"
  fi
  restore
done

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "Fix by making the fixture RELATIVE to now (daysFromNow(30)) where the test"
  echo "is about the relationship to today, or by pinning the clock with"
  echo "vi.setSystemTime where a fixed instant genuinely matters. Pinning one"
  echo "clock and letting another run free is how the first of these happened."
  exit 1
fi
