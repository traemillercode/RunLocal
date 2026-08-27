import { useEffect, useState } from "react";
import type { City } from "../types";

/** Kimbio only works at full capability within this radius of a live city's center. */
export const GEOFENCE_RADIUS_MILES = 20;

/** Same haversine formula used server-side for GPX distance (src/server/gpx.ts) — kept in sync intentionally so "20 miles" means the same thing everywhere in the app. */
export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type GeofenceStatus =
  | { kind: "checking" }
  | { kind: "inside"; distanceMiles: number }
  | { kind: "outside"; distanceMiles: number }
  | { kind: "denied" }
  | { kind: "unavailable" }
  /** City has no configured center (e.g. a future non-live city) — treated as unrestricted. */
  | { kind: "unrestricted" };

/**
 * Checks the browser's geolocation against the given city's center. Denial
 * or an unsupported browser is treated as a hard fail (kind:
 * "denied"/"unavailable") rather than silently letting the person through —
 * "can only use the app in the city" means location confirmation is
 * required, not optional. Returns a retry() function that genuinely
 * re-triggers the check (not just a cosmetic re-render) - it's part of the
 * effect's own dependency array, so calling it actually calls
 * getCurrentPosition again, including re-prompting for permission if the
 * person changed their browser's location setting since the last denial.
 */
export function useGeofenceStatus(city: City, skip = false): { status: GeofenceStatus; retry: () => void } {
  const [status, setStatus] = useState<GeofenceStatus>(() =>
    skip || city.centerLat == null || city.centerLng == null ? { kind: "unrestricted" } : { kind: "checking" },
  );
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (skip || city.centerLat == null || city.centerLng == null) {
      setStatus({ kind: "unrestricted" });
      return;
    }
    if (!("geolocation" in navigator)) {
      setStatus({ kind: "unavailable" });
      return;
    }
    setStatus({ kind: "checking" });
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const distanceMiles = haversineMiles(pos.coords.latitude, pos.coords.longitude, city.centerLat!, city.centerLng!);
        setStatus(distanceMiles <= GEOFENCE_RADIUS_MILES ? { kind: "inside", distanceMiles } : { kind: "outside", distanceMiles });
      },
      (err) => {
        if (cancelled) return;
        setStatus(err.code === err.PERMISSION_DENIED ? { kind: "denied" } : { kind: "unavailable" });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
    return () => { cancelled = true; };
  }, [city.id, city.centerLat, city.centerLng, skip, retryToken]);

  return { status, retry: () => setRetryToken((t) => t + 1) };
}
