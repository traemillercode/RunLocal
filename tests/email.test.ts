import { describe, expect, it, vi } from "vitest";
import { emailConfig, sendVerificationEmail } from "../src/server/email";

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

  it("turns provider failures into an explicit failure result", async () => {
    const provider = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad", { status: 400 }));
    const result = await sendVerificationEmail("runner@example.com", "123456", {
      env: { RESEND_API_KEY: "re_test", RUN_LOCAL_EMAIL_FROM: "Run Local <verify@example.com>" },
      fetchFn: provider,
    });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ kind: "provider_error" });
  });
});
