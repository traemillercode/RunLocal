import { useEffect, useMemo, useState } from "react";
import { localISODate } from "../lib/dates";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { useToast } from "../lib/toast";
import { Icon } from "../components/ui";
import { useDeadEnd } from "../lib/friction";
import { FEATURES, type Feature } from "../lib/features";
import { resolveSlot, slotLabel, bySessionTime, totalUnitFor, toTotal, totalUnitLabel } from "../lib/slots";
import { RecurrenceSchedulerSheet } from "../components/RecurrenceSchedulerSheet";

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
  return localISODate(d);
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

/**
 * Audit hypothesis: someone reaches /training-plan with no plan set up and has
 * to go to Settings to do anything. A separate component so the hook is not
 * called conditionally in the parent's early-return branch.
 */
/**
 * The Training tab's no-plan state.
 *
 * WAS: "No training plan yet — set up a plan in Settings" with a button to
 * Settings. That is the pattern removed twice already this build — a surface
 * that explains why it is empty instead of doing something — and it was the
 * first screen every new account would hit on a tab that had just been
 * promoted to the bottom bar. It also pointed at Settings, which is not where
 * anyone looks for training.
 *
 * NOW: the six training features that previously hung off this page and
 * nowhere else are rendered as cards, DERIVED from the registry rather than
 * listed here — so a new training feature appears automatically and cannot
 * become the next orphan.
 *
 * This is deliberately NOT the 1.12 hub. It makes the tab non-empty using what
 * already exists, and gives those six a front door for the first time, which
 * was the point of giving Training a tab at all.
 */
