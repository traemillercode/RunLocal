/**
 * The client half of the invite chain.
 *
 * THE BLOCKER THIS CLOSES: the server has validated body.invitationToken since
 * the gate was written, but createAccount had no such field and no client code
 * referenced it. Flipping a city to invite_only would therefore have closed
 * signup to EVERYONE — invited or not — with a correct, complete, unreachable
 * gate on the other side. Same shape as the icon guard that could not see most
 * buttons: the mechanism was right and nothing could reach it.
 */
import { describe, expect, it } from "vitest";
import { readCode, codeIndexOf } from "./helpers/source";
import { invitationUrl } from "../src/lib/api";

const API = readCode(new URL("../src/lib/api.ts", import.meta.url));
const LOGIN = readCode(new URL("../src/pages/LoginPage.tsx", import.meta.url));
const ANALYTICS = readCode(new URL("../src/lib/analytics.ts", import.meta.url));

describe("the token can actually reach the server", () => {
  it("createAccount accepts invitationToken", () => {
    expect(API).toContain("invitationToken?: string");
  });

  it("LoginPage sends it on BOTH signup paths", () => {
    // Two call sites: email-confirmation-required and immediate-session. A
    // token sent on only one would fail for half of users depending on a
    // Supabase setting they cannot see.
    const sends = LOGIN.split("invitationToken: invite?.token").length - 1;
    expect(sends).toBe(2);
  });
});

describe("the token survives the journey", () => {
  it("is captured from the URL on mount, not read at submit time", () => {
    // The hero puts "Create your account" and "Browse public events" side by
    // side, so opening an invite link, browsing, and coming back is realistic.
    // Reading the URL at submit time would lose the token on that path.
    expect(LOGIN).toContain("captureInviteFromUrl()");
    expect(ANALYTICS).toContain("sessionStorage.setItem(INVITE_KEY");
  });

  it("is NOT consent-gated, unlike UTM", () => {
    // This is a credential required to complete the action, not analytics.
    // Losing it because someone declined cookies would be a dead end with no
    // visible cause.
    const capture = ANALYTICS.slice(codeIndexOf(ANALYTICS, "export function captureInviteFromUrl"));
    expect(capture.slice(0, 400)).not.toContain("getConsent");
  });

  it("uses sessionStorage, so a spent invite cannot linger on a shared device", () => {
    expect(ANALYTICS).toContain("sessionStorage.getItem(INVITE_KEY)");
    expect(ANALYTICS).not.toContain("localStorage.setItem(INVITE_KEY");
  });

  it("is cleared after a successful signup", () => {
    expect(LOGIN).toContain("clearStoredInvite()");
  });
});

describe("the email mismatch failure is removed, not explained", () => {
  it("the invite URL carries the email as well as the token", () => {
    // validateInvitation looks the record up by (cityId, email) and only then
    // compares the token hash — the token ALONE cannot find the invitation.
    const url = invitationUrl("Runner@Example.com", "tok_abc");
    expect(url).toContain("invite=tok_abc");
    expect(url).toContain(encodeURIComponent("Runner@Example.com"));
    expect(url).toContain("mode=signup");
  });

  it("prefills and locks the email field when invited", () => {
    // Invitations are email-bound, so a changed address produces a rejection
    // the person cannot diagnose — they were sent a link and it "didn't work".
    expect(LOGIN).toContain("setEmail(stored.email)");
    expect(LOGIN).toContain("readOnly={Boolean(invite)}");
  });

  it("uses readOnly rather than disabled, so the value still submits", () => {
    // A disabled input is omitted from submission and skipped by some screen
    // readers — it would break the very flow it is protecting.
    expect(LOGIN).not.toContain("disabled={Boolean(invite)}");
  });
});

describe("minting surfaces the token exactly once", () => {
  const PANEL = readCode(new URL("../src/components/InvitationsAdminSection.tsx", import.meta.url));

  it("says the link cannot be shown again", () => {
    // The server stores only a hash. Navigating away before copying means
    // re-minting, which should be stated rather than discovered.
    expect(PANEL).toContain("can&apos;t be shown again");
  });

  it("renders the URL in a selectable field, not as plain text", () => {
    // navigator.clipboard can be blocked; the field is the fallback.
    expect(PANEL).toContain("onFocus={(e) => e.currentTarget.select()}");
  });

  it("sends no email", () => {
    // Deliberate: a confirmation mail already hit one junk folder and two .edu
    // addresses that never confirmed. A text the operator can see delivered
    // beats an email they cannot.
    for (const t of ["sendEmail", "resend", "Resend"]) expect(PANEL).not.toContain(t);
  });

  it("offers revoke only where it can do something", () => {
    // A used invitation cannot be un-redeemed; offering the button would be a
    // control that looks like it works.
    expect(PANEL).toContain("{i.valid && !i.usedAt ?");
  });
});
