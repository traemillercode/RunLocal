import { useState } from "react";
import * as api from "../lib/api";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * "Repeat this workout" - the Outlook-style recurrence creator. Pick which
 * days of the week, a start/end date range, and a workout template;
 * submitting generates real calendar days for every matching date. Editing
 * later ("this instance" vs "all instances") happens from the calendar
 * itself, not here - this sheet only ever creates.
 */
export function RecurrenceSchedulerSheet({ planStart, planEnd, onCreated, onClose }: { planStart: string; planEnd: string; onCreated: (generatedCount: number) => void; onClose: () => void }) {
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 3, 5]);
  const [startDate, setStartDate] = useState(planStart);
  const [endDate, setEndDate] = useState(planEnd);
  const [workoutType, setWorkoutType] = useState<api.TrainingDayWorkoutType>("run");
  const [runLabel, setRunLabel] = useState<api.TrainingRunLabel | "">("");
  const [title, setTitle] = useState("");
  const [distanceValue, setDistanceValue] = useState("");
  const [distanceUnit, setDistanceUnit] = useState<api.TrainingDistanceUnit>("miles");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) => setDaysOfWeek((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const submit = async () => {
    if (daysOfWeek.length === 0) { setError("Pick at least one day of the week."); return; }
    if (!startDate || !endDate || endDate < startDate) { setError("Pick a valid start and end date."); return; }
    setSaving(true);
    setError(null);
    const r = await api.createRecurrence({
      daysOfWeek, startDate, endDate, workoutType,
      runLabel: runLabel || null,
      title: title.trim(),
      distanceValue: distanceValue.trim() ? Number(distanceValue) : null,
      distanceUnit,
    });
    setSaving(false);
    if (r.ok) onCreated(r.data.generatedCount);
    else setError(r.error.message ?? "Couldn't schedule that.");
  };

  const fieldCls = "h-10 w-full rounded-lg border border-slate-200 px-3 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 pb-8 sm:rounded-2xl sm:pb-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-extrabold text-slate-900">Repeat this workout</h2>
        <p className="mt-1 text-[13px] text-slate-500">Schedule the same workout across multiple days, like recurring events in Outlook.</p>

        <p className="mb-1.5 mt-4 text-[12px] font-bold uppercase tracking-wide text-slate-500">Repeat on</p>
        <div className="flex gap-1.5">
          {DAY_LABELS.map((label, i) => (
            <button
              key={i}
              type="button"
              onClick={() => toggleDay(i)}
              className={`h-9 flex-1 rounded-lg text-[12px] font-bold ${daysOfWeek.includes(i) ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-500"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <label className="flex-1"><span className="mb-1 block text-[11px] font-semibold text-slate-500">Start date</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldCls} /></label>
          <label className="flex-1"><span className="mb-1 block text-[11px] font-semibold text-slate-500">End date</span><input type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} className={fieldCls} /></label>
        </div>

        <p className="mb-1.5 mt-4 text-[12px] font-bold uppercase tracking-wide text-slate-500">Workout</p>
        <div className="flex flex-wrap gap-1.5">
          {(["run", "cross_training", "swim", "recovery", "race", "rest"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setWorkoutType(t)} className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${workoutType === t ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}>
              {t === "cross_training" ? "Cross-training" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {workoutType !== "rest" ? (
          <div className="mt-3 space-y-2.5">
            {workoutType === "run" || workoutType === "race" ? (
              <select value={runLabel} onChange={(e) => setRunLabel(e.target.value as api.TrainingRunLabel | "")} className={fieldCls}>
                <option value="">Run type…</option>
                <option value="easy">Easy</option>
                <option value="tempo">Tempo</option>
                <option value="long_run">Long run</option>
                <option value="workout">Workout</option>
                <option value="intervals">Intervals</option>
                <option value="recovery_run">Recovery run</option>
                <option value="race_pace">Race pace</option>
              </select>
            ) : null}
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className={fieldCls} maxLength={60} />
            <div className="flex gap-2">
              <input type="number" min="0" value={distanceValue} onChange={(e) => setDistanceValue(e.target.value)} placeholder="Distance" className={`flex-1 ${fieldCls}`} />
              <select value={distanceUnit} onChange={(e) => setDistanceUnit(e.target.value as api.TrainingDistanceUnit)} className={`w-28 ${fieldCls}`}>
                {(workoutType === "swim" ? (["meters", "yards"] as const) : (["miles", "km"] as const)).map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
        ) : null}

        {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-2.5 text-[12px] font-semibold text-rose-700">{error}</p> : null}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="h-11 flex-1 rounded-full bg-slate-100 text-[13px] font-bold text-slate-700">Cancel</button>
          <button type="button" disabled={saving} onClick={() => void submit()} className="h-11 flex-1 rounded-full bg-[#14171C] text-[13px] font-bold text-white disabled:opacity-50">
            {saving ? "Scheduling…" : "Schedule it"}
          </button>
        </div>
      </div>
    </div>
  );
}
