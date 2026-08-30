/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Every deployed bundle must carry a build id. It's the Sentry release, the
 * appVersion on a 0.7 feedback report, and the marker publish.sh greps for to
 * prove a fresh bundle actually shipped.
 *
 * Previously this came only from an env var that publish.sh set — and Railway
 * never runs publish.sh, so production had no build id at all. The failure was
 * completely silent: Vite statically replaces `import.meta.env.VITE_BUILD_ID`,
 * so an unset value became `if ("")` and the whole branch was dead-code
 * eliminated. No error, no warning, byte-identical output to the previous
 * build — which is exactly why the missing id survived unnoticed until a
 * Sentry issue read "build unknown".
 *
 * Resolved here at config time, from the first source that actually exists,
 * so it cannot silently fall through to empty on any platform:
 *   1. VITE_BUILD_ID        — explicit override (publish.sh, CI)
 *   2. RAILWAY_GIT_COMMIT_SHA — present on some Railway plans, absent on others
 *   3. git rev-parse        — works anywhere the repo is present, incl. Railway
 *   4. timestamp            — last resort; still unique per build
 */
function resolveBuildId(): string {
  const fromEnv = process.env.VITE_BUILD_ID?.trim() || process.env.RAILWAY_GIT_COMMIT_SHA?.trim();
  if (fromEnv) return fromEnv.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return `t${Date.now().toString(36)}`;
  }
}
const BUILD_ID = resolveBuildId();

export default defineConfig({
  define: {
    // Injected rather than read from the environment, so the value is
    // guaranteed present in the bundle regardless of how the build was invoked.
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    tailwindcss(),
    /*
     * Stamp the service worker with the real build id.
     *
     * sw.js shipped `const BUILD_ID = "__BUILD_ID__"` — a placeholder replaced
     * by publish.sh, which Railway never runs. So the cache name was the
     * literal string "runlocal-shell-__BUILD_ID__" on EVERY deploy: it never
     * changed, the activate handler's cleanup never matched anything, and a
     * returning visitor kept the shell from their first visit indefinitely.
     *
     * That is why three reported bugs could not be reproduced. The reporter
     * always had fresh HTML; a real user had a shell from twelve builds ago.
     *
     * Identical defect to VITE_BUILD_ID: a value supplied only by a script the
     * deploy platform does not execute. Fixed the same way — at build time,
     * where it cannot be skipped.
     */
    {
      name: "kimbio-stamp-sw",
      closeBundle() {
        const swPath = resolve(__dirname, "dist/sw.js");
        if (!existsSync(swPath)) return;
        const src = readFileSync(swPath, "utf8");
        writeFileSync(swPath, src.replace(/__BUILD_ID__/g, BUILD_ID));
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // In dev the API runs on 3000 (bun run server) — proxy so the SPA and
    // API share an origin (HttpOnly cookies work the same in dev and prod).
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/uploads": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 3000,
  },
  base: "/",
  build: {
    outDir: "dist",
    target: "es2022",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
