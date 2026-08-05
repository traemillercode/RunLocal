import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("desktop layout stays additive", () => {
  it("gates desktop shell rules at 1024px and preserves mobile nav", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain(".desktop-sidebar");
    expect(css).toContain("header, nav.fixed { display: none; }");
    expect(css).toContain("@media (min-width: 1024px) and (hover: hover) and (pointer: fine)");
  });

  it("renders desktop navigation and home rail without changing routes", () => {
    expect(readFileSync("src/components/DesktopSidebar.tsx", "utf8")).toContain('to="/"');
    expect(readFileSync("src/components/HomeRightRail.tsx", "utf8")).toContain('aria-label="Local highlights"');
    expect(readFileSync("src/pages/EventsPage.tsx", "utf8")).toContain("desktop-two-column");
  });
});
