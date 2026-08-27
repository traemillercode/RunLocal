import { useEffect, useMemo, useState } from "react";
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

const WORKOUT_META: Record<api.TrainingDayWorkoutType, { label: string; color: string; dot: string }> = {
  run: { label: "Run", color: "bg-[#FF5741]/10 text-[#14171C]", dot: "bg-[#FF5741]" },
  cross_training: { label: "Cross-training", color: "bg-sky-50 text-sky-900", dot: "bg-sky-500" },
  rest: { label: "Rest", color: "bg-slate-100 text-slate-500", dot: "bg-slate-300" },
  recovery: { label: "Recovery", color: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  race: { label: "Race day", color: "bg-amber-50 text-amber-900", dot: "bg-amber-500" },
};

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

/**
 * The real training plan view - a month calendar (like Outlook/Google
 * Calendar's month view) rather than a flat list of weeks. Each day shows
 * its workout type at a glance; tapping a day opens a detail panel below
 * the grid to view/edit that day's real content (shoes, fuel, hydration,
 * route, notes) without navigating away - fixing the earlier flat-list UX,
 * where saving didn't return you anywhere sensible. The panel just... stays.
 */
export function TrainingPlanDetailPage() {
  const toast = useToast();
  const [plan, setPlan] = useState<api.TrainingPlanView | null | undefined>(undefined);
  const [days, setDays] = useState<Record<string, api.TrainingPlanDayView>>({});
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    void api.getTrainingPlan().then((r) => { if (r.ok) setPlan(r.data.plan); });
  }, []);

  useEffect(() => {
    void api.getTrainingPlanDays().then((r) => {
      if (r.ok) setDays(Object.fromEntries(r.data.days.map((d) => [d.date, d])));
    });
  }, [plan]);

  const onSaved = (day: api.TrainingPlanDayView) => {
    setDays((prev) => ({ ...prev, [day.date]: day }));
    toast("Day saved.", "success");
  };

  const gridStart = useMemo(() => {
    const s = startOfMonth(viewMonth);
    return addDays(s, -s.getUTCDay());
  }, [viewMonth]);
  const gridDays = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);

  if (plan === undefined) {
    return <div className="mx-auto max-w-2xl px-4 py-10 text-center text-sm text-slate-500">Loading…</div>;
  }

  if (plan === null) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center">
        <Icon name="calendar" className="mx-auto h-8 w-8 text-slate-300" />
        <h1 className="mt-3 text-lg font-extrabold text-slate-900">No training plan yet</h1>
        <p className="mt-1 text-sm text-slate-500">Set up a plan in Settings to start planning your days.</p>
        <Link to="/settings" className="mt-4 inline-block rounded-full bg-[#14171C] px-4 py-2.5 text-sm font-bold text-white">
          Go to Settings
        </Link>
      </div>
    );
  }

  const planStart = plan.startDate;
  const planEnd = toDateStr(addDays(new Date(`${plan.startDate}T00:00:00Z`), plan.totalWeeks * 7 - 1));
  const today = toDateStr(new Date());

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

      <div className="mt-5 flex items-center justify-between">
        <button type="button" onClick={() => setViewMonth((m) => addMonths(m, -1))} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 active:bg-slate-200" aria-label="Previous month">
          <Icon name="chevronRight" className="h-4 w-4 rotate-180 text-slate-600" />
        </button>
        <p className="text-[15px] font-bold text-slate-900">{viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</p>
        <button type="button" onClick={() => setViewMonth((m) => addMonths(m, 1))} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 active:bg-slate-200" aria-label="Next month">
          <Icon name="chevronRight" className="h-4 w-4 text-slate-600" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-slate-400">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {gridDays.map((d) => {
          const dateStr = toDateStr(d);
          const inMonth = d.getUTCMonth() === viewMonth.getUTCMonth();
          const inPlan = dateStr >= planStart && dateStr <= planEnd;
          const day = days[dateStr];
          const meta = day ? WORKOUT_META[day.workoutType] : null;
          return (
            <button
              key={dateStr}
              type="button"
              disabled={!inPlan}
              onClick={() => setSelectedDate(dateStr)}
              className={`relative flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-[12px] ${
                !inMonth ? "text-slate-300" : !inPlan ? "text-slate-300" : "text-slate-800"
              } ${selectedDate === dateStr ? "ring-2 ring-[#14171C]" : ""} ${meta ? meta.color : inPlan ? "bg-slate-50" : ""} ${dateStr === today ? "font-extrabold" : ""}`}
            >
              <span>{d.getUTCDate()}</span>
              {meta ? <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} /> : null}
              {day?.completionStatus === "done" ? <Icon name="check" className="absolute h-3 w-3 translate-x-2 -translate-y-2 text-emerald-600" /> : null}
              {day?.completionStatus === "missed" ? <span className="absolute translate-x-2 -translate-y-2 text-[9px] font-black text-rose-500">✕</span> : null}
            </button>
          );
        })}
      </div>

      {selectedDate ? (
        <DayPanel
          key={selectedDate}
          date={selectedDate}
          weekLabel={days[selectedDate]?.weekNumber}
          day={days[selectedDate] ?? null}
          onSaved={onSaved}
          onClose={() => setSelectedDate(null)}
        />
      ) : (
        <p className="mt-5 text-center text-[13px] text-slate-400">Tap a day to see or plan its workout.</p>
      )}
    </div>
  );
}

