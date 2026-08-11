/**
 * Account context — the single source of truth for who the user is.
 *
 * Fetches /api/me (server-owned session cookie) on mount and after any
 * verification step. The client NEVER holds verification records; it only
 * sees the public account shape (name/email/status/badge/photo).
 * Nothing sensitive is written to localStorage.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Me } from "../lib/accounts";
import { roleOf } from "../lib/accounts";
import * as api from "../lib/api";

interface AccountContextValue {
  /** null while the initial /api/me fetch is in flight. */
  me: Me | null;
  /** False when the API layer is unreachable (e.g. static-only hosting). */
  backendAvailable: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteMyAccount: () => Promise<api.ApiResult<{ status: string }>>;
  role: "guest" | "pending" | "rejected" | "verified";
}

const AccountContext = createContext<AccountContextValue>({
  me: null,
  backendAvailable: true,
  refresh: async () => {},
  signOut: async () => {},
  deleteMyAccount: async () => ({ ok: false, error: new api.ApiError(0, "unavailable") }),
  role: "guest",
});

export function AccountProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [backendAvailable, setBackendAvailable] = useState(true);

  const refresh = useCallback(async () => {
    const result = await api.getMe();
    if (result.ok) {
      setBackendAvailable(true);
      setMe(result.data);
    } else {
      setBackendAvailable(false);
      setMe({ status: "guest" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Staleness guard: the server is the only authority on verification and
  // admin state (sessions never cache it). If an owner approves / grants an
  // admin role while the signed-in user's tab is open, this refetches /api/me
  // when the tab regains focus so the user can post / administer immediately —
  // no relogin required. Throttled so background tabs don't hammer the API.
  useEffect(() => {
    let last = 0;
    let active = false;
    const maybeRefresh = () => {
      if (active) return;
      const nowMs = Date.now();
      if (nowMs - last < 10_000) return;
      last = nowMs;
      active = true;
      void refresh().finally(() => {
        active = false;
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.logout();
    setMe({ status: "guest" });
  }, []);

  const deleteMyAccount = useCallback(async () => {
    const result = await api.deleteAccount();
    if (result.ok) setMe({ status: "guest" });
    return result;
  }, []);

  const role = me ? roleOf(me) : "guest";

  const value = useMemo(
    () => ({ me, backendAvailable, refresh, signOut, deleteMyAccount, role }),
    [me, backendAvailable, refresh, signOut, deleteMyAccount, role],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  return useContext(AccountContext);
}
