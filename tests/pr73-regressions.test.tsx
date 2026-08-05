import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { occurrenceHasStarted, resolveWeekEvents } from "../src/lib/dates";
import { isPastCalendarDate } from "../src/lib/activityDates";
import { DiscussionPanel } from "../src/pages/EventDetailPage";
import type { RunEvent } from "../src/types";

vi.mock("../src/state/account", () => ({ useAccount: () => ({ me: null, role: "verified" }) }));
vi.mock("../src/lib/api", () => ({
  getOccurrenceDiscussion: vi.fn(),
  createDiscussion: vi.fn(),
  deleteDiscussion: vi.fn(),
}));

const run = (overrides: Partial<RunEvent> = {}): RunEvent => ({
  id: "canonical-run",
  groupId: "runcomo",
  title: "Canonical published run",
  dayOfWeek: 0,
  time: "6:00 PM",
  location: "Park",
  distanceLabel: "5K",
  invite: "Open to all",
  ...overrides,
});

describe("PR #73 feed and occurrence regressions", () => {
  it("excludes an elapsed recurring occurrence from the primary Events feed model", () => {
    const now = new Date(2026, 7, 3, 18, 30); // Monday after the 6 PM occurrence
    const resolved = resolveWeekEvents([run()], now);
    expect(resolved).toHaveLength(1);
    expect(occurrenceHasStarted(resolved[0]!, now)).toBe(true);
    expect(resolved.filter((event) => !occurrenceHasStarted(event, now))).toHaveLength(0);
  });

  it("excludes a past race from the Races feed model", () => {
    expect(isPastCalendarDate("2026-08-02", new Date(2026, 7, 3, 9))).toBe(true);
    expect(isPastCalendarDate("2026-08-03", new Date(2026, 7, 3, 9))).toBe(false);
  });

  it("resolves a published canonical event to the same detail occurrence model as the Events page", () => {
    const publishedCanonical = run({ id: "published-42", title: "Published canonical 42" });
    const resolved = resolveWeekEvents([publishedCanonical], new Date(2026, 7, 3, 12));
    expect(resolved.find((event) => event.id === "published-42")).toMatchObject({
      id: "published-42",
      title: "Published canonical 42",
      date: new Date(2026, 7, 3),
    });
  });

  it("consumes an exact discussion occurrence and makes a mismatched occurrence unavailable", () => {
    const exact = renderToStaticMarkup(
      <MemoryRouter>
        <DiscussionPanel eventId="canonical-run" occurrenceId="event:canonical-run:2026-08-03" eligible unavailable={false} />
      </MemoryRouter>,
    );
    expect(exact).toContain("Run-day discussion");
    expect(exact).toContain("Post thread");
    expect(exact).toContain("Write a thread");
    expect(exact).not.toContain("hidden, archived, or no longer available");

    const mismatch = renderToStaticMarkup(
      <MemoryRouter>
        <DiscussionPanel eventId="canonical-run" occurrenceId="event:canonical-run:2026-08-10" eligible={false} unavailable />
      </MemoryRouter>,
    );
    expect(mismatch).toContain("This discussion is unavailable because the run is hidden, archived, or no longer available.");
    expect(mismatch).not.toContain("Post thread");
    expect(mismatch).not.toContain("Write a thread");
  });
});
