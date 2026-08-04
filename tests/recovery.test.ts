/**
 * Supabase password-recovery link parsing (PR #11 recovery work).
 *
 * Supabase delivers recovery links as `https://runlocal.ctonew.app/#access_token=...&type=recovery`
 * (tokens in the URL hash, not the query string), so the app must parse them
 * from the hash before the HashRouter claims the route.
 */
import { describe, expect, it } from "vitest";
import { parseAuthCallback, parseRecoveryHash } from "../src/lib/recovery";

describe("parseAuthCallback", () => {
  it("routes signup confirmation callbacks without treating them as OTP verification", () => {
    expect(parseAuthCallback("https://runlocal.ctonew.app/#type=signup&code=confirm-code")).toEqual({ kind: "confirmation" });
  });

  it("routes recovery callbacks and keeps tokens at the callback boundary", () => {
    expect(parseAuthCallback("https://runlocal.ctonew.app/#type=recovery&access_token=at&refresh_token=rt")).toEqual({ kind: "recovery", accessToken: "at", refreshToken: "rt" });
  });

  it("returns an explicit error route for rejected confirmation links", () => {
    expect(parseAuthCallback("https://runlocal.ctonew.app/#type=signup&error=access_denied&error_description=expired")).toEqual({ kind: "error", flow: "confirmation", error: "expired" });
  });
});

describe("parseRecoveryHash", () => {
  it("parses a valid recovery hash into tokens", () => {
    const parsed = parseRecoveryHash("#access_token=at-123&refresh_token=rt-456&type=recovery");
    expect(parsed).toEqual({ accessToken: "at-123", refreshToken: "rt-456", type: "recovery" });
  });

  it("accepts a hash without the leading #", () => {
    const parsed = parseRecoveryHash("access_token=at-1&refresh_token=rt-2&type=recovery");
    expect(parsed).toEqual({ accessToken: "at-1", refreshToken: "rt-2", type: "recovery" });
  });

  it("surfaces a Supabase error_description as a human error", () => {
    const parsed = parseRecoveryHash("#error=access_denied&error_description=Link+has+expired");
    expect(parsed).not.toBeNull();
    if (parsed && !("accessToken" in parsed)) {
      expect(parsed.error).toMatch(/expired/i);
    } else {
      throw new Error("expected an error result");
    }
  });

  it("reports an incomplete hash (missing tokens) as an error", () => {
    const parsed = parseRecoveryHash("#type=recovery&access_token=at-only");
    expect(parsed).not.toBeNull();
    if (parsed && !("accessToken" in parsed)) {
      expect(parsed.error).toMatch(/incomplete|expired/i);
    } else {
      throw new Error("expected an error result");
    }
  });

  it("ignores non-recovery hashes (e.g. the app's own #/ route)", () => {
    expect(parseRecoveryHash("#/recovery")).toBeNull();
    expect(parseRecoveryHash("#/profile")).toBeNull();
    expect(parseRecoveryHash("")).toBeNull();
    expect(parseRecoveryHash("#access_token=x&refresh_token=y&type=magiclink")).toBeNull();
  });
});
