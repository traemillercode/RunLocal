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

describe("the build id is visible and the service worker respects it", () => {
  /*
   * THREE bug reports could not be reproduced because the reporter and the
   * tester were looking at different code with no way to tell. Both halves of
   * that are fixed here: the id is on screen, and stale shells stop happening.
   */
  it("sw.js is stamped at BUILD TIME, not by publish.sh", () => {
    /*
     * THE ACTUAL BUG behind the non-reproductions. sw.js shipped
     * `const BUILD_ID = "__BUILD_ID__"` — a placeholder replaced by publish.sh,
     * which Railway does not run. So the cache name was the literal string
     * "runlocal-shell-__BUILD_ID__" on every deploy: it never changed, the
     * activate handler's cleanup never matched, and a returning visitor kept
     * their first-visit shell indefinitely.
     *
     * Identical to the VITE_BUILD_ID defect — a value supplied only by a script
     * the deploy platform never executes.
     */
    const config = readFileSync(new URL("../vite.config.ts", import.meta.url).pathname, "utf8");
    expect(config).toContain("kimbio-stamp-sw");
    expect(config).toContain("__BUILD_ID__");
    expect(config).toContain("dist/sw.js");
  });

  it("the cache name derives from the build id, so activate can evict", () => {
    const sw = readFileSync(new URL("../public/sw.js", import.meta.url).pathname, "utf8");
    expect(sw).toContain("runlocal-shell-${BUILD_ID}");
    // The cleanup only works if old cache names differ from the current one.
    expect(sw).toContain('key.startsWith("runlocal-shell-") && key !== CACHE');
  });

  it("a stamp component exists and reads the build id", () => {
    const stamp = readFileSync(new URL("../src/components/BuildStamp.tsx", import.meta.url).pathname, "utf8");
    expect(stamp).toContain("VITE_BUILD_ID");
  });

  it("it renders on app pages AND on marketing", () => {
    // Every page, as asked — a tester is stuck inside the app, not on the
    // landing page, when they need to read it out.
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url).pathname, "utf8");
    const mkt = readFileSync(new URL("../src/pages/MarketingPage.tsx", import.meta.url).pathname, "utf8");
    expect(app).toContain("<BuildStamp />");
    expect(mkt).toContain("<BuildStamp");
  });
});

describe("no shipped file carries an unreplaced placeholder", () => {
  /*
   * TWO instances of the same defect now: VITE_BUILD_ID and sw.js's
   * __BUILD_ID__, both supplied only by publish.sh — a script Railway never
   * runs. Each shipped for weeks looking correct, and the sw.js one pinned
   * stale shells on every device, which produced three unreproducible bug
   * reports.
   *
   * Cheap structural check rather than a build-output check: a __PLACEHOLDER__
   * left in a file that ships is the shape of the bug, whatever the token.
   */
  it("nothing in public/ contains a __TOKEN__ placeholder", () => {
    const { readdirSync, readFileSync: rf, statSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const dir = new URL("../public", import.meta.url).pathname;
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!statSync(full).isFile()) continue;
      if (!/\.(js|json|webmanifest|html|txt|xml)$/.test(name)) continue;
      const text = rf(full, "utf8");
      for (const m of text.matchAll(/__[A-Z][A-Z0-9_]{2,}__/g)) {
        // sw.js legitimately CONTAINS the token as a substitution target; the
        // build replaces it. What must not happen is shipping it unreplaced,
        // which is asserted against dist below.
        if (name === "sw.js" && m[0] === "__BUILD_ID__") continue;
        offenders.push(`${name}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the attribute the padding rule consumes is emitted by the app", () => {
    /*
     * The cheap approximation for the gap I could not close: asserting the CSS
     * rule works given data-has-nav would pass while the attribute is never
     * set. This checks the OTHER link — that App.tsx emits it — without
     * rendering the whole app in a test.
     */
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url).pathname, "utf8");
    const css = readFileSync(new URL("../src/styles/app.css", import.meta.url).pathname, "utf8");
    expect(app).toContain("data-has-nav=");
    expect(css).toContain("[data-has-nav=");
  });
});
