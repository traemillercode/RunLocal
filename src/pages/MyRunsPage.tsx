import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { Icon } from "../components/ui";
import { useAccount } from "../state/account";

export function MyRunsPage() {
  const { me } = useAccount();
  const [runs, setRuns] = useState<api.MyRunView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = () => { setLoading(true); setError(null); void api.getMyRuns().then((r) => { if (r.ok) setRuns(r.data.runs); else setError(r.error.message); setLoading(false); }); };
  useEffect(() => { if (me?.status === "signed_in") load(); else setLoading(false); }, [me?.status]);
  if (me?.status !== "signed_in") return <Page><h1>My Runs</h1><p className="mt-2 text-slate-600">Sign in to see your private RSVP list.</p><Link className="mt-5 inline-flex rounded-full bg-[#14171C] px-5 py-3 font-semibold text-white" to="/login">Sign in</Link></Page>;
  if (loading) return <Page><h1>My Runs</h1><p className="mt-8 text-center text-slate-500">Loading your RSVPs…</p></Page>;
  if (error) return <Page><h1>My Runs</h1><p className="mt-3 text-slate-600">We couldn't load your runs.</p><button onClick={load} className="mt-5 rounded-full bg-[#14171C] px-5 py-3 font-semibold text-white">Try again</button></Page>;
  return <Page><h1>My Runs</h1><p className="mt-2 text-sm text-slate-500">Your private RSVP list. Only you can see it.</p>{runs.length === 0 ? <div className="mt-10 text-center"><Icon name="calendar" className="mx-auto h-10 w-10 text-slate-300"/><p className="mt-3 font-semibold">No RSVPs yet</p><Link className="mt-4 inline-block text-sm font-bold text-emerald-800" to="/">Browse this week's runs</Link></div> : <section className="mt-6 space-y-3" aria-label="Upcoming runs">{runs.map((run) => <article key={run.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">{new Date(`${run.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {run.time}</p><h2 className="mt-1 break-words font-extrabold">{run.title}</h2><p className="mt-1 text-sm text-slate-500">{run.location}</p></div><button aria-label={`Remove RSVP for ${run.title}`} onClick={() => void api.rsvpEvent(run.eventId, false).then((r) => { if (r.ok) load(); else setError(r.error.message); })} className="min-h-11 shrink-0 rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">Remove</button></div></article>)}</section>}</Page>;
}
function Page({ children }: { children: React.ReactNode }) { return <div className="mx-auto w-full max-w-md px-4 pb-32 pt-8"><div className="mb-5 flex items-center gap-2"><Icon name="rsvp" className="h-5 w-5 text-emerald-700"/><span className="text-xs font-bold uppercase tracking-widest text-slate-400">Private</span></div>{children}</div>; }
