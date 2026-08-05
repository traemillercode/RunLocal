import { Link } from "react-router-dom";
import { HomeCityBanner } from "../components/HomeCityBanner";
import { Icon } from "../components/ui";
import { formatRaceDate } from "../lib/dates";
import { filterOneTimeEvents, isPastCalendarDate } from "../lib/activityDates";
import { usePublicContent } from "../state/content";
import { useModerated } from "../state/moderated";
import type { City } from "../types";

export function PastEventsPage({ city }: { city: City }) {
  const { hidden } = useModerated();
  const { events: submittedEvents, races: submittedRaces } = usePublicContent();
  const events = filterOneTimeEvents(submittedEvents, "past").filter((event) => !hidden.has(`event:${event.id}`));
  const races = [...city.races, ...submittedRaces].filter((race) => isPastCalendarDate(race.date) && !hidden.has(`race:${race.id}`));
  return (
    <div className="desktop-browse-layout mx-auto w-full max-w-md px-4 pb-32 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold tracking-tight">Past events</h1><p className="mt-0.5 text-sm font-medium text-slate-500">A record of finished local runs and races.</p></div>
        <Link to="/" className="inline-flex min-h-10 items-center gap-1 rounded-full bg-slate-100 px-3 text-xs font-bold text-slate-700"><Icon name="chevronRight" className="h-4 w-4" /> Current</Link>
      </div>
      <HomeCityBanner />
      {events.length === 0 && races.length === 0 ? <p className="mt-8 rounded-2xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200/70">No past events yet.</p> : null}
      <ul className="mt-4 space-y-3">
        {events.map((event) => <li key={event.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70"><h2 className="font-bold">{event.title}</h2><p className="mt-1 text-sm text-slate-500">{event.date} · {event.time} · {event.location}</p></li>)}
        {races.map((race) => <li key={race.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70"><h2 className="font-bold">{race.name}</h2><p className="mt-1 text-sm text-slate-500">{formatRaceDate(race.date)} · {race.location}</p></li>)}
      </ul>
    </div>
  );
}
