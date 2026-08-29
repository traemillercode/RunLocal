import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as api from "../lib/api";
import { useToast } from "../lib/toast";
import { Icon } from "../components/ui";

const WORKOUT_META: Record<api.TrainingDayWorkoutType, string> = {
  run: "Run", cross_training: "Cross-training", swim: "Swim", rest: "Rest", recovery: "Recovery", race: "Race day",
};
const COLOR_META: Record<api.WeekColor, string> = {
  green: "bg-emerald-100 text-emerald-800", yellow: "bg-amber-100 text-amber-800", red: "bg-rose-100 text-rose-800",
};

function toDateStr(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number): Date { const c = new Date(d); c.setUTCDate(c.getUTCDate() + n); return c; }

/**
 * The other half of the roster - clicking through from "this athlete is
 * red this week" to actually seeing what's planned, prescribing a day, and
 * freezing it if needed. A focused week list rather than a full calendar
 * rebuild, since the coach's job here is reviewing and adjusting the
 * current week, not browsing months.
 */
export function CoachAthletePlanPage() {
  const { athleteId } = useParams<{ athleteId: string }>();
  const toast = useToast();
  const [plan, setPlan] = useState<api.TrainingPlanView | null | undefined>(undefined);
  const [days, setDays] = useState<api.TrainingPlanDayView[]>([]);
  const [score, setScore] = useState<{ runColor: api.WeekColor; strengthColor: api.WeekColor; overallColor: api.WeekColor } | null>(null);
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    return toDateStr(addDays(d, -d.getUTCDay()));
  });
  const [editingDate, setEditingDate] = useState<string | null>(null);

  useEffect(() => {
    if (!athleteId) return;
    void api.getAthleteTrainingPlan(athleteId).then((r) => { if (r.ok) setPlan(r.data.plan); });
  }, [athleteId]);

  const weekEnd = toDateStr(addDays(new Date(`${weekStart}T00:00:00Z`), 6));

  useEffect(() => {
    if (!athleteId) return;
    void api.getAthleteTrainingPlanDays(athleteId, { start: weekStart, end: weekEnd }).then((r) => { if (r.ok) setDays(r.data.days); });
    void api.getAthleteWeekScore(athleteId, weekStart).then((r) => { if (r.ok) setScore(r.data); });
  }, [athleteId, weekStart, weekEnd]);

  if (!athleteId) return null;

  return (
    <div className="desktop-reading-narrow mx-auto max-w-2xl px-4 py-6 pb-24">
      <Link to="/coach-roster" className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500">
        <Icon name="chevronRight" className="h-3.5 w-3.5 rotate-180" /> Back to roster
      </Link>
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Coaching</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
        {plan === undefined ? "Loading…" : plan === null ? "No plan yet" : `Week ${plan.currentWeek} of ${plan.totalWeeks}`}
      </h1>

      {score ? (
        <div className="mt-3 flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-[12px] font-extrabold uppercase tracking-wide ${COLOR_META[score.overallColor]}`}>{score.overallColor} week</span>
          <span className="text-[11px] text-slate-400">Runs: {score.runColor} · Strength: {score.strengthColor}</span>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between">
        <button type="button" onClick={() => setWeekStart((w) => toDateStr(addDays(new Date(`${w}T00:00:00Z`), -7)))} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100"><Icon name="chevronRight" className="h-4 w-4 rotate-180 text-slate-600" /></button>
        <p className="text-[14px] font-bold text-slate-900">{new Date(`${weekStart}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} – {new Date(`${weekEnd}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</p>
        <button type="button" onClick={() => setWeekStart((w) => toDateStr(addDays(new Date(`${w}T00:00:00Z`), 7)))} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100"><Icon name="chevronRight" className="h-4 w-4 text-slate-600" /></button>
      </div>

      <div className="mt-4 space-y-1.5">
        {Array.from({ length: 7 }, (_, i) => toDateStr(addDays(new Date(`${weekStart}T00:00:00Z`), i))).map((date) => {
          const day = days.find((d) => d.date === date);
          return editingDate === date ? (
            <CoachDayEditor
              key={date}
              athleteId={athleteId}
              date={date}
              day={day ?? null}
              onSaved={(updated) => {
                setDays((prev) => [...prev.filter((d) => d.date !== date), updated]);
                setEditingDate(null);
                toast("Saved.", "success");
              }}
              onClose={() => setEditingDate(null)}
            />
          ) : (
            <button key={date} type="button" onClick={() => setEditingDate(date)} className="flex w-full items-center justify-between rounded-xl bg-white p-3.5 text-left ring-1 ring-slate-200/70">
              <div>
                <p className="text-[13px] font-bold text-slate-900">{new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</p>
                <p className="text-[12px] text-slate-500">{day ? `${day.title || WORKOUT_META[day.workoutType]}${day.distanceValue != null ? ` — ${day.distanceValue} ${day.distanceUnit}` : ""}` : "Nothing planned"}</p>
              </div>
              {day?.frozen ? <Icon name="shield" className="h-4 w-4 text-slate-400" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CoachDayEditor({ athleteId, date, day, onSaved, onClose }: { athleteId: string; date: string; day: api.TrainingPlanDayView | null; onSaved: (day: api.TrainingPlanDayView) => void; onClose: () => void }) {
  const [workoutType, setWorkoutType] = useState<api.TrainingDayWorkoutType>(day?.workoutType ?? "run");
  const [title, setTitle] = useState(day?.title ?? "");
  const [distanceValue, setDistanceValue] = useState(day?.distanceValue?.toString() ?? "");
  const [frozen, setFrozen] = useState(day?.frozen ?? false);
  const [saving, setSaving] = useState(false);
  const fieldCls = "h-10 rounded-lg border border-slate-200 px-3 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";

  const save = async () => {
    setSaving(true);
    const r = await api.setAthleteTrainingPlanDay(athleteId, date, {
      workoutType, title: title.trim(), distanceValue: distanceValue.trim() ? Number(distanceValue) : null, distanceUnit: "miles", frozen,
    });
    setSaving(false);
    if (r.ok) onSaved(r.data.day);
  };

  return (
    <div className="rounded-2xl bg-white p-4 ring-2 ring-[#14171C]">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[14px] font-bold text-slate-900">{new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}</p>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100"><Icon name="close" className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(WORKOUT_META) as api.TrainingDayWorkoutType[]).map((t) => (
          <button key={t} type="button" onClick={() => setWorkoutType(t)} className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${workoutType === t ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}>{WORKOUT_META[t]}</button>
        ))}
      </div>
      {workoutType !== "rest" ? (
        <div className="mt-3 space-y-2.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Tempo run" className={`w-full ${fieldCls}`} maxLength={60} />
          <input type="number" min="0" value={distanceValue} onChange={(e) => setDistanceValue(e.target.value)} placeholder="Distance (miles)" className={`w-full ${fieldCls}`} />
        </div>
      ) : null}
      <label className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-slate-600">
        <input type="checkbox" checked={frozen} onChange={(e) => setFrozen(e.target.checked)} className="h-4 w-4" />
        Lock this day (athlete can't change it, but can still log progress and link a group run)
      </label>
      <button type="button" disabled={saving} onClick={() => void save()} className="mt-3 h-10 w-full rounded-full bg-[#14171C] text-[13px] font-bold text-white disabled:opacity-50">
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
