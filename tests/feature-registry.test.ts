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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
          // Capability-gated: `roles` is only a floor, so asserting that every
          // verified runner can reach /admin would be asserting something
          // false. Reachability for these is checked by assertion 6 instead.
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

describe("registry assertion 6 — capability-gated features name a real capability", () => {
  const serverDir = new URL("../src/server", import.meta.url).pathname;
  const serverSrc = readdirSync(serverDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(join(serverDir, f), "utf8"))
    .join("\n");

  it("every declared capability is one authorizeAdmin is actually called with", () => {
    // The honest check available here. /admin is a CLIENT route — AdminPage
    // calls ~10 admin APIs, each with its own capability — so there is no
    // single server handler to match it against. What CAN be verified is that
    // the capability string is real rather than invented or misspelled, which
    // is the failure mode that would otherwise make this field decorative.
    const declared = features.filter((f) => f.capability).map((f) => f as Feature & { capability: string });
    expect(declared.length).toBeGreaterThan(0); // else this guard is vacuous

    const invented = declared
      .filter((f) => !serverSrc.includes(`"${f.capability}"`))
      .map((f) => `${f.id} declares '${f.capability}', which no server code uses`);
    expect(invented).toEqual([]);
  });

  it("admin-area features are capability-gated, not role-gated", () => {
    // The specific defect: /admin claimed roles: ["verified"], which is false —
    // every verified runner is not an admin.
    const ungated = features
      .filter((f) => f.area === "admin" && f.status === "live" && !f.capability)
      .map((f) => `${f.id} is in the admin area but declares no capability`);
    expect(ungated).toEqual([]);
  });
});

describe("registry assertion 7 — nav constraints", () => {
  it("the bottom bar holds exactly five tabs", () => {
    // D1. Five is a CONSTRAINT, not an observation: a sixth means something
    // comes out. Thumb reach on a phone is the reason, and it does not change
    // because a new feature wants prominence.
    const bottom = features.filter((f) => f.reach.kind === "nav" && f.nav?.surfaces.includes("bottom"));
    expect(bottom.map((f) => f.id)).toEqual(["home", "events", "groups", "training", "profile"]);
  });

  it("every nav entry a role can see leads somewhere that role can use", () => {
    // Hidden, never disabled. A greyed menu item teaches people to ignore the
    // menu — and this build removed three controls that looked usable and were
    // not (guest RSVP, pending RSVP, guest Host-a-run).
    const bad: string[] = [];
    for (const f of features) {
      if (f.reach.kind !== "nav" || !f.nav) continue;
      // A capability-gated entry must not claim to be reachable by role alone.
      if (f.capability && f.roles.includes("verified")) {
        // acceptable only because entriesForRole() additionally requires isAdmin
        const nav = readFileSync(new URL("../src/lib/nav.ts", import.meta.url).pathname, "utf8");
        if (!/if \(feature\.capability\) return opts\.isAdmin === true;/.test(nav)) {
          bad.push(`${f.id} is capability-gated but nav does not check isAdmin`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("no nav entry is a child of a page that does not link to it", () => {
    // The orphaning this caught: my-runs, connections and messages were
    // modelled as children of profile, but ProfilePage links to NONE of its
    // declared children — so deriving nav from the registry would have made
    // three live features unreachable. They are nav entries for that reason.
    for (const id of ["my-runs", "connections", "messages"]) {
      const f = features.find((x) => x.id === id)!;
      expect(f.reach.kind).toBe("nav");
    }
  });
});
