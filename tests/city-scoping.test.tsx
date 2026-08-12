/**
 * City-scoping tests — the selected city is the account home city when signed
 * in (account wins over any stored/guest selection), guests keep the guest
 * switcher, and legacy signed-in accounts without a home city are clearly
 * shown as unset and prompted.
 *
 * Pure logic via `effectiveCityId`; the hook via a probe component rendered
 * with react-dom/server (no jsdom). Only `useAccount` is mocked (hoisted);
 * `useAppState` runs for real (localStorage is stubbed so the stored city
 * differs from the account city).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeCityBanner } from "../src/components/HomeCityBanner";
import { CITIES, isSupportedCityId } from "../src/data/cities";
import { effectiveCityId } from "../src/lib/store";
import type { Me, PublicAccount } from "../src/lib/accounts";
import { useSelectedCity } from "../src/state/city";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));

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
    roles: patch.roles ?? ["runner"],
  };
}

function auth(me: Me) {
  useAccountMock.mockReturnValue({
    me,
    backendAvailable: true,
    refresh: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    deleteMyAccount: vi.fn(async () => ({ ok: false, error: new Error("unavailable") })),
    role: me.status === "signed_in" ? (me.account.status === "verified" ? "verified" : "pending") : "guest",
  });
}

// Stored (guest) city differs from the account home city so the priority rule
// is actually exercised.
const STORED_CITY = "stl-mo";
beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => JSON.stringify({ cityId: STORED_CITY, rsvped: {} }),
    setItem: () => {},
    removeItem: () => {},
  });
  auth({ status: "guest" });
});

/** Probe component rendering what the app would show for the selected city. */
function Probe() {
  const { city, cityId, signedIn, hasHomeCity } = useSelectedCity();
  return (
    <span data-testid="probe">
      cityId={cityId} name={city.name} signedIn={String(signedIn)} hasHomeCity={String(hasHomeCity)}
    </span>
  );
}
function renderProbe(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <Probe />
    </MemoryRouter>,
  );
}

describe("effectiveCityId — account home city wins, guests keep the switcher", () => {
  it("uses the account home city when set, regardless of the stored guest city", () => {
    expect(effectiveCityId("columbia-mo", "stl-mo")).toBe("columbia-mo");
  });
  it("falls back to the stored (guest-switched) city for legacy/unset accounts and guests", () => {
    expect(effectiveCityId(null, "stl-mo")).toBe("stl-mo");
    expect(effectiveCityId(undefined, "stl-mo")).toBe("stl-mo");
  });
});

describe("useSelectedCity — scoping to the account home city", () => {
  it("signed-in account: the account home city wins over the stored city", () => {
    auth({ status: "signed_in", account: account({ cityId: "columbia-mo" }) });
    const html = renderProbe();
    expect(html).toContain("cityId=columbia-mo");
    expect(html).toContain("name=Columbia");
    expect(html).toContain("signedIn=true");
    expect(html).toContain("hasHomeCity=true");
  });
  it("signed-in legacy account (null cityId): stored/guest selection is preserved and clearly unset", () => {
    auth({ status: "signed_in", account: account({ cityId: null }) });
    const html = renderProbe();
    expect(html).toContain("cityId=stl-mo");
    expect(html).toContain("name=St. Louis");
    expect(html).toContain("signedIn=true");
    expect(html).toContain("hasHomeCity=false");
  });
  it("guests: the guest city switcher drives the selected city", () => {
    auth({ status: "guest" });
    const html = renderProbe();
    expect(html).toContain("cityId=stl-mo");
    expect(html).toContain("name=St. Louis");
    expect(html).toContain("signedIn=false");
    expect(html).toContain("hasHomeCity=false");
  });
});

describe("HomeCityBanner — legacy unset accounts are prompted, others never see it", () => {
  it("renders the prompt for a signed-in account with no home city", () => {
    auth({ status: "signed_in", account: account({ cityId: null }) });
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HomeCityBanner />
      </MemoryRouter>,
    );
    expect(html).toContain("Choose your home city");
    expect(html).toContain("Choose home city");
  });
  it("is hidden for a signed-in account that has a home city", () => {
    auth({ status: "signed_in", account: account({ cityId: "columbia-mo" }) });
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HomeCityBanner />
      </MemoryRouter>,
    );
    expect(html).not.toContain("Choose your home city");
  });
  it("is hidden for guests (they own the guest city switcher)", () => {
    auth({ status: "guest" });
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HomeCityBanner />
      </MemoryRouter>,
    );
    expect(html).not.toContain("Choose your home city");
  });
});

describe("city entities stay extensible", () => {
  it("the supported-city validation is entity-driven, not Columbia-hardcoded", () => {
    expect(CITIES.length).toBeGreaterThan(1);
    expect(isSupportedCityId("columbia-mo")).toBe(true);
    expect(isSupportedCityId("stl-mo")).toBe(true); // known entity, not yet live
    expect(isSupportedCityId("atlantis")).toBe(false);
  });
});
