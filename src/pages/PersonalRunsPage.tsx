import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { useAccount } from "../state/account";

export function PersonalRunsPage() {
  const { me, role } = useAccount();
  const [runs, setRuns] = useState<api.PersonalRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [distanceLabel, setDistanceLabel] = useState("");
  const cityId = "columbia-mo";
  const load = () => { void api.getPersonalRuns().then((r) => { if (r.ok) setRuns(r.data.runs); else setMessage("We couldn't load your private runs."); }); };
  useEffect(() => { if (role === "verified") load(); }, [role]);
  if (me?.status !== "signed_in") return <Page><h1>Personal Runs</h1><p className="mt-2 text-slate-600">Sign in to keep a private calendar of your own runs.</p><Link className="mt-5 inline-flex rounded-full bg-[#0b2b22] px-5 py-3 font-semibold text-white" to="/login">Sign in</Link></Page>;
  if (role !== "verified") return <Page><h1>Personal Runs</h1><p className="mt-2 text-slate-600">Personal runs are available to verified runners.</p><Link className="mt-5 inline-flex rounded-full bg-[#0b2b22] px-5 py-3 font-semibold text-white" to="/verify">Verify account</Link></Page>;
  const submit = (e: FormEvent) => { e.preventDefault(); setBusy(true); setMessage(null); void api.createPersonalRun({ cityId, title, startsAt, locationLabel, distanceLabel, notes: null, consent: true }).then((r) => { if (r.ok) { setRuns((current) => [r.data.run, ...current]); setTitle(""); setStartsAt(""); setLocationLabel(""); setDistanceLabel(""); setMessage("Saved privately."); } else setMessage("Please check the title, date, and consent."); setBusy(false); }); };
  const remove = (id: string) => { void api.deletePersonalRun(id).then((r) => { if (r.ok) setRuns((current) => current.filter((run) => run.id !== id)); }); };
  return <Page><h1>Personal Runs</h1><p className="mt-2 text-sm text-slate-500">A private calendar for runs you plan to do. Nothing here is shared with other runners.</p><form onSubmit={submit} className="mt-6 space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><label className="block text-sm font-semibold">Title<input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" placeholder="Easy morning run" /></label><label className="block text-sm font-semibold">Start time<input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label><label className="block text-sm font-semibold">Location (optional)<input maxLength={160} value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" placeholder="Stephens Lake" /></label><label className="block text-sm font-semibold">Distance (optional)<input maxLength={80} value={distanceLabel} onChange={(e) => setDistanceLabel(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3" placeholder="5 miles" /></label><label className="flex gap-2 text-sm text-slate-600"><input required type="checkbox" /> I understand this run is private to my account.</label><button disabled={busy} className="w-full rounded-full bg-[#0b2b22] px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save private run"}</button></form>{message && <p role="status" className="mt-3 text-sm text-slate-600">{message}</p>}<section className="mt-8 space-y-3" aria-label="Private personal runs">{runs.map((run) => <article key={run.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><div className="flex justify-between gap-3"><div><h2 className="font-bold">{run.title}</h2><p className="mt-1 text-sm text-slate-500">{new Date(run.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>{run.locationLabel && <p className="text-sm text-slate-500">{run.locationLabel}{run.distanceLabel ? ` · ${run.distanceLabel}` : ""}</p>}</div><button onClick={() => remove(run.id)} className="h-fit rounded-full bg-slate-100 px-3 py-2 text-xs font-bold">Delete</button></div></article>)}</section></Page>;
}
function Page({ children }: { children: React.ReactNode }) { return <div className="mx-auto w-full max-w-md px-4 pb-32 pt-8"><div className="mb-5 text-xs font-bold uppercase tracking-widest text-emerald-700">Private · consent controlled</div>{children}</div>; }
