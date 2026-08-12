/**
 * Notification model — client-side truth about notification categories and
 * inbox helpers.
 *
 * Honesty contract: every category is labeled with whether it has a REAL
 * producer today. Only `community_updates` is produced server-side right now
 * (run-day discussion activity and group membership requests); the other two
 * categories are persisted preferences with NO delivery, so UI labels them
 * "Coming soon" rather than implying notifications exist.
 */
import type { InAppNotification, NotificationPreferences } from "./api";

export interface NotificationCategoryMeta {
  key: keyof NotificationPreferences;
  label: string;
  description: string;
  /** True only when the server actually produces in-app notifications for this category. */
  available: boolean;
}

export const NOTIFICATION_CATEGORY_META: NotificationCategoryMeta[] = [
  {
    key: "community_updates",
    label: "Community updates",
    description: "New discussion activity on runs you joined, plus group membership requests for leaders.",
    available: true,
  },
  {
    key: "run_reminders",
    label: "Run reminders",
    description: "Reminders before your RSVP'd group runs.",
    available: false,
  },
  {
    key: "account_alerts",
    label: "Account alerts",
    description: "Security and account-status notices.",
    available: false,
  },
];

export function categoryMeta(key: keyof NotificationPreferences): NotificationCategoryMeta {
  return NOTIFICATION_CATEGORY_META.find((m) => m.key === key) ?? NOTIFICATION_CATEGORY_META[0];
}

export function unreadCountOf(items: InAppNotification[]): number {
  return items.reduce((count, item) => count + (item.readAt ? 0 : 1), 0);
}

/** Compact local timestamp for a notification row (e.g. "Aug 12, 6:30 PM"). */
export function notificationTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
