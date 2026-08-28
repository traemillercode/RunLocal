import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/ui";
import { predictAllDistances, computeTrainingZones, formatPace, formatDuration } from "../lib/paceCalculator";

const DISTANCE_LABELS: Record<string, string> = { "5k": "5K", "10k": "10K", half_marathon: "Half Marathon", marathon: "Marathon" };
const ZONE_LABELS: Record<string, { label: string; hint: string }> = {
  interval: { label: "Interval", hint: "Hard, controlled — roughly your current 5K pace" },
  threshold: { label: "Threshold / Tempo", hint: "Comfortably hard — sustainable for about an hour" },
  marathon: { label: "Marathon", hint: "Steady effort for a long race" },
  easy: { label: "Easy", hint: "Conversational — most of your weekly miles belong here" },
};

/**
 * Predicts race times at other distances and derives training paces from
 * one known result - Riegel's formula for predictions, Daniels' published
 * training-zone percentages for the paces. Real, sourced math, not a
 * made-up estimate - see src/lib/paceCalculator.ts for the exact formulas
 * and citations.
 */
export function PaceCalculatorPage() {
  const [minutes, setMinutes] = useState("22");
  const [seconds, setSeconds] = useState("00");
  const [distance, setDistance] = useState<"5k" | "10k" | "half_marathon" | "marathon">("5k");

  const knownSeconds = (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
  const knownMiles = { "5k": 3.10686, "10k": 6.21371, half_marathon: 13.10938, marathon: 26.21875 }[distance];
  const valid = knownSeconds > 0;

  const predictions = valid ? predictAllDistances(knownSeconds, knownMiles) : [];
  const zones = valid ? computeTrainingZones(knownSeconds, knownMiles) : null;

  return (
    <div className="mx-auto max-w-lg px-4 py-6 pb-24">
      <Link to="/training-plan" className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500">
        <Icon name="chevronRight" className="h-3.5 w-3.5 rotate-180" /> Back to training plan
      </Link>
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF5741]">Pace calculator</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">What should I run?</h1>
      <p className="mt-1 text-sm text-slate-500">Enter a real race result and get predicted times at other distances, plus real training paces — using Riegel's formula and Jack Daniels' published training-zone percentages, not a guess.</p>

      <div className="mt-5 rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
        <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-500">A recent race result</p>
        <div className="flex flex-wrap gap-1.5">
          {(["5k", "10k", "half_marathon", "marathon"] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDistance(d)} className={`rounded-full px-3 py-1.5 text-[12px] font-bold ${distance === d ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-600"}`}>
              {DISTANCE_LABELS[d]}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input type="number" min="0" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="h-11 w-20 rounded-lg border border-slate-200 px-3 text-center text-[16px] font-bold outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
          <span className="text-lg font-bold text-slate-400">:</span>
          <input type="number" min="0" max="59" value={seconds} onChange={(e) => setSeconds(e.target.value)} className="h-11 w-20 rounded-lg border border-slate-200 px-3 text-center text-[16px] font-bold outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60" />
          <span className="text-[13px] text-slate-500">min : sec, finish time for a {DISTANCE_LABELS[distance]}</span>
        </div>
      </div>

      {valid ? (
        <>
          <p className="mb-2 mt-6 text-[13px] font-bold text-slate-700">Predicted race times</p>
          <p className="mb-2 text-[11px] text-slate-400">Most accurate close to your input distance — a 5K predicts a 10K far better than it predicts a marathon.</p>
          <div className="space-y-1.5">
            {predictions.map((p) => (
              <div key={p.distance} className="flex items-center justify-between rounded-xl bg-white p-3 ring-1 ring-slate-200/70">
                <span className={`text-[13px] font-bold ${p.distance === distance ? "text-[#FF5741]" : "text-slate-900"}`}>{DISTANCE_LABELS[p.distance]}{p.distance === distance ? " (entered)" : ""}</span>
                <span className="text-[13px] font-bold text-slate-700">{formatDuration(p.seconds)} <span className="font-normal text-slate-400">· {formatPace(p.paceSecPerMile)}</span></span>
              </div>
            ))}
          </div>

          <p className="mb-2 mt-6 text-[13px] font-bold text-slate-700">Training paces</p>
          <div className="space-y-1.5">
            {zones ? (["interval", "threshold", "marathon", "easy"] as const).map((z) => (
              <div key={z} className="rounded-xl bg-white p-3 ring-1 ring-slate-200/70">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-slate-900">{ZONE_LABELS[z].label}</span>
                  <span className="text-[13px] font-bold text-[#14171C]">{formatPace(zones[z])}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">{ZONE_LABELS[z].hint}</p>
              </div>
            )) : null}
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
            Riegel's formula (Riegel, 1981) predicts equivalent race times. Training zones are simplified from Jack Daniels' published %vVO2max ranges — a real, sourced approximation, not the full empirical VDOT tables. Recalculate every 4–8 weeks or after a new race result.
          </p>
        </>
      ) : (
        <p className="mt-6 text-center text-sm text-slate-400">Enter a finish time above.</p>
      )}
    </div>
  );
}
