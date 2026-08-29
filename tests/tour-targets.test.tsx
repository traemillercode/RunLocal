/**
 * SSR/no-jsdom tests for the tour `data-tour-target` attributes and the
 * Groups/My Groups discoverability slice.
 *
 * Renders real shell components (BottomNav, Header, DesktopSidebar), the home
 * right rail, and the Profile groups card content via react-dom/server. Only
 * useAccount is mocked (hoisted); react-router-dom is real inside a
 * MemoryRouter. These assert markup — that the tour anchors exist without
 * disturbing layout — never client-side powers.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "../src/components/BottomNav";
import { DesktopSidebar } from "../src/components/DesktopSidebar";
import { Header } from "../src/components/Header";
import { HomeRightRail } from "../src/components/HomeRightRail";
import { ProfileGroupsCardContent } from "../src/pages/ProfilePage";
import { CITIES } from "../src/data/cities";
import { TOUR_STEPS, TOUR_STORAGE_KEY } from "../src/lib/tour";

// Default return matters: some tests render without calling
// mockVerifiedSession(), and BottomNav now destructures `role`, so an
// undefined return throws instead of rendering a guest bar.
const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn((): Record<string, unknown> => ({ me: null, role: "guest" })) }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));

function mockVerifiedSession() {
  useAccountMock.mockReturnValue({
    me: { status: "signed_in", account: { id: "acc_1", status: "verified", name: "Taylor Runner" } },
    backendAvailable: true,
    signOut: async () => {},
    role: "verified",
  });
}

const city = CITIES[0];

describe("tour targets on shell & nav surfaces", () => {
  it("BottomNav keeps exactly five tabs and carries the tour anchor", () => {
    // Must declare a role: the bar is role-filtered now, and a guest correctly
    // sees three tabs (Training and You are member surfaces). Without this the
    // test was asserting the five-tab structure against a guest render.
    mockVerifiedSession();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <BottomNav />
      </MemoryRouter>,
    );
    expect(html).toContain('data-tour-target="bottom-nav"');
    /*
     * The five-tab structure (D1): Home / Events / Groups / Training / You.
     *
     * Races, Forum, Connections and My Runs LEFT the bottom bar when it was
     * capped at five. All four remain reachable — sidebar on desktop, account
     * menu on mobile — but they are no longer one tap from the bottom of a
     * phone. That is a real change, not a rename.
     *
     * The previous version of this block also contradicted itself: it asserted
     * the bar both contains and does not contain "Groups", which passed only
     * because neither string was present.
     */
    const tabs = ["Home", "Events", "Groups", "Training", "You"];
    for (const t of tabs) expect(html).toContain(t);
    // The bar sizes itself from tabs.length via gridTemplateColumns rather
    // than a hardcoded grid-cols-N class, so it cannot fall out of step with
    // the number of tabs. Assert the rendered column count, not a class name.
    expect(html).toContain("repeat(5, minmax(0, 1fr))");
    expect(html).toContain('href="/profile"');
    expect(html).not.toContain('href="/connections"');
  });

  it("DesktopSidebar exposes the Groups directory link with the nav anchor", () => {
    mockVerifiedSession();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DesktopSidebar city={city} onOpenCitySheet={() => {}} />
      </MemoryRouter>,
    );
    expect(html).toContain('data-tour-target="desktop-nav"');
    // react-dom/server escapes the ampersand in text nodes.
    // Label is "Groups" now: the registry carries one label per feature, and
    // "Groups & Clubs" was a second name for the same destination.
    expect(html).toContain(">Groups<");
    expect(html).toContain('href="/groups"');
  });

  it("Header carries the app-header anchor without layout classes changing", () => {
    mockVerifiedSession();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Header city={city} onOpenCitySheet={() => {}} />
      </MemoryRouter>,
    );
    expect(html).toContain('data-tour-target="app-header"');
    expect(html).toContain("app-shell-header");
  });

  it("home right rail links nearby groups into the directory (not the events tab)", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HomeRightRail city={city} />
      </MemoryRouter>,
    );
    expect(html).toContain('href="/groups"');
    expect(html).toContain("See all groups &amp; clubs →");
  });
});

describe("Profile Groups & clubs entry", () => {
  it("renders directory + My Groups rows with the profile anchor", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProfileGroupsCardContent membershipCount={2} pendingRequests={3} loading={false} />
      </MemoryRouter>,
    );
    expect(html).toContain('data-tour-target="profile-my-groups"');
    expect(html).toContain("Browse the public directory");
    expect(html).toContain("My Groups");
    expect(html).toContain('href="/groups"');
    expect(html).toContain('href="/my-groups"');
    expect(html).toContain("2 memberships");
    expect(html).toContain("3 pending");
  });

  it("hides counts when there is nothing to show but keeps the rows", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProfileGroupsCardContent membershipCount={0} pendingRequests={0} loading={false} />
      </MemoryRouter>,
    );
    expect(html).toContain("Browse the public directory");
    // The count chips (which end in `memberships</span>` / `pending</span>`) are absent.
    expect(html).not.toContain("memberships</span>");
    expect(html).not.toContain("pending</span>");
  });

  it("shows a loading placeholder instead of counts while fetching", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProfileGroupsCardContent membershipCount={null} pendingRequests={0} loading />
      </MemoryRouter>,
    );
    expect(html).toContain("My Groups");
    expect(html).not.toContain("memberships</span>");
    expect(html).not.toContain("pending</span>");
  });
});

describe("tour step definitions (routes & targets)", () => {
  it("defines seven steps ending in the Settings step", () => {
    expect(TOUR_STEPS).toHaveLength(7);
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      "welcome",
      "events",
      "forum",
      "my-runs",
      "groups",
      "profile",
      "settings",
    ]);
  });

  it("points the profile step at profile-my-groups and the settings step at settings-main on /settings", () => {
    const profile = TOUR_STEPS.find((s) => s.id === "profile");
    const settings = TOUR_STEPS.find((s) => s.id === "settings");
    expect(profile?.target).toContain("data-tour-target='profile-my-groups'");
    expect(settings?.route).toBe("/settings");
    expect(settings?.target).toContain("data-tour-target='settings-main'");
  });

  it("bumped the storage key to v2 so v1 viewers get the new tour", () => {
    expect(TOUR_STORAGE_KEY).toBe("runlocal:tour:verified:v2");
  });

  it("the SettingsPage header carries the settings-main target the step points at", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/SettingsPage.tsx"), "utf8");
    expect(source).toContain('data-tour-target="settings-main"');
  });
});
