/**
 * Notification model — client-side truth about notification categories and
 * inbox helpers.
 *
 * Honesty contract: every category is labeled with whether it has a REAL
 * producer today. All four categories are now genuinely produced server-side.
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
    key: "messages",
    label: "Messages",
    description: "A new message in any of your conversations or group chats.",
    available: true,
  },
  {
    key: "community_updates",
    label: "Community updates",
    description: "New discussion activity on runs you joined, plus group membership requests for leaders.",
    available: true,
  },
  {
    key: "run_reminders",
    label: "Run reminders",
    description: "A reminder shortly before an RSVP'd group run starts.",
    available: true,
  },
  {
    key: "account_alerts",
    label: "Account alerts",
    description: "Verification decisions, credential/appeal decisions, and connected-service notices.",
    available: true,
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
