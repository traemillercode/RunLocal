/**
 * Pure-model tests for the verified-runner onboarding tour: gating, storage,
 * reducer transitions, step/copy invariants, and the replay helper.
 *
 * No React, no DOM — runs in vitest's node environment.
 */
import { describe, expect, it } from "vitest";
import {
  INITIAL_TOUR_STATE,
  TOUR_REPLAY_EVENT,
  TOUR_STEPS,
  TOUR_STEP_COUNT,
  TOUR_STORAGE_KEY,
  TOUR_SEEN_VALUE,
  clearTourSeen,
  isTourLastStep,
  markTourSeen,
  readTourSeen,
  requestTourReplay,
  shouldShowTour,
  tourReducer,
  type TourStorage,
} from "../src/lib/tour";

function memoryStorage(initial: Record<string, string> = {}): TourStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe("tour gating", () => {
  it("shows for a verified runner who has not seen the tour", () => {
    expect(shouldShowTour("verified", false)).toBe(true);
  });
  it("never shows for guests, pending, or rejected accounts", () => {
    expect(shouldShowTour("guest", false)).toBe(false);
    expect(shouldShowTour("pending", false)).toBe(false);
    expect(shouldShowTour("rejected", false)).toBe(false);
  });
  it("never re-shows once the marker is set", () => {
    expect(shouldShowTour("verified", true)).toBe(false);
    expect(shouldShowTour("guest", true)).toBe(false);
  });
});

describe("tour storage", () => {
  it("reads false for an empty store and true for the exact marker value", () => {
    const s = memoryStorage();
    expect(readTourSeen(s)).toBe(false);
    markTourSeen(s);
    expect(readTourSeen(s)).toBe(true);
    expect(s.getItem(TOUR_STORAGE_KEY)).toBe(TOUR_SEEN_VALUE);
  });
  it("mark/clear round-trips and only touches the tour key", () => {
    const s = memoryStorage({ other: "keep" });
    markTourSeen(s);
    expect(readTourSeen(s)).toBe(true);
    clearTourSeen(s);
    expect(readTourSeen(s)).toBe(false);
    expect(s.getItem("other")).toBe("keep");
  });
  it("uses the versioned key constant", () => {
    expect(TOUR_STORAGE_KEY).toBe("runlocal:tour:verified:v2");
    const s = memoryStorage({ [TOUR_STORAGE_KEY]: TOUR_SEEN_VALUE });
    expect(readTourSeen(s)).toBe(true);
  });
});

describe("tour reducer", () => {
  it("start activates at step 0 from idle", () => {
    expect(tourReducer(INITIAL_TOUR_STATE, { type: "start" })).toEqual({ status: "active", step: 0 });
  });
  it("next advances and clamps at the last step", () => {
    let state = tourReducer(INITIAL_TOUR_STATE, { type: "start" });
    for (let i = 1; i < TOUR_STEP_COUNT; i++) {
      state = tourReducer(state, { type: "next" });
      expect(state.step).toBe(i);
    }
    const last = tourReducer(state, { type: "next" });
    expect(last.step).toBe(TOUR_STEP_COUNT - 1);
    expect(isTourLastStep(last.step)).toBe(true);
  });
  it("back clamps at step 0 and is a no-op when idle", () => {
    let state = tourReducer({ status: "active", step: 2 }, { type: "back" });
    expect(state.step).toBe(1);
    state = tourReducer(state, { type: "back" });
    expect(state.step).toBe(0);
    expect(tourReducer(state, { type: "back" }).step).toBe(0);
    expect(tourReducer(INITIAL_TOUR_STATE, { type: "back" })).toBe(INITIAL_TOUR_STATE);
  });
  it("dismiss and complete both return to idle", () => {
    const active = tourReducer(INITIAL_TOUR_STATE, { type: "start" });
    expect(tourReducer(active, { type: "dismiss" })).toEqual(INITIAL_TOUR_STATE);
    expect(tourReducer(active, { type: "complete" })).toEqual(INITIAL_TOUR_STATE);
    // Idle transitions are no-ops (no self-starting).
    expect(tourReducer(INITIAL_TOUR_STATE, { type: "next" })).toBe(INITIAL_TOUR_STATE);
  });
  it("goto clamps out-of-range steps", () => {
    expect(tourReducer({ status: "active", step: 0 }, { type: "goto", step: 99 }).step).toBe(TOUR_STEP_COUNT - 1);
    expect(tourReducer({ status: "active", step: 0 }, { type: "goto", step: -3 }).step).toBe(0);
  });
});

