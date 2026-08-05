import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import type { City } from "../types";

export function GroupsPage({ city }: { city: City }) {
  const [groups, setGroups] = useState<api.PublicUserGroup[]>([]);
  const [messages, setMessages] = useState<Record<string, string>>({});
  useEffect(() => { void api.getPublicGroups(city.id).then(r => { if (r.ok) setGroups(r.data.groups); }); }, [city.id]);
  async function request(groupId: string) {
    const result = await api.requestGroupMembership(groupId);
    const message = result.ok
      ? `Membership ${result.data.membership.status}.`
      : result.error.message;
    setMessages(current => ({ ...current, [groupId]: message }));
  }
  return <section className="mx-auto max-w-3xl px-4 py-6"><p className="text-xs font-bold uppercase tracking-widest text-orange-700">{city.name}</p><h1 className="mt-2 text-3xl font-black">Groups & clubs</h1><p className="mt-2 text-slate-600">Find published local running communities. Group posts and messaging are not available.</p><div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-bold text-slate-800">About these listings</p><p className="mt-1 text-xs leading-relaxed text-slate-600">Some listings are Run Local fixture content used to show how the city directory works; others were submitted by the community and approved. We don't infer ownership or membership from a listing.</p></div><div className="mt-6 grid gap-4">{groups.length === 0 ? <div className="rounded-2xl bg-white p-5 text-slate-600">No published groups yet.</div> : groups.map(g => <article key={g.id} className="rounded-2xl bg-white p-5 shadow-sm"><Link to={`/groups/${g.id}`} className="flex gap-4"><img src={g.logoPhotoUrl} alt="" className="h-16 w-16 rounded-xl object-cover"/><div><h2 className="text-xl font-bold">{g.name}</h2><p className="text-sm text-slate-600">{g.groupType === "rrca-chartered" ? "RRCA-Chartered Club" : "Community Run Group"}{g.rrcaVerified ? " · RRCA verified" : ""}</p><p className="mt-1 text-xs font-semibold text-slate-500">Published directory listing · ownership not specified</p><p className="mt-1 line-clamp-2 text-sm">{g.description}</p></div></Link><button type="button" className="mt-3 rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-white" onClick={() => void request(g.id)}>Request membership</button>{messages[g.id] && <p className="mt-2 text-sm text-slate-600" role="status">{messages[g.id]}</p>}</article>)}</div></section>;
}
