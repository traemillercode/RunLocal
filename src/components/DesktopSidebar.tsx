import { Link, useLocation } from "react-router-dom";
import type { City } from "../types";
import { Icon } from "./ui";
import { useAccount } from "../state/account";
import { useNotifications } from "../state/notifications";
import { activeForPath, entriesForSurface, NO_NAV_PATHS } from "../lib/nav";
/**
 * Desktop sidebar — entries derived from the single nav model (src/lib/nav.ts)
 * with the SAME activeForPath matcher as the bottom tab bar. Settings lives in
 * the footer (account block) as a gear entry, separate from Profile in the
 * main nav. The whole sidebar is hidden on the chrome-free wizard routes
 * (NO_NAV_PATHS), matching the bottom nav.
 */
export function DesktopSidebar({ city, onOpenCitySheet }: { city: City; onOpenCitySheet: () => void }) {
  const location = useLocation();
  const { me, signOut } = useAccount();
  const { unreadCount } = useNotifications();
  const signedIn = me?.status === "signed_in";
  const unread = unreadCount ?? 0;
const showingMarketing = location.pathname === "/" && me?.status !== "signed_in";
if (NO_NAV_PATHS.has(location.pathname) || showingMarketing) return null;
  const navEntries = entriesForSurface("sidebar").filter((e) => e.id !== "settings");
  const settingsEntry = entriesForSurface("sidebar").find((e) => e.id === "settings");
  return (
    <aside className="desktop-sidebar" aria-label="Primary navigation">
      <Link to="/" className="desktop-brand" aria-label="Kimbio home">
        <img src="/icons/icon-192.png" alt="" />
        <span>
          Kim<b>bio</b>
        </span>
      </Link>
      <button
        type="button"
        className="desktop-city"
        onClick={onOpenCitySheet}
        aria-label={`Change city — current: ${city.name}, ${city.state}`}
      >
        <Icon name="pin" className="h-4 w-4" />
        <span>
          {city.name}, {city.state}
        </span>
        <Icon name="chevronDown" className="ml-auto h-3.5 w-3.5" />
      </button>
      <nav className="desktop-nav" aria-label="Main" data-tour-target="desktop-nav">
        {navEntries.map((entry) => (
          <Link key={entry.id} to={entry.route} className={activeForPath(entry, location.pathname) ? "active" : ""}>
            <Icon name={entry.icon} className="h-5 w-5" />
            {entry.label}
          </Link>
        ))}
      </nav>
      <div className="desktop-account">
        {signedIn ? (
          <>
            <Link
              to="/notifications"
              className={location.pathname.startsWith("/notifications") ? "active" : ""}
              aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
            >
              <Icon name="bell" className="h-5 w-5" />
              <span className="relative">
                Notifications
                {unread > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-4 -top-2.5 grid min-w-[18px] place-items-center rounded-full bg-[#FF5741] px-1 text-[11px] font-extrabold leading-[18px] text-[#14171C]"
                  >
                    {unread > 9 ? "9+" : unread}
                  </span>
                ) : null}
              </span>
            </Link>
            {settingsEntry ? (
              <Link
                to={settingsEntry.route}
                className={activeForPath(settingsEntry, location.pathname) ? "active" : ""}
              >
                <Icon name={settingsEntry.icon} className="h-5 w-5" />
                {settingsEntry.label}
              </Link>
            ) : null}
            <button type="button" className="desktop-account-action" onClick={() => void signOut()}>
              <Icon name="logout" className="h-5 w-5" />
              Sign out
            </button>
          </>
        ) : (
          <Link to="/login">
            <Icon name="settings" className="h-5 w-5" />
            Log in
          </Link>
        )}
      </div>
    </aside>
  );
}
