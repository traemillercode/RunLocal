/**
 * The city status control, and the error handling that hid why it failed.
 *
 * SIXTH instance of a complete server capability with no working client path —
 * except this time the client path existed and was fed the wrong data.
 */
import { describe, expect, it } from "vitest";
import { readCode } from "./helpers/source";

const SERVER = readCode(new URL("../src/server/api.ts", import.meta.url));
const CLIENT = readCode(new URL("../src/lib/api.ts", import.meta.url));
const CONTROL = readCode(new URL("../src/components/CityStatusAdminSection.tsx", import.meta.url));

describe("the admin overview can see the city it is meant to control", () => {
  it("merges SEED cities, not just stored ones", () => {
    /*
     * THE ACTUAL BUG. The overview returned db.listCities(), which is
     * store-only — and every city is a seed until someone edits it. So Columbia
     * was absent entirely: the control rendered nothing for the one city that
     * exists, and the only way to get a city into the store was to edit it
     * through a control that could not see it.
     *
     * Nothing about this looked like a client bug from the server side, and
     * nothing looked like a server bug from the client side.
     */
    const at = SERVER.indexOf('url.pathname === "/api/admin/cms/settings"');
    // Window wide enough to clear the explanatory comment between the route
    // marker and the call.
    const handler = SERVER.slice(at, at + 1200);
    expect(handler).toContain("publicCities(db)");
    expect(handler).not.toContain("cities:db.listCities()");
  });
});

describe("the control sends what saveCity requires", () => {
  it("includes name, state and slug, not just status", () => {
    // saveCity is a full upsert and returns invalid_city without all three.
    for (const field of ["name: city.name", "state: city.state", "slug: city.slug"]) {
      expect(CONTROL).toContain(field);
    }
  });

  it("sends a non-empty audit reason", () => {
    // An empty reason would 400 with reason_required and land in the same
    // catch-all — indistinguishable from a network failure until now.
    expect(CONTROL).toContain("`City status → ${pending.status}`");
  });

  it("offers every state in both directions", () => {
    /*
     * A one-way switch with a scary confirmation is worse than no switch: the
     * moment something is wrong after a flip, the person who needs to undo it
     * is the person who cannot.
     */
    for (const s of ["active", "invite_only", "coming_soon", "inactive"]) {
      expect(CONTROL).toContain(`${s}:`);
    }
    expect(CONTROL).toContain("disabled={value === city.status}");
  });
});

describe("the catch-all stops blaming the network", () => {
  it("only a genuine fetch rejection mentions the connection", () => {
    /*
     * Third fallback to hide a real status, after error codes reaching users
     * and the "hidden or archived" discussion copy — and the most misleading of
     * the three, because it sends someone to check their wifi while the actual
     * answer was a 400 with a reason attached.
     */
    const at = CLIENT.indexOf("const failedToFetch = e instanceof TypeError;");
    expect(at).toBeGreaterThan(-1);
    const branch = CLIENT.slice(at, at + 500);
    expect(branch).toContain("Check your connection");
    // The connection wording must appear ONCE in the catch, inside that branch.
    const catchBlock = CLIENT.slice(CLIENT.indexOf("} catch (e) {"), CLIENT.indexOf("function reportApiFailure"));
    expect((catchBlock.match(/Check your connection/g) ?? []).length).toBe(1);
  });

  it("a response that arrived reports its status instead", () => {
    const catchBlock = CLIENT.slice(CLIENT.indexOf("} catch (e) {"), CLIENT.indexOf("function reportApiFailure"));
    expect(catchBlock).toContain("unexpected_response");
    expect(catchBlock).toContain("unexpected error (${status})");
  });

  it("distinguishes the three cases rather than collapsing them", () => {
    const catchBlock = CLIENT.slice(CLIENT.indexOf("} catch (e) {"), CLIENT.indexOf("function reportApiFailure"));
    // no response / response with a status / neither
    expect(catchBlock).toContain("network_error");
    expect(catchBlock).toContain("status > 0");
  });
});

