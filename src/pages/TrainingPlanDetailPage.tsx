import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { useToast } from "../lib/toast";
import { Icon } from "../components/ui";

const TRAINING_PLAN_LABELS: Record<api.TrainingPlanType, string> = {
  "5k": "5K",
  "10k": "10K",
  half_marathon: "Half Marathon",
  marathon: "Marathon",
  ultra: "Ultra",
  other: "Custom",
};

/**
 * The full week-by-week breakdown of a training plan - what was missing
 * before now. Settings shows the plan's overall shape (type, length, race);
 * this page is where the actual weekly content (target miles, long run,
 * workout notes) gets filled in and reviewed, one week at a time rather
 * than a single form covering up to 52 weeks at once.
 */
export function TrainingPlanDetailPage() {
  const toast = useToast();
  const [plan, setPlan] = useState<api.TrainingPlanView | null | undefined>(undefined);
  const [weeks, setWeeks] = useState<api.TrainingPlanWeekView[] | null>(null);
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);

  useEffect(() => {
    void api.getTrainingPlan().then((r) => {
      if (r.ok) {
        setPlan(r.data.plan);
        if (r.data.plan) setExpandedWeek(r.data.plan.currentWeek);
      }
    });
    void api.getTrainingPlanWeeks().then((r) => { if (r.ok) setWeeks(r.data.weeks); });
  }, []);

  const weekContent = (n: number) => weeks?.find((w) => w.weekNumber === n) ?? null;

  const onSaved = (week: api.TrainingPlanWeekView) => {
    setWeeks((prev) => {
      const others = (prev ?? []).filter((w) => w.weekNumber !== week.weekNumber);
      return [...others, week].sort((a, b) => a.weekNumber - b.weekNumber);
    });
    toast(`Week ${week.weekNumber} saved.`, "success");
  };

  if (plan === undefined || weeks === null) {
    return <div className="mx-auto max-w-2xl px-4 py-10 text-center text-sm text-slate-500">Loading…</div>;
  }

  if (plan === null) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center">
        <Icon name="calendar" className="mx-auto h-8 w-8 text-slate-300" />
        <h1 className="mt-3 text-lg font-extrabold text-slate-900">No training plan yet</h1>
        <p className="mt-1 text-sm text-slate-500">Set up a plan in Settings to start planning your weeks.</p>
        <Link to="/settings" className="mt-4 inline-block rounded-full bg-[#14171C] px-4 py-2.5 text-sm font-bold text-white">
          Go to Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-24">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Training plan</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
        {plan.planType === "other" ? plan.customLabel || "Custom" : TRAINING_PLAN_LABELS[plan.planType]}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Week {plan.currentWeek} of {plan.totalWeeks}
        {plan.linkedRaceName ? ` · Training for ${plan.linkedRaceName}` : plan.customRaceName ? ` · Training for ${plan.customRaceName} (pending)` : ""}
      </p>

      <div className="mt-5 space-y-2">
        {Array.from({ length: plan.totalWeeks }, (_, i) => i + 1).map((n) => (
          <WeekRow
            key={n}
            weekNumber={n}
            isCurrent={n === plan.currentWeek}
            expanded={expandedWeek === n}
            onToggle={() => setExpandedWeek(expandedWeek === n ? null : n)}
            content={weekContent(n)}
            onSaved={onSaved}
          />
        ))}
      </div>
    </div>
  );
}

function WeekRow({
  weekNumber,
  isCurrent,
  expanded,
  onToggle,
  content,
  onSaved,
}: {
  weekNumber: number;
  isCurrent: boolean;
  expanded: boolean;
  onToggle: () => void;
  content: api.TrainingPlanWeekView | null;
  onSaved: (week: api.TrainingPlanWeekView) => void;
}) {
  const [targetMiles, setTargetMiles] = useState(content?.targetMiles?.toString() ?? "");
  const [longRunMiles, setLongRunMiles] = useState(content?.longRunMiles?.toString() ?? "");
  const [notes, setNotes] = useState(content?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const r = await api.setTrainingPlanWeek(weekNumber, {
      targetMiles: targetMiles.trim() ? Number(targetMiles) : null,
      longRunMiles: longRunMiles.trim() ? Number(longRunMiles) : null,
      notes: notes.trim(),
    });
    setSaving(false);
    if (r.ok) onSaved(r.data.week);
  };

  const fieldCls = "h-10 w-full rounded-lg border border-slate-200 px-3 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";

  return (
    <div className={`overflow-hidden rounded-2xl ring-1 ${isCurrent ? "bg-[#FF5741]/5 ring-[#FF5741]/30" : "bg-white ring-slate-200/70"}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
        <span className="flex items-center gap-2">
          <span className={`text-[13px] font-bold ${isCurrent ? "text-[#FF5741]" : "text-slate-900"}`}>Week {weekNumber}</span>
          {isCurrent ? <span className="rounded-full bg-[#FF5741] px-2 py-0.5 text-[10px] font-extrabold text-[#14171C]">CURRENT</span> : null}
        </span>
        <span className="flex items-center gap-2 text-[13px] text-slate-500">
          {content?.targetMiles != null ? `${content.targetMiles} mi` : "Not planned yet"}
          <Icon name="chevronRight" className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </span>
      </button>
      {expanded ? (
        <div className="space-y-2.5 border-t border-slate-100 px-4 py-3.5">
          <div className="flex gap-2">
            <label className="flex-1"><span className="mb-1 block text-[11px] font-semibold text-slate-500">Total miles</span><input type="number" min="0" value={targetMiles} onChange={(e) => setTargetMiles(e.target.value)} className={fieldCls} /></label>
            <label className="flex-1"><span className="mb-1 block text-[11px] font-semibold text-slate-500">Long run (mi)</span><input type="number" min="0" value={longRunMiles} onChange={(e) => setLongRunMiles(e.target.value)} className={fieldCls} /></label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-slate-500">Notes</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Tempo Tuesday, long run Saturday, rest Monday/Friday" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
          </label>
          <button type="button" disabled={saving} onClick={() => void save()} className="h-10 w-full rounded-full bg-[#14171C] text-[13px] font-bold text-white disabled:opacity-50">
            {saving ? "Saving…" : "Save week"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
