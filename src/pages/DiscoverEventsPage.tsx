import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DepartureBoard from "../components/DepartureBoard";
import type { RunEvent as DepartureRunEvent } from "../components/DepartureBoard";
import { mapRunEvent } from "../lib/mapRunEvent";
import { resolveWeekEvents, mergeWeekEventSources, occurrenceHasStarted, occurrenceIdFor, bareEventId, type DatedRunEvent } from "../lib/dates";
import * as api from "../lib/api";
import { usePublicContent } from "../state/content";
import { useModerated } from "../state/moderated";
import type { City } from "../types";

/**
 * The new default landing view - DepartureBoard fed by real data. Built as
 * its own page rather than folded into EventsPage.tsx (750+ lines of
 * moderation/editing/sheet logic) to avoid risking a regression in
 * something that already works. Reuses the exact same library functions
 * EventsPage uses for resolving the weekly schedule, just doesn't touch
 * that file's internals. The full management list (hide/restore/edit,
 * independent runs, confirmation thresholds) stays reachable at
 * /events/manage - nothing is removed, this is additive.
 */
export function DiscoverEventsPage({ city }: { city: City }) {
  const { events: userEvents } = usePublicContent();
  const { hidden } = useModerated();
  const [canonicalEvents, setCanonicalEvents] = useState<api.CanonicalEvent[] | null>(null);
  const [summaries, setSummaries] = useState<Record<string, api.AttendanceSummaryEntry>>({});

  useEffect(() => {
    let alive = true;
    void api.getCanonicalEvents(city.id).then((r) => { if (alive && r.ok) setCanonicalEvents(r.data.events); });
    return () => { alive = false; };
  }, [city.id]);

  const weekEvents = useMemo<DatedRunEvent[]>(() => {
    const recurring: typeof city.events = userEvents
      .filter((e) => e.type === "recurring" && e.dayOfWeek !== null)
      .map((e) => ({ id: e.id, groupId: "", title: e.title, dayOfWeek: e.dayOfWeek!, time: e.time, location: e.location, distanceLabel: e.distanceLabel, invite: e.invite, externalUrl: e.externalUrl ?? undefined }));
    const merged = mergeWeekEventSources(city.events, canonicalEvents ?? [], recurring);
    const today = new Date();
    return resolveWeekEvents(merged, today)
      .filter((e) => e.groupId !== "" && !hidden.has(`event:${bareEventId(e.id)}`) && !occurrenceHasStarted(e, today));
  }, [city, userEvents, canonicalEvents, hidden]);

  const occurrenceIds = useMemo(() => weekEvents.map((e) => occurrenceIdFor(bareEventId(e.id), e.date.toISOString().slice(0, 10))), [weekEvents]);

  useEffect(() => {
    if (occurrenceIds.length === 0) { setSummaries({}); return; }
    let alive = true;
    void api.getAttendanceSummary(occurrenceIds).then((r) => { if (alive && r.ok) setSummaries(r.data.summaries); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrenceIds.join(",")]);

  const mapped: DepartureRunEvent[] = useMemo(
    () => weekEvents.map((e, i) => mapRunEvent(e, city, summaries[occurrenceIds[i]])),
    [weekEvents, occurrenceIds, summaries, city]
  );

  return (
    <div>
      <DepartureBoard events={mapped} />
      <div className="mx-auto max-w-md px-4 py-3 text-center">
        <Link to="/events/manage" className="text-[13px] font-semibold text-slate-500 underline underline-offset-2">
          Manage runs, independent runs & submissions →
        </Link>
      </div>
    </div>
  );
}
