/**
 * Forum verified-user gate regression.
 *
 * QA diagnosis: ForumPage.onReply unconditionally opened VerifiedGateSheet, so
 * verified members saw guest/pending "Create account / verification" lock copy
 * when tapping Reply or New, and VerifiedGateSheet had no verified branch
 * (verified fell through to the guest copy).
 *
 * Fix pinned here: verified members are past the gate, so Reply/New give them
 * honest "not open yet" feedback and never the gate sheet; guests, pending,
 * and rejected users keep the verified-profile gate (rejected keeps its
 * private reason + denial copy). Node-environment render tests (no jsdom) —
 * see runlocal-ui-tests-no-jsdom.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { VerifiedGateSheet } from "../src/components/VerifiedGateSheet";
import { ForumCreateSheetBody, ForumPage, replyIntent } from "../src/pages/ForumPage";
import { CITIES } from "../src/data/cities";
import type { AccountRole, Me, PublicAccount } from "../src/lib/accounts";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));
const { useSelectedCityMock } = vi.hoisted(() => ({ useSelectedCityMock: vi.fn() }));
vi.mock("../src/state/city", () => ({ useSelectedCity: useSelectedCityMock }));

const city = CITIES[0];

function account(patch: Partial<PublicAccount> = {}): PublicAccount {
  return {
    id: "acc_1",
    name: "Taylor Runner",
    email: "taylor@example.com",
    username: "taylor_runs",
    cityId: "columbia-mo",
    status: "verified",
    phase: null,
    badge: "verified",
    role: "runner",
    isOwner: false,
    suspended: false,
    underReview: false,
    profilePhotoUrl: null,
    ...patch,
  };
}

function auth(accountValue: PublicAccount | null, role: AccountRole) {
  const me: Me = accountValue ? { status: "signed_in", account: accountValue } : { status: "guest" };
  useAccountMock.mockReturnValue({
    me,
    backendAvailable: true,
    refresh: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    deleteMyAccount: vi.fn(async () => ({ ok: false, error: new Error("unavailable") })),
    role,
  });
}

function selectedCity() {
  useSelectedCityMock.mockReturnValue({
    city,
    cityId: city.id,
    signedIn: true,
    hasHomeCity: true,
    selectCity: vi.fn(async () => ({ ok: true })),
  });
}

describe("replyIntent — Reply button behavior", () => {
  it("verified members never open the gate and get honest not-open-yet feedback", () => {
    const intent = replyIntent("verified", "Trail crew Monday");
    expect(intent.opensGate).toBe(false);
    expect(intent.toast).toContain("not open yet");
    expect(intent.toast).not.toContain("verified profile");
  });

  it("guests, pending, and rejected users keep the verified-profile gate", () => {
    for (const role of ["guest", "pending", "rejected"] as const) {
      const intent = replyIntent(role, "Trail crew Monday");
      expect(intent.opensGate).toBe(true);
      expect(intent.toast).toContain("Replies need a verified profile");
    }
  });
});

describe("VerifiedGateSheet — defensive verified branch", () => {
  it("verified never falls through to guest/pending/rejected copy", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <VerifiedGateSheet open onClose={() => {}} role="verified" actionLabel="posting and replying" pendingLabel="still in review" rejectionReason="secret reason" />
      </MemoryRouter>,
    );
    expect(html).toContain("You are verified");
    expect(html).toContain("not available yet");
    expect(html).toContain("Got it");
    expect(html).not.toContain("Create account");
    expect(html).not.toContain("Continue verification");
    expect(html).not.toContain("Verification denied");
    expect(html).not.toContain("secret reason");
    expect(html).not.toContain("still in review");
    expect(html).not.toContain("email and password");
  });
});

describe("VerifiedGateSheet — guest/pending/rejected gating preserved", () => {
  it("guest still sees Create account signup copy", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <VerifiedGateSheet open onClose={() => {}} role="guest" actionLabel="posting and replying" pendingLabel="" />
      </MemoryRouter>,
    );
    expect(html).toContain("Create account");
    expect(html).toContain("email and password");
    expect(html).not.toContain("Continue verification");
    expect(html).not.toContain("Verification denied");
  });

  it("pending still sees Continue verification, never denial copy", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <VerifiedGateSheet open onClose={() => {}} role="pending" actionLabel="posting and replying" pendingLabel="Your profile is still in review." />
      </MemoryRouter>,
    );
    expect(html).toContain("Continue verification");
    expect(html).toContain("still in review");
    expect(html).not.toContain("Create account");
    expect(html).not.toContain("Verification denied");
  });

  it("rejected still shows the private reason and no continue action", () => {
    const reason = "Your selfie did not match your photo ID.";
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <VerifiedGateSheet open onClose={() => {}} role="rejected" actionLabel="posting and replying" pendingLabel="still in review" rejectionReason={reason} />
      </MemoryRouter>,
    );
    expect(html).toContain("Verification denied");
    expect(html).toContain(reason);
    expect(html).toContain("View my verification status");
    expect(html).not.toContain("Continue verification");
    expect(html).not.toContain("Create account");
  });
});

describe("ForumCreateSheetBody — New button content per role", () => {
  it("verified sees honest not-open-yet copy and no verification CTA", () => {
    const html = renderToStaticMarkup(<ForumCreateSheetBody role="verified" onClose={() => {}} onOpenGate={() => {}} />);
    expect(html).toContain("Posting and replying are not open yet");
    expect(html).toContain("Got it");
    expect(html).toContain("Coming soon");
    expect(html).not.toContain("Get verified");
    expect(html).not.toContain("Finish verification now");
    expect(html).not.toContain("Requires a verified profile");
    expect(html).not.toContain("Create account");
  });

  it("guest keeps the Get verified CTA and gate placeholders", () => {
    const html = renderToStaticMarkup(<ForumCreateSheetBody role="guest" onClose={() => {}} onOpenGate={() => {}} />);
    expect(html).toContain("Get verified");
    expect(html).toContain("Requires a verified profile");
    expect(html).not.toContain("Got it");
  });

  it("pending keeps Continue verification", () => {
    const html = renderToStaticMarkup(<ForumCreateSheetBody role="pending" onClose={() => {}} onOpenGate={() => {}} />);
    expect(html).toContain("Continue verification");
    expect(html).not.toContain("Get verified");
  });

  it("rejected gets View my verification status, never Get verified", () => {
    const html = renderToStaticMarkup(<ForumCreateSheetBody role="rejected" onClose={() => {}} onOpenGate={() => {}} />);
    expect(html).toContain("View my verification status");
    expect(html).not.toContain("Get verified");
    expect(html).not.toContain("Continue verification");
  });
});

describe("ForumPage — verified users never see the verification gate", () => {
  it("verified: honest not-open-yet copy, no Create account / gate copy anywhere", () => {
    auth(account(), "verified");
    selectedCity();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ForumPage city={city} />
      </MemoryRouter>,
    );
    expect(html).toContain("Everyone can browse.");
    expect(html).toContain("Posting and replying are not open yet");
    expect(html).not.toContain("Create account");
    expect(html).not.toContain("Get verified");
    expect(html).not.toContain("Continue verification");
    expect(html).not.toContain("requires a verified runner profile");
    expect(html).not.toContain("Verification denied");
  });

  it("guest: read-only forum copy remains on the page", () => {
    auth(null, "guest");
    selectedCity();
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ForumPage city={city} />
      </MemoryRouter>,
    );
    expect(html).toContain("guests, pending, and denied profiles stay read-only");
    expect(html).toContain("Posting and replying are not open yet");
  });
});
