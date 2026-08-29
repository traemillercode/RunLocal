/**
 * The invite gate's cohort cap.
 *
 * The gate itself already existed — validateInvitation() fires when a city is
 * invite_only. What was missing was a cap, so a shared invite link could have
 * produced an eleventh account, and the system trusted the operator to stop
 * rather than refusing.
 */
import { describe, expect, it } from "vitest";
import { betaRedemptionCap, redemptionCount, betaCapReached } from "../src/server/invitations";
import { createMemoryStore, type Db } from "../src/server/store";
import { readCode, codeIndexOf, codeCount } from "./helpers/source";

function invitation(db: Db, id: string, used: boolean) {
  db.appendInvitation({
    id, cityId: "columbia-mo", email: `${id}@example.com`,
    tokenHash: "x", salt: "y",
    createdAt: new Date().toISOString(), createdByAccountId: "owner",
    expiresAt: new Date(Date.now() + 864e5).toISOString(),
    usedAt: used ? new Date().toISOString() : null,
    usedByAccountId: used ? `acc-${id}` : null,
    revokedAt: null,
  } as never);
}

describe("the cap counts REDEMPTIONS, not accounts", () => {
  it("pre-existing accounts consume no slots", () => {
    const db = createMemoryStore();
    // Nine accounts already exist from before the gate. If the cap counted
    // accounts it would be blown before the first invitee arrived.
    for (let i = 0; i < 9; i++) {
      db.createAccount({ name: `Legacy ${i}`, email: `legacy${i}@example.com`, cityId: "columbia-mo" });
    }
    expect(redemptionCount(db)).toBe(0);
    expect(betaCapReached(db, { BETA_REDEMPTION_CAP: "10" } as never)).toBe(false);
  });

  it("counts only invitations that were actually redeemed", () => {
    const db = createMemoryStore();
    invitation(db, "used-1", true);
    invitation(db, "used-2", true);
    invitation(db, "unused-1", false); // sent, not yet accepted
    expect(redemptionCount(db)).toBe(2);
  });

  it("refuses at the cap, not before", () => {
    const db = createMemoryStore();
    const env = { BETA_REDEMPTION_CAP: "3" } as never;
    invitation(db, "a", true);
    invitation(db, "b", true);
    expect(betaCapReached(db, env)).toBe(false); // 2 of 3 — still open
    invitation(db, "c", true);
    expect(betaCapReached(db, env)).toBe(true); // 3 of 3 — full
  });
});

describe("the cap is configurable, not hardcoded", () => {
  it("reads an env var so raising it does not require a deploy", () => {
    // Same defect shape as SPONSOR_DAY_RATE_USD: a number the business decides
    // should not need shipping software to change.
    expect(betaRedemptionCap({ BETA_REDEMPTION_CAP: "25" } as never)).toBe(25);
  });

  it("unset or invalid means NO cap, never a restrictive default", () => {
    // A cap defaulting to something small would silently close signup the
    // first time the variable failed to load — failing closed on a config
    // error is worse than failing open, because the gate is the real control.
    for (const env of [{}, { BETA_REDEMPTION_CAP: "" }, { BETA_REDEMPTION_CAP: "abc" }, { BETA_REDEMPTION_CAP: "-5" }, { BETA_REDEMPTION_CAP: "0" }]) {
      expect(betaRedemptionCap(env as never)).toBe(0);
      expect(betaCapReached(createMemoryStore(), env as never)).toBe(false);
    }
  });
});

describe("the gate applies to SIGN-UP only, never SIGN-IN", () => {
  it("signInWithPassword contains no invitation or cap check", async () => {
    /*
     * "Structurally impossible, not merely avoided."
     *
     * Gating sign-in would lock every existing user — including the owner —
     * out of a running beta the moment the cohort filled. This asserts the
     * sign-in path has no notion of invitations at all, so the failure cannot
     * be introduced by someone adding a check to the wrong function.
     */
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/lib/supabase.ts", import.meta.url).pathname, "utf8");
    const start = src.indexOf("export async function signInWithPassword");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\nexport ", start + 10);
    const signIn = src.slice(start, end === -1 ? undefined : end);
    for (const token of ["invitation", "invitationToken", "betaCap", "beta_full"]) {
      expect(signIn.toLowerCase()).not.toContain(token.toLowerCase());
    }
  });

  it("the server enforces the cap on account creation, not on session creation", async () => {
    // Appears twice by design: the /api/signup-status pre-check and the
    // /api/accounts refusal. Both are signup paths. What matters is that
    // neither is a session route.
    const code = readCode(new URL("../src/server/api.ts", import.meta.url));
    expect(codeCount(code, "betaCapReached(")).toBe(2);
    const statusAt = codeIndexOf(code, 'url.pathname === "/api/signup-status"');
    const accountsAt = codeIndexOf(code, 'url.pathname === "/api/accounts"');
    expect(statusAt).toBeGreaterThan(-1);
    expect(accountsAt).toBeGreaterThan(-1);
    // No cap check anywhere near a session/login handler.
    for (const sessionRoute of ['"/api/sessions"', '"/api/login"']) {
      const at = codeIndexOf(code, sessionRoute);
      if (at === -1) continue;
      expect(code.slice(at, at + 900)).not.toContain("betaCapReached");
    }
  });
});