describe("tour copy & steps (honesty constraints)", () => {
  it("defines exactly seven steps with unique ids and routes", () => {
    expect(TOUR_STEPS).toHaveLength(7);
    const ids = new Set(TOUR_STEPS.map((s) => s.id));
    expect(ids.size).toBe(7);
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
      expect(s.route.startsWith("/")).toBe(true);
      expect(s.target).toContain("data-tour-target");
      expect(s.targetLabel.length).toBeGreaterThan(0);
    }
  });
  it("covers the seven surfaces: home, events, forum, My Runs, groups, profile, settings", () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(ids).toEqual(["welcome", "events", "forum", "my-runs", "groups", "profile", "settings"]);
    expect(TOUR_STEPS[1].route).toBe("/");
    expect(TOUR_STEPS[2].route).toBe("/forum");
    expect(TOUR_STEPS[3].route).toBe("/my-runs");
    expect(TOUR_STEPS[4].route).toBe("/groups");
    expect(TOUR_STEPS[5].route).toBe("/profile");
    expect(TOUR_STEPS[6].route).toBe("/settings");
  });
  it("points the profile step at My Groups (memberships surface) and mentions Settings next", () => {
    const profile = TOUR_STEPS.find((s) => s.id === "profile");
    expect(profile?.target).toContain("profile-my-groups");
    const body = profile?.body.toLowerCase() ?? "";
    expect(body).toContain("memberships");
    expect(body).toContain("pending requests");
    expect(body).toContain("submissions");
    expect(body).toContain("trust info");
    expect(body).toContain("settings");
  });
  it("routes the settings step to /settings with the settings-main target", () => {
    const settings = TOUR_STEPS.find((s) => s.id === "settings");
    expect(settings?.route).toBe("/settings");
    expect(settings?.target).toContain("settings-main");
    const body = settings?.body.toLowerCase() ?? "";
    // Privacy controls are live: upcoming-runs visibility, saved runs,
    // profile visibility, and being findable by name.
    expect(body).toContain("privacy");
    expect(body).toContain("upcoming runs");
    expect(body).toContain("saved runs");
    expect(body).toContain("find your profile");
    expect(body).toContain("find you by name");
    expect(body).toContain("notifications");
    // Settings is live — the step must NOT hedge it with not-available copy.
    expect(settings?.body).not.toMatch(/not available yet/i);
  });
  it("claims forum posting and replies as live (they are)", () => {
    const forum = TOUR_STEPS.find((s) => s.id === "forum");
    expect(forum?.body.toLowerCase()).toContain("post");
    expect(forum?.body.toLowerCase()).toContain("reply");
  });
  it("claims My Runs list, calendar, and .ics export as live (they are)", () => {
    const myRuns = TOUR_STEPS.find((s) => s.id === "my-runs");
    const body = myRuns?.body.toLowerCase() ?? "";
    expect(body).toContain("list");
    expect(body).toContain("calendar");
    expect(body).toContain(".ics");
    expect(body).toContain("private");
  });
  it("points groups to the directory and Profile → My Groups", () => {
    const groups = TOUR_STEPS.find((s) => s.id === "groups");
    const body = groups?.body.toLowerCase() ?? "";
    expect(body).toContain("directory");
    expect(body).toContain("profile");
    expect(body).toContain("my groups");
  });
  it("never claims matching, messaging, or calendar sync as available", () => {
    const body = TOUR_STEPS.map((s) => s.body).join(" ");
    for (const claim of ["matching", "messaging", "calendar sync", "calendar synchronization"]) {
      if (body.toLowerCase().includes(claim)) {
        // The only legitimate mentions are explicit "not available yet" notes.
        expect(body.toLowerCase()).toMatch(/not available yet|on the roadmap/);
      }
    }
    expect(body).toMatch(/not available yet/);
    expect(body).not.toMatch(/match with/i);
    expect(body).not.toMatch(/send messages/i);
  });
});

describe("tour replay", () => {
  it("clears the seen marker and dispatches the replay event", () => {
    // Node test env has no window; install a minimal one so the custom-event
    // wiring in requestTourReplay is exercised for real.
    const listeners = new Map<string, () => void>();
    const fakeWindow = {
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
      dispatchEvent: (e: { type: string }) => {
        listeners.get(e.type)?.();
        return true;
      },
    };
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window: unknown }).window = fakeWindow;
    try {
      const s = memoryStorage();
      markTourSeen(s);
      let seenEvent = false;
      fakeWindow.addEventListener(TOUR_REPLAY_EVENT, () => {
        seenEvent = true;
      });
      requestTourReplay(s);
      expect(readTourSeen(s)).toBe(false);
      expect(seenEvent).toBe(true);
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window: unknown }).window = originalWindow;
    }
  });
});
