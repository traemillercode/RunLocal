import { useMemo, useState } from "react";
import { EventCard } from "../components/EventCard";
import { VerifiedGateSheet } from "../components/VerifiedGateSheet";
import { Icon, PillButton, Sheet } from "../components/ui";
import { resolveWeekEvents, startOfWeek, weekRangeLabel } from "../lib/dates";
import { canDo } from "../lib/accounts";
import type { AppStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { useAccount } from "../state/account";
import { useModerated } from "../state/moderated";
import type { City } from "../types";
export function EventsPage({ city, store }: { city: City; store: AppStore }) {
  const toast = useToast();
  const { role } = useAccount();
  const { hidden, highlights, groupBadges } = useModerated();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const weekStart = startOfWeek(new Date());
  const canRsvp = canDo(role, "rsvp");

  const events = useMemo(() => {
    const resolved = resolveWeekEvents(city.events, new Date())
      // Owner-hidden content is excluded from public rendering.
      .filter((e) => !hidden.has(`event:${e.id}`))
      // Featured first, then pinned — server-driven ordering facts.
      .sort((a, b) => {
        const ha = highlights.get(`event:${a.id}`);
        const hb = highlights.get(`event:${b.id}`);
        const ra = Number(!!ha?.featured) * 2 + Number(!!ha?.pinned);
        const rb = Number(!!hb?.featured) * 2 + Number(!!hb?.pinned);
        return rb - ra;
      });
    const q = query.trim().toLowerCase();
    if (!q) return resolved;
    return resolved.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.location.toLowerCase().includes(q) ||
        (city.groups.find((g) => g.id === e.groupId)?.name.toLowerCase() ?? "").includes(q),
    );
  }, [city, query, hidden, highlights]);

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
    if (!canRsvp) {
      setGateOpen(true);
      return;
    }
    const nowRsvped = !store.state.rsvped[eventId];
    store.toggleRsvp(eventId);
    toast(nowRsvped ? `You're in for "${title}"!` : `RSVP removed for "${title}".`, nowRsvped ? "success" : "neutral");
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
              {list.map((e) => {
                const hl = highlights.get(`event:${e.id}`);
                return (
                  <li key={e.id}>
                    <EventCard
                      event={e}
                      city={city}
                      rsvped={!!store.state.rsvped[e.id]}
                      canRsvp={canRsvp}
                      onRsvp={() => onRsvp(e.id, e.title)}
                      featured={hl?.featured}
                      pinned={hl?.pinned}
                      groupBadge={groupBadges.get(e.groupId)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {/* Host a run — verified-runner feature (submissions arrive with hosting) */}
      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} title="Submit a group run" subtitle="Hosting is a verified-runner feature">
        <div className="space-y-4">
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3.5 text-[13px] leading-relaxed text-amber-900">
            <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
            {role === "verified"
              ? "Run submissions launch in a later phase — verified hosts will add runs directly, no review queue for your own group."
              : "Run submissions are limited to verified runners and launch in a later phase. Finish verification first so you're ready."}
          </p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Run title</span>
            <input type="text" disabled placeholder="e.g. Tuesday Hill Repeats" className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-[16px] text-slate-400 outline-none" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Day, time & location</span>
            <input type="text" disabled placeholder="Coming with verification" className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-[16px] text-slate-400 outline-none" />
          </label>
          {role === "verified" ? (
            <PillButton variant="primary" className="w-full" onClick={() => setCreateOpen(false)}>
              <Icon name="check" className="h-4 w-4" /> Submissions open in a later phase
            </PillButton>
          ) : (
            <PillButton
              variant="primary"
              className="w-full"
              onClick={() => {
                setCreateOpen(false);
                setGateOpen(true);
              }}
            >
              <Icon name="shield" className="h-4 w-4" /> {role === "pending" ? "Continue verification" : "Get verified"}
            </PillButton>
          )}
          <p className="text-center text-xs text-slate-400">Preview build — submission form is disabled on purpose.</p>
        </div>
      </Sheet>

      <VerifiedGateSheet
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        role={role}
        actionLabel="RSVPing to runs"
        pendingLabel="Your profile is still in review."
      />
    </div>
  );
}
