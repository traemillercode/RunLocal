import type { AccountRole } from "./accounts";
import type { IconName } from "../components/ui";

/**
 * THE FEATURE REGISTRY — one typed source of truth for what exists, who can
 * reach it, and how.
 *
 * Built as a registry rather than a nav array (Demo & Discovery Spec §3)
 * because the same information is needed by six surfaces: nav, the onboarding
 * tour, the public demo, a help index, an admin capability map, and a
 * changelog. Defined once here, those render FROM it. Defined as a nav array,
 * they get defined again — which is how three drifted nav definitions and 24
 * orphaned routes happened.
 *
 * This is deliberately the CANONICAL ROUTE TABLE, not a subset. Every path in
 * App.tsx has an entry and every entry exists in App.tsx, both directions
 * asserted. A registry that covers only nav-eligible features needs an
 * allowlist for the rest, and the allowlist is exactly where the next orphan
 * would hide.
 */

export type FeatureArea = "community" | "training" | "account" | "admin" | "public";

/**
 * HOW a feature is reached — modelled explicitly rather than as an
 * `area: "none"` catch-all.
 *
 * A single "none" value would mean detail-route, auth-callback, and
 * deliberately-unreachable all at once, which is the same defect as
 * `slot: "primary"` meaning both "the only session" and "the first of two".
 * It would also make the reachability assertion unverifiable, because
 * "no nav path by design" would be indistinguishable from "someone forgot".
 */
export type Reach =
  /** Appears in a nav surface. */
  | { kind: "nav" }
  /** Reachable from a parent route — a detail page, a sub-tab. */
  | { kind: "child"; parent: FeatureId }
  /** Redirect-only entry: auth callbacks, verification landings. Never linked. */
  | { kind: "flow" }
  /** Deliberately unreachable. The reason is required so this is a decision, not an accident. */
  | { kind: "orphan"; reason: string };

export interface Feature {
  id: FeatureId;
  route: string;
  /** One line, user-facing. The help index and demo caption both read this. */
  summary: string;
  area: FeatureArea;
  /** Who can reach it. Drives role-gated nav and demo persona filtering. */
  roles: readonly AccountRole[];
  /**
   * Set when access is governed by the ADMIN CAPABILITY system rather than by
   * AccountRole. Must match a string `authorizeAdmin` is actually called with.
   *
   * Why this exists: /admin previously declared `roles: ["verified"]`, which is
   * false — every verified runner is not an admin. Assertion 4 was therefore
   * confirming a reachability claim it had no way to evaluate, on the one route
   * where being wrong costs the most. A guard reporting a pass on a claim it
   * cannot check is worse than no guard.
   *
   * Deliberately coarse: this records THAT a capability governs the route, not
   * the full permission model, which stays in eventCapabilities/authorizeAdmin.
   * Duplicating that model here would create a second source of truth for
   * permissions — the exact failure the registry exists to prevent.
   */
  capability?: string;
  /** Shipping state. Nothing marked "planned" may be described as available anywhere. */
  status: "live" | "beta" | "planned";
  reach: Reach;
  /** Present only for nav-reachable features. */
  nav?: { label: string; icon: IconName; surfaces: readonly ("bottom" | "sidebar" | "menu")[] };
}

const ALL: readonly AccountRole[] = ["guest", "pending", "rejected", "verified"] as const;
const SIGNED_IN: readonly AccountRole[] = ["pending", "rejected", "verified"] as const;
const VERIFIED: readonly AccountRole[] = ["verified"] as const;

/**
 * The five-tab structure from the Structural Audit:
 *   Home · Events · Groups · Training · You
 *
 * NOTE: this registry does not yet DRIVE the nav — nothing consumes it. The
 * `nav` entries below describe the intended structure so the shape can be
 * reviewed before 44 routes depend on it.
 */
