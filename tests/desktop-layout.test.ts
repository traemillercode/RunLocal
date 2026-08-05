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
  it("removes broad w-full compaction while retaining explicit opt-in sizing", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/app.css"), "utf8");
    const desktop = css.slice(css.indexOf("@media (min-width: 1024px)"));
    expect(desktop).not.toContain(".desktop-main button.w-full, .desktop-main a.w-full");
    expect(desktop).toContain(".desktop-compact-control { width: fit-content; max-width: 100%; }");
    expect(desktop).toContain(".desktop-main .desktop-compact-control.w-full { width: 100%; }");
    expect(readFileSync(resolve(process.cwd(), "src/components/ui.tsx"), "utf8"))
      .toContain("desktop-compact-control");
  });
  it("keeps sidebar rows full width while city controls stay content-sized", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/app.css"), "utf8");
    expect(css).toContain(".desktop-city { display: flex; width: fit-content; max-width: 100%;");
    expect(css).toContain(".desktop-nav a, .desktop-account a { display: flex; width: fit-content; max-width: 100%;");
    expect(css).toContain(".desktop-nav a, .desktop-account a { width: 100%; }");
  });

  it("preserves full-width composition for key desktop actions", () => {
    for (const file of ["EventDetailPage.tsx", "EventsPage.tsx", "SettingsPage.tsx", "LoginPage.tsx"]) {
      expect(readFileSync(resolve(process.cwd(), "src/pages", file), "utf8")).toContain("w-full");
    }
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