describe("writing a seed city into the store does not change it", () => {
  /*
   * Morgan's question, and the right one: saveCity is an upsert into the STORE,
   * and Columbia has only ever existed as a SEED. So the first status change
   * creates a store row for a city that previously had none — the same
   * seed/store split that caused this bug, on the other side of the operation.
   */
  it("produces a row identical to the seed-derived one, except status", async () => {
    const { createMemoryStore } = await import("../src/server/store");
    const { saveCity, publicCities } = await import("../src/server/cms");
    const { adminLogin, ADMIN_KEY_VAR } = await import("../src/server/admin");
    process.env[ADMIN_KEY_VAR] = "k";
    const db = createMemoryStore();
    const login = adminLogin(db, "k", "198.51.100.7");
    if (!login.ok) throw new Error("login failed");
    const ctx = { userSessionId: null, adminSessionId: login.data.sessionId, ip: "198.51.100.7", reason: "test" };

    const before = publicCities(db).find((c) => c.id === "columbia-mo")!;
    expect(before.status).toBe("active");

    const r = saveCity(db, ctx, { id: "columbia-mo", name: before.name, state: before.state, slug: before.slug, status: "invite_only" });
    expect(r.ok).toBe(true);

    const after = publicCities(db).find((c) => c.id === "columbia-mo")!;
    // Exactly one — the store row must REPLACE the seed row, not sit beside it.
    expect(publicCities(db).filter((c) => c.id === "columbia-mo")).toHaveLength(1);
    // Every field unchanged except the one that was changed.
    for (const k of ["id", "name", "state", "slug", "headerImageRef", "accent"] as const) {
      expect(after[k], k).toEqual(before[k]);
    }
    expect(after.status).toBe("invite_only");
  });

  it("cityStatus resolves the NEW status, so the gate actually moves", async () => {
    const { createMemoryStore } = await import("../src/server/store");
    const { saveCity, cityStatus } = await import("../src/server/cms");
    const { adminLogin, ADMIN_KEY_VAR } = await import("../src/server/admin");
    process.env[ADMIN_KEY_VAR] = "k";
    const db = createMemoryStore();
    const login = adminLogin(db, "k", "198.51.100.7");
    if (!login.ok) throw new Error("login failed");
    const ctx = { userSessionId: null, adminSessionId: login.data.sessionId, ip: "198.51.100.7", reason: "test" };

    expect(cityStatus(db, "columbia-mo")).toBe("active");
    saveCity(db, ctx, { id: "columbia-mo", name: "Columbia", state: "MO", slug: "columbia-mo", status: "invite_only" });
    // cityStatus reads the store FIRST, then falls back to seed — so the write
    // has to win, or signup would stay open after the flip.
    expect(cityStatus(db, "columbia-mo")).toBe("invite_only");
  });

  it("and back again, so the flip is reversible in the same three clicks", async () => {
    const { createMemoryStore } = await import("../src/server/store");
    const { saveCity, cityStatus } = await import("../src/server/cms");
    const { adminLogin, ADMIN_KEY_VAR } = await import("../src/server/admin");
    process.env[ADMIN_KEY_VAR] = "k";
    const db = createMemoryStore();
    const login = adminLogin(db, "k", "198.51.100.7");
    if (!login.ok) throw new Error("login failed");
    const ctx = { userSessionId: null, adminSessionId: login.data.sessionId, ip: "198.51.100.7", reason: "test" };
    const city = { id: "columbia-mo", name: "Columbia", state: "MO", slug: "columbia-mo" };
    saveCity(db, ctx, { ...city, status: "invite_only" });
    saveCity(db, ctx, { ...city, status: "active" });
    expect(cityStatus(db, "columbia-mo")).toBe("active");
  });
});

describe("writing a seed city does not fork it", () => {
  /*
   * Morgan's question, and it is the same seed/store split that caused the read
   * bug, on the other side of the operation: saveCity is an upsert into the
   * STORE, and Columbia has only ever existed as a SEED. So the first save
   * creates a store row for a city that had none.
   *
   * The risk is a Columbia that behaves differently from the seeded one, or two
   * of it.
   */
  it("publicCities dedupes store over seed, so one save cannot produce two", async () => {
    const { createMemoryStore } = await import("../src/server/store");
    const { publicCities, saveCity } = await import("../src/server/cms");
    const { ADMIN_KEY_VAR, adminLogin } = await import("../src/server/admin");
    process.env[ADMIN_KEY_VAR] = "test-admin-key";

    const db = createMemoryStore();
    const before = publicCities(db).filter((c) => c.id === "columbia-mo");
    expect(before).toHaveLength(1);
    expect(before[0].status).toBe("active"); // from the seed

    const login = adminLogin(db, "test-admin-key", "198.51.100.7");
    if (!login.ok) throw new Error("login failed");
    const ctx = { userSessionId: null, adminSessionId: login.data.sessionId, ip: "198.51.100.7", reason: "flip" };
    const saved = saveCity(db, ctx, {
      id: "columbia-mo", name: before[0].name, state: before[0].state, slug: before[0].slug, status: "invite_only",
    });
    expect(saved.ok).toBe(true);

    // EXACTLY ONE columbia-mo afterwards — the store row shadows the seed
    // rather than joining it.
    const after = publicCities(db).filter((c) => c.id === "columbia-mo");
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe("invite_only");
    // Identity fields survive the round trip.
    expect(after[0].name).toBe(before[0].name);
    expect(after[0].slug).toBe(before[0].slug);
  });

  it("cityStatus resolves the NEW status, not the seed's", async () => {
    // The thing the whole flip depends on: signup reads cityStatus, and if it
    // kept returning the seed value the flip would appear to work and change
    // nothing.
    const { createMemoryStore } = await import("../src/server/store");
    const { cityStatus, saveCity, publicCities } = await import("../src/server/cms");
    const { ADMIN_KEY_VAR, adminLogin } = await import("../src/server/admin");
    process.env[ADMIN_KEY_VAR] = "test-admin-key";

    const db = createMemoryStore();
    expect(cityStatus(db, "columbia-mo")).toBe("active");
    const seed = publicCities(db).find((c) => c.id === "columbia-mo")!;
    const login = adminLogin(db, "test-admin-key", "198.51.100.7");
    if (!login.ok) throw new Error("login failed");
    saveCity(db, { userSessionId: null, adminSessionId: login.data.sessionId, ip: "1.1.1.1", reason: "flip" },
      { id: "columbia-mo", name: seed.name, state: seed.state, slug: seed.slug, status: "invite_only" });
    expect(cityStatus(db, "columbia-mo")).toBe("invite_only");

    // And back again — the flip must be reversible in the same three clicks.
    saveCity(db, { userSessionId: null, adminSessionId: login.data.sessionId, ip: "1.1.1.1", reason: "unflip" },
      { id: "columbia-mo", name: seed.name, state: seed.state, slug: seed.slug, status: "active" });
    expect(cityStatus(db, "columbia-mo")).toBe("active");
  });
});
