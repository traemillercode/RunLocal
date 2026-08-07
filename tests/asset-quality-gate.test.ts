import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(path, "utf8");

describe("asset quality gate", () => {
  it("mounts app branding under /app and defines the logout icon", () => {
    for (const path of ["src/components/Header.tsx", "src/components/DesktopSidebar.tsx", "src/pages/EventsPage.tsx"]) {
      expect(source(path)).toContain('src="/app/icons/icon-192.png"');
      expect(source(path)).not.toContain('src="/icons/icon-192.png"');
    }
    expect(source("src/components/ui.tsx")).toContain("logout:");
  });

  it("avoids empty group photo sources and provides accessible branded fallbacks", () => {
    expect(source("src/pages/GroupsPage.tsx")).toContain("GroupLogo");
    expect(source("src/pages/GroupDetailPage.tsx")).toContain("GroupPhotoFallback");
    expect(source("src/pages/GroupDetailPage.tsx")).not.toContain('?? ""');
  });
});
