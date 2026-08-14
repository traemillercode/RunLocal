import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { MyRunView } from "../src/lib/api";
import { defaultCalendarMonth, firstInMonthDay, monthBoundary, navigateDay, shiftDate } from "../src/lib/calendar";

/** A complete MyRunView fixture (RSVP variant) with the fields the server sends. */
const rsvpRun = (over: Partial<MyRunView>): MyRunView => ({ id: "r1", kind: "rsvp", eventId: "mon-social", occurrenceId: "event:mon-social:2026-08-10", cityId: "columbia-mo", title: "Monday social run", date: "2026-08-10", time: "6:00 PM", location: "Downtown", groupId: "g1", rsvpedAt: "2026-01-01T00:00:00Z", distanceLabel: null, startsAt: "2026-08-10T18:00:00.000Z", upcoming: true, past: false, kept: false, checkedIn: false, ...over });

/** Day-cell buttons (carry data-date) vs. everything else (the nav buttons). */
const dayButtons = (html: string) => (html.match(/<button\b[^>]*>/g) ?? []).filter((tag) => tag.includes("data-date="));
const navButtons = (html: string) => (html.match(/<button\b[^>]*>/g) ?? []).filter((tag) => !tag.includes("data-date="));

describe("My Runs calendar polish — pure helpers (UTC)", () => {
  it("shiftDate crosses month and year boundaries and is leap-safe", () => {
    expect(shiftDate("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29"); // leap year
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("monthBoundary returns the first/last day of the month, leap-aware", () => {
    expect(monthBoundary("2026-08-10", "first")).toBe("2026-08-01");
    expect(monthBoundary("2026-08-10", "last")).toBe("2026-08-31");
    expect(monthBoundary("2026-02-15", "last")).toBe("2026-02-28");
    expect(monthBoundary("2028-02-15", "last")).toBe("2028-02-29"); // leap year
    expect(firstInMonthDay("2026-08")).toBe("2026-08-01");
  });

  it("navigateDay moves by day/week/boundary for all six keys with monthChanged flags", () => {
    expect(navigateDay("2026-08-10", "ArrowLeft")).toEqual({ date: "2026-08-09", monthChanged: false });
    expect(navigateDay("2026-08-31", "ArrowRight")).toEqual({ date: "2026-09-01", monthChanged: true });
    expect(navigateDay("2026-08-10", "ArrowUp")).toEqual({ date: "2026-08-03", monthChanged: false });
    expect(navigateDay("2026-08-02", "ArrowUp")).toEqual({ date: "2026-07-26", monthChanged: true });
    expect(navigateDay("2026-08-10", "ArrowDown")).toEqual({ date: "2026-08-17", monthChanged: false });
    expect(navigateDay("2026-08-30", "ArrowDown")).toEqual({ date: "2026-09-06", monthChanged: true });
    expect(navigateDay("2026-08-10", "Home")).toEqual({ date: "2026-08-01", monthChanged: false });
    expect(navigateDay("2026-08-10", "End")).toEqual({ date: "2026-08-31", monthChanged: false });
  });

  it("defaultCalendarMonth opens on the earliest month with a run, else the current month", () => {
    const now = new Date("2026-08-09T12:00:00Z");
    expect(defaultCalendarMonth([], now)).toBe("2026-08");
    expect(defaultCalendarMonth([{ date: "2026-08-10" }], now)).toBe("2026-08");
    expect(defaultCalendarMonth([{ date: "2026-09-10" }, { date: "2026-10-02" }], now)).toBe("2026-09");
    // Mixed: the earliest qualifying month wins (the current month beats later).
    expect(defaultCalendarMonth([{ date: "2026-09-10" }, { date: "2026-08-15" }], now)).toBe("2026-08");
    // Past months are ignored by an upcoming-only grid.
    expect(defaultCalendarMonth([{ date: "2026-07-30" }, { date: "2026-09-01" }], now)).toBe("2026-09");
  });
});

describe("My Runs calendar polish — CalendarGrid SSR", () => {
  const now = new Date("2026-08-09T12:00:00Z");

  it("rovers tabindex: exactly one tabbable day button; nav buttons carry no tabindex", async () => {
    const { CalendarGrid } = await import("../src/pages/MyRunsPage");
    // Empty month: activeDate is null, so the fallback tabbable day is today's cell.
    const empty = renderToStaticMarkup(<MemoryRouter><CalendarGrid upcoming={[]} onRemove={() => {}} now={now} /></MemoryRouter>);
    const emptyDays = dayButtons(empty);
    expect(emptyDays).toHaveLength(31);
    expect(emptyDays.filter((t) => t.includes('tabindex="0"'))).toHaveLength(1);
    expect(emptyDays.filter((t) => t.includes('tabindex="-1"'))).toHaveLength(30);
    expect(emptyDays.find((t) => t.includes('tabindex="0"'))).toContain('data-date="2026-08-09"');
    const emptyNav = navButtons(empty);
    expect(emptyNav).toHaveLength(2);
    expect(emptyNav.every((t) => !t.includes("tabindex"))).toBe(true);
    // With runs: the auto-selected (active) day is the tabbable one.
    const withRuns = renderToStaticMarkup(<MemoryRouter><CalendarGrid upcoming={[rsvpRun({ id: "t", title: "Today run", date: "2026-08-09" })]} onRemove={() => {}} now={now} /></MemoryRouter>);
    const runDays = dayButtons(withRuns);
    expect(runDays.filter((t) => t.includes('tabindex="0"'))).toHaveLength(1);
    expect(runDays.find((t) => t.includes('tabindex="0"'))).toContain('data-date="2026-08-09"');
  });

  it("disables Previous month on the current month and preserves the 33-button grid", async () => {
    const { CalendarGrid } = await import("../src/pages/MyRunsPage");
    const html = renderToStaticMarkup(<MemoryRouter><CalendarGrid upcoming={[]} onRemove={() => {}} now={now} /></MemoryRouter>);
    expect(html).toMatch(/aria-label="Previous month"[^>]*disabled=""/);
    expect((html.match(/<button /g) ?? []).length).toBe(33);
    // A disabled button still carries its accessible label; Next stays enabled.
    expect(html).toContain('aria-label="Next month"');
    expect(html).toContain('aria-label="Previous month"');
  });

  it("labels the calendar container as a group with its accessible name", async () => {
    const { CalendarGrid } = await import("../src/pages/MyRunsPage");
    const html = renderToStaticMarkup(<MemoryRouter><CalendarGrid upcoming={[]} onRemove={() => {}} now={now} /></MemoryRouter>);
    expect(html).toContain('role="group" aria-label="My Runs calendar"');
  });

  it("keeps a single aria-pressed and a single aria-current with runs on today and later", async () => {
    const { CalendarGrid } = await import("../src/pages/MyRunsPage");
    const html = renderToStaticMarkup(<MemoryRouter><CalendarGrid upcoming={[rsvpRun({ id: "today", title: "Today run", date: "2026-08-09" }), rsvpRun({ id: "later", title: "Later run", date: "2026-08-16" })]} onRemove={() => {}} now={now} /></MemoryRouter>);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-current="date"/g) ?? []).length).toBe(1);
  });

  it("locks the occurrence-explicit removal toast source contract", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/pages/MyRunsPage.tsx", import.meta.url), "utf8"));
    expect(source).toContain('RSVP removed for "'); // locked prefix preserved
    expect(source).toContain('" on ${formatRunDate(run.date)}.');
    expect(source).toContain("rsvpEvent(run.eventId, false, run.date, run.id)");
  });

  it("locks the cursor initializer, data-date, and roving tabIndex wiring", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/pages/MyRunsPage.tsx", import.meta.url), "utf8"));
    expect(source).toContain("defaultCalendarMonth(upcomingOnly, now)");
    expect(source).toContain("data-date={cell.date}");
    expect(source).toContain("tabIndex={cell.date === focusableDate ? 0 : -1}");
  });
});
