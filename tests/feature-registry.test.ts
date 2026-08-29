/**
 * THE FIVE REGISTRY ASSERTIONS.
 *
 * The registry is only worth having if reality cannot drift from it. These are
 * what convert findability from something audited occasionally into something
 * the build enforces — the failure that produced 24 orphaned routes, three
 * competing nav definitions, and a training hub reachable from exactly one
 * page and nowhere else.
 *
 * Assertion 5 is the one that matters most: it checks BOTH directions between
 * App.tsx and the registry, so neither can grow an entry the other lacks.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FEATURES, type Feature, type FeatureId } from "../src/lib/features";
import type { AccountRole } from "../src/lib/accounts";

const features = FEATURES as readonly Feature[];
const APP = readFileSync(new URL("../src/App.tsx", import.meta.url).pathname, "utf8");
const ROLES: readonly AccountRole[] = ["guest", "pending", "rejected", "verified"];

/** Route paths actually registered in App.tsx. */
function appRoutes(): string[] {
  return [...APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
}

describe("registry assertion 1 — every route in App.tsx has a registry entry", () => {
  it("no route exists that the registry does not know about", () => {
    // This is what prevents the next 24 orphans: a route added without an
    // entry has no declared reachability, so nobody has decided how a user
    // gets to it.
    const known = new Set(features.map((f) => f.route));
    const missing = appRoutes().filter((r) => !known.has(r));
    expect(missing).toEqual([]);
  });
});

describe("registry assertion 2 — child features have a real, reachable parent", () => {
  it("every child's parent exists", () => {
    const ids = new Set(features.map((f) => f.id));
    const broken = features
      .filter((f): f is Feature & { reach: { kind: "child"; parent: FeatureId } } => f.reach.kind === "child")
      .filter((f) => !ids.has(f.reach.parent))
      .map((f) => `${f.id} -> missing parent ${f.reach.parent}`);
    expect(broken).toEqual([]);
  });

  it("no child hangs off an orphaned parent", () => {
    // Catches the subtle case: a detail page whose parent got orphaned is
    // itself unreachable, but its own entry still claims otherwise.
    const byId = new Map(features.map((f) => [f.id, f]));
    const stranded: string[] = [];
    for (const f of features) {
      if (f.reach.kind !== "child") continue;
      // Walk up until nav/flow, or fail on an orphan or a cycle.
      const seen = new Set<string>([f.id]);
      let cur = byId.get(f.reach.parent);
      while (cur) {
        if (seen.has(cur.id)) { stranded.push(`${f.id} -> parent cycle at ${cur.id}`); break; }
        seen.add(cur.id);
        if (cur.reach.kind === "orphan") { stranded.push(`${f.id} -> reachable only via orphaned ${cur.id}`); break; }
        if (cur.reach.kind !== "child") break; // reached nav or flow — fine
        cur = byId.get(cur.reach.parent);
      }
    }
    expect(stranded).toEqual([]);
  });
});

describe("registry assertion 3 — orphans are decisions, not accidents", () => {
  it("every orphan states a reason", () => {
    const unexplained = features
      .filter((f): f is Feature & { reach: { kind: "orphan"; reason: string } } => f.reach.kind === "orphan")
      .filter((f) => f.reach.reason.trim().length < 20)
      .map((f) => f.id);
    expect(unexplained).toEqual([]);
  });
});

describe("registry assertion 4 — every live feature is reachable by every role that can use it", () => {
  it("no role can reach a feature's parent chain but not the feature, and no live feature is unreachable", () => {
    const byId = new Map(features.map((f) => [f.id, f]));
    const unreachable: string[] = [];

    for (const f of features) {
      if (f.status !== "live" || f.reach.kind === "orphan") continue;

      for (const role of ROLES) {
        if (!f.roles.includes(role)) continue;

        if (f.reach.kind === "nav") {
          // A nav feature must actually declare a nav surface, or it claims a
          // path it does not have.
          if (!f.nav || f.nav.surfaces.length === 0) unreachable.push(`${f.id}: reach=nav but no nav surfaces`);
          continue;
        }
        if (f.reach.kind === "flow") continue; // entered by redirect, never linked

        // child: every ancestor must also admit this role, or the role can see
        // the feature in the registry but has no way to walk to it.
        let cur: Feature | undefined = byId.get(f.reach.parent);
        while (cur) {
          if (!cur.roles.includes(role)) {
            unreachable.push(`${f.id}: role '${role}' allowed, but ancestor ${cur.id} is not`);
            break;
          }
          if (cur.reach.kind !== "child") break;
          cur = byId.get(cur.reach.parent);
        }
      }
    }
    expect(unreachable).toEqual([]);
  });
});

describe("registry assertion 5 — App.tsx and the registry agree in BOTH directions", () => {
  it("every registry route exists in App.tsx", () => {
    // The reverse of assertion 1. Without this, a route can be deleted while
    // its entry lingers, and the registry slowly becomes a description of a
    // product that no longer exists — the same rot as a stale test.
    const actual = new Set(appRoutes());
    const phantom = features.filter((f) => !actual.has(f.route)).map((f) => `${f.id} (${f.route})`);
    expect(phantom).toEqual([]);
  });

  it("ids and routes are unique", () => {
    const ids = features.map((f) => f.id);
    const routes = features.map((f) => f.route);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("nothing marked planned is described as live anywhere in the registry", () => {
    // Guards the inaccuracy the tour already has today: TOUR_STEPS says
    // messaging is unavailable, and messaging shipped.
    for (const f of features) {
      if (f.status === "planned") expect(f.reach.kind).not.toBe("nav");
    }
  });
});
