import { useEffect, useState } from "react";
import { localISODate } from "../lib/dates";
import { Link } from "react-router-dom";
import * as api from "../lib/api";
import { Icon } from "../components/ui";

type ViewMode = "day" | "week" | "month";

function toDateStr(d: Date): string {
  return localISODate(d);
}
function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

/** Computes [start, end] for the given view mode, anchored on `anchor`, honoring the account's own week-start-day preference for the week view. */
function rangeFor(mode: ViewMode, anchor: Date, weekStartDay: 0 | 1): { start: string; end: string; label: string } {
  if (mode === "day") {
    const s = toDateStr(anchor);
    return { start: s, end: s, label: anchor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) };
  }
  if (mode === "week") {
    const dow = anchor.getUTCDay();
    const diff = (dow - weekStartDay + 7) % 7;
    const start = addDays(anchor, -diff);
    const end = addDays(start, 6);
    return { start: toDateStr(start), end: toDateStr(end), label: `${start.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}` };
  }
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  return { start: toDateStr(start), end: toDateStr(end), label: anchor.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) };
}

function shiftAnchor(mode: ViewMode, anchor: Date, dir: 1 | -1): Date {
  if (mode === "day") return addDays(anchor, dir);
  if (mode === "week") return addDays(anchor, dir * 7);
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + dir, 1));
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  done: { label: "Done", color: "text-emerald-700 bg-emerald-50" },
  missed: { label: "Missed", color: "text-rose-700 bg-rose-50" },
  modified: { label: "Modified", color: "text-amber-700 bg-amber-50" },
  pending: { label: "Not logged yet", color: "text-slate-500 bg-slate-100" },
};

/**
 * The actual "end of week/month update" - one endpoint, three views. Shows
 * what was planned, what was actually logged, and specifically calls out
 * activities that were NOT linked to the training plan (solo runs, extra
 * group runs) separately from the ones that were - a beautiful-enough,
 * simple dashboard rather than a spreadsheet.
 */
