import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { resolveWeekEvents, mergeWeekEventSources, occurrenceHasStarted, occurrenceIdFor, bareEventId, type DatedRunEvent } from "../lib/dates";
import * as api from "../lib/api";
import type { City } from "../types";

/**
 * Live "this week in Columbia" board for the marketing page (roadmap 1.4).
 *
 * A photo says "running exists." This says "14 runs in Columbia this week and
 * 34 people are going." Only one of those is an argument — and it can't go
 * stale, which stock photography of a marathon crowd can't claim.
 *
 * PRIVACY: renders going COUNTS only, from the unauthenticated
 * /api/events/public-summary. No names, no initials, no avatars. An anonymous
 * visitor must never receive member identities (D2), and this is the page that
 * claims "private by default" — showing four real runners' initials here would
 * contradict the promise in the same viewport.
 *
 * Scoped to THIS WEEK deliberately. Three runs dated a fortnight out doesn't
 * prove an active community; it proves a calendar has entries in it.
 */

/** Weekday + time, e.g. "Tue · 6:00 PM". Kept short so three cards fit a phone. */
function whenLabel(e: DatedRunEvent): string {
  const dow = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(e.date);
  return `${dow} · ${e.time}`;
}

export function MarketingLiveBoard({ city, linkToEvents = true }: { city: City; linkToEvents?: boolean }) {
  /*
   * linkToEvents=false during the closed beta. The board still shows real runs
   * — that is the proof the community exists, and it is the whole reason the
   * board is the hero — but "See the full calendar" would send a stranger to
   * the private-beta page. Showing the runs is honest; offering a door that
   * opens onto "we're not open" is not.
   */
  const [canonical, setCanonical] = useState<api.CanonicalEvent[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    void api.getCanonicalEvents(city.id).then((r) => { if (alive && r.ok) setCanonical(r.data.events); });
    return () => { alive = false; };
  }, [city.id]);

  // Same resolution path DiscoverEventsPage uses — seed plus approved canonical,
  // hidden and already-started excluded — so the marketing page can never show a
  // run the signed-in board wouldn't.
  const weekEvents = useMemo<DatedRunEvent[]>(() => {
    const today = new Date();
    const merged = mergeWeekEventSources(city.events, canonical ?? [], []);

    // ROLLING 7 DAYS, not the calendar Mon-Sun week.
    //
    // A calendar week decays: by Saturday most of it has already happened, and
    // by Sunday night the board reads "0 runs this week" and falls to the empty
    // state — so the page is least persuasive exactly when someone is planning
    // their upcoming week. Verified against real seed data: on a Saturday the
    // calendar-week version showed 2 of 5 weekly runs.
    //
    // A rolling window never empties while the schedule is active, and "this
    // week" reads to a visitor as "the next seven days" anyway.
    const nextWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
    const horizon = nextWeek.getTime();
    const seen = new Set<string>();
    return [...resolveWeekEvents(merged, today), ...resolveWeekEvents(merged, nextWeek)]
      .filter((e) => {
        if (e.groupId === "" || occurrenceHasStarted(e, today)) return false;
        if (e.date.getTime() >= horizon) return false;
        // The two resolutions overlap where a run falls in both windows.
        const key = `${bareEventId(e.id)}:${e.date.toISOString().slice(0, 10)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime() || a.time.localeCompare(b.time));
  }, [city, canonical]);

  const featured = weekEvents.slice(0, 3);
  const ids = useMemo(
    () => featured.map((e) => occurrenceIdFor(bareEventId(e.id), e.date.toISOString().slice(0, 10))),
    [featured],
  );

  useEffect(() => {
    if (ids.length === 0) { setCounts({}); return; }
    let alive = true;
    void api.getPublicGoingCounts(ids).then((r) => {
      if (!alive || !r.ok) return;
      setCounts(Object.fromEntries(r.data.summaries.map((s) => [s.eventId, s.goingCount])));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  const totalGoing = Object.values(counts).reduce((a, b) => a + b, 0);

  // THE ZERO CASE, decided deliberately rather than left to render an empty
  // panel. A marketing page saying "no runs" is worse than the stock photo it
  // replaces, so at zero we don't claim activity at all — we show the standing
  // truth (the clubs are real and listed) and point at the full calendar.
  // Silence beats a hollow claim.
  if (weekEvents.length === 0) {
    return (
      <div className="marketing-live-board marketing-live-board-empty">
        <p className="marketing-kicker-warm">Columbia, MO</p>
        <p className="marketing-live-empty-line">
          {city.groups.length > 0
            ? `${city.groups.length} local run ${city.groups.length === 1 ? "club" : "clubs"} post their weekly runs here.`
            : "Local run clubs post their weekly runs here."}
        </p>
        {linkToEvents ? <Link to="/events" className="marketing-text-link">See the full calendar <span aria-hidden="true">→</span></Link> : null}
      </div>
    );
  }

  return (
    <div className="marketing-live-board">
      <div className="marketing-live-header">
        <p className="marketing-kicker-warm">Columbia, MO · This week</p>
        {/* The counter does more persuasive work than the cards. Both numbers
            are real; goingCount is suppressed rather than shown as 0 when
            nobody has RSVP'd yet, since "0 going" argues against us. */}
        {/*
          Runs are the schedule; people are the pitch. The going count sits
          beside the run count in coral because "34 going" is the sentence that
          proves a community exists — a run list alone is a calendar.
          Suppressed rather than shown as 0 when nobody has RSVP'd, for the same
          reason the competitor's "0.00" fails: a zero argues against us.
        */}
        <p className="marketing-live-count">
          {weekEvents.length}
          <span className="marketing-live-unit"> {weekEvents.length === 1 ? "run" : "runs"} this week</span>
          {totalGoing > 0 ? (
            <>
              <span className="marketing-live-unit"> · </span>
              <span className="marketing-live-going">{totalGoing}</span>
              <span className="marketing-live-unit"> going</span>
            </>
          ) : null}
        </p>
      </div>

      <ul className="marketing-live-list">
        {featured.map((e, i) => {
          const going = counts[ids[i]] ?? 0;
          return (
            <li key={ids[i]} className="marketing-live-item">
              <div className="marketing-live-when">{whenLabel(e)}</div>
              <div className="marketing-live-body">
                <h3>{e.title}</h3>
                <p>{e.location}</p>
                <p className="marketing-live-meta">
                  {e.distanceLabel}
                  {going > 0 ? <> · {going} going</> : null}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Fewer than three is honest rather than padded — three placeholder
          slots would advertise emptiness the way a half-full leaderboard does. */}
      {weekEvents.length > featured.length ? (
        linkToEvents ? (
        <Link to="/events" className="marketing-text-link">
          See all {weekEvents.length} runs this week <span aria-hidden="true">→</span>
        </Link>
        ) : null
      ) : linkToEvents ? (
        <Link to="/events" className="marketing-text-link">See the full calendar <span aria-hidden="true">→</span></Link>
      ) : null}
    </div>
  );
}
