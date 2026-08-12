/**
 * SSR tests for the role-aware ActionMenu (react-dom/server, no jsdom).
 *
 * The menu is gated on internal `useState`, so like the account-menu tests we
 * render the extracted presentational pieces: `ActionMenu` for the trigger
 * (aria wiring + the empty-list rule) and `ActionMenuPanel` directly for the
 * menu markup. Real keyboard/focus behavior needs a DOM and is a later phase.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionMenu, ActionMenuPanel } from "../src/components/ActionMenu";
import { actionMenuItems } from "../src/lib/actionModel";

const noop = () => {};

describe("ActionMenu trigger", () => {
  it("renders an accessible 44×44 trigger when capabilities exist", () => {
    const html = renderToStaticMarkup(
      <ActionMenu entityTitle="Tuesday Track Night" items={actionMenuItems(["edit_own", "delete_own"])} onSelect={noop} />,
    );
    expect(html).toContain('aria-label="Actions for Tuesday Track Night"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="grid h-11 w-11'); // 44×44 trigger
  });

  it("renders nothing at all when the capability list is empty", () => {
    const html = renderToStaticMarkup(<ActionMenu entityTitle="Tuesday Track Night" items={[]} onSelect={noop} />);
    expect(html).toBe("");
  });

  it("does not render the panel while closed", () => {
    const html = renderToStaticMarkup(
      <ActionMenu entityTitle="Tuesday Track Night" items={actionMenuItems(["hide"])} onSelect={noop} />,
    );
    expect(html).not.toContain('role="menu"');
  });
});

describe("ActionMenuPanel markup", () => {
  it("renders role=menu with one menuitem per capability, in server order", () => {
    const html = renderToStaticMarkup(
      <ActionMenuPanel items={actionMenuItems(["hide", "delete", "report"])} onSelect={noop} />,
    );
    expect(html).toContain('role="menu"');
    const menuitems = html.match(/role="menuitem"/g) ?? [];
    expect(menuitems).toHaveLength(3);
    // Server order is preserved: Hide before Delete before Report.
    expect(html.indexOf("Hide")).toBeGreaterThan(-1);
    expect(html.indexOf("Hide")).toBeLessThan(html.indexOf("Delete"));
    expect(html.indexOf("Delete")).toBeLessThan(html.indexOf("Report"));
  });

  it("sizes the panel 15rem / viewport-safe and below the Sheet z-index", () => {
    const html = renderToStaticMarkup(<ActionMenuPanel items={actionMenuItems(["hide"])} onSelect={noop} />);
    expect(html).toContain("w-[min(15rem,calc(100vw-1rem))]");
    expect(html).toContain("z-50");
  });

  it("uses 44px rows with an active (non-hover-only) affordance", () => {
    const html = renderToStaticMarkup(<ActionMenuPanel items={actionMenuItems(["hide"])} onSelect={noop} />);
    expect(html).toContain("min-h-11");
    expect(html).toContain("hover:bg-slate-100");
    expect(html).toContain("active:bg-slate-200");
  });

  it("renders destructive items red and safe items slate", () => {
    const destructive = renderToStaticMarkup(
      <ActionMenuPanel items={actionMenuItems(["delete", "suspend"])} onSelect={noop} />,
    );
    expect(destructive).toContain("text-red-600");
    const safe = renderToStaticMarkup(<ActionMenuPanel items={actionMenuItems(["hide", "restore"])} onSelect={noop} />);
    expect(safe).not.toContain("text-red-600");
    expect(safe).toContain("text-slate-800");
  });
});