export function TrainingSummaryPage() {
  const [mode, setMode] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(new Date());
  const [weekStartDay] = useState<0 | 1>(0);
  const [summary, setSummary] = useState<api.TrainingSummaryView | null>(null);
  const [blockSummary, setBlockSummary] = useState<api.BlockSummaryView | null>(null);
  const [score, setScore] = useState<api.WeekScoreView | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const { start, end, label } = rangeFor(mode, anchor, weekStartDay);

  useEffect(() => {
    void api.getTrainingSummary(start, end).then((r) => { if (r.ok) setSummary(r.data); });
    void api.getBlockSummary(start, end).then((r) => { if (r.ok) setBlockSummary(r.data); });
  }, [start, end]);

  useEffect(() => {
    if (mode !== "week") { setScore(null); return; }
    void api.getWeekScore(start).then((r) => { if (r.ok) setScore(r.data); });
  }, [mode, start]);

  const submitReview = async () => {
    if (!score || !reviewNotes.trim()) return;
    setReviewSubmitting(true);
    setReviewError(null);
    const r = await api.submitWeeklyReview(score.priorWeekStartDate, reviewNotes.trim());
    setReviewSubmitting(false);
    if (r.ok) {
      setReviewNotes("");
      void api.getWeekScore(start).then((res) => { if (res.ok) setScore(res.data); });
    } else {
      setReviewError(r.error.message ?? "Couldn't submit that.");
    }
  };

  const loggableDays = summary?.planDays.filter((d) => d.workoutType !== "rest") ?? [];

  return (
    <div className="desktop-reading-narrow mx-auto max-w-2xl px-4 py-6 pb-24">
      <Link to="/training-plan" className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500">
        <Icon name="chevronRight" className="h-3.5 w-3.5 rotate-180" /> Back to training plan
      </Link>
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Training summary</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Your week at a glance</h1>

      <div className="mt-4 flex rounded-full bg-slate-100 p-1">
        {(["day", "week", "month"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`flex-1 rounded-full py-2 text-[13px] font-bold capitalize ${mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
            {m}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={() => setAnchor((a) => shiftAnchor(mode, a, -1))} className="grid h-11 w-9 place-items-center rounded-full bg-slate-100"><Icon name="chevronRight" className="h-4 w-4 rotate-180 text-slate-600" /></button>
        <p className="text-[15px] font-bold text-slate-900">{label}</p>
        <button type="button" onClick={() => setAnchor((a) => shiftAnchor(mode, a, 1))} className="grid h-11 w-9 place-items-center rounded-full bg-slate-100"><Icon name="chevronRight" className="h-4 w-4 text-slate-600" /></button>
      </div>

      {score ? (
        <div className="mt-3 flex items-center justify-center gap-2">
          <span className={`rounded-full px-3 py-1 text-[12px] font-extrabold uppercase tracking-wide ${
            score.overallColor === "green" ? "bg-emerald-100 text-emerald-800" : score.overallColor === "yellow" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"
          }`}>
            {score.overallColor} week
          </span>
          <span className="text-[11px] text-slate-400">Runs: {score.runColor} · Strength: {score.strengthColor}</span>
        </div>
      ) : null}

      {score?.priorWeekBlocking ? (
        <div className="mt-4 rounded-2xl border-2 border-rose-200 bg-rose-50 p-4">
          <p className="text-[14px] font-extrabold text-rose-900">Last week needs a review</p>
          <p className="mt-1 text-[13px] text-rose-800">The week of {new Date(`${score.priorWeekStartDate}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} scored red. Confirm you've looked at it and note what's changing before moving on.</p>
          <textarea
            rows={3}
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            placeholder="What's going to be different this week?"
            className="mt-3 w-full rounded-lg border border-rose-300 bg-white px-3 py-2 text-[14px] outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-300"
          />
          {reviewError ? <p role="alert" className="mt-2 text-[12px] font-semibold text-rose-700">{reviewError}</p> : null}
          <button type="button" disabled={reviewSubmitting || !reviewNotes.trim()} onClick={() => void submitReview()} className="mt-3 h-11 w-full rounded-full bg-rose-600 text-[13px] font-bold text-white disabled:opacity-50">
            {reviewSubmitting ? "Submitting…" : "Confirm reviewed"}
          </button>
        </div>
      ) : null}

      {!summary ? (
        <p className="mt-8 text-center text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Planned</p>
              <p className="mt-0.5 text-2xl font-extrabold text-slate-900">{summary.totals.plannedMiles} mi</p>
            </div>
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Actually logged</p>
              <p className="mt-0.5 text-2xl font-extrabold text-slate-900">{summary.totals.loggedMiles} mi</p>
            </div>
          </div>

          <div className="mt-2 flex gap-2 text-center text-[12px] font-bold">
            <div className="flex-1 rounded-xl bg-emerald-50 py-2 text-emerald-700">{summary.totals.daysDone} done</div>
            <div className="flex-1 rounded-xl bg-amber-50 py-2 text-amber-700">{summary.totals.daysModified} modified</div>
            <div className="flex-1 rounded-xl bg-rose-50 py-2 text-rose-700">{summary.totals.daysMissed} missed</div>
            <div className="flex-1 rounded-xl bg-slate-100 py-2 text-slate-500">{summary.totals.daysPending} pending</div>
          </div>

          <p className="mb-2 mt-6 text-[13px] font-bold text-slate-700">Planned workouts</p>
          {loggableDays.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing planned for this range.</p>
          ) : (
            <div className="space-y-1.5">
              {loggableDays.map((d) => {
                const meta = STATUS_META[d.completionStatus];
                return (
                  <div key={d.id} className="flex items-center justify-between rounded-xl bg-white p-3 ring-1 ring-slate-200/70">
                    <div>
                      <p className="text-[13px] font-bold text-slate-900">{new Date(`${d.date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</p>
                      <p className="text-[12px] text-slate-500">{d.title || d.workoutType}{d.distanceValue != null ? ` — ${d.distanceValue} ${d.distanceUnit}` : ""}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.color}`}>{meta.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {summary.linkedActivities.length > 0 ? (
            <>
              <p className="mb-2 mt-6 text-[13px] font-bold text-slate-700">Logged & linked to your plan</p>
              <div className="space-y-1.5">
                {summary.linkedActivities.map((a) => (
                  <div key={a.id} className="rounded-xl bg-white p-3 ring-1 ring-slate-200/70">
                    <p className="text-[13px] font-bold text-slate-900">{(a.distanceMeters * 0.000621371).toFixed(1)} mi — {Math.round(a.durationSeconds / 60)} min</p>
                    <p className="text-[12px] text-slate-500">{new Date(a.completedAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</p>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <p className="mb-2 mt-6 text-[13px] font-bold text-slate-700">Extra — not part of the plan</p>
          {summary.unlinkedActivities.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing extra this range.</p>
          ) : (
            <div className="space-y-1.5">
              {summary.unlinkedActivities.map((a) => (
                <div key={a.id} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                  <p className="text-[13px] font-bold text-slate-900">{(a.distanceMeters * 0.000621371).toFixed(1)} mi — {Math.round(a.durationSeconds / 60)} min</p>
                  <p className="text-[12px] text-slate-500">{new Date(a.completedAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · Solo/unplanned</p>
                </div>
              ))}
            </div>
          )}

          {blockSummary && (blockSummary.shoeMiles.length > 0 || blockSummary.totalGels > 0 || blockSummary.drinkMixUsage.length > 0) ? (
            <>
              <p className="mb-2 mt-6 text-[13px] font-bold text-slate-700">Gear & fuel this range</p>
              <div className="space-y-1.5">
                {blockSummary.shoeMiles.map((s) => (
                  <div key={s.shoeId} className="flex items-center justify-between rounded-xl bg-white p-3 ring-1 ring-slate-200/70">
                    <span className="text-[13px] font-bold text-slate-900">{s.shoeName}</span>
                    <span className="text-[13px] font-bold text-slate-700">{s.miles} mi</span>
                  </div>
                ))}
                {blockSummary.totalGels > 0 ? (
                  <div className="flex items-center justify-between rounded-xl bg-white p-3 ring-1 ring-slate-200/70">
                    <span className="text-[13px] font-bold text-slate-900">Gels</span>
                    <span className="text-[13px] font-bold text-slate-700">{blockSummary.totalGels}</span>
                  </div>
                ) : null}
                {blockSummary.drinkMixUsage.map((d) => (
                  <div key={d.nutritionItemId} className="flex items-center justify-between rounded-xl bg-white p-3 ring-1 ring-slate-200/70">
                    <span className="text-[13px] font-bold text-slate-900">{d.name}</span>
                    <span className="text-[13px] font-bold text-slate-700">{d.uses}x</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
