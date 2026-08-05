import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("desktop layout layer", () => {
  it("keeps desktop chrome behind the 1024px breakpoint", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/app.css"), "utf8");
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain(".desktop-sidebar");
    expect(css).toContain(".app-shell-header, .app-shell-nav { display: none; }");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) 320px");
    expect(css).toContain("--rl-control-radius: 10px");
  });

  it("composes existing forum and detail content without duplicating navigation", () => {
    const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    const sidebar = readFileSync(resolve(process.cwd(), "src/components/DesktopSidebar.tsx"), "utf8");
    const forum = readFileSync(resolve(process.cwd(), "src/pages/ForumPage.tsx"), "utf8");
    const detail = readFileSync(resolve(process.cwd(), "src/pages/EventDetailPage.tsx"), "utf8");
    expect(app).toContain("<DesktopSidebar");
    expect(sidebar).toContain('aria-label="Primary navigation"');
    expect(forum).toContain("desktop-forum-layout");
    expect(detail).toContain("desktop-detail-layout");
  });
});
