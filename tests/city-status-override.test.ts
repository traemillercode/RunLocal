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

describe("open and requiresInvite are different questions", () => {
  /*
   * I had these collapsed into one, and the flip exposed it: a city switched to
   * invite_only still reported open:true, so every CTA gated on it stayed
   * visible and the flip changed nothing anyone could see.
   *
   *   open           — can THIS signup proceed? An invited person on an
   *                    invite_only city: YES. LoginPage uses this before
   *                    creating a Supabase user, to avoid orphaning one.
   *   requiresInvite — can a STRANGER sign up? On invite_only: NO. The header
   *                    and marketing CTAs use this.
   *
   * Collapsing them breaks one of the two, and which one depends on which
   * answer you pick.
   */
  const SERVER = readFileSync(new URL("../src/server/api.ts", import.meta.url).pathname, "utf8");
  const LOGIN = readFileSync(new URL("../src/pages/LoginPage.tsx", import.meta.url).pathname, "utf8");
  const MKT = readFileSync(new URL("../src/pages/MarketingPage.tsx", import.meta.url).pathname, "utf8");
  const HDR = readFileSync(new URL("../src/components/Header.tsx", import.meta.url).pathname, "utf8");

  it("invite_only reports open:true with requiresInvite:true", () => {
    expect(SERVER).toContain("return ok(res, { open: true, requiresInvite: true }), true;");
  });

  it("the marketing page and header hide on requiresInvite", () => {
    for (const [name, src] of [["marketing", MKT], ["header", HDR]] as const) {
      expect(src, name).toContain("r.data.open && !r.data.requiresInvite");
    }
  });

  it("the LoginPage pre-check does NOT — an invited person must not be blocked", () => {
    /*
     * The half that would break if this were gated the same way. The pre-check
     * exists to stop a refused signup orphaning a Supabase user; blocking an
     * INVITED person there would make every invite link dead on arrival.
     */
    const at = LOGIN.indexOf("api.getSignupStatus(");
    const check = LOGIN.slice(at, at + 320);
    expect(check).toContain("!status.data.open");
    expect(check).not.toContain("requiresInvite");
  });
});
