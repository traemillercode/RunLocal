import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { Icon } from "../components/ui";

const COLOR_META: Record<api.WeekColor, string> = {
  green: "bg-emerald-100 text-emerald-800",
  yellow: "bg-amber-100 text-amber-800",
  red: "bg-rose-100 text-rose-800",
};

/**
 * A coach's roster - every active athlete with their current week's color
 * at a glance, so a coach with multiple athletes can spot who needs
 * attention without opening each plan individually.
 */
export function CoachRosterPage() {
  const [athletes, setAthletes] = useState<api.RosterAthleteView[] | null>(null);

  useEffect(() => {
    void api.getCoachRoster().then((r) => { if (r.ok) setAthletes(r.data.athletes); });
  }, []);

  return (
    <div className="desktop-reading-narrow mx-auto max-w-lg px-4 py-6 pb-24">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Coaching</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Your athletes</h1>
      <p className="mt-1 text-sm text-slate-500">This week's status for everyone you're coaching.</p>

      {athletes === null ? (
        <p className="mt-8 text-center text-sm text-slate-400">Loading…</p>
      ) : athletes.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-400">No athletes yet — accept a coaching request to see them here.</p>
      ) : (
        <div className="mt-5 space-y-2">
          {athletes.map((a) => (
            <Link key={a.relationshipId} to={`/coach-roster/${a.athleteId}`} className="flex items-center justify-between rounded-2xl bg-white p-4 ring-1 ring-slate-200/70 active:bg-slate-50">
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-slate-900">{a.athleteName}</p>
                <p className="text-[12px] text-slate-500">Runs: {a.runColor} · Strength: {a.strengthColor}</p>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-extrabold uppercase tracking-wide ${COLOR_META[a.overallColor]}`}>
                {a.overallColor}
              </span>
            </Link>
          ))}
        </div>
      )}

      <Link to="/training-plan" className="mt-6 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-slate-500">
        <Icon name="chevronRight" className="h-3.5 w-3.5 rotate-180" /> Back to your own plan
      </Link>
    </div>
  );
}
