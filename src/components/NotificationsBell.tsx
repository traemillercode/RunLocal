/**
 * Notifications bell — persistent in-app entry point to the notification
 * center, with the account's unread count.
 *
 * Renders only for signed-in users (guests and unauthenticated visitors see
 * nothing — no private data or controls). The unread badge appears only when
 * the server reports unread notifications; the accessible label carries the
 * count so screen readers never hear a bare "Notifications" with a hidden
 * number.
 */
import { Link } from "react-router-dom";
import { useAccount } from "../state/account";
import { useNotifications } from "../state/notifications";
import { Icon } from "./ui";

export function NotificationsBell({ className = "" }: { className?: string }) {
  const { me } = useAccount();
  const { unreadCount } = useNotifications();
  if (me?.status !== "signed_in") return null;
  const unread = unreadCount ?? 0;
  return (
    <Link
      to="/notifications"
      aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
      className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors ${className}`}
    >
      <Icon name="bell" className="h-5 w-5" />
      {unread > 0 ? (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 grid min-w-[18px] place-items-center rounded-full bg-[#FF5741] px-1 text-[11px] font-extrabold leading-[18px] text-[#14171C] ring-2 ring-[#14171C]"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
