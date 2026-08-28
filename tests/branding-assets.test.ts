import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderIcon, writeIcons } from "../scripts/gen-icons.mjs";

function pngSize(path: string) {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const ICONS: Array<[number, string]> = [
  [512, "icon-512.png"],
  [192, "icon-192.png"],
  [180, "icon-180.png"], // apple-touch-icon
];

describe("Run Local branding assets", () => {
  it("uses the orange logo for all installed icon sizes", () => {
    expect(pngSize("public/icons/icon-180.png")).toEqual({ width: 180, height: 180 });
    expect(pngSize("public/icons/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngSize("public/icons/icon-512.png")).toEqual({ width: 512, height: 512 });
    // The 180px and 192px assets are resized derivatives of the existing
    // orange 512px logo; dimensions and the shared favicon reference guard
    // against accidentally restoring the green legacy icon.
  });

  it("keeps favicon and manifest references on the same brand family", () => {
    const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192" }),
        expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512" }),
        expect.objectContaining({ src: "/favicon.svg" }),
      ]),
    );
    expect(readFileSync("public/favicon.svg", "utf8")).toContain("#FF5741");
    // The canonical brand mark is the dark swoosh on the flat orange tile; the
    // generator must stay aligned with favicon.svg so the app header, desktop
    // sidebar, empty states, and installed-app icon all show the same logo.
    const favicon = readFileSync("public/favicon.svg", "utf8");
    expect(favicon).toContain("#14171C");
    for (const src of ["scripts/gen-icons.mjs", "src/components/Header.tsx", "src/components/DesktopSidebar.tsx"]) {
      expect(readFileSync(src, "utf8")).toContain("icon-192.png");
    }
  });

  it("commits icons byte-identical to the canonical generator output", () => {
    // Guards against hand-edited or stale PNG assets drifting from the
    // generator (the last drift shipped a white corner glyph that read as a
    // blank tile in the app header and as a wrong installed-app icon).
    const dir = mkdtempSync(join(tmpdir(), "runlocal-icons-"));
    writeIcons(dir);
    for (const [, name] of ICONS) {
      expect(readFileSync(`public/icons/${name}`), name).toEqual(readFileSync(join(dir, name)));
    }
  });

  it("renders the canonical mark: flat orange tile, dark swoosh, no legacy green", () => {
    for (const [size, name] of ICONS) {
      const rgba = renderIcon(size);
      let opaque = 0;
      let orange = 0; // #ff5741 tile interior
      let dark = 0; // #14171c swoosh strokes
      let green = 0; // legacy green brand (g dominant over r and b)
      for (let i = 0; i < rgba.length; i += 4) {
        const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
        if (a < 128) continue;
        opaque++;
        if (r > 235 && g > 60 && g < 115 && b > 40 && b < 95) orange++;
        else if (r < 60 && g < 70 && b < 85) dark++;
        if (g > 30 && g > r && g > b) green++;
      }
      expect(orange / opaque, `${name}: orange tile`).toBeGreaterThan(0.6);
      expect(dark, `${name}: dark swoosh strokes`).toBeGreaterThan(Math.floor((size * size) / 250));
      expect(green / opaque, `${name}: no legacy green`).toBeLessThan(0.01);
    }
  });
});
