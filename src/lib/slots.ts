import type { TrainingDaySlot } from "../server/types";

/**
 * Session slot resolution.
 *
 * THE MODEL BUG this fixes: `"primary"` meant two different things — "the only
 * session that day" AND "the first of two". So the UI read "primary" as "no
 * time", which meant:
 *   - a single run could never be shown as an evening run, and
 *   - adding a 6am second session couldn't make the original the PM one.
 *
 * The fix is at the model, not the badge. Every session now has a real slot
 * DERIVED from its scheduledTime, following the withResolvedPacePolicy
 * precedent exactly: the stored value wins, derivation happens at read time
 * only when a real time is present, and no existing record is ever rewritten.
 * `"primary"` survives as the honest answer for a session with no time set —
 * which is a genuine state, not a missing one.
 */

/** Noon boundary. A 12:00 session is PM, matching how "12pm" reads to everyone. */
const NOON_HOUR = 12;

/**
 * The slot a session actually occupies, given its scheduled time.
 *
 * Returns "primary" when no time is set. That is deliberate and not a fallback
 * to a legacy value: without a time we genuinely do not know whether a session
 * is morning or evening, and inventing "am" would assert a commitment the
 * athlete never made (Calendar Spec §4.2).
 */
export function resolveSlot(scheduledTime: string | null | undefined, storedSlot: TrainingDaySlot): TrainingDaySlot {
  if (!scheduledTime) return storedSlot === "primary" ? "primary" : storedSlot;
  const hour = Number(scheduledTime.slice(0, 2));
  if (!Number.isFinite(hour)) return storedSlot;
  return hour < NOON_HOUR ? "am" : "pm";
}

/** "AM" / "PM", or null when there is no time and therefore no honest label. */
export function slotLabel(scheduledTime: string | null | undefined, storedSlot: TrainingDaySlot): "AM" | "PM" | null {
  const s = resolveSlot(scheduledTime, storedSlot);
  return s === "am" ? "AM" : s === "pm" ? "PM" : null;
}

/**
 * Chronological comparator for sessions within one day.
 *
 * Replaces `(a.slot === "pm" ? 1 : 0) - (b.slot === "pm" ? 1 : 0)`, which gave
 * two AM sessions undefined relative order — fine when a day held at most one
 * timed session, load-bearing now that every session can carry a real time
 * (Calendar Spec §4.3).
 *
 * Untimed sessions sort last: a session with a known time is more specific
 * than one without, and floating the unknown to the top would push the
 * athlete's actual 6am run below it.
 */
export function bySessionTime<T extends { scheduledTime?: string | null; slot: TrainingDaySlot }>(a: T, b: T): number {
  const at = a.scheduledTime ?? null;
  const bt = b.scheduledTime ?? null;
  if (at && bt) return at.localeCompare(bt);
  if (at) return -1;
  if (bt) return 1;
  // Neither timed — fall back to the stored slot so am still precedes pm.
  const rank = (s: TrainingDaySlot) => (s === "am" ? 0 : s === "pm" ? 2 : 1);
  return rank(a.slot) - rank(b.slot);
}

/* ── Day/week total display units (bug 3) ─────────────────────────────────── */

/**
 * The unit a TOTAL should be displayed in.
 *
 * THE BUG: the day total inherited the FIRST session's unit, so an AM track
 * session logged in meters made the day render as "11229.53" — a real number
 * that no runner thinks in. Meters and yards are INPUT units, because that is
 * how tracks are measured; they are never totals units.
 *
 * There is no stored per-athlete unit preference yet, so this derives one:
 * explicit miles wins, then explicit km, and a day of nothing but track units
 * falls back to miles (the launch city is Columbia, MO). A real preference
 * belongs in Settings alongside weekStartDay, and this function is the single
 * place that would need to read it.
 */
export type TotalUnit = "miles" | "km";

export function totalUnitFor(units: readonly string[]): TotalUnit {
  if (units.includes("miles")) return "miles";
  if (units.includes("km")) return "km";
  return "miles";
}

const TO_MILES: Record<string, number> = { miles: 1, km: 0.621371, meters: 0.000621371, yards: 0.000568182 };

/** Converts any input unit into a display total, rounded to one decimal. */
export function toTotal(value: number, fromUnit: string, target: TotalUnit): number {
  const miles = value * (TO_MILES[fromUnit] ?? 1);
  const out = target === "miles" ? miles : miles / 0.621371;
  return Math.round(out * 10) / 10;
}

/** Short suffix for a total. */
export function totalUnitLabel(u: TotalUnit): string {
  return u === "miles" ? "mi" : "km";
}
