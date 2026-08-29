/**
 * Guard: the attendee-privacy control lives in exactly ONE place.
 *
 * WHY THIS IS NOT STYLE. `showAttendees` is a D2 privacy gate — with it false,
 * a signed-out visitor sees a going count; with it absent, they see real
 * members' initials. It was duplicated across DepartureBoard.tsx and
 * RunCard.tsx, and the failure mode is silent: fix one copy, the tests pass
 * because the other still holds, and the leak ships.
 *
 * That is not hypothetical. While fixing this exact leak, the first fix landed
 * in RunCard.tsx — a file with ZERO importers, extracted and never adopted —
 * so it changed nothing while looking correct. The duplication produced the
 * bug AND hid the fix.
 *
 * Same shape as the six fieldCls copies, with a worse blast radius: a fieldCls
 * divergence makes an input look wrong, this one shows strangers real names.
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
const files = walk(SRC);
const rel = (f: string) => f.replace(SRC, "src");

describe("attendee privacy guard is not duplicated", () => {
  it("exactly one file declares the showAttendees gate", () => {
    // Counts DECLARATIONS (the prop in an interface or a destructured default),
    // not every mention — a page passing showAttendees={signedIn} is a
    // consumer and should not be flagged.
    const declaring = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /showAttendees\?:\s*boolean/.test(src) || /showAttendees\s*=\s*true/.test(src);
    });
    expect(declaring.map(rel)).toHaveLength(1);
  });

  it("exactly one component renders an attendee avatar stack", () => {
    const stacks = files.filter((f) => /function AvatarStack\b/.test(readFileSync(f, "utf8")));
    expect(stacks.map(rel)).toHaveLength(1);
  });

  it("exactly one file defines the BOARD's RunEvent shape", () => {
    // Two competing board RunEvents is how a test ended up importing the type
    // from a file the app does not render.
    //
    // Scoped to components/: src/types.ts also exports a RunEvent, but that is
    // the SEED event shape (dayOfWeek + time, no resolved date) — a genuinely
    // different type that happens to share a name. Flagging it would make this
    // guard wrong rather than strict.
    const defs = files
      .filter((f) => f.includes("/components/"))
      .filter((f) => /export interface RunEvent\b/.test(readFileSync(f, "utf8")));
    expect(defs.map(rel)).toEqual(["src/components/DepartureBoard.tsx"]);
  });
});

describe("component names are not shared across files", () => {
  it("only one file declares a component named EventCard", () => {
    // Three files once did. A fix for one is invisible in the others, and the
    // import that looks right can be the wrong one.
    const declaring = files.filter((f) => /(?:export )?function EventCard\b/.test(readFileSync(f, "utf8")));
    expect(declaring.map(rel)).toEqual(["src/components/EventCard.tsx"]);
  });

  it("no file is dead: every component file has an importer", () => {
    // RunCard.tsx had zero importers for several commits while carrying a
    // privacy guard someone might have trusted.
    const componentFiles = files.filter((f) => f.includes("/components/") && f.endsWith(".tsx"));
    const orphans: string[] = [];
    for (const f of componentFiles) {
      const base = f.split("/").pop()!.replace(/\.tsx$/, "");
      const imported = files.some((o) => o !== f && new RegExp(`from ["'].*/${base}["']`).test(readFileSync(o, "utf8")));
      if (!imported) orphans.push(rel(f));
    }
    // CodeEntry.tsx is UI for the self-hosted 6-digit code flow that Supabase
    // Auth replaced — the same dead path as MAX_CODE_ATTEMPTS, whose
    // createCode() has zero callers. Named here rather than silently allowed,
    // so it is a pending decision instead of an accident. Removing it is
    // cleanup and belongs with that constant, not with this consolidation.
    const KNOWN_DEAD = ["src/components/CodeEntry.tsx"];
    expect(orphans.filter((o) => !KNOWN_DEAD.includes(o))).toEqual([]);
    // And the exemption cannot rot: if it gets adopted or deleted, update this.
    for (const d of KNOWN_DEAD) expect(componentFiles.map(rel)).toContain(d);
  });
});
