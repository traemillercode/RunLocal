/**
 * Guard: an exported constant that nothing references is a promise the code
 * does not keep.
 *
 * Three real defects this week had the same shape — a named constant that READS
 * as enforcement while enforcing nothing:
 *   - MAX_CMS_IMAGE_BYTES: declared, never compared against, so decodeCmsImage's
 *     own "≤4MB decoded" docblock was aspirational and any image under the 6MB
 *     body cap was written to disk.
 *   - dead_end_reached: a reporter defined and exported with zero call sites.
 *   - MAX_CODE_ATTEMPTS: see below.
 *
 * THE RULE IS DELIBERATELY NARROW. A constant referenced only by tests is
 * LEGITIMATE — that is a contract the tests pin (ACTION_KEYS, USERNAME_MIN,
 * USERNAME_MAX). Flagging those would make this the guard people learn to
 * ignore, the same correction the a11y guard needed. Unused means unreferenced
 * in src/ AND unreferenced in tests/.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Strips comments before searching. A constant named only in a comment — such
 * as the one explaining why it was previously unused — is not a reference, and
 * counting it as one hides exactly the defect being looked for.
 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const ROOT = new URL("..", import.meta.url).pathname;
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

const srcFiles = walk(join(ROOT, "src"));
// This file names constants in its docblock and in ACKNOWLEDGED, so counting
// it as a "test reference" would make it vouch for the very constants it
// exists to catch — it reported MAX_CMS_IMAGE_BYTES as used purely because it
// mentions it. Excluded.
const SELF = "unused-constants.test.ts";
const testFiles = walk(join(ROOT, "tests")).filter((f) => !f.endsWith(SELF));

/**
 * Known-dead constants awaiting a decision, with the reason. Anything here is
 * exempt so the guard stays green while the decision is pending — but it must
 * be named, so nothing rots silently.
 */
const ACKNOWLEDGED: Record<string, string> = {
  // Belongs to a self-hosted 6-digit code system that Supabase Auth replaced.
  // createCode() has zero callers, so no code is ever issued and the counter
  // guards nothing reachable. Real OTP goes through Supabase, which enforces
  // its own rate limiting (handled as "rate_limited" in lib/supabase.ts).
  // Removal is a cleanup, not a security fix.
  MAX_CODE_ATTEMPTS: "dead code-auth path superseded by Supabase; see lib/supabase.ts verifyOtp",
  // Dead UI: no component renders it.
  TIER_LABELS: "dead UI constant, removal held under the beta freeze",
};

describe("exported constants are referenced", () => {
  it("no exported UPPER_SNAKE constant is unreferenced in both src and tests", () => {
    const offenders: string[] = [];

    for (const f of srcFiles) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/^export const ([A-Z][A-Z0-9_]{2,})\s*[:=]/gm)) {
        const name = m[1];
        if (ACKNOWLEDGED[name]) continue;

        const usedInSrc = srcFiles.some((o) => {
          if (o === f) {
            // Same file: a reference other than the declaration itself.
            const body = codeOnly(readFileSync(o, "utf8")).replace(m[0], "");
            return new RegExp(`\\b${name}\\b`).test(body);
          }
          return new RegExp(`\\b${name}\\b`).test(codeOnly(readFileSync(o, "utf8")));
        });
        if (usedInSrc) continue;

        const usedInTests = testFiles.some((t) => new RegExp(`\\b${name}\\b`).test(codeOnly(readFileSync(t, "utf8"))));
        if (usedInTests) continue; // pinned contract — legitimate

        offenders.push(`${name} (${f.replace(ROOT, "")}) is referenced nowhere`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("every acknowledged constant still exists, so the exemption list cannot rot", () => {
    // If one is deleted, its entry here should go too — otherwise the list
    // slowly becomes a place where names accumulate and mean nothing.
    const all = srcFiles.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const name of Object.keys(ACKNOWLEDGED)) {
      expect(all).toContain(name);
    }
  });
});
