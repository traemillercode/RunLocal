/**
 * Username UI contract tests (no jsdom — react-dom/server markup).
 *
 * The signup form collects a Username with the documented rules hint, the
 * profile shows the public @handle, and legacy accounts without one get a
 * clear "choose your username" prompt. Only `useAccount` is mocked; all other
 * components render for real.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "../src/pages/LoginPage";
import { ProfilePage } from "../src/pages/ProfilePage";
import { CITIES } from "../src/data/cities";
import type { Me, PublicAccount } from "../src/lib/accounts";
import { USERNAME_HINT } from "../src/lib/username";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));

function auth(account: PublicAccount | null) {
  const me: Me = account ? { status: "signed_in", account } : { status: "guest" };
  useAccountMock.mockReturnValue({
    me,
    backendAvailable: true,
    refresh: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    deleteMyAccount: vi.fn(async () => ({ ok: false, error: new Error("unavailable") })),
    role: account?.status === "verified" ? "verified" : account ? "pending" : "guest",
  });
}

function account(patch: Partial<PublicAccount> = {}): PublicAccount {
  return {
    id: "acc_1",
    name: "Taylor Runner",
    email: "taylor@example.com",
    username: "taylor_runs",
    cityId: "columbia-mo",
    status: "verified",
    phase: null,
    badge: "verified",
    role: "runner",
    isOwner: false,
    suspended: false,
    profilePhotoUrl: null,
    ...patch,
  };
}

const city = CITIES[0];
const noop = () => {};
const store = { state: { cityId: city.id, rsvped: {} }, setCityId: noop, toggleRsvp: noop };

describe("LoginPage — signup collects the username", () => {
  it("renders a Username field with the documented rules hint", () => {
    auth(null);
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/login?mode=signup"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Username");
    expect(html).toMatch(/autocomplete="username"/i);
    expect(html).toContain(USERNAME_HINT);
  });
  it("login mode does not ask for a username", () => {
    auth(null);
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(html).not.toMatch(/autocomplete="username"/i);
  });
});

describe("ProfilePage — username display & editor", () => {
  it("shows the public @handle in the identity card for signed-in users", () => {
    auth(account({ username: "jordanlee" }));
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProfilePage city={city} store={store} />
      </MemoryRouter>,
    );
    expect(html).toContain("@jordanlee");
  });
  it("prompts users without a username to choose one", () => {
    auth(account({ username: null }));
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProfilePage city={city} store={store} />
      </MemoryRouter>,
    );
    expect(html).toContain("Choose your username");
    expect(html).toContain("Save username");
  });
  it("offers a Change action to users who already have a username", () => {
    auth(account({ username: "taylor_runs" }));
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProfilePage city={city} store={store} />
      </MemoryRouter>,
    );
    expect(html).toContain("@taylor_runs");
    expect(html).toContain("Change");
    expect(html).not.toContain("Choose your username");
  });
});
