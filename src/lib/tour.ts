/**
 * Verified-runner onboarding tour — pure model.
 *
 * The tour is a six-step, route-aware walkthrough shown ONCE to verified
 * runners (guests / pending / rejected / suspended accounts never see it).
 * Completion, dismissal, and Escape all persist the same localStorage marker
 * (`runlocal:tour:verified:v1`) so the tour never re-runs on its own; Settings
 * offers an explicit replay that clears the marker and restarts it.
 *
 * This module is deliberately free of React and DOM so the gating, storage,
 * reducer, and copy can be tested in vitest's node environment.
 */
import type { AccountRole } from "./accounts";

/** localStorage marker — one key per tour version. Bump only on a rewrite. */
export const TOUR_STORAGE_KEY = "runlocal:tour:verified:v1";
export const TOUR_SEEN_VALUE = "seen";
/** Window event Settings dispatches to start a replay. */
export const TOUR_REPLAY_EVENT = "runlocal:tour:replay";

/** Minimal storage contract so node tests can pass a plain object. */
export interface TourStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TourStep {
  /** Stable step id. */
  id: string;
  /** Route (within the hash router) where the step's target lives. */
  route: string;
  /** Selector for the highlighted element (`data-tour-target`). */
  target: string;
  /** Short label shown on the card as a pointer hint. */
  targetLabel: string;
  title: string;
  body: string;
}

/**
 * The six steps. Copy is deliberately honest about what is LIVE today:
 * forum posting/replies, My Runs list + calendar + .ics export, and the
 * Groups directory with memberships reachable from Profile. Matching,
 * messaging, and calendar synchronization are NOT available and are only
 * ever mentioned as "not available yet" (asserted in tests).
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "welcome",
    route: "/",
    target: "[data-tour-target='home-heading']",
    targetLabel: "This week's runs",
    title: "Welcome, verified runner",
    body: "You're all set. RSVP to group runs, post in the forum, and keep a private list of your runs. This six-step tour shows where everything lives — Skip ends it and it won't come back.",
  },
  {
    id: "events",
    route: "/",
    target: "[data-tour-target='events-actions']",
    targetLabel: "Host a run / Start a group",
    title: "Browse and join runs",
    body: "Group runs and independent runs for the week live here — RSVP is per occurrence and private to you. Host a run or start a group from this row; races are under the Races tab.",
  },
  {
    id: "forum",
    route: "/forum",
    target: "[data-tour-target='forum-compose']",
    targetLabel: "Forum — New post",
    title: "Forum is live",
    body: "Post and reply in the city forum. Your verified badge shows on your activity. Guests, pending, and denied profiles stay read-only, and posts follow community standards.",
  },
  {
    id: "my-runs",
    route: "/my-runs",
    target: "[data-tour-target='my-runs-header']",
    targetLabel: "My Runs",
    title: "My Runs is private",
    body: "Your RSVP list is private — only you can see it. Switch between the list and the month calendar, and export upcoming runs as an .ics file for your calendar app.",
  },
  {
    id: "groups",
    route: "/groups",
    target: "[data-tour-target='groups-directory']",
    targetLabel: "Groups & clubs directory",
    title: "Find local groups",
    body: "The public directory lists local clubs and community run groups. Request membership from a listing; your memberships and pending requests live under Profile → My Groups.",
  },
  {
    id: "profile",
    route: "/profile",
    target: "[data-tour-target='profile-header']",
    targetLabel: "Your profile",
    title: "Your profile hub",
    body: "Profile holds your My Groups entry, submissions, and trust info; Settings has preferences and this tour. Matching, messaging, and calendar sync are not available yet — they're on the roadmap.",
  },
] as const;

export const TOUR_STEP_COUNT = TOUR_STEPS.length;

export interface TourState {
  status: "idle" | "active";
  /** Index into TOUR_STEPS while active. */
  step: number;
}

export const INITIAL_TOUR_STATE: TourState = { status: "idle", step: 0 };

export type TourAction =
  | { type: "start" }
  | { type: "next" }
  | { type: "back" }
  | { type: "goto"; step: number }
  | { type: "dismiss" }
  | { type: "complete" };

function clampStep(step: number): number {
  return Math.max(0, Math.min(step, TOUR_STEP_COUNT - 1));
}

/** Pure reducer: start/next/back/goto/dismiss/complete with hard bounds. */
export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case "start":
      return { status: "active", step: 0 };
    case "next":
      return state.status === "active" ? { status: "active", step: clampStep(state.step + 1) } : state;
    case "back":
      return state.status === "active" ? { status: "active", step: clampStep(state.step - 1) } : state;
    case "goto":
      return state.status === "active" ? { status: "active", step: clampStep(action.step) } : state;
    case "dismiss":
    case "complete":
      return INITIAL_TOUR_STATE;
  }
}

export function isTourLastStep(step: number): boolean {
  return step >= TOUR_STEP_COUNT - 1;
}

/**
 * Gating rule: only a verified runner sees the auto-started tour, and only
 * until the marker is set. Guests / pending / rejected / suspended and anyone
 * who already dismissed or finished the tour gets `false`.
 */
export function shouldShowTour(role: AccountRole, seen: boolean): boolean {
  return role === "verified" && !seen;
}

export function readTourSeen(storage: TourStorage): boolean {
  return storage.getItem(TOUR_STORAGE_KEY) === TOUR_SEEN_VALUE;
}

export function markTourSeen(storage: TourStorage): void {
  storage.setItem(TOUR_STORAGE_KEY, TOUR_SEEN_VALUE);
}

export function clearTourSeen(storage: TourStorage): void {
  storage.removeItem(TOUR_STORAGE_KEY);
}

/**
 * Settings replay: clear the seen marker (so a mid-tour browser refresh would
 * auto-restart too — the marker only means "finished or skipped") and ask the
 * mounted TourHost to start. No-op safe in non-browser environments.
 */
export function requestTourReplay(storage: TourStorage): void {
  clearTourSeen(storage);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT));
  }
}
