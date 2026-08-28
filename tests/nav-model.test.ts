import { describe, expect, it } from "vitest";
import { NAV_ENTRIES, entriesForSurface, activeForPath, NO_NAV_PATHS } from "../src/lib/nav";

describe("single nav model (src/lib/nav.ts)", () => {
  it("defines all entries in canonical order", () => {
    expect(NAV_ENTRIES.map((e) => e.id)).toEqual([
      "events", "races", "routes", "forum", "groups", "connections", "messages", "my-runs", "profile", "settings", "submissions",
    ]);
    for (const e of NAV_ENTRIES) {
      expect(typeof e.route).toBe("string");
      expect(typeof e.label).toBe("string");
      expect(typeof e.icon).toBe("string");
      expect(e.surfaces.length).toBeGreaterThan(0);
    }
  });
  it("keeps the bottom bar at exactly six tabs (Messages added since this constraint was first written), in the current order", () => {
    expect(entriesForSurface("bottom").map((e) => e.id)).toEqual([
      "events", "races", "forum", "connections", "messages", "my-runs",
    ]);
  });
  it("keeps Settings out of the bottom bar, in sidebar + account menu only", () => {
    expect(entriesForSurface("bottom").find((e) => e.id === "settings")).toBeUndefined();
    const settings = NAV_ENTRIES.find((e) => e.id === "settings")!;
    expect(settings.surfaces).toEqual(["sidebar", "menu"]);
  });
  it("keeps the My submissions entry in the account-menu surface only (no bottom/sidebar)", () => {
    expect(entriesForSurface("bottom").find((e) => e.id === "submissions")).toBeUndefined();
    expect(entriesForSurface("sidebar").find((e) => e.id === "submissions")).toBeUndefined();
    const submissions = NAV_ENTRIES.find((e) => e.id === "submissions")!;
    expect(submissions.label).toBe("My submissions");
    expect(submissions.route).toBe("/profile?section=submissions");
    expect(submissions.icon).toBe("document");
    expect(submissions.surfaces).toEqual(["menu"]);
  });
  it("matches Events on / exactly and on /events* detail routes", () => {
    const events = NAV_ENTRIES.find((e) => e.id === "events")!;
    expect(activeForPath(events, "/")).toBe(true);
    expect(activeForPath(events, "/events")).toBe(true);
    expect(activeForPath(events, "/events/some-run")).toBe(true);
    expect(activeForPath(events, "/races")).toBe(false);
    expect(activeForPath(events, "/events-archive")).toBe(false);
  });
  it("matches prefix entries on their nested detail routes", () => {
    const groups = NAV_ENTRIES.find((e) => e.id === "groups")!;
    expect(activeForPath(groups, "/groups")).toBe(true);
    expect(activeForPath(groups, "/groups/runcomo")).toBe(true);
    expect(activeForPath(groups, "/group")).toBe(false);
    const myRuns = NAV_ENTRIES.find((e) => e.id === "my-runs")!;
    expect(activeForPath(myRuns, "/my-runs")).toBe(true);
    expect(activeForPath(myRuns, "/my-runs/anything")).toBe(true);
  });
  it("highlights Profile on /profile AND /runners public profiles", () => {
    const profile = NAV_ENTRIES.find((e) => e.id === "profile")!;
    expect(activeForPath(profile, "/profile")).toBe(true);
    expect(activeForPath(profile, "/runners/abc123")).toBe(true);
    expect(activeForPath(profile, "/settings")).toBe(false);
    expect(activeForPath(profile, "/runners-news")).toBe(false);
  });
  it("exposes the chrome-free wizard paths for the shell AND the sidebar", () => {
    const paths = ["/verify", "/admin", "/login", "/recovery", "/confirmation", "/callback", "/checkin"];
    for (const p of paths) {
      expect(NO_NAV_PATHS.has(p), p).toBe(true);
    }
  });
});