function DayPanel({
  date,
  day,
  onSaved,
  onClose,
}: {
  date: string;
  weekLabel: number | undefined;
  day: api.TrainingPlanDayView | null;
  onSaved: (day: api.TrainingPlanDayView) => void;
  onClose: () => void;
}) {
  const [workoutType, setWorkoutType] = useState<api.TrainingDayWorkoutType>(day?.workoutType ?? "run");
  const [title, setTitle] = useState(day?.title ?? "");
  const [distanceMiles, setDistanceMiles] = useState(day?.distanceMiles?.toString() ?? "");
  const [shoeNotes, setShoeNotes] = useState(day?.shoeNotes ?? "");
  const [fuelNotes, setFuelNotes] = useState(day?.fuelNotes ?? "");
  const [hydrationNotes, setHydrationNotes] = useState(day?.hydrationNotes ?? "");
  const [notes, setNotes] = useState(day?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [completionStatus, setCompletionStatus] = useState(day?.completionStatus ?? "pending");
  const [missedReason, setMissedReason] = useState<api.TrainingDayMissedReason>(day?.missedReason ?? "too_busy");
  const [completionNotes, setCompletionNotes] = useState(day?.completionNotes ?? "");
  const [loggingSaving, setLoggingSaving] = useState(false);

  const isPastOrToday = date <= toDateStr(new Date());

  const save = async () => {
    setSaving(true);
    const r = await api.setTrainingPlanDay(date, {
      workoutType,
      title: title.trim(),
      distanceMiles: distanceMiles.trim() ? Number(distanceMiles) : null,
      shoeNotes: shoeNotes.trim() || null,
      fuelNotes: fuelNotes.trim() || null,
      hydrationNotes: hydrationNotes.trim() || null,
      notes: notes.trim(),
    });
    setSaving(false);
    if (r.ok) onSaved(r.data.day);
  };

  /** Plan-vs-actual: separate from editing the planned content itself, since "did this happen" is a different question answered on a different timeline (after the fact) than "what's planned" (before). */
  const saveLog = async (status: "done" | "missed" | "modified") => {
    setLoggingSaving(true);
    const r = await api.setTrainingPlanDay(date, {
      completionStatus: status,
      missedReason: status === "missed" ? missedReason : null,
      completionNotes: completionNotes.trim() || null,
    });
    setLoggingSaving(false);
    if (r.ok) { onSaved(r.data.day); setCompletionStatus(r.data.day.completionStatus); }
  };

  const fieldCls = "h-10 w-full rounded-lg border border-slate-200 px-3 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";
  const dateLabel = new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[15px] font-bold text-slate-900">{dateLabel}</p>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100" aria-label="Close"><Icon name="close" className="h-4 w-4" /></button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(WORKOUT_META) as api.TrainingDayWorkoutType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setWorkoutType(t)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${workoutType === t ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {WORKOUT_META[t].label}
          </button>
        ))}
      </div>

      {workoutType !== "rest" ? (
        <div className="mt-3 space-y-2.5">
          <div className="flex gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Tempo run" className={`flex-1 ${fieldCls}`} maxLength={60} />
            <input type="number" min="0" value={distanceMiles} onChange={(e) => setDistanceMiles(e.target.value)} placeholder="Miles" className={`w-24 ${fieldCls}`} />
          </div>
          {workoutType === "run" || workoutType === "race" ? (
            <>
              <input value={shoeNotes} onChange={(e) => setShoeNotes(e.target.value)} placeholder="Shoes (optional)" className={fieldCls} maxLength={80} />
              <div className="flex gap-2">
                <input value={fuelNotes} onChange={(e) => setFuelNotes(e.target.value)} placeholder="Gels / fuel (optional)" className={`flex-1 ${fieldCls}`} maxLength={200} />
                <input value={hydrationNotes} onChange={(e) => setHydrationNotes(e.target.value)} placeholder="Water (optional)" className={`flex-1 ${fieldCls}`} maxLength={200} />
              </div>
            </>
          ) : null}
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-slate-500">Rest day — nothing planned.</p>
      )}

      <button type="button" disabled={saving} onClick={() => void save()} className="mt-3 h-10 w-full rounded-full bg-[#14171C] text-[13px] font-bold text-white disabled:opacity-50">
        {saving ? "Saving…" : "Save day"}
      </button>

      {isPastOrToday && workoutType !== "rest" ? (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-2 text-[13px] font-bold text-slate-700">Did you do it?</p>
          <div className="flex gap-1.5">
            {(["done", "missed", "modified"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setCompletionStatus(s)}
                className={`flex-1 rounded-full py-2 text-[12px] font-bold ${
                  completionStatus === s
                    ? s === "done" ? "bg-emerald-600 text-white" : s === "missed" ? "bg-rose-600 text-white" : "bg-amber-500 text-white"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {s === "done" ? "Done ✓" : s === "missed" ? "Missed it" : "Did something else"}
              </button>
            ))}
          </div>

          {completionStatus === "missed" ? (
            <select value={missedReason} onChange={(e) => setMissedReason(e.target.value as api.TrainingDayMissedReason)} className={`mt-2.5 ${fieldCls}`}>
              <option value="sick">Sick</option>
              <option value="injured">Injured</option>
              <option value="too_busy">Too busy / schedule conflict</option>
              <option value="weather">Weather</option>
              <option value="low_motivation">Low motivation</option>
              <option value="other">Other</option>
            </select>
          ) : null}

          {completionStatus === "missed" || completionStatus === "modified" ? (
            <textarea
              rows={2}
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              placeholder={completionStatus === "modified" ? "What did you do instead?" : "Anything else worth noting?"}
              className="mt-2.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
            />
          ) : null}

          {completionStatus !== "pending" ? (
            <button
              type="button"
              disabled={loggingSaving}
              onClick={() => void saveLog(completionStatus as "done" | "missed" | "modified")}
              className="mt-2.5 h-9 w-full rounded-full bg-slate-800 text-[12px] font-bold text-white disabled:opacity-50"
            >
              {loggingSaving ? "Logging…" : "Log it"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
