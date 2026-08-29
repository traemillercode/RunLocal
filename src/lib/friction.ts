/**
 * FRICTION instrumentation — the group that answers "where did the first 10
 * beta users get stuck".
 *
 * Three signals, each measuring something the others can't:
 *  - `rage_click`  — repeated clicks on one spot means something LOOKS
 *                    interactive and isn't responding. This is exactly the
 *                    "Host a run did nothing" class of bug, detected without
 *                    anyone having to report it.
 *  - `error_shown` — a user-visible error message. Distinct from a Sentry
 *                    exception: most bad moments in this app are a red toast
 *                    from a handled 4xx, which throws nothing.
 *  - `dead_end_reached` — a screen with no forward action. Reported
 *                    explicitly by empty states rather than inferred, because
 *                    "no onward link in the DOM" has too many false positives
 *                    (sheets, modals, transient loading states).
 */

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { track, trackPageView } from "./telemetry";

/** Clicks within this radius (px) and window (ms) count as the same frustrated gesture. */
const RAGE_RADIUS_PX = 30;
const RAGE_WINDOW_MS = 1200;
const RAGE_THRESHOLD = 3;

/**
 * Describes what was clicked WITHOUT capturing user content. Uses element
 * role/label/test-id rather than innerText, so a rage click on a message
 * bubble doesn't ship the message.
 */
function describeTarget(el: Element | null): string {
  if (!el) return "unknown";
  const node = el.closest("button, a, [role=button], input, select, textarea") ?? el;
  const tag = node.tagName.toLowerCase();
  const label = node.getAttribute("aria-label") ?? node.getAttribute("data-tour-target") ?? node.getAttribute("name") ?? "";
  return label ? `${tag}[${label.slice(0, 40)}]` : tag;
}

/**
 * Rolling breadcrumb trail of the last few user actions, used to give a
 * feedback report real context ("after tapping Add run") instead of an empty
 * array. Kept in memory only - never persisted, never transmitted except as
 * part of a report the user chose to send.
 *
 * Records the same non-content descriptor as rage_click: element role and
 * label, never innerText, so a click on a message bubble doesn't capture the
 * message.
 */
const BREADCRUMB_LIMIT = 6;
const breadcrumbs: string[] = [];

export function recordBreadcrumb(action: string): void {
  breadcrumbs.push(action.slice(0, 120));
  if (breadcrumbs.length > BREADCRUMB_LIMIT) breadcrumbs.shift();
}

/** The last 3 actions, oldest first - what the feedback report attaches. */
export function getRecentActions(): string[] {
  return breadcrumbs.slice(-3);
}

/** Tracks the most recent user-visible error so a report can attach it automatically. */
let lastErrorShown: string | null = null;
export function getLastErrorShown(): string | null {
  return lastErrorShown;
}

/**
 * Installs the global rage-click listener. Returns a cleanup function.
 * Deliberately passive and capture-phase so it observes without interfering
 * with any real handler.
 */
export function installRageClickDetector(): () => void {
  let hits: { x: number; y: number; t: number }[] = [];
  let lastReportAt = 0;

  const onClick = (e: MouseEvent) => {
    const now = Date.now();
    recordBreadcrumb(`clicked ${describeTarget(e.target as Element | null)} on ${window.location.pathname}`);
    hits = hits.filter((h) => now - h.t < RAGE_WINDOW_MS);
    hits.push({ x: e.clientX, y: e.clientY, t: now });

    const clustered = hits.filter(
      (h) => Math.abs(h.x - e.clientX) <= RAGE_RADIUS_PX && Math.abs(h.y - e.clientY) <= RAGE_RADIUS_PX,
    );

    // One report per burst, not one per click past the threshold.
    if (clustered.length >= RAGE_THRESHOLD && now - lastReportAt > RAGE_WINDOW_MS) {
      lastReportAt = now;
      track("rage_click", {
        target: describeTarget(e.target as Element | null),
        path: window.location.pathname,
        clicks: clustered.length,
      });
      hits = [];
    }
  };

  window.addEventListener("click", onClick, { capture: true, passive: true });
  return () => window.removeEventListener("click", onClick, { capture: true });
}

/**
 * Reports a user-visible error. Call this wherever an error is SHOWN, not
 * wherever one is caught - a handled error that never reaches the screen is
 * not friction.
 */
export function reportErrorShown(message: string, context?: { path?: string; code?: string }): void {
  lastErrorShown = message.slice(0, 300);
  track("error_shown", {
    // Truncated and never combined with user input by the callers below.
    message: message.slice(0, 140),
    code: context?.code ?? null,
    path: context?.path ?? window.location.pathname,
  });
}

/**
 * Reports a screen where the user has nothing to do next - an empty state
 * with no onward action. Called explicitly by empty states.
 */
export function reportDeadEnd(surface: string, reason?: string): void {
  track("dead_end_reached", { surface, reason: reason ?? null, path: window.location.pathname });
}

/** Fires a page view on every route change. SPA navigation doesn't trigger the SDK's automatic pageview, so without this every view after the first is invisible. */
export function useRouteTelemetry(): void {
  const location = useLocation();
  useEffect(() => {
    recordBreadcrumb(`viewed ${location.pathname}`);
    trackPageView(location.pathname);
  }, [location.pathname]);
}

/**
 * Reports a dead end once per distinct occurrence, from inside a component.
 *
 * A bare reportDeadEnd() in a render body fires on every re-render, which would
 * drown the signal in duplicates. Keyed on surface+reason so a genuinely
 * different dead end still reports.
 */
export function useDeadEnd(surface: string, active: boolean, reason?: string): void {
  useEffect(() => {
    if (active) reportDeadEnd(surface, reason);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, active, reason]);
}
