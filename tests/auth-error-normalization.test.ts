import { afterEach, describe, expect, it, vi } from "vitest";
import { loginStart } from "../src/lib/api";
import { sendOtp, signInWithPassword } from "../src/lib/supabase";

const ENV = {
  VITE_SUPABASE_URL: "https://abcd1234.supabase.co",
  VITE_SUPABASE_ANON_KEY: "anon-key",
};

afterEach(() => vi.restoreAllMocks());

describe("auth error normalization regressions", () => {
  it.each([
    ["an empty provider error object", {}],
    ["a provider error with an empty object message", { message: {} }],
  ])("never renders [object Object] for %s", async (_label, providerError) => {
    const auth = {
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: providerError }),
    };
    const result = await signInWithPassword("runner@example.com", "bad", { env: ENV, auth });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain("[object Object]");
  });

  it.each([
    ["empty API body", "", "request_failed", "Something went wrong. Please try again."],
    // These two expected the CODE as the message, which was the leak itself:
    // ApiError used to do `message ?? code`, so an unmapped code printed its own
    // name. Both now expect human copy. Note the other three rows in this table
    // already did — the table was internally inconsistent about whether a code
    // was acceptable output.
    // This path supplies its OWN sentence, which beats the generic fallback —
    // the map fills gaps rather than overriding a handler that said something
    // specific.
    ["malformed JSON", "{not-json", "invalid_response", "The server returned an invalid response. Please try again."],
    ["object-valued API message", JSON.stringify({ error: "server_failed", message: {} }), "server_failed", "Something went wrong. Please try again."],
    ["empty API object", "{}", "request_failed", "Something went wrong. Please try again."],
    ["empty object API message", JSON.stringify({ message: {} }), "request_failed", "Something went wrong. Please try again."],
  ])("normalizes %s without object stringification", async (_label, body, code, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 400 })));
    const result = await loginStart("runner@example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.message).toBe(message);
      expect(result.error.message).not.toContain("[object Object]");
    }
  });

  it("normalizes an empty OTP provider error object", async () => {
    const auth = { signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: {} }), verifyOtp: vi.fn() };
    const result = await sendOtp("runner@example.com", { env: ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "send_failed" });
  });
});