describe("the owner is never locked out", () => {
  it("the cap check exempts the owner email", async () => {
    // Filling the cohort must not stop the owner testing the signed-out signup
    // flow — the class of problem discovered at the worst possible moment.
    const code = readCode(new URL("../src/server/api.ts", import.meta.url));
    expect(code).toContain("!isOwnerEmail(email) && betaCapReached(db)");
  });
});

describe("the eleventh person gets copy, not an error code", () => {
  it("the refusal message is human and says what happens next", async () => {
    const { BETA_FULL_MESSAGE: msg } = await import("../src/server/invitations");
    expect(msg.length).toBeGreaterThan(40);
    expect(msg.toLowerCase()).toContain("closed beta");
    // Must not read as the user's fault — they did nothing wrong.
    for (const blame of ["invalid", "not allowed", "denied", "forbidden"]) {
      expect(msg.toLowerCase()).not.toContain(blame);
    }
  });
});

describe("a minted invite consumes no slot until it is redeemed", () => {
  it("twelve minted, none redeemed — signup still open", () => {
    // The failure this rules out: if the cap counted CREATED invitations,
    // minting twelve links would refuse the twelfth person before anyone had
    // signed up at all.
    const db = createMemoryStore();
    for (let i = 0; i < 12; i++) invitation(db, `minted-${i}`, false);
    expect(redemptionCount(db)).toBe(0);
    expect(betaCapReached(db, { BETA_REDEMPTION_CAP: "12" } as never)).toBe(false);
  });

  it("the count moves only when usedAt is set", () => {
    const db = createMemoryStore();
    invitation(db, "pending", false);
    expect(redemptionCount(db)).toBe(0);
    // Redemption is what sets usedAt — see redeemInvitation().
    db.updateInvitation("pending", { usedAt: new Date().toISOString(), usedByAccountId: "acc-1" });
    expect(redemptionCount(db)).toBe(1);
  });

  it("a revoked-but-used invitation still counts, since the account exists", () => {
    // Revoking after redemption does not un-create the account, so the slot
    // stays consumed. Otherwise revoking would silently reopen a slot while
    // the person remains in the beta.
    const db = createMemoryStore();
    invitation(db, "used-then-revoked", true);
    db.updateInvitation("used-then-revoked", { revokedAt: new Date().toISOString() });
    expect(redemptionCount(db)).toBe(1);
  });
});

describe("a refused signup leaves nothing behind", () => {
  it("the cap check precedes every account write in the handler", async () => {
    const code = readCode(new URL("../src/server/api.ts", import.meta.url));
    const route = codeIndexOf(code, 'url.pathname === "/api/accounts"');
    const cap = codeIndexOf(code, "betaCapReached(db)", route);
    const write = codeIndexOf(code, "db.createAccount(", route);
    expect(cap).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(cap).toBeLessThan(write);
  });

  it("the client asks before creating a Supabase user", async () => {
    /*
     * The orphan the server ordering cannot prevent: LoginPage calls
     * supabase.signUp() first, which creates an auth user and sends a
     * confirmation email, and only then hits the capped endpoint. A refused
     * twelfth person would be left with a Supabase identity, a confirmation
     * email for an account that never exists, and a rejection — cleanup by hand.
     */
    // Comments stripped: the first "supabase.signUp(" in this file is in its
    // docblock, and matching that reported the call at character 118 — before
    // the imports. Third time a guard has read prose about code as code.
    const src = readCode(new URL("../src/pages/LoginPage.tsx", import.meta.url));
    const check = codeIndexOf(src, "api.getSignupStatus(");
    const create = codeIndexOf(src, "supabase.signUp(");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(create);
  });

  it("the pre-check and the refusal share one message, so they cannot drift", async () => {
    const code = readCode(new URL("../src/server/api.ts", import.meta.url));
    expect(codeCount(code, "BETA_FULL_MESSAGE")).toBeGreaterThanOrEqual(2);
    expect(code).not.toContain("this week's spots are taken");
  });
});
