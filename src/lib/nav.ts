/**
 * Single navigation model for Kimbio — the ONE source of truth for the
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
import type { IconName } from "../components/ui";
import type { AccountRole } from "./accounts";
import { FEATURES, type Feature } from "./features";
export type NavSurface = "bottom" | "sidebar" | "menu";

export interface NavEntry {
  /** Stable id (also used as the React key). */
  id: string;
  /** Internal route. */
  route: string;
  label: string;
  /** Icon name from the shared icon set (components/ui.tsx). */
  icon: IconName;
  /** Which surfaces render this entry. */
  surfaces: readonly NavSurface[];
  /**
   * "exact" — active only on the entry's own route.
   * "prefix" — active on the route and every nested detail route under it.
   */
  match: "exact" | "prefix";
}

/**
 * DERIVED from the feature registry (src/lib/features.ts), not declared here.
 *
 * This file used to be a second source of truth: three surfaces each decided
 * independently what existed, which is how 24 routes ended up with no nav path
 * and how "Events" pointed at "/" long after "/" stopped being the events page.
 * The registry now decides; this maps its entries onto the NavEntry shape the
 * existing consumers already read, so BottomNav and DesktopSidebar are
 * unchanged.
 *
 * Ordering follows the registry's declaration order, which is the five-tab
 * structure Home · Events · Groups · Training · You.
 */
export const NAV_ENTRIES: readonly NavEntry[] = (FEATURES as readonly Feature[])
  .filter((f): f is Feature & { nav: NonNullable<Feature["nav"]> } => f.reach.kind === "nav" && Boolean(f.nav))
  .map((f) => ({
    id: f.id,
    route: f.route,
    label: f.nav.label,
    icon: f.nav.icon,
    surfaces: f.nav.surfaces,
    // "/" must be exact: prefix-matching the root marks every route active.
    match: f.route === "/" ? "exact" : "prefix",
  }));

/**
 * Which nav entries a given role may see.
 *
 * HIDDEN, never disabled. A permanently greyed menu item teaches people to
 * ignore the menu — and three commits of this build were spent removing
 * controls that looked usable and were not.
 *
 * Capability-gated entries (currently /admin) are excluded unless the caller
 * passes the capability explicitly, because `roles` is only a floor for those:
 * every verified runner is not an admin.
 */
export function entriesForRole(
  surface: NavSurface,
  role: AccountRole,
  opts: { isAdmin?: boolean } = {},
): readonly NavEntry[] {
  const byId = new Map((FEATURES as readonly Feature[]).map((f) => [f.id, f]));
  return NAV_ENTRIES.filter((e) => {
    if (!e.surfaces.includes(surface)) return false;
    const feature = byId.get(e.id as never);
    if (!feature) return false;
    if (!feature.roles.includes(role)) return false;
    if (feature.capability) return opts.isAdmin === true;
    return true;
  });
}

/** Entries rendered by a given surface, in canonical order. */
export function entriesForSurface(surface: NavSurface): readonly NavEntry[] {
  return NAV_ENTRIES.filter((e) => e.surfaces.includes(surface));
}

/**
 * Uniform active-state matcher shared by BottomNav, DesktopSidebar, and the
 * account menu:
 *  - Everyone: active on the entry's route and nested routes under it, plus
 *    any ALSO_ACTIVE_ON prefixes declared for that entry.
 */

/**
 * Extra prefixes that should highlight an entry, declared rather than branched.
 *
 * Events previously had a hardcoded `pathname === "/"` clause, from when "/"
 * rendered the board. 1.2 replaced "/" with Home and the exception survived, so
 * on Home BOTH Home (exact) and Events (stale rule) lit up. The bug was not the
 * exception itself — it was that an exception buried in an if-chain has nothing
 * asserting it still describes reality.
 *
 * As data it can be checked: the "exactly one active entry per path" test below
 * fails the moment a rule here overlaps another entry's route.
 */
const ALSO_ACTIVE_ON: Partial<Record<string, readonly string[]>> = {
  // A public profile view IS a profile view.
  profile: ["/runners"],
};

export function activeForPath(entry: NavEntry, pathname: string): boolean {
  for (const prefix of ALSO_ACTIVE_ON[entry.id] ?? []) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
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
