import { describe, expect, it } from "vitest";
import { filterOneTimeEvents, isPastCalendarDate } from "../src/lib/activityDates";
import type { PublicUserEvent } from "../src/lib/api";

const event = (date: string, type: PublicUserEvent["type"] = "one_time"): PublicUserEvent => ({ id: date, kind: "event", title: date, type, date: type === "one_time" ? date : null, dayOfWeek: type === "recurring" ? 1 : null, time: "6:00 PM", location: "Park", distanceLabel: "5K", invite: "Open to all", externalUrl: null, description: "", host: "Runner" });
describe("activity date separation", () => {
  const now = new Date(2026, 7, 4, 12);
  it("separates past and upcoming one-time events by local calendar date", () => {
    expect(filterOneTimeEvents([event("2026-08-03"), event("2026-08-04"), event("2026-08-05")], "past", now).map((e) => e.id)).toEqual(["2026-08-03"]);
    expect(filterOneTimeEvents([event("2026-08-03"), event("2026-08-04"), event("2026-08-05")], "upcoming", now).map((e) => e.id)).toEqual(["2026-08-04", "2026-08-05"]);
  });
  it("does not classify recurring events as past", () => { expect(filterOneTimeEvents([event("2026-08-03", "recurring")], "past", now)).toEqual([]); });
  it("compares race dates without UTC rollover", () => { expect(isPastCalendarDate("2026-08-03", now)).toBe(true); expect(isPastCalendarDate("2026-08-04", now)).toBe(false); });
});
