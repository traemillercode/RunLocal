import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/MyRunsPage.tsx"), "utf8");

describe("My Runs middle sizing", () => {
  it("uses a capped, mobile-padded page wrapper without full-width content", () => {
    expect(source).toContain('className="my-runs-page mx-auto w-full max-w-[42rem] px-4 pb-32 pt-8 md:px-6"');
    expect(source).not.toContain("max-w-md");
  });

  it("stacks the mobile header and gives segmented controls touch-safe geometry", () => {
    expect(source).toContain("flex flex-col items-start justify-between gap-4 sm:flex-row");
    expect(source).toContain("flex shrink-0 rounded-xl bg-slate-100 p-1");
    expect((source.match(/min-h-11 rounded-lg px-3 py-2 text-xs font-bold/g) ?? []).length).toBe(2);
  });

  it("keeps actions padded and touch-safe, including empty-state browse", () => {
    expect(source).toContain("min-h-11 shrink-0 rounded-full bg-slate-100 px-4 py-2");
    expect(source).toContain("min-h-11 items-center rounded-full bg-[#14171C] px-4 py-2");
    expect(source).toContain("min-h-11 items-center rounded-lg px-4 py-2 text-sm font-bold");
  });

  it("does not introduce global or broad width overrides", () => {
    expect(source).not.toContain("PillButton");
    expect(source).not.toContain("w-screen");
    expect(source).not.toContain("max-w-full");
  });
});
