import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { Icon } from "../components/ui";
import { useDeadEnd } from "../lib/friction";
import { CoachRequestBlock } from "../components/CoachRequestBlock";

/**
 * The actual "find a coach" page - the single biggest missing piece from
 * the whole coaching feature. Before this, the only way to request a
 * coach was to already be on their profile page. Verified coaches (the
 * existing coach_certification credential system) sort first with a real
 * badge; self-declared coaches still show, since not everyone with real
 * coaching experience has gone through formal credential verification.
 */
export function CoachDirectoryPage() {
  const [coaches, setCoaches] = useState<api.CoachDirectoryEntry[] | null>(null);

  useEffect(() => {
    void api.getCoachDirectory().then((r) => { if (r.ok) setCoaches(r.data.coaches); });
  }, []);

  // Audit hypothesis: a discovery surface with nothing to discover. If this
  // never fires, coaches are listing themselves and the gap is elsewhere.
  useDeadEnd("coach-directory-empty", coaches !== null && coaches.length === 0);

  return (
    <div className="mx-auto max-w-lg px-4 py-6 pb-24 desktop-reading-narrow">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Coaching</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Find a coach</h1>
      <p className="mt-1 text-sm text-slate-500">Runners who've made themselves available to coach — request one, or ask them to review your plan.</p>

      {coaches === null ? (
        <p className="mt-8 text-center text-sm text-slate-400">Loading…</p>
      ) : coaches.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-400">No coaches listed yet.</p>
      ) : (
        <div className="mt-5 space-y-3">
          {coaches.map((c) => (
            <div key={c.accountId} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
              <div className="flex items-center gap-1.5">
                <Link to={`/runners/${c.username ?? c.accountId}`} className="text-[15px] font-bold text-slate-900 hover:underline">{c.name}</Link>
                {c.isVerifiedCoach ? (
                  <span className="flex items-center gap-0.5 rounded-full bg-[#FF5741]/10 px-2 py-0.5 text-[11px] font-extrabold uppercase text-[#FF5741]">
                    <Icon name="check" className="h-2.5 w-2.5" /> Verified coach
                  </span>
                ) : null}
              </div>
              {c.coachBio ? <p className="mt-1 text-[13px] text-slate-600">{c.coachBio}</p> : null}
              <CoachRequestBlock targetAccountId={c.accountId} targetName={c.name} />
            </div>
          ))}
        </div>
      )}

      <Link to="/coaching" className="mt-6 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-slate-500">
        Your coaching requests & relationships →
      </Link>
    </div>
  );
}
