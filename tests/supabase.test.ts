/**
 * Supabase Auth email OTP — server bridge + browser adapter contracts.
 *
 * No real provider calls anywhere: the server token-introspection is tested
 * with an injected fetch stub, and the browser adapter is tested with a mocked
 * @supabase/supabase-js module. Every "unconfigured" path must fail closed and
 * nothing may ever fake a send or a verification.
 */
import { describe, expect, it, vi } from "vitest";
import {
  applySupabaseIdentity,
  supabaseConfig,
  verifySupabaseToken,
} from "../src/server/supabase";
import { createMemoryStore } from "../src/server/store";

const ENV = {
  VITE_SUPABASE_URL: "https://abcd1234.supabase.co",
  VITE_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-anon",
};

// ------------------------------------------------------------ server config
describe("server supabaseConfig", () => {
  it("reports every missing deployment variable without exposing values", () => {
    expect(supabaseConfig({})).toMatchObject({
      configured: false,
      missing: ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"],
    });
  });

  it("reports configured with both browser-safe vars", () => {
    const cfg = supabaseConfig(ENV);
    expect(cfg.configured).toBe(true);
    expect(cfg.missing).toEqual([]);
    expect(cfg.url).toBe(ENV.VITE_SUPABASE_URL);
    expect(cfg.anonKey).toBe(ENV.VITE_SUPABASE_ANON_KEY);
  });

  it("treats a non-https project URL as unconfigured", () => {
    const cfg = supabaseConfig({ VITE_SUPABASE_URL: "http://insecure.example", VITE_SUPABASE_ANON_KEY: "k" });
    expect(cfg.configured).toBe(false);
    expect(cfg.urlInvalid).toBe(true);
  });

  it("treats a garbage project URL as unconfigured", () => {
    const cfg = supabaseConfig({ VITE_SUPABASE_URL: "not a url", VITE_SUPABASE_ANON_KEY: "k" });
    expect(cfg.configured).toBe(false);
    expect(cfg.urlInvalid).toBe(true);
  });
});

// ---------------------------------------------------- server token validation
describe("verifySupabaseToken (server introspection)", () => {
  it("fails closed as unconfigured and never calls the provider", async () => {
    const fetchFn = vi.fn();
    const result = await verifySupabaseToken("some.token.here", { env: {}, fetchFn });
    expect(result).toMatchObject({ ok: false, reason: "unconfigured" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("uses the documented userinfo endpoint with the public anon key", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "user-1", email: "Runner@Example.com" }), { status: 200 }),
    );
    const result = await verifySupabaseToken("access.token.123", { env: ENV, fetchFn });
    expect(result).toEqual({ ok: true, sub: "user-1", email: "runner@example.com" });
    expect(fetchFn).toHaveBeenCalledWith("https://abcd1234.supabase.co/auth/v1/user", {
      method: "GET",
      headers: {
        apikey: ENV.VITE_SUPABASE_ANON_KEY,
        Authorization: "Bearer access.token.123",
      },
    });
  });

  it("rejects a 401 (token rejected/expired by Supabase) — never fakes success", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("invalid", { status: 401 }));
    const result = await verifySupabaseToken("expired.token", { env: ENV, fetchFn });
    expect(result).toMatchObject({ ok: false, reason: "rejected" });
  });

  it("surfaces a network failure as an explicit error", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new Error("dns down"));
    const result = await verifySupabaseToken("t", { env: ENV, fetchFn });
    expect(result).toMatchObject({ ok: false, reason: "network" });
  });

  it("treats a provider response without an identity as rejected", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const result = await verifySupabaseToken("t", { env: ENV, fetchFn });
    expect(result).toMatchObject({ ok: false, reason: "rejected" });
  });

  it("treats a non-200 as a network/provider failure", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("boom", { status: 500 }));
    const result = await verifySupabaseToken("t", { env: ENV, fetchFn });
    expect(result).toMatchObject({ ok: false, reason: "network" });
  });
});

