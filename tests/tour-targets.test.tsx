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
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "../src/components/BottomNav";
import { DesktopSidebar } from "../src/components/DesktopSidebar";
import { Header } from "../src/components/Header";
import { HomeRightRail } from "../src/components/HomeRightRail";
import { ProfileGroupsCardContent } from "../src/pages/ProfilePage";
import { CITIES } from "../src/data/cities";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
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
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <BottomNav />
      </MemoryRouter>,
    );
    expect(html).toContain('data-tour-target="bottom-nav"');
    // Five-tab nav is untouched: Events, Races, Forum, Profile, My Runs.
    const tabs = ["Events", "Races", "Forum", "Profile", "My Runs"];
    for (const t of tabs) expect(html).toContain(t);
    expect(html).toContain("grid-cols-5");
    expect(html).not.toContain("Groups");
  });

  it("DesktopSidebar exposes the Groups & Clubs directory link with the nav anchor", () => {
    mockVerifiedSession();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DesktopSidebar city={city} onOpenCitySheet={() => {}} />
      </MemoryRouter>,
    );
    expect(html).toContain('data-tour-target="desktop-nav"');
    // react-dom/server escapes the ampersand in text nodes.
    expect(html).toContain("Groups &amp; Clubs");
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
