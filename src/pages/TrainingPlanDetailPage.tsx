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
  swim: { label: "Swim", color: "bg-cyan-50 text-cyan-900", dot: "bg-cyan-500" },
  rest: { label: "Rest", color: "bg-slate-100 text-slate-500", dot: "bg-slate-300" },
  recovery: { label: "Recovery", color: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  race: { label: "Race day", color: "bg-amber-50 text-amber-900", dot: "bg-amber-500" },
};

const UNITS_FOR_TYPE: Record<api.TrainingDayWorkoutType, api.TrainingDistanceUnit[]> = {
  run: ["miles", "km"],
  cross_training: ["miles", "km"],
  swim: ["meters", "yards"],
  rest: ["miles", "km"],
  recovery: ["miles", "km"],
  race: ["miles", "km"],
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
 * Calendar's month view). Each day cell shows real mileage or "Rest," a
 * lock icon when a coach has frozen it, and a "2" badge when there are both
 * AM and PM workouts. Tapping a day opens a detail panel below the grid to
 * view/edit that day's real content without navigating away.
 */
export function TrainingPlanDetailPage() {
  const toast = useToast();
  const [plan, setPlan] = useState<api.TrainingPlanView | null | undefined>(undefined);
  const [daysByDate, setDaysByDate] = useState<Record<string, api.TrainingPlanDayView[]>>({});
  const [shoes, setShoes] = useState<api.ShoeView[]>([]);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    void api.getTrainingPlan().then((r) => { if (r.ok) setPlan(r.data.plan); });
    void api.listShoes().then((r) => { if (r.ok) setShoes(r.data.shoes); });
  }, []);

  useEffect(() => {
    void api.getTrainingPlanDays().then((r) => {
      if (!r.ok) return;
      const byDate: Record<string, api.TrainingPlanDayView[]> = {};
      for (const d of r.data.days) (byDate[d.date] ??= []).push(d);
      setDaysByDate(byDate);
    });
  }, [plan]);

  const onSaved = (day: api.TrainingPlanDayView) => {
    setDaysByDate((prev) => {
      const existing = (prev[day.date] ?? []).filter((d) => d.slot !== day.slot);
      return { ...prev, [day.date]: [...existing, day].sort((a, b) => (a.slot === "pm" ? 1 : 0) - (b.slot === "pm" ? 1 : 0)) };
    });
    toast("Day saved.", "success");
    // Fixes the earlier flagged bug: the edit panel collapses back to the calendar after a save, rather than staying open indefinitely.
    setSelectedDate(null);
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
  const selectedDays = selectedDate ? daysByDate[selectedDate] ?? [] : [];

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
          const dayList = daysByDate[dateStr] ?? [];
          const primary = dayList[0];
          const meta = primary ? WORKOUT_META[primary.workoutType] : null;
          const anyFrozen = dayList.some((d2) => d2.frozen);
          return (
            <button
              key={dateStr}
              type="button"
              disabled={!inPlan}
              onClick={() => setSelectedDate(dateStr)}
              className={`relative flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] ${
                !inMonth ? "text-slate-300" : !inPlan ? "text-slate-300" : "text-slate-800"
              } ${selectedDate === dateStr ? "ring-2 ring-[#14171C]" : ""} ${meta ? meta.color : inPlan ? "bg-slate-50" : ""} ${dateStr === today ? "font-extrabold" : ""}`}
            >
              <span className="text-[12px]">{d.getUTCDate()}</span>
              {primary ? (
                <span className="text-[9px] font-bold leading-none">
                  {primary.workoutType === "rest" ? "Rest" : primary.distanceValue != null ? `${primary.distanceValue}${primary.distanceUnit === "miles" ? "mi" : primary.distanceUnit === "km" ? "km" : primary.distanceUnit === "meters" ? "m" : "yd"}` : meta?.label}
                </span>
              ) : null}
              {dayList.length > 1 ? <span className="absolute left-1 top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#14171C] text-[8px] font-black text-white">2</span> : null}
              {anyFrozen ? <Icon name="shield" className="absolute right-1 top-1 h-3 w-3 text-slate-400" /> : null}
              {primary?.completionStatus === "done" ? <Icon name="check" className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 text-emerald-600" /> : null}
              {primary?.completionStatus === "missed" ? <span className="absolute bottom-0.5 right-0.5 text-[8px] font-black text-rose-500">✕</span> : null}
            </button>
          );
        })}
      </div>

      {selectedDate ? (
        <div className="mt-4 space-y-3">
          {selectedDays.length === 0 || selectedDays.length === 1 ? (
            <DayPanel
              key={`${selectedDate}-${selectedDays[0]?.slot ?? "primary"}`}
              date={selectedDate}
              slot={selectedDays[0]?.slot ?? "primary"}
              day={selectedDays[0] ?? null}
              shoes={shoes}
              onSaved={onSaved}
              onClose={() => setSelectedDate(null)}
            />
          ) : (
            selectedDays.map((d) => (
              <DayPanel key={`${selectedDate}-${d.slot}`} date={selectedDate} slot={d.slot} day={d} shoes={shoes} onSaved={onSaved} onClose={() => setSelectedDate(null)} />
            ))
          )}
          {selectedDays.length < 2 ? (
            <button
              type="button"
              onClick={() => setDaysByDate((prev) => ({ ...prev, [selectedDate]: [...(prev[selectedDate] ?? []), { slot: selectedDays.length === 0 ? "primary" : selectedDays[0].slot === "am" ? "pm" : "am" } as api.TrainingPlanDayView] }))}
              className="w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-[13px] font-bold text-slate-500"
            >
              + Add a second workout (AM/PM)
            </button>
          ) : null}
        </div>
      ) : (
        <p className="mt-5 text-center text-[13px] text-slate-400">Tap a day to see or plan its workout.</p>
      )}
    </div>
  );
}

