import { useEffect, useMemo, useState } from "react";
import { EventCard } from "../components/EventCard";
import { ActionMenu } from "../components/ActionMenu";
import { ModerationConfirmSheet } from "../components/ModerationConfirmSheet";
import { HomeCityBanner } from "../components/HomeCityBanner";
import { VerifiedGateSheet } from "../components/VerifiedGateSheet";
import { GroupSubmissionSheet, IndependentEventSheet } from "../components/SubmissionSheets";
import { Chip, Icon, PillButton, Sheet } from "../components/ui";
import * as api from "../lib/api";
import { resolveWeekEvents, startOfWeek, weekRangeLabel, MONTHS, occurrenceHasStarted, mergeWeekEventSources, bareEventId, canonicalEventActions, type DatedRunEvent } from "../lib/dates";
import { actionMenuItems, type ActionKey } from "../lib/actionModel";
import { rsvpedEventIds } from "../lib/myRuns";
import { filterOneTimeEvents } from "../lib/activityDates";
import { Link } from "react-router-dom";
import { canDo, roleLabel } from "../lib/accounts";
import type { AppStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { useAccount } from "../state/account";
import { useModerated } from "../state/moderated";
import { usePublicContent } from "../state/content";
import { GROUP_TYPE_LABELS, type City } from "../types";
import { HomeRightRail } from "../components/HomeRightRail";

/** A scoped event-moderation action awaiting confirmation in the sheet. */
export type EventConfirmKind = "hide" | "restore" | "delete";
export interface EventConfirmAction {
  kind: EventConfirmKind;
  /** Canonical event id to PATCH (/api/events/:id/moderation). */
  eventId: string;
  /** The id the row renders under — used to hide/restore it locally. */
  displayId: string;
  title: string;
}
/** Display config for the shared confirm sheet, derived from the pending action. */
export function eventConfirmMeta(kind: EventConfirmKind, title: string): {
  title: string;
  entity: string;
  impact: string;
  confirmLabel: string;
  requireReason: boolean;
} {
  switch (kind) {
    case "hide":
      return {
        title: "Hide this run?",
        entity: title,
        impact: "Members won't see it in the city schedule. You can restore it later.",
        confirmLabel: "Hide run",
        requireReason: true,
      };
    case "restore":
      return {
        title: "Restore this run?",
        entity: title,
        impact: "The run will be visible in the city schedule again.",
        confirmLabel: "Restore run",
        requireReason: false,
      };
    case "delete":
      return {
        title: "Delete this run?",
        entity: title,
        impact: "This can't be undone. The run will be removed from the city schedule; the record and audit trail are preserved.",
        confirmLabel: "Delete run",
        requireReason: true,
      };
  }
}

export interface EventEditDraft {
  eventId: string;
  title: string;
  time: string;
  location: string;
  distanceLabel: string;
  invite: string;
  externalUrl: string;
  dayOfWeek: number | null;
  scheduleDate: string | null;
}

/**
 * "Edit run" sheet body — presentational, prefilled from the canonical event.
 * Recurring events edit the weekday slot; one-time events edit the calendar
 * date. Save calls PUT /api/events/:id (server re-validates + audits).
 */
export function EventEditSheet({
  draft,
  submitting = false,
  error = null,
  onDraftChange,
  onSubmit,
  onClose,
}: {
  draft: EventEditDraft;
  submitting?: boolean;
  error?: string | null;
  onDraftChange: (patch: Partial<EventEditDraft>) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const oneTime = draft.dayOfWeek === null;
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Run title</span>
        <input type="text" value={draft.title} maxLength={100} onChange={(e) => onDraftChange({ title: e.target.value })} placeholder="e.g. Tuesday Track Night" className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Time</span>
          <input type="text" value={draft.time} maxLength={20} onChange={(e) => onDraftChange({ time: e.target.value })} placeholder="6:00 PM" className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Distance</span>
          <input type="text" value={draft.distanceLabel} maxLength={80} onChange={(e) => onDraftChange({ distanceLabel: e.target.value })} placeholder="3–5 miles" className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Location</span>
        <input type="text" value={draft.location} maxLength={160} onChange={(e) => onDraftChange({ location: e.target.value })} placeholder="Where does it meet?" className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Schedule</span>
          {oneTime ? (
            <input type="date" value={draft.scheduleDate ?? ""} onChange={(e) => onDraftChange({ scheduleDate: e.target.value || null })} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[16px] text-slate-900 outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
          ) : (
            <select value={String(draft.dayOfWeek)} onChange={(e) => onDraftChange({ dayOfWeek: Number(e.target.value) })} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[16px] text-slate-900 outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60">
              {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          )}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Who can join?</span>
          <select value={draft.invite} onChange={(e) => onDraftChange({ invite: e.target.value })} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[16px] text-slate-900 outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60">
            {["Open to all", "Members + guests", "RSVP requested"].map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Details link <span className="font-normal text-slate-400">(optional)</span></span>
        <input type="url" value={draft.externalUrl} onChange={(e) => onDraftChange({ externalUrl: e.target.value })} placeholder="https://…" className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
      </label>
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-[13px] font-semibold text-rose-800">{error}</p> : null}
      <div className="flex gap-3">
        <PillButton variant="ghost" className="flex-1" onClick={onClose} disabled={submitting}>Cancel</PillButton>
        <PillButton variant="primary" className="flex-1" disabled={submitting || !draft.title.trim() || !draft.location.trim()} onClick={onSubmit}>
          {submitting ? "Saving…" : "Save changes"}
        </PillButton>
      </div>
    </div>
  );
}

/**
 * One rendered weekly row — group-run EventCard or the independent-run article —
 * with the server-driven moderation ActionMenu attached. Pure presentational
 * body (driven by props) so UI tests can render the real row markup with
 * react-dom/server for each capability list.
 */
export function EventFeedRow({
  event,
  city,
  rsvped,
  canRsvp,
  featured,
  pinned,
  groupBadge,
  capabilities = [],
  onRsvp,
  onAction,
}: {
  event: DatedRunEvent;
  city: City;
  rsvped: boolean;
  canRsvp: boolean;
  featured?: boolean;
  pinned?: boolean;
  groupBadge?: boolean;
  capabilities?: string[];
  onRsvp: () => void;
  onAction: (key: ActionKey) => void;
}) {
  const actionItems = actionMenuItems(capabilities);
  if (event.groupId === "") {
    return (
      <article className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <div className="p-4 pb-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[15px] font-bold leading-snug text-slate-900">{event.title}</h3>
            <span className="flex shrink-0 items-center gap-1.5">
              <Chip tone="outline">Independent Runner</Chip>
              {actionItems.length > 0 ? <ActionMenu entityTitle={event.title} items={actionItems} onSelect={onAction} /> : null}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-slate-500">{event.distanceLabel}</p>
        </div>
        <div className="space-y-1.5 px-4 pb-4 text-[13px] text-slate-600">
          <p className="flex items-center gap-2"><Icon name="clock" className="h-4 w-4 text-slate-400" />{event.time}</p>
          <p className="flex items-center gap-2"><Icon name="mapPin" className="h-4 w-4 text-slate-400" />{event.location}</p>
          <p className="flex items-center gap-2"><Icon name="users" className="h-4 w-4 text-slate-400" />{event.invite}</p>
        </div>
        {event.externalUrl ? (
          <div className="border-t border-slate-100 px-4 py-2.5">
            <a href={event.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[#14171C] text-sm font-semibold text-white">
              Details <Icon name="external" className="h-4 w-4 text-[#FF5741]" />
            </a>
          </div>
        ) : null}
      </article>
    );
  }
  return (
    <EventCard
      event={event}
      city={city}
      rsvped={rsvped}
      canRsvp={canRsvp}
      onRsvp={onRsvp}
      featured={featured}
      pinned={pinned}
      groupBadge={groupBadge}
      capabilities={capabilities}
      onAction={onAction}
    />
  );
}

export function EventsPage({ city }: { city: City; store: AppStore }) {
  const toast = useToast();
  const { role, me } = useAccount();
  const { hidden, highlights, groupBadges } = useModerated();
  const { events: userEvents, groups: userGroups } = usePublicContent();
  const [query, setQuery] = useState("");
  /** Feed segment filter — All | Group runs | Independent runs (by groupId). */
  const [feedSegment, setFeedSegment] = useState<"all" | "group" | "independent">("all");
  const [eventSheetOpen, setEventSheetOpen] = useState(false);
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [myRunIds, setMyRunIds] = useState<Set<string>>(new Set());
  const [canonicalEvents, setCanonicalEvents] = useState<api.CanonicalEvent[] | null>(null);
  // Group Lead / admin scoped moderation: server-driven capability lookup keyed
  // by every id form a rendered row can carry, plus the confirm-sheet state and
  // a local hidden overlay so hide/delete removes the row immediately (same
  // behavior as the /api/moderated hidden set for operator actions).
  const [localHidden, setLocalHidden] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<EventConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EventEditDraft | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void api.getCanonicalEvents(city.id).then((r) => {
      if (alive && r.ok) setCanonicalEvents(r.data.events);
    });
    return () => { alive = false; };
  }, [city.id]);
  const canonicalActions = useMemo(() => canonicalEventActions(canonicalEvents ?? []), [canonicalEvents]);
  const capsFor = (event: { id: string }) => canonicalActions.get(bareEventId(event.id))?.capabilities ?? [];
  const weekStart = startOfWeek(new Date());
  const canRsvp = canDo(role, "rsvp");
  useEffect(() => {
    if (!canRsvp) { setMyRunIds(new Set()); return; }
    void api.getMyRuns().then((r) => { if (r.ok) setMyRunIds(rsvpedEventIds(r.data.runs)); });
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
    // The server registry (/api/events) materializes the seed slots as its own
    // rows (random ids, seedRefId pointing back at the seed id) and community
    // events as "event:<refId>" rows alongside the approved /api/content copy.
    // Dedupe by seedRefId / refId so each logical run renders exactly once.
    const merged = mergeWeekEventSources(city.events, canonicalEvents ?? [], recurring);
    // Recurring seed slots describe the full weekly schedule, including a
    // Monday slot after Monday has passed; one-time community activity is
    // filtered separately below by its calendar date.
    const resolved = resolveWeekEvents(merged, today)
      .filter((e) => !hidden.has(`event:${bareEventId(e.id)}`) && !localHidden.has(`event:${bareEventId(e.id)}`) && !occurrenceHasStarted(e, today))
      .sort((a, b) => {
        const ha = highlights.get(`event:${a.id}`);
        const hb = highlights.get(`event:${b.id}`);
        const ra = Number(!!ha?.featured) * 2 + Number(!!ha?.pinned);
        const rb = Number(!!hb?.featured) * 2 + Number(!!hb?.pinned);
        return rb - ra;
      });
    const q = query.trim().toLowerCase();
    const matched = !q
      ? resolved
      : resolved.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            e.location.toLowerCase().includes(q) ||
            (city.groups.find((g) => g.id === e.groupId)?.name.toLowerCase() ?? "").includes(q),
        );
    if (feedSegment === "group") return matched.filter((e) => e.groupId !== "");
    if (feedSegment === "independent") return matched.filter((e) => e.groupId === "");
    return matched;
  }, [city, query, feedSegment, hidden, highlights, userEvents, canonicalEvents, localHidden]);

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
        return d >= start && d <= end && !hidden.has(`event:${bareEventId(e.id)}`) && !localHidden.has(`event:${bareEventId(e.id)}`);
      })
      .sort((a, b) => a.date!.localeCompare(b.date!));
  }, [userEvents, hidden, localHidden]);

  const onRsvp = (eventId: string, title: string) => {
    if (!canRsvp) {
      setGateOpen(true);
      return;
    }
    const key = bareEventId(eventId);
    const nowRsvped = !myRunIds.has(key);
    // Server-side RSVP: shared-attendance record (rating eligibility basis).
    void api.rsvpEvent(eventId, nowRsvped).then((r) => {
      if (!r.ok) {
        toast(r.error.message ?? "Couldn't save your RSVP. Try again.", "info");
        return;
      }
      setMyRunIds((ids) => { const next = new Set(ids); if (nowRsvped) next.add(key); else next.delete(key); return next; });
      toast(nowRsvped ? `You're in for "${title}"!` : `RSVP removed for "${title}".`, nowRsvped ? "success" : "neutral");
    });
  };

  /** Menu dispatcher: map the capability key to a confirm-sheet state for the
   *  canonical event row (resolved via the id-form index). Unknown keys and
   *  rows without a server copy are ignored — the client never invents rights. */
  const openConfirm = (event: { id: string; title: string }, key: ActionKey) => {
    if (key === "edit") {
      const entry = canonicalActions.get(event.id) ?? canonicalActions.get(bareEventId(event.id));
      const rec = canonicalEvents?.find((e) => e.id === entry?.id || (e.seedRefId !== null && e.seedRefId === bareEventId(event.id)));
      if (!entry || !rec) return;
      setEditTarget({
        eventId: entry.id,
        title: rec.title,
        time: rec.time,
        location: rec.location,
        distanceLabel: rec.distanceLabel,
        invite: rec.invite,
        externalUrl: rec.externalUrl ?? "",
        dayOfWeek: rec.scheduleDate ? null : rec.dayOfWeek,
        scheduleDate: rec.scheduleDate ?? null,
      });
      setEditError(null);
      return;
    }
    const kind: EventConfirmKind | null = key === "hide" ? "hide" : key === "restore" ? "restore" : key === "delete" ? "delete" : null;
    if (!kind) return;
    const entry = canonicalActions.get(event.id) ?? canonicalActions.get(bareEventId(event.id));
    if (!entry) return;
    setConfirm({ kind, eventId: entry.id, displayId: event.id, title: event.title });
  };
  /** PUT /api/events/:id — the server re-validates scope + fields and audits. */
  const saveEdit = () => {
    if (!editTarget || editBusy) return;
    const t = editTarget;
    setEditBusy(true);
    setEditError(null);
    void api.updateEvent(t.eventId, {
      title: t.title.trim(),
      time: t.time.trim(),
      location: t.location.trim(),
      distanceLabel: t.distanceLabel.trim(),
      invite: t.invite,
      externalUrl: t.externalUrl.trim() || null,
      ...(t.dayOfWeek !== null ? { dayOfWeek: t.dayOfWeek } : { scheduleDate: t.scheduleDate }),
    }).then((r) => {
      setEditBusy(false);
      if (r.ok) {
        setEditTarget(null);
        // Reflect the server's updated canonical record so cards re-render.
        setCanonicalEvents((cur) => (cur ? cur.map((e) => (e.id === r.data.event.id ? r.data.event : e)) : cur));
        toast("Run updated.", "success");
      } else {
        setEditError(r.error.message ?? "Couldn't save — try again.");
      }
    });
  };
  const closeConfirm = () => {
    if (confirmBusy) return;
    setConfirm(null);
    setConfirmError(null);
  };
  /** Execute the confirmed action — PATCH /api/events/:id/moderation re-validates server-side. */
  const runConfirm = () => {
    if (!confirm || confirmBusy) return;
    const action = confirm;
    setConfirmBusy(true);
    setConfirmError(null);
    void api.moderateEvent(action.eventId, action.kind).then((r) => {
      setConfirmBusy(false);
      if (r.ok) {
        setConfirm(null);
        setConfirmError(null);
        const keys = [bareEventId(action.eventId), bareEventId(action.displayId)];
        if (action.kind === "hide" || action.kind === "delete") {
          setLocalHidden((s) => { const n = new Set(s); for (const k of keys) n.add(`event:${k}`); return n; });
        } else {
          setLocalHidden((s) => { const n = new Set(s); for (const k of keys) n.delete(`event:${k}`); return n; });
        }
        toast("Done.", "success");
      } else {
        setConfirmError(r.error.message ?? "That didn't work — try again.");
      }
    });
  };

  const openEvent = () => {
    if (role === "verified") setEventSheetOpen(true);
    else setGateOpen(true);
  };

  return (
    <div className="desktop-browse-layout mx-auto w-full max-w-md px-4 pb-32 pt-4">
      <div className="desktop-two-column"><div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900" data-tour-target="home-heading">This week</h1>
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
      <div role="group" aria-label="This week's runs" className="mt-3 flex gap-1 rounded-[10px] bg-slate-100 p-1">
        {([
          ["all", "All"],
          ["group", "Group runs"],
          ["independent", "Independent runs"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={feedSegment === value}
            onClick={() => setFeedSegment(value)}
            className={`h-9 flex-1 rounded-lg text-[13px] font-semibold transition-colors ${
              feedSegment === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2" data-tour-target="events-actions">
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
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[#14171C] p-3.5 text-white shadow-sm">
        <img src="/app/icons/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <p className="text-sm font-extrabold tracking-tight">Run <span className="text-[#FF5741]">Local</span></p>
          <p className="mt-0.5 text-xs leading-relaxed text-white/70">Local runs, races, and community — starting in {city.name}.</p>
        </div>
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
          className="h-12 w-full appearance-none rounded-full border border-slate-200 bg-white pl-11 pr-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60 [&::-webkit-search-cancel-button]:appearance-none"
        />
      </div>
      {groups.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-2 rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200/70">
          <Icon name="search" className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">
            {feedSegment === "group"
              ? "No group runs this week yet"
              : feedSegment === "independent"
                ? "No independent runs this week yet"
                : `No runs match “${query}”`}
          </p>
          <p className="text-xs text-slate-500">
            {feedSegment === "group"
              ? "Try the All view or check back next week."
              : feedSegment === "independent"
                ? "Try the All view or check back next week."
                : "Try a route name, location, or group."}
          </p>
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
                    <EventFeedRow
                      event={e}
                      city={city}
                      rsvped={myRunIds.has(bareEventId(e.id))}
                      canRsvp={canRsvp}
                      onRsvp={() => onRsvp(e.id, e.title)}
                      featured={hl?.featured}
                      pinned={hl?.pinned}
                      groupBadge={groupBadges.get(e.groupId)}
                      capabilities={capsFor(e)}
                      onAction={(key) => openConfirm(e, key)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {oneOffThisWeek.length > 0 && feedSegment !== "group" ? (
        <section aria-label="One-time runs" className="mt-6">
          <h2 className="mb-2 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-slate-500">
            <span className="h-px flex-1 bg-slate-200" /> One-time runs this week
          </h2>
          <ul className="space-y-3">
            {oneOffThisWeek.map((e) => {
              const [, m, d] = e.date!.split("-").map(Number);
              const oneOffItems = actionMenuItems(capsFor(e));
              return (
                <li key={e.id}>
                  <article className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
                    <div className="p-4 pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-[15px] font-bold leading-snug text-slate-900">{e.title}</h3>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <Chip tone="outline">Independent Runner</Chip>
                          {oneOffItems.length > 0 ? <ActionMenu entityTitle={e.title} items={oneOffItems} onSelect={(key) => openConfirm(e, key)} /> : null}
                        </span>
                      </div>
                        <p className="mt-0.5 text-[13px] text-slate-500">{MONTHS[m - 1]} {d}, {e.time} · {e.distanceLabel}</p>
                    </div>
                    <div className="space-y-1.5 px-4 pb-4 text-[13px] text-slate-600">
                      <p className="flex items-center gap-2"><Icon name="mapPin" className="h-4 w-4 text-slate-400" />{e.location}</p>
                      {e.externalUrl ? (
                        <a href={e.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[#14171C] text-sm font-semibold text-white">
                          Details <Icon name="external" className="h-4 w-4 text-[#FF5741]" />
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

      </div><HomeRightRail city={city} /></div>
      <IndependentEventSheet open={eventSheetOpen} onClose={() => setEventSheetOpen(false)} cityId={city.id} />
      <GroupSubmissionSheet open={groupSheetOpen} onClose={() => setGroupSheetOpen(false)} cityId={city.id} />

      <VerifiedGateSheet
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        role={role}
        actionLabel="submitting runs"
        pendingLabel="Your profile is still in review."
        rejectionReason={me?.status === "signed_in" ? me.account.rejectionReason ?? null : null}
      />

      <Sheet open={editTarget !== null} onClose={() => { if (!editBusy) { setEditTarget(null); setEditError(null); } }} title="Edit run" subtitle="Changes are reviewed against the same rules as new runs.">
        {editTarget ? (
          <EventEditSheet
            draft={editTarget}
            submitting={editBusy}
            error={editError}
            onDraftChange={(patch) => setEditTarget((cur) => (cur ? { ...cur, ...patch } : cur))}
            onSubmit={saveEdit}
            onClose={() => { if (!editBusy) { setEditTarget(null); setEditError(null); } }}
          />
        ) : null}
      </Sheet>

      <ModerationConfirmSheet
        open={confirm !== null}
        onClose={closeConfirm}
        {...(confirm ? eventConfirmMeta(confirm.kind, confirm.title) : { title: "", entity: "", impact: "", confirmLabel: "", requireReason: false })}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={runConfirm}
      />
    </div>
  );
}

