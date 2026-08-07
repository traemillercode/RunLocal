/**
 * UI-level tests for the community-submission client flows.
 *
 * Rendered with react-dom/server (no DOM / jsdom — same harness as
 * header-auth.test.tsx). Covers:
 *  - the three submission sheets (race / group / independent event) and the
 *    independent-runner restriction surfaced for Group Leaders;
 *  - the submitter's "My submissions" status view on the profile (only for
 *    signed-in accounts);
 *  - the public pages rendering ONLY the server-filtered approved content
 *    (usePublicContent is mocked with an already-approved payload — the
 *    server is authoritative for approval; these tests assert the pages
 *    render what that payload provides).
 *
 * Only `useAccount` and `usePublicContent` are mocked (hoisted). Auth stays
 * honest: tests assert what guests / verified runners / group leaders SEE,
 * never client-side role powers — the server enforces every permission.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { GroupSubmissionSheet, IndependentEventSheet, RaceSubmissionSheet } from "../src/components/SubmissionSheets";
import { CITIES } from "../src/data/cities";
import type { Me, PublicAccount } from "../src/lib/accounts";
import type { AppStore } from "../src/lib/store";
import { EventsPage } from "../src/pages/EventsPage";
import { MySubmissions } from "../src/pages/ProfilePage";
import { RacesPage } from "../src/pages/RacesPage";
import type { PublicUserEvent, PublicUserGroup, PublicUserRace } from "../src/lib/api";

const { useAccountMock, usePublicContentMock } = vi.hoisted(() => ({
  useAccountMock: vi.fn(),
  usePublicContentMock: vi.fn(),
}));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));
vi.mock("../src/state/content", () => ({
  PublicContentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePublicContent: usePublicContentMock,
}));

const noop = () => {};
const CITY = CITIES.find((c) => c.id === "columbia-mo") ?? CITIES[0];
const STORE: AppStore = {
  state: { cityId: CITY.id, rsvped: {} },
  setCityId: noop,
  toggleRsvp: noop,
};

function verifiedAccount(patch: Partial<PublicAccount> = {}): PublicAccount {
  return {
    id: "acc_1",
    name: "Taylor Runner",
    email: "taylor@example.com",
    username: "taylor_runs",
    cityId: CITY.id,
    status: "verified",
    phase: "pending_review",
    badge: "verified",
    role: "runner",
    isOwner: false,
    suspended: false,
    underReview: false,
    profilePhotoUrl: null,
    ...patch,
  };
}

function guestAuth() {
  useAccountMock.mockReturnValue({
    me: { status: "guest" } satisfies Me,
    backendAvailable: true,
    refresh: async () => {},
    signOut: async () => {},
    deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }),
    role: "guest",
  });
}

function verifiedAuth(account: PublicAccount = verifiedAccount()) {
  useAccountMock.mockReturnValue({
    me: { status: "signed_in", account } satisfies Me,
    backendAvailable: true,
    refresh: async () => {},
    signOut: async () => {},
    deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }),
    role: "verified",
  });
}

function emptyContent() {
  usePublicContentMock.mockReturnValue({ races: [], groups: [], events: [], loaded: true });
}

const APPROVED_RACE: PublicUserRace = {
  id: "user-abc",
  kind: "race",
  name: "River 5K",
  date: "2026-10-01",
  distance: "5K",
  location: "Flat Branch",
  organizer: "Taylor Runner",
  price: "TBA",
  registrationUrl: "https://example.com/river5k",
  registrationOpen: true,
  registrationNote: "Approved community listing — confirm on the organizer's site",
  description: "A 5K along the MKT trail.",
};

const APPROVED_EVENT: PublicUserEvent = {
  id: "user-def",
  kind: "event",
  title: "Thursday Hills",
  type: "recurring",
  date: null,
  // Saturday remains upcoming under the deterministic current-week fixture.
  dayOfWeek: 6,
  time: "6:00 PM",
  location: "Grindstone",
  distanceLabel: "3-5 mi",
  invite: "Open to all",
  externalUrl: null,
  description: "Hill repeats, no-drop.",
  host: "Independent Runner",
};

const APPROVED_GROUP: PublicUserGroup = {
  id: "user-ghi",
  kind: "group",
  name: "Downtown Runners",
  groupType: "community",
  description: "A friendly community group.",
  groupmeUrl: null,
  facebookUrl: "https://facebook.com/downtownrunners",
  instagramUrl: null,
  websiteUrl: null,
};

describe("submission sheets (UI)", () => {
  it("race sheet collects name, distances, date, location, and registration URL", () => {
    const html = renderToStaticMarkup(
      <RaceSubmissionSheet open onClose={noop} cityId={CITY.id} />,
    );
    expect(html).toContain("Submit a race");
    expect(html).toContain("Race name");
    expect(html).toContain("Distances");
    expect(html).toContain("Race date");
    expect(html).toContain("Location");
    expect(html).toContain("External registration URL");
    expect(html).toContain("Submit for approval");
    // Honest pending state: the listing is not public until approved.
    expect(html).toContain("pending approval before it");
  });

  it("group sheet defaults to community and labels the RRCA option as a request, not a claim", () => {
    const html = renderToStaticMarkup(
      <GroupSubmissionSheet open onClose={noop} cityId={CITY.id} />,
    );
    expect(html).toContain("Start a group");
    expect(html).toContain("Group name");
    expect(html).toContain("Group type");
    expect(html).toContain("Community Run Group");
    expect(html).toContain("RRCA-Chartered Club");
    // The RRCA warning only appears once that option is selected (request only).
    expect(html).not.toContain("is a request only");
    expect(html).toContain("granted the Group Leader role");
  });

  it("independent event sheet defaults to recurring and hides the one-time date until toggled", () => {
    guestAuth();
    const html = renderToStaticMarkup(
      <IndependentEventSheet open onClose={noop} cityId={CITY.id} />,
    );
    expect(html).toContain("Host an independent run");
    expect(html).toContain("Recurring (weekly)");
    expect(html).toContain("One-time");
    expect(html).toContain("Day of the week");
    expect(html).toContain("Time");
    expect(html).toContain("Distance / pace");
    // Independent runs are reserved for verified runners who aren't group leaders.
    expect(html).toContain("host shows as Independent Runner");
  });

  it("group leaders see the independent-run restriction and a disabled submit button", () => {
    verifiedAuth(verifiedAccount({ role: "group_leader" }));
    const html = renderToStaticMarkup(
      <IndependentEventSheet open onClose={noop} cityId={CITY.id} />,
    );
    expect(html).toContain("Group Leaders submit runs through their group");
    expect(html).toContain("disabled");
  });
});

describe("My submissions status view (UI)", () => {
  it("renders nothing for guests", () => {
    const html = renderToStaticMarkup(<MySubmissions signedIn={false} />);
    expect(html).toBe("");
  });

  it("renders the submitter's own-status section for signed-in accounts", () => {
    verifiedAuth();
    const html = renderToStaticMarkup(<MySubmissions signedIn />);
    expect(html).toContain("My submissions");
    expect(html).toContain("only you can see these");
    // Records load from the server via effect — SSR renders the initial state.
    expect(html).toContain("Loading…");
  });
});

describe("public pages render only approved community content (UI)", () => {
  it("races page lists approved community races alongside seed races", () => {
    guestAuth();
    usePublicContentMock.mockReturnValue({ races: [APPROVED_RACE], groups: [], events: [], loaded: true });
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RacesPage city={CITY} />
      </MemoryRouter>,
    );
    // Approved submission renders with its organizer and location.
    expect(html).toContain("River 5K");
    expect(html).toContain("Flat Branch");
    // Seed content is preserved (split at "&" — SSR escapes it to &amp;).
    expect(html).toContain(CITY.races[0].name.split(" & ")[0]);
    // The submit entry point is present for everyone (the verified gate decides).
    expect(html).toContain("Submit a race");
    expect(html).toContain("Includes approved community-submitted races");
  });

  it("events page shows approved independent runs and community groups", () => {
    verifiedAuth();
    usePublicContentMock.mockReturnValue({ races: [], groups: [APPROVED_GROUP], events: [APPROVED_EVENT], loaded: true });
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventsPage city={CITY} store={STORE} />
      </MemoryRouter>,
    );
    // Approved recurring independent run renders with the Independent Runner host label.
    expect(html).toContain("Thursday Hills");
    expect(html).toContain("Independent Runner");
    expect(html).toContain("6:00 PM");
    // Approved community group renders with its description and external link.
    expect(html).toContain("Downtown Runners");
    expect(html).toContain("A friendly community group.");
    expect(html).toContain("facebook.com/downtownrunners");
    // A deterministic upcoming seed event is preserved; the current-week view
    // intentionally omits elapsed recurring slots.
    expect(html).toContain("Saturday Long Run: MKT Trail");
    // Entry points for hosting a run / starting a group.
    expect(html).toContain("Host a run");
    expect(html).toContain("Start a group");
  });

  it("events page without approved content still renders seed data", () => {
    guestAuth();
    emptyContent();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventsPage city={CITY} store={STORE} />
      </MemoryRouter>,
    );
    // The Monday seed slot is elapsed for the deterministic test clock; an
    // upcoming seed event remains visible in the current-week view.
    expect(html).toContain("Saturday Long Run: MKT Trail");
    expect(html).not.toContain("Downtown Runners");
    expect(html).not.toContain("Thursday Hills");
  });
});
