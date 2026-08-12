/**
 * UI-level tests for the notifications bell in the mobile header and the
 * desktop sidebar.
 *
 * Rendered with react-dom/server (no DOM / jsdom needed) against the REAL
 * component markup. Both `useAccount` and `useNotifications` are mocked
 * (hoisted); react-router-dom stays real inside a MemoryRouter.
 *
 * Privacy boundary: the bell renders nothing for guests / unauthenticated
 * visitors — no private unread counts or controls are ever in the header for
 * them. The unread badge appears only when the server reports unread items,
 * and the accessible label carries the count.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Header } from "../src/components/Header";
import { DesktopSidebar } from "../src/components/DesktopSidebar";
import { CITIES } from "../src/data/cities";
import type { Me, PublicAccount } from "../src/lib/accounts";
import type { NotificationsState } from "../src/state/notifications";

const { useAccountMock, useNotificationsMock } = vi.hoisted(() => ({
  useAccountMock: vi.fn(),
  useNotificationsMock: vi.fn(),
}));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));
vi.mock("../src/state/notifications", () => ({ useNotifications: useNotificationsMock }));

function verifiedAccount(patch: Partial<PublicAccount> = {}): PublicAccount {
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

function notificationsState(patch: Partial<NotificationsState> = {}): NotificationsState {
  return {
    notifications: [],
    unreadCount: null,
    loading: false,
    error: null,
    refresh: async () => {},
    markRead: async () => {},
    markAllRead: async () => {},
    ...patch,
  };
}

function auth(me: Me) {
  useAccountMock.mockReturnValue({
    me,
    backendAvailable: true,
    refresh: async () => {},
    signOut: async () => {},
    deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }),
    role: me.status === "signed_in" ? (me.account.status === "verified" ? "verified" : "pending") : "guest",
  });
}

const noop = () => {};
const city = CITIES[0];

describe("notifications bell — mobile header", () => {
  it("renders nothing for guests (no private data or controls)", () => {
    auth({ status: "guest" });
    useNotificationsMock.mockReturnValue(notificationsState({ unreadCount: 3 }));
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Header city={city} onOpenCitySheet={noop} />
      </MemoryRouter>,
    );
    expect(html).not.toContain('href="/notifications"');
    expect(html).not.toContain("Notifications —");
  });

  it("links signed-in users to the notification center with an unread badge", () => {
    auth({ status: "signed_in", account: verifiedAccount() });
    useNotificationsMock.mockReturnValue(notificationsState({ unreadCount: 3 }));
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Header city={city} onOpenCitySheet={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain('href="/notifications"');
    expect(html).toContain('aria-label="Notifications — 3 unread"');
    // The visible badge carries the count (aria-hidden — the link label says it).
    expect(html).toContain(">3<");
    // 44px touch target.
    expect(html).toContain("h-11");
  });

  it("shows no badge when there are no unread notifications", () => {
    auth({ status: "signed_in", account: verifiedAccount() });
    useNotificationsMock.mockReturnValue(notificationsState({ unreadCount: 0 }));
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Header city={city} onOpenCitySheet={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain('href="/notifications"');
    expect(html).toContain('aria-label="Notifications"');
    expect(html).not.toContain("unread");
    expect(html).not.toContain(">0<");
  });

  it("caps the badge at 9+ for large unread counts", () => {
    auth({ status: "signed_in", account: verifiedAccount() });
    useNotificationsMock.mockReturnValue(notificationsState({ unreadCount: 42 }));
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Header city={city} onOpenCitySheet={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain(">9+<");
    expect(html).toContain('aria-label="Notifications — 42 unread"');
  });
});

describe("notifications bell — desktop sidebar", () => {
  it("shows a Notifications row with unread badge for signed-in users", () => {
    auth({ status: "signed_in", account: verifiedAccount() });
    useNotificationsMock.mockReturnValue(notificationsState({ unreadCount: 2 }));
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DesktopSidebar city={city} onOpenCitySheet={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain('href="/notifications"');
    expect(html).toContain("Notifications");
    expect(html).toContain('aria-label="Notifications — 2 unread"');
    expect(html).toContain(">2<");
  });

  it("hides the row entirely for guests", () => {
    auth({ status: "guest" });
    useNotificationsMock.mockReturnValue(notificationsState({ unreadCount: 2 }));
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DesktopSidebar city={city} onOpenCitySheet={noop} />
      </MemoryRouter>,
    );
    expect(html).not.toContain('href="/notifications"');
    expect(html).not.toContain("Notifications");
  });
});
