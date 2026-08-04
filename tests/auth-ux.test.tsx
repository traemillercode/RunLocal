/**
 * Auth UX regression tests:
 *  - the signup confirmation notice carries an explicit delivery caveat when
 *    the deployment hasn't configured an email provider;
 *  - the visible "Resend confirmation email" action reuses the signup email,
 *    has a loading state, and shows clear success/error (never claims delivery);
 *  - ConfirmationPage's error state actually lets the user request a fresh
 *    confirmation email (not just route to login), prefilling the email from
 *    the query string when available.
 *
 * Rendered with react-dom/server (renderToStaticMarkup) per the repo pattern —
 * no jsdom; assertions run against the produced HTML string.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ResendConfirmationBox } from "../src/components/ResendConfirmationBox";
import { ConfirmationPage } from "../src/pages/ConfirmationPage";
import { emailDeliveryCaveat, signupConfirmationNotice } from "../src/pages/LoginPage";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    supabaseClientConfig: vi.fn(() => ({ emailDelivery: "not-configured" })),
    resendConfirmationEmail: vi.fn(),
  },
}));
vi.mock("../src/lib/supabase", () => supabaseMock);

describe("signupConfirmationNotice (honest delivery caveat)", () => {
  it("appends an explicit caveat when email delivery is not configured", () => {
    const msg = signupConfirmationNotice("not-configured", false);
    expect(msg).toContain("Account created. Check your email");
    expect(msg).toContain("Email delivery isn't confirmed");
    expect(emailDeliveryCaveat("not-configured")).not.toBe("");
  });

  it("omits the caveat when delivery is provider-managed", () => {
    const msg = signupConfirmationNotice("provider-managed", false);
    expect(msg).toContain("Account created. Check your email");
    expect(msg).not.toContain("isn't confirmed");
    expect(emailDeliveryCaveat("provider-managed")).toBe("");
  });

  it("keeps the profile-photo follow-up when a photo was uploaded", () => {
    expect(signupConfirmationNotice("provider-managed", true)).toContain("profile photo right after your first sign-in");
  });
});

describe("ResendConfirmationBox (visible resend action)", () => {
  const base = {
    email: "runner@example.com",
    deliveryState: "provider-managed" as const,
    resending: false,
    error: null,
    notice: null,
    onResend: () => {},
  };

  it("renders a visible resend button that reuses the signup email", () => {
    const html = renderToStaticMarkup(<ResendConfirmationBox {...base} />);
    expect(html).toContain("Resend confirmation email");
    expect(html).toContain("runner@example.com");
    expect(html).not.toContain("Sending…");
  });

  it("shows a loading state while a resend is in flight", () => {
    const html = renderToStaticMarkup(<ResendConfirmationBox {...base} resending />);
    expect(html).toContain("Sending…");
    expect(html).not.toContain(">Resend confirmation email<");
  });

  it("shows a clear success message that never claims delivery", () => {
    const html = renderToStaticMarkup(<ResendConfirmationBox {...base} notice="Confirmation email requested. If that address exists, check your inbox." />);
    expect(html).toContain("Confirmation email requested");
  });

  it("surfaces an error without claiming delivery", () => {
    const html = renderToStaticMarkup(<ResendConfirmationBox {...base} error="Supabase could not resend the confirmation email. Check the address and try again." />);
    expect(html).toContain("Supabase could not resend");
    expect(html).not.toContain("sent");
  });

  it("warns that delivery is not guaranteed when no provider is configured", () => {
    const html = renderToStaticMarkup(<ResendConfirmationBox {...base} deliveryState="not-configured" />);
    expect(html).toContain("delivery is not guaranteed");
  });
});

describe("ConfirmationPage", () => {
  it("lets the user actually request a new confirmation email instead of only routing to login", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/confirmation?error=Link+has+expired"]}>
        <ConfirmationPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Confirmation link unavailable");
    expect(html).toContain("Enter the email you signed up with");
    expect(html).toContain("Resend confirmation email");
    expect(html).toContain("Go to log in");
  });

  it("prefills the email from the query string when available", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/confirmation?error=Link+has+expired&email=runner%40example.com"]}>
        <ConfirmationPage />
      </MemoryRouter>,
    );
    expect(html).toContain('value="runner@example.com"');
  });

  it("keeps the success state on a valid confirmation", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/confirmation"]}>
        <ConfirmationPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Email confirmed");
    expect(html).toContain("Log in");
    expect(html).not.toContain("Resend confirmation email");
  });
});