function TrainingNoPlan() {
  // area === "training", minus the hub itself and detail routes that need a
  // parent record to make sense.
  const cards = (FEATURES as readonly Feature[]).filter(
    (f) => f.area === "training" && f.status === "live" && f.id !== "training" && f.reach.kind === "child" && !f.route.includes(":"),
  );
  return (
    <div className="mx-auto max-w-md px-4 py-8 desktop-reading-narrow">
      <NoPlanDeadEnd />
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Training</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Build your weeks</h1>
      <p className="mt-1 text-sm text-slate-500">
        A plan lays out your runs day by day. You don&apos;t need one to use everything else here.
      </p>

      {/* Primary action stays "Start a plan"; the cards are what you can do meanwhile. */}
      <Link
        to="/settings"
        className="mt-4 flex h-11 items-center justify-center rounded-xl bg-[#14171C] text-[14px] font-bold text-white"
      >
        Start a plan
      </Link>

      <ul className="mt-6 space-y-2">
        {cards.map((f) => (
          <li key={f.id}>
            <Link
              to={f.route}
              className="flex min-h-11 items-center gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200/70"
            >
              <Icon name={f.nav?.icon ?? "calendar"} className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="flex-1">
                <span className="block text-[14px] font-bold text-slate-900">{f.label}</span>
                <span className="block text-[12px] text-slate-500">{f.summary}</span>
              </span>
              <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-slate-300" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoPlanDeadEnd() {
  useDeadEnd("training-plan-no-plan", true, "reached training plan without a plan");
  return null;
}

export function TrainingPlanDetailPage() {
  const toast = useToast();
  const [plan, setPlan] = useState<api.TrainingPlanView | null | undefined>(undefined);
  const [daysByDate, setDaysByDate] = useState<Record<string, api.TrainingPlanDayView[]>>({});
  const [shoes, setShoes] = useState<api.ShoeView[]>([]);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [recurrenceOpen, setRecurrenceOpen] = useState(false);

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
      return { ...prev, [day.date]: [...existing, day].sort(bySessionTime) };
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

  if (plan === null) return <TrainingNoPlan />;

  const planStart = plan.startDate;
  const planEnd = toDateStr(addDays(new Date(`${plan.startDate}T00:00:00Z`), plan.totalWeeks * 7 - 1));
  const today = toDateStr(new Date());
  const selectedDays = selectedDate ? daysByDate[selectedDate] ?? [] : [];

  return (
    <div className="desktop-browse-layout mx-auto max-w-2xl px-4 py-6 pb-24">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Training plan</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
        {plan.planType === "other" ? plan.customLabel || "Custom" : TRAINING_PLAN_LABELS[plan.planType]}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Week {plan.currentWeek} of {plan.totalWeeks}
        {plan.linkedRaceName ? ` · Training for ${plan.linkedRaceName}` : plan.customRaceName ? ` · Training for ${plan.customRaceName} (pending)` : ""}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <button
          type="button"
          onClick={() => setRecurrenceOpen(true)}
          className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-2 py-3 text-center text-[12px] font-bold text-slate-600"
        >
          <Icon name="calendar" className="h-4 w-4" />
          Repeat a workout
        </button>
        <Link to="/recurring-schedules" className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-50 px-2 py-3 text-center text-[12px] font-bold text-slate-600">
          <Icon name="settings" className="h-4 w-4" />
          Recurring schedules
        </Link>
        <Link to="/pace-calculator" className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-50 px-2 py-3 text-center text-[12px] font-bold text-slate-600">
          <Icon name="rsvp" className="h-4 w-4" />
          Pace calculator
        </Link>
        <Link to="/training-summary" className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-50 px-2 py-3 text-center text-[12px] font-bold text-slate-600">
          <Icon name="rsvp" className="h-4 w-4" />
          Weekly summary
        </Link>
        <Link to="/coaches" className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-[#FF5741]/10 px-2 py-3 text-center text-[12px] font-bold text-[#14171C]">
          <Icon name="users" className="h-4 w-4" />
          Find a coach
        </Link>
        <Link to="/coach-roster" className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-50 px-2 py-3 text-center text-[12px] font-bold text-slate-600">
          <Icon name="users" className="h-4 w-4" />
          Coaching roster
        </Link>
        <Link to="/coaching" className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-50 px-2 py-3 text-center text-[12px] font-bold text-slate-600">
          <Icon name="users" className="h-4 w-4" />
          Coaching requests
        </Link>
      </div>

      <div className="lg:grid lg:grid-cols-[1fr_380px] lg:items-start lg:gap-6">
        <div>
          <div className="mt-5 flex items-center justify-between">
            <button type="button" onClick={() => setViewMonth((m) => addMonths(m, -1))} className="grid h-11 w-9 place-items-center rounded-full bg-slate-100 active:bg-slate-200" aria-label="Previous month">
              <Icon name="chevronRight" className="h-4 w-4 rotate-180 text-slate-600" />
            </button>
            <p className="text-[15px] font-bold text-slate-900">{viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</p>
            <button type="button" onClick={() => setViewMonth((m) => addMonths(m, 1))} className="grid h-11 w-9 place-items-center rounded-full bg-slate-100 active:bg-slate-200" aria-label="Next month">
              <Icon name="chevronRight" className="h-4 w-4 text-slate-600" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase text-slate-400">
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
              // A "quality" workout - anything more structured than an easy run or plain rest - gets its own marker so it stands out from an easy day at a glance.
              const hasQualityWorkout = dayList.some((d2) => d2.intervalStructure || (d2.runLabel && d2.runLabel !== "easy" && d2.runLabel !== "recovery_run"));
              const unitAbbrev = (u: api.TrainingDistanceUnit) => (u === "miles" ? "mi" : u === "km" ? "km" : u === "meters" ? "m" : "yd");
              // Two runs, both with a real distance - show "3 + 4 = 7mi" rather than just the total, so both are visible at a glance. Converts the second into the first's unit if they differ.
              // Two sessions with real distances. Shows the TOTAL only, not
              // "3+4=7mi": at the 11px accessibility floor the equation cannot
              // fit a ~50px cell, and per the Calendar Spec the arithmetic was
              // noise anyway — it hides which session was the quality one, and
              // the total belongs in the week header. Renders "3 · 4", NOT the
              // sum: "7" is visually identical to a single 7-mile run, so
              // collapsing to a total loses the one thing the cell must convey
              // — that there were two sessions, and that an AM shakeout and a
              // PM tempo are not seven miles of the same thing. Four chars
              // shorter than "3+4=7mi", so it fits the cell at the 11px floor,
              // and the "2" badge reinforces it.
              //
              // aspect-square has already been DROPPED (the cell is
              // min-h-[58px]) — a 50px square could not hold "AM 3 · PM 4" at
              // the 11px floor. What remains for Phase 1.5 is the full stacked
              // -row layout: one row per session, three-plus sessions without
              // truncation, and the weekly total moved to the week row header
              // — the convention TrainingPeaks, Final Surge, and Garmin share.
              const twoRunSplit = dayList.length === 2 && dayList[0].distanceValue != null && dayList[1].distanceValue != null
                ? (() => {
                    const [a, b] = dayList;
                    // Converted into the first session's unit so "3 · 4" is a
                    // like-for-like comparison rather than two different scales.
                    // BUG 3: this used to convert into the FIRST session's unit,
                    // so an AM track session in meters rendered the day as
                    // "11229.53". Meters and yards are input units — that is how
                    // tracks are measured — never totals units. Both sessions now
                    // display in a real total unit, rounded to one decimal.
                    const unit = totalUnitFor([a.distanceUnit, b.distanceUnit]);
                    const av = toTotal(a.distanceValue!, a.distanceUnit, unit);
                    const bInAUnit = toTotal(b.distanceValue!, b.distanceUnit, unit);
                    // WHICH session is the morning one is the entire point of
                    // scanning this at wake-up. Labels only appear when times
                    // are actually set — an unlabelled pair is still honest.
                    const la = slotLabel(a.scheduledTime, a.slot);
                    const lb = slotLabel(b.scheduledTime, b.slot);
                    return la && lb
                      ? `${la} ${av} · ${lb} ${bInAUnit}${totalUnitLabel(unit)}`
                      : `${av} · ${bInAUnit}${totalUnitLabel(unit)}`;
                  })()
                : null;
              return (
                <button
                  key={dateStr}
                  type="button"
                  disabled={!inPlan}
                  onClick={() => setSelectedDate(dateStr)}
                  className={`relative flex min-h-[58px] flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1 text-[11px] ${
                    !inMonth ? "text-slate-300" : !inPlan ? "text-slate-300" : "text-slate-800"
                  } ${selectedDate === dateStr ? "ring-2 ring-[#14171C]" : ""} ${meta ? meta.color : inPlan ? "bg-slate-50" : ""} ${dateStr === today ? "font-extrabold" : ""}`}
                >
                  <span className="text-[12px]">{d.getUTCDate()}</span>
                  {twoRunSplit ? (
                    <span className="text-[11px] font-bold leading-none">{twoRunSplit}</span>
                  ) : primary ? (
                    <span className="text-[11px] font-bold leading-none">
                      {primary.workoutType === "rest" ? "Rest" : primary.distanceValue != null ? `${primary.distanceValue}${unitAbbrev(primary.distanceUnit)}` : meta?.label}
                    </span>
                  ) : null}
                  {hasQualityWorkout ? <Icon name="spark" className="absolute left-1 top-1 h-3 w-3 text-[#FF5741]" /> : dayList.length > 1 ? <span className="absolute left-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-[#14171C] text-[11px] font-black text-white">2</span> : null}
                  {anyFrozen ? <Icon name="shield" className="absolute right-1 top-1 h-3 w-3 text-slate-400" /> : null}
                  {primary?.completionStatus === "done" ? <Icon name="check" className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 text-emerald-600" /> : null}
                  {primary?.completionStatus === "missed" ? <span className="absolute bottom-0.5 right-0.5 text-[11px] font-black text-rose-500">✕</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:sticky lg:top-4">
      {selectedDate ? (
        <div className="mt-4 space-y-3 lg:mt-5">
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
            <SecondWorkoutPrompt
              onAdd={(time) => {
                // Uses the shared resolver. This is where the slot is actually
                // ASSIGNED, so an inline copy of `hour < 12` here would be the
                // one that silently disagrees with everything reading it back.
                const slot = resolveSlot(time, "primary");
                setDaysByDate((prev) => ({ ...prev, [selectedDate]: [...(prev[selectedDate] ?? []), { slot, scheduledTime: time } as api.TrainingPlanDayView] }));
              }}
            />
          ) : null}
        </div>
      ) : (
        <p className="mt-5 text-center text-[13px] text-slate-400">Tap a day to see or plan its workout.</p>
      )}
        </div>
      </div>

      {recurrenceOpen ? (
        <RecurrenceSchedulerSheet
          planStart={planStart}
          planEnd={planEnd}
          onClose={() => setRecurrenceOpen(false)}
          onCreated={(generatedCount) => {
            setRecurrenceOpen(false);
            toast(`Scheduled ${generatedCount} day${generatedCount === 1 ? "" : "s"}.`, "success");
            void api.getTrainingPlanDays().then((r) => {
              if (!r.ok) return;
              const byDate: Record<string, api.TrainingPlanDayView[]> = {};
              for (const d of r.data.days) (byDate[d.date] ??= []).push(d);
              setDaysByDate(byDate);
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** A real time input for a second workout - AM/PM is derived from the time chosen, never picked manually, matching how you'd actually think about your day. */
function SecondWorkoutPrompt({ onAdd }: { onAdd: (time: string) => void }) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState("17:00");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-[13px] font-bold text-slate-500">
        + Add a second workout
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-3">
      <p className="mb-2 text-[13px] font-bold text-slate-700">What time does it start?</p>
      <div className="flex gap-2">
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label="Start time of the second workout"
          className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
        />
        <button type="button" onClick={() => onAdd(time)} className="h-11 rounded-lg bg-[#14171C] px-4 text-[13px] font-bold text-white">Add</button>
      </div>
      {/* Routed through the shared resolver rather than repeating `hour < 12`
          inline. This screen and the day panel must never disagree about which
          slot a time lands in — that was a second copy of the rule waiting to
          drift from the first. */}
      <p className="mt-1.5 text-[11px] text-slate-500">
        {slotLabel(time, "primary") === "AM" ? "Morning (AM)" : "Afternoon/evening (PM)"} workout
      </p>
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
  const [scheduledTime, setScheduledTime] = useState(day?.scheduledTime ?? "");
  const [runLabel, setRunLabel] = useState<api.TrainingRunLabel | "">(day?.runLabel ?? "");
  const [distanceValue, setDistanceValue] = useState(day?.distanceValue?.toString() ?? "");
  const [distanceUnit, setDistanceUnit] = useState<api.TrainingDistanceUnit>(day?.distanceUnit ?? "miles");
  const [structureMode, setStructureMode] = useState<"simple" | "intervals">(day?.intervalStructure ? "intervals" : "simple");
  const [warmupValue, setWarmupValue] = useState(day?.intervalStructure?.warmupValue?.toString() ?? "");
  const [warmupUnit, setWarmupUnit] = useState<api.TrainingDistanceUnit>(day?.intervalStructure?.warmupUnit ?? "miles");
  const [repeatCount, setRepeatCount] = useState(day?.intervalStructure?.repeatCount?.toString() ?? "6");
  const [workMeasure, setWorkMeasure] = useState<api.IntervalMeasure>(day?.intervalStructure?.workMeasure ?? "distance");
  const [workValue, setWorkValue] = useState(day?.intervalStructure?.workValue?.toString() ?? "400");
  const [workUnit, setWorkUnit] = useState<api.TrainingDistanceUnit>(day?.intervalStructure?.workUnit ?? "meters");
  const [workDurationUnit, setWorkDurationUnit] = useState<api.DurationUnit>(day?.intervalStructure?.workDurationUnit ?? "seconds");
  const [workPaceTarget, setWorkPaceTarget] = useState<api.PaceZoneTarget | "">(day?.intervalStructure?.workPaceTarget ?? "");
  const [hasRest, setHasRest] = useState(day?.intervalStructure?.hasRest ?? true);
  const [restType, setRestType] = useState<api.RecoveryType>(day?.intervalStructure?.restType ?? "jog");
  const [restMeasure, setRestMeasure] = useState<api.IntervalMeasure>(day?.intervalStructure?.restMeasure ?? "distance");
  const [restValue, setRestValue] = useState(day?.intervalStructure?.restValue?.toString() ?? "200");
  const [restUnit, setRestUnit] = useState<api.TrainingDistanceUnit>(day?.intervalStructure?.restUnit ?? "meters");
  const [restDurationUnit, setRestDurationUnit] = useState<api.DurationUnit>(day?.intervalStructure?.restDurationUnit ?? "seconds");
  const [cooldownValue, setCooldownValue] = useState(day?.intervalStructure?.cooldownValue?.toString() ?? "");
  const [cooldownUnit, setCooldownUnit] = useState<api.TrainingDistanceUnit>(day?.intervalStructure?.cooldownUnit ?? "miles");
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
  const [myRuns, setMyRuns] = useState<api.MyRunView[] | null>(null);
  const [linkedOccurrenceId, setLinkedOccurrenceId] = useState(day?.linkedEventOccurrenceId ?? "");
  const [linkSaving, setLinkSaving] = useState(false);

  useEffect(() => {
    void api.getMyRuns().then((r) => { if (r.ok) setMyRuns(r.data.runs); });
  }, []);

  // Only real group runs (RSVP'd, not a solo entry) on this exact date can be linked - matches
  // exactly what the server itself validates (a real attendance row for that occurrence).
  const runsThisDay = (myRuns ?? []).filter((r) => r.kind === "rsvp" && r.occurrenceId && (r.runDate ?? r.date) === date);

  const linkGroupRun = async (occurrenceId: string) => {
    setLinkSaving(true);
    const r = await api.setTrainingPlanDay(date, { linkedEventOccurrenceId: occurrenceId || null }, slot);
    setLinkSaving(false);
    if (r.ok) { setLinkedOccurrenceId(occurrenceId); onSaved(r.data.day); }
  };

  const isPastOrToday = date <= toDateStr(new Date());
  const frozen = day?.frozen === true;

  const save = async () => {
    setSaving(true);
    setError(null);
    const intervalStructure: api.IntervalStructure | null = structureMode === "intervals" && repeatCount.trim() && workValue.trim() ? {
      warmupValue: warmupValue.trim() ? Number(warmupValue) : null,
      warmupUnit: warmupValue.trim() ? warmupUnit : null,
      repeatCount: Number(repeatCount),
      workMeasure,
      workValue: Number(workValue),
      workUnit: workMeasure === "distance" ? workUnit : null,
      workDurationUnit: workMeasure === "duration" ? workDurationUnit : null,
      workPaceTarget: workPaceTarget || null,
      hasRest,
      restType: hasRest ? restType : null,
      restMeasure: hasRest ? restMeasure : null,
      restValue: hasRest && restValue.trim() ? Number(restValue) : null,
      restUnit: hasRest && restMeasure === "distance" ? restUnit : null,
      restDurationUnit: hasRest && restMeasure === "duration" ? restDurationUnit : null,
      cooldownValue: cooldownValue.trim() ? Number(cooldownValue) : null,
      cooldownUnit: cooldownValue.trim() ? cooldownUnit : null,
    } : null;
    // A distance-based interval's total is knowable up front - prefill distanceValue as a
    // convenience so mileage tracking and the calendar cell still show a real number; a
    // time-based interval's total distance is genuinely unknown until actually run.
    let effectiveDistanceValue = distanceValue.trim() ? Number(distanceValue) : null;
    let effectiveDistanceUnit = distanceUnit;
    if (intervalStructure && intervalStructure.workMeasure === "distance" && intervalStructure.workUnit) {
      const toUnit = intervalStructure.workUnit;
      const convert = (v: number, from: api.TrainingDistanceUnit) => {
        if (from === toUnit) return v;
        const toMiles = (val: number, u: api.TrainingDistanceUnit) => (u === "miles" ? val : u === "km" ? val * 0.621371 : u === "meters" ? val * 0.000621371 : val * 0.000568182);
        const fromMilesTo = (miles: number, u: api.TrainingDistanceUnit) => (u === "miles" ? miles : u === "km" ? miles / 0.621371 : u === "meters" ? miles / 0.000621371 : miles / 0.000568182);
        return fromMilesTo(toMiles(v, from), toUnit);
      };
      const restContribution = intervalStructure.hasRest && intervalStructure.restMeasure === "distance" && intervalStructure.restValue && intervalStructure.restUnit ? convert(intervalStructure.restValue, intervalStructure.restUnit) : 0;
      const warmupContribution = intervalStructure.warmupValue && intervalStructure.warmupUnit ? convert(intervalStructure.warmupValue, intervalStructure.warmupUnit) : 0;
      const cooldownContribution = intervalStructure.cooldownValue && intervalStructure.cooldownUnit ? convert(intervalStructure.cooldownValue, intervalStructure.cooldownUnit) : 0;
      effectiveDistanceValue = Math.round((intervalStructure.repeatCount * (intervalStructure.workValue + restContribution) + warmupContribution + cooldownContribution) * 100) / 100;
      effectiveDistanceUnit = toUnit;
    }
    const r = await api.setTrainingPlanDay(date, {
      workoutType,
      runLabel: runLabel || null,
      scheduledTime: scheduledTime || null,
      title: title.trim(),
      distanceValue: effectiveDistanceValue,
      distanceUnit: effectiveDistanceUnit,
      intervalStructure,
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

  const fieldCls = "h-10 rounded-lg border border-slate-200 px-3 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";
  const dateLabel = new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[15px] font-bold text-slate-900">
          {dateLabel}{" "}
          {/*
            Was gated on slot !== "primary", so the FIRST session never showed
            its time — the model bug surfacing in the UI. Now driven by whether
            a time actually exists, which is the real question.
          */}
          {day?.scheduledTime ? (
            <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-500">
              {slotLabel(day.scheduledTime, slot)} · {new Date(`2000-01-01T${day.scheduledTime}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
          ) : slot !== "primary" ? (
            <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-500">{slot}</span>
          ) : null}
          {frozen ? <Icon name="shield" className="ml-1.5 inline h-3.5 w-3.5 text-slate-400" /> : null}
        </p>
        <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-slate-100" aria-label="Close"><Icon name="close" className="h-4 w-4" /></button>
      </div>

      {frozen ? <p className="mb-3 rounded-xl bg-slate-50 p-2.5 text-[12px] font-semibold text-slate-500">Your coach has locked this day completely — nothing can be changed here, including logging progress or linking a group run, until they unlock it.</p> : null}
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
          {workoutType === "run" || workoutType === "race" ? (
            <select value={runLabel} onChange={(e) => setRunLabel(e.target.value as api.TrainingRunLabel | "")} className={`w-full ${fieldCls}`}>
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
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={workoutType === "swim" ? "e.g. Interval swim" : "e.g. Tempo run"} className={`w-full ${fieldCls}`} maxLength={60} />
          {/*
            "Starts at", never "Time". The interval toggles below use "Duration"
            for a length of time, so a bare "Time" here left two different
            meanings of the word on one screen with nothing saying which.

            The live "→ AM/PM" readout exists because type="time" renders in
            24-hour form under many OS locales, and slot derivation keys off
            hour < 12. Without it, an athlete who reads 18:00 as 6 lands in the
            wrong slot with no signal. Showing the consequence as they type
            makes the derivation legible rather than magic — and it is less UI
            than forcing a bespoke 12-hour control with its own AM/PM toggle.
          */}
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-500">Starts at</span>
            <input
              type="time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              aria-label="Start time of day"
              className="h-11 rounded-lg border border-slate-200 px-2.5 text-[13px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
            />
            {scheduledTime ? (
              <span className="text-[13px] font-bold text-[#14171C]">
                → {slotLabel(scheduledTime, slot) ?? "—"}
              </span>
            ) : (
              <span className="text-[13px] text-slate-400">optional</span>
            )}
          </div>

          <div className="flex gap-1.5">
            <button type="button" onClick={() => setStructureMode("simple")} className={`flex-1 rounded-lg py-2 text-[12px] font-bold ${structureMode === "simple" ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}>Simple distance</button>
            <button type="button" onClick={() => setStructureMode("intervals")} className={`flex-1 rounded-lg py-2 text-[12px] font-bold ${structureMode === "intervals" ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}>Intervals</button>
          </div>

          {structureMode === "simple" ? (
            <div className="flex gap-2">
              <input type="number" min="0" value={distanceValue} onChange={(e) => setDistanceValue(e.target.value)} placeholder="Distance" className={`min-w-0 flex-1 ${fieldCls}`} />
              <select value={distanceUnit} onChange={(e) => setDistanceUnit(e.target.value as api.TrainingDistanceUnit)} className={`w-28 ${fieldCls}`}>
                {UNITS_FOR_TYPE[workoutType].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl bg-slate-50 p-3">
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Warm-up (optional)</p>
                <div className="flex gap-2">
                  <input type="number" min="0" value={warmupValue} onChange={(e) => setWarmupValue(e.target.value)} placeholder="Distance" className={`min-w-0 flex-1 ${fieldCls}`} />
                  <select value={warmupUnit} onChange={(e) => setWarmupUnit(e.target.value as api.TrainingDistanceUnit)} className={`w-24 ${fieldCls}`}>
                    {(["miles", "km", "meters", "yards"] as const).map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-slate-700">Repeat</span>
                <input type="number" min="1" max="100" value={repeatCount} onChange={(e) => setRepeatCount(e.target.value)} className={`min-w-0 w-20 ${fieldCls}`} />
                <span className="text-[13px] font-bold text-slate-700">times</span>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Work interval</p>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setWorkMeasure("distance")} className={`flex-1 rounded-lg py-1.5 text-[12px] font-bold ${workMeasure === "distance" ? "bg-[#14171C] text-white" : "bg-white text-slate-600"}`}>Distance</button>
                  <button type="button" onClick={() => setWorkMeasure("duration")} className={`flex-1 rounded-lg py-1.5 text-[12px] font-bold ${workMeasure === "duration" ? "bg-[#14171C] text-white" : "bg-white text-slate-600"}`}>Duration</button>
                </div>
                <div className="mt-1.5 flex gap-2">
                  <input type="number" min="0" value={workValue} onChange={(e) => setWorkValue(e.target.value)} placeholder={workMeasure === "duration" ? "Duration" : "Distance"} className={`min-w-0 flex-1 ${fieldCls}`} />
                  {workMeasure === "distance" ? (
                    <select value={workUnit} onChange={(e) => setWorkUnit(e.target.value as api.TrainingDistanceUnit)} className={`w-24 ${fieldCls}`}>
                      {(["meters", "yards", "miles", "km"] as const).map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  ) : (
                    <select value={workDurationUnit} onChange={(e) => setWorkDurationUnit(e.target.value as api.DurationUnit)} className={`w-24 ${fieldCls}`}>
                      <option value="seconds">seconds</option>
                      <option value="minutes">minutes</option>
                    </select>
                  )}
                </div>
                <select value={workPaceTarget} onChange={(e) => setWorkPaceTarget(e.target.value as api.PaceZoneTarget | "")} className={`mt-1.5 w-full ${fieldCls}`}>
                  <option value="">No pace target</option>
                  <option value="easy">Easy pace</option>
                  <option value="marathon">Marathon pace</option>
                  <option value="threshold">Threshold pace</option>
                  <option value="interval">Interval pace</option>
                </select>
              </div>

              <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-600">
                <input type="checkbox" checked={hasRest} onChange={(e) => setHasRest(e.target.checked)} className="h-4 w-4" />
                Rest between reps
              </label>

              {hasRest ? (
                <div>
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Rest interval</p>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setRestType("jog")} className={`flex-1 rounded-lg py-1.5 text-[12px] font-bold ${restType === "jog" ? "bg-[#14171C] text-white" : "bg-white text-slate-600"}`}>Jog</button>
                    <button type="button" onClick={() => setRestType("walk")} className={`flex-1 rounded-lg py-1.5 text-[12px] font-bold ${restType === "walk" ? "bg-[#14171C] text-white" : "bg-white text-slate-600"}`}>Walk</button>
                    <button type="button" onClick={() => setRestType("stand")} className={`flex-1 rounded-lg py-1.5 text-[12px] font-bold ${restType === "stand" ? "bg-[#14171C] text-white" : "bg-white text-slate-600"}`}>Stand</button>
                  </div>
                  <div className="mt-1.5 flex gap-1.5">
                    <button type="button" onClick={() => setRestMeasure("distance")} className={`flex-1 rounded-lg py-1.5 text-[12px] font-bold ${restMeasure === "distance" ? "bg-slate-700 text-white" : "bg-white text-slate-600"}`}>Distance</button>
                    <button type="button" onClick={() => setRestMeasure("duration")} className={`flex-1 rounded-lg py-1.5 text-[12px] font-bold ${restMeasure === "duration" ? "bg-slate-700 text-white" : "bg-white text-slate-600"}`}>Duration</button>
                  </div>
                  <div className="mt-1.5 flex gap-2">
                    <input type="number" min="0" value={restValue} onChange={(e) => setRestValue(e.target.value)} placeholder={restMeasure === "duration" ? "Duration" : "Distance"} className={`min-w-0 flex-1 ${fieldCls}`} />
                    {restMeasure === "distance" ? (
                      <select value={restUnit} onChange={(e) => setRestUnit(e.target.value as api.TrainingDistanceUnit)} className={`w-24 ${fieldCls}`}>
                        {(["meters", "yards", "miles", "km"] as const).map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    ) : (
                      <select value={restDurationUnit} onChange={(e) => setRestDurationUnit(e.target.value as api.DurationUnit)} className={`w-24 ${fieldCls}`}>
                        <option value="seconds">seconds</option>
                        <option value="minutes">minutes</option>
                      </select>
                    )}
                  </div>
                </div>
              ) : null}

              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Cool-down (optional)</p>
                <div className="flex gap-2">
                  <input type="number" min="0" value={cooldownValue} onChange={(e) => setCooldownValue(e.target.value)} placeholder="Distance" className={`min-w-0 flex-1 ${fieldCls}`} />
                  <select value={cooldownUnit} onChange={(e) => setCooldownUnit(e.target.value as api.TrainingDistanceUnit)} className={`w-24 ${fieldCls}`}>
                    {(["miles", "km", "meters", "yards"] as const).map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              {workMeasure === "distance" && repeatCount.trim() && workValue.trim() ? (
                <p className="text-[12px] font-semibold text-slate-500">
                  Main set: {Number(repeatCount)} x {workValue}{workUnit}{hasRest && restMeasure === "distance" && restValue.trim() ? ` (${restValue}${restUnit} ${restType})` : hasRest ? ` (${restType} recovery)` : ""}
                </p>
              ) : workMeasure === "duration" && repeatCount.trim() && workValue.trim() ? (
                <p className="text-[12px] font-semibold text-slate-500">
                  Main set: {Number(repeatCount)} x {workValue}{workDurationUnit === "minutes" ? "min" : "s"}{hasRest && restValue.trim() ? ` (${restValue}${restMeasure === "duration" ? (restDurationUnit === "minutes" ? "min" : "s") : restUnit} ${restType})` : ""}
                </p>
              ) : null}
            </div>
          )}

          {workoutType === "run" || workoutType === "race" ? (
            <>
              <select value={addingShoe ? "__new__" : shoeId} onChange={(e) => { if (e.target.value === "__new__") setAddingShoe(true); else { setAddingShoe(false); setShoeId(e.target.value); } }} className={`w-full ${fieldCls}`}>
                <option value="">No shoe picked</option>
                {localShoes.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.totalMiles.toFixed(1)} mi{s.isDefault ? " (default)" : ""}</option>)}
                <option value="__new__">+ Add a new shoe</option>
              </select>
              {addingShoe ? (
                <div className="flex gap-2">
                  <input value={newShoeName} onChange={(e) => setNewShoeName(e.target.value)} placeholder="e.g. Nike Pegasus 40" className={`min-w-0 flex-1 ${fieldCls}`} maxLength={60} />
                  <button type="button" onClick={() => void addNewShoe()} className="shrink-0 rounded-lg bg-[#14171C] px-3 text-[13px] font-bold text-white">Add</button>
                </div>
              ) : null}
              <Link to="/shoes" className="block text-[12px] font-semibold text-slate-500 underline underline-offset-2">Manage shoes & mileage →</Link>
              <div className="flex gap-2">
                <input value={fuelNotes} onChange={(e) => setFuelNotes(e.target.value)} placeholder="Gels / fuel (optional)" className={`min-w-0 flex-1 ${fieldCls}`} maxLength={200} />
                <input value={hydrationNotes} onChange={(e) => setHydrationNotes(e.target.value)} placeholder="Water (optional)" className={`min-w-0 flex-1 ${fieldCls}`} maxLength={200} />
              </div>
            </>
          ) : null}
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-slate-500">Rest day — nothing planned.</p>
      )}

      <button type="button" disabled={saving} onClick={() => void save()} className="mt-3 h-11 w-full rounded-full bg-[#14171C] text-[13px] font-bold text-white disabled:opacity-50">
        {saving ? "Saving…" : "Save day"}
      </button>

      {!frozen && workoutType !== "rest" ? (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-2 text-[13px] font-bold text-slate-700">Link to a group run</p>
          {runsThisDay.length > 0 ? (
            <>
              <p className="mb-2 text-[11px] text-slate-500">You're RSVP'd to {runsThisDay.length === 1 ? "this run" : "these runs"} on this day — link one so your plan shows exactly when and where.</p>
              <div className="space-y-1.5">
                {runsThisDay.map((run) => {
                  const linked = linkedOccurrenceId === run.occurrenceId;
                  return (
                    <button
                      key={run.occurrenceId}
                      type="button"
                      disabled={linkSaving}
                      onClick={() => void linkGroupRun(linked ? "" : (run.occurrenceId ?? ""))}
                      className={`flex w-full items-center justify-between rounded-xl p-3 text-left ${linked ? "bg-[#FF5741]/10 ring-1 ring-[#FF5741]/40" : "bg-slate-50"}`}
                    >
                      <span>
                        <span className="block text-[13px] font-bold text-slate-900">{run.title}</span>
                        <span className="block text-[12px] text-slate-500">{run.time} · {run.location}</span>
                      </span>
                      {linked ? <Icon name="check" className="h-4 w-4 shrink-0 text-[#FF5741]" /> : null}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="rounded-xl bg-slate-50 p-3 text-[12px] text-slate-500">
              No group runs you're RSVP'd to on this day yet.{" "}
              <Link to="/" className="font-bold text-[#14171C] underline underline-offset-2">RSVP to one from Events</Link> and it'll show up here to link.
            </p>
          )}
        </div>
      ) : null}

      {isPastOrToday && workoutType !== "rest" && !frozen ? (
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
            <select value={missedReason} onChange={(e) => setMissedReason(e.target.value as api.TrainingDayMissedReason)} className={`mt-2.5 w-full ${fieldCls}`}>
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
              className="mt-2.5 h-11 w-full rounded-full bg-slate-800 text-[12px] font-bold text-white disabled:opacity-50"
            >
              {loggingSaving ? "Logging…" : "Log it"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
