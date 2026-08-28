/**
 * SSR tests for the runner feedback UI (react-dom/server, no jsdom — see
 * runlocal-ui-tests-no-jsdom). Presentational children of
 * RunnerFeedbackSheet are exported for exactly this.
 *
 * Pins:
 *  - the "Share feedback" affordance is gated to VERIFIED signed-in viewers
 *    and never shows on your own profile (canViewerGiveFeedback);
 *  - the event selector's honest states: loading, zero shared runs (empty
 *    state — submit stays disabled), single preselect (no dropdown), and a
 *    real dropdown for multiple shared runs;
 *  - the tag checkboxes mirror ALLOWED_TRUST_TAGS with friendly labels;
 *  - negative-rating / concern copy ("admins review it privately", "admins
 *    only, never public") renders with the 5–500 counter;
 *  - the page stays guest-accessible (loading shell, no account gate).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  RunnerFeedbackEvents,
  RunnerFeedbackReason,
  RunnerFeedbackSheet,
  RunnerFeedbackTags,
  TRUST_TAG_LABELS,
} from "../src/components/RunnerFeedbackSheet";
import {
  canViewerGiveFeedback,
  RunnerProfilePage,
  RunnerShareFeedbackButton,
} from "../src/pages/RunnerProfilePage";
import type { SharedEventView } from "../src/lib/api";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));

const ev = (patch: Partial<SharedEventView> = {}): SharedEventView => ({
  eventId: "ev1",
  title: "Test Run",
  date: "2026-08-01",
  ...patch,
});

describe("canViewerGiveFeedback — verified signed-in viewers only, never self", () => {
  it("allows a verified viewer on another runner's profile", () => {
    expect(canViewerGiveFeedback("verified", "a".repeat(32), "b".repeat(32))).toBe(true);
  });
  it("blocks guests, pending, rejected, and own-profile views", () => {
    const me = "a".repeat(32);
    expect(canViewerGiveFeedback("guest", null, "b".repeat(32))).toBe(false);
    expect(canViewerGiveFeedback("pending", me, "b".repeat(32))).toBe(false);
    expect(canViewerGiveFeedback("rejected", me, "b".repeat(32))).toBe(false);
    expect(canViewerGiveFeedback("verified", me, me)).toBe(false);
  });
});

describe("RunnerShareFeedbackButton — the affordance", () => {
  it("renders 'Share feedback' when visible", () => {
    const html = renderToStaticMarkup(<RunnerShareFeedbackButton visible onClick={() => {}} />);
    expect(html).toContain("Share feedback");
  });
  it("renders nothing for guests and unverified viewers", () => {
    expect(renderToStaticMarkup(<RunnerShareFeedbackButton visible={false} onClick={() => {}} />)).toBe("");
  });
});

describe("RunnerFeedbackEvents — honest event selector states", () => {
  it("shows the loading state while shared runs are being checked", () => {
    const html = renderToStaticMarkup(<RunnerFeedbackEvents events={null} runnerName="Taylor" selectedEventId={null} onSelect={() => {}} error={null} />);
    expect(html).toContain("Checking shared runs");
  });
  it("shows the empty state at zero shared runs", () => {
    const html = renderToStaticMarkup(<RunnerFeedbackEvents events={[]} runnerName="Taylor" selectedEventId={null} onSelect={() => {}} error={null} />);
    expect(html).toContain("haven"); // "haven't" is HTML-escaped in SSR
    expect(html).toContain("run the same Run Local event yet");
    expect(html).toContain("feedback unlocks after a shared run");
  });
  it("preselects a single shared run without a dropdown", () => {
    const html = renderToStaticMarkup(
      <RunnerFeedbackEvents events={[ev()]} runnerName="Taylor" selectedEventId="ev1" onSelect={() => {}} error={null} />,
    );
    expect(html).toContain("Test Run");
    expect(html).toContain("2026-08-01");
    expect(html).not.toContain("<select");
  });
  it("renders a dropdown when several runs were shared", () => {
    const html = renderToStaticMarkup(
      <RunnerFeedbackEvents
        events={[ev(), ev({ eventId: "ev2", title: "Tuesday Track", date: "2026-07-14" })]}
        runnerName="Taylor"
        selectedEventId="ev1"
        onSelect={() => {}}
        error={null}
      />,
    );
    expect(html).toContain("<select");
    expect(html).toContain("Test Run");
    expect(html).toContain("Tuesday Track");
    expect(html).toContain("2026-07-14");
  });
  it("surfaces a load error (e.g. 401/403 gate) verbatim", () => {
    const html = renderToStaticMarkup(
      <RunnerFeedbackEvents events={null} runnerName="Taylor" selectedEventId={null} onSelect={() => {}} error="Only verified runners can share feedback." />,
    );
    expect(html).toContain("Only verified runners can share feedback.");
  });
});

describe("RunnerFeedbackTags — positive-rating tags", () => {
  it("renders every ALLOWED_TRUST_TAG with a friendly label and pressed state", () => {
    const html = renderToStaticMarkup(<RunnerFeedbackTags selected={["reliable"]} onToggle={() => {}} />);
    for (const label of Object.values(TRUST_TAG_LABELS)) expect(html).toContain(label);
    expect(html).toContain('aria-pressed="true"'); // reliable
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("up to 3");
  });
});

describe("RunnerFeedbackReason — 5–500 counter + privacy copy", () => {
  it("renders the negative-rating copy: admins review it privately", () => {
    const html = renderToStaticMarkup(
      <RunnerFeedbackReason value="pushed the pace too hard" onChange={() => {}} label="What happened?" hint="Admins review it privately — your name is never shown to the runner." />,
    );
    expect(html).toContain("What happened?");
    expect(html).toContain("Admins review it privately");
    expect(html).toContain("24 / 500");
  });
  it("renders the concern copy: goes to admins only, never public", () => {
    const html = renderToStaticMarkup(
      <RunnerFeedbackReason value="left a runner behind after dark" onChange={() => {}} label="Describe the concern" hint="Goes to admins only — never public, and never shown to the runner." />,
    );
    expect(html).toContain("Goes to admins only");
    expect(html).toContain("never public");
  });
});

describe("RunnerFeedbackSheet + RunnerProfilePage — composition", () => {
  it("renders nothing while the sheet is closed", () => {
    const html = renderToStaticMarkup(
      <RunnerFeedbackSheet open={false} onClose={() => {}} runnerId={"b".repeat(32)} runnerName="Taylor" />,
    );
    expect(html).toBe("");
  });
  it("page stays guest-accessible: loading shell renders without any account gate", () => {
    useAccountMock.mockReturnValue({ role: "verified", me: { status: "signed_in", account: { id: "a".repeat(32) } } });
    const html = renderToStaticMarkup(<MemoryRouter><RunnerProfilePage id={"b".repeat(32)} /></MemoryRouter>);
    expect(html).toContain("Runner profile");
    expect(html).toContain("Public community profile");
    // effects don't run under SSR, so the page is still loading — the
    // affordance only appears once the profile has loaded.
    expect(html).not.toContain("Share feedback");
  });
});
