#!/usr/bin/env node
/**
 * Fail CI on a NEW test failure, not on the count being non-zero.
 *
 * The suite carries ~21 known failures across 10 files — real defects, each
 * tracked, none blocking. A gate that demanded zero would be red permanently
 * and would therefore be ignored, which is the same as not having one.
 *
 * So this compares the failing-FILE list against a committed baseline. It is
 * the method used by hand all day, made automatic:
 *
 *   a file that starts failing  -> FAIL, loudly
 *   a file that stops failing   -> FAIL, asking for the baseline to be updated
 *
 * The second direction matters as much as the first. A baseline that silently
 * drifts looser stops meaning anything, and "we fixed something" should be
 * recorded rather than absorbed.
 *
 * Files, not counts, because a file's individual failures churn while it is
 * being worked on. The file list is the stable signal — and a NEW failure
 * inside an already-failing file is the one gap, which is why the count is
 * reported alongside for a human to read.
 */
import { readFileSync } from "node:fs";

const baselinePath = "tests/FAILING-BASELINE.txt";
const output = readFileSync(process.argv[2], "utf8");

const baseline = readFileSync(baselinePath, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const actual = [...new Set([...output.matchAll(/FAIL\s+(\S+)/g)].map((m) => m[1]))].sort();

const added = actual.filter((f) => !baseline.includes(f));
const fixed = baseline.filter((f) => !actual.includes(f));

const count = /Tests\s+(\d+) failed/.exec(output)?.[1] ?? "?";
console.log(`failing files: ${actual.length} (baseline ${baseline.length}) — ${count} individual failures`);

if (added.length > 0) {
  console.error("\nNEW FAILING FILES — this change broke something:");
  for (const f of added) console.error(`  + ${f}`);
}
if (fixed.length > 0) {
  console.error("\nFILES NO LONGER FAILING — update the baseline in the same commit:");
  for (const f of fixed) console.error(`  - ${f}`);
  console.error(`\n  Run the suite and rewrite ${baselinePath} with the current list.`);
}
if (added.length > 0 || fixed.length > 0) process.exit(1);
console.log("baseline matches.");
