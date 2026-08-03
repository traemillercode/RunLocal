import { Chip, Icon } from "../components/ui";
import { formatRaceDate } from "../lib/dates";
import type { City, Race } from "../types";

function RaceCard({ race }: { race: Race }) {
  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold leading-snug text-slate-900">{race.name}</h3>
          <p className="mt-0.5 text-[13px] font-medium text-slate-500">{race.distance}</p>
        </div>
        {race.registrationOpen ? <Chip tone="emerald">Registration open</Chip> : <Chip tone="amber">{race.registrationNote ?? "Registration TBA"}</Chip>}
      </div>
      <div className="space-y-1.5 px-4 pb-4 text-[13px] text-slate-600">
        <p className="flex items-center gap-2">
          <Icon name="calendar" className="h-4 w-4 shrink-0 text-slate-400" />
          {formatRaceDate(race.date)}
        </p>
        <p className="flex items-center gap-2">
          <Icon name="mapPin" className="h-4 w-4 shrink-0 text-slate-400" />
          {race.location}
        </p>
        <p className="flex items-center gap-2">
          <Icon name="flag" className="h-4 w-4 shrink-0 text-slate-400" />
          {race.organizer} · {race.price}
        </p>
      </div>
      <div className="border-t border-slate-100 px-4 py-2.5">
        <a
          href={race.registrationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-[#0b2b22] text-sm font-semibold text-white active:bg-[#124d3c]"
        >
          {race.registrationOpen ? "Register" : "View details"}
          <Icon name="external" className="h-4 w-4 text-[#c8f169]" />
        </a>
        <p className="mt-1.5 text-center text-[11px] text-slate-400">{race.registrationNote ?? "Opens on the organizer's site"}</p>
      </div>
    </article>
  );
}

export function RacesPage({ city }: { city: City }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Races</h1>
      <p className="mt-0.5 text-sm font-medium text-slate-500">
        Upcoming races in {city.name}, {city.state} — registration on the organizer's site.
      </p>

      <ul className="mt-4 space-y-3">
        {city.races.map((r) => (
          <li key={r.id}>
            <RaceCard race={r} />
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
          <Icon name="spark" className="h-5 w-5" />
        </span>
        <p className="text-[13px] leading-relaxed text-slate-600">
          <span className="font-semibold text-slate-800">Missing a race?</span> Race submissions arrive in a later phase —
          organizers will be able to list their own events.
        </p>
      </div>

      <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
        Sample seed listings for the MVP — always confirm details on the organizer's site.
      </p>
    </div>
  );
}
