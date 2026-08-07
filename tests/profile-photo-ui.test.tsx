/**
 * UI-level coverage for profile photo rendering (no DOM stack — real component
 * markup via react-dom/server, per the repo's node-env vitest setup).
 *
 *  - ProfilePage renders the profilePhotoUrl <img> when set, and falls back to
 *    the initials placeholder when it is null.
 *  - ProfilePhotoSettings (Settings) offers Add/Change photo with the accepted
 *    types and 4 MB limit copy, and previews the current photo.
 *  - The account-refresh contract (refresh() re-fetches /api/me, which returns
 *    the new profilePhotoUrl) is proven at the server layer in
 *    profile-photo.test.ts; here we only assert what the UI renders from the
 *    account payload.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProfilePage } from "../src/pages/ProfilePage";
import { ProfilePhotoSettings } from "../src/pages/SettingsPage";
import { CITIES } from "../src/data/cities";
import type { Me, PublicAccount } from "../src/lib/accounts";
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
    underReview: false,
    profilePhotoUrl: null,
    ...patch,
  };
}
const city = CITIES[0];
const noop = () => {};
const store = { state: { cityId: city.id, rsvped: {} }, setCityId: noop, toggleRsvp: noop };

describe("ProfilePage — profile photo rendering", () => {
  it("renders the profile photo <img> when profilePhotoUrl is set (incl. WebP)", () => {
    auth(account({ profilePhotoUrl: "/uploads/public/acc_1_profile.webp" }));
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProfilePage city={city} store={store} />
      </MemoryRouter>,
    );
    expect(html).toContain('src="/uploads/public/acc_1_profile.webp"');
    expect(html).toContain("rounded-full object-cover");
  });
  it("falls back to the initials placeholder when no photo is set", () => {
    auth(account({ profilePhotoUrl: null }));
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProfilePage city={city} store={store} />
      </MemoryRouter>,
    );
    expect(html).not.toContain("/uploads/public/");
    expect(html).toContain("TR"); // initials of "Taylor Runner"
  });
});

describe("ProfilePhotoSettings — Settings upload affordances", () => {
  it("offers Add photo with the documented accepted types and size limit", () => {
    const html = renderToStaticMarkup(
      <ProfilePhotoSettings account={account({ profilePhotoUrl: null })} refresh={async () => {}} />,
    );
    expect(html).toContain("Add photo");
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain("JPG, PNG, or WebP · up to 4 MB.");
  });
  it("shows Change photo and previews the current photo when one exists", () => {
    const html = renderToStaticMarkup(
      <ProfilePhotoSettings account={account({ profilePhotoUrl: "/uploads/public/acc_1_profile.webp" })} refresh={async () => {}} />,
    );
    expect(html).toContain("Change photo");
    expect(html).toContain('src="/uploads/public/acc_1_profile.webp"');
    expect(html).toContain('alt="Profile photo preview"');
  });
});
