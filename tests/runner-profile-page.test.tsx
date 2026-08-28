/**
 * SSR tests for the public runner profile page (react-dom/server, no jsdom —
 * see runlocal-ui-tests-no-jsdom).
 *
 * The page is guest-accessible: no account/role gate, and the server sends
 * only public-safe fields (never email/phone/suspension/rejection/under-
 * review). These tests pin the identity card (badges, username, city, leader
 * chip), the qualitative community-standing section (tier chip, coach/host
 * chips, honest empty state for recognitions), the city recognitions list,
 * and the 404 state for unknown/deleted/suspended accounts.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  RunnerProfileCityRecognitions,
  RunnerProfileHeader,
  RunnerProfileMissing,
  RunnerProfilePage,
  RunnerProfileTrust,
} from "../src/pages/RunnerProfilePage";
import type { PublicTrustView, RecognitionView, RunnerProfileView } from "../src/lib/api";
function profile(patch: Partial<RunnerProfileView> = {}): RunnerProfileView {
  return {
    id: "a".repeat(32),
    name: "Taylor Runner",
    username: "taylor_runs",
    profilePhotoUrl: null,
    cityName: "Columbia",
    isVerified: true,
    isTrustedMember: true,
    isLeader: true,
    ...patch,
  };
}
function trust(patch: Partial<PublicTrustView> = {}): PublicTrustView {
  return { tier: "recognized", coach: true, host: false, recognitions: [], ...patch };
}
describe("RunnerProfileHeader — identity card (guest-accessible)", () => {
  it("renders name, @username, home city, Verified + Trusted badges, and the leader chip", () => {
    const html = renderToStaticMarkup(<RunnerProfileHeader profile={profile()} />);
    expect(html).toContain("Taylor Runner");
    expect(html).toContain("@taylor_runs");
    expect(html).toContain("Home: Columbia");
    expect(html).toContain('title="Identity verified by Run Local"'); // VerifiedBadge artifact
    expect(html).toContain("Trusted member — verified by Run Local leadership"); // TrustedBadge artifact
    expect(html).toContain("Group Leader");
  });
  it("renders initials fallback when there is no photo and hides badges when unset", () => {
    const html = renderToStaticMarkup(
      <RunnerProfileHeader profile={profile({ isVerified: false, isTrustedMember: false, isLeader: false, username: null, cityName: null })} />,
    );
    expect(html).toContain("TR"); // initials of "Taylor Runner"
    expect(html).not.toContain("Verified");
    expect(html).not.toContain("Trusted");
    expect(html).not.toContain("Group Leader");
    expect(html).not.toContain("@");
    expect(html).toContain("Home city: not set");
  });
  it("never renders private fields (email, phone, suspension, rejection)", () => {
    const html = renderToStaticMarkup(<RunnerProfileHeader profile={profile()} />);
    expect(html).not.toContain("email");
    expect(html).not.toContain("phone");
    expect(html).not.toContain("suspended");
    expect(html).not.toContain("rejection");
    expect(html).not.toContain("under review");
  });
});
describe("RunnerProfileTrust — community standing (qualitative only)", () => {
  it("renders the tier chip and coach/host chips mirroring the own-profile styling", () => {
    const html = renderToStaticMarkup(
      <RunnerProfileTrust trust={trust({ tier: "well-regarded", coach: true, host: true })} />,
    );
    expect(html).toContain("Well-regarded in the community");
    expect(html).toContain("Recognized coach");
    expect(html).toContain("Recognized host");
  });
  it("shows the honest empty state when the runner has no recognitions", () => {
    const html = renderToStaticMarkup(<RunnerProfileTrust trust={trust()} />);
    expect(html).toContain("This runner hasn"); // apostrophe is HTML-escaped in SSR
    expect(html).toContain("been recognized yet");
  });
  it("lists admin-granted recognitions when present", () => {
    const html = renderToStaticMarkup(
      <RunnerProfileTrust trust={trust({ recognitions: [{ role: "coach", tier: "recognized" }] })} />,
    );
    expect(html).toContain("Recognized coach");
    expect(html).toContain("granted by verified leadership");
  });
});
describe("RunnerProfileCityRecognitions — recognized coaches & hosts in the city", () => {
  const rows: RecognitionView[] = [
    { accountId: "b".repeat(32), name: "Jordan Lee", username: "jordan", roles: ["host"], tier: "recognized" },
  ];
  it("renders the section with links to each runner profile", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RunnerProfileCityRecognitions cityName="Columbia" recognitions={rows} />
      </MemoryRouter>,
    );
    expect(html).toContain("Recognized in Columbia");
    expect(html).toContain(`href="/runners/${"b".repeat(32)}"`);
    expect(html).toContain("Jordan Lee");
    expect(html).toContain("@jordan");
  });
  it("renders nothing for an empty list or unknown city", () => {
    expect(renderToStaticMarkup(<RunnerProfileCityRecognitions cityName="Columbia" recognitions={[]} />)).toBe("");
    expect(renderToStaticMarkup(<RunnerProfileCityRecognitions cityName={null} recognitions={rows} />)).toBe("");
  });
});
describe("RunnerProfileMissing — honest 404 state", () => {
  it("renders the not-found copy with a way back", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RunnerProfileMissing />
      </MemoryRouter>,
    );
    expect(html).toContain("Runner not found");
    expect(html).toContain("Back to Run Local");
    expect(html).toContain('href="/"');
  });
});
describe("RunnerProfilePage — guest-accessible page", () => {
  it("SSR-renders the loading shell without any account gate", () => {
    // useEffect does not run under renderToStaticMarkup, so the initial
    // loading state renders — proving the page has no auth/role requirement.
    const html = renderToStaticMarkup(<MemoryRouter><RunnerProfilePage id={"c".repeat(32)} /></MemoryRouter>);
    expect(html).toContain("Runner profile");
    expect(html).toContain("Public community profile");
    expect(html).not.toContain("sign in");
    expect(html).not.toContain("verified profile");
  });
});
