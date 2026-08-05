import { describe, expect, it } from "vitest";
import { resolveStaticPath, staticHeaders } from "../src/server/static";

describe("extensionless OAuth callback handling", () => {
  it("serves a missing /callback route from index.html as HTML, never a download", () => {
    const served = resolveStaticPath("/dist/callback", "/dist/index.html", false);
    expect(served).toBe("/dist/index.html");
    expect(staticHeaders(served)).toMatchObject({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
    });
    expect(staticHeaders(served)["content-type"]).not.toBe("application/octet-stream");
  });

  it("preserves the actual asset path when it exists", () => {
    expect(resolveStaticPath("/dist/app.js", "/dist/index.html", true)).toBe("/dist/app.js");
    expect(staticHeaders("/dist/app.js")["content-type"]).toBe("text/javascript; charset=utf-8");
  });
});
