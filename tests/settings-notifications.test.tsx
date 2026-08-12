/**
 * UI-level tests for the consolidated Notifications section in Settings.
 *
 * The section (`NotificationPreferencesSection`) is presentational, so the
 * real markup is rendered with react-dom/server against props inside a
 * MemoryRouter (it links to /notifications).
 *
 * Covers the deduplication contract: ONE coherent section for notification
 * preferences — category toggles (each honestly labeled Active vs Coming
 * soon), browser permission, and a link to the private notification center.
 * The old inbox list no longer renders in Settings (it lives in the center),
 * so there is no "Mark all read" here.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { NotificationPreferencesSection } from "../src/pages/SettingsPage";
import type { NotificationPreferences } from "../src/lib/api";

const noop = () => {};

function prefs(patch: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return { run_reminders: false, community_updates: false, account_alerts: false, ...patch };
}

function render(patch: {
  prefs?: NotificationPreferences;
  unreadCount?: number | null;
  browserPermission?: NotificationPermission | "unsupported";
  error?: string | null;
} = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <NotificationPreferencesSection
        prefs={patch.prefs ?? prefs()}
        unreadCount={patch.unreadCount ?? 0}
        browserPermission={patch.browserPermission ?? "default"}
        error={patch.error ?? null}
        onToggle={noop}
        onAllowBrowser={noop}
      />
    </MemoryRouter>,
  );
}

describe("Settings notification preferences (one coherent section)", () => {
  it("renders all three categories with the real toggle behavior", () => {
    const html = render({ prefs: prefs({ community_updates: true }) });
    expect(html).toContain("Community updates");
    expect(html).toContain("Run reminders");
    expect(html).toContain("Account alerts");
    // Community updates is toggled on and announced as such (switch semantics).
    expect(html).toContain('aria-label="Community updates on"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('role="switch"');
  });

  it("labels only Community updates as active today", () => {
    const html = render();
    expect(html).toContain("Community updates");
    expect(html).toContain("Active");
    // The categories with no producer are clearly "Coming soon", never "Active".
    expect(html).toContain("Run reminders");
    expect(html).toContain("Account alerts");
    expect((html.match(/Coming soon/g) ?? []).length).toBe(2);
    expect((html.match(/>Active</g) ?? []).length).toBe(1);
  });

  it("links to the private notification center with the unread count", () => {
    const html = render({ unreadCount: 5 });
    expect(html).toContain('href="/notifications"');
    expect(html).toContain("In-app notifications");
    expect(html).toContain("5 unread");
  });

  it("says None unread when the inbox is empty", () => {
    const html = render({ unreadCount: 0 });
    expect(html).toContain("None unread");
  });

  it("keeps honest browser-permission copy and never claims background push", () => {
    const html = render({ browserPermission: "granted" });
    expect(html).toContain("Allowed for foreground notices only");
    expect(html).toContain("does not claim background push");
    const denied = render({ browserPermission: "denied" });
    expect(denied).toContain("Notifications are blocked in your browser settings");
    const unsupported = render({ browserPermission: "unsupported" });
    expect(unsupported).toContain("This browser does not support notifications");
  });

  it("offers the browser permission button only while permission is unset", () => {
    const html = render({ browserPermission: "default" });
    expect(html).toContain("Allow browser notifications");
    const granted = render({ browserPermission: "granted" });
    expect(granted).not.toContain("Allow browser notifications");
  });

  it("no longer renders the inbox list in Settings (deduplicated into the center)", () => {
    const html = render({ unreadCount: 2 });
    expect(html).not.toContain("Mark all read");
    expect(html).not.toContain("bg-orange-50");
    expect(html).not.toContain("Discussion activity");
  });

  it("surfaces a preference save error without hiding the controls", () => {
    const html = render({ error: "Couldn’t save notification preference. Try again." });
    expect(html).toContain("Couldn’t save notification preference");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Community updates");
  });
});
