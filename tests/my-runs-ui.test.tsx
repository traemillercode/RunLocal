import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "../src/components/BottomNav";
import { MyRunsPage } from "../src/pages/MyRunsPage";
import type { Me, PublicAccount } from "../src/lib/accounts";

const { useAccountMock, getMyRunsMock } = vi.hoisted(() => ({ useAccountMock: vi.fn(), getMyRunsMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));
vi.mock("../src/lib/api", async () => { const actual = await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api"); return { ...actual, getMyRuns: getMyRunsMock }; });

const account: PublicAccount = { id: "a1", name: "Runner", email: "runner@example.com", username: "runner", cityId: "columbia-mo", status: "verified", phase: null, badge: "verified", role: "runner", isOwner: false, suspended: false, underReview: false, profilePhotoUrl: null };
const auth = (me: Me | null) => useAccountMock.mockReturnValue({ me, backendAvailable: true, refresh: async () => {}, signOut: async () => {}, deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }), role: me?.status === "signed_in" ? "verified" : "guest" });
const render = () => renderToStaticMarkup(<MemoryRouter><MyRunsPage /></MemoryRouter>);

describe("My Runs SSR UI", () => {
  it("prompts guests to sign in and links to login", () => { auth({ status: "guest" }); const html = render(); expect(html).toContain("Sign in to see your private RSVP list."); expect(html).toContain('href="/login"'); });
  it("renders the signed-in loading state without exposing public-sharing language", () => { auth({ status: "signed_in", account }); getMyRunsMock.mockReturnValue(new Promise(() => {})); const html = render(); expect(html).toContain("Loading your RSVPs"); expect(html).toContain("My Runs"); expect(html).toContain("Private"); expect(html).not.toContain("Share"); });
  it("keeps empty, error, upcoming ordering, and remove-RSVP copy in the SSR page contract", async () => { const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/pages/MyRunsPage.tsx", import.meta.url), "utf8")); expect(source).toContain("No RSVPs yet"); expect(source).toContain("We couldn't load your runs."); expect(source).toContain("Upcoming"); expect(source).toContain("Remove RSVP for"); expect(source).toContain("Only you can see it."); expect(source).toContain("runs.map"); });
  it("shows My Runs in primary navigation with the dedicated route", () => { const html = renderToStaticMarkup(<MemoryRouter><BottomNav /></MemoryRouter>); expect(html).toContain('href="/my-runs"'); expect(html).toContain("My Runs"); });
  it("renders only one desktop My Runs navigation entry", async () => {
    const { DesktopSidebar } = await import("../src/components/DesktopSidebar");
    const html = renderToStaticMarkup(<MemoryRouter><DesktopSidebar city={{ id: "columbia-mo", name: "Columbia", state: "MO", live: true, tagline: "", groups: [], events: [], races: [], forum: [] }} onOpenCitySheet={() => {}} /></MemoryRouter>);
    expect((html.match(/>My Runs</g) ?? []).length).toBe(1);
  });

  it("keeps upcoming agenda cards linked while past cards remain historical", async () => {
    const { Agenda } = await import("../src/pages/MyRunsPage");
    const base = { cityId: "columbia-mo", time: "8:00 AM", location: "Downtown", groupId: "g1", rsvpedAt: "2026-01-01T00:00:00Z" };
    const html = renderToStaticMarkup(<MemoryRouter><Agenda upcoming={[{ ...base, id: "up", eventId: "event-up", title: "Upcoming run", date: "2099-01-01" }]} past={[{ ...base, id: "past", eventId: "event-past", title: "Past run", date: "2020-01-01" }]} onRemove={() => {}} /></MemoryRouter>);
    expect(html).toContain('href="/events/event-up"');
    expect(html).not.toContain('href="/events/event-past"');
    expect(html).toContain("This RSVP is preserved in your history");
  });

  it("renders event details and run-day discussion as separate links", async () => {
    const { Agenda } = await import("../src/pages/MyRunsPage");
    const run = { cityId: "columbia-mo", time: "8:00 AM", location: "Downtown", groupId: "g1", rsvpedAt: "2026-01-01T00:00:00Z", id: "up", eventId: "event-up", title: "Upcoming run", date: "2099-01-01", occurrenceId: "occ-1" };
    const html = renderToStaticMarkup(<MemoryRouter><Agenda upcoming={[run]} past={[]} onRemove={() => {}} /></MemoryRouter>);
    expect(html).toMatch(/<a[^>]*href="\/events\/event-up"/);
    expect(html).toMatch(/<a[^>]*href="\/events\/event-up\?discussion=occ-1"/);
    expect(html).toMatch(/<\/a><a[^>]*href="\/events\/event-up\?discussion=occ-1"/);
    const detailAnchor = html.match(/<a[^>]*href="\/events\/event-up"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
    expect(detailAnchor.slice(detailAnchor.indexOf(">") + 1)).not.toContain("<a");
  });
});

