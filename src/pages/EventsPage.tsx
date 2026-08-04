import { useEffect, useMemo, useState } from "react";
import { EventCard } from "../components/EventCard";
import { HomeCityBanner } from "../components/HomeCityBanner";
import { VerifiedGateSheet } from "../components/VerifiedGateSheet";
import { GroupSubmissionSheet, IndependentEventSheet } from "../components/SubmissionSheets";
import { Chip, Icon, PillButton } from "../components/ui";
import * as api from "../lib/api";
import { resolveWeekEvents, startOfWeek, weekRangeLabel, MONTHS } from "../lib/dates";
import { filterOneTimeEvents } from "../lib/activityDates";
import { Link } from "react-router-dom";
import { canDo, roleLabel } from "../lib/accounts";
import type { AppStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { useAccount } from "../state/account";
import { useModerated } from "../state/moderated";
import { usePublicContent } from "../state/content";
import { GROUP_TYPE_LABELS, type City } from "../types";

export function EventsPage({ city }: { city: City; store: AppStore }) {
  const toast = useToast();
  const { role, me } = useAccount();
  const { hidden, highlights, groupBadges } = useModerated();
  const { events: userEvents, groups: userGroups } = usePublicContent();
  const [query, setQuery] = useState("");
  const [eventSheetOpen, setEventSheetOpen] = useState(false);
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [myRunIds, setMyRunIds] = useState<Set<string>>(new Set());
  const weekStart = startOfWeek(new Date());
  const canRsvp = canDo(role, "rsvp");
  useEffect(() => {
    if (!canRsvp) { setMyRunIds(new Set()); return; }
    void api.getMyRuns().then((r) => { if (r.ok) setMyRunIds(new Set(r.data.runs.map((run) => run.eventId))); });
  }, [canRsvp]);
  const isGroupLeader = me?.status === "signed_in" && me.account.role === "group_leader";

  // Merge approved recurring independent events into the weekly model. Only
  // approved events arrive here (server-filtered).
  const events = useMemo(() => {
    const recurring: typeof city.events = userEvents
      .filter((e) => e.type === "recurring" && e.dayOfWeek !== null)
      .map((e) => ({
        id: e.id,
        groupId: "",
        title: e.title,
        dayOfWeek: e.dayOfWeek!,
        time: e.time,
        location: e.location,
        distanceLabel: e.distanceLabel,
        invite: e.invite,
        externalUrl: e.externalUrl ?? undefined,
      }));
    const today = new Date();
    // Recurring seed slots describe the full weekly schedule, including a
    // Monday slot after Monday has passed; one-time community activity is
    // filtered separately below by its calendar date.
    const resolved = resolveWeekEvents([...city.events, ...recurring], today)
      .filter((e) => !hidden.has(`event:${e.id}`))
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
  }, [city, query, hidden, highlights, userEvents]);

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

  // One-time independent events whose date falls within the current week.
  const oneOffThisWeek = useMemo(() => {
    const start = startOfWeek(new Date());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59);
    return filterOneTimeEvents(userEvents, "upcoming")
      .filter((e) => e.date)
      .filter((e) => {
        const d = new Date(`${e.date}T00:00:00`);
        return d >= start && d <= end && !hidden.has(`event:${e.id}`);
      })
      .sort((a, b) => a.date!.localeCompare(b.date!));
  }, [userEvents, hidden]);

  const onRsvp = (eventId: string, title: string) => {
    if (!canRsvp) {
      setGateOpen(true);
      return;
    }
    const nowRsvped = !myRunIds.has(eventId);
    // Server-side RSVP: shared-attendance record (rating eligibility basis).
    void api.rsvpEvent(eventId, nowRsvped).then((r) => {
      if (!r.ok) {
        toast(r.error.message ?? "Couldn't save your RSVP. Try again.", "info");
        return;
      }
      setMyRunIds((ids) => { const next = new Set(ids); if (nowRsvped) next.add(eventId); else next.delete(eventId); return next; });
      toast(nowRsvped ? `You're in for "${title}"!` : `RSVP removed for "${title}".`, nowRsvped ? "success" : "neutral");
    });
  };

  const openEvent = () => {
    if (role === "verified") setEventSheetOpen(true);
    else setGateOpen(true);
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
        <div className="flex gap-1.5">
          <PillButton variant="secondary" onClick={openEvent} className="min-h-11 px-3">
            <Icon name="plus" className="h-4 w-4" /> Host a run
          </PillButton>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <PillButton
          variant="ghost"
          className="min-h-9 flex-1 px-3 text-[12px]"
          onClick={() => {
            if (role === "verified") setGroupSheetOpen(true);
            else setGateOpen(true);
          }}
        >
          <Icon name="users" className="h-3.5 w-3.5" /> Start a group
        </PillButton>
      </div>
      <HomeCityBanner />
      <Link to="/past-events" className="mt-3 inline-flex min-h-10 items-center gap-1 rounded-full bg-slate-100 px-3 text-xs font-bold text-slate-700">View past events <Icon name="chevronRight" className="h-4 w-4" /></Link>
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
                const independent = e.groupId === "";
                return (
                  <li key={e.id}>
                    {independent ? (
                      <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
                        <div className="p-4 pb-3">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-[15px] font-bold leading-snug text-slate-900">{e.title}</h3>
                            <Chip tone="outline">Independent Runner</Chip>
                          </div>
                          <p className="mt-0.5 text-[13px] text-slate-500">{e.distanceLabel}</p>
                        </div>
                        <div className="space-y-1.5 px-4 pb-4 text-[13px] text-slate-600">
                          <p className="flex items-center gap-2"><Icon name="clock" className="h-4 w-4 text-slate-400" />{e.time}</p>
                          <p className="flex items-center gap-2"><Icon name="mapPin" className="h-4 w-4 text-slate-400" />{e.location}</p>
                          <p className="flex items-center gap-2"><Icon name="users" className="h-4 w-4 text-slate-400" />{e.invite}</p>
                        </div>
                        {e.externalUrl ? (
                          <div className="border-t border-slate-100 px-4 py-2.5">
                            <a href={e.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-[#0b2b22] text-sm font-semibold text-white">
                              Details <Icon name="external" className="h-4 w-4 text-[#c8f169]" />
                            </a>
                          </div>
                        ) : null}
                      </article>
                    ) : (
                      <EventCard
                        event={e}
                        city={city}
                        rsvped={myRunIds.has(e.id)}
                        canRsvp={canRsvp}
                        onRsvp={() => onRsvp(e.id, e.title)}
                        featured={hl?.featured}
                        pinned={hl?.pinned}
                        groupBadge={groupBadges.get(e.groupId)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {oneOffThisWeek.length > 0 ? (
        <section aria-label="One-time runs" className="mt-6">
          <h2 className="mb-2 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-slate-500">
            <span className="h-px flex-1 bg-slate-200" /> One-time runs this week
          </h2>
          <ul className="space-y-3">
            {oneOffThisWeek.map((e) => {
              const [, m, d] = e.date!.split("-").map(Number);
              return (
                <li key={e.id}>
                  <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
                    <div className="p-4 pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-[15px] font-bold leading-snug text-slate-900">{e.title}</h3>
                        <Chip tone="outline">Independent Runner</Chip>
                      </div>
                        <p className="mt-0.5 text-[13px] text-slate-500">{MONTHS[m - 1]} {d}, {e.time} · {e.distanceLabel}</p>
                    </div>
                    <div className="space-y-1.5 px-4 pb-4 text-[13px] text-slate-600">
                      <p className="flex items-center gap-2"><Icon name="mapPin" className="h-4 w-4 text-slate-400" />{e.location}</p>
                      {e.externalUrl ? (
                        <a href={e.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-full bg-[#0b2b22] text-sm font-semibold text-white">
                          Details <Icon name="external" className="h-4 w-4 text-[#c8f169]" />
                        </a>
                      ) : null}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {userGroups.length > 0 ? (
        <section aria-label="Community groups" className="mt-6">
          <h2 className="mb-2 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-slate-500">
            <span className="h-px flex-1 bg-slate-200" /> Community groups
          </h2>
          <ul className="space-y-3">
            {userGroups.map((g) => {
              const badge = groupBadges.get(g.id);
              const links = [["GroupMe", g.groupmeUrl], ["Facebook", g.facebookUrl], ["Instagram", g.instagramUrl], ["Website", g.websiteUrl]].filter(
                (l): l is [string, string] => Boolean(l[1]),
              );
              return (
                <li key={g.id}>
                  <article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-[15px] font-bold text-slate-900">{g.name}</h3>
                      <Chip tone={badge ? "volt" : "outline"}>{badge ? GROUP_TYPE_LABELS["rrca-chartered"] : GROUP_TYPE_LABELS.community}</Chip>
                    </div>
                    {g.description ? <p className="mt-1 text-[13px] text-slate-600">{g.description}</p> : null}
                    {links.length > 0 ? (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {links.map(([label, url]) => (
                          <a key={label} href={url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-700">
                            {label}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {isGroupLeader ? (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900">
          <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {roleLabel("group_leader")}s post runs through their group's event path; independent runs are reserved for verified runners without a Group Leader role.
        </p>
      ) : null}

      <IndependentEventSheet open={eventSheetOpen} onClose={() => setEventSheetOpen(false)} cityId={city.id} />
      <GroupSubmissionSheet open={groupSheetOpen} onClose={() => setGroupSheetOpen(false)} cityId={city.id} />

      <VerifiedGateSheet
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        role={role}
        actionLabel="submitting runs"
        pendingLabel="Your profile is still in review."
      />
    </div>
  );
}

