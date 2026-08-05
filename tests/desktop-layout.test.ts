import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("desktop layout layer", () => {
  it("hides the sidebar by default and restores its desktop flex layout at 1024px", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/app.css"), "utf8");
    const breakpoint = css.indexOf("@media (min-width: 1024px)");
    expect(breakpoint).toBeGreaterThan(0);
    expect(css.slice(0, breakpoint)).toContain(".desktop-sidebar { display: none; }");
    expect(css.slice(breakpoint)).toContain(
      ".desktop-sidebar { position: fixed; inset: 0 auto 0 0; z-index: 50; display: flex; width: 240px;",
    );
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
    const login = readFileSync(resolve(process.cwd(), "src/pages/LoginPage.tsx"), "utf8");
    expect(app).toContain("<Header");
    expect(app).toContain("<DesktopSidebar");
    expect(app).toContain("<BottomNav");
    expect(sidebar).toContain('aria-label="Primary navigation"');
    expect(login).not.toContain("desktop-sidebar");
    expect(login).not.toContain("app-shell-header");
    expect(login).not.toContain("app-shell-nav");
    expect(forum).toContain("desktop-forum-layout");
    expect(detail).toContain("desktop-detail-layout");
  });
});
