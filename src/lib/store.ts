import { useCallback, useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Client-side app state, persisted to localStorage. No backend in this MVP.
// "verified" is a *demo preview* state only — real verification (phone/SMS)
// launches in a later phase and is never claimed here.
// ---------------------------------------------------------------------------

export type ProfileState = { status: "guest" } | { status: "verified"; name: string };

export interface AppState {
  cityId: string;
  profile: ProfileState;
  /** Events the (demo) verified user has RSVP'd to. */
  rsvped: Record<string, boolean>;
  /** Email submitted for launch / verification notifications. */
  notifiedEmail?: string;
}

const STORAGE_KEY = "runlocal:state:v1";
const DEFAULT_CITY = "columbia-mo";

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      return {
        cityId: parsed.cityId || DEFAULT_CITY,
        profile: parsed.profile ?? { status: "guest" },
        rsvped: parsed.rsvped ?? {},
        notifiedEmail: parsed.notifiedEmail,
      };
    }
  } catch {
    // fall through to defaults
  }
  return { cityId: DEFAULT_CITY, profile: { status: "guest" }, rsvped: {} };
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

  /** Guest taps RSVP → gated; verified (demo) toggles the RSVP. */
  const toggleRsvp = useCallback((eventId: string) => {
    setState((s) => ({ ...s, rsvped: { ...s.rsvped, [eventId]: !s.rsvped[eventId] } }));
  }, []);

  const enterDemoVerified = useCallback(() => {
    setState((s) => ({ ...s, profile: { status: "verified", name: "Demo Runner" } }));
  }, []);

  const exitDemoVerified = useCallback(() => {
    setState((s) => ({ ...s, profile: { status: "guest" } }));
  }, []);

  const setNotifiedEmail = useCallback((email: string) => {
    setState((s) => ({ ...s, notifiedEmail: email }));
  }, []);

  const isVerified = state.profile.status === "verified";
  const isDemo = isVerified; // the only verified state available in the MVP is the demo preview

  return useMemo(
    () => ({
      state,
      setCityId,
      toggleRsvp,
      enterDemoVerified,
      exitDemoVerified,
      setNotifiedEmail,
      isVerified,
      isDemo,
    }),
    [state, setCityId, toggleRsvp, enterDemoVerified, exitDemoVerified, setNotifiedEmail, isVerified, isDemo],
  );
}

export type AppStore = ReturnType<typeof useAppState>;
