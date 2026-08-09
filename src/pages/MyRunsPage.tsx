import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { Icon } from "../components/ui";
import { useAccount } from "../state/account";
import { useToast } from "../lib/toast";
import { formatRunDate, orderMyRuns } from "../lib/myRuns";

type View = "list" | "calendar";

export function MyRunsPage() {
  const { me } = useAccount();
  const toast = useToast();
  const [runs, setRuns] = useState<api.MyRunView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const load = () => { setLoading(true); setError(null); setErrorCode(null); void api.getMyRuns().then((r) => { if (r.ok) setRuns(r.data.runs); else { setError(r.error.message); setErrorCode(r.error.code); } setLoading(false); }); };
  useEffect(() => { if (me?.status === "signed_in") load(); else setLoading(false); }, [me?.status]);
  const sections = useMemo(() => orderMyRuns(runs), [runs]);
  if (me?.status !== "signed_in") return <Page><h1>My Runs</h1><p className="mt-2 text-slate-600">Sign in to see your private RSVP list.</p><Link className="mt-5 inline-flex min-h-11 items-center rounded-[10px] bg-[#14171C] px-4 py-2 font-semibold text-white" to="/login">Sign in</Link></Page>;
  if (me.account.status !== "verified") return <Page><h1>My Runs</h1><p className="mt-2 text-slate-600">Email verification is required to view your private RSVPs.</p><Link className="mt-5 inline-flex min-h-11 items-center rounded-[10px] bg-[#14171C] px-4 py-2 font-semibold text-white" to="/verify">Verify your account</Link></Page>;
  if (loading) return <Page><h1>My Runs</h1><p className="mt-8 text-center text-slate-500">Loading your RSVPs…</p></Page>;
  if (errorCode === "verified_runner_required") return <Page><h1>My Runs</h1><p className="mt-3 text-slate-600">Verification is required to view your private RSVPs.</p><Link className="mt-5 inline-flex min-h-11 items-center rounded-[10px] bg-[#14171C] px-4 py-2 font-semibold text-white" to="/verify">Verify your account</Link></Page>;
  if (error) return <Page><h1>My Runs</h1><p className="mt-3 text-slate-600">We couldn’t load your runs.</p><button onClick={load} className="mt-5 inline-flex min-h-11 items-center rounded-[10px] bg-[#14171C] px-4 py-2 font-semibold text-white">Try again</button></Page>;
  const hasRuns = sections.upcoming.length + sections.past.length > 0;
  return <Page><div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-start"><div><h1>My Runs</h1><p className="mt-2 text-sm text-slate-500">Your private RSVP list. Only you can see it.</p></div><div className="flex shrink-0 rounded-xl bg-slate-100 p-1" role="group" aria-label="My Runs view"><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className={`min-h-11 rounded-lg px-3 py-2 text-xs font-bold ${view === "list" ? "bg-white shadow-sm" : "text-slate-500"}`}>List</button><button type="button" aria-pressed={view === "calendar"} onClick={() => setView("calendar")} className={`min-h-11 rounded-lg px-3 py-2 text-xs font-bold ${view === "calendar" ? "bg-white shadow-sm" : "text-slate-500"}`}>Calendar</button></div></div>{actionError ? <div role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-800 ring-1 ring-rose-200">{actionError}</div> : null}{!hasRuns ? <Empty /> : view === "calendar" ? <Agenda upcoming={sections.upcoming} past={sections.past} onRemove={remove} removingId={removingId} /> : <div className="mt-6 space-y-8">{sections.upcoming.length > 0 && <RunSection title="Upcoming" runs={sections.upcoming} onRemove={remove} removingId={removingId} upcoming />}{sections.past.length > 0 && <RunSection title="Past" runs={sections.past} onRemove={remove} removingId={removingId} />}</div>}</Page>;
  function remove(run: api.MyRunView) {
    if (removingId) return;
    setRemovingId(run.id); setActionError(null);
    // Remove by the exact attendance row (runId) so one occurrence is never
    // confused with a sibling occurrence of the same event. The server stays
    // authoritative: it resolves the row from the session, never from input.
    void api.rsvpEvent(run.eventId, false, run.date, run.id).then((r) => {
      if (r.ok) { toast(`RSVP removed for "${run.title}".`); load(); }
      else setActionError(r.error.message ?? "Couldn't remove this RSVP. Try again.");
      setRemovingId(null);
    });
  }
}
function RunSection({ title, runs, onRemove, removingId, upcoming = false }: { title: string; runs: api.MyRunView[]; onRemove: (r: api.MyRunView) => void; removingId?: string | null; upcoming?: boolean }) { return <section aria-labelledby={`my-runs-${title.toLowerCase()}`}><h2 id={`my-runs-${title.toLowerCase()}`} className="text-lg font-extrabold">{title}</h2><div className="mt-3 space-y-3">{runs.map((run) => <RunCard key={run.id} run={run} onRemove={onRemove} removing={removingId === run.id} upcoming={upcoming} />)}</div></section>; }
export function RunCard({ run, onRemove, removing = false, upcoming }: { run: api.MyRunView; onRemove: (r: api.MyRunView) => void; removing?: boolean; upcoming?: boolean }) { return <article className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${upcoming ? "hover:ring-slate-400" : ""}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1">{upcoming ? <><Link to={`/events/${run.eventId}`} className="block rounded-lg focus-visible:outline-none"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">{formatRunDate(run.date)} · {run.time}</p><h3 className="mt-1 break-words font-extrabold">{run.title}</h3><p className="mt-1 text-sm text-slate-500">{run.location}</p><span className="mt-3 inline-block text-xs font-bold text-emerald-800">View run details →</span></Link><Link to={`/events/${run.eventId}?discussion=${encodeURIComponent(run.occurrenceId ?? "")}`} className="mt-2 block text-xs font-bold text-sky-800">Run-day discussion →</Link></> : <><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{formatRunDate(run.date)} · {run.time}</p><h3 className="mt-1 break-words font-extrabold">{run.title}</h3><p className="mt-1 text-sm text-slate-500">{run.location || "Location unavailable"}</p><p className="mt-2 text-xs text-slate-500">This RSVP is preserved in your history. Public event details are no longer available.</p></>}</div><button aria-label={`Remove RSVP for ${run.title}`} onClick={() => onRemove(run)} disabled={removing} className={`min-h-11 shrink-0 rounded-[10px] bg-slate-100 px-4 py-2 text-xs font-bold ${removing ? "cursor-default text-slate-400" : "text-slate-700"}`}>{removing ? "Removing…" : "Remove"}</button></div></article>; }
export function Agenda({ upcoming, past, onRemove, removingId }: { upcoming: api.MyRunView[]; past: api.MyRunView[]; onRemove: (r: api.MyRunView) => void; removingId?: string | null }) { const runs = [...upcoming, ...past]; const upcomingIds = new Set(upcoming.map((run) => run.id)); const groups = runs.reduce<Record<string, api.MyRunView[]>>((out, run) => ((out[run.date] ??= []).push(run), out), {}); return <div className="mt-6 space-y-6" aria-label="My Runs calendar agenda">{Object.keys(groups).sort().map((date) => <section key={date}><h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-500">{formatRunDate(date)}</h2><div className="mt-2 space-y-2">{groups[date].map((run) => <RunCard key={run.id} run={run} onRemove={onRemove} removing={removingId === run.id} upcoming={upcomingIds.has(run.id)} />)}</div></section>)}</div>; }
function Empty() { return <div className="mt-10 text-center"><Icon name="calendar" className="mx-auto h-10 w-10 text-slate-300"/><p className="mt-3 font-semibold">No RSVPs yet</p><p className="mt-1 text-sm text-slate-500">Runs you RSVP to will appear here, with past history kept private.</p><Link className="mt-4 inline-flex min-h-11 items-center rounded-lg px-4 py-2 text-sm font-bold text-emerald-800 ring-1 ring-emerald-200" to="/">Browse this week's runs</Link></div>; }
function Page({ children }: { children: React.ReactNode }) { return <div className="my-runs-page mx-auto w-full max-w-[42rem] px-4 pb-32 pt-8 md:px-6"><div className="mb-5 flex items-center gap-2"><Icon name="rsvp" className="h-5 w-5 text-emerald-700"/><span className="text-xs font-bold uppercase tracking-widest text-slate-400">Private</span></div>{children}</div>; }
