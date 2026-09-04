import { useEffect, useState } from "react";

/**
 * Date of birth, typed rather than picked.
 *
 * `type="date"` opens a native picker that starts at the current year, so
 * entering a birth year means scrolling back three decades. This is the FIRST
 * field in the signup flow — the first impression of the product — and it was
 * the first thing a real tester complained about.
 *
 * Three numeric inputs rather than one free-text box: a single field needs a
 * format hint, accepts ambiguous input (03/04/1990 is two different dates
 * depending on where you live), and has to be parsed. Three boxes are
 * unambiguous, and `inputMode="numeric"` brings up the number pad instead of a
 * keyboard.
 *
 * The value is still emitted as YYYY-MM-DD, so nothing downstream changes —
 * the server contract, validateBirthdate, and the stored format are untouched.
 */
export function BirthdateFields({
  value,
  onChange,
  invalid,
}: {
  /** YYYY-MM-DD, or "" when incomplete. */
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
}) {
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");

  /*
   * Hydrate from the outside only when the parent has a value we did not
   * produce — otherwise typing "1" into the year would immediately be
   * overwritten by the emitted "" on the next render.
   */
  useEffect(() => {
    if (!value) return;
    const [y, m, d] = value.split("-");
    if (y && m && d) { setYear(y); setMonth(m); setDay(d); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = (m: string, d: string, y: string) => {
    /*
     * Only emit a complete, plausible date. A partial value like "19--" would
     * fail validation and show an error while someone is still typing, which
     * is the kind of thing that makes a form feel hostile.
     */
    if (y.length === 4 && m.length >= 1 && d.length >= 1) {
      onChange(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
    } else {
      onChange("");
    }
  };

  const numeric = (raw: string, max: number) => raw.replace(/\D/g, "").slice(0, max);
  const cls = `h-11 rounded-[10px] border px-3 text-[15px] tabular-nums outline-none ${
    invalid ? "border-rose-400" : "border-slate-300 focus:border-[#14171C]"
  }`;

  return (
    <div className="flex gap-2">
      <label className="flex-1">
        <span className="sr-only">Month</span>
        <input
          inputMode="numeric"
          autoComplete="bday-month"
          placeholder="MM"
          value={month}
          onChange={(e) => { const v = numeric(e.target.value, 2); setMonth(v); emit(v, day, year); }}
          className={`w-full ${cls}`}
          aria-invalid={invalid || undefined}
        />
      </label>
      <label className="flex-1">
        <span className="sr-only">Day</span>
        <input
          inputMode="numeric"
          autoComplete="bday-day"
          placeholder="DD"
          value={day}
          onChange={(e) => { const v = numeric(e.target.value, 2); setDay(v); emit(month, v, year); }}
          className={`w-full ${cls}`}
          aria-invalid={invalid || undefined}
        />
      </label>
      <label className="flex-[1.4]">
        <span className="sr-only">Year</span>
        <input
          inputMode="numeric"
          autoComplete="bday-year"
          placeholder="YYYY"
          value={year}
          onChange={(e) => { const v = numeric(e.target.value, 4); setYear(v); emit(month, day, v); }}
          className={`w-full ${cls}`}
          aria-invalid={invalid || undefined}
        />
      </label>
    </div>
  );
}
