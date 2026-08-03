import { describe, expect, it } from "vitest";
import {
  dateForWeekday,
  dayLabel,
  formatRaceDate,
  resolveWeekEvents,
  startOfWeek,
  weekRangeLabel,
} from "../src/lib/dates";
import type { RunEvent } from "../src/types";

const MONDAY = new Date(2026, 7, 3); // Aug 3, 2026 is a Monday
const WEDNESDAY = new Date(2026, 7, 5);

describe("startOfWeek", () => {
  it("returns Monday 00:00 for a Wednesday", () => {
    const s = startOfWeek(WEDNESDAY);
    expect(s.getDay()).toBe(1);
    expect(s.getDate()).toBe(3);
    expect(s.getHours()).toBe(0);
  });

  it("returns Monday for a Sunday (week starts Monday)", () => {
    const sunday = new Date(2026, 7, 9);
    expect(startOfWeek(sunday).getDate()).toBe(3);
  });
});

describe("dateForWeekday", () => {
  it("maps Mon=0 … Sun=6 within the current week", () => {
    expect(dateForWeekday(0, WEDNESDAY).getDate()).toBe(3);
    expect(dateForWeekday(6, WEDNESDAY).getDate()).toBe(9);
  });
});

describe("weekRangeLabel", () => {
  it("labels a single-month week without repeating the month", () => {
    expect(weekRangeLabel(startOfWeek(MONDAY))).toBe("Aug 3 – 9");
  });
});

describe("resolveWeekEvents", () => {
  const events: RunEvent[] = [
    { id: "sun", groupId: "g", title: "Sun", dayOfWeek: 6, time: "8:00 AM", location: "x", distanceLabel: "1 mi", invite: "Open to all" },
    { id: "mon", groupId: "g", title: "Mon", dayOfWeek: 0, time: "6:00 PM", location: "x", distanceLabel: "1 mi", invite: "Open to all" },
    { id: "tue2", groupId: "g", title: "Tue late", dayOfWeek: 1, time: "7:00 PM", location: "x", distanceLabel: "1 mi", invite: "Open to all" },
    { id: "tue1", groupId: "g", title: "Tue early", dayOfWeek: 1, time: "6:00 AM", location: "x", distanceLabel: "1 mi", invite: "Open to all" },
  ];

  it("sorts chronologically by weekday then time", () => {
    const out = resolveWeekEvents(events, WEDNESDAY);
    expect(out.map((e) => e.id)).toEqual(["mon", "tue1", "tue2", "sun"]);
  });

  it("resolves dates within the current week and flags today", () => {
    const out = resolveWeekEvents(events, WEDNESDAY);
    const tue = out.find((e) => e.id === "tue1")!;
    expect(tue.date.getDate()).toBe(4);
    expect(tue.dayAbbrev).toBe("Tue");
    expect(out.find((e) => e.id === "sun")!.isToday).toBe(false);
  });
});

describe("dayLabel", () => {
  it("labels today, tomorrow, weekday names, and month-day", () => {
    expect(dayLabel(MONDAY, MONDAY)).toBe("Today");
    expect(dayLabel(new Date(2026, 7, 4), MONDAY)).toBe("Tomorrow");
    expect(dayLabel(new Date(2026, 7, 7), MONDAY)).toBe("Friday");
    expect(dayLabel(new Date(2026, 7, 10), MONDAY)).toBe("Aug 10");
  });
});

describe("formatRaceDate", () => {
  it("formats ISO dates", () => {
    expect(formatRaceDate("2026-10-04")).toBe("Sun, Oct 4, 2026");
  });
});
