/**
 * A shared invite link must render a real preview.
 *
 * There were no og: or twitter: tags at all, so iMessage, WhatsApp and Slack
 * fell back to scraping the page, hit an empty <div id="root"> (no prerendering
 * yet), and showed a bare grey box. That reads as a dead link — attached to the
 * one message where the sender is asking someone to trust them.
 *
 * The failure is invisible from the sending side: the sender sees their own
 * message, not the recipient's unfurl. So it needs a guard rather than a check.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";

const HTML = readFileSync(new URL("../index.html", import.meta.url).pathname, "utf8");
const IMG = new URL("../public/og-image.png", import.meta.url).pathname;

function meta(attr: "property" | "name", key: string): string | null {
  const re = new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, "i");
  return re.exec(HTML)?.[1] ?? null;
}

describe("Open Graph tags exist", () => {
  it("carries every tag a scraper needs", () => {
    for (const key of ["og:title", "og:description", "og:image", "og:url", "og:type", "og:site_name"]) {
      expect(meta("property", key), key).toBeTruthy();
    }
    for (const key of ["twitter:card", "twitter:title", "twitter:description", "twitter:image"]) {
      expect(meta("name", key), key).toBeTruthy();
    }
  });

  it("uses a large-image card, not a thumbnail", () => {
    expect(meta("name", "twitter:card")).toBe("summary_large_image");
  });

  it("gives an ABSOLUTE image url", () => {
    // Scrapers do not resolve relative paths — a "/og-image.png" would produce
    // exactly the blank card this fixes.
    const img = meta("property", "og:image")!;
    expect(img.startsWith("https://")).toBe(true);
  });

  it("declares the image dimensions, so the card reserves the right shape", () => {
    expect(meta("property", "og:image:width")).toBe("1200");
    expect(meta("property", "og:image:height")).toBe("630");
  });
});

describe("the image behind those tags is real", () => {
  it("exists as a file, rather than resolving to the SPA fallback", () => {
    /*
     * The reported symptom was "/og-image.png returns 200, so an image exists".
     * It did not: the catch-all was serving index.html with
     * content-type text/html. A 200 that is secretly HTML is worse than a 404,
     * because it looks present from every angle except a scraper's.
     */
    const st = statSync(IMG);
    expect(st.isFile()).toBe(true);
    expect(st.size).toBeGreaterThan(5000);
    expect(readFileSync(IMG).subarray(1, 4).toString()).toBe("PNG");
  });

  it("is 1200x630, the standard card ratio", () => {
    // A square image (icon-512) gets cropped badly by every platform.
    const buf = readFileSync(IMG);
    expect(buf.readUInt32BE(16)).toBe(1200);
    expect(buf.readUInt32BE(20)).toBe(630);
  });

  it("the declared dimensions match the actual file", () => {
    // These drift the moment someone swaps the artwork without touching the
    // tags, and the result is a card that reserves the wrong shape.
    const buf = readFileSync(IMG);
    expect(String(buf.readUInt32BE(16))).toBe(meta("property", "og:image:width"));
    expect(String(buf.readUInt32BE(20))).toBe(meta("property", "og:image:height"));
  });
});
