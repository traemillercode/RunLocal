import { Fragment } from "react";
/**
 * Notifications center — the signed-in user's private in-app notification
 * inbox at /notifications.
 *
 * Privacy boundary: the center renders nothing for guests / unauthenticated
 * visitors (the server also refuses /api/notifications without a session).
 * The list shows only REAL server data — there are no fabricated events, and
 * the empty state explains what actually produces notifications today.
 *
 * `NotificationsCenter` is the pure presentational body (props only, no hooks)
 * so UI tests can render the real markup with react-dom/server.
 */
import { Link, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import * as api from "../lib/api";
import { notificationTime, notificationLinkPath } from "../lib/notifications";
import { useAccount } from "../state/account";
import { useNotifications } from "../state/notifications";
import { Icon } from "../components/ui";

export function NotificationsPage() {
  const { me } = useAccount();
  const { notifications, unreadCount, loading, error, refresh, markRead, markAllRead, dismiss, clearRead } = useNotifications();
  if (me?.status !== "signed_in") {
    return (
      <Page>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Notifications</h1>
        <p className="mt-2 text-sm text-slate-600">Sign in to see your private notifications.</p>
        <Link
          to="/login"
          className="mt-5 inline-flex min-h-11 items-center rounded-[10px] bg-[#14171C] px-4 py-2 font-semibold text-white"
        >
          Sign in
        </Link>
      </Page>
    );
  }
  return (
    <NotificationsCenter
      notifications={notifications}
      unreadCount={unreadCount ?? 0}
      loading={loading}
      error={error}
      onRefresh={() => void refresh()}
      onMarkRead={(id) => void markRead(id)}
      onMarkAllRead={() => void markAllRead()}
      onDismiss={(id) => void dismiss(id)}
      onClearRead={() => void clearRead()}
    />
  );
}

/** Presentational center body — driven by props so tests need no providers. */
export function NotificationsCenter({
  notifications,
  unreadCount,
  loading,
  error,
  onRefresh,
  onMarkRead,
  onDismiss,
  onClearRead,
  onMarkAllRead,
}: {
  notifications: api.InAppNotification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onClearRead: () => void;
}) {
  const navigate = useNavigate();
  return (
    <Page>
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">Only you can see these.</p>
        </div>
        {/*
          CLEAR READ, never clear all. Unread is the queue; clearing it would
          discard the one thing the person has not seen, which is the only state
          that cannot be recovered by looking somewhere else.
          Shown only when there is something read to clear.
        */}
        {notifications.some((n) => n.readAt) ? (
          <button type="button" onClick={onClearRead} className="text-[13px] font-bold text-slate-500">
            Clear read
          </button>
        ) : null}
        <button
          type="button"
          disabled={unreadCount === 0}
          onClick={onMarkAllRead}
          className="min-h-11 rounded-[10px] bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400"
        >
          Mark all read
        </button>
      </div>
      {error ? (
        <div role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-800 ring-1 ring-rose-200">
          {error}
          <button type="button" onClick={onRefresh} className="ml-2 font-bold underline">
            Try again
          </button>
        </div>
      ) : null}
      {loading && notifications.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-500">Loading notifications…</p>
      ) : null}
      {!loading && !error && notifications.length === 0 ? <EmptyState /> : null}
      {notifications.length > 0 ? (
        <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
          {notifications.map((n, idx) => {
            /*
             * READ COLLAPSES UNDER "EARLIER". Unread is the queue and belongs at
             * the top; read is history and should stop competing with it.
             * The boundary is computed from the data rather than a count, so it
             * stays correct as items are read or dismissed.
             */
            const isFirstRead = Boolean(n.readAt) && (idx === 0 || !notifications[idx - 1].readAt);
            return (
            <Fragment key={n.id}>
            {isFirstRead ? (
              <li className="flex items-center gap-3 bg-slate-50 px-5 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                <span>Earlier</span>
                <span className="h-px flex-1 bg-slate-200" />
              </li>
            ) : null}
            <li className={n.readAt ? "" : "bg-orange-50/70"}>
              <button
                type="button"
                onClick={() => {
                  if (!n.readAt) onMarkRead(n.id);
                  const path = notificationLinkPath(n.link);
                  if (path) navigate(path);
                }}
                className="flex w-full items-start gap-3 px-5 py-3.5 text-left active:bg-slate-50"
                aria-label={n.readAt ? `${n.title} (read)` : `${n.title} (unread)`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-slate-200" : "bg-[#FF5741]"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.readAt ? "font-medium text-slate-600" : "font-bold text-slate-900"}`}>
                    {n.title}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-slate-600">{n.body}</span>
                  <span className="mt-1 block text-[11px] text-slate-400">{notificationTime(n.createdAt)}</span>
                </span>
                {notificationLinkPath(n.link) ? <Icon name="chevronRight" className="mt-1.5 h-4 w-4 shrink-0 text-slate-300" /> : null}
              </button>
              {/*
                DISMISS, beside the row rather than behind a swipe. A swipe is
                undiscoverable on desktop and unforgiving on a phone, and this
                is destructive.
              */}
              <button
                type="button"
                onClick={() => onDismiss(n.id)}
                aria-label={`Dismiss: ${n.title}`}
                className="grid h-11 w-11 shrink-0 place-items-center text-slate-300 hover:text-slate-600"
              >
                <span aria-hidden="true" className="text-[16px] leading-none">×</span>
              </button>
            </li>
            </Fragment>
            );
          })}
        </ul>
      ) : null}
    </Page>
  );
}

function EmptyState() {
  return (
    <div className="mt-4 rounded-2xl bg-white px-6 py-10 text-center shadow-sm ring-1 ring-slate-200/70">
      <Icon name="bell" className="mx-auto h-8 w-8 text-slate-300" />
      <h2 className="mt-3 text-sm font-bold text-slate-900">No notifications yet</h2>
      <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-slate-500">
        With Community updates turned on, new discussion activity on runs you joined — and membership requests for
        groups you lead — will appear here.
      </p>
    </div>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[42rem] px-4 pb-32 pt-8 md:px-6">
      <div className="mb-5 flex items-center gap-2">
        <Icon name="bell" className="h-5 w-5 text-[#FF5741]" />
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Private</span>
      </div>
      {children}
    </div>
  );
}
