import { localISODate } from "../lib/dates";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DepartureBoard from "../components/DepartureBoard";
import type { RunEvent as DepartureRunEvent } from "../components/DepartureBoard";
import { mapRunEvent } from "../lib/mapRunEvent";
import { resolveWeekEvents, mergeWeekEventSources, occurrenceHasStarted, occurrenceIdFor, bareEventId, type DatedRunEvent } from "../lib/dates";
import * as api from "../lib/api";
import { usePublicContent } from "../state/content";
import { useModerated } from "../state/moderated";
import { useAccount } from "../state/account";
import { IndependentEventSheet } from "../components/SubmissionSheets";
import { VerifiedGateSheet } from "../components/VerifiedGateSheet";
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
  const { role, me } = useAccount();
  const signedIn = me?.status === "signed_in";
  // NOT the same as signedIn: the server refuses RSVP unless status is
  // "verified" (403 verified_runner_required), so a pending account must be
  // sent to verification rather than handed a button that fails.
  const canRsvp = role === "verified";
  const [canonicalEvents, setCanonicalEvents] = useState<api.CanonicalEvent[] | null>(null);
  const [summaries, setSummaries] = useState<Record<string, api.AttendanceSummaryEntry>>({});
  const [publicCounts, setPublicCounts] = useState<Record<string, number>>({});
  const [hostSheetOpen, setHostSheetOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);

  const openHostRun = () => {
    if (role === "verified") setHostSheetOpen(true);
    else setGateOpen(true);
  };

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

  /*
   * localISODate, and this one is the sharpest of the nine: it builds
   * OCCURRENCE IDS. A UTC-shifted date does not merely display wrongly — it
   * asks the server for a different run's attendance, so the card would show
   * the wrong counts entirely, or none, with nothing to indicate why.
   */
  const occurrenceIds = useMemo(() => weekEvents.map((e) => occurrenceIdFor(bareEventId(e.id), localISODate(e.date))), [weekEvents]);

  /**
   * PRIVACY BOUNDARY (D2). /events is public, so a signed-out visitor must not
   * receive member identities.
   *
   * Signed in  -> attendance-summary: host, up to 4 attendees, going count.
   * Signed out -> public-summary: going COUNT only. No names, no initials.
   *
   * This is why the board is the public surface rather than EventsPage:
   * RunCard.attendees is optional and absent renders the count alone, so guest
   * mode is "pass no attendees" rather than ~29 individual guest branches.
   */
  useEffect(() => {
    if (occurrenceIds.length === 0) { setSummaries({}); setPublicCounts({}); return; }
    let alive = true;
    if (signedIn) {
      void api.getAttendanceSummary(occurrenceIds).then((r) => {
        if (alive && r.ok) setSummaries(r.data.summaries);
      });
    } else {
      void api.getPublicGoingCounts(occurrenceIds).then((r) => {
        if (!alive || !r.ok) return;
        setPublicCounts(Object.fromEntries(r.data.summaries.map((x) => [x.eventId, x.goingCount])));
      });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrenceIds.join(","), signedIn]);

  const mapped: DepartureRunEvent[] = useMemo(
    () => weekEvents.map((e, i) => {
      const id = occurrenceIds[i];
      // Guests get a summary with NO host and NO attendees — mapRunEvent then
      // emits an empty attendee list and RunCard renders the count alone.
      const summary = signedIn
        ? summaries[id]
        : { host: null, attendees: [], goingCount: publicCounts[id] ?? 0 };
      return mapRunEvent(e, city, summary);
    }),
    [weekEvents, occurrenceIds, summaries, publicCounts, signedIn, city]
  );

  return (
    <div>
      <DepartureBoard events={mapped} onHostRun={openHostRun} signedIn={signedIn} canRsvp={canRsvp} />
      {signedIn ? (
      <div className="mx-auto max-w-md px-4 py-3 text-center">
        <Link to="/events/manage" className="text-[13px] font-semibold text-slate-500 underline underline-offset-2">
          Manage runs, independent runs & submissions →
        </Link>
      </div>
      ) : null}
      <IndependentEventSheet open={hostSheetOpen} onClose={() => setHostSheetOpen(false)} cityId={city.id} />
      <VerifiedGateSheet
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        role={role}
        actionLabel="hosting a run"
        pendingLabel="Your profile is still in review."
        rejectionReason={me?.status === "signed_in" ? me.account.rejectionReason ?? null : null}
      />
    </div>
  );
}
