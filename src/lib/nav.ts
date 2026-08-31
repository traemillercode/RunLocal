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

/* ── Sidebar grouping ─────────────────────────────────────────────────────── */

export interface NavGroup {
  /** Rendered above the group. Empty string means a divider with no header. */
  heading: string;
  entries: readonly NavEntry[];
}

/**
 * The sidebar, grouped.
 *
 * Thirteen ungrouped items has no hierarchy, which is why it read as a lot —
 * Strava runs five and Garmin six, and both group. Derived from the registry's
 * `area` field rather than hand-written, so a new feature lands in the right
 * group without anyone editing a list.
 *
 * "You" is DROPPED on desktop. It is the container for My Runs, Connections and
 * Messages on mobile, and showing a container beside its own contents is why
 * the column read as chaotic rather than merely long.
 *
 * Admin gets its own trailing group and stays hidden — not greyed — when the
 * viewer has no capability for it.
 */
export function sidebarGroups(role: AccountRole, opts: { isAdmin?: boolean } = {}): readonly NavGroup[] {
  const entries = entriesForRole("sidebar", role, opts);
  const byId = (id: string) => entries.find((e) => e.id === id);
  const pick = (...ids: string[]) => ids.map(byId).filter((e): e is NavEntry => Boolean(e));
  // "You" is the mobile TAB label — it names the container for My Runs,
  // Connections and Messages. On desktop those are siblings in their own
  // groups, so the container name is meaningless and it is just the profile.
  const relabel = (e: NavEntry): NavEntry => (e.id === "profile" ? { ...e, label: "Profile" } : e);

  const groups: NavGroup[] = [
    // Ordered within each group by how often a runner reaches for it, not
    // alphabetically — Home and Events before Races and Routes.
    { heading: "Discover", entries: pick("home", "events", "groups", "races", "routes") },
    { heading: "Training", entries: pick("training", "my-runs") },
    { heading: "Community", entries: pick("forum", "connections", "messages") },
    // No heading: account plumbing does not need naming, and a header there
    // would give it the same visual weight as the product itself.
    // Notifications is NOT here: the sidebar's account block already renders it
    // with an unread badge, and a registry copy would duplicate it badge-less.
    { heading: "", entries: pick("profile", "settings").map(relabel) },
    { heading: "", entries: pick("admin") },
  ];
  return groups.filter((g) => g.entries.length > 0);
}

/* ── Accordion sidebar ────────────────────────────────────────────────────── */

export interface NavSection {
  /** Stable key for the open/closed state. */
  id: string;
  label: string;
  icon: IconName;
  /** The parent row is itself a destination — clicking the label navigates. */
  route: string;
  children: readonly NavEntry[];
}

export interface AccordionModel {
  /** Always-visible top-level rows. */
  top: readonly NavEntry[];
  /** Expandable groups, one open at a time. */
  sections: readonly NavSection[];
  /** Below the divider, never scrolled away. */
  account: readonly NavEntry[];
  admin: NavEntry | null;
}

/**
 * Nine rows instead of fifteen, and no scroll container.
 *
 * ONE GROUP OPEN AT A TIME is what makes overflow structurally impossible
 * rather than merely tolerated. A max-height with internal scrolling would be
 * the same defect returning under another name — the sidebar is position:fixed
 * and does not scroll with the page, so anything below the fold is unreachable.
 * Expanding Training collapses Community; the row count has a hard ceiling.
 *
 * If nine rows plus the largest group ever exceeds a short viewport, that is a
 * signal the top-level count is wrong, not something to absorb.
 *
 * The four orphaned training features — shoes, pace calculator, summary,
 * recurring schedules — get a front door here for the first time. They have
 * existed with no nav entry at all.
 */
export function accordionModel(role: AccountRole, opts: { isAdmin?: boolean } = {}): AccordionModel {
  const entries = entriesForRole("sidebar", role, opts);
  const byId = (id: string) => entries.find((e) => e.id === id);
  const pick = (...ids: string[]) => ids.map(byId).filter((e): e is NavEntry => Boolean(e));
  // Children come from the registry by id rather than by area, because area
  // includes routes that are not navigable children (coach-roster, coaching).
  const child = (...ids: string[]) =>
    ids
      .map((id) => (FEATURES as readonly Feature[]).find((f) => f.id === id))
      .filter((f): f is Feature => f !== undefined && f.roles.includes(role))
      .map((f): NavEntry => ({
        id: f.id,
        route: f.route,
        label: f.nav?.label ?? f.label,
        icon: f.nav?.icon ?? ("chevronRight" as IconName),
        surfaces: ["sidebar"],
        // Children are leaf destinations; a prefix match would keep a submenu
        // row highlighted on unrelated nested routes.
        match: "exact",
      }));

  const sections: NavSection[] = [];
  const training = byId("training");
  if (training) {
    sections.push({
      id: "training", label: "Training", icon: training.icon, route: training.route,
      children: child("my-runs", "shoes", "pace-calculator", "training-summary", "recurring-schedules"),
    });
  }
  const forum = byId("forum");
  if (forum) {
    sections.push({
      id: "community", label: "Community", icon: forum.icon, route: forum.route,
      children: child("connections", "messages"),
    });
  }

  return {
    top: pick("home", "events", "groups", "races", "routes"),
    sections: sections.filter((s) => s.children.length > 0),
    account: pick("notifications", "profile", "settings").map((e) => (e.id === "profile" ? { ...e, label: "Profile" } : e)),
    admin: byId("admin") ?? null,
  };
}

/** The section containing a path, so the current route's group opens itself. */
export function sectionForPath(model: AccordionModel, pathname: string): string | null {
  for (const s of model.sections) {
    // The parent row is a destination too, so its own route counts as being
    // inside the section.
    if (activeForPath({ id: s.id, label: s.label, icon: s.icon, route: s.route, surfaces: ["sidebar"], match: "exact" }, pathname)) return s.id;
    if (s.children.some((c) => activeForPath(c, pathname))) return s.id;
  }
  return null;
}
