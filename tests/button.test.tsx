/**
 * Phase 2, Stage 2 — the one button.
 *
 * 311 `<button>` tags with no shared component. The inventory shaped the API
 * rather than confirming it, and the number that mattered most was 85%: of 196
 * distinct className strings across 235 buttons, 168 were used exactly once.
 * That is a long tail, not three treatments — so the escape hatch is
 * load-bearing and the component owns only what is genuinely shared.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { Button } from "../src/components/Button";

const SRC = readFileSync(new URL("../src/components/Button.tsx", import.meta.url).pathname, "utf8");

describe("type defaults to button", () => {
  it("renders type=button without being asked", () => {
    /*
     * Fixes 16 latent submits for free. The asymmetry is the reason: a
     * forgotten type="submit" fails LOUDLY and IMMEDIATELY — click it, nothing
     * happens, found in seconds. A forgotten type="button" fails SILENTLY and
     * MUCH LATER, when someone wraps it in a form months from now.
     */
    expect(renderToStaticMarkup(<Button>Go</Button>)).toContain('type="button"');
  });

  it("lets a caller override it", () => {
    // A form's submit must say so. That is the loud failure, deliberately.
    expect(renderToStaticMarkup(<Button type="submit">Save</Button>)).toContain('type="submit"');
  });

  it("spreads rest AFTER the default, so the override actually wins", () => {
    // Ordering is the whole mechanism here: `type="button"` before {...rest}
    // is overridable; after it is not.
    expect(SRC.indexOf('type="button"')).toBeLessThan(SRC.indexOf("{...rest}"));
  });
});

describe("loading owns the ellipsis, never the verb", () => {
  it("appends the ellipsis to the caller's word", () => {
    /*
     * "Saving…" and "Sending…" carry information; the ellipsis convention does
     * not. Seven distinct in-flight labels across the app is correct — one
     * implementation, seven labels.
     */
    const html = renderToStaticMarkup(<Button loading loadingLabel="Saving">Save</Button>);
    expect(html).toContain("Saving\u2026");
    expect(html).not.toContain(">Save<");
  });

  it("keeps children when no label is given", () => {
    const html = renderToStaticMarkup(<Button loading>Save</Button>);
    expect(html).toContain("Save");
  });

  it("disables while in flight", () => {
    // A second click on an in-flight action is a duplicate write — the shape
    // that produced repeated verification emails.
    const html = renderToStaticMarkup(<Button loading loadingLabel="Saving">Save</Button>);
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
  });
});

describe("icon-only requires a name, enforced by the type", () => {
  it("renders a square target", () => {
    const html = renderToStaticMarkup(
      <Button iconOnly aria-label="Close"><span>×</span></Button>,
    );
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("h-11 w-11");
  });

  it("the requirement is in the type, not a comment", () => {
    /*
     * Correct by construction rather than by remembering — the same property as
     * getMyRuns taking no account id. A lint rule can be disabled; a type
     * cannot be forgotten.
     */
    expect(SRC).toContain('iconOnly: true;');
    expect(SRC).toContain('"aria-label": string;');
  });
});

describe("the safety rule is encoded by absence", () => {
  it("has no confirm prop", () => {
    /*
     * A safety action never gets a confirmation dialog: someone blocking a
     * person who frightens them should not be asked whether they are sure.
     * Documenting that leaves it to be remembered; not having the prop means it
     * cannot be reached for.
     */
    expect(SRC).not.toContain("confirm");
  });
});

describe("every variant is reachable by keyboard", () => {
  it("has a focus ring", () => {
    // Ghost is the largest group at 147 and has no fill. Without a ring, a
    // keyboard user cannot see where they are on nearly half the controls.
    expect(SRC).toContain("focus-visible:ring-2");
    for (const v of ["primary", "secondary", "ghost", "destructive"] as const) {
      expect(renderToStaticMarkup(<Button variant={v}>x</Button>)).toContain("focus-visible:ring-2");
    }
  });

  it("destructive is an outline, not a fill", () => {
    /*
     * A destructive action should be findable without being the loudest thing
     * on the screen. Filling it red competes with the primary action for
     * attention, on a screen where the primary action is usually the safe one.
     */
    expect(renderToStaticMarkup(<Button variant="destructive">Remove</Button>)).toContain("ring-1");
  });
});

describe("no form contains a Button without an explicit type", () => {
  /*
   * The guard that makes the default safe. Once Buttons are inside forms, the
   * loud failure needs to stay loud — and this catches the one case where the
   * default is wrong before anyone clicks it.
   */
  it("holds across every page and component", () => {
    /*
     * VACUOUS TODAY, DELIBERATELY, and recorded rather than left to look like
     * protection: there are ZERO <Button> call sites until the Stage 3 sweep
     * begins, so this currently scans forms and finds nothing to check.
     *
     * It is written now because the sweep is the moment it matters — the first
     * Button placed inside a form is exactly when the default becomes wrong,
     * and a guard added after that lands too late to have caught it.
     */
    const offenders: string[] = [];
    for (const dir of ["../src/pages", "../src/components"]) {
      const path = new URL(dir, import.meta.url).pathname;
      for (const f of readdirSync(path).filter((x) => x.endsWith(".tsx"))) {
        const src = readFileSync(`${path}/${f}`, "utf8");
        let i = 0;
        while ((i = src.indexOf("<form", i)) !== -1) {
          const end = src.indexOf("</form>", i);
          const body = end === -1 ? src.slice(i) : src.slice(i, end);
          for (const m of body.matchAll(/<Button\b(?![^>]*type=)/g)) {
            offenders.push(`${f}:${m.index}`);
          }
          i = end === -1 ? src.length : end;
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
