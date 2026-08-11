import { useMemo, useState } from "react";
import { Chip, Icon, PillButton } from "../components/ui";
import { HomeCityBanner } from "../components/HomeCityBanner";
import { RaceSubmissionSheet } from "../components/SubmissionSheets";
import { VerifiedGateSheet } from "../components/VerifiedGateSheet";
import { formatRaceDate } from "../lib/dates";
import { isPastCalendarDate } from "../lib/activityDates";
import { useModerated } from "../state/moderated";
import { usePublicContent } from "../state/content";
import { useAccount } from "../state/account";
import type { City, Race } from "../types";

function RaceCard({ race, featured = false, pinned = false }: { race: Race; featured?: boolean; pinned?: boolean }) {
  return (
    <article className="desktop-race-card overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold leading-snug text-slate-900">{race.name}</h3>
          <p className="mt-0.5 text-[13px] font-medium text-slate-500">{race.distance}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {featured ? (
            <Chip tone="volt">
              <Icon name="spark" className="h-3 w-3" /> Featured
            </Chip>
          ) : null}
          {pinned ? (
            <Chip tone="amber">
              <Icon name="pin" className="h-3 w-3" /> Pinned
            </Chip>
          ) : null}
          {race.registrationOpen ? <Chip tone="emerald">Registration open</Chip> : <Chip tone="amber">{race.registrationNote ?? "Registration TBA"}</Chip>}
        </div>
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
      <div className="flex flex-col gap-1.5 border-t border-slate-100 px-4 py-2.5 lg:flex-row lg:items-center lg:justify-between">
        <a
          href={race.registrationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[#14171C] text-sm font-semibold text-white active:bg-[#252a31] lg:w-auto lg:px-4"
        >
          {race.registrationOpen ? "Register" : "View details"}
          <Icon name="external" className="h-4 w-4 text-[#FF5741]" />
        </a>
        <p className="text-center text-[11px] text-slate-400 lg:text-right">{race.registrationNote ?? "Opens on the organizer's site"}</p>
      </div>
    </article>
  );
}

export function RacesPage({ city }: { city: City }) {
  const { hidden, highlights } = useModerated();
  const { races: userRaces } = usePublicContent();
  const { role, me } = useAccount();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);

  const races = useMemo(() => {
    // Approved community submissions are mapped onto the public Race shape so
    // they render in the same cards; only approved records ever arrive here.
    const userAsRaces: Race[] = userRaces.map((r) => ({
      id: r.id,
      name: r.name,
      date: r.date,
      distance: r.distance,
      location: r.location,
      organizer: r.organizer,
      price: r.price,
      registrationUrl: r.registrationUrl,
      registrationOpen: r.registrationOpen,
      registrationNote: r.registrationNote,
    }));
    return [...city.races, ...userAsRaces]
      // Owner-hidden races are excluded from public rendering.
      .filter((r) => !hidden.has(`race:${r.id}`) && !isPastCalendarDate(r.date))
      // Featured first, then pinned — server-driven ordering facts.
      .sort((a, b) => {
        const ha = highlights.get(`race:${a.id}`);
        const hb = highlights.get(`race:${b.id}`);
        const ra = Number(!!ha?.featured) * 2 + Number(!!ha?.pinned);
        const rb = Number(!!hb?.featured) * 2 + Number(!!hb?.pinned);
        return rb - ra;
      });
  }, [city.races, userRaces, hidden, highlights]);

  return (
    <>
    <div className="desktop-races-layout desktop-browse-layout mx-auto w-full px-4 pb-32 pt-4">
      <div className="min-w-0">
      <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-end min-[420px]:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Races</h1>
          <p className="mt-0.5 text-sm font-medium text-slate-500">
            Upcoming races in {city.name}, {city.state} — registration on the organizer's site.
          </p>
        </div>
        <PillButton
          variant="secondary"
          className="min-h-11 w-full justify-center px-4 min-[420px]:w-auto"
          onClick={() => {
            if (role === "verified") setSheetOpen(true);
            else setGateOpen(true);
          }}
        >
          <Icon name="plus" className="h-4 w-4" /> Submit a race
        </PillButton>
      </div>
      <HomeCityBanner />

      <ul className="mt-4 space-y-3">
        {races.map((r) => {
          const hl = highlights.get(`race:${r.id}`);
          return (
            <li key={r.id}>
              <RaceCard race={r} featured={hl?.featured} pinned={hl?.pinned} />
            </li>
          );
        })}
      </ul>

      {userRaces.length > 0 ? (
        <p className="mt-3 text-center text-[11px] text-slate-400">
          Includes approved community-submitted races — always confirm details on the organizer's site.
        </p>
      ) : null}
      <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
        Sample seed listings plus approved community submissions — always confirm details on the organizer's site.
      </p>
      </div>
      <aside className="desktop-races-rail" aria-label="Race listings guidance">
        <section>
          <p className="desktop-rail-kicker">Race listings</p>
          <h2>Upcoming in {city.name}</h2>
          <p>{races.length} approved listing{races.length === 1 ? "" : "s"} visible here. Check each organizer's site for current details.</p>
        </section>
        <section>
          <p className="desktop-rail-kicker">Registration</p>
          <p>Registration and event details are handled by each race organizer. Use the link on a listing to confirm availability and requirements.</p>
        </section>
        <section>
          <p className="desktop-rail-kicker">Community submissions</p>
          <p>Verified runners can submit a race for review using the Submit a race button above.</p>
        </section>
      </aside>
    </div>

    <RaceSubmissionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} cityId={city.id} />
    <VerifiedGateSheet open={gateOpen} onClose={() => setGateOpen(false)} role={role} actionLabel="Submitting races" pendingLabel="Your profile is still in review." rejectionReason={me?.status === "signed_in" ? me.account.rejectionReason ?? null : null} />
    </>
  );
}
