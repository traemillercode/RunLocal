import { useState } from "react";
import type { City } from "../types";
import { GEOFENCE_RADIUS_MILES, useGeofenceStatus } from "../lib/geofence";
import { Icon, PillButton } from "./ui";

/**
 * Blocks the interactive app to within GEOFENCE_RADIUS_MILES of the city's
 * center. Wraps the authenticated app shell in App.tsx — the marketing page,
 * login, and legal pages stay reachable from anywhere so someone outside
 * Columbia can still learn about Kimbio and sign up ahead of a visit; this
 * gate covers everything else (events, groups, messaging, etc.), matching
 * "you can only use the app in the city."
 */
export function GeofenceGate({ city, bypass = false, children }: { city: City; bypass?: boolean; children: React.ReactNode }) {
  const status = useGeofenceStatus(city, bypass);
  const [retryKey, setRetryKey] = useState(0);

  if (bypass || status.kind === "unrestricted" || status.kind === "inside") {
    return <>{children}</>;
  }

  if (status.kind === "checking") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#14171C]" />
        <p className="text-sm font-semibold text-slate-600">Confirming you're in {city.name}…</p>
      </div>
    );
  }

  const copy = {
    outside: {
      title: `Kimbio is Columbia-only, for now`,
      body:
        status.kind === "outside"
          ? `Your location is about ${Math.round(status.distanceMiles)} miles from ${city.name}. The app is available within ${GEOFENCE_RADIUS_MILES} miles of the city while we're building the local community here.`
          : "",
    },
    denied: {
      title: "Location access needed",
      body: `Kimbio confirms you're within ${GEOFENCE_RADIUS_MILES} miles of ${city.name} before opening the app. Enable location access for this site in your browser settings, then try again.`,
    },
    unavailable: {
      title: "Couldn't confirm your location",
      body: "This device or browser didn't return a location. Check your device's location settings and try again.",
    },
  }[status.kind === "outside" ? "outside" : status.kind === "denied" ? "denied" : "unavailable"];

  return (
    <div key={retryKey} className="mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400">
        <Icon name="mapPin" className="h-7 w-7" />
      </span>
      <h1 className="text-xl font-extrabold tracking-tight text-slate-900">{copy.title}</h1>
      <p className="text-sm leading-relaxed text-slate-600">{copy.body}</p>
      <PillButton variant="primary" onClick={() => setRetryKey((k) => k + 1)}>
        Try again
      </PillButton>
    </div>
  );
}
