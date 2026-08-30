/**
 * Suspension has to mean removal, not a label.
 *
 * It wrote `suspended: true` and changed nothing else: requireSession returned
 * a valid session for a suspended account, and exactly ONE of 137 endpoints
 * consulted the flag afterwards. So a suspended person kept RSVPing, messaging,
 * posting and joining groups.
 *
 * The hard version was chosen deliberately. For a beta where the reason to
 * suspend is that someone made another runner unsafe, READ access is the access
 * that matters — it tells you where people will be on Saturday. "Suspended but
 * can read" also needs a definition of read, and every new surface reopens it.
 */
import { describe, expect, it } from "vitest";
import { isCurrentlySuspended } from "../src/server/api";
import { readCode } from "./helpers/source";

const API = readCode(new URL("../src/server/api.ts", import.meta.url));
const DASH = readCode(new URL("../src/server/dashboard.ts", import.meta.url));

describe("enforcement is at the cookie, not inside requireSession", () => {
  /*
   * I put the check in requireSession first — it LOOKED like the right
   * chokepoint and was wrong. It collapses "suspended" into "not signed in",
   * so every endpoint that already returned a specific 403 with a reason
   * started returning a bare 401. Six test files caught it: the endpoints were
   * more informative than the chokepoint meant to replace them.
   *
   * A suspended person has no valid cookie because suspend deletes the session
   * and sign-in refuses to issue another — same outcome, without discarding
   * errors that were already better.
   */
  it("requireSession does not swallow suspension into a 401", () => {
    const fn = API.slice(API.indexOf("function requireSession"), API.indexOf("export function isCurrentlySuspended"));
    expect(fn).not.toContain("isCurrentlySuspended(account)");
  });
});

describe("a suspension expires on its own", () => {
  it("is in force with no end date", () => {
    expect(isCurrentlySuspended({ suspended: true, suspendedUntil: null })).toBe(true);
  });

  it("is in force before the end date", () => {
    const tomorrow = new Date(Date.now() + 864e5).toISOString();
    expect(isCurrentlySuspended({ suspended: true, suspendedUntil: tomorrow })).toBe(true);
  });

  it("LIFTS once the end date passes, with no admin action", () => {
    // A timed suspension that required someone to remember to lift it would
    // quietly become permanent.
    const yesterday = new Date(Date.now() - 864e5).toISOString();
    expect(isCurrentlySuspended({ suspended: true, suspendedUntil: yesterday })).toBe(false);
  });

  it("an unsuspended account is never suspended", () => {
    expect(isCurrentlySuspended({ suspended: false, suspendedUntil: null })).toBe(false);
    expect(isCurrentlySuspended({})).toBe(false);
  });
});

describe("suspending removes access immediately", () => {
  it("clears live sessions", () => {
    /*
     * Without this, suspension takes effect whenever the cookie happens to
     * expire. deleteSessionsForAccount already existed and was used in three
     * other places; the suspend handler was not one of them.
     */
    const fn = DASH.slice(DASH.indexOf("suspended: true"), DASH.indexOf("suspended: true") + 1400);
    expect(fn).toContain("db.deleteSessionsForAccount(accountId)");
  });

  it("refuses a fresh sign-in rather than issuing a new cookie", () => {
    // Otherwise clearing the session accomplishes nothing — they sign in again.
    const at = API.indexOf("isCurrentlySuspended(rec, now)");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(API.indexOf("db.createSession(rec.id, ip, now)", at));
  });

  it("tells them why, with a way to appeal", () => {
    /*
     * A generic failure is worse than the truth: they assume a bug and keep
     * trying, and the person the suspension protects is not served by that.
     */
    const at = API.indexOf('error: "suspended"');
    const block = API.slice(at, at + 700);
    expect(block).toContain("suspended");
    expect(block).toContain("hello@getkimbio.com");
    expect(block).toContain("suspendedUntil"); // names the end date when there is one
  });
});

describe("unsuspend restores fully", () => {
  it("clears every field suspension set", () => {
    // A one-way door is a control nobody uses, and a control nobody uses is
    // worse than none.
    expect(DASH).toContain("{ suspended: false, suspendedUntil: null, suspensionReason: null");
  });
});

describe("suspension does not touch invitations or Supabase", () => {
  it("leaves the redeemed invitation redeemed", () => {
    /*
     * Otherwise suspending someone frees a cohort slot and the cap drifts
     * upward every time. Asserted by absence: the suspend path must not mention
     * invitations at all.
     */
    const fn = DASH.slice(DASH.indexOf("suspended: true"), DASH.indexOf("suspended: true") + 1400);
    expect(fn.toLowerCase()).not.toContain("invitation");
  });

  it("never deletes a Supabase auth user", () => {
    // Suspension is a Kimbio-side status. The account stays recoverable and the
    // audit trail intact.
    expect(DASH.toLowerCase()).not.toContain("deleteuser");
    expect(DASH.toLowerCase()).not.toContain("auth.users");
  });
});
