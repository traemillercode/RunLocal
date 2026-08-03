/**
 * Auth-completion UI contract tests (no jsdom — react-dom/server markup).
 *
 * Primary signup/login must be Supabase email + password with a confirmation
 * LINK: no six-digit OTP wording anywhere in the primary auth UI, and the
 * verification page must not resurrect the old email-code/profile steps.
 * Signup collects the profile metadata needed to create the local Pending
 * account (name, birthdate, optional phone, optional photo).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { VerifiedGateSheet } from "../src/components/VerifiedGateSheet";
import { LoginPage } from "../src/pages/LoginPage";
import { VerifyPage } from "../src/pages/VerifyPage";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));

const OTP_WORDING = /one-time|6-digit|six-digit|\bOTP\b|verification code/i;

describe("LoginPage — primary auth has no OTP wording", () => {
  it("signup mode collects profile metadata and uses a confirmation link", () => {
    useAccountMock.mockReturnValue({ me: { status: "guest" }, backendAvailable: true, refresh: vi.fn(), signOut: vi.fn(), deleteMyAccount: vi.fn(), role: "guest" });
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/login?mode=signup"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Create your account");
    expect(html).toContain("Name");
    expect(html).toContain("Birthdate");
    expect(html).toContain("Phone (optional)");
    expect(html).toContain("Profile photo (optional)");
    expect(html).toContain("confirmation link");
    // Email/password are the primary credentials — nothing else.
    expect(html).toContain('type="password"');
    expect(html).toContain('type="email"');
    expect(OTP_WORDING.test(html)).toBe(false);
  });

  it("login mode is plain email + password with a forgot-password link", () => {
    useAccountMock.mockReturnValue({ me: { status: "guest" }, backendAvailable: true, refresh: vi.fn(), signOut: vi.fn(), deleteMyAccount: vi.fn(), role: "guest" });
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Log in");
    expect(html).toContain("Forgot password?");
    expect(html).toContain('type="password"');
    expect(OTP_WORDING.test(html)).toBe(false);
  });
});

describe("VerifyPage — no email-code / profile steps", () => {
  it("signed-out visitors are pointed at the password signup, not a code form", () => {
    useAccountMock.mockReturnValue({ me: { status: "guest" }, backendAvailable: true, refresh: vi.fn(), signOut: vi.fn(), deleteMyAccount: vi.fn(), role: "guest" });
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/verify"]}>
        <VerifyPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Log in to verify");
    expect(html).toContain("Create an account");
    expect(OTP_WORDING.test(html)).toBe(false);
  });
});

describe("VerifiedGateSheet — guest copy matches the password flow", () => {
  it("describes email + password signup, never an email code", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <VerifiedGateSheet open role="guest" actionLabel="RSVP to runs" pendingLabel="" onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(html).toContain("email and password");
    expect(html).toContain("Create account");
    expect(html).not.toContain("email code");
    expect(OTP_WORDING.test(html)).toBe(false);
  });
});
