import { describe, expect, it } from "vitest";
import { NAV_ENTRIES, entriesForSurface, activeForPath, NO_NAV_PATHS } from "../src/lib/nav";

describe("single nav model (src/lib/nav.ts)", () => {
  it("defines all entries in canonical order", () => {
    // Derived from the feature registry now, so this asserts the registry's
    // declaration order — the five-tab structure Home / Events / Groups /
    // Training / You, plus the sidebar-and-menu-only entries.
    expect(NAV_ENTRIES.map((e) => e.id)).toEqual([
      "home", "events", "races", "routes", "groups", "forum", "training",
      "profile", "my-runs", "connections", "messages", "settings", "admin", "login",
    ]);
    for (const e of NAV_ENTRIES) {
      expect(typeof e.route).toBe("string");
      expect(typeof e.label).toBe("string");
      expect(typeof e.icon).toBe("string");
      expect(e.surfaces.length).toBeGreaterThan(0);
    }
  });
  it("keeps the bottom bar at EXACTLY FIVE tabs, in the D1 order", () => {
    // Five is the constraint, not an observation. A sixth tab means something
    // comes out — the original version of this test was right about the number
    // even while being stale about the contents.
    expect(entriesForSurface("bottom").map((e) => e.id)).toEqual([
      "home", "events", "groups", "training", "profile",
    ]);
    expect(entriesForSurface("bottom")).toHaveLength(5);
  });
  it("keeps Settings out of the bottom bar, in sidebar + account menu only", () => {
    expect(entriesForSurface("bottom").find((e) => e.id === "settings")).toBeUndefined();
    const settings = NAV_ENTRIES.find((e) => e.id === "settings")!;
    expect(settings.surfaces).toEqual(["sidebar", "menu"]);
  });
  it("no longer carries a submissions NAV entry — it is a child route of profile", () => {
    // Was /profile?section=submissions in the menu. It now has a real route
    // (/submissions) reached from the profile page, because the registry does
    // not model query strings and dropping the destination to satisfy that
    // would have been the wrong direction.
    expect(NAV_ENTRIES.find((e) => e.id === "submissions")).toBeUndefined();
  });
  it("matches Events on /events and its detail routes — NOT on /", () => {
    // This test previously asserted activeForPath(events, "/") === true, which
    // encoded the bug: it was correct before 1.2, when "/" rendered the board.
    // A test can outlive the routing it describes exactly as an exception can.
    const events = NAV_ENTRIES.find((e) => e.id === "events")!;
    expect(activeForPath(events, "/")).toBe(false);
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

describe("exactly one bottom-bar entry is active for any path", () => {
  /*
   * A CLASS, not an instance.
   *
   * The instance: Events carried a hardcoded `pathname === "/"` clause from
   * when "/" rendered the board. 1.2 replaced "/" with Home and the exception
   * survived, so Home lit up two tabs at once.
   *
   * The class: any per-entry exception can outlive the routing it described,
   * and nothing was checking. The profile exception two lines below was the
   * same shape waiting to rot. This asserts the invariant instead of the case.
   */
  const bottom = entriesForSurface("bottom");

  const PATHS = [
    "/", "/events", "/events/tuesday-tempo", "/events/manage",
    "/groups", "/groups/ctc", "/groups/ctc/roster",
    "/training-plan", "/training-summary", "/shoes", "/pace-calculator",
    "/profile", "/runners/abc", "/my-runs", "/connections", "/messages",
    "/races", "/routes", "/routes/mkt", "/forum", "/settings", "/notifications",
  ];

  it("never highlights two tabs at once", () => {
    const clashes: string[] = [];
    for (const path of PATHS) {
      const active = bottom.filter((e) => activeForPath(e, path)).map((e) => e.id);
      if (active.length > 1) clashes.push(`${path} -> ${active.join(" + ")}`);
    }
    expect(clashes).toEqual([]);
  });

  it("highlights Home on / and nothing else", () => {
    // The reported bug, kept as a named case because it is the one a user saw.
    const active = bottom.filter((e) => activeForPath(e, "/")).map((e) => e.id);
    expect(active).toEqual(["home"]);
  });

  it("highlights Events on /events and its detail routes, never on /", () => {
    expect(bottom.filter((e) => activeForPath(e, "/events")).map((e) => e.id)).toEqual(["events"]);
    expect(bottom.filter((e) => activeForPath(e, "/events/tuesday-tempo")).map((e) => e.id)).toEqual(["events"]);
  });

  it("keeps the public-profile rule working", () => {
    // /runners/:id is a profile view and should keep You lit.
    expect(bottom.filter((e) => activeForPath(e, "/runners/abc")).map((e) => e.id)).toEqual(["profile"]);
  });
});
