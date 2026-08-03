import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "../src/server/api";

describe("API origin protection", () => {
  it("accepts the public HTTPS origin behind an internal proxy host", () => {
    expect(isAllowedOrigin("https://runlocal.ctonew.app", "localhost:3000")).toBe(true);
  });

  it("accepts same-host origins for local/custom deployments", () => {
    expect(isAllowedOrigin("http://localhost:3000", "localhost:3000")).toBe(true);
  });

  it("rejects foreign origins", () => {
    expect(isAllowedOrigin("https://evil.example", "localhost:3000")).toBe(false);
    expect(isAllowedOrigin("https://runlocal.ctonew.app.evil.example", "localhost:3000")).toBe(false);
  });

  it("allows origin-less non-browser requests", () => {
    expect(isAllowedOrigin(undefined, "localhost:3000")).toBe(true);
  });
});
