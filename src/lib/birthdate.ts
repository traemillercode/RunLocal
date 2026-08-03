/**
 * Client-side birthdate validation for the signup step.
 *
 * The date field in VerifyPage is not inside a <form>, so HTML `required`
 * alone never blocks submission — the browser simply sends an empty value and
 * the server rejects it (400 minimum_age). This pure helper gives the UI the
 * same rule up front, with a clear inline error, and is unit-tested.
 *
 * The server stays authoritative: POST /api/accounts re-validates and enforces
 * the real minimum age (RUN_LOCAL_MIN_AGE, default 16). This client check uses
 * the same default so the two agree for a standard deployment; if an operator
 * lowers the server minimum, the server still accepts the result — the client
 * is deliberately never more lenient.
 */

/** Default minimum age, mirroring the server default (RUN_LOCAL_MIN_AGE=16). */
export const DEFAULT_MIN_AGE = 16;

export type BirthdateCheck =
  | { ok: true; age: number }
  | { ok: false; reason: "missing" | "invalid" | "too_young"; message: string };

/** Strict parse of "yyyy-mm-dd" as a real calendar date (rejects 02-30 etc.). */
function parseIsoDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  // Date would silently roll over impossible dates (e.g. 2026-02-30 → Mar 2);
  // compare the components to reject them.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

/** Calendar (y, m, d) comparison: true when `a` is on or before `b`. */
function onOrBefore(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): boolean {
  return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2])));
}

export function validateBirthdate(
  value: string,
  now: Date = new Date(),
  minAge: number = DEFAULT_MIN_AGE,
): BirthdateCheck {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, reason: "missing", message: "Enter your birthdate to continue." };
  }
  const date = parseIsoDate(trimmed);
  if (!date) {
    return { ok: false, reason: "invalid", message: "Enter a valid birthdate." };
  }
  const born: readonly [number, number, number] = [
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ];
  const today: readonly [number, number, number] = [now.getFullYear(), now.getMonth(), now.getDate()];

  if (!onOrBefore(born, today)) {
    return {
      ok: false,
      reason: "invalid",
      message: "That date is in the future — enter your actual birthdate.",
    };
  }
  const cutoff: readonly [number, number, number] = [
    now.getFullYear() - minAge,
    now.getMonth(),
    now.getDate(),
  ];
  if (!onOrBefore(born, cutoff)) {
    return { ok: false, reason: "too_young", message: `You must be at least ${minAge} to join.` };
  }

  let age = today[0] - born[0];
  const hadBirthdayThisYear = born[1] < today[1] || (born[1] === today[1] && born[2] <= today[2]);
  if (!hadBirthdayThisYear) age -= 1;
  return { ok: true, age };
}
