/**
 * Email is currently the weakest link in the funnel, so the cheapest wins are
 * not sending mail we did not mean to, and giving people a way back when a
 * message never arrives.
 */
import { describe, expect, it } from "vitest";
import { readCode } from "./helpers/source";

const ADMIN = readCode(new URL("../src/server/admin.ts", import.meta.url));
const LOGIN = readCode(new URL("../src/pages/LoginPage.tsx", import.meta.url));

describe("the verified email fires once, on the transition", () => {
  it("does not re-send when the account is already verified", () => {
    /*
     * triggs@ received three "You're verified on Kimbio!" in seven seconds —
     * 19:45:38, :39 and :45 — which is what a double-clicked approve button or
     * a retried request produces. The send was gated on `status === "verified"`
     * with no check on the PRIOR status, so re-approving re-sent.
     *
     * Duplicate sends are not merely untidy. They damage sender reputation,
     * which worsens the inbox-placement problem currently costing us testers —
     * so the cheapest available fix for placement is not sending mail we did
     * not mean to send.
     */
    expect(ADMIN).toContain('const becameVerified = status === "verified" && rec.status !== "verified";');
    expect(ADMIN).toContain("if (becameVerified) {");
  });

  it("compares against the pre-update record, not the updated one", () => {
    // `updated` already has the new status, so comparing against it would
    // always be false and suppress the mail entirely — the opposite bug.
    const at = ADMIN.indexOf("const becameVerified");
    expect(at).toBeGreaterThan(-1);
    expect(ADMIN.slice(at, at + 140)).not.toContain("updated.status");
  });
});

describe("someone who never received the email has a way back", () => {
  it("the login form links to the resend page at all times", () => {
    /*
     * The resend existed in TWO places and both required having just acted:
     * immediately after signup, or after a failed sign-in. Someone who signed
     * up on Tuesday, never saw the email, and came back on Friday had nowhere
     * to go — that cost one tester eight days.
     *
     * /confirmation has had a working resend form the whole time and nothing
     * linked to it. Seventh instance of a capability with no path to it.
     */
    expect(LOGIN).toContain('to="/confirmation"');
    expect(LOGIN).toContain("Didn&apos;t get your confirmation email?");
  });

  it("still offers resend after a failed sign-in", () => {
    // The existing path, kept — it is the faster one when it applies.
    expect(LOGIN).toContain('if (r.code === "email_not_confirmed") setPendingConfirmationEmail(e);');
  });
});
