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
    expect(cfg.redirectConfigured).toBe(false);
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

import { AUTH_TIMEOUT_MS, resendConfirmationEmail, sendOtp, signInWithPassword, signUp, resetPasswordForEmail, setRecoverySession, supabaseClientConfig, updatePassword, verifyOtp, type SupabaseAuthLike } from "../src/lib/supabase";

const CLIENT_ENV = {
  VITE_SUPABASE_URL: "https://abcd1234.supabase.co",
  VITE_SUPABASE_ANON_KEY: "anon-key-for-browser",
};

function authStub(): SupabaseAuthLike & {
  signInWithOtp: ReturnType<typeof vi.fn>;
  verifyOtp: ReturnType<typeof vi.fn>;
  signUp: ReturnType<typeof vi.fn>;
  signInWithPassword: ReturnType<typeof vi.fn>;
  resetPasswordForEmail: ReturnType<typeof vi.fn>;
  resend: ReturnType<typeof vi.fn>;
  updateUser: ReturnType<typeof vi.fn>;
  setSession: ReturnType<typeof vi.fn>;
} {
  return {
    signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok-abc" } }, error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok-abc" } }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok-abc" } }, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    resend: vi.fn().mockResolvedValue({ data: {}, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: {} }, error: null }),
    setSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
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

  it("treats a signups-disabled provider error as a plain send failure (no OTP-era operator message)", async () => {
    const auth = authStub();
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: { message: "Signups not allowed for otp" } });
    const result = await sendOtp("runner@example.com", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "send_failed" });
    if (!result.ok) expect(result.message).toBe("Could not send the verification email. Try again.");
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

// --------------------------------------------- password auth (primary flow)
describe("signUp (browser adapter)", () => {
  it("returns an explicit unconfigured state and never builds a client", async () => {
    createClientMock.mockClear();
    const result = await signUp("runner@example.com", "s3cret-pass", { env: {} });
    expect(result).toMatchObject({ ok: false, code: "unconfigured" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("creates the Supabase auth user with email+password and returns the session token", async () => {
    const auth = authStub();
    createClientMock.mockReturnValue({ auth });
    const result = await signUp("runner@example.com", "s3cret-pass", { env: CLIENT_ENV, auth });
    expect(result).toEqual({ ok: true, accessToken: "tok-abc", emailConfirmationRequired: false });
    expect(auth.signUp).toHaveBeenCalledWith({ email: "runner@example.com", password: "s3cret-pass", options: { emailRedirectTo: "https://runlocal.ctonew.app" } });
  });

  it("passes only safe profile metadata through options.data", async () => {
    const auth = authStub();
    createClientMock.mockReturnValue({ auth });
    await signUp("runner@example.com", "s3cret-pass", {
      env: { ...CLIENT_ENV, VITE_AUTH_REDIRECT_URL: "https://runlocal.ctonew.app" },
      auth,
      data: { username: "runner_1", display_name: "Runner One" },
    });
    const request = auth.signUp.mock.calls[0]?.[0] as { options?: { data?: Record<string, unknown> } };
    expect(request.options?.data).toEqual({ username: "runner_1", display_name: "Runner One" });
    expect(JSON.stringify(request.options?.data)).not.toMatch(/password|phone|birthdate|photo|email/i);
  });

  it("reports email-confirmation-required when Supabase returns no session", async () => {
    const auth = authStub();
    auth.signUp.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
    const result = await signUp("runner@example.com", "s3cret-pass", { env: CLIENT_ENV, auth });
    expect(result).toEqual({ ok: true, accessToken: null, emailConfirmationRequired: true });
  });

  it("maps an already-registered email to email_taken", async () => {
    const auth = authStub();
    auth.signUp.mockResolvedValue({ data: { session: null }, error: { message: "User already registered" } });
    const result = await signUp("runner@example.com", "s3cret-pass", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "email_taken" });
  });
});

describe("signInWithPassword (browser adapter)", () => {
  it("returns the session token on a valid password login", async () => {
    const auth = authStub();
    createClientMock.mockReturnValue({ auth });
    const result = await signInWithPassword("runner@example.com", "s3cret-pass", { env: CLIENT_ENV, auth });
    expect(result).toEqual({ ok: true, accessToken: "tok-abc", emailConfirmationRequired: false });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "runner@example.com", password: "s3cret-pass" });
  });

  it("maps an unconfirmed email to an explicit email_not_confirmed error", async () => {
    const auth = authStub();
    auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: "Email not confirmed" } });
    const result = await signInWithPassword("runner@example.com", "s3cret-pass", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "email_not_confirmed" });
  });

  it("maps bad credentials to a generic invalid_credentials error (never echoes the password)", async () => {
    const auth = authStub();
    auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: "Invalid login credentials" } });
    const result = await signInWithPassword("runner@example.com", "wrong-pass", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "invalid_credentials" });
    if (!result.ok) expect(result.message).not.toContain("wrong-pass");
  });
});

