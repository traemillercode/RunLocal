/**
 * Event detail — the in-app destination for a tapped event card on the home /
 * Events feed. Shows the existing RunEvent model info (title, host, date/time,
 * location, meet-up notes, invite, external links) plus the RSVP action, so the
 * card's primary tap navigates here instead of dead-ending.
 *
 * `EventDetailView` is a hook-free presentational body (driven by props) so UI
 * tests can render the real detail markup with react-dom/server; the page
 * resolves the event from the weekly model and wires up navigation + RSVP.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Chip, Icon, Sheet } from "../components/ui";
import type { IconName } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { RailCard, RailStack } from "../components/RailCard";
import { ActionMenu } from "../components/ActionMenu";
import { ModerationConfirmSheet } from "../components/ModerationConfirmSheet";
import { VerifiedGateSheet } from "../components/VerifiedGateSheet";
import * as api from "../lib/api";
import { dayLabel, monthDayLabel, resolveWeekEvents, bareEventId, occurrenceIdFor, localDateLabel, canonicalEventActions, preferCanonicalFields, type DatedRunEvent } from "../lib/dates";
import { actionMenuItems, type ActionKey } from "../lib/actionModel";
import { eventConfirmMeta, EventEditSheet, type EventEditDraft, type EventConfirmAction, type EventConfirmKind } from "./EventsPage";
import { isOccurrenceRsvped } from "../lib/myRuns";
import { canDo } from "../lib/accounts";
import type { AppStore } from "../lib/store";
import type { City, RunGroup } from "../types";
import { GROUP_TYPE_LABELS } from "../types";
import { useToast } from "../lib/toast";
import { useAccount } from "../state/account";
import { useModerated } from "../state/moderated";
import { usePublicContent } from "../state/content";

function DetailRow({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 text-[14px] text-slate-700">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
        <Icon name={icon} className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 leading-relaxed">{children}</span>
    </p>
  );
}

function goingInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "R";
}

/**
 * "X connections going" strip — the viewer's accepted connections who RSVP'd to
 * this exact occurrence (server-computed, canView-filtered). The server is the
 * only authority on who qualifies; an EMPTY array renders nothing (never "0
 * connections going"). Avatar stack caps at 5 with a "+N" overflow badge, and
 * the row links to /connections.
 */
