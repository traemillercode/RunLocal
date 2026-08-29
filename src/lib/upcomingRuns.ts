import { resolveWeekEvents, mergeWeekEventSources, occurrenceHasStarted, bareEventId, type DatedRunEvent } from "./dates";
import type { City, RunEvent } from "../types";
import type { CanonicalEvent } from "./api";

/**
 * THE single answer to "what runs are coming up this week".
 *
 * Extracted because three surfaces were answering it three different ways:
 *   - MarketingLiveBoard  rolling 7 days, hidden/started excluded  (correct)
 *   - EventsPage          calendar Mon–Sun week                    (decays)
 *   - HomeRightRail       city.events.length, UNFILTERED           (just wrong)
 *
 * The visible symptom: on the Saturday of an Aug 24–30 week the right rail said
 * "7 group runs" while the list below it showed 1. Not a rounding difference —
 * three implementations of one question, which is the fieldCls pattern with a
 * date instead of a class string.
 *
 * ROLLING 7 DAYS, not the calendar week. A calendar week decays: by Saturday
 * most of it has already happened, and by Sunday night it reads "0 runs this
 * week" — least useful exactly when someone is planning the week ahead. A
 * rolling window never empties while the schedule is active, and "this week"
 * reads to a visitor as "the next seven days" anyway.
 */
export function upcomingRuns(
  city: City,
  canonical: readonly CanonicalEvent[] | null,
  opts: { now?: Date; recurring?: readonly RunEvent[]; includeIndependent?: boolean } = {},
): DatedRunEvent[] {
  const now = opts.now ?? new Date();
  const merged = mergeWeekEventSources(city.events, [...(canonical ?? [])], [...(opts.recurring ?? [])]);

  // Resolve the current week AND the next, then keep only what falls inside the
  // rolling horizon. Two resolutions are needed because resolveWeekEvents maps
  // a weekday onto whichever calendar week its `now` lands in.
  const horizonDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  const horizon = horizonDate.getTime();
  const seen = new Set<string>();

  return [...resolveWeekEvents(merged, now), ...resolveWeekEvents(merged, horizonDate)]
    .filter((e) => {
      // Independent runs have no group and no host; surfaces that show a host
      // or an attendee count must exclude them.
      if (!opts.includeIndependent && e.groupId === "") return false;
      if (occurrenceHasStarted(e, now)) return false;
      if (e.date.getTime() >= horizon) return false;
      const key = `${bareEventId(e.id)}:${e.date.toISOString().slice(0, 10)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.time.localeCompare(b.time));
}

/** Count for "N runs this week" copy. Same resolver, so the number can never disagree with the list. */
export function upcomingRunCount(
  city: City,
  canonical: readonly CanonicalEvent[] | null,
  opts?: Parameters<typeof upcomingRuns>[2],
): number {
  return upcomingRuns(city, canonical, opts).length;
}
