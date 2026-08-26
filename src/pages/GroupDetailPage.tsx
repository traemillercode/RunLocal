import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { useAccount } from "../state/account";

function GroupPhotoFallback({ name, kind, className }: { name: string; kind: "cover" | "logo"; className: string }) {
  return <div role="img" aria-label={`${name} ${kind} placeholder`} className={`${className} flex items-center justify-center bg-[#14171C] text-[#FF5741]`}><span className={kind === "cover" ? "text-3xl font-black tracking-tight" : "text-2xl font-black"}>{kind === "cover" ? "Run Local" : name.trim().slice(0, 1).toUpperCase() || "R"}</span></div>;
}

function GroupPhoto({ name, kind, url, className }: { name: string; kind: "cover" | "logo"; url?: string | null; className: string }) {
  return url?.trim() ? <img src={url} alt={`${name} ${kind}`} className={className} /> : <GroupPhotoFallback name={name} kind={kind} className={className} />;
}

import { BackLink } from "../components/BackLink";
export function GroupDetailPage({ id }: { id: string }) {
  const { me } = useAccount();
  const [group, setGroup] = useState<api.PublicUserGroup | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [waiver, setWaiver] = useState<{id:string;groupId:string;version:number;text:string;createdAt:string}|null>(null);
  useEffect(() => { void api.getGroupWaiver(id).then((r) => { if (r.ok) setWaiver(r.data.waiver); }); }, [id]);
  useEffect(() => { void api.getPublicGroup(id).then((r) => { if (r.ok) setGroup(r.data.group); }); }, [id]);
  if (!group) return <section className="mx-auto max-w-3xl px-4 py-8"><p>Loading group…</p></section>;
  const request = () => {
    if (!me) return;
    setNotice(null);
    void api.requestGroupMembership(group.id).then((r) => setNotice(r.ok ? "Membership request sent." : r.error.message));
  };
  return <section className="mx-auto max-w-3xl px-4 py-6">
    <BackLink to="/groups">Back to Groups</BackLink>
    <GroupPhoto name={group.name} kind="cover" url={group.coverPhotoUrl} className="h-48 w-full rounded-2xl object-cover" />    <div className="mt-5 flex gap-4"><GroupPhoto name={group.name} kind="logo" url={group.logoPhotoUrl} className="h-20 w-20 shrink-0 rounded-2xl object-cover" /><div><h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{group.name}</h1><p className="text-slate-600">{group.groupType === "rrca-chartered" ? "RRCA-Chartered Club" : "Community Run Group"}{group.rrcaVerified ? " · RRCA verified" : ""}</p></div></div>
    <p className="mt-5 whitespace-pre-wrap">{group.description}</p><h2 className="mt-6 font-bold">Group leaders</h2><ul className="mt-2">{(group.leaders ?? []).map((l) => <li key={l.id}>{l.name}</li>)}</ul>
    <p className="mt-5 text-sm text-slate-600">Membership: {group.membershipMode === "open" ? "Open" : "Request to join"}</p>
    {group.membershipMode === "request" ? (me ? <button type="button" onClick={request} className="mt-4 rounded-[10px] bg-[#14171C] px-5 py-3 text-sm font-bold text-white">Request to join</button> : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">Sign in to request membership. <Link className="font-bold underline" to="/login">Sign in</Link></p>) : null}
    {notice ? <p role="status" className="mt-3 text-sm text-slate-700">{notice}</p> : null}
    {waiver ? <div className="mt-7 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Group waiver · version {waiver.version}</h2><p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{waiver.text}</p>{me ? <button className="mt-4 rounded-lg bg-[#14171C] px-4 py-2 text-sm font-bold text-white" onClick={() => void api.signGroupWaiver(group.id).then(r => setNotice(r.ok ? `Waiver signed through ${new Date(r.data.signature.expiresAt).toLocaleDateString()}.` : r.error.message))}>Sign waiver</button> : <p className="mt-3 text-sm text-slate-600">Sign in to sign this waiver.</p>}</div> : null}
    <div className="mt-4 flex flex-wrap gap-3">{[group.websiteUrl, group.facebookUrl, group.instagramUrl].filter(Boolean).map((u, i) => <a className="text-[#FF5741] underline" href={u!} target="_blank" rel="noreferrer" key={u}>{["Website", "Facebook", "Instagram"][i]}</a>)}</div>
  </section>;
}
