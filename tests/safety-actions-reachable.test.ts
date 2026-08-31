/**
 * The block system was server-complete and unreachable.
 *
 * Silence, symmetry, capability enforcement, the union with deleted and
 * suspended — every property verified, correct, and impossible for a user to
 * invoke. The api.ts wrapper even existed with the right endpoint and the right
 * comment, so a grep for "is blocking wired?" returned a hit and said yes.
 *
 * That is the strongest version of the pattern in this codebase, and the reason
 * "the guard passed" never meant "the feature works": a client path that stops
 * one layer short of a user is MORE misleading than none, because it survives
 * the obvious check.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { readCode } from "./helpers/source";

const COMPONENT = readCode(new URL("../src/components/SafetyActions.tsx", import.meta.url));

/** Every page and component, so "wired" means reachable and not merely imported. */
function uiSources(): { name: string; src: string }[] {
  const out: { name: string; src: string }[] = [];
  for (const dir of ["../src/pages", "../src/components"]) {
    const path = new URL(dir, import.meta.url).pathname;
    for (const f of readdirSync(path).filter((x) => x.endsWith(".tsx"))) {
      out.push({ name: f, src: readFileSync(`${path}/${f}`, "utf8") });
    }
  }
  return out;
}

describe("blocking is reachable by a user", () => {
  it("something in the UI renders the control", () => {
    // The assertion that would have failed for the entire life of the feature.
    const renders = uiSources().filter((f) => f.src.includes("<SafetyActions"));
    expect(renders.map((f) => f.name).length, "no UI renders SafetyActions").toBeGreaterThan(0);
  });

  it("the control actually calls blockConnection", () => {
    /*
     * Rendering a component that imports the wrapper is not the same as calling
     * it — that distinction is exactly what made the old grep lie.
     */
    expect(COMPONENT).toContain("await api.blockConnection(accountId)");
  });

  it("it is hidden on your own profile", () => {
    // A block button pointed at yourself is a control that cannot do anything.
    const profile = readCode(new URL("../src/pages/RunnerProfilePage.tsx", import.meta.url));
    expect(profile).toContain("me.account.id !== profile.id");
  });
});

describe("block and report are one action", () => {
  it("reporting blocks first and does not wait for the report", () => {
    /*
     * She is protected the moment the block lands. A failed report is something
     * to retry, not a reason to leave her unprotected — so the report is fired
     * after the block succeeds and its result does not gate anything.
     */
    const at = COMPONENT.indexOf("const r = await api.blockConnection(accountId);");
    const after = COMPONENT.slice(at);
    expect(after).toContain("void api.reportRunner(accountId, reason.trim(), conversationId)");
    // Not awaited: the block outcome is what the UI advances on.
    expect(after).not.toContain("await api.reportRunner");
  });

  it("offers block-only as well", () => {
    // Not everything that needs a block needs a report.
    expect(COMPONENT).toContain("Block only");
  });

  it("has no are-you-sure step", () => {
    /*
     * Friction on a safety action is pointed at exactly the wrong person. The
     * caveats panel is not a confirmation — it renders AFTER the block has
     * taken effect.
     */
    expect(COMPONENT).not.toContain("Are you sure");
    const done = COMPONENT.indexOf('mode === "done"');
    const caveatPanel = COMPONENT.indexOf("What this doesn");
    expect(done).toBeLessThan(caveatPanel);
  });
});

describe("the caveats panel renders what the server returns", () => {
  it("shows both kinds, and nothing when there are none", () => {
    expect(COMPONENT).toContain("caveats.length > 0");
    expect(COMPONENT).toContain('c.kind === "leads_group"');
  });

  it("does not yet tell her to ask a lead", () => {
    /*
     * DELIBERATE. "Ask a lead to act" is one of the three options the panel is
     * meant to give her, and a lead currently cannot see their own roster, let
     * alone remove anyone. Shipping that copy would tell her to ask someone who
     * has no way to help.
     *
     * Remove this test when the lead-visible roster lands, and add the line.
     */
    expect(COMPONENT).not.toContain("ask a lead");
    expect(COMPONENT).not.toContain("contact the group");
  });
});
