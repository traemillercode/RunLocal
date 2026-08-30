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
