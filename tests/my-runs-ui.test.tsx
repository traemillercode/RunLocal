import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "../src/components/BottomNav";
import { MyRunsPage } from "../src/pages/MyRunsPage";
import type { Me, PublicAccount } from "../src/lib/accounts";
import type { MyRunView } from "../src/lib/api";
import { groupRunsByMonth, monthKey, orderMyRuns } from "../src/lib/myRuns";

const { useAccountMock, getMyRunsMock } = vi.hoisted(() => ({ useAccountMock: vi.fn(), getMyRunsMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));
vi.mock("../src/lib/api", async () => { const actual = await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api"); return { ...actual, getMyRuns: getMyRunsMock }; });

const account: PublicAccount = { id: "a1", name: "Runner", email: "runner@example.com", username: "runner", cityId: "columbia-mo", status: "verified", phase: null, badge: "verified", role: "runner", roles: ["runner"], isOwner: false, suspended: false, underReview: false, profilePhotoUrl: null };
const auth = (me: Me | null) => useAccountMock.mockReturnValue({ me, backendAvailable: true, refresh: async () => {}, signOut: async () => {}, deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }), role: me?.status === "signed_in" ? "verified" : "guest" });
const render = () => renderToStaticMarkup(<MemoryRouter><MyRunsPage /></MemoryRouter>);
/** A complete MyRunView fixture (RSVP variant) with the fields the server sends. */
const rsvpRun = (over: Partial<MyRunView>): MyRunView => ({ id: "r1", kind: "rsvp", eventId: "mon-social", occurrenceId: "event:mon-social:2026-08-03", cityId: "columbia-mo", title: "Monday social run", date: "2026-08-03", time: "6:00 PM", location: "Downtown", groupId: "g1", rsvpedAt: "2026-01-01T00:00:00Z", distanceLabel: null, startsAt: "2026-08-03T18:00:00.000Z", upcoming: false, past: true, kept: false, checkedIn: false, ...over });

describe("My Runs SSR UI", () => {
  it("prompts guests to sign in and links to login", () => { auth({ status: "guest" }); const html = render(); expect(html).toContain("Sign in to see your private RSVP list."); expect(html).toContain('href="/login"'); });
  it("shows verification-required users a verify link", () => { auth({ status: "signed_in", account: { ...account, status: "pending" } }); const html = render(); expect(html).toContain("Email verification is required"); expect(html).toContain('href="/verify"'); });

  it("renders the signed-in loading state without exposing public-sharing language", () => { auth({ status: "signed_in", account }); getMyRunsMock.mockReturnValue(new Promise(() => {})); const html = render(); expect(html).toContain("Loading your RSVPs"); expect(html).toContain("My Runs"); expect(html).toContain("Private"); expect(html).not.toContain("Share"); });
  it("keeps empty, error, upcoming ordering, and remove-RSVP copy in the SSR page contract", async () => { const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/pages/MyRunsPage.tsx", import.meta.url), "utf8")); expect(source).toContain("No RSVPs yet"); expect(source).toContain("We couldn’t load your runs."); expect(source).toContain("Upcoming"); expect(source).toContain("Remove RSVP for"); expect(source).toContain("Only you can see it."); expect(source).toContain("runs.map"); });
  it("locks the explicit write-feedback contract: success toast, in-flight label, and inline remove errors", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/pages/MyRunsPage.tsx", import.meta.url), "utf8"));
    expect(source).toContain('RSVP removed for "'); // success toast
    expect(source).toContain("Removing…"); // in-flight label
    expect(source).toContain("Couldn't remove this RSVP"); // remove-error fallback
    expect(source).toContain('role="alert"'); // inline error is announced, not a page-level load error
    expect(source).toContain("runId"); // removal targets the exact attendance row
    expect(source).toContain("rsvpEvent(run.eventId, false, run.date, run.id)");
  });
  it("renders the remove button disabled with in-flight copy while removing", async () => {
    const { RunCard } = await import("../src/pages/MyRunsPage");
    const base = rsvpRun({ id: "up", title: "Upcoming run", date: "2099-01-01", upcoming: true, past: false });
    const removing = renderToStaticMarkup(<MemoryRouter><RunCard run={base} onRemove={() => {}} upcoming removing /></MemoryRouter>);
    expect(removing).toContain("Removing…");
    expect(removing).toContain("disabled");
    expect(removing).not.toContain(">Remove</button>");
    const idle = renderToStaticMarkup(<MemoryRouter><RunCard run={base} onRemove={() => {}} upcoming /></MemoryRouter>);
    expect(idle).toContain(">Remove</button>");
    expect(idle).not.toContain("disabled");
  });
  it("shows My Runs in primary navigation with the dedicated route", () => { const html = renderToStaticMarkup(<MemoryRouter><BottomNav /></MemoryRouter>); expect(html).toContain('href="/my-runs"'); expect(html).toContain("My Runs"); });
  it("renders only one desktop My Runs navigation entry", async () => {
    const { DesktopSidebar } = await import("../src/components/DesktopSidebar");
    const html = renderToStaticMarkup(<MemoryRouter><DesktopSidebar city={{ id: "columbia-mo", name: "Columbia", state: "MO", live: true, tagline: "", groups: [], events: [], races: [], forum: [] }} onOpenCitySheet={() => {}} /></MemoryRouter>);
    expect((html.match(/>My Runs</g) ?? []).length).toBe(1);
  });

  it("renders only upcoming runs in the calendar grid; past runs never appear", async () => {
    const { CalendarGrid } = await import("../src/pages/MyRunsPage");
    const now = new Date("2026-08-09T12:00:00Z");
    const html = renderToStaticMarkup(<MemoryRouter><CalendarGrid upcoming={[rsvpRun({ id: "up", title: "Upcoming run", date: "2026-08-10", occurrenceId: "occ-up", upcoming: true, past: false }), rsvpRun({ id: "past", title: "Past run", date: "2026-08-02", upcoming: false, past: true, checkedIn: true, kept: true })]} onRemove={() => {}} now={now} /></MemoryRouter>);
    expect(html).toContain('href="/events/mon-social"');
    expect(html).toContain("Upcoming run");
    expect(html).not.toContain("Past run");
    expect(html).not.toContain("This RSVP is preserved in your history");
  });

  it("renders event details and run-day discussion as separate links in the calendar day panel", async () => {
    const { CalendarGrid } = await import("../src/pages/MyRunsPage");
    const now = new Date("2026-08-09T12:00:00Z");
    const run = rsvpRun({ id: "up", title: "Upcoming run", date: "2026-08-10", occurrenceId: "occ-1", upcoming: true, past: false });
    const html = renderToStaticMarkup(<MemoryRouter><CalendarGrid upcoming={[run]} onRemove={() => {}} now={now} /></MemoryRouter>);
    expect(html).toMatch(/<a[^>]*href="\/events\/mon-social"/);
    expect(html).toMatch(/<a[^>]*href="\/events\/mon-social\?discussion=occ-1"/);
    expect(html).toMatch(/<\/a><a[^>]*href="\/events\/mon-social\?discussion=occ-1"/);
    const detailAnchor = html.match(/<a[^>]*href="\/events\/mon-social"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
    expect(detailAnchor.slice(detailAnchor.indexOf(">") + 1)).not.toContain("<a");
  });

  it("renders a Keep on My Runs switch per row with checked state and accessible label", async () => {
    const { RunCard } = await import("../src/pages/MyRunsPage");
    const kept = renderToStaticMarkup(<MemoryRouter><RunCard run={rsvpRun({ kept: true })} onRemove={() => {}} /></MemoryRouter>);
    expect(kept).toContain('role="switch"');
    expect(kept).toContain('aria-label="Keep Monday social run on My Runs"');
    expect(kept).toContain("Keep on My Runs");
    expect(kept).toMatch(/type="checkbox"[^>]*checked/);
    const notKept = renderToStaticMarkup(<MemoryRouter><RunCard run={rsvpRun({ kept: false })} onRemove={() => {}} /></MemoryRouter>);
    expect(notKept).toContain('role="switch"');
    expect(notKept).not.toMatch(/type="checkbox"[^>]*checked/);
    const keeping = renderToStaticMarkup(<MemoryRouter><RunCard run={rsvpRun({})} onRemove={() => {}} keeping /></MemoryRouter>);
    expect(keeping).toMatch(/role="switch"[^>]*disabled/);
  });

  it("renders solo runs as private cards: no event link, no Remove button, distance shown", async () => {
    const { RunCard } = await import("../src/pages/MyRunsPage");
    const solo = rsvpRun({ kind: "solo", id: "solo-1", eventId: "", occurrenceId: null, title: "Easy jog", distanceLabel: "3 miles", location: "Stephens Lake", kept: true });
    const html = renderToStaticMarkup(<MemoryRouter><RunCard run={solo} onRemove={() => {}} /></MemoryRouter>);
    expect(html).not.toContain('href="/events/');
    expect(html).not.toContain("Remove RSVP for");
    expect(html).not.toContain(">Remove</button>");
    expect(html).toContain("3 miles");
    expect(html).toContain("Keep on My Runs");
    expect(html).toContain("This solo run is preserved in your history");
    // Upcoming solo cards carry the private-only framing instead of event links.
    const upcomingSolo = renderToStaticMarkup(<MemoryRouter><RunCard run={{ ...solo, upcoming: true, past: false }} onRemove={() => {}} upcoming /></MemoryRouter>);
    expect(upcomingSolo).toContain("Nobody else sees it");
    expect(upcomingSolo).not.toContain("View run details");
  });

  it("shows a Checked in state on past RSVP cards that the runner attended", async () => {
    const { RunCard } = await import("../src/pages/MyRunsPage");
    const html = renderToStaticMarkup(<MemoryRouter><RunCard run={rsvpRun({ checkedIn: true })} onRemove={() => {}} /></MemoryRouter>);
    expect(html).toContain("Checked in");
    expect(html).toContain("This RSVP is preserved in your history");
  });

  it("groups past runs by month and renders the Past accordion collapsed by default", async () => {
    const { PastSection } = await import("../src/pages/MyRunsPage");
    const runs = [
      rsvpRun({ id: "jul-a", title: "July run", date: "2026-07-13", checkedIn: true }),
      rsvpRun({ id: "jul-b", title: "Another July run", date: "2026-07-06", kept: true }),
      rsvpRun({ id: "aug", title: "August run", date: "2026-08-03", checkedIn: true }),
    ];
    const html = renderToStaticMarkup(<MemoryRouter><PastSection runs={runs} onRemove={() => {}} onToggleKeep={() => {}} /></MemoryRouter>);
    // Month groups are native disclosures, collapsed (no open attribute).
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain('data-month="2026-08"');
    expect(html).toContain('data-month="2026-07"');
    expect(html.match(/<details/g)?.length).toBe(2);
    expect(html.match(/open=""/g) ?? []).toEqual([]);
    // Newest month first; run counts on each summary.
    expect(html.indexOf('data-month="2026-08"')).toBeLessThan(html.indexOf('data-month="2026-07"'));
    expect(html).toContain("2 runs");
    expect(html).toContain("1 run");
    // Cards live inside their month group.
    expect(html).toContain("July run");
    expect(html).toContain("August run");
  });

  it("orders and month-keys runs deterministically", () => {
    const now = Date.parse("2026-08-09T12:00:00Z");
    const up = rsvpRun({ id: "up", title: "Up", date: "2026-08-17", upcoming: true, past: false });
    const past = rsvpRun({ id: "p1", title: "Past", date: "2026-07-06" });
    const past2 = rsvpRun({ id: "p2", title: "Older", date: "2026-06-01" });
    const { upcoming, past: pastRuns } = orderMyRuns([up, past2, past], now);
    expect(upcoming.map((r) => r.id)).toEqual(["up"]);
    expect(pastRuns.map((r) => r.id)).toEqual(["p1", "p2"]); // newest first
    expect(monthKey("2026-07-06")).toBe("2026-07");
    const groups = groupRunsByMonth(pastRuns);
    expect(groups.map((g) => g.key)).toEqual(["2026-07", "2026-06"]);
    expect(groups[0].label).toContain("2026");
  });

  it("marks today's calendar day with aria-current, a Today state, and an auto-selected day panel", async () => {
    const { CalendarGrid } = await import("../src/pages/MyRunsPage");
    const now = new Date("2026-08-09T12:00:00Z");
    const html = renderToStaticMarkup(<MemoryRouter><CalendarGrid upcoming={[rsvpRun({ id: "today", title: "Today run", date: "2026-08-09", upcoming: true, past: false }), rsvpRun({ id: "other", title: "Later run", date: "2026-08-16", upcoming: true, past: false })]} onRemove={() => {}} now={now} /></MemoryRouter>);
    expect(html).toContain('aria-current="date"');
    expect(html).toContain("Today");
    // Only today's day cell carries the state — no other day is marked.
    expect((html.match(/aria-current="date"/g) ?? []).length).toBe(1);
    const todayCell = html.match(/<button[^>]*aria-current="date"[^>]*>/)?.[0] ?? "";
    expect(todayCell).toMatch(/, 1 run"/); // today has exactly one run in its aria-label
    expect(html).toContain('class="sr-only">Today'); // sr-only Today state inside the day cell
    // The day panel auto-selects today: today's run card is shown, the later day is not.
    expect(html).toContain("Today run");
    expect(html).not.toContain("Later run");
  });

  it("locks the calendar-view wiring: the grid gets only upcoming runs, plus the private ICS export link", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/pages/MyRunsPage.tsx", import.meta.url), "utf8"));
    const gridUsage = source.match(/<CalendarGrid[^>]*>/)?.[0] ?? "";
    expect(gridUsage).toContain("upcoming={sections.upcoming}");
    expect(gridUsage).not.toContain("past"); // past history never enters the grid
    // The private ICS export link carries the caller's browser offset so the
    // export's upcoming set matches the list view (see my-runs-eleventh tests).
    expect(source).toContain('href={`/api/my/runs/ical?tzOffsetMinutes=${new Date().getTimezoneOffset()}`}');
    expect(source).toContain('download="run-local-my-runs.ics"');
    expect(source).toContain("Upcoming runs only");
  });
  it("locks the keep-toggle wiring contract: server call, optimistic label, and error fallback", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/pages/MyRunsPage.tsx", import.meta.url), "utf8"));
    expect(source).toContain("keepMyRun(run.id, next)");
    expect(source).toContain('will stay on My Runs');
    expect(source).toContain("Couldn't update this run");
    expect(source).toContain("role=\"switch\"");
  });
});
