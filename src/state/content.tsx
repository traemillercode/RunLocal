/**
 * Public approved community content context — the /api/content payload for a
 * city (approved races / groups / independent events). Only approved records
 * are ever returned by the server; this context simply exposes them to the
 * city pages for rendering alongside the seed data.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import * as api from "../lib/api";

interface PublicContentValue {
  races: api.PublicUserRace[];
  groups: api.PublicUserGroup[];
  events: api.PublicUserEvent[];
  loaded: boolean;
}
const EMPTY: PublicContentValue = { races: [], groups: [], events: [], loaded: false };
const PublicContentContext = createContext<PublicContentValue>(EMPTY);

export function PublicContentProvider({ cityId, children }: { cityId: string; children: ReactNode }) {
  const [value, setValue] = useState<PublicContentValue>(EMPTY);
  const inflight = useRef(0);
  const load = useCallback(async (city: string) => {
    const seq = ++inflight.current;
    const r = await api.getPublicContent(city);
    if (seq !== inflight.current) return;
    if (r.ok) setValue({ races: r.data.races, groups: r.data.groups, events: r.data.events, loaded: true });
    else setValue(EMPTY);
  }, []);
  useEffect(() => {
    setValue(EMPTY);
    void load(cityId);
  }, [cityId, load]);
  return <PublicContentContext.Provider value={value}>{children}</PublicContentContext.Provider>;
}

export function usePublicContent(): PublicContentValue {
  return useContext(PublicContentContext);
}
