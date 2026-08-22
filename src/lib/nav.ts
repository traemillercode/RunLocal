/**
 * Single navigation model for Run Local — the ONE source of truth for the
 * mobile bottom tab bar, the desktop sidebar, and the account menu.
 *
 * Before this module existed, three independent nav definitions (BottomNav
 * TABS, DesktopSidebar items + inline links, accountMenu entries) drifted
 * apart in labels, icons, routes, and — worst — active-state logic. Every
 * surface now derives its entries from NAV_ENTRIES and uses the same
 * activeForPath() matcher, so a detail route (e.g. /events/:id, /groups/:id,
 * /runners/:id) highlights the same nav item on every surface.
 *
 * Pure module (no React) so it is unit-testable in vitest's node environment.
 */
export type NavSurface = "bottom" | "sidebar" | "menu";

export interface NavEntry {
  /** Stable id (also used as the React key). */
  id: string;
  /** Internal route. */
  route: string;
  label: string;
  /** Icon name from the shared icon set (components/ui.tsx). */
  icon: string;
  /** Which surfaces render this entry. */
  surfaces: readonly NavSurface[];
  /**
   * "exact" — active only on the entry's own route.
   * "prefix" — active on the route and every nested detail route under it.
   */
  match: "exact" | "prefix";
}

export const NAV_ENTRIES: readonly NavEntry[] = [
  { id: "events", route: "/", label: "Events", icon: "calendar", surfaces: ["bottom", "sidebar"], match: "prefix" },
  { id: "races", route: "/races", label: "Races", icon: "trophy", surfaces: ["bottom", "sidebar"], match: "prefix" },
  { id: "forum", route: "/forum", label: "Forum", icon: "chat", surfaces: ["bottom", "sidebar"], match: "prefix" },
  { id: "groups", route: "/groups", label: "Groups & Clubs", icon: "users", surfaces: ["sidebar"], match: "prefix" },
  { id: "connections", route: "/connections", label: "Connections", icon: "users", surfaces: ["bottom", "sidebar"], match: "prefix" },
  { id: "messages", route: "/messages", label: "Messages", icon: "chat", surfaces: ["sidebar", "menu"], match: "prefix" },
  { id: "my-runs", route: "/my-runs", label: "My Runs", icon: "rsvp", surfaces: ["bottom", "sidebar"], match: "prefix" },
  { id: "profile", route: "/profile", label: "Profile", icon: "user", surfaces: ["sidebar", "menu"], match: "prefix" },
  { id: "settings", route: "/settings", label: "Settings", icon: "settings", surfaces: ["sidebar", "menu"], match: "prefix" },
  { id: "submissions", route: "/profile?section=submissions", label: "My submissions", icon: "document", surfaces: ["menu"], match: "prefix" },
] as const;

/** Entries rendered by a given surface, in canonical order. */
export function entriesForSurface(surface: NavSurface): readonly NavEntry[] {
  return NAV_ENTRIES.filter((e) => e.surfaces.includes(surface));
}

/**
 * Uniform active-state matcher shared by BottomNav, DesktopSidebar, and the
 * account menu:
 *  - Events: active on "/" exactly AND on every /events* detail route.
 *  - Profile: active on /profile AND on /runners/:id (public profile views
 *    are profile views — the Profile item stays highlighted).
 *  - Everyone else: active on the entry's route and nested routes under it.
 */
export function activeForPath(entry: NavEntry, pathname: string): boolean {
  if (entry.id === "events") {
    return pathname === "/" || pathname === "/events" || pathname.startsWith("/events/");
  }
  if (entry.id === "profile") {
    return (
      pathname === "/profile" ||
      pathname.startsWith("/profile/") ||
      pathname === "/runners" ||
      pathname.startsWith("/runners/")
    );
  }
  if (entry.match === "exact") return pathname === entry.route;
  const base = entry.route.endsWith("/") ? entry.route : `${entry.route}/`;
  return pathname === entry.route || pathname.startsWith(base);
}

/**
 * Routes that get a chrome-free wizard layout — NO bottom nav AND NO desktop
 * sidebar (shared with App.tsx so the shell and the sidebar agree).
 */
export const NO_NAV_PATHS = new Set(["/landing", "/verify", "/admin", "/login", "/recovery", "/confirmation", "/callback", "/checkin"]);
