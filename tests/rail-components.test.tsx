import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { RailCard, RailItemLink, RailSeeAll, RailStack } from "../src/components/RailCard";
import { ForumRail, upcomingGroupRunRows } from "../src/pages/ForumPage";
import type { City } from "../src/types";

// 2026-08-10 is a Monday. dayOfWeek 0 = Monday in the app's convention.
/** A date offset from today, so "future" and "past" stay true as time passes. */
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CITY = {
  id: "columbia-mo",
  name: "Columbia",
  state: "MO",
  events: [
    { id: "e1", groupId: "g1", title: "Monday Social", dayOfWeek: 0, time: "6:00 PM", location: "Flat Branch", distanceLabel: "3 mi", invite: "Open to all", externalUrl: null },
    { id: "e2", groupId: "", title: "Tempo Run", dayOfWeek: 4, time: "5:30 AM", location: "MKT Trail", distanceLabel: "5 mi", invite: "Open to all", externalUrl: null },
  ],
  /*
   * RELATIVE DATES, not fixed ones.
   *
   * This fixture had "Show-Me Half" on 2026-09-12 as the FUTURE race and a
   * "Past 5K" on 2026-01-01 as the past one. 2026-09-12 was future when the
   * test was written and is now behind us, so the assertion that the upcoming
   * race renders started failing on a calendar date with no code change.
   *
   * Third time bomb in this suite — multicity pinned one clock and let another
   * run free; this one hardcoded a date that only meant "future" for a while.
   *
   * The test is about the RELATIONSHIP to now ("filters out past races"), so
   * the fixture expresses that relationship instead of a moment. A date thirty
   * days out is future forever.
   */
  races: [
    { id: "r1", name: "Show-Me Half", distance: "Half", date: daysFromNow(30), location: "Downtown", registrationUrl: null, description: "" },
    { id: "r2", name: "Past 5K", distance: "5K", date: daysFromNow(-60), location: "Old", registrationUrl: null, description: "" },
  ],
  groups: [],
} as unknown as City;

describe("shared rail primitives + forum rail", () => {
  it("renders rail primitives with the desktop-only gate and card utilities", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RailStack ariaLabel="Local highlights">
          <RailCard kicker="K" title="T">
            <RailItemLink to="/races" title="Race row" meta="Meta" />
          </RailCard>
          <RailSeeAll to="/races">See all →</RailSeeAll>
        </RailStack>
      </MemoryRouter>,
    );
    expect(html).toContain('aria-label="Local highlights"');
    expect(html).toContain("hidden lg:block");
    expect(html).toContain("rounded-2xl");
    expect(html).toContain("Race row");
    expect(html).toContain('href="/races"');
  });
  it("labels the next group run with Today for a same-day event", () => {
    const rows = upcomingGroupRunRows(CITY, new Date("2026-08-10T12:00:00Z"));
    expect(rows[0]).toEqual({ id: "e1", title: "Monday Social", meta: "Today · 6:00 PM" });
    expect(rows.length).toBeLessThanOrEqual(3);
  });
  it("renders the forum rail cards with see-all links, and filters out past races", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ForumRail city={CITY} />
      </MemoryRouter>,
    );
    expect(html).toContain("Community guidelines");
    expect(html).toContain("A useful local forum");
    expect(html).toContain("Upcoming group runs");
    expect(html).toContain("Upcoming races");
    expect(html).toContain("Your city");
    expect(html).toContain("Columbia, MO");
    expect(html).toContain("Monday Social");
    expect(html).toContain("Show-Me Half");
    expect(html).not.toContain("Past 5K");
  });
});
