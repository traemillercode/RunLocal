/**
 * UI-level tests for the auth affordances in the header and account menu.
 *
 * Rendered with react-dom/server (no DOM / jsdom needed) so these exercise
 * the REAL component markup — the guest header "Log in" CTA, the clickable
 * logo home link, and the guest account menu rows — not just the menu model.
 *
 * Only `useAccount` is mocked (hoisted, no outer refs); react-router-dom is
 * real, wrapped in a MemoryRouter. Auth stays honest: these tests only assert
 * what guests/signed-in users see, never client-side role powers.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AccountMenuContent } from "../src/components/AccountMenu";
import { Header } from "../src/components/Header";
import { CITIES } from "../src/data/cities";
import type { Me, PublicAccount } from "../src/lib/accounts";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));

function verifiedAccount(patch: Partial<PublicAccount> = {}): PublicAccount {
  return {
    id: "acc_1",
    name: "Taylor Runner",
    email: "taylor@example.com",
    status: "verified",
    phase: null,
    badge: "verified",
    role: "runner",
    isOwner: false,
    profilePhotoUrl: null,
    ...patch,
  };
}

function guestAuth() {
  useAccountMock.mockReturnValue({
    me: { status: "guest" } satisfies Me,
    backendAvailable: true,
    refresh: async () => {},
    signOut: async () => {},
    deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }),
    role: "guest",
  });
}

function signedInAuth(account: PublicAccount = verifiedAccount()) {
  useAccountMock.mockReturnValue({
    me: { status: "signed_in", account } satisfies Me,
    backendAvailable: true,
    refresh: async () => {},
    signOut: async () => {},
    deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }),
    role: "verified",
  });
}

const noop = () => {};

describe("guest account menu (UI)", () => {
  it("renders Log in and Sign up rows for guests", () => {
    const html = renderToStaticMarkup(
      <AccountMenuContent me={null} backendAvailable onNavigate={noop} onLogout={noop} />,
    );
    expect(html).toContain("Sign up");
    expect(html).toContain("Log in");
    // Sign up is listed first, then Log in — both above the fold in the sheet.
    expect(html.indexOf("Sign up")).toBeGreaterThan(-1);
    expect(html.indexOf("Log in")).toBeGreaterThan(html.indexOf("Sign up"));
  });

  it("shows the runner's identity and Log out once signed in (no guest rows)", () => {
    const html = renderToStaticMarkup(
      <AccountMenuContent me={{ status: "signed_in", account: verifiedAccount() }} backendAvailable onNavigate={noop} onLogout={noop} />,
    );
    expect(html).toContain("Taylor Runner");
    expect(html).toContain("Log out");
    expect(html).not.toContain("Sign up");
    expect(html).not.toContain("Log in");
  });

  it("shows the pending read-only note without login rows", () => {
    const html = renderToStaticMarkup(
      <AccountMenuContent
        me={{ status: "signed_in", account: verifiedAccount({ status: "pending", phase: "pending_review", badge: null }) }}
        backendAvailable
        onNavigate={noop}
        onLogout={noop}
      />,
    );
    expect(html).toContain("Read-only account.");
    expect(html).not.toContain("Sign up");
    expect(html).not.toContain("Log in");
  });
});

describe("header auth UI", () => {
  it("shows an always-visible Log in CTA and a clickable logo home link for guests", () => {
    guestAuth();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Header city={CITIES[0]} onOpenCitySheet={noop} />
      </MemoryRouter>,
    );
    // The guest CTA is in the sticky header — never behind the bottom nav.
    expect(html).toContain(">Log in<");
    // Logo/title is a home link.
    expect(html).toContain('href="/"');
    expect(html).toContain('aria-label="Run Local — home"');
    expect(html).toContain("Run");
    expect(html).toContain("Local");
  });

  it("hides the guest Log in CTA once signed in", () => {
    signedInAuth();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Header city={CITIES[0]} onOpenCitySheet={noop} />
      </MemoryRouter>,
    );
    expect(html).not.toContain(">Log in<");
    // The avatar now advertises the signed-in account instead.
    expect(html).toContain("Account menu — signed in as Taylor Runner");
    // Logo home link stays.
    expect(html).toContain('href="/"');
  });
});
