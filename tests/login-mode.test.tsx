/**
 * Regression tests for the login/signup mode routing bug.
 *
 * Reported: while at #/login?mode=signup, tapping the header "Log in" CTA (which
 * navigates to /login) left the rendered page stuck on the signup form. The
 * cause was mode being copied from the URL into component state once at mount,
 * so a same-page navigation that only changed the search params never updated
 * the visible form without a hard reload.
 *
 * Fix: mode is DERIVED from the URL (`loginModeFromSearch`) — the URL is the
 * single source of truth, and the in-form "Create an account" / "Log in
 * instead" toggles write the param back so the URL always advertises the
 * visible form. These tests pin the URL→form mapping at both routes; the live
 * click-through (header CTA → /login while on ?mode=signup) is verified in the
 * browser at a mobile viewport.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LoginPage, loginModeFromSearch } from "../src/pages/LoginPage";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));

function guestAuth() {
  useAccountMock.mockReturnValue({
    me: { status: "guest" },
    backendAvailable: true,
    refresh: async () => {},
    signOut: async () => {},
    deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }),
    role: "guest",
  });
}

describe("loginModeFromSearch (URL is the single source of truth)", () => {
  it("maps the mode search param to the visible form", () => {
    expect(loginModeFromSearch(new URLSearchParams(""))).toBe("login");
    expect(loginModeFromSearch(new URLSearchParams("mode=login"))).toBe("login");
    expect(loginModeFromSearch(new URLSearchParams("mode=signup"))).toBe("signup");
    expect(loginModeFromSearch(new URLSearchParams("mode=bogus"))).toBe("login");
  });
});

describe("LoginPage renders the form the URL advertises (no stale state)", () => {
  it("renders the login form at /login", () => {
    guestAuth();
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(html).toContain(">Log in<"); // heading + submit button
    expect(html).toContain("Create an account"); // in-form toggle
    expect(html).not.toContain("Create your account");
    expect(html).not.toContain("Log in instead");
  });

  it("renders the signup form at /login?mode=signup", () => {
    guestAuth();
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/login?mode=signup"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Create your account");
    expect(html).toContain("Log in instead");
    // Signup-only fields are present.
    expect(html).toContain("Username");
    expect(html).toContain("Birthdate");
    expect(html).toContain("Home city");
  });

  it("deep-link mode=login is treated as login, never signup", () => {
    guestAuth();
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/login?mode=login"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(html).toContain(">Log in<");
    expect(html).not.toContain("Create your account");
  });
});
