import type { MyRunView } from "./api";

export function runStartMs(run: Pick<MyRunView, "date" | "time">): number {
  const match = run.time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return Date.parse(`${run.date}T23:59:59`);
  let hour = Number(match[1]);
  if (match[3].toUpperCase() === "PM" && hour < 12) hour += 12;
  if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;
  return Date.parse(`${run.date}T${String(hour).padStart(2, "0")}:${match[2]}:00`);
}

export function orderMyRuns(runs: MyRunView[], now = Date.now()): { upcoming: MyRunView[]; past: MyRunView[] } {
  const sorted = [...runs].sort((a, b) => runStartMs(a) - runStartMs(b) || a.eventId.localeCompare(b.eventId) || a.id.localeCompare(b.id));
  return { upcoming: sorted.filter((run) => runStartMs(run) >= now), past: sorted.filter((run) => runStartMs(run) < now).reverse() };
}

export function formatRunDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
