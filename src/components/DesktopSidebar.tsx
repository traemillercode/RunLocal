import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { City } from "../types";
import { Icon } from "./ui";
import { useAccount } from "../state/account";
import { useNotifications } from "../state/notifications";
import { activeForPath, entriesForRole, accordionModel, sectionForPath, NO_NAV_PATHS } from "../lib/nav";
/**
 * Desktop sidebar — entries derived from the single nav model (src/lib/nav.ts)
 * with the SAME activeForPath matcher as the bottom tab bar. Settings lives in
 * the footer (account block) as a gear entry, separate from Profile in the
 * main nav. The whole sidebar is hidden on the chrome-free wizard routes
 * (NO_NAV_PATHS), matching the bottom nav.
 */
export function DesktopSidebar({ city, onOpenCitySheet }: { city: City; onOpenCitySheet: () => void }) {
  const location = useLocation();
  const { me, role, signOut } = useAccount();
  const { unreadCount } = useNotifications();
  const signedIn = me?.status === "signed_in";
  const unread = unreadCount ?? 0;
const showingMarketing = location.pathname === "/" && me?.status !== "signed_in";
if (NO_NAV_PATHS.has(location.pathname) || showingMarketing) return null;
  // isAdmin is required for capability-gated entries: `roles` is only a floor
  // for /admin, since every verified runner is not an admin.
  const isAdmin = me?.status === "signed_in" && (me.account.isOwner === true || Boolean(me.account.adminCityId));
  const sidebarEntries = entriesForRole("sidebar", role, { isAdmin });
  const settingsEntry = sidebarEntries.find((e) => e.id === "settings");
  /*
   * Grouped by the registry's `area`, not hand-written. Thirteen ungrouped
   * items had no hierarchy, which is why the column read as a lot — Strava runs
   * five and Garmin six, and both group.
   *
   * Settings still renders separately at the foot, so it is excluded here.
   */
  const model = accordionModel(role, { isAdmin });
  /*
   * ONE GROUP OPEN AT A TIME. That is what makes overflow structurally
   * impossible rather than tolerated — the sidebar is position:fixed and does
   * not scroll with the page, so anything pushed below the fold is unreachable.
   * A max-height with internal scrolling would be the same defect under another
   * name.
   */
  const currentSection = sectionForPath(model, location.pathname);
  const [openSection, setOpenSection] = useState<string | null>(currentSection);
  // The group containing the current route opens itself, so navigating into a
  // submenu child does not leave the sidebar showing a collapsed parent.
  useEffect(() => { if (currentSection) setOpenSection(currentSection); }, [currentSection]);
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
        {model.top.map((entry) => (
          <Link key={entry.id} to={entry.route} className={activeForPath(entry, location.pathname) ? "active" : ""}>
            <Icon name={entry.icon} className="h-5 w-5" />
            {entry.label}
          </Link>
        ))}

        {model.sections.map((section) => {
          const isOpen = openSection === section.id;
          return (
            <div key={section.id} className="desktop-nav-section">
              <div className="desktop-nav-parent">
                {/*
                  THE PARENT ROW IS BOTH A DESTINATION AND AN EXPANDER. Clicking
                  the label goes to the section's own page AND opens it; the
                  chevron only opens. A parent that merely expands wastes a row
                  on something with a real page behind it.
                */}
                <Link
                  to={section.route}
                  onClick={() => setOpenSection(section.id)}
                  className={activeForPath({ ...section, surfaces: ["sidebar"], match: "exact" }, location.pathname) ? "active" : ""}
                >
                  <Icon name={section.icon} className="h-5 w-5" />
                  {section.label}
                </Link>
                <button
                  type="button"
                  onClick={() => setOpenSection(isOpen ? null : section.id)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Collapse" : "Expand"} ${section.label}`}
                  className="desktop-nav-chevron"
                >
                  <Icon name="chevronDown" className={`h-3.5 w-3.5 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                </button>
              </div>
              {/* In place, not a flyout: flyouts are fiddly at this size and
                  never open on touch. */}
              {isOpen ? (
                <div className="desktop-nav-children">
                  {section.children.map((c) => (
                    <Link key={c.id} to={c.route} className={activeForPath(c, location.pathname) ? "active" : ""}>
                      <Icon name={c.icon} className="h-4 w-4" />
                      {c.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}

        {model.admin ? (
          <div className="desktop-nav-group">
            <Link to={model.admin.route} className={activeForPath(model.admin, location.pathname) ? "active" : ""}>
              <Icon name={model.admin.icon} className="h-5 w-5" />
              {model.admin.label}
            </Link>
          </div>
        ) : null}
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
                title={settingsEntry.label}
                aria-label={settingsEntry.label}
                className={activeForPath(settingsEntry, location.pathname) ? "active" : ""}
              >
                <Icon name={settingsEntry.icon} className="h-5 w-5" />
                <span>{settingsEntry.label}</span>
              </Link>
            ) : null}
            {/*
              Sign out stays a top-level control in this block. Not nested under
              Profile: behind an expander it would be hidden by an interaction
              rather than by a fold, which is worse than the bug that was fixed.
              Icon-only, with the name carried by aria-label and title.
            */}
            <button
              type="button"
              className="desktop-account-action"
              title="Sign out"
              aria-label="Sign out"
              onClick={() => void signOut()}
            >
              <Icon name="logout" className="h-5 w-5" />
              <span>Sign out</span>
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
