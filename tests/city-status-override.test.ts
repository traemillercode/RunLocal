/**
 * The temporary CITY_STATUS_OVERRIDE.
 *
 * The admin control is built and correct, and something between the click and
 * the network is eating the request. The beta has to close regardless, and
 * there is no shell into the container — so this closes it from an env var,
 * reversible from the Railway dashboard by anyone with access.
 *
 * It changes NOTHING in the store, so when the control starts working there is
 * no forked state to reconcile — just a variable to unset.
 */
import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { cityStatus, publicCities } from "../src/server/cms";
import { createMemoryStore } from "../src/server/store";

const ORIGINAL = process.env.CITY_STATUS_OVERRIDE;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CITY_STATUS_OVERRIDE;
  else process.env.CITY_STATUS_OVERRIDE = ORIGINAL;
});

describe("the override closes signup", () => {
  it("takes precedence over the seed", () => {
    const db = createMemoryStore();
    expect(cityStatus(db, "columbia-mo")).toBe("active"); // seed
    process.env.CITY_STATUS_OVERRIDE = "columbia-mo:invite_only";
    expect(cityStatus(db, "columbia-mo")).toBe("invite_only");
  });

  it("leaves other cities alone", () => {
    const db = createMemoryStore();
    process.env.CITY_STATUS_OVERRIDE = "columbia-mo:invite_only";
    expect(cityStatus(db, "kc-mo")).toBe("coming_soon");
  });

  it("ignores a status that is not real", () => {
    // A typo must fail closed to the real value rather than inventing a state.
    const db = createMemoryStore();
    process.env.CITY_STATUS_OVERRIDE = "columbia-mo:invite-only";
    expect(cityStatus(db, "columbia-mo")).toBe("active");
  });

  it("unsetting it restores the real status — the unflip", () => {
    const db = createMemoryStore();
    process.env.CITY_STATUS_OVERRIDE = "columbia-mo:invite_only";
    expect(cityStatus(db, "columbia-mo")).toBe("invite_only");
    delete process.env.CITY_STATUS_OVERRIDE;
    expect(cityStatus(db, "columbia-mo")).toBe("active");
  });
});

describe("admin and signup cannot disagree", () => {
  it("publicCities reports the override too", () => {
    /*
     * Otherwise /admin would show "Open" while signup was actually closed —
     * two sources disagreeing about one fact, which is precisely the seed/store
     * split that cost a day. No reason to rebuild it deliberately.
     */
    const db = createMemoryStore();
    process.env.CITY_STATUS_OVERRIDE = "columbia-mo:invite_only";
    const row = publicCities(db).find((c) => c.id === "columbia-mo")!;
    expect(row.status).toBe("invite_only");
    expect(cityStatus(db, "columbia-mo")).toBe(row.status);
  });
});

describe("it cannot quietly become permanent", () => {
  it("is documented as temporary, with the removal condition", () => {
    /*
     * THE REAL RISK. A city whose status comes from an env var will IGNORE the
     * control once the control works — which would look exactly like the
     * control being broken again, and would be diagnosed as such.
     */
    const src = readFileSync(new URL("../src/server/cms.ts", import.meta.url).pathname, "utf8");
    expect(src).toContain("TEMPORARY OVERRIDE — remove when the admin city-status control works");
    expect(src).toContain("just a variable to unset");
  });

  it("is unset by default, so tests and local runs see the real status", () => {
    // If this ever fails in CI, someone has baked the override into an
    // environment where it does not belong.
    const db = createMemoryStore();
    delete process.env.CITY_STATUS_OVERRIDE;
    expect(cityStatus(db, "columbia-mo")).toBe("active");
  });
});