function DayPanel({
  date,
  slot,
  day,
  shoes,
  onSaved,
  onClose,
}: {
  date: string;
  slot: api.TrainingDaySlot;
  day: api.TrainingPlanDayView | null;
  shoes: api.ShoeView[];
  onSaved: (day: api.TrainingPlanDayView) => void;
  onClose: () => void;
}) {
  const [workoutType, setWorkoutType] = useState<api.TrainingDayWorkoutType>(day?.workoutType ?? "run");
  const [title, setTitle] = useState(day?.title ?? "");
  const [distanceValue, setDistanceValue] = useState(day?.distanceValue?.toString() ?? "");
  const [distanceUnit, setDistanceUnit] = useState<api.TrainingDistanceUnit>(day?.distanceUnit ?? "miles");
  const [shoeId, setShoeId] = useState(day?.shoeId ?? shoes.find((s) => s.isDefault)?.id ?? "");
  const [addingShoe, setAddingShoe] = useState(false);
  const [newShoeName, setNewShoeName] = useState("");
  const [localShoes, setLocalShoes] = useState(shoes);
  const [fuelNotes, setFuelNotes] = useState(day?.fuelNotes ?? "");
  const [hydrationNotes, setHydrationNotes] = useState(day?.hydrationNotes ?? "");
  const [notes, setNotes] = useState(day?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [completionStatus, setCompletionStatus] = useState(day?.completionStatus ?? "pending");
  const [missedReason, setMissedReason] = useState<api.TrainingDayMissedReason>(day?.missedReason ?? "too_busy");
  const [completionNotes, setCompletionNotes] = useState(day?.completionNotes ?? "");
  const [loggingSaving, setLoggingSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPastOrToday = date <= toDateStr(new Date());
  const frozen = day?.frozen === true;

  const save = async () => {
    setSaving(true);
    setError(null);
    const r = await api.setTrainingPlanDay(date, {
      workoutType,
      title: title.trim(),
      distanceValue: distanceValue.trim() ? Number(distanceValue) : null,
      distanceUnit,
      shoeId: shoeId || null,
      fuelNotes: fuelNotes.trim() || null,
      hydrationNotes: hydrationNotes.trim() || null,
      notes: notes.trim(),
    }, slot);
    setSaving(false);
    if (r.ok) onSaved(r.data.day);
    else setError(r.error.code === "coach_managed" ? "Your coach manages this workout — propose a change instead of editing it directly." : r.error.code === "day_frozen" ? "Your coach has locked this day." : r.error.message ?? "Couldn't save.");
  };

  const addNewShoe = async () => {
    if (!newShoeName.trim()) return;
    const r = await api.addShoe(newShoeName.trim());
    if (r.ok) {
      setLocalShoes((prev) => [...prev, r.data.shoe]);
      setShoeId(r.data.shoe.id);
      setAddingShoe(false);
      setNewShoeName("");
    }
  };

  const saveLog = async (status: "done" | "missed" | "modified") => {
    setLoggingSaving(true);
    const r = await api.setTrainingPlanDay(date, {
      completionStatus: status,
      missedReason: status === "missed" ? missedReason : null,
      completionNotes: completionNotes.trim() || null,
    }, slot);
    setLoggingSaving(false);
    if (r.ok) { onSaved(r.data.day); setCompletionStatus(r.data.day.completionStatus); }
  };

  const fieldCls = "h-10 w-full rounded-lg border border-slate-200 px-3 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";
  const dateLabel = new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[15px] font-bold text-slate-900">
          {dateLabel} {slot !== "primary" ? <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-500">{slot}</span> : null}
          {frozen ? <Icon name="shield" className="ml-1.5 inline h-3.5 w-3.5 text-slate-400" /> : null}
        </p>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100" aria-label="Close"><Icon name="close" className="h-4 w-4" /></button>
      </div>

      {frozen ? <p className="mb-3 rounded-xl bg-slate-50 p-2.5 text-[12px] font-semibold text-slate-500">Your coach has locked this day — logging progress and linking a group run still work.</p> : null}
      {error ? <p role="alert" className="mb-3 rounded-xl bg-rose-50 p-2.5 text-[12px] font-semibold text-rose-700">{error}</p> : null}

      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(WORKOUT_META) as api.TrainingDayWorkoutType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setWorkoutType(t); if (!UNITS_FOR_TYPE[t].includes(distanceUnit)) setDistanceUnit(UNITS_FOR_TYPE[t][0]); }}
            className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${workoutType === t ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {WORKOUT_META[t].label}
          </button>
        ))}
      </div>

      {workoutType !== "rest" ? (
        <div className="mt-3 space-y-2.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={workoutType === "swim" ? "e.g. Interval swim" : "e.g. Tempo run"} className={fieldCls} maxLength={60} />
          <div className="flex gap-2">
            <input type="number" min="0" value={distanceValue} onChange={(e) => setDistanceValue(e.target.value)} placeholder="Distance" className={`flex-1 ${fieldCls}`} />
            <select value={distanceUnit} onChange={(e) => setDistanceUnit(e.target.value as api.TrainingDistanceUnit)} className={`w-28 ${fieldCls}`}>
              {UNITS_FOR_TYPE[workoutType].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          {workoutType === "run" || workoutType === "race" ? (
            <>
              <select value={addingShoe ? "__new__" : shoeId} onChange={(e) => { if (e.target.value === "__new__") setAddingShoe(true); else { setAddingShoe(false); setShoeId(e.target.value); } }} className={fieldCls}>
                <option value="">No shoe picked</option>
                {localShoes.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isDefault ? " (default)" : ""}</option>)}
                <option value="__new__">+ Add a new shoe</option>
              </select>
              {addingShoe ? (
                <div className="flex gap-2">
                  <input value={newShoeName} onChange={(e) => setNewShoeName(e.target.value)} placeholder="e.g. Nike Pegasus 40" className={`flex-1 ${fieldCls}`} maxLength={60} />
                  <button type="button" onClick={() => void addNewShoe()} className="shrink-0 rounded-lg bg-[#14171C] px-3 text-[13px] font-bold text-white">Add</button>
                </div>
              ) : null}
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
