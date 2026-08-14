/**
 * SSR tests for the Phase 2b My Submissions wiring (react-dom/server, no
 * jsdom — see runlocal-ui-tests-no-jsdom).
 *
 * The server returns this account's own submission rows with a capability
 * list (`MySubmissionView.capabilities`): pending rows get ["withdraw"],
 * decided rows get []. MySubmissionsContent renders the Withdraw ActionMenu
 * only for pending rows and shows a neutral "Withdrawn" chip for withdrawn
 * rows — decided rows render no trigger at all.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MySubmissionsContent } from "../src/pages/ProfilePage";
import { submissionDateLabel } from "../src/lib/dates";
import type { MySubmissionView } from "../src/lib/api";

const noop = () => {};

function row(patch: Partial<MySubmissionView> = {}): MySubmissionView {
  return {
    id: "sub_1",
    kind: "race",
    cityId: "columbia-mo",
    status: "pending",
    title: "Roots N Blues Half Marathon",
    submittedAt: "2026-07-01T00:00:00.000Z",
    decidedAt: null,
    rejectionReason: null,
    capabilities: [],
    ...patch,
  };
}

describe("MySubmissionsContent — status chips and pending-only actions", () => {
  it("pending row shows the Withdraw action menu and Pending approval chip", () => {
    const html = renderToStaticMarkup(
      <MySubmissionsContent rows={[row({ capabilities: ["withdraw"] })]} onWithdraw={noop} />,
    );
    expect(html).toContain('aria-label="Actions for Roots N Blues Half Marathon submission"');
    expect(html).toContain("Pending approval");
  });

  it("withdrawn row shows the neutral Withdrawn chip and NO action menu", () => {
    const html = renderToStaticMarkup(<MySubmissionsContent rows={[row({ status: "withdrawn" })]} onWithdraw={noop} />);
    expect(html).toContain("Withdrawn");
    expect(html).toContain("bg-slate-100 text-slate-600"); // neutral tone, not amber/red
    expect(html).not.toContain("Actions for");
    expect(html).not.toContain("Pending approval");
  });

  it("approved and rejected rows render no action menu", () => {
    for (const status of ["approved", "rejected"] as const) {
      const html = renderToStaticMarkup(<MySubmissionsContent rows={[row({ status })]} onWithdraw={noop} />);
      expect(html).not.toContain("Actions for");
      expect(html).toContain(status === "approved" ? "Approved" : "Rejected");
    }
  });

  it("rejected rows keep the private rejection reason", () => {
    const html = renderToStaticMarkup(
      <MySubmissionsContent rows={[row({ status: "rejected", rejectionReason: "Photo did not match ID" })]} onWithdraw={noop} />,
    );
    expect(html).toContain("Why it was rejected:");
    expect(html).toContain("Photo did not match ID");
  });
});

describe("MySubmissionsContent — per-status date lines", () => {
  // Noon-UTC timestamps keep the rendered local date stable across timezones.
  const submittedAt = "2026-07-01T12:00:00.000Z";
  const decidedAt = "2026-08-04T12:00:00.000Z";

  it("pending rows show 'Submitted <date>' from submittedAt", () => {
    const html = renderToStaticMarkup(
      <MySubmissionsContent rows={[row({ status: "pending", submittedAt })]} onWithdraw={noop} />,
    );
    expect(html).toContain(`Submitted ${submissionDateLabel(submittedAt)}`);
    expect(html).not.toContain("Approved ");
  });

  it("approved rows show 'Approved <date>' from decidedAt", () => {
    const html = renderToStaticMarkup(
      <MySubmissionsContent rows={[row({ status: "approved", submittedAt, decidedAt })]} onWithdraw={noop} />,
    );
    expect(html).toContain(`Approved ${submissionDateLabel(decidedAt)}`);
    expect(html).not.toContain("Submitted ");
  });

  it("rejected rows show 'Rejected <date>' from decidedAt alongside the reason", () => {
    const html = renderToStaticMarkup(
      <MySubmissionsContent rows={[row({ status: "rejected", submittedAt, decidedAt, rejectionReason: "Photo did not match ID" })]} onWithdraw={noop} />,
    );
    expect(html).toContain(`Rejected ${submissionDateLabel(decidedAt)}`);
    expect(html).toContain("Why it was rejected:");
  });

  it("withdrawn rows show 'Withdrawn <date>' from decidedAt", () => {
    const html = renderToStaticMarkup(
      <MySubmissionsContent rows={[row({ status: "withdrawn", submittedAt, decidedAt })]} onWithdraw={noop} />,
    );
    expect(html).toContain(`Withdrawn ${submissionDateLabel(decidedAt)}`);
  });

  it("renders NO date line when decidedAt is null on a decided row", () => {
    const html = renderToStaticMarkup(
      <MySubmissionsContent rows={[row({ status: "approved", submittedAt, decidedAt: null })]} onWithdraw={noop} />,
    );
    expect(html).toContain("Approved"); // chip still renders
    expect(html.match(/Approved\s+\w+ \d+, \d{4}/)).toBeNull();
  });
});
