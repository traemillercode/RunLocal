/**
 * Moderated-content context — the public-safe moderation facts the city pages
 * render against: hidden content ids, featured/pinned highlights, and RRCA
 * badge state, all computed SERVER-side (/api/moderated).
 *
 * The payload contains no flag reasons, reporters, suspension details, or any
 * sensitive record. If the backend is unreachable the app degrades to the
 * unmoderated seed (everything visible) — same posture as the rest of the app.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import * as api from "../lib/api";

interface ModeratedContextValue {
  /** Registry ids ("event:mon-social") hidden by an owner moderation action. */
  hidden: Set<string>;
  /** Highlight toggles keyed by registry id (events/races only). */
  highlights: Map<string, { featured: boolean; pinned: boolean }>;
  /** RRCA badge state keyed by group id. */
  groupBadges: Map<string, boolean>;
  loaded: boolean;
}

const EMPTY: ModeratedContextValue = { hidden: new Set(), highlights: new Map(), groupBadges: new Map(), loaded: false };

const ModeratedContext = createContext<ModeratedContextValue>(EMPTY);

export function ModeratedProvider({ cityId, children }: { cityId: string; children: ReactNode }) {
  const [value, setValue] = useState<ModeratedContextValue>(EMPTY);
  const inflight = useRef(0);

  const load = useCallback(async (city: string) => {
    const seq = ++inflight.current;
    const r = await api.getModerated(city);
    if (seq !== inflight.current) return; // a newer city request superseded this one
    if (r.ok) {
      setValue({
        hidden: new Set(r.data.hidden),
        highlights: new Map(r.data.highlights.map((h) => [h.id, { featured: h.featured, pinned: h.pinned }])),
        groupBadges: new Map(r.data.groups.map((g) => [g.id, g.rrcaBadge])),
        loaded: true,
      });
    } else {
      // Backend unreachable — degrade to the unmoderated seed.
      setValue(EMPTY);
    }
  }, []);

  useEffect(() => {
    setValue(EMPTY);
    void load(cityId);
  }, [cityId, load]);

  return <ModeratedContext.Provider value={value}>{children}</ModeratedContext.Provider>;
}

export function useModerated(): ModeratedContextValue {
  return useContext(ModeratedContext);
}
