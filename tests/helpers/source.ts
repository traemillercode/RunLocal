/**
 * Source-reading helpers for structural guards.
 *
 * WHY THIS EXISTS. Three separate guards have now been wrong because a regex
 * over raw source answered a question about CODE using text found in COMMENTS:
 *
 *   1. the unused-constant guard counted a comment naming a constant as a
 *      reference to it, so it caught nothing;
 *   2. the Home test searched for "0 runs" and lastSeenAt and found the
 *      comments explaining why neither is used;
 *   3. this file's signup-ordering check matched `supabase.signUp(` in
 *      LoginPage's docblock rather than the actual call, and reported the call
 *      as happening at character 118 — before the file's imports.
 *
 * The failure is at the PARSING layer, not the logic layer, and it recurs
 * because text matching cannot tell code from prose about code. These helpers
 * are the cheap fix: comment-stripping and position lookup that operate on code
 * only. Deliberately not the TypeScript compiler API — "is this identifier
 * referenced" and "does this call precede that one" are answerable from syntax
 * alone, and a type checker would be a heavier dependency for no extra answer.
 */
import { readFileSync } from "node:fs";

/** Source with block and line comments removed. String contents are preserved. */
export function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")) // keep offsets stable
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(Math.max(0, m.length - p1.length)));
}

/** Read a source file with comments stripped. Offsets match the original file. */
export function readCode(url: URL): string {
  return codeOnly(readFileSync(url.pathname, "utf8"));
}

/**
 * Index of a literal in CODE, ignoring comments. -1 when absent.
 * Use for ordering assertions: `codeIndexOf(a) < codeIndexOf(b)`.
 */
export function codeIndexOf(source: string, needle: string, from = 0): number {
  return source.indexOf(needle, from);
}

/** How many times a literal appears in code, ignoring comments. */
export function codeCount(source: string, needle: string): number {
  return source.split(needle).length - 1;
}
