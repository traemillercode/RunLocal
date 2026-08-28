import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { useToast } from "../lib/toast";
import { Icon } from "../components/ui";

/**
 * The actual place to manage coaching relationships - incoming requests to
 * accept or decline, requests you sent still waiting, and active
 * relationships you can end at any time. Without this page, a request sent
 * from a profile page has nowhere to be answered.
 */
export function CoachingPage() {
  const toast = useToast();
  const [relationships, setRelationships] = useState<api.CoachRelationshipView[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => void api.listCoachRelationships().then((r) => { if (r.ok) setRelationships(r.data.relationships); });
  useEffect(load, []);

  const respond = async (id: string, accept: boolean) => {
    setBusyId(id);
    const r = await api.respondToCoachRelationship(id, accept);
    setBusyId(null);
    if (r.ok) { load(); toast(accept ? "Accepted." : "Declined.", "success"); }
  };
  const end = async (id: string) => {
    setBusyId(id);
    const r = await api.endCoachRelationship(id);
    setBusyId(null);
    if (r.ok) { load(); toast("Relationship ended.", "success"); }
  };

  const incoming = relationships?.filter((r) => r.status === "pending" && !r.requestedByMe) ?? [];
  const outgoing = relationships?.filter((r) => r.status === "pending" && r.requestedByMe) ?? [];
  const active = relationships?.filter((r) => r.status === "active") ?? [];

  return (
    <div className="desktop-reading-narrow mx-auto max-w-lg px-4 py-6 pb-24">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Coaching</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Requests & relationships</h1>

      {relationships === null ? (
        <p className="mt-8 text-center text-sm text-slate-400">Loading…</p>
      ) : relationships.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-400">No coaching requests or relationships yet. Visit a runner's profile to ask.</p>
      ) : (
        <>
          {incoming.length > 0 ? (
            <>
              <p className="mb-2 mt-6 text-[13px] font-bold text-slate-700">Waiting on you</p>
              <div className="space-y-1.5">
                {incoming.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-2xl bg-white p-3.5 ring-1 ring-slate-200/70">
                    <div>
                      <p className="text-[14px] font-bold text-slate-900">{r.otherName}</p>
                      <p className="text-[12px] text-slate-500">{r.role === "coach" ? "Wants you to be their coach" : "Offered to coach you"}</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button" disabled={busyId === r.id} onClick={() => void respond(r.id, true)} className="rounded-full bg-[#14171C] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">Accept</button>
                      <button type="button" disabled={busyId === r.id} onClick={() => void respond(r.id, false)} className="rounded-full bg-slate-100 px-3 py-1.5 text-[12px] font-bold text-slate-600 disabled:opacity-50">Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {outgoing.length > 0 ? (
            <>
              <p className="mb-2 mt-6 text-[13px] font-bold text-slate-700">Sent, awaiting response</p>
              <div className="space-y-1.5">
                {outgoing.map((r) => (
                  <div key={r.id} className="rounded-2xl bg-slate-50 p-3.5">
                    <p className="text-[14px] font-bold text-slate-900">{r.otherName}</p>
                    <p className="text-[12px] text-slate-500">{r.role === "coach" ? "You offered to coach them" : "You asked them to coach you"}</p>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {active.length > 0 ? (
            <>
              <p className="mb-2 mt-6 text-[13px] font-bold text-slate-700">Active</p>
              <div className="space-y-1.5">
                {active.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-2xl bg-white p-3.5 ring-1 ring-slate-200/70">
                    <div>
                      <p className="text-[14px] font-bold text-slate-900">{r.otherName}</p>
                      <p className="text-[12px] text-slate-500">{r.role === "coach" ? "You're coaching them" : "They're your coach"}</p>
                    </div>
                    <button type="button" disabled={busyId === r.id} onClick={() => void end(r.id)} className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold text-rose-600 disabled:opacity-50">End</button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}

      <Link to="/training-plan" className="mt-6 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-slate-500">
        <Icon name="chevronRight" className="h-3.5 w-3.5 rotate-180" /> Back to your training plan
      </Link>
    </div>
  );
}