describe("resetPasswordForEmail (browser adapter)", () => {
  it("requests a reset with the public origin as the recovery redirect", async () => {
    const auth = authStub();
    createClientMock.mockReturnValue({ auth });
    const result = await resetPasswordForEmail("runner@example.com", { env: CLIENT_ENV, auth });
    expect(result).toEqual({ ok: true });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("runner@example.com", {
      redirectTo: "https://runlocal.ctonew.app",
    });
  });

  it("fails closed as unconfigured and never calls the provider", async () => {
    createClientMock.mockClear();
    const result = await resetPasswordForEmail("runner@example.com", { env: {} });
    expect(result).toMatchObject({ ok: false, code: "unconfigured" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("maps a provider error to an explicit send-failure message", async () => {
    const auth = authStub();
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: { message: "rate limit" } });
    const result = await resetPasswordForEmail("runner@example.com", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "failed" });
  });
});

describe("recovery session + updatePassword (browser adapter)", () => {
  it("setRecoverySession restores the session from the link tokens", async () => {
    const auth = authStub();
    createClientMock.mockReturnValue({ auth });
    const result = await setRecoverySession("at-1", "rt-1", { env: CLIENT_ENV, auth });
    expect(result).toEqual({ ok: true });
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: "at-1", refresh_token: "rt-1" });
  });

  it("setRecoverySession maps a rejected token to an explicit expired-link error", async () => {
    const auth = authStub();
    auth.setSession.mockResolvedValue({ data: { session: null }, error: { message: "invalid jwt" } });
    const result = await setRecoverySession("at-1", "rt-1", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "failed" });
  });

  it("updatePassword calls updateUser with the new password only", async () => {
    const auth = authStub();
    createClientMock.mockReturnValue({ auth });
    const result = await updatePassword("new-s3cret", { env: CLIENT_ENV, auth });
    expect(result).toEqual({ ok: true });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "new-s3cret" });
  });

  it("updatePassword maps a provider error to an explicit failure", async () => {
    const auth = authStub();
    auth.updateUser.mockResolvedValue({ data: {}, error: { message: "jwt expired" } });
    const result = await updatePassword("new-s3cret", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "failed" });
    if (!result.ok) expect(result.message).toMatch(/expired|update/i);
  });

  it("both helpers fail closed as unconfigured and never build a client", async () => {
    createClientMock.mockClear();
    expect(await setRecoverySession("a", "b", { env: {} })).toMatchObject({ ok: false, code: "unconfigured" });
    expect(await updatePassword("x", { env: {} })).toMatchObject({ ok: false, code: "unconfigured" });
    expect(createClientMock).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------- resend confirmation email
describe("resendConfirmationEmail (browser adapter)", () => {
  it("fails closed as unconfigured and never builds a client", async () => {
    createClientMock.mockClear();
    const result = await resendConfirmationEmail("runner@example.com", { env: {} });
    expect(result).toMatchObject({ ok: false, code: "unconfigured" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("requests a signup-type resend with the same explicit emailRedirectTo as signUp", async () => {
    const auth = authStub();
    createClientMock.mockReturnValue({ auth });
    const result = await resendConfirmationEmail("runner@example.com", { env: CLIENT_ENV, auth });
    expect(result).toEqual({ ok: true });
    expect(auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "runner@example.com",
      options: { emailRedirectTo: "https://runlocal.ctonew.app" },
    });
  });

  it("maps a rate-limited provider response to rate_limited", async () => {
    const auth = authStub();
    auth.resend.mockResolvedValue({ data: {}, error: { message: "For security purposes, you can only request this after 60 seconds." } });
    const result = await resendConfirmationEmail("runner@example.com", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("maps a provider error to an honest send-failure — never claims delivery", async () => {
    const auth = authStub();
    auth.resend.mockResolvedValue({ data: {}, error: { message: "Email provider rejected" } });
    const result = await resendConfirmationEmail("runner@example.com", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "failed" });
    if (!result.ok) {
      expect(result.message).not.toMatch(/sent|delivered/i);
      expect(result.message).toMatch(/resend/i);
    }
  });

  it("surfaces a network throw as failed", async () => {
    const auth = authStub();
    auth.resend.mockRejectedValue(new Error("offline"));
    const result = await resendConfirmationEmail("runner@example.com", { env: CLIENT_ENV, auth });
    expect(result).toMatchObject({ ok: false, code: "failed" });
  });
});

// ------------------------------------------------- bounded timeout on provider calls
describe("bounded timeout on auth network operations", () => {
  it("times out a hung signUp instead of leaving the caller busy forever", async () => {
    vi.useFakeTimers();
    try {
      const auth = authStub();
      auth.signUp.mockReturnValue(new Promise(() => {}));
      createClientMock.mockReturnValue({ auth });
      const pending = signUp("runner@example.com", "s3cret-pass", { env: CLIENT_ENV, auth });
      const assertion = pending.then((r) => {
        expect(r).toMatchObject({ ok: false, code: "timeout" });
        if (!r.ok) expect(r.message).toMatch(/try again/i);
      });
      await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS + 50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a hung signInWithPassword", async () => {
    vi.useFakeTimers();
    try {
      const auth = authStub();
      auth.signInWithPassword.mockReturnValue(new Promise(() => {}));
      createClientMock.mockReturnValue({ auth });
      const pending = signInWithPassword("runner@example.com", "s3cret-pass", { env: CLIENT_ENV, auth });
      const assertion = pending.then((r) => expect(r).toMatchObject({ ok: false, code: "timeout" }));
      await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS + 50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a hung resetPasswordForEmail", async () => {
    vi.useFakeTimers();
    try {
      const auth = authStub();
      auth.resetPasswordForEmail.mockReturnValue(new Promise(() => {}));
      createClientMock.mockReturnValue({ auth });
      const pending = resetPasswordForEmail("runner@example.com", { env: CLIENT_ENV, auth });
      const assertion = pending.then((r) => expect(r).toMatchObject({ ok: false, code: "timeout" }));
      await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS + 50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a hung resendConfirmationEmail", async () => {
    vi.useFakeTimers();
    try {
      const auth = authStub();
      auth.resend.mockReturnValue(new Promise(() => {}));
      createClientMock.mockReturnValue({ auth });
      const pending = resendConfirmationEmail("runner@example.com", { env: CLIENT_ENV, auth });
      const assertion = pending.then((r) => expect(r).toMatchObject({ ok: false, code: "timeout" }));
      await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS + 50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves immediately when the provider responds before the timeout", async () => {
    vi.useFakeTimers();
    try {
      const auth = authStub();
      createClientMock.mockReturnValue({ auth });
      const pending = resendConfirmationEmail("runner@example.com", { env: CLIENT_ENV, auth });
      const assertion = pending.then((r) => expect(r).toEqual({ ok: true }));
      // Microtasks flush the mock's already-resolved promise without any timer.
      await Promise.resolve();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
