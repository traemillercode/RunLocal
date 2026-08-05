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
import { Chip, Icon } from "../components/ui";
import { VerifiedGateSheet } from "../components/VerifiedGateSheet";
import * as api from "../lib/api";
import { dayLabel, monthDayLabel, resolveWeekEvents, type DatedRunEvent } from "../lib/dates";
import { canDo } from "../lib/accounts";
import type { AppStore } from "../lib/store";
import type { City, RunGroup } from "../types";
import { GROUP_TYPE_LABELS } from "../types";
import { useToast } from "../lib/toast";
import { useAccount } from "../state/account";
import { useModerated } from "../state/moderated";
import { usePublicContent } from "../state/content";

function DetailRow({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 text-[14px] text-slate-700">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
        <Icon name={icon} className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1 leading-relaxed">{children}</span>
    </p>
  );
}

export function EventDetailView({
  event,
  city,
  rsvped,
  canRsvp,
  onRsvp,
  onBack,
  featured = false,
  pinned = false,
  groupBadge,
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
}) {
  const group: RunGroup | undefined = city.groups.find((g) => g.id === event.groupId);
  const rrca = groupBadge ?? group?.groupType === "rrca-chartered";
  const label = group ? (rrca ? GROUP_TYPE_LABELS["rrca-chartered"] : GROUP_TYPE_LABELS.community) : null;
  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading">
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-[13px] font-semibold text-slate-500">
        <Icon name="chevronRight" className="h-4 w-4 rotate-180" /> Back to this week
      </button>

      <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
        <div className="bg-[#14171C] p-5 text-white">
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

export function DiscussionPanel({ eventId, occurrenceId, eligible, unavailable=false }: { eventId:string; occurrenceId:string; eligible:boolean; unavailable?:boolean }) {
  const { me } = useAccount();
  const [items,setItems]=useState<api.DiscussionView[]>([]); const [loading,setLoading]=useState(false); const [error,setError]=useState(false); const [body,setBody]=useState(""); const [title,setTitle]=useState(""); const [replyTo,setReplyTo]=useState<string|null>(null);
  const load=()=>{setLoading(true);setError(false);void api.getOccurrenceDiscussion(eventId,occurrenceId).then(r=>{if(r.ok)setItems(r.data.discussion);else setError(true);setLoading(false);});};
  useEffect(()=>{if(eligible)load();},[eligible,eventId,occurrenceId]);
  if(unavailable)return <section className="mt-6 rounded-2xl bg-slate-100 p-5"><h2 className="font-extrabold">Run-day discussion</h2><p className="mt-2 text-sm text-slate-500">This discussion is unavailable because the run is hidden, archived, or no longer available.</p></section>;
  if(!eligible)return <section className="mt-6 rounded-2xl bg-slate-100 p-5"><h2 className="font-extrabold">Run-day discussion</h2><p className="mt-2 text-sm text-slate-500">Discussion is available to verified runners who RSVP for this occurrence.</p></section>;
  const submit=(e:React.FormEvent)=>{e.preventDefault();if(!body.trim())return;void api.createDiscussion(eventId,occurrenceId,{body:body.trim(),...(replyTo?{parentId:replyTo}:{title:title.trim()} )}).then(r=>{if(r.ok){setBody("");setTitle("");setReplyTo(null);load();}else setError(true);});};
  return <section aria-label="Run-day discussion" className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><h2 className="font-extrabold">Run-day discussion</h2>{loading?<p className="mt-3 text-sm text-slate-500">Loading discussion…</p>:error?<div className="mt-3"><p className="text-sm text-slate-600">We couldn't load the discussion.</p><button type="button" onClick={load} className="mt-2 text-sm font-bold text-emerald-800">Try again</button></div>:items.length===0?<p className="mt-3 text-sm text-slate-500">No discussion yet. Start the conversation for this run.</p>:<div className="mt-3 space-y-3">{items.map(i=><article key={i.id} className="rounded-xl bg-slate-50 p-3"><p className="text-sm font-bold">{i.title ?? "Comment"}</p><p className="mt-1 text-sm text-slate-700">{i.body}</p><div className="mt-2 flex gap-3"><button type="button" onClick={()=>setReplyTo(i.id)} className="text-xs font-bold text-emerald-800">Reply</button>{me?.status === "signed_in" && i.authorId === me.account.id ? <button type="button" onClick={()=>void api.deleteDiscussion(eventId,occurrenceId,i.id).then(r=>{if(r.ok)load();else setError(true);})} className="text-xs font-bold text-rose-700">Delete</button> : null}</div></article>)}</div>}<form onSubmit={submit} className="mt-4 space-y-2">{!replyTo&&<input aria-label="Thread title" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Thread title" className="w-full rounded-xl border border-slate-200 p-3 text-sm"/>}<textarea aria-label="Discussion message" value={body} onChange={e=>setBody(e.target.value)} placeholder={replyTo?"Write a comment…":"Write a thread…"} className="min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm"/><button className="rounded-[10px] bg-[#FF5741] px-4 py-2 text-sm font-bold">{replyTo?"Post comment":"Post thread"}</button></form></section>;
}

export function EventDetailPage({ city }: { city: City; store: AppStore }) {
  const toast = useToast();
  const { role } = useAccount();
  const { hidden, highlights, groupBadges } = useModerated();
  const { events: userEvents } = usePublicContent();
  const { eventId } = useParams();
  const location = useLocation();
  const discussionOccurrenceId = new URLSearchParams(location.search).get("discussion");
  const navigate = useNavigate();
  const [gateOpen, setGateOpen] = useState(false);
  const [myRunIds, setMyRunIds] = useState<Set<string>>(new Set());
  const [myRuns, setMyRuns] = useState<api.MyRunView[]>([]);
  const [canonicalEvents, setCanonicalEvents] = useState<api.CanonicalEvent[]>([]);
  const canRsvp = canDo(role, "rsvp");
  useEffect(() => {
    if (!canRsvp) { setMyRunIds(new Set()); return; }
    void api.getMyRuns().then((r) => { if (r.ok) { setMyRuns(r.data.runs); setMyRunIds(new Set(r.data.runs.map((run) => run.eventId))); } });
  }, [canRsvp]);
  useEffect(() => { void api.getCanonicalEvents(city.id).then((r) => { if (r.ok) setCanonicalEvents(r.data.events); }); }, [city.id]);

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
    return resolveWeekEvents([...city.events, ...canonical, ...recurring], new Date()).filter((e) => !hidden.has(`event:${e.id}`));
  }, [city, hidden, userEvents, canonicalEvents]);

  const event = events.find((e) => e.id === eventId) ?? null;

  if (!event) {
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400">
          <Icon name="calendar" className="h-7 w-7" />
        </span>
        <h1 className="mt-3 text-xl font-extrabold">Run not found</h1>
        <p className="mt-1 text-sm text-slate-500">This run isn't in the current week, or it's no longer listed.</p>
        <Link to="/" className="mt-4 inline-block rounded-[10px] bg-[#14171C] px-5 py-3 text-sm font-semibold text-white">
          Back to this week
        </Link>
      </div>
    );
  }

  const hl = highlights.get(`event:${event.id}`);
  const onRsvp = () => {
    if (!canRsvp) {
      setGateOpen(true);
      return;
    }
    const occurrenceId = discussionOccurrenceId ?? `event:${event.id}:${event.date.toISOString().slice(0,10)}`;
    const runDate = occurrenceId.slice(occurrenceId.lastIndexOf(":") + 1);
    const nowRsvped = !myRuns.some((run) => run.eventId === event.id && run.occurrenceId === occurrenceId);
    // Server-side RSVP: records shared attendance (rating eligibility basis).
    // Under-review accounts may still RSVP — the server permits it.
    void api.rsvpEvent(event.id, nowRsvped, runDate).then((r) => {
      if (!r.ok) {
        toast(r.error.message ?? "Couldn't save your RSVP. Try again.", "info");
        return;
      }
      setMyRunIds((ids) => { const next = new Set(ids); if (nowRsvped) next.add(event.id); else next.delete(event.id); return next; });
      toast(nowRsvped ? `You're in for "${event.title}"!` : `RSVP removed for "${event.title}".`, nowRsvped ? "success" : "neutral");
    });
  };

  return (
    <>
      <div className="desktop-detail-layout">
      <div>
      <EventDetailView
        event={event}
        city={city}
        rsvped={myRuns.some((run) => run.eventId === event.id && run.occurrenceId === (discussionOccurrenceId ?? `event:${event.id}:${event.date.toISOString().slice(0,10)}`))}
        canRsvp={canRsvp}
        onRsvp={onRsvp}
        onBack={() => navigate(-1)}
        featured={hl?.featured}
        pinned={hl?.pinned}
        groupBadge={groupBadges.get(event.groupId)}
      />
      <DiscussionPanel eventId={event.id} occurrenceId={discussionOccurrenceId ?? `event:${event.id}:${event.date.toISOString().slice(0,10)}`} eligible={canRsvp && !!discussionOccurrenceId && myRuns.some((run) => run.eventId === event.id && run.occurrenceId === discussionOccurrenceId)} unavailable={!!discussionOccurrenceId && !myRuns.some((run) => run.eventId === event.id && run.occurrenceId === discussionOccurrenceId)} />
      </div>
      <aside className="desktop-detail-panel" aria-label="Run details summary">
        <p className="text-[11px] font-extrabold uppercase tracking-[.12em] text-[#FF5741]">Run details</p>
        <h2 className="mt-2 text-lg font-extrabold tracking-tight text-slate-900">Plan your arrival</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-600">Review the start time, location, and distance before adding this run to My Runs.</p>
        <div className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500"><strong className="text-slate-700">Local note:</strong> Details come from the community listing.</div>
      </aside>
      </div>
      <VerifiedGateSheet open={gateOpen} onClose={() => setGateOpen(false)} role={role} actionLabel="adding this run to My Runs" pendingLabel="Your profile is still in review." />
    </>
  );
}