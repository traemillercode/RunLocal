import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { MyRunView } from "../src/lib/api";
import { WEEKDAY_LABELS, calendarGridDays, dayAriaLabel, defaultCalendarDay } from "../src/lib/calendar";

/** A complete MyRunView fixture (RSVP variant) with the fields the server sends. */
const rsvpRun = (over: Partial<MyRunView>): MyRunView => ({ id: "r1", kind: "rsvp", eventId: "mon-social", occurrenceId: "event:mon-social:2026-08-10", cityId: "columbia-mo", title: "Monday social run", date: "2026-08-10", time: "6:00 PM", location: "Downtown", groupId: "g1", rsvpedAt: "2026-01-01T00:00:00Z", distanceLabel: null, startsAt: "2026-08-10T18:00:00.000Z", upcoming: true, past: false, kept: false, checkedIn: false, ...over });

describe("calendar grid helpers (UTC, Monday-first)", () => {
  it("builds a complete Monday-first August 2026 grid with leading/trailing filler cells", () => {
    const cells = calendarGridDays(2026, 7); // August 2026
    expect(cells).toHaveLength(42);
    // Aug 1 2026 is a Saturday → 5 leading filler cells (Mon–Fri from July).
    const lead = cells.filter((c) => !c.inMonth && c.dayOfMonth >= 27);
    expect(lead).toHaveLength(5);
    expect(cells[0].inMonth).toBe(false);
    expect(cells[0].dayOfMonth).toBe(27);
    expect(cells[5].inMonth).toBe(true);
    expect(cells[5].date).toBe("2026-08-01");
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].date).toBe("2026-08-01");
    expect(inMonth[30].date).toBe("2026-08-31");
    // Trailing filler cells complete the last week (Sun Sep 6 is the 42nd cell).
    const trail = cells.slice(36);
    expect(trail.every((c) => !c.inMonth)).toBe(true);
    expect(trail).toHaveLength(6);
    expect(trail[0].dayOfMonth).toBe(1);
    expect(trail[5].dayOfMonth).toBe(6);
  });

  it("produces a clean 4-week February 2027 grid (Feb 1 is a Monday)", () => {
    const cells = calendarGridDays(2027, 1);
    expect(cells).toHaveLength(28);
    expect(cells[0].inMonth).toBe(true);
    expect(cells[0].date).toBe("2027-02-01");
    expect(cells[27].date).toBe("2027-02-28");
    expect(cells.every((c) => c.inMonth)).toBe(true);
  });

  it("labels days with human run counts in the aria-label", () => {
    expect(dayAriaLabel("2026-08-10", 0)).toMatch(/, no runs$/);
    expect(dayAriaLabel("2026-08-10", 1)).toMatch(/, 1 run$/);
    expect(dayAriaLabel("2026-08-10", 2)).toMatch(/, 2 runs$/);
  });

  it("picks today when it has runs, else the first run day, else null", () => {
    const now = new Date("2026-08-09T12:00:00Z");
    const runs = [{ date: "2026-08-16" }, { date: "2026-08-09" }];
    expect(defaultCalendarDay(runs, now, "2026-08")).toBe("2026-08-09");
    expect(defaultCalendarDay([{ date: "2026-08-16" }], now, "2026-08")).toBe("2026-08-16");
    expect(defaultCalendarDay([], now, "2026-08")).toBeNull();
    // Today in a different month never wins; first run day of the month does.
    expect(defaultCalendarDay(runs, new Date("2026-09-09T12:00:00Z"), "2026-08")).toBe("2026-08-09");
    // Runs outside the month are ignored.
    expect(defaultCalendarDay([{ date: "2026-07-30" }], now, "2026-08")).toBeNull();
  });

  it("renders the weekday header row", () => {
    expect(WEEKDAY_LABELS).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});

