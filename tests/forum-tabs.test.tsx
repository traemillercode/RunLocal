/**
 * Regression test for the Forum section-tab pill bug.
 *
 * Reported: the Announcements pill overflowed its fixed grid column at mobile
 * widths (its 13px label is ~118px wide — wider than a third of a 390px screen
 * ≈ 106px) while Community and Q&A looked fine, and no tab had horizontal
 * padding. Fix: tabs size to their content (flex, not a rigid 3-equal-column
 * grid) so every pill gets the same comfortable horizontal padding and no
 * label truncates or wraps.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ForumSectionTabs } from "../src/pages/ForumPage";

describe("Forum section tabs (UI)", () => {
  it("gives every section pill comfortable horizontal padding", () => {
    const html = renderToStaticMarkup(<ForumSectionTabs section="announcements" onSelect={() => {}} />);
    // All three tabs carry the same padding utility (px-3) — the Announcements
    // pill is no longer crammed edge-to-edge in a fixed column.
    expect(html.match(/px-3/g)?.length ?? 0).toBe(3);
    expect(html).toContain("Announcements");
    expect(html).toContain("Community");
    expect(html).toContain("Q&amp;A"); // & is entity-escaped in SSR output
  });

  it("marks the active section tab as selected", () => {
    const html = renderToStaticMarkup(<ForumSectionTabs section="qa" onSelect={() => {}} />);
    expect(html).toContain('aria-selected="true"');
    // Exactly one selected tab.
    expect(html.match(/aria-selected="true"/g)?.length ?? 0).toBe(1);
    expect(html.match(/aria-selected="false"/g)?.length ?? 0).toBe(2);
  });

  it("keeps labels on a single line (no wrap, no truncation) so Announcements never wraps mid-word", () => {
    const html = renderToStaticMarkup(<ForumSectionTabs section="announcements" onSelect={() => {}} />);
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("Announcements");
  });
});
