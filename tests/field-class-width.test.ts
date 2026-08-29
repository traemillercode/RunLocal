/**
 * Regression guard for the fieldCls width collision (roadmap 0.3).
 *
 * The bug: every `fieldCls` constant ended in `w-full`. In a flex row that
 * meant a fixed-width sibling (`w-28` select) inherited `w-full`, won the
 * cascade, and squeezed the `flex-1 min-w-0` input next to it down to 26px
 * with ZERO content width - so a correctly-stored value had nowhere to render.
 *
 * This is invisible in code review and in unit tests, which is exactly why it
 * survived: nothing throws, nothing fails, the value round-trips fine. Only a
 * rendered measurement catches it. So the guard is structural instead - a
 * shared class-string constant must carry appearance, never layout.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src", import.meta.url).pathname;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith(".tsx") || p.endsWith(".ts") ? [p] : [];
  });
}

/** Width utilities that must never appear inside a shared field class constant. */
const WIDTH_UTIL = /\b(w-full|w-\d+|w-auto|w-\[[^\]]+\])\b/;

describe("shared field class constants carry appearance, not layout", () => {
  const files = walk(SRC);

  it("no fieldCls definition contains a width utility", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const line of text.split("\n")) {
        const m = /const\s+fieldCls\s*=\s*"([^"]*)"/.exec(line);
        if (m && WIDTH_UTIL.test(m[1])) {
          offenders.push(`${f.replace(SRC, "src")}: ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every fieldCls consumer declares its own width", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      text.split("\n").forEach((line, i) => {
        if (!line.includes("fieldCls") || line.includes("const fieldCls")) return;
        // Bare `className={fieldCls}` no longer inherits a width, so it must
        // not be used - the call site has to say what width it wants.
        if (/className=\{fieldCls\}/.test(line)) {
          offenders.push(`${f.replace(SRC, "src")}:${i + 1} bare className={fieldCls}`);
          return;
        }
        const m = /className=\{`([^`]*)`\}/.exec(line);
        if (!m) return;
        const classes = m[1].replace(/\$\{fieldCls\}/g, " ");
        if (!WIDTH_UTIL.test(classes) && !/\bflex-1\b/.test(classes)) {
          offenders.push(`${f.replace(SRC, "src")}:${i + 1} no width: ${m[1].trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
