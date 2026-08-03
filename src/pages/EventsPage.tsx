import { useMemo, useState } from "react";
import { EventCard } from "../components/EventCard";
import { SignInSheet } from "../components/SignInSheet";
import { Icon, PillButton, Sheet } from "../components/ui";
import { resolveWeekEvents, startOfWeek, weekRangeLabel } from "../lib/dates";
import type { AppStore } from "../lib/store";
import { useToast } from "../lib/toast";
import type { City } from "../types";

export function EventsPage({ city, store }: { city: City; store: AppStore }) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [signInOpen, setSignInOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingRsvpId, setPendingRsvpId] = useState<string | null>(null);

  const weekStart = startOfWeek(new Date());
  const events = useMemo(() => {
    const resolved = resolveWeekEvents(city.events, new Date());
    const q = query.trim().toLowerCase();
    if (!q) return resolved;
    return resolved.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.location.toLowerCase().includes(q) ||
        (city.groups.find((g) => g.id === e.groupId)?.name.toLowerCase() ?? "").includes(q),
    );
  }, [city, query]);

  // Group by resolved date for day headers.
  const groups = useMemo(() => {
    const map = new Map<string, typeof events>();
    for (const e of events) {
      const key = e.date.toDateString();
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [events]);

  const onRsvp = (eventId: string, title: string) => {
    if (store.isVerified) {
      const nowRsvped = !store.state.rsvped[eventId];
      store.toggleRsvp(eventId);
      toast(nowRsvped ? `You're in for "${title}"!` : `RSVP removed for "${title}".`, nowRsvped ? "success" : "neutral");
      return;
    }
    setPendingRsvpId(eventId);
    setSignInOpen(true);
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">This week</h1>
          <p className="mt-0.5 text-sm font-medium text-slate-500">
            {weekRangeLabel(weekStart)} · {city.name}, {city.state}
          </p>
        </div>
        <PillButton variant="secondary" onClick={() => setCreateOpen(true)} className="min-h-11 px-4">
          <Icon name="plus" className="h-4 w-4" /> Host a run
        </PillButton>
      </div>

      <div className="relative mt-4">
        <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          inputMode="search"
          aria-label="Search group runs"
          placeholder="Search runs, routes, or groups"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-12 w-full appearance-none rounded-full border border-slate-200 bg-white pl-11 pr-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0b2b22] focus:ring-2 focus:ring-[#c8f169]/60 [&::-webkit-search-cancel-button]:appearance-none"
        />
      </div>

      {groups.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-2 rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200/70">
          <Icon name="search" className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">No runs match “{query}”</p>
          <p className="text-xs text-slate-500">Try a route name, location, or group.</p>
        </div>
      ) : (
        groups.map(([key, list]) => (
          <section key={key} aria-label={list[0].dayAbbrev}>
            <h2 className="mb-2 mt-6 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-slate-500">
              <span className="h-px flex-1 bg-slate-200" />
              {list[0].dayAbbrev} · {new Date(key).getMonth() + 1}/{new Date(key).getDate()}
            </h2>
            <ul className="space-y-3">
              {list.map((e) => (
                <li key={e.id}>
                  <EventCard event={e} city={city} store={store} onRsvp={() => onRsvp(e.id, e.title)} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {/* Host a run — create-sheet affordance, gated for a later phase */}
      <Sheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Submit a group run"
        subtitle="Hosting is a verified-runner feature"
      >
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3.5 text-[13px] leading-relaxed text-amber-900">
            <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
            Run submissions launch in a later phase. Verified hosts will be able to add runs directly — no review queue for
            your own group.
          </p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Run title</span>
            <input
              type="text"
              disabled
              placeholder="e.g. Tuesday Hill Repeats"
              className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-[16px] text-slate-400 outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Day, time & location</span>
            <input
              type="text"
              disabled
              placeholder="Coming with verification"
              className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-[16px] text-slate-400 outline-none"
            />
          </label>
          <PillButton
            variant="primary"
            className="w-full"
            onClick={() => {
              setCreateOpen(false);
              setSignInOpen(true);
            }}
          >
            <Icon name="mail" className="h-4 w-4" /> Notify me when hosting launches
          </PillButton>
          <p className="text-center text-xs text-slate-400">Preview build — this form is disabled on purpose.</p>
        </div>
      </Sheet>

      <SignInSheet
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        store={store}
        reason={
          pendingRsvpId
            ? "RSVPs are tied to a runner profile. Sign-in & verification launch in a later phase — add your email and we'll let you know."
            : "Sign-in & verification launch in a later phase — add your email and we'll let you know."
        }
      />
    </div>
  );
}
