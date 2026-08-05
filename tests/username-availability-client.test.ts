import { describe, expect, it } from "vitest";
import { normalizeUsernameAvailabilityResponse } from "../src/lib/api";

describe("username availability client response contract", () => {
  it("accepts the server response shape", () => {
    expect(normalizeUsernameAvailabilityResponse({ valid: true, available: true })).toEqual({
      ok: true,
      data: { valid: true, available: true },
    });
  });

  it("preserves an explicit taken response", () => {
    expect(normalizeUsernameAvailabilityResponse({ valid: true, available: false })).toEqual({
      ok: true,
      data: { valid: true, available: false },
    });
  });

  it("does not turn stale SPA HTML or malformed 2xx data into taken", () => {
    for (const body of ["<!doctype html><html></html>", {}, { available: false }, { valid: true, available: "false" }]) {
      const result = normalizeUsernameAvailabilityResponse(body);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_response");
    }
  });
});
