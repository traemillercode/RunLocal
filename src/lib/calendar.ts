/**
 * Pure, timezone-safe (UTC) month-grid helpers for the My Runs calendar view.
 * The app treats stored run dates as UTC wall-clock labels (see
 * `formatRunDate` in lib/myRuns.ts), so all grid math is done in UTC to match
 * the rest of the codebase.
 */

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export interface CalendarDayCell {
  /** `YYYY-MM-DD` for in-month days; "" for leading/trailing filler cells. */
  date: string;
  dayOfMonth: number;
  inMonth: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The day cells of a month grid, Monday-first, including leading/trailing
 * filler cells from the adjacent months (`inMonth: false`) so the grid always
 * forms complete weeks.
 */
export function calendarGridDays(year: number, monthIndex: number): CalendarDayCell[] {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  // Monday-first offset: Sunday(0) → 6, Monday(1) → 0 … Saturday(6) → 5.
  const lead = first.getUTCDay() === 0 ? 6 : first.getUTCDay() - 1;
  const cells: CalendarDayCell[] = [];
  const prevMonthDays = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  for (let i = lead; i > 0; i--) cells.push({ date: "", dayOfMonth: prevMonthDays - i + 1, inMonth: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: `${year}-${pad(monthIndex + 1)}-${pad(d)}`, dayOfMonth: d, inMonth: true });
  const trail = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= trail; i++) cells.push({ date: "", dayOfMonth: i, inMonth: false });
  return cells;
}

/** Full accessible day label, e.g. "Monday, August 10, 2026, 2 runs". */
export function dayAriaLabel(date: string, runCount: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  const base = d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  return runCount === 0 ? `${base}, no runs` : `${base}, ${runCount} ${runCount === 1 ? "run" : "runs"}`;
}

/**
 * The day to show in the day panel when nothing is explicitly selected:
 * today when it is in the displayed month and has runs, otherwise the first
 * in-month day that has runs, otherwise null. Deterministic (SSR-safe).
 */
export function defaultCalendarDay(dates: ReadonlyArray<{ date: string }>, now: Date, month: string): string | null {
  const inMonth = [...new Set(dates.map((r) => r.date))].filter((d) => d.startsWith(month) && d.length === 10).sort();
  const today = now.toISOString().slice(0, 10);
  if (today.startsWith(month) && inMonth.includes(today)) return today;
  return inMonth[0] ?? null;
}
