/**
 * Selected-city state — the single source of truth for which city the app
 * renders (header, home/community/events/races/forum, profile, settings).
 *
 * Priority (see `effectiveCityId` in src/lib/store.ts):
 *  - Signed-in account with a home city → the ACCOUNT's home city always wins
 *    (server-validated, persisted via /api/profile/city). Selecting a city in
 *    the switcher PERSISTS it to the account — the client never decides what
 *    is valid, the server does.
 *  - Guests / legacy signed-in accounts without a home city → the guest city
 *    switcher (localStorage) is preserved; signed-in users who pick a city are
 *    prompted through the same flow, which persists it to their account.
 *
 * The hook never trusts a client-only city id for a signed-in account: the
 * server validates against known city entities on every write, and the value
 * shown here is re-read from the /api/me payload after a change.
 */
import { useCallback, useMemo } from "react";
import { CITIES, isSupportedCityId } from "../data/cities";
import type { City } from "../types";
import { effectiveCityId, useAppState } from "../lib/store";
import * as api from "../lib/api";
import { useAccount } from "./account";

export type SelectCityResult = { ok: true } | { ok: false; error: api.ApiError };

export function useSelectedCity(): {
  /** The city whose content the app currently renders. */
  city: City;
  cityId: string;
  /** True while a signed-in account exists. */
  signedIn: boolean;
  /** False for legacy accounts that have not chosen a home city yet (clearly prompted in the UI). */
  hasHomeCity: boolean;
  /** Persist a city selection: to the account when signed in, to the guest switcher otherwise. */
  selectCity: (cityId: string) => Promise<SelectCityResult>;
} {
  const store = useAppState();
  const { me, refresh } = useAccount();
  const signedIn = me?.status === "signed_in";
  const accountCityId = signedIn ? me!.account.cityId : null;
  const cityId = effectiveCityId(accountCityId, store.state.cityId);
  const city = CITIES.find((c) => c.id === cityId) ?? CITIES[0];

  const selectCity = useCallback(
    async (id: string): Promise<SelectCityResult> => {
      // Signed-in: persist to the account (server-validated). Never accept a
      // client-only city id for a signed-in account — the server is
      // authoritative and re-reads /api/me after success.
      if (signedIn) {
        if (!isSupportedCityId(id)) return { ok: false, error: new api.ApiError(400, "invalid_city", "That city isn't supported yet — pick one from the list.") };
        const r = await api.setHomeCity(id);
        if (!r.ok) return { ok: false, error: r.error };
        await refresh();
        return { ok: true };
      }
      // Guest: the localStorage city switcher.
      store.setCityId(id);
      return { ok: true };
    },
    [signedIn, refresh, store],
  );

  return useMemo(
    () => ({ city, cityId, signedIn, hasHomeCity: accountCityId !== null, selectCity }),
    [city, cityId, signedIn, accountCityId, selectCity],
  );
}