describe("My Runs CalendarGrid SSR", () => {
  const now = new Date("2026-08-09T12:00:00Z");

  it("renders month title, nav buttons, export link, and a 42-cell grid", async () => {
    const { CalendarGrid } = await import("../src/pages/MyRunsPage");
    const html = renderToStaticMarkup(<MemoryRouter><CalendarGrid upcoming={[]} onRemove={() => {}} now={now} /></MemoryRouter>);
    expect(html).toContain('aria-label="Previous month"');
    expect(html).toContain('aria-label="Next month"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('href="/api/my/runs/ical"');
    expect(html).toContain('download="run-local-my-runs.ics"');
    expect(html).toContain("Export .ics");
    // 33 buttons: 2 month nav + 31 in-month day buttons (fillers are spans).
    expect((html.match(/<button /g) ?? []).length).toBe(33);
    // 11 filler cells are aria-hidden placeholders, never buttons (5 lead + 6 trail).
    expect((html.match(/aria-hidden="true" class="min-h-11 rounded-xl"/g) ?? []).length).toBe(11);
    // No runs this month → the panel explains and no day is selected.
    expect(html).toContain("No upcoming runs this month");
  });

  it("shows run counts on day cells and the selected day's runs in the panel", async () => {
    const { CalendarGrid } = await import("../src/pages/MyRunsPage");
    const html = renderToStaticMarkup(<MemoryRouter><CalendarGrid upcoming={[rsvpRun({ id: "a", title: "Monday social run", date: "2026-08-10", time: "6:00 PM", occurrenceId: "occ-a", startsAt: "2026-08-10T18:00:00.000Z" }), rsvpRun({ id: "b", title: "Track Tuesday", eventId: "tue-track", date: "2026-08-11", time: "6:00 AM", occurrenceId: "occ-b", startsAt: "2026-08-11T06:00:00.000Z" })]} onRemove={() => {}} now={now} /></MemoryRouter>);
    // Day cells carry count-bearing aria-labels and visible count badges.
    expect(html).toContain(", 1 run\"");
    // The auto-selected day is the first run day (2026-08-10): its card shows.
    expect(html).toContain("Monday social run");
    expect(html).toContain("6:00 PM");
    // The panel is occurrence/day-exact: the other day's run is NOT rendered.
    expect(html).not.toContain("Track Tuesday");
    // Run cards in the panel link to the exact occurrence (event + discussion).
    expect(html).toMatch(/<a[^>]*href="\/events\/mon-social\?discussion=occ-a"/);
    // The panel header shows the selected day, and remove/keep actions exist.
    expect(html).toContain('aria-label="Remove RSVP for Monday social run"');
    expect(html).toContain('aria-label="Keep Monday social run on My Runs"');
  });

  it("marks today's day cell with aria-current and an explicit Today state", async () => {
    const { CalendarGrid } = await import("../src/pages/MyRunsPage");
    const html = renderToStaticMarkup(<MemoryRouter><CalendarGrid upcoming={[rsvpRun({ id: "t", title: "Today run", date: "2026-08-09", upcoming: true, past: false })]} onRemove={() => {}} now={now} /></MemoryRouter>);
    expect(html).toContain('aria-current="date"');
    expect((html.match(/aria-current="date"/g) ?? []).length).toBe(1);
    expect(html).toContain('class="sr-only">Today');
    // Panel header carries the visible Today chip.
    expect(html).toContain(">Today</span>");
    expect(html).toContain("Today run");
  });

  it("auto-selects today when it has runs and shows no other day's runs", async () => {
    const { CalendarGrid } = await import("../src/pages/MyRunsPage");
    const html = renderToStaticMarkup(<MemoryRouter><CalendarGrid upcoming={[rsvpRun({ id: "today", title: "Today run", date: "2026-08-09" }), rsvpRun({ id: "later", title: "Later run", date: "2026-08-16" })]} onRemove={() => {}} now={now} /></MemoryRouter>);
    // Today is selected (aria-pressed) and only today's card is in the panel.
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Today run");
    expect(html).not.toContain("Later run");
  });
});
