import { describe, expect, it } from "vitest";
import { CITIES } from "../src/data/cities";
import {
  mergeWeekEventSources,
  occurrenceHasStarted,
  resolveWeekEvents,
  type WeekCanonicalSource,
} from "../src/lib/dates";
import type { RunEvent } from "../src/types";

// The live bug: /api/events materializes each client seed slot as its own
// canonical row (random id, seedRefId = seed id). EventsPage merged seed +
// canonical + community without dedup, so every seed group run rendered twice
// (and approved community recurring events rendered once as an "event:<refId>"
// canonical row AND once as the approved /api/content copy).
const seed = CITIES[0].events;

/** Canonical rows exactly as /api/events returns them for the seed slots. */
function canonicalSeedCopies(): WeekCanonicalSource[] {
  return seed.map((e) => ({
    id: `canon-${e.id}`,
    seedRefId: e.id,
    groupId: e.groupId,
    title: e.title,
    dayOfWeek: e.dayOfWeek,
    time: e.time,
    location: e.location,
    distanceLabel: e.distanceLabel,
    invite: e.invite,
    externalUrl: e.externalUrl ?? null,
    status: "published",
    hidden: false,
    archivedAt: null,
  }));
}

const communityCanonical: WeekCanonicalSource = {
  id: "event:user-comm1",
  seedRefId: null,
  groupId: "user-comm1",
  title: "Thursday Twilight Loop",
  dayOfWeek: 3,
  time: "5:30 PM",
  location: "Cosmo Park",
  distanceLabel: "3–5 mi",
  invite: "Open to all",
  externalUrl: null,
  status: "published",
  hidden: false,
  archivedAt: null,
};

const communityRecurring: RunEvent = {
  id: "user-comm1",
  groupId: "",
  title: "Thursday Twilight Loop",
  dayOfWeek: 3,
  time: "5:30 PM",
  location: "Cosmo Park",
  distanceLabel: "3–5 mi",
  invite: "Open to all",
};

const adminCanonical: WeekCanonicalSource = {
  id: "adm-night-run",
  seedRefId: null,
  groupId: "ctc",
  title: "Admin Night Run",
  dayOfWeek: 1,
  time: "7:00 PM",
  location: "Track",
  distanceLabel: "Intervals",
  invite: "Members + guests",
  externalUrl: null,
  status: "published",
  hidden: false,
  archivedAt: null,
};

const ids = (events: RunEvent[]) => events.map((e) => e.id);

describe("mergeWeekEventSources (Events tab dedup)", () => {
  it("drops canonical seed copies so each seed run appears exactly once", () => {
    const merged = mergeWeekEventSources(seed, canonicalSeedCopies(), []);
    expect(merged).toHaveLength(seed.length);
    expect(ids(merged)).toEqual(seed.map((e) => e.id));
    expect(new Set(ids(merged)).size).toBe(merged.length);
    // Every seed slot is still present (nothing genuinely distinct removed).
    for (const e of seed) expect(merged.some((m) => m.id === e.id && m.title === e.title)).toBe(true);
  });

  it("keeps distinct runs that share a weekday (different groups)", () => {
    const merged = mergeWeekEventSources(seed, canonicalSeedCopies(), []);
    const wed = merged.filter((e) => e.dayOfWeek === 2);
    expect(wed.map((e) => e.id).sort()).toEqual(["wed-hills", "wed-kickstart"]);
    expect(wed.map((e) => e.groupId).sort()).toEqual(["fleetfeet", "runcomo"]);
  });

  it("drops the canonical 'event:<refId>' copy when the approved recurring community event is present", () => {
    const merged = mergeWeekEventSources(seed, [...canonicalSeedCopies(), communityCanonical], [communityRecurring]);
    const twilight = merged.filter((e) => e.title === "Thursday Twilight Loop");
    expect(twilight).toHaveLength(1);
    expect(twilight[0]?.id).toBe("user-comm1"); // the /api/content representation wins (Independent Runner card)
  });

  it("keeps admin-created canonical runs that have no seed or community counterpart", () => {
    const merged = mergeWeekEventSources(seed, [...canonicalSeedCopies(), adminCanonical], []);
    expect(merged.some((e) => e.id === "adm-night-run" && e.title === "Admin Night Run")).toBe(true);
  });

  it("never surfaces hidden, non-published, or archived canonical records", () => {
    const variants: WeekCanonicalSource[] = [
      { ...communityCanonical, id: "h1", hidden: true },
      { ...communityCanonical, id: "h2", status: "archived" },
      { ...communityCanonical, id: "h3", archivedAt: "2026-08-01T00:00:00.000Z" },
      { ...communityCanonical, id: "h4", status: "draft" },
    ];
    const merged = mergeWeekEventSources(seed, variants, []);
    for (const id of ["h1", "h2", "h3", "h4"]) expect(merged.some((e) => e.id === id)).toBe(false);
  });
});

describe("Events tab upcoming-only pipeline", () => {
  // Same pipeline EventsPage uses: merge → resolveWeekEvents → filter past.
  const upcoming = (now: Date, canonical: WeekCanonicalSource[], recurring: RunEvent[]) =>
    resolveWeekEvents(mergeWeekEventSources(seed, canonical, recurring), now).filter(
      (e) => !occurrenceHasStarted(e, now),
    );

  it("shows only occurrences from today onward, once each (Wednesday 10:00 AM)", () => {
    const wed = new Date(2026, 7, 12, 10, 0, 0); // Wed Aug 12, 2026
    const out = upcoming(wed, [...canonicalSeedCopies(), adminCanonical], [communityRecurring]);
    const titles = out.map((e) => e.title).sort();
    // Monday + Tuesday are past; Wednesday 6:00 AM already started — none of
    // those appear. Wednesday 6:00 PM, Thursday, Saturday, Sunday do.
    expect(titles).toEqual([
      "Kickstart Run Club",
      "Mizzou Sunset Loop",
      "Saturday Long Run: MKT Trail",
      "Sunday Recovery Run",
      "Thursday Twilight Loop",
    ]);
    // No duplicates anywhere in the resolved week.
    const outIds = out.map((e) => e.id);
    expect(new Set(outIds).size).toBe(outIds.length);
  });

  it("keeps genuinely distinct future dates including same-day runs (Monday 8:00 AM)", () => {
    const mon = new Date(2026, 7, 10, 8, 0, 0); // Mon Aug 10, 2026
    const out = upcoming(mon, [...canonicalSeedCopies(), adminCanonical], [communityRecurring]);
    // All 7 seed slots + community + admin are still upcoming this week.
    expect(out).toHaveLength(9);
    // Distinct same-day runs stay distinct.
    const wed = out.filter((e) => e.dayOfWeek === 2);
    expect(wed.map((e) => e.id).sort()).toEqual(["wed-hills", "wed-kickstart"]);
    expect(new Set(out.map((e) => e.id)).size).toBe(out.length);
  });

  it("never leaks one-time canonical records (dayOfWeek -1) into the weekly list", () => {
    const oneTimeCanonical: WeekCanonicalSource = {
      ...communityCanonical,
      id: "event:user-onetime",
      title: "One-off Shakeout",
      dayOfWeek: -1,
    };
    const mon = new Date(2026, 7, 10, 8, 0, 0);
    const out = upcoming(mon, [...canonicalSeedCopies(), oneTimeCanonical], []);
    expect(out.some((e) => e.title === "One-off Shakeout")).toBe(false);
  });
});
