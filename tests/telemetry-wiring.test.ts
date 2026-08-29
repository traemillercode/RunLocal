/**
 * Guard: every declared telemetry event must actually be reachable.
 *
 * `dead_end_reached` was defined, exported, documented, and called from ZERO
 * files. It would have produced no data for the entire 10-person beta week —
 * a week that cannot be re-run. Nothing failed, nothing warned; the reporter
 * simply sat dark.
 *
 * Same class as the icon guard: defined but never invoked, invisible in review
 * because the definition looks complete on its own. The only reliable check is
 * structural — assert the union and the call sites agree.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname;
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

const TELEMETRY = join(SRC, "lib/telemetry.ts");
const FRICTION = join(SRC, "lib/friction.ts");

/** The declared TelemetryEvent union, read from source so it can't drift. */
function declaredEvents(): string[] {
  const src = readFileSync(TELEMETRY, "utf8");
  const block = /export type TelemetryEvent =([\s\S]*?);/.exec(src);
  if (!block) throw new Error("TelemetryEvent union not found");
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("telemetry wiring", () => {
  const events = declaredEvents();

  it("declares the events this build actually supports", () => {
    expect(events.length).toBeGreaterThan(0);
    expect(events).toContain("dead_end_reached");
  });

  it("every declared event has a real call site outside telemetry.ts", () => {
    // friction.ts holds the reporters, so a name appearing ONLY there means the
    // reporter exists but nothing ever triggers it — exactly the
    // dead_end_reached failure. Each reporter must be invoked from a component.
    const files = walk(SRC).filter((f) => f !== TELEMETRY);
    const dark: string[] = [];

    for (const ev of events) {
      // Where the raw event name appears (the reporter definition).
      const named = files.filter((f) => readFileSync(f, "utf8").includes(`"${ev}"`));
      const outsideFriction = named.filter((f) => f !== FRICTION);
      if (outsideFriction.length > 0) continue;

      // Only defined in friction.ts — so the wrapper that emits it must itself
      // be called from somewhere real.
      const wrappers: Record<string, string[]> = {
        dead_end_reached: ["reportDeadEnd", "useDeadEnd"],
        error_shown: ["reportErrorShown"],
        rage_click: ["installRageClickDetector"],
        first_rsvp: ["trackFirstRsvpOnce"],
      };
      const fns = wrappers[ev];
      if (!fns) { dark.push(`${ev} (no known wrapper; add one to this map)`); continue; }

      const callers = files.filter((f) => {
        if (f === FRICTION) return false;
        const src = readFileSync(f, "utf8");
        return fns.some((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(src));
      });
      if (callers.length === 0) dark.push(`${ev} — reporter exists but is never called`);
    }

    expect(dark).toEqual([]);
  });
});
