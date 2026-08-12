/**
 * SSR tests for the Group Lead / admin event moderation UI (react-dom/server,
 * no jsdom — same pattern as tests/forum-moderation-menu.test.tsx).
 *
 * The server (GET /api/events, merged in #116) computes per-event moderation
 * capabilities for the requesting account — group leads of the event's group
 * and in-scope admins get ["hide","restore","delete"], everyone else gets [].
 * The client renders the shared ActionMenu ONLY from that server list and maps
 * each key to the ModerationConfirmSheet (hide/delete variant A reason-required,
 * restore variant B) before PATCH /api/events/:id/moderation. Empty or absent
 * capability lists render no trigger at all — guests/unverified/out-of-scope
 * actors see nothing.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { EventFeedRow, EventsPage, eventConfirmMeta } from "../src/pages/EventsPage";
import { EventDetailView } from "../src/pages/EventDetailPage";
import { ModerationConfirmSheet } from "../src/components/ModerationConfirmSheet";
import { canonicalEventActions } from "../src/lib/dates";
import { CITIES } from "../src/data/cities";
import type { AccountRole, Me, PublicAccount } from "../src/lib/accounts";
import type { DatedRunEvent } from "../src/lib/dates";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));
const { useSelectedCityMock } = vi.hoisted(() => ({ useSelectedCityMock: vi.fn() }));
vi.mock("../src/state/city", () => ({ useSelectedCity: useSelectedCityMock }));

const city = CITIES[0];
const noop = () => {};
const GROUP_RUN: DatedRunEvent = {
  id: "mon-social",
  groupId: "runcomo",
  title: "Monday Evening Social Run",
  dayOfWeek: 0,
  time: "6:00 PM",
  location: "Flat Branch Park — south shelter",
  distanceLabel: "3-5 mi, no-drop pace",
  invite: "Open to all",
  externalUrl: "https://www.facebook.com/runcomo/",
  date: new Date(2026, 7, 3),
  isToday: false,
  dayAbbrev: "Mon",
};
const INDEPENDENT_RUN: DatedRunEvent = { ...GROUP_RUN, id: "user-7", groupId: "", title: "Saturday Long Run" };
const LEAD_CAPS = ["hide", "restore", "delete"];

function auth(accountValue: PublicAccount | null, role: AccountRole) {
  const me: Me = accountValue ? { status: "signed_in", account: accountValue } : { status: "guest" };
  useAccountMock.mockReturnValue({
    me,
    backendAvailable: true,
    refresh: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    deleteMyAccount: vi.fn(async () => ({ ok: false, error: new Error("unavailable") })),
    role,
  });
}
function selectedCity() {
  useSelectedCityMock.mockReturnValue({
    city,
    cityId: city.id,
    signedIn: true,
    hasHomeCity: true,
    selectCity: vi.fn(async () => ({ ok: true })),
  });
}

describe("EventFeedRow — moderation action menu per capability list", () => {
  it("group lead (hide/restore/delete) gets an accessible menu trigger on a group-run card", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventFeedRow event={GROUP_RUN} city={city} rsvped={false} canRsvp onRsvp={noop} capabilities={LEAD_CAPS} onAction={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain('aria-label="Actions for Monday Evening Social Run"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('role="menu"'); // panel opens only on interaction (state)
  });
  it("guest (empty capability list) renders NO trigger on a group-run card", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventFeedRow event={GROUP_RUN} city={city} rsvped={false} canRsvp={false} onRsvp={noop} capabilities={[]} onAction={noop} />
      </MemoryRouter>,
    );
    expect(html).not.toContain("Actions for");
    expect(html).not.toContain('aria-haspopup="menu"');
  });
  it("lead on an independent run (capabilities []) renders NO trigger; an admin on the same row gets one", () => {
    // The SERVER never grants a group lead capabilities on a race/independent
    // event — the client renders whatever list it received, verbatim.
    const leadView = renderToStaticMarkup(
      <MemoryRouter>
        <EventFeedRow event={INDEPENDENT_RUN} city={city} rsvped={false} canRsvp onRsvp={noop} capabilities={[]} onAction={noop} />
      </MemoryRouter>,
    );
    expect(leadView).not.toContain("Actions for");
    expect(leadView).not.toContain('aria-haspopup="menu"');
    const adminView = renderToStaticMarkup(
      <MemoryRouter>
        <EventFeedRow event={INDEPENDENT_RUN} city={city} rsvped={false} canRsvp onRsvp={noop} capabilities={LEAD_CAPS} onAction={noop} />
      </MemoryRouter>,
    );
    expect(adminView).toContain('aria-label="Actions for Saturday Long Run"');
    expect(adminView).toContain('aria-haspopup="menu"');
  });
});

describe("EventDetailView — moderation action menu", () => {
  it("renders the menu trigger when capabilities are present", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventDetailView event={GROUP_RUN} city={city} rsvped={false} canRsvp onRsvp={noop} onBack={noop} capabilities={LEAD_CAPS} onAction={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain('aria-label="Actions for Monday Evening Social Run"');
    expect(html).toContain('aria-haspopup="menu"');
  });
  it("renders no trigger when capabilities are empty (guest / out-of-scope)", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventDetailView event={GROUP_RUN} city={city} rsvped={false} canRsvp={false} onRsvp={noop} onBack={noop} capabilities={[]} onAction={noop} />
      </MemoryRouter>,
    );
    expect(html).not.toContain("Actions for");
    expect(html).not.toContain('aria-haspopup="menu"');
  });
});

describe("event confirm mapping — hide/restore/delete", () => {
  it("hide and delete are variant A (reason-required, honest impact copy); restore is variant B", () => {
    const hide = eventConfirmMeta("hide", "Monday Evening Social Run");
    expect(hide.title).toBe("Hide this run?");
    expect(hide.requireReason).toBe(true);
    expect(hide.confirmLabel).toBe("Hide run");
    expect(hide.impact).toContain("Members won't see it in the city schedule. You can restore it later.");

    const del = eventConfirmMeta("delete", "Monday Evening Social Run");
    expect(del.title).toBe("Delete this run?");
    expect(del.requireReason).toBe(true);
    expect(del.confirmLabel).toBe("Delete run");
    expect(del.impact).toContain("This can't be undone.");

    const restore = eventConfirmMeta("restore", "Monday Evening Social Run");
    expect(restore.title).toBe("Restore this run?");
    expect(restore.requireReason).toBe(false); // variant B — confirm-only, no reason prompt
    expect(restore.confirmLabel).toBe("Restore run");
    expect(restore.impact).toContain("visible in the city schedule again");
  });
  it("the confirm sheet renders the page's hide copy (variant A) when open", () => {
    const meta = eventConfirmMeta("hide", "Monday Evening Social Run");
    const html = renderToStaticMarkup(
      <ModerationConfirmSheet open onClose={noop} {...meta} onConfirm={noop} />,
    );
    expect(html).toContain("Hide this run?");
    expect(html).toContain("Monday Evening Social Run");
    // React SSR escapes the apostrophe (won't → won&#x27;t).
    expect(html).toContain("won&#x27;t see it in the city schedule. You can restore it later.");
    expect(html).toContain("Hide run");
    expect(html).toContain("<textarea");
  });
});

describe("canonicalEventActions — id-form index for rendered rows", () => {
  const rows = [
    {
      id: "canon-abc",
      seedRefId: "mon-social",
      groupId: "runcomo",
      title: "Monday Evening Social Run",
      dayOfWeek: 0,
      time: "6:00 PM",
      location: "Flat Branch Park",
      distanceLabel: "3-5 mi",
      invite: "Open to all" as const,
      externalUrl: null,
      status: "published" as const,
      hidden: false,
      archivedAt: null,
      capabilities: LEAD_CAPS,
    },
    {
      id: "event:user-7",
      seedRefId: null,
      groupId: "",
      title: "Saturday Long Run",
      dayOfWeek: 5,
      time: "8:00 AM",
      location: "Cosmo Park",
      distanceLabel: "6-10 mi",
      invite: "Open to all" as const,
      externalUrl: null,
      status: "published" as const,
      hidden: false,
      archivedAt: null,
      // capabilities deliberately omitted — old server responses must tolerate undefined as []
    },
  ];
  it("resolves the canonical id from every rendered id form and treats missing capabilities as []", () => {
    const map = canonicalEventActions(rows);
    // canonical id itself
    expect(map.get("canon-abc")?.id).toBe("canon-abc");
    expect(map.get("canon-abc")?.capabilities).toEqual(LEAD_CAPS);
    // seed id form (server-materialized seed copy was deduped out of rendering)
    expect(map.get("mon-social")?.id).toBe("canon-abc");
    expect(map.get("mon-social")?.capabilities).toEqual(LEAD_CAPS);
    // bare community refId (the /api/content copy renders; canonical is event:<refId>)
    expect(map.get("user-7")?.id).toBe("event:user-7");
    expect(map.get("user-7")?.capabilities).toEqual([]);
    expect(map.get("event:user-7")?.capabilities).toEqual([]);
    // rows without a server copy get no entry — no menu
    expect(map.get("missing")).toBeUndefined();
  });
});

describe("EventsPage — full page", () => {
  it("guest renders no moderation action menu anywhere on the feed", () => {
    auth(null, "guest");
    selectedCity();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventsPage city={city} store={{} as never} />
      </MemoryRouter>,
    );
    expect(html).not.toContain("Actions for");
    expect(html).not.toContain('aria-haspopup="menu"');
  });
});
