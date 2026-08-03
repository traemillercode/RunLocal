import { useCallback, useEffect, useMemo, useState } from "react";
// ---------------------------------------------------------------------------
// Client-side app state, persisted to localStorage.
// Deliberately NON-sensitive: city selection and demo RSVPs only. Identity and
// verification state live server-side (HttpOnly session cookie) and are
// exposed to the UI via /api/me through the AccountProvider — never here.
// ---------------------------------------------------------------------------
export interface AppState {
  cityId: string;
  /** Demo RSVPs keyed by event id (client-only until server sync lands). */
  rsvped: Record<string, boolean>;
}
const STORAGE_KEY = "runlocal:state:v2";
const DEFAULT_CITY = "columbia-mo";
function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      return {
        cityId: parsed.cityId || DEFAULT_CITY,
        rsvped: parsed.rsvped ?? {},
      };
    }
  } catch {
    // fall through to defaults
  }
  return { cityId: DEFAULT_CITY, rsvped: {} };
}
export function useAppState() {
  const [state, setState] = useState<AppState>(load);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage unavailable — state still works for the session
    }
  }, [state]);
  const setCityId = useCallback((cityId: string) => {
    setState((s) => ({ ...s, cityId }));
  }, []);
  /** Verified users toggle a (demo, client-only) RSVP. */
  const toggleRsvp = useCallback((eventId: string) => {
    setState((s) => ({ ...s, rsvped: { ...s.rsvped, [eventId]: !s.rsvped[eventId] } }));
  }, []);
  return useMemo(
    () => ({ state, setCityId, toggleRsvp }),
    [state, setCityId, toggleRsvp],
  );
}
export type AppStore = ReturnType<typeof useAppState>;