export function ConnectionsGoingRow({ connections }: { connections: api.ConnectionGoingRow[] }) {
  if (connections.length === 0) return null;
  const shown = connections.slice(0, 5);
  const extra = connections.length - shown.length;
  return (
    <Link
      to="/connections"
      className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5 active:bg-slate-50"
    >
      <span className="flex shrink-0 items-center -space-x-2">
        {shown.map((c) =>
          c.profilePhotoUrl ? (
            <img key={c.accountId} src={c.profilePhotoUrl} alt="" className="h-6 w-6 rounded-full object-cover ring-2 ring-white md:h-7 md:w-7" />
          ) : (
            <span key={c.accountId} className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600 ring-2 ring-white md:h-7 md:w-7">
              {goingInitials(c.name)}
            </span>
          ),
        )}
        {extra > 0 ? (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-700 ring-2 ring-white md:h-7 md:w-7">
            +{extra}
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1 text-[13px] font-semibold text-slate-700">
        {connections.length} connection{connections.length === 1 ? "" : "s"} going
      </span>
      <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-slate-400" />
    </Link>
  );
}

export function EventDetailView({
  event,
  city,
  rsvped,
  canRsvp,
  onRsvp,
  featured = false,
  pinned = false,
  groupBadge,
  capabilities = [],
  onAction,
  connectionsGoing = [],
}: {
  event: DatedRunEvent;
  city: City;
  rsvped: boolean;
  canRsvp: boolean;
  onRsvp: () => void;
  onBack: () => void;
  featured?: boolean;
  pinned?: boolean;
  groupBadge?: boolean;
  /** Server-computed moderation capabilities — empty/absent renders no menu. */
  capabilities?: string[];
  /** Menu action dispatcher — the page maps hide/restore/delete to confirm sheets. */
  onAction?: (key: ActionKey) => void;
  /** Viewer's connections RSVP'd to this occurrence (server-computed). */
  connectionsGoing?: api.ConnectionGoingRow[];
}) {
  const group: RunGroup | undefined = city.groups.find((g) => g.id === event.groupId);
  const rrca = groupBadge ?? group?.groupType === "rrca-chartered";
  const label = group ? (rrca ? GROUP_TYPE_LABELS["rrca-chartered"] : GROUP_TYPE_LABELS.community) : null;
  const actionItems = actionMenuItems(capabilities);
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading">
      <BackLink to="/events">Back to Events</BackLink>

      <article className="desktop-detail-card rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <div className="rounded-t-2xl bg-[#14171C] p-5 text-white">
          <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-[#FF5741]">
            {dayLabel(event.date, new Date())} · {event.time}
            {event.isToday ? (
              <Chip tone="volt">
                <Icon name="spark" className="h-3 w-3" /> Today
              </Chip>
            ) : null}
          </p>
          <h1 className="mt-2 text-2xl font-extrabold leading-tight tracking-tight">{event.title}</h1>
          {group ? (
            <p className="mt-1.5 text-sm font-medium text-white/75">
              {group.name}
              {label ? <span className="ml-1.5 font-normal text-white/60">· {label}</span> : null}
            </p>
          ) : null}
        </div>

        <ConnectionsGoingRow connections={connectionsGoing} />

        <div className="space-y-3.5 p-5">
          <div className="flex flex-wrap items-center gap-1.5">
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
            <Chip tone={event.invite === "Open to all" ? "emerald" : "amber"}>{event.invite}</Chip>
            {group ? null : <Chip tone="outline">Independent Runner</Chip>}
            {actionItems.length > 0 ? (
              <span className="ml-auto">
                <ActionMenu entityTitle={event.title} items={actionItems} onSelect={(key) => onAction?.(key)} />
              </span>
            ) : null}
          </div>

          <DetailRow icon="calendar">
            {monthDayLabel(event.date)}, {event.time}
          </DetailRow>
          <DetailRow icon="mapPin">{event.location}</DetailRow>
          <DetailRow icon="flag">{event.distanceLabel}</DetailRow>
          <DetailRow icon="rsvp">{event.invite}</DetailRow>

          {event.externalUrl ? (
            <a
              href={event.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[#14171C] text-sm font-semibold text-white active:bg-[#252a31]"
            >
              External details <Icon name="external" className="h-4 w-4 text-[#FF5741]" />
            </a>
          ) : null}
        </div>

        <div className="px-5 pb-5">
          <button
            type="button"
            onClick={onRsvp}
            className={`inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-colors ${
              rsvped
                ? "bg-emerald-100 text-emerald-800"
                : canRsvp
                  ? "bg-[#FF5741] text-[#14171C] active:bg-[#e94735]"
                  : "bg-slate-100 text-slate-500 active:bg-slate-200"
            }`}
          >
            {rsvped ? (
              <>
                <Icon name="check" className="h-4 w-4" /> Remove from My Runs
              </>
            ) : canRsvp ? (
              <>
                <Icon name="rsvp" className="h-4 w-4" /> Add to My Runs
              </>
            ) : (
              <>
                <Icon name="rsvp" className="h-4 w-4" /> Add to My Runs
              </>
            )}
          </button>
        </div>
      </article>
    </div>
  );
}

export type DiscussionViewStatus = "idle" | "loading" | "open" | "denied" | "missing" | "error";

/**
 * Map a discussion fetch result to the panel state (pure, SSR-testable). The
 * SERVER is the authority on exact-occurrence participation: a 200 opens the
 * panel, `participant_required` (403) means the caller is not a verified
 * participant of this exact occurrence, `discussion_unavailable` (404) means
 * the run is hidden/archived/unresolvable, and anything else is an error. The
 * client never guesses eligibility from its own filtered My Runs list, which
 * is what made discussions appear closed to legitimately RSVP'd runners.
 */
export function discussionViewStatus(result: api.ApiResult<{ discussion: api.DiscussionView[] }>): DiscussionViewStatus {
  if (result.ok) return "open";
  if (result.error.code === "participant_required") return "denied";
  if (result.error.code === "discussion_unavailable") return "missing";
  return "error";
}

/**
 * Run-day discussion panel. `canView` is the client-side role gate (verified
 * only) — it never decides PARTICIPATION: the panel fetches and the server
 * grants or denies access for the exact occurrence. Verified RSVP'd runners
 * (and authorized hosts) see the discussion; everyone else sees the
 * informational/denied copy, and no discussion content ever renders without a
 * 200 from the server.
 */
export function DiscussionPanel({ eventId, occurrenceId, canView, refreshKey = 0 }: { eventId: string; occurrenceId: string; canView: boolean; refreshKey?: number }) {
  const { me } = useAccount();
  const [items, setItems] = useState<api.DiscussionView[]>([]);
  const [status, setStatus] = useState<DiscussionViewStatus>("idle");
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [postError, setPostError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!canView) { setStatus("idle"); setItems([]); return; }
    let alive = true;
    setStatus("loading");
    void api.getOccurrenceDiscussion(eventId, occurrenceId).then((r) => {
      if (!alive) return;
      if (r.ok) setItems(r.data.discussion);
      setStatus(discussionViewStatus(r));
    });
    return () => { alive = false; };
  }, [canView, eventId, occurrenceId, refreshKey, reloadKey]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setPostError(false);
    void api.createDiscussion(eventId, occurrenceId, { body: body.trim(), ...(replyTo ? { parentId: replyTo } : { title: title.trim() }) }).then((r) => {
      if (r.ok) { setBody(""); setTitle(""); setReplyTo(null); setReloadKey((n) => n + 1); }
      else setPostError(true);
    });
  };
  if (!canView || status === "denied") {
    return <section className="mt-6 rounded-2xl bg-slate-100 p-5"><h2 className="font-extrabold">Run-day discussion</h2><p className="mt-2 text-sm text-slate-500">Discussion is available to verified runners who RSVP for this occurrence.</p></section>;
  }
  if (status === "missing") {
    return <section className="mt-6 rounded-2xl bg-slate-100 p-5"><h2 className="font-extrabold">Run-day discussion</h2><p className="mt-2 text-sm text-slate-500">This discussion is unavailable because the run is hidden, archived, or no longer available.</p></section>;
  }
  if (status === "idle" || status === "loading") {
    return <section aria-label="Run-day discussion" className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><h2 className="font-extrabold">Run-day discussion</h2><p className="mt-3 text-sm text-slate-500">Loading discussion…</p></section>;
  }
  if (status === "error") {
    return <section aria-label="Run-day discussion" className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><h2 className="font-extrabold">Run-day discussion</h2><div className="mt-3"><p className="text-sm text-slate-600">We couldn't load the discussion.</p><button type="button" onClick={() => setReloadKey((n) => n + 1)} className="mt-2 text-sm font-bold text-emerald-800">Try again</button></div></section>;
  }
  return <section aria-label="Run-day discussion" className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><h2 className="font-extrabold">Run-day discussion</h2>{items.length === 0 ? <p className="mt-3 text-sm text-slate-500">No discussion yet. Start the conversation for this run.</p> : <div className="mt-3 space-y-3">{items.map((i) => <article key={i.id} className="rounded-xl bg-slate-50 p-3"><p className="text-sm font-bold">{i.title ?? "Comment"}</p><p className="mt-1 text-sm text-slate-700">{i.body}</p><div className="mt-2 flex gap-3"><button type="button" onClick={() => setReplyTo(i.id)} className="text-xs font-bold text-emerald-800">Reply</button>{me?.status === "signed_in" && i.authorId === me.account.id ? <button type="button" onClick={() => void api.deleteDiscussion(eventId, occurrenceId, i.id).then((r) => { if (r.ok) setReloadKey((n) => n + 1); else setPostError(true); })} className="text-xs font-bold text-rose-700">Delete</button> : null}</div></article>)}</div>}<form onSubmit={submit} className="mt-4 space-y-2">{!replyTo && <input aria-label="Thread title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Thread title" className="w-full rounded-xl border border-slate-200 p-3 text-sm" />}<textarea aria-label="Discussion message" value={body} onChange={(e) => setBody(e.target.value)} placeholder={replyTo ? "Write a comment…" : "Write a thread…"} className="min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm" />{postError ? <p className="text-xs font-semibold text-rose-700">Couldn't post — check your message and try again.</p> : null}<button className="rounded-[10px] bg-[#FF5741] px-4 py-2 text-sm font-bold">{replyTo ? "Post comment" : "Post thread"}</button></form></section>;
}

export function EventDetailPage({ city }: { city: City; store: AppStore }) {
  const toast = useToast();
  const { role, me } = useAccount();
  const { hidden, highlights, groupBadges } = useModerated();
  const { events: userEvents } = usePublicContent();
  const { eventId } = useParams();
  const location = useLocation();
  const discussionOccurrenceId = new URLSearchParams(location.search).get("discussion");
  const navigate = useNavigate();
  const [gateOpen, setGateOpen] = useState(false);
  const [discussionRefresh, setDiscussionRefresh] = useState(0);
  const [myRuns, setMyRuns] = useState<api.MyRunView[]>([]);
  const [canonicalEvents, setCanonicalEvents] = useState<api.CanonicalEvent[]>([]);
  const [group, setGroup] = useState<api.PublicUserGroup | null>(null);
  const canRsvp = canDo(role, "rsvp");
  useEffect(() => {
    if (!canRsvp) { setMyRuns([]); return; }
    void api.getMyRuns().then((r) => { if (r.ok) setMyRuns(r.data.runs); });
  }, [canRsvp]);
  useEffect(() => { void api.getCanonicalEvents(city.id).then((r) => { if (r.ok) setCanonicalEvents(r.data.events); }); }, [city.id]);
  const canonicalActions = useMemo(() => canonicalEventActions(canonicalEvents), [canonicalEvents]);
  // Scoped moderation (group lead / admin): local hidden overlay + confirm sheet.
  const [localHidden, setLocalHidden] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<EventConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Scoped edit (group lead / admin): pre-filled EventEditSheet → PUT /api/events/:id.
  const [editTarget, setEditTarget] = useState<EventEditDraft | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Same weekly resolution as the home/Events feed so an EventCard link always
  // resolves here. Only recurring events render as EventCards; independent
  // one-time runs are separate cards and are out of scope for the detail route.
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
    const canonical = canonicalEvents.filter((e) => e.status === "published" && !e.hidden && !e.archivedAt).map((e) => ({ id:e.id, groupId:e.groupId, title:e.title, dayOfWeek:e.dayOfWeek, time:e.time, location:e.location, distanceLabel:e.distanceLabel, invite:e.invite, externalUrl:e.externalUrl ?? undefined }));
    // Canonical records are the server-authoritative post-edit source. When a
    // canonical record exists for a logical run (seed slot via seedRefId,
    // community event via bare refId), its fields win over the seed / weekly
    // copy — so a successful save (which replaces the record in
    // canonicalEvents) re-renders the visible card immediately, and a reload
    // shows the saved values. Ids are untouched, so URLs, RSVPs, and the
    // moderation capability index keep resolving exactly as before.
    return resolveWeekEvents([...city.events, ...canonical, ...recurring].map((e) => preferCanonicalFields(e, canonicalEvents)), new Date()).filter((e) => !hidden.has(`event:${bareEventId(e.id)}`) && !localHidden.has(`event:${bareEventId(e.id)}`));
  }, [city, hidden, userEvents, canonicalEvents, localHidden]);

  const event = events.find((e) => e.id === eventId) ?? null;
  // Leader tools: the roster link shows only when the signed-in verified
  // account owns or leads the event's group. The server re-checks
  // authorization on every roster call — this is discoverability only.
  const eventGroupId = event?.groupId ?? "";
  useEffect(() => {
    if (!eventGroupId) { setGroup(null); return; }
    let alive = true;
    void api.getPublicGroup(eventGroupId).then((r) => { if (alive && r.ok) setGroup(r.data.group); });
    return () => { alive = false; };
  }, [eventGroupId]);
  // Connections-going strip: the server returns the viewer's accepted
  // connections who RSVP'd to this EXACT occurrence, each gated by
  // canView(show_upcoming_events). Guests/pending/rejected get [] → no row.
  const [connectionsGoing, setConnectionsGoing] = useState<api.ConnectionGoingRow[]>([]);
  useEffect(() => {
    if (!canRsvp || !event) { setConnectionsGoing([]); return; }
    const occ = discussionOccurrenceId ?? occurrenceIdFor(event.id, localDateLabel(event.date));
    let alive = true;
    void api.getConnectionsGoing(event.id, occ).then((r) => { if (alive && r.ok) setConnectionsGoing(r.data); });
    return () => { alive = false; };
  }, [canRsvp, event, discussionOccurrenceId]);
  const isLeader = role === "verified" && !!group && me?.status === "signed_in" && (group.ownerId === me.account.id || (group.leaders ?? []).some((l) => l.id === me.account.id));

  if (!event) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400">
          <Icon name="calendar" className="h-7 w-7" />
        </span>
        <h1 className="mt-3 text-xl font-extrabold">Run not found</h1>
        <p className="mt-1 text-sm text-slate-500">This run isn't in the current week, or it's no longer listed.</p>
        <Link to="/" className="mt-4 inline-block rounded-[10px] bg-[#14171C] px-5 py-3 text-sm font-semibold text-white">
          Back to Events
        </Link>
      </div>
    );
  }

  const hl = highlights.get(`event:${event.id}`);
  // Canonical occurrence for this run: `event:<id>:<YYYY-MM-DD>`. When the
  // page is opened from My Runs with ?discussion=<occurrenceId>, that exact
  // occurrence wins (it is already authoritative); otherwise the resolved
  // date of the weekly model is used (local wall-clock label — never the
  // UTC-shifted ISO date, so a run dated the 11th stays the 11th for runners
  // east of UTC too). occurrenceIdFor never double-prefixes a canonical
  // `event:<id>`.
  const occurrenceId = discussionOccurrenceId ?? occurrenceIdFor(event.id, localDateLabel(event.date));
  const onRsvp = () => {
    if (!canRsvp) {
      setGateOpen(true);
      return;
    }
    const runDate = occurrenceId.slice(occurrenceId.lastIndexOf(":") + 1);
    const nowRsvped = !isOccurrenceRsvped(myRuns, event.id, occurrenceId);
    // Server-side RSVP: records shared attendance (rating eligibility basis).
    // Under-review accounts may still RSVP — the server permits it. The
    // server-returned occurrence id/date are authoritative for local state so
    // the button state and discussion panel always agree with what persisted.
    void api.rsvpEvent(event.id, nowRsvped, runDate).then((r) => {
      if (!r.ok) {
        toast(r.error.message ?? "Couldn't save your RSVP. Try again.", "info");
        return;
      }
      const serverOccurrenceId = r.data.occurrenceId ?? occurrenceId;
      const serverRunDate = r.data.runDate ?? runDate;
      setMyRuns((runs) => nowRsvped
        ? [...runs, { eventId: event.id, occurrenceId: serverOccurrenceId, date: serverRunDate } as api.MyRunView]
        : runs.filter((run) => !(bareEventId(run.eventId) === bareEventId(event.id) && run.occurrenceId === serverOccurrenceId)));
      setDiscussionRefresh((n) => n + 1);
      toast(nowRsvped ? `You're in for "${event.title}"!` : `RSVP removed for "${event.title}".`, nowRsvped ? "success" : "neutral");
    });
  };

  // Scoped moderation: same server-driven capability lookup as the Events feed.
  const eventCaps = canonicalActions.get(event.id) ?? canonicalActions.get(bareEventId(event.id));
  const openConfirm = (key: ActionKey) => {
    // Edit: pre-fill the shared EventEditSheet from the canonical record. The
    // menu already filters by the server capability list; this branch just
    // mirrors the Events feed — no action without a server copy (eventCaps).
    if (key === "edit") {
      if (!eventCaps) return;
      const rec = canonicalEvents.find((e) => e.id === eventCaps.id || (e.seedRefId !== null && e.seedRefId === bareEventId(event.id)));
      if (!rec) return;
      setEditTarget({
        eventId: eventCaps.id,
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
    if (!kind || !eventCaps) return;
    setConfirm({ kind, eventId: eventCaps.id, displayId: event.id, title: event.title });
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
        setEditError(null);
        // Reflect the server's updated canonical record so the visible detail
        // (title/time/location/distance/schedule) re-renders from the source
        // this page resolves the event from — same approach as the Events feed.
        setCanonicalEvents((cur) => (cur ? cur.map((e) => (e.id === r.data.event.id ? r.data.event : e)) : cur));
        toast("Run updated.", "success");
      } else {
        setEditError(r.error.message ?? "Couldn't save — try again.");
      }
    });
  };
  /** Close the edit sheet — blocked while the save is in flight (same guard as the feed). */
  const closeEdit = () => {
    if (editBusy) return;
    setEditTarget(null);
    setEditError(null);
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

  return (
    <>
      <div className="desktop-detail-layout">
      <div>
      <EventDetailView
        event={event}
        city={city}
        rsvped={isOccurrenceRsvped(myRuns, event.id, occurrenceId)}
        canRsvp={canRsvp}
        onRsvp={onRsvp}
        onBack={() => navigate(-1)}
        featured={hl?.featured}
        pinned={hl?.pinned}
        groupBadge={groupBadges.get(event.groupId)}
        capabilities={eventCaps?.capabilities}
        onAction={openConfirm}
        connectionsGoing={connectionsGoing}
      />
      {isLeader && eventGroupId ? (
        <Link
          to={`/groups/${encodeURIComponent(eventGroupId)}/roster?eventId=${encodeURIComponent(event.id)}&occurrenceId=${encodeURIComponent(`event:${event.id}:${localDateLabel(event.date)}`)}`}
          className="mt-6 flex items-center justify-between rounded-2xl bg-[#14171C] p-4 text-white shadow-sm"
        >
          <span>
            <span className="block font-extrabold">Check-in roster</span>
            <span className="block text-xs text-white/70">RSVPs, check-ins, and the new-runner QR for this run</span>
          </span>
          <Icon name="chevronRight" className="h-5 w-5 text-[#FF5741]" />
        </Link>
      ) : null}
      <DiscussionPanel eventId={event.id} occurrenceId={occurrenceId} canView={canRsvp} refreshKey={discussionRefresh} />
      </div>
      <RailStack ariaLabel="Run details summary">
        <RailCard kicker="Run details" title="Plan your arrival">
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">Review the start time, location, and distance before adding this run to My Runs.</p>
          <div className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500"><strong className="text-slate-700">Local note:</strong> Details come from the community listing.</div>
        </RailCard>
      </RailStack>
      </div>
      <VerifiedGateSheet open={gateOpen} onClose={() => setGateOpen(false)} role={role} actionLabel="adding this run to My Runs" pendingLabel="Your profile is still in review." rejectionReason={me?.status === "signed_in" ? me.account.rejectionReason ?? null : null} />
      <ModerationConfirmSheet
        open={confirm !== null}
        onClose={closeConfirm}
        {...(confirm ? eventConfirmMeta(confirm.kind, confirm.title) : { title: "", entity: "", impact: "", confirmLabel: "", requireReason: false })}
        busy={confirmBusy}
        error={confirmError}
        onConfirm={runConfirm}
      />
      <Sheet open={editTarget !== null} onClose={closeEdit} title="Edit run" subtitle="Changes are reviewed against the same rules as new runs.">
        {editTarget ? (
          <EventEditSheet
            draft={editTarget}
            submitting={editBusy}
            error={editError}
            onDraftChange={(patch) => setEditTarget((cur) => (cur ? { ...cur, ...patch } : cur))}
            onSubmit={saveEdit}
            onClose={closeEdit}
          />
        ) : null}
      </Sheet>
    </>
  );
}