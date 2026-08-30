/**
 * GEOFENCE BYPASS — which paths a visitor outside the city may still load.
 *
 * D2 decided that event data is PUBLIC READ with GATED WRITES. The decision was
 * made and the bypass was never updated, so every public route stayed walled:
 * an out-of-area guest clicking Events, Races, Routes, or Groups from the
 * marketing page hit the geofence and bounced back to marketing. That reads as
 * "the site sent me away", and it is why the marketing page feels like it has
 * nowhere to go — everywhere it points is walled.
 *
 * THE RULE: the geofence protects ACTIONS, not READING. Someone in another city
 * looking at Tuesday's run does no harm and is a prospective member; someone
 * RSVPing to it from another state is the thing the fence exists to prevent.
 * So reads bypass and writes never do — and writes are enforced server-side
 * regardless, since a client-side fence is a UI affordance, not a security
 * boundary.
 *
 * Extracted from an inline JSX expression in App.tsx so it can be tested
 * directly. A security-adjacent rule that can only be exercised by rendering
 * the whole app is a rule nobody writes tests for.
 */

/** Exact paths that bypass: auth flows, legal, marketing. */
const EXACT_BYPASS = new Set([
  "/landing",
  "/legal",
  "/login",
  "/recovery",
  "/confirmation",
  "/callback",
]);

/**
 * D2 public read routes. Prefixes, because detail pages are equally public:
 * a guest who can see the events list can see one event.
 *
 * Deliberately NOT included, and each for a reason:
 *   /forum        — reading community discussion is a member benefit, not a
 *                   shop window, and it is where personal detail surfaces
 *   /my-*, /profile, /messages, /connections, /notifications — personal
 *   /training-*, /coach-*, /shoes, /pace-calculator — member product
 *   /admin        — never
 *   /events/manage — a WRITE surface that happens to live under /events, which
 *                   is exactly why this matches prefixes explicitly rather than
 *                   treating everything under /events as public
 */
/*
 * ═══ D2 PARTIALLY REVERSED FOR THE CLOSED BETA ═══
 *
 * D2 decided event data is public read with gated writes, and item A of this
 * build implemented it: /events, /groups, /races and /routes all bypassed the
 * geofence for a signed-out visitor.
 *
 * That is right for launch and wrong for a closed beta about to be ADVERTISED.
 * A stranger arriving from an ad should read the landing page and understand
 * the door is shut — not browse a half-populated app they cannot join, and not
 * have Google index eleven routes of it as though the product were open.
 *
 * REVERSED, NOT DELETED, and recorded here rather than done silently: the
 * prefixes below are commented out, not removed, so restoring D2 when the beta
 * opens is uncommenting a list rather than rediscovering a decision. It goes
 * back with 2.12, when prerendering makes public routes worth indexing.
 */
const PUBLIC_READ_PREFIXES = [
  // Restore these when the beta opens (D2, roadmap 2.12):
  // "/events",
  // "/groups",
  // "/races",
  // "/routes",
] as const;

/** Paths under a public prefix that are NOT public — write surfaces. */
const PUBLIC_READ_EXCEPTIONS = [
  "/events/manage",
  "/groups/", // any /groups/:id/manage or /roster — see isPublicReadPath
] as const;

export interface BypassContext {
  pathname: string;
  signedIn: boolean;
  isOwner?: boolean;
  isGeofenceExempt?: boolean;
}

/** True when a path is D2 public-read. Exported for direct testing. */
export function isPublicReadPath(pathname: string): boolean {
  if (pathname === "/events/manage" || pathname.startsWith("/events/manage/")) return false;
  // Group sub-routes that manage rather than show.
  if (/^\/groups\/[^/]+\/(manage|roster)$/.test(pathname)) return false;

  return PUBLIC_READ_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Whether the geofence should be bypassed for this request. */
export function shouldBypassGeofence(ctx: BypassContext): boolean {
  const { pathname, signedIn, isOwner, isGeofenceExempt } = ctx;

  if (EXACT_BYPASS.has(pathname)) return true;
  // Sponsorship is a business enquiry from anywhere.
  if (pathname === "/sponsor" || pathname.startsWith("/sponsor/")) return true;
  // Marketing at the root, for signed-out visitors only.
  if (pathname === "/" && !signedIn) return true;
  // D2 public read.
  if (isPublicReadPath(pathname)) return true;
  // Explicit per-account exemptions.
  if (signedIn && (isOwner === true || isGeofenceExempt === true)) return true;

  return false;
}

/** Exported so tests can assert the exception list rather than infer it. */
export const _internals = { EXACT_BYPASS, PUBLIC_READ_PREFIXES, PUBLIC_READ_EXCEPTIONS };
