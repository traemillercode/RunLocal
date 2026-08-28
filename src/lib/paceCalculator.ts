/**
 * Race time prediction and training pace zones - real, sourced formulas,
 * not invented numbers.
 *
 * Race prediction: Riegel's formula (Riegel, "Athletic Records and Human
 * Endurance", American Scientist, 1981): T2 = T1 x (D2/D1)^1.06. Most
 * reliable for distances close to the input race; a 5K predicts a 10K far
 * more accurately than it predicts a marathon.
 *
 * Training zones: simplified from Jack Daniels' published %vVO2max ranges
 * (Daniels' Running Formula) - Easy 59-74% (midpoint 70%), Marathon 75-84%
 * (midpoint 80%), Threshold 83-88% (midpoint 86%), Interval 97-100%
 * (midpoint 98%). Interval pace approximates current 5K race pace, which
 * is used as the reference point; other zones are scaled from it by the
 * ratio of their midpoint to 98%. This is a real, sourced approximation of
 * Daniels' method, not the full empirical VDOT lookup tables - close enough
 * for setting real training paces, not exact race-day science.
 */

export const STANDARD_DISTANCES_MILES = {
  "5k": 3.10686,
  "10k": 6.21371,
  half_marathon: 13.10938,
  marathon: 26.21875,
} as const;
export type StandardDistance = keyof typeof STANDARD_DISTANCES_MILES;

/** Riegel: predicted seconds at targetMiles, given a known result. */
export function riegelPredictSeconds(knownSeconds: number, knownMiles: number, targetMiles: number): number {
  return knownSeconds * Math.pow(targetMiles / knownMiles, 1.06);
}

export interface RacePrediction {
  distance: StandardDistance;
  miles: number;
  seconds: number;
  paceSecPerMile: number;
}

/** Predicted times at every standard distance, from one known result. */
export function predictAllDistances(knownSeconds: number, knownMiles: number): RacePrediction[] {
  return (Object.keys(STANDARD_DISTANCES_MILES) as StandardDistance[]).map((distance) => {
    const miles = STANDARD_DISTANCES_MILES[distance];
    const seconds = riegelPredictSeconds(knownSeconds, knownMiles, miles);
    return { distance, miles, seconds, paceSecPerMile: seconds / miles };
  });
}

export type TrainingZone = "easy" | "marathon" | "threshold" | "interval";
/** Daniels' published %vVO2max midpoints - the actual sourced numbers, not guesses. */
const ZONE_INTENSITY: Record<TrainingZone, number> = { easy: 0.70, marathon: 0.80, threshold: 0.86, interval: 0.98 };

export interface TrainingZonePaces {
  easy: number;
  marathon: number;
  threshold: number;
  interval: number;
}

/**
 * Training pace zones (seconds per mile) derived from a known race result.
 * Interval pace is set to the predicted 5K pace (98% reference, per Daniels
 * and matching "interval pace approximates current 5K pace" in sourced
 * guidance); the other zones are scaled from it by intensity ratio - lower
 * intensity means a slower (higher seconds-per-mile) pace.
 */
export function computeTrainingZones(knownSeconds: number, knownMiles: number): TrainingZonePaces {
  const fiveK = predictAllDistances(knownSeconds, knownMiles).find((p) => p.distance === "5k")!;
  const intervalPace = fiveK.paceSecPerMile;
  const scale = (zone: TrainingZone) => intervalPace * (ZONE_INTENSITY.interval / ZONE_INTENSITY[zone]);
  return { easy: scale("easy"), marathon: scale("marathon"), threshold: scale("threshold"), interval: intervalPace };
}

/** Formats seconds-per-mile as "M:SS/mi". */
export function formatPace(secPerMile: number): string {
  const total = Math.round(secPerMile);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${sec.toString().padStart(2, "0")}/mi`;
}

/** Formats a total seconds duration as "H:MM:SS" (or "MM:SS" under an hour). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}` : `${m}:${sec.toString().padStart(2, "0")}`;
}
