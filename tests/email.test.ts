import { describe, expect, it, vi } from "vitest";
import { emailConfig, emailSenderCheck, sendVerificationEmail } from "../src/server/email";
describe("Resend email contract", () => {
  it("reports every missing deployment variable without exposing values", () => {
    expect(emailConfig({})).toEqual({
      configured: false,
      missing: ["RESEND_API_KEY", "RUN_LOCAL_EMAIL_FROM"],
    });
  });
  it("does not call the provider when configuration is absent", async () => {
    const provider = vi.fn();
    const result = await sendVerificationEmail("runner@example.com", "123456", {
      env: {},
      fetchFn: provider,
    });
    expect(result).toEqual({
      ok: false,
      kind: "unconfigured",
      message: expect.stringContaining("No code was sent."),
    });
    expect(provider).not.toHaveBeenCalled();
  });
  it("uses Resend's documented request and only succeeds for an OK response", async () => {
    const provider = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await sendVerificationEmail("runner@example.com", "123456", {
      env: { RESEND_API_KEY: "re_test", RUN_LOCAL_EMAIL_FROM: "Run Local <verify@example.com>" },
      fetchFn: provider,
    });
    expect(result).toEqual({ ok: true });
    expect(provider).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: {
        Authorization: "Bearer re_test",
        "Content-Type": "application/json",
      },
    }));
    const request = provider.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      from: "Run Local <verify@example.com>",
      to: ["runner@example.com"],
      subject: "Run Local verification code",
    });
  });
  it("turns provider failures into an explicit failure that says the sender/domain must be verified in Resend", async () => {
    const provider = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad", { status: 400 }));
    const result = await sendVerificationEmail("runner@example.com", "123456", {
      env: { RESEND_API_KEY: "re_test", RUN_LOCAL_EMAIL_FROM: "Run Local <verify@example.com>" },
      fetchFn: provider,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("provider_error");
      expect(result.message).toContain("Resend");
      expect(result.message).toContain("verified");
      expect(result.message).not.toContain("re_test"); // never leak the key
    }
  });
  it("surfaces a safe Resend error detail alongside the verification hint", async () => {
    const provider = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "from email is not verified" }), { status: 403 }),
    );
    const result = await sendVerificationEmail("runner@example.com", "123456", {
      env: { RESEND_API_KEY: "re_test", RUN_LOCAL_EMAIL_FROM: "Run Local <verify@example.com>" },
      fetchFn: provider,
    });
    if (!result.ok) {
      expect(result.message).toContain("from email is not verified");
      expect(result.message).toContain("Resend");
    } else {
      expect.unreachable("provider rejection must not be ok");
    }
  });
});

describe("emailSenderCheck (provider-free diagnostics)", () => {
  it("reports unconfigured when no FROM address is usable", () => {
    expect(emailSenderCheck({ RESEND_API_KEY: "re_x" })).toMatchObject({
      status: "unconfigured",
      domain: null,
      verifiable: false,
      verified: null,
      reason: "missing_sender",
    });
  });

  it("never lets a Gmail sender appear valid — blocked, determinably", () => {
    expect(emailSenderCheck({ RESEND_API_KEY: "re_x", RUN_LOCAL_EMAIL_FROM: "hello.runlocal@gmail.com" })).toEqual({
      status: "blocked",
      verifiable: false,
      verified: false,
      domain: "gmail.com",
      reason: "consumer_domain",
    });
  });

  it("handles the display-name form of the FROM address", () => {
    expect(
      emailSenderCheck({ RESEND_API_KEY: "re_x", RUN_LOCAL_EMAIL_FROM: "Run Local <verify@outlook.com>" }),
    ).toMatchObject({ status: "blocked", domain: "outlook.com", verified: false });
  });

  it("flags Resend's resend.dev test sender as not valid for user verification", () => {
    expect(emailSenderCheck({ RESEND_API_KEY: "re_x", RUN_LOCAL_EMAIL_FROM: "onboarding@resend.dev" })).toMatchObject({
      status: "test_mode",
      verifiable: false,
      verified: false,
      reason: "resend_dev_test_sender",
    });
  });

  it("treats a custom domain as verifiable but unconfirmed (no provider call)", () => {
    expect(emailSenderCheck({ RESEND_API_KEY: "re_x", RUN_LOCAL_EMAIL_FROM: "verify@runlocal.co" })).toEqual({
      status: "custom_domain",
      verifiable: true,
      verified: null,
      domain: "runlocal.co",
      reason: "not_confirmed",
    });
  });
});