export const FEATURES = [
  // ── Home ──────────────────────────────────────────────────────────────
  { id: "home", route: "/", summary: "Your next run, your group's week, and what changed.", area: "community", roles: ALL, status: "live",
    reach: { kind: "nav" }, nav: { label: "Home", icon: "home", surfaces: ["bottom", "sidebar"] } },

  // ── Events ────────────────────────────────────────────────────────────
  { id: "events", route: "/events", summary: "Every group run happening this week.", area: "community", roles: ALL, status: "live",
    reach: { kind: "nav" }, nav: { label: "Events", icon: "calendar", surfaces: ["bottom", "sidebar"] } },
  { id: "event-detail", route: "/events/:eventId", summary: "One run: where, when, who's going.", area: "community", roles: ALL, status: "live",
    reach: { kind: "child", parent: "events" } },
  { id: "events-manage", route: "/events/manage", summary: "Moderate and edit runs you're responsible for.", area: "community", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "events" } },
  { id: "past-events", route: "/past-events", summary: "Runs that have already happened.", area: "community", roles: SIGNED_IN, status: "live",
    reach: { kind: "child", parent: "events" } },
  { id: "races", route: "/races", summary: "Local races, one place.", area: "community", roles: ALL, status: "live",
    reach: { kind: "nav" }, nav: { label: "Races", icon: "trophy", surfaces: ["sidebar"] } },
  { id: "routes", route: "/routes", summary: "Real routes runners actually use.", area: "community", roles: ALL, status: "live",
    reach: { kind: "nav" }, nav: { label: "Routes", icon: "mapPin", surfaces: ["sidebar"] } },
  { id: "route-detail", route: "/routes/:routeId", summary: "One route, with its map and distance.", area: "community", roles: ALL, status: "live",
    reach: { kind: "child", parent: "routes" } },
  { id: "checkin", route: "/checkin", summary: "Check in at a run you're attending.", area: "community", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "event-detail" } },

  // ── Groups ────────────────────────────────────────────────────────────
  { id: "groups", route: "/groups", summary: "Run clubs and crews in your city.", area: "community", roles: ALL, status: "live",
    reach: { kind: "nav" }, nav: { label: "Groups", icon: "users", surfaces: ["bottom", "sidebar"] } },
  { id: "group-detail", route: "/groups/:groupId", summary: "A club's runs, members, and how to join.", area: "community", roles: ALL, status: "live",
    reach: { kind: "child", parent: "groups" } },
  { id: "group-manage", route: "/groups/:groupId/manage", summary: "Manage your club's profile and membership.", area: "community", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "group-detail" } },
  { id: "group-roster", route: "/groups/:groupId/roster", summary: "Who's in the club.", area: "community", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "group-detail" } },
  { id: "my-groups", route: "/my-groups", summary: "Clubs you belong to.", area: "community", roles: SIGNED_IN, status: "live",
    reach: { kind: "child", parent: "groups" } },
  { id: "forum", route: "/forum", summary: "Ask, share, find a pace group.", area: "community", roles: ALL, status: "live",
    reach: { kind: "nav" }, nav: { label: "Forum", icon: "chat", surfaces: ["sidebar"] } },

  // ── Training ──────────────────────────────────────────────────────────
  // Six features hung off TrainingPlanDetailPage and nowhere else. This is the
  // hub the Structural Audit called for: they become children of a real tab.
  { id: "training", route: "/training-plan", summary: "Your training plan, week by week.", area: "training", roles: VERIFIED, status: "live",
    reach: { kind: "nav" }, nav: { label: "Training", icon: "calendar", surfaces: ["bottom", "sidebar"] } },
  { id: "training-summary", route: "/training-summary", summary: "What you actually ran, by day, week, or month.", area: "training", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "training" } },
  { id: "shoes", route: "/shoes", summary: "Your shoes and their mileage.", area: "training", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "training" } },
  { id: "pace-calculator", route: "/pace-calculator", summary: "Race predictions and training paces.", area: "training", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "training" } },
  { id: "recurring-schedules", route: "/recurring-schedules", summary: "Workouts that repeat every week.", area: "training", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "training" } },
  { id: "coaches", route: "/coaches", summary: "Find a coach.", area: "training", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "training" } },
  { id: "coaching", route: "/coaching", summary: "Your coaching requests and relationships.", area: "training", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "training" } },
  { id: "coach-roster", route: "/coach-roster", summary: "Athletes you coach.", area: "training", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "training" } },
  { id: "coach-athlete", route: "/coach-roster/:athleteId", summary: "One athlete's plan, as their coach.", area: "training", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "coach-roster" } },

  // ── You ───────────────────────────────────────────────────────────────
  // Messages and Connections belong here: relationship management, not discovery.
  { id: "profile", route: "/profile", summary: "Your profile as others see it.", area: "account", roles: SIGNED_IN, status: "live",
    reach: { kind: "nav" }, nav: { label: "You", icon: "user", surfaces: ["bottom", "sidebar", "menu"] } },
  { id: "my-runs", route: "/my-runs", summary: "Runs you've logged and RSVP'd to.", area: "account", roles: SIGNED_IN, status: "live",
    reach: { kind: "child", parent: "profile" } },
  { id: "connections", route: "/connections", summary: "Runners you know.", area: "account", roles: SIGNED_IN, status: "live",
    reach: { kind: "child", parent: "profile" } },
  { id: "messages", route: "/messages", summary: "Direct messages.", area: "account", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "profile" } },
  { id: "conversation", route: "/messages/:conversationId", summary: "One conversation.", area: "account", roles: VERIFIED, status: "live",
    reach: { kind: "child", parent: "messages" } },
  { id: "notifications", route: "/notifications", summary: "What's happened since you were last here.", area: "account", roles: SIGNED_IN, status: "live",
    reach: { kind: "child", parent: "profile" } },
  { id: "settings", route: "/settings", summary: "Account, privacy, and notification preferences.", area: "account", roles: SIGNED_IN, status: "live",
    reach: { kind: "nav" }, nav: { label: "Settings", icon: "settings", surfaces: ["menu"] } },
  { id: "runner-profile", route: "/runners/:id", summary: "Another runner's public profile.", area: "account", roles: SIGNED_IN, status: "live",
    reach: { kind: "child", parent: "connections" } },

  // ── Admin ─────────────────────────────────────────────────────────────
  // Role-conditional: rendered only for owner/key/city admins, hidden rather
  // than disabled — a permanently greyed menu teaches people to ignore menus.
  // roles is the FLOOR (you must at least be verified); `capability` is what
  // actually gates it. AdminPage is a client route calling ~10 admin APIs, each
  // with its own capability, so no single server handler corresponds to it —
  // admin.cms_settings is named here as the representative capability the page
  // cannot function without.
  { id: "admin", route: "/admin", summary: "Moderation queue, verification, and city settings.", area: "admin", roles: VERIFIED, status: "live",
    capability: "admin.cms_settings",
    reach: { kind: "nav" }, nav: { label: "Admin", icon: "shield", surfaces: ["sidebar"] } },

  // ── Public / marketing ────────────────────────────────────────────────
  { id: "landing", route: "/landing", summary: "What Kimbio is.", area: "public", roles: ALL, status: "live",
    reach: { kind: "child", parent: "home" } },
  // Linked from the marketing footer, NOT Settings — assertion 4 caught this:
  // /legal is public but Settings is signed-in only, so a guest could never
  // walk to it through the parent I first claimed.
  { id: "legal", route: "/legal", summary: "Terms and privacy.", area: "public", roles: ALL, status: "live",
    reach: { kind: "child", parent: "home" } },
  { id: "sponsor", route: "/sponsor", summary: "Sponsor a local run.", area: "public", roles: ALL, status: "live",
    reach: { kind: "child", parent: "home" } },
  { id: "sponsor-detail", route: "/sponsor/:sponsorId", summary: "Complete a sponsorship booking.", area: "public", roles: ALL, status: "live",
    reach: { kind: "child", parent: "sponsor" } },

  // ── Auth flows ────────────────────────────────────────────────────────
  // Never linked from anywhere: entered by redirect or emailed link. "flow"
  // says that honestly instead of leaving them looking forgotten.
  { id: "login", route: "/login", summary: "Sign in or create an account.", area: "public", roles: ALL, status: "live",
    reach: { kind: "nav" }, nav: { label: "Sign in", icon: "user", surfaces: ["menu"] } },
  { id: "callback", route: "/callback", summary: "Completes sign-in after an emailed link.", area: "public", roles: ALL, status: "live",
    reach: { kind: "flow" } },
  { id: "confirmation", route: "/confirmation", summary: "Confirms an email address.", area: "public", roles: ALL, status: "live",
    reach: { kind: "flow" } },
  { id: "recovery", route: "/recovery", summary: "Sets a new password from a reset link.", area: "public", roles: ALL, status: "live",
    reach: { kind: "flow" } },
  { id: "verify", route: "/verify", summary: "Submits verification so you can post and RSVP.", area: "account", roles: SIGNED_IN, status: "live",
    reach: { kind: "flow" } },

  // ── Catch-all ─────────────────────────────────────────────────────────
  { id: "not-found", route: "*", summary: "Nothing lives at this address.", area: "public", roles: ALL, status: "live",
    reach: { kind: "orphan", reason: "React Router catch-all; matched only when no other route does, so it is unreachable by design." } },
] as const satisfies readonly Feature[];

