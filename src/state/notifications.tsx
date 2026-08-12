/**
 * Notifications context — the signed-in user's private in-app notification
 * inbox, shared by the header bell and the /notifications center so read
 * state stays in sync across the app.
 *
 * Privacy boundary: data is only fetched while signed in (the server requires
 * a session for /api/notifications anyway); guests and signed-out users get a
 * null unread count and an empty inbox. Nothing notification-related is
 * written to localStorage.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "../lib/api";
import { useAccount } from "./account";

export interface NotificationsState {
  /** The account's own in-app notifications, newest first (server-ordered). */
  notifications: api.InAppNotification[];
  /** null until loaded (or when not signed in) — never shown as zero. */
  unreadCount: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsState>({
  notifications: [],
  unreadCount: null,
  loading: false,
  error: null,
  refresh: async () => {},
  markRead: async () => {},
  markAllRead: async () => {},
});

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { me } = useAccount();
  const signedIn = me?.status === "signed_in";
  const [notifications, setNotifications] = useState<api.InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const result = await api.getNotifications();
      if (result.ok) {
        setNotifications(result.data.notifications);
        setUnreadCount(result.data.unreadCount);
        setError(null);
      } else {
        setError(result.error.message ?? "Couldn't load notifications.");
      }
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  // Fetch once the session exists; drop everything when signed out.
  useEffect(() => {
    if (!signedIn) {
      setNotifications([]);
      setUnreadCount(null);
      setError(null);
      return;
    }
    void refresh();
  }, [signedIn, refresh]);

  // Staleness guard mirroring the account provider: refetch when the tab
  // regains focus so a notification produced in another tab appears in the
  // bell promptly. Throttled so background tabs don't hammer the API.
  useEffect(() => {
    if (!signedIn) return;
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
  }, [signedIn, refresh]);

  const markRead = useCallback(async (id: string) => {
    const result = await api.markNotificationRead(id);
    if (!result.ok) return;
    const at = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: at } : n)));
    setUnreadCount((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
  }, []);

  const markAllRead = useCallback(async () => {
    const result = await api.markAllNotificationsRead();
    if (!result.ok) return;
    const at = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: at })));
    setUnreadCount(0);
  }, []);

  const value = useMemo(
    () => ({ notifications, unreadCount, loading, error, refresh, markRead, markAllRead }),
    [notifications, unreadCount, loading, error, refresh, markRead, markAllRead],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsState {
  return useContext(NotificationsContext);
}