// ------------------------------------------------- secure identity bridge
describe("applySupabaseIdentity (secure bridge rules)", () => {
  it("links a matching Supabase identity to the account", () => {
    const result = applySupabaseIdentity(
      { email: "runner@example.com", supabaseAuthId: null },
      { sub: "user-1", email: "runner@example.com" },
    );
    expect(result).toEqual({ ok: true, patch: { supabaseAuthId: "user-1" } });
  });

  it("rejects a token whose email differs from the account email", () => {
    const result = applySupabaseIdentity(
      { email: "runner@example.com", supabaseAuthId: null },
      { sub: "user-2", email: "other@example.com" },
    );
    expect(result).toMatchObject({ ok: false, code: "email_mismatch" });
  });

  it("rejects re-homing an already-linked account to another Supabase user", () => {
    const result = applySupabaseIdentity(
      { email: "runner@example.com", supabaseAuthId: "user-1" },
      { sub: "user-2", email: "runner@example.com" },
    );
    expect(result).toMatchObject({ ok: false, code: "identity_mismatch" });
  });

  it("accepts the same Supabase user on an already-linked account (steady state)", () => {
    const result = applySupabaseIdentity(
      { email: "runner@example.com", supabaseAuthId: "user-1" },
      { sub: "user-1", email: "runner@example.com" },
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("email verification alone never grants the Verified badge", () => {
    const db = createMemoryStore();
    const rec = db.createAccount({ name: "R", email: "runner@example.com" });
    expect(rec.status).toBe("pending");
    const linked = applySupabaseIdentity(rec, { sub: "user-1", email: "runner@example.com" });
    if (!linked.ok) throw new Error("link must succeed");
    // This is exactly what the verify endpoint applies: link + advance to the
    // selfie step. status stays pending — the badge only comes from approval.
    const updated = db.updateAccount(rec.id, { ...linked.patch, phase: "selfie" })!;
    expect(updated.status).toBe("pending");
    expect(updated.phase).toBe("selfie");
    expect(updated.supabaseAuthId).toBe("user-1");
  });
});

// ------------------------------------------------------- browser OTP adapter
const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

import { sendOtp, supabaseClientConfig, verifyOtp, type SupabaseAuthLike } from "../src/lib/supabase";

const CLIENT_ENV = {
  VITE_SUPABASE_URL: "https://abcd1234.supabase.co",
  VITE_SUPABASE_ANON_KEY: "anon-key-for-browser",
};

function authStub(): SupabaseAuthLike & { signInWithOtp: ReturnType<typeof vi.fn>; verifyOtp: ReturnType<typeof vi.fn> } {
  return {
    signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok-abc" } }, error: null }),
  };
}

describe("browser supabaseClientConfig", () => {
  it("fails closed when the browser-safe env vars are missing", () => {
    expect(supabaseClientConfig({})).toMatchObject({
      configured: false,
      missing: ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"],
    });
  });
});

describe("sendOtp (browser adapter)", () => {
  it("returns an explicit unconfigured state and never builds a client", async () => {
    createClientMock.mockClear();
    const result = await sendOtp("runner@example.com", { env: {} });
    expect(result).toMatchObject({ ok: false, code: "unconfigured" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("calls signInWithOtp with the email and shouldCreateUser for signup", async () => {
    const auth = authStub();
    createClientMock.mockReturnValue({ auth });
    const result = await sendOtp("runner@example.com", { env: CLIENT_ENV, auth });
    expect(result).toEqual({ ok: true });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "runner@example.com",
      options: { shouldCreateUser: true },
    });
  });

  it("maps a Supabase rate limit to an explicit rate_limited result", async () => {
    const auth = authStub();
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { message: "For security purposes, you can only request this after 60 seconds." },
    });
    const result = await sendOtp("runner@example.com", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("maps signups-disabled to a clear operator-facing error", async () => {
    const auth = authStub();
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: { message: "Signups not allowed for otp" } });
    const result = await sendOtp("runner@example.com", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "send_failed" });
    if (!result.ok) expect(result.message).toContain("Allow new users to sign up");
  });

  it("surfaces a network throw as send_failed", async () => {
    const auth = authStub();
    auth.signInWithOtp.mockRejectedValue(new Error("offline"));
    const result = await sendOtp("runner@example.com", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "send_failed" });
  });
});

describe("verifyOtp (browser adapter)", () => {
  it("returns an explicit unconfigured state and never builds a client", async () => {
    createClientMock.mockClear();
    const result = await verifyOtp("runner@example.com", "123456", { env: {} });
    expect(result).toMatchObject({ ok: false, code: "unconfigured" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("verifies type=email and returns the access token for the server bridge", async () => {
    const auth = authStub();
    createClientMock.mockReturnValue({ auth });
    const result = await verifyOtp("runner@example.com", "123456", { env: CLIENT_ENV, auth });
    expect(result).toEqual({ ok: true, accessToken: "tok-abc" });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "runner@example.com", token: "123456", type: "email" });
  });

  it("maps an expired-code error to code_expired", async () => {
    const auth = authStub();
    auth.verifyOtp.mockResolvedValue({ data: {}, error: { message: "Token has expired or is invalid" } });
    const result = await verifyOtp("runner@example.com", "000000", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "code_expired" });
  });

  it("maps an invalid-code error to invalid_code", async () => {
    const auth = authStub();
    auth.verifyOtp.mockResolvedValue({ data: {}, error: { message: "Invalid OTP" } });
    const result = await verifyOtp("runner@example.com", "111111", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "invalid_code" });
  });

  it("never fabricates a token when the session is missing", async () => {
    const auth = authStub();
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: null });
    const result = await verifyOtp("runner@example.com", "123456", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "verify_failed" });
  });
});
