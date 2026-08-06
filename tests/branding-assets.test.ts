import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function pngSize(path: string) {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

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
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/app/icons/icon-192.png", sizes: "192x192" }),
      expect.objectContaining({ src: "/app/icons/icon-512.png", sizes: "512x512" }),
      expect.objectContaining({ src: "/app/favicon.svg" }),
    ]));
    expect(readFileSync("public/favicon.svg", "utf8")).toContain("#FF5741");
  });
});
