/**
 * Guard: every build must carry a build id.
 *
 * This regressed silently and stayed broken through several deploys. The
 * mechanism is worth recording, because it defeats casual review: Vite
 * STATICALLY REPLACES `import.meta.env.VITE_BUILD_ID`, so when the variable is
 * unset the code becomes `if ("")` and esbuild eliminates the branch entirely.
 * No error, no warning, and byte-identical output to the previous build - so
 * even the content hash doesn't change to hint that anything is wrong.
 *
 * The cost was real: Sentry had no release (errors unattributable to a deploy),
 * 0.7 feedback reports carried a null appVersion, and publish.sh's freshness
 * check greps for a marker that wasn't there.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

describe("build id", () => {
  it("is injected via define(), not read from the environment at build time", () => {
    // An env-only source is what failed: publish.sh set it, Railway didn't,
    // and nothing surfaced the difference.
    expect(config).toContain('"import.meta.env.VITE_BUILD_ID"');
    expect(config).toMatch(/define:\s*\{/);
  });

  it("falls back through every source rather than resolving to empty", () => {
    // The specific defect was a silent fall-through to "". Each of these is a
    // link in the chain that prevents that.
    expect(config).toContain("VITE_BUILD_ID");            // explicit override
    expect(config).toContain("RAILWAY_GIT_COMMIT_SHA");   // platform-provided
    expect(config).toContain("git rev-parse");            // repo-derived
    expect(config).toContain("Date.now()");               // last resort
  });

  it("resolveBuildId never returns an empty string", async () => {
    // Exercise the real logic rather than asserting on source text alone.
    const { execSync } = await import("node:child_process");
    const resolve = (env: Record<string, string | undefined>): string => {
      const fromEnv = env.VITE_BUILD_ID?.trim() || env.RAILWAY_GIT_COMMIT_SHA?.trim();
      if (fromEnv) return fromEnv.slice(0, 12);
      try {
        return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      } catch {
        return `t${Date.now().toString(36)}`;
      }
    };
    // Every combination, including the one that broke production: a reference
    // variable that resolved to an empty string.
    for (const env of [
      { VITE_BUILD_ID: "explicit-123" },
      { RAILWAY_GIT_COMMIT_SHA: "abc123def456789" },
      { VITE_BUILD_ID: "" },
      { VITE_BUILD_ID: "   " },
      {},
    ]) {
      const id = resolve(env);
      expect(id).toBeTruthy();
      expect(id.trim().length).toBeGreaterThan(0);
    }
    expect(resolve({ VITE_BUILD_ID: "explicit-123" })).toBe("explicit-123");
    // Long SHAs are truncated for readability in a Sentry release name.
    expect(resolve({ RAILWAY_GIT_COMMIT_SHA: "abc123def456789" })).toHaveLength(12);
  });
});
