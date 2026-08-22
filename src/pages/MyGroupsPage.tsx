import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { useAccount } from "../state/account";
import { Icon } from "../components/ui";
/** Role label for a manage-list row (leads plus in-scope City/Global Admins). */
export function ledGroupRoleLabel(role: api.LedGroupRow["role"]): string {
  return role === "owner" ? "Owner" : role === "leader" ? "Leader" : role === "city_admin" ? "City Admin" : "Platform owner";
}
/**
 * Presentational list of groups the account can manage — leads' own groups
 * plus, for City/Global Admins, every group the server authorizes them to
 * manage. Exported so UI tests can assert admin reach renders correctly.
 */
export function LedGroupsSection({ groups }: { groups: api.LedGroupRow[] }) {
  if (groups.length === 0) return null;
  return (
    <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">Groups you manage</h2>
      <ul className="mt-3 grid gap-2">{groups.map((g) => (
        <li key={g.groupId} className="flex items-center justify-between gap-3">
          <div><Link to={`/groups/${g.groupId}`} className="font-bold">{g.groupName}</Link><p className="text-xs text-slate-500">{ledGroupRoleLabel(g.role)}{g.pendingCount > 0 ? ` · ${g.pendingCount} pending ${g.pendingCount === 1 ? "request" : "requests"}` : ""}</p></div>
          <Link className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-bold text-white" to={`/groups/${g.groupId}/manage`}>Manage</Link>
        </li>
      ))}</ul>
    </div>
  );
}
/** The actual "My Clubs" content — extracted so GroupsHubPage can render it as a tab without duplicating logic. */
export function MyGroupsContent() {
  const { me } = useAccount();
  const [memberships, setMemberships] = useState<api.MyGroupMembership[]>([]);
  const [waivers, setWaivers] = useState<api.WaiverStatus[]>([]);
  const [led, setLed] = useState<api.LedGroupRow[]>([]);
  const [error, setError] = useState("");
  const load = () => {
    void api.getMyGroups().then((r) => (r.ok ? setMemberships(r.data.memberships) : setError(r.error.message)));
    void api.getMyWaivers().then((r) => r.ok && setWaivers(r.data.waivers));
    if (me) void api.getMyLedGroups().then((r) => r.ok && setLed(r.data.groups));
  };
  useEffect(load, [me]);
  return <>
    <LedGroupsSection groups={led} />
    {error ? <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : memberships.length === 0 ? <div className="mt-6 rounded-2xl bg-white p-5 text-slate-600">You are not a member of any groups yet. Browse the Discover tab to request access.</div> : <div className="mt-6 grid gap-3">{memberships.filter((m) => m.status !== "left" && m.status !== "revoked").map((m) => (
      <div key={m.id} className="rounded-2xl bg-white p-5 shadow-sm"><Link to={`/groups/${m.groupId}`} className="text-lg font-bold">{m.groupName}</Link><p className="mt-1 text-sm capitalize text-slate-600">Membership: {m.status}</p>
        {(() => { const w = waivers.find((x) => x.groupId === m.groupId); return w && <p className="mt-2 text-sm font-semibold">Waiver: <span className={w.status === "signed" ? "text-emerald-700" : "text-amber-700"}>{w.status === "signed" ? `Signed${w.expiresAt ? ` until ${new Date(w.expiresAt).toLocaleDateString()}` : ""}` : w.status === "unsigned" ? "Not signed" : "Expired"}</span>{(w.status === "unsigned" || w.status === "expired") && <Link className="ml-2 text-orange-700 underline" to={`/groups/${m.groupId}`}>Review</Link>}</p>; })()}
        {m.status === "active" && m.groupmeUrl ? (
          <a href={m.groupmeUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#14171C] px-3.5 py-2 text-sm font-bold text-white">
            <Icon name="chat" className="h-4 w-4" /> Group chat
          </a>
        ) : null}
        <button className="mt-3 ml-2 rounded-lg border px-3 py-2 text-sm font-bold" onClick={() => void api.updateGroupMembership(m.groupId, "leave").then(load)}>Leave group</button>
      </div>
    ))}</div>}
  </>;
}
export function MyGroupsPage() {
  return <section className="mx-auto max-w-3xl px-4 py-6"><p className="text-xs font-bold uppercase tracking-widest text-orange-700">Private</p><h1 className="mt-2 text-3xl font-black">My groups</h1><p className="mt-2 text-slate-600">Only groups with a membership record for your account appear here. Directory listings and sample content are not memberships.</p>
    <MyGroupsContent />
  </section>;
}
