/**
 * Fixture integrity regression: tests/fixtures/valid-256.webp must remain a
 * genuine, decodable WebP.
 *
 * History: PR #89 shipped this fixture as a 44-byte VP8L stub. The stub's
 * header claimed 256x256, so imageDimensions() accepted it and every upload
 * test passed, but the file contained no real image data — it decoded to a
 * single solid color. This test pins the verified fixture bytes and asserts
 * the structural invariants so a regression to a header-only/solid-color stub
 * fails loudly instead of silently passing the upload path.
 *
 * The pinned bytes were generated as a 256x256 lossless VP8L image and
 * verified with a full WebP decoder (libwebp via Pillow): size 256x256, RGB
 * gradient with drawn shapes — real image content, not a degenerate file.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { imageDimensions } from "../src/server/image-validation";

const WEBP_BYTES = readFileSync(new URL("./fixtures/valid-256.webp", import.meta.url));

describe("tests/fixtures/valid-256.webp", () => {
  it("is a complete RIFF/VP8L WebP and imageDimensions reports its true 256x256 size", () => {
    expect(WEBP_BYTES.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(WEBP_BYTES.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(WEBP_BYTES.toString("ascii", 12, 16)).toBe("VP8L");
    // Container size fields must cover the whole file — a truncated or
    // header-only file leaves the RIFF size or the VP8L chunk size short.
    expect(WEBP_BYTES.readUInt32LE(4)).toBe(WEBP_BYTES.length - 8);
    expect(WEBP_BYTES.readUInt32LE(16)).toBe(WEBP_BYTES.length - 20);
    // The server's own dimension parser must report the true decoded size.
    expect(imageDimensions(WEBP_BYTES, "webp")).toEqual({ width: 256, height: 256 });
  });

  it("still matches the pinned bytes verified to decode as a real image", () => {
    // SHA-256 of the fixture at generation time. Any replacement — including a
    // smaller header-only stub that still satisfies imageDimensions — breaks
    // this pin, forcing a re-verification with a full decoder.
    const sha = createHash("sha256").update(WEBP_BYTES).digest("hex");
    expect(sha).toBe("47399f136680dd7593f42aac30d8af308a4cab267ff33deb13e59956169c75ca");
  });
});
