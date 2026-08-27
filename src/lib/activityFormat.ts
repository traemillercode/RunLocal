import type { ActivityProvider } from "./api";

/**
 * Shared, deterministic formatters for activity cards. Deterministic on purpose:
 * SSR UI tests assert on these strings, so no locale-dependent output.
 */

/** 4023 m -> "4.0 km" (km below 10 keeps one decimal, above rounds). */
export function formatActivityDistance(distanceMeters: number): string {
  const km = distanceMeters / 1000;
  const value = km < 10 ? km.toFixed(1) : String(Math.round(km));
  return `${value} km`;
}

/** 3660 s -> "1h 1m"; 900 s -> "15 min"; 0/negative -> "—". */
export function formatActivityDuration(durationSeconds: number): string {
  if (!durationSeconds || durationSeconds <= 0) return "—";
  const h = Math.floor(durationSeconds / 3600);
  const m = Math.floor((durationSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

/** ISO timestamp -> "Mar 3, 2026" (UTC-free manual format, deterministic). */
export function formatActivityDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function providerLabel(provider: ActivityProvider): string {
  const labels: Record<ActivityProvider, string> = {
    strava: "Strava",
    garmin: "Garmin",
    coros: "Coros",
    suunto: "Suunto",
  };
  return labels[provider] ?? provider;
}
