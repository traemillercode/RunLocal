/**
 * SSR tests for ModerationConfirmSheet (react-dom/server, no jsdom).
 *
 * The sheet renders its body when `open` is true, so we render both variants
 * with `open` and assert the markup: variant A (requireReason) must show the
 * reason field, counter, and honest impact copy with the confirm button
 * disabled until a valid reason exists; variant B must not show a reason
 * field at all and stays confirm-only.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModerationConfirmSheet } from "../src/components/ModerationConfirmSheet";

const noop = () => {};

const base = {
  open: true,
  onClose: noop,
  entity: "Tuesday Track Night · Thu, Jun 12",
  confirmLabel: "Hide run",
  onConfirm: noop,
};

describe("ModerationConfirmSheet — variant A (destructive, reason required)", () => {
  it("shows entity summary, honest impact copy, reason field, and counter", () => {
    const html = renderToStaticMarkup(
      <ModerationConfirmSheet
        {...base}
        title="Hide this run?"
        impact="The run will disappear from public listings. You can restore it at any time."
        requireReason
      />,
    );
    expect(html).toContain("Tuesday Track Night · Thu, Jun 12");
    expect(html).toContain("The run will disappear from public listings. You can restore it at any time.");
    expect(html).toContain("<textarea");
    expect(html).toContain("Reason");
    expect(html).toContain("0 / 500");
    expect(html).toContain("5–500 characters");
    expect(html).toContain('maxLength="500"');
  });

  it("disables confirm until a valid reason exists and while busy", () => {
    const initial = renderToStaticMarkup(
      <ModerationConfirmSheet {...base} title="Hide this run?" impact="Impact." requireReason />,
    );
    expect(initial).toContain('disabled=""');

    const busy = renderToStaticMarkup(
      <ModerationConfirmSheet {...base} title="Hide this run?" impact="Impact." requireReason busy />,
    );
    expect(busy).toContain("Working…");
    expect(busy).toContain('disabled=""');
  });

  it("announces server errors with role=alert", () => {
    const html = renderToStaticMarkup(
      <ModerationConfirmSheet
        {...base}
        title="Hide this run?"
        impact="Impact."
        requireReason
        error="The run could not be hidden. Try again."
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("The run could not be hidden. Try again.");
  });
});

describe("ModerationConfirmSheet — variant B (confirm-only)", () => {
  it("has no reason field and an enabled confirm button", () => {
    const html = renderToStaticMarkup(
      <ModerationConfirmSheet
        {...base}
        title="Restore this run?"
        confirmLabel="Restore run"
        impact="The run will reappear in public listings."
      />,
    );
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("5–500 characters");
    expect(html).toContain("Restore run");
    expect(html).not.toContain('disabled=""');
  });

  it("includes the report privacy note when provided", () => {
    const html = renderToStaticMarkup(
      <ModerationConfirmSheet
        {...base}
        title="Report this post?"
        confirmLabel="Report post"
        impact="Reports are reviewed by Run Local staff."
        note="Only Run Local admins see your report and your name."
      />,
    );
    expect(html).toContain("Only Run Local admins see your report and your name.");
  });

  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      <ModerationConfirmSheet
        {...base}
        open={false}
        title="Restore this run?"
        impact="Impact."
      />,
    );
    expect(html).toBe("");
  });
});
