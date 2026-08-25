import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../lib/api";
import { useAccount } from "../state/account";
import { useToast } from "../lib/toast";
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
          <Link className="rounded-full bg-[#FF5741] px-3 py-1.5 text-sm font-bold text-[#14171C]" to={`/groups/${g.groupId}/manage`}>Manage</Link>
        </li>
      ))}</ul>
    </div>
  );
}
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The actual "My Clubs" content — extracted so GroupsHubPage can render it as a tab without duplicating logic. */
export function MyGroupsContent() {
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useAccount();
  const [memberships, setMemberships] = useState<api.MyGroupMembership[]>([]);
  const [waivers, setWaivers] = useState<api.WaiverStatus[]>([]);
  const [led, setLed] = useState<api.LedGroupRow[]>([]);
  const [events, setEvents] = useState<api.CanonicalEvent[]>([]);
  const [error, setError] = useState("");
  const [openingChatFor, setOpeningChatFor] = useState<string | null>(null);
  const load = () => {
    void api.getMyGroups().then((r) => (r.ok ? setMemberships(r.data.memberships) : setError(r.error.message)));
    void api.getMyWaivers().then((r) => r.ok && setWaivers(r.data.waivers));
    if (me) void api.getMyLedGroups().then((r) => r.ok && setLed(r.data.groups));
  };
  useEffect(load, [me]);
  useEffect(() => {
    if (memberships.length === 0) return;
    void Promise.all([...new Set(memberships.map((m) => m.cityId))].map((cityId) => api.getCanonicalEvents(cityId))).then((results) => {
      setEvents(results.flatMap((r) => (r.ok ? r.data.events : [])));
    });
  }, [memberships]);
  const openChat = (groupId: string) => {
    setOpeningChatFor(groupId);
    void api.openGroupChat(groupId).then((r) => {
      setOpeningChatFor(null);
      if (r.ok) navigate(`/messages/${r.data.conversationId}`);
      else toast(r.error.message ?? "Couldn't open the group chat.", "info");
    });
  };
  return <>
    <LedGroupsSection groups={led} />
    {error ? <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : memberships.length === 0 ? <div className="mt-6 rounded-2xl bg-white p-5 text-slate-600">You are not a member of any groups yet. Browse the Discover tab to request access.</div> : <div className="mt-6 grid gap-3">{memberships.filter((m) => m.status !== "left" && m.status !== "revoked").map((m) => {
      const nextRun = events.filter((e) => e.groupId === m.groupId && e.status === "published" && !e.hidden).sort((a, b) => a.dayOfWeek - b.dayOfWeek)[0];
      return (
      <div key={m.id} className="rounded-2xl bg-white p-5 shadow-sm border border-neutral-200/80"><Link to={`/groups/${m.groupId}`} className="text-lg font-bold">{m.groupName}</Link><p className="mt-1 text-sm capitalize text-slate-600">Membership: {m.status}</p>
        {nextRun ? (
          <Link to="/" className="mt-2 flex items-center gap-1.5 text-sm text-slate-700 hover:underline underline-offset-2">
            <Icon name="calendar" className="h-4 w-4 text-slate-400" />
            Next run: <span className="font-semibold">{DAY_NAMES[nextRun.dayOfWeek]}s, {nextRun.time}</span> · {nextRun.location}
          </Link>
        ) : null}
        {(() => { const w = waivers.find((x) => x.groupId === m.groupId); return w && <p className="mt-2 text-sm font-semibold">Waiver: <span className={w.status === "signed" ? "text-emerald-700" : "text-amber-700"}>{w.status === "signed" ? `Signed${w.expiresAt ? ` until ${new Date(w.expiresAt).toLocaleDateString()}` : ""}` : w.status === "unsigned" ? "Not signed" : "Expired"}</span>{(w.status === "unsigned" || w.status === "expired") && <Link className="ml-2 text-[#FF5741] underline" to={`/groups/${m.groupId}`}>Review</Link>}</p>; })()}
        {m.status === "active" ? (
          <button type="button" disabled={openingChatFor === m.groupId} onClick={() => openChat(m.groupId)} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#14171C] px-3.5 py-2 text-sm font-bold text-white disabled:opacity-60">
            <Icon name="chat" className="h-4 w-4" /> {openingChatFor === m.groupId ? "Opening…" : "Group chat"}
          </button>
        ) : null}
        <button className="mt-3 ml-2 rounded-lg border px-3 py-2 text-sm font-bold" onClick={() => void api.updateGroupMembership(m.groupId, "leave").then(load)}>Leave group</button>
      </div>
      );
    })}</div>}
  </>;
}
export function MyGroupsPage() {
  return <section className="mx-auto max-w-3xl px-4 py-6"><p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Private</p><h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">My groups</h1><p className="mt-2 text-slate-600">Only groups with a membership record for your account appear here. Directory listings and sample content are not memberships.</p>
    <MyGroupsContent />
  </section>;
}
