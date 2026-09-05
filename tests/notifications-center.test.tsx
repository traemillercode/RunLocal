/**
 * UI-level tests for the notification center (/notifications).
 *
 * The center body (`NotificationsCenter`) renders notification rows as links and
 * calls useNavigate, so it must be rendered inside a Router. The real
 * markup is rendered with react-dom/server against props — no providers, no
 * effects. The page-level guest gate is tested through `NotificationsPage`
 * with `useAccount` / `useNotifications` mocked.
 *
 * Honesty contract: the empty state never invents notification events — it
 * describes the one category that actually produces notifications today
 * (Community updates) as an opt-in, and the list renders only server data.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { NotificationsCenter, NotificationsPage } from "../src/pages/NotificationsPage";
import type { InAppNotification } from "../src/lib/api";
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
    roles: patch.roles ?? ["runner"],
  };
}

function notification(id: string, readAt: string | null = null): InAppNotification {
  return {
    id,
    category: "community_updates",
    title: `Discussion activity ${id}`,
    body: `Someone added to run ${id}.`,
    createdAt: "2026-08-01T12:00:00.000Z",
    readAt,
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
    dismiss: async () => {},
    clearRead: async () => {},
    ...patch,
  };
}

const noop = () => {};

describe("notification center body (UI)", () => {
  it("renders the empty state with honest opt-in copy, not invented events", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationsCenter notifications={[]} unreadCount={0} loading={false} error={null} onRefresh={noop} onMarkRead={noop} onMarkAllRead={noop} onDismiss={noop} onClearRead={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain("No notifications yet");
    // The copy describes the real producer (Community updates) as an opt-in.
    expect(html).toContain("Community updates");
    expect(html).toContain("will appear here");
    // No fabricated rows.
    expect(html).not.toContain("Discussion activity");
    // Nothing claims background push or email delivery.
    expect(html).not.toContain("push");
    expect(html).not.toContain("email");
  });

  it("renders real notification rows with read state and timestamps", () => {
    const items = [notification("one", null), notification("two", "2026-08-02T00:00:00.000Z")];
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationsCenter notifications={items} unreadCount={1} loading={false} error={null} onRefresh={noop} onMarkRead={noop} onMarkAllRead={noop} onDismiss={noop} onClearRead={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain("Discussion activity one");
    expect(html).toContain("Discussion activity two");
    expect(html).toContain("Someone added to run one.");
    // Unread rows are highlighted; the row announces its read state.
    expect(html).toContain("bg-orange-50/70");
    expect(html).toContain('aria-label="Discussion activity one (unread)"');
    expect(html).toContain('aria-label="Discussion activity two (read)"');
    // Timestamps render for both rows (locale-independent marker check).
    expect((html.match(/aria-label=/g) ?? []).length).toBeGreaterThanOrEqual(2);
    /*
     * Counts the TIMESTAMP class, not every use of text-[11px]. The old
     * assertion counted the size alone as a proxy for "a timestamp", and the
     * "Earlier" divider — which is also 11px — made it three. A proxy that
     * matches anything sharing a font size breaks the moment anything else on
     * the page is that size, which says nothing about timestamps.
     */
    expect((html.match(/text-\[11px\] text-slate-400/g) ?? []).length).toBe(2);
  });

  it("disables Mark all read when nothing is unread", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationsCenter notifications={[notification("one", "2026-08-02T00:00:00.000Z")]} unreadCount={0} loading={false} error={null} onRefresh={noop} onMarkRead={noop} onMarkAllRead={noop} onDismiss={noop} onClearRead={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain("Mark all read");
    expect(html).toContain("disabled");
  });

  it("shows a loading state before the first fetch resolves", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationsCenter notifications={[]} unreadCount={0} loading error={null} onRefresh={noop} onMarkRead={noop} onMarkAllRead={noop} onDismiss={noop} onClearRead={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain("Loading notifications…");
    expect(html).not.toContain("No notifications yet");
  });
});

describe("notification center page gate (UI)", () => {
  it("signs out / guests get a sign-in prompt and no notification data", () => {
    useAccountMock.mockReturnValue({
      me: { status: "guest" } satisfies Me,
      backendAvailable: true,
      refresh: async () => {},
      signOut: async () => {},
      deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }),
      role: "guest",
    });
    useNotificationsMock.mockReturnValue(notificationsState({ unreadCount: 3, notifications: [notification("leak")] }));
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Sign in to see your private notifications");
    expect(html).toContain('href="/login"');
    // Private rows never render for guests even if a fetch returned data.
    expect(html).not.toContain("Discussion activity leak");
    expect(html).not.toContain("Mark all read");
  });

  it("renders the center for any signed-in account (pending included)", () => {
    useAccountMock.mockReturnValue({
      me: { status: "signed_in", account: verifiedAccount({ status: "pending", phase: "pending_review", badge: null }) } satisfies Me,
      backendAvailable: true,
      refresh: async () => {},
      signOut: async () => {},
      deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }),
      role: "pending",
    });
    useNotificationsMock.mockReturnValue(notificationsState({ unreadCount: 1, notifications: [notification("mine")] }));
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>,
    );
    expect(html).toContain("Discussion activity mine");
    expect(html).toContain("Mark all read");
    expect(html).toContain("Only you can see these");
  });
});
