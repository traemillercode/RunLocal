import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Run Local visual system", () => {
  it("uses the icon source treatment in installable app metadata", () => {
    const root = resolve(process.cwd());
    const manifest = readFileSync(resolve(root, "public/manifest.webmanifest"), "utf8");
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    expect(manifest).toContain('"theme_color": "#14171C"');
    expect(manifest).toContain('"src": "/icons/icon-512.png"');
    expect(html).toContain('href="/favicon.svg"');
  });

  it("keeps coral brand accents and visible keyboard focus styling", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/app.css"), "utf8");
    const card = readFileSync(resolve(process.cwd(), "src/components/EventCard.tsx"), "utf8");
    expect(css).toContain("--rl-coral: #FF5741");
    expect(css).toContain(":focus-visible");
    expect(card).toContain("before:from-[#FF5741]");
  });

  it("standardizes shared interactive control geometry", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/app.css"), "utf8");
    const ui = readFileSync(resolve(process.cwd(), "src/components/ui.tsx"), "utf8");
    const login = readFileSync(resolve(process.cwd(), "src/pages/LoginPage.tsx"), "utf8");
    expect(css).toContain("--rl-control-radius: 10px");
    expect(css).toContain(".rl-control");
    expect(ui).toContain("rl-control inline-flex");
    expect(ui).not.toContain("rounded-full px-5");
    expect(login).toContain("<PillButton variant=\"primary\"");
    expect(login).toContain("rounded-[10px]");
  });
});