/**
 * NOTE: hand-maintained, deliberately. It cannot be derived from FEATURES
 * because Reach.parent references FeatureId, which would make the type
 * circular. Every alternative is worse — a two-pass definition, a satisfies
 * dance, or losing the compile-time check on `parent`. Two independent guards
 * cover the duplication: a typo in an id fails tsc, and assertion 5 enforces
 * uniqueness.
 */
export type FeatureId =
  | "home" | "events" | "event-detail" | "events-manage" | "past-events" | "races" | "routes" | "route-detail" | "checkin"
  | "groups" | "group-detail" | "group-manage" | "group-roster" | "my-groups" | "forum"
  | "training" | "training-summary" | "shoes" | "pace-calculator" | "recurring-schedules" | "coaches" | "coaching" | "coach-roster" | "coach-athlete"
  | "profile" | "my-runs" | "connections" | "messages" | "conversation" | "notifications" | "settings" | "runner-profile"
  | "admin"
  | "landing" | "legal" | "sponsor" | "sponsor-detail"
  | "login" | "callback" | "confirmation" | "recovery" | "verify"
  | "not-found";

export function featureById(id: FeatureId): Feature | undefined {
  return (FEATURES as readonly Feature[]).find((f) => f.id === id);
}

/** Features a given role can reach through a nav surface. */
export function navFor(role: AccountRole, surface: "bottom" | "sidebar" | "menu"): readonly Feature[] {
  // Widened to Feature[]: `as const satisfies` narrows each entry to its own
  // literal type, so `nav` is genuinely absent (not optional) on entries that
  // do not declare it. Reading through the interface is what makes the
  // optional field addressable.
  return (FEATURES as readonly Feature[]).filter(
    (f) => f.reach.kind === "nav" && f.nav?.surfaces.includes(surface) && f.roles.includes(role),
  );
}
