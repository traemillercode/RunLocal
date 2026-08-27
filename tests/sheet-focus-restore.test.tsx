/**
 * SSR tests locking the shared `Sheet` (src/components/ui.tsx) close-path
 * focus-return behavior (a11y B5a).
 *
 * The shared Sheet removes itself from the DOM on close without returning
 * focus, which strands `document.activeElement` on <body>. This is the defect
 * QA traced in qa-solo-activity/27-b5-findings.txt via the "Log a run" sheet
 * (LogRunSheet, built on this shared component).
 *
 * Because vitest runs in a node environment (no jsdom), the focus behavior
 * itself can't run here — we lock the source contract (the Sheet must capture
 * the focused trigger on open and call `.focus()` on it after unmount) and keep
 * a markup contract (open Sheet still renders the close button) so we catch
 * regressions that would silently re-break B5a.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sheet } from "../src/components/ui";

const noop = () => {};

const uiSource = () =>
  import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../src/components/ui.tsx", import.meta.url), "utf8"),
  );

describe("shared Sheet — focus return on close (B5a)", () => {
  it("captures the focused element when the sheet opens (the trigger, not body)", async () => {
    const source = await uiSource();
    // The trigger is the element that held focus the moment `open` flips true.
    expect(source).toContain("document.activeElement");
  });

  it("remembers the trigger in a ref scoped to the Sheet open/close lifecycle", async () => {
    const source = await uiSource();
    // Capture runs only on the open→true transition, keyed by `open` alone so a
    // changing `onClose` identity mid-session can't re-capture focus from inside
    // the sheet (which would break the return target).
    expect(source).toMatch(/returnFocusRef\s*=\s*useRef<HTMLElement \| null>\(null\)/);
    expect(source).toContain("instanceof HTMLElement");
    expect(source).toContain("}, [open]);");
  });

  it("restores focus to the remembered trigger, not <body>, after the sheet unmounts", async () => {
    const source = await uiSource();
    // The close path releases the trigger and re-focuses it on the next frame
    // (after the sheet's DOM has been removed), guaranteeing focus never strands
    // on <body> when the shared Sheet is dismissed.
    expect(source).toContain("const trigger = returnFocusRef.current");
    expect(source).toContain("trigger.focus");
    expect(source).toMatch(/typeof trigger\.focus === "function"/);
    expect(source).toContain("requestAnimationFrame");
    // The restore must target the captured trigger, never a fresh activeElement
    // (which would already be <body> after the sheet is removed).
    expect(source).toContain("requestAnimationFrame(() => trigger.focus())");
  });
});

describe("shared Sheet — open markup contract (no regression)", () => {
  it("still renders an accessible dialog with its close affordance when open", () => {
    const html = renderToStaticMarkup(
      <Sheet open title="Log a run" onClose={noop}>
        <p>Record a run you finished.</p>
      </Sheet>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Log a run"');
    expect(html).toContain('aria-label="Close sheet"');
    expect(html).toContain("Record a run you finished.");
  });

  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      <Sheet open={false} title="Any" onClose={noop}>
        <p>x</p>
      </Sheet>,
    );
    expect(html).toBe("");
  });
});
