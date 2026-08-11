/**
 * Rejected-account UI semantics — Task 7 verification UX follow-up.
 *
 * A rejected account must NEVER render as pending: roleOf returns the
 * dedicated "rejected" role, the profile menu shows denied copy, the
 * VerifiedGateSheet shows the private reason with no "continue verification"
 * action, and the AccountMenu shows a red denied state.
 *
 * Node-environment render tests (no jsdom) — see runlocal-ui-tests-no-jsdom.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { roleOf } from "../src/lib/accounts";
import { profileMenuEntries } from "../src/lib/accountMenu";
import { VerifiedGateSheet } from "../src/components/VerifiedGateSheet";
import { AccountMenuContent } from "../src/components/AccountMenu";
import type { Me } from "../src/lib/accounts";

const REJECT_REASON = "Your selfie did not match your photo ID — please reapply with a clearer photo.";

const rejectedMe: Me = {
  status: "signed_in",
  account: {
    id: "r".repeat(32),
    name: "Rejected Runner",
    email: "rejected@example.com",
    username: null,
    cityId: "columbia-mo",
    status: "rejected",
    phase: null,
    badge: null,
    role: "runner",
    adminCityId: null,
    isOwner: false,
    suspended: false,
    underReview: false,
    trustedMember: false,
    rejectionReason: REJECT_REASON,
    profilePhotoUrl: null,
  },
};

describe("rejected-account UI semantics", () => {
  it("roleOf maps a rejected account to the dedicated 'rejected' role — never 'pending'", () => {
    expect(roleOf(rejectedMe)).toBe("rejected");
    expect(roleOf(rejectedMe)).not.toBe("pending");
  });

  it("profile menu entries show denied copy for rejected accounts", () => {
    const { entries } = profileMenuEntries(rejectedMe);
    const status = entries.find((e) => e.key === "status")!;
    expect(status.label).toContain("Verification status");
    expect(status.hint).toContain("Denied");
    expect(status.hint).not.toContain("Pending");
  });

  it("VerifiedGateSheet renders the private reason and NO continue-verification action for rejected", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <VerifiedGateSheet open onClose={() => {}} role="rejected" actionLabel="RSVP to runs" pendingLabel="still in review" rejectionReason={REJECT_REASON} />
      </MemoryRouter>,
    );
    expect(html).toContain("Verification denied");
    expect(html).toContain(REJECT_REASON);
    expect(html).toContain("View my verification status");
    expect(html).not.toContain("Continue verification");
    expect(html).not.toContain("still in review");
  });

  it("VerifiedGateSheet pending path is untouched (no denial copy, continue action present)", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <VerifiedGateSheet open onClose={() => {}} role="pending" actionLabel="RSVP to runs" pendingLabel="Your profile is still in review." />
      </MemoryRouter>,
    );
    expect(html).toContain("Continue verification");
    expect(html).not.toContain("Verification denied");
  });

  it("AccountMenu shows denied status with the private reason for rejected accounts", () => {
    const html = renderToStaticMarkup(<AccountMenuContent me={rejectedMe} backendAvailable onNavigate={() => {}} onLogout={() => {}} />);
    expect(html).toContain("Denied");
    expect(html).toContain(REJECT_REASON);
    expect(html).not.toContain("Pending");
  });
});
