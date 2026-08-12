/**
 * SSR/no-jsdom tests for TourSettingsSample — the static Settings preview
 * rendered inside the tour's Settings step card.
 *
 * Renders via renderToStaticMarkup with NO Router (and no providers) to prove
 * the component is SSR-safe — it must not call useNavigate or any hook
 * (the VerifiedGateSheet crash pattern). Labels are asserted verbatim against
 * SettingsPage's privacy section so the preview stays honest.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TOUR_SETTINGS_SAMPLE_CAPTION, TourSettingsSample } from "../src/components/TourSettingsSample";

describe("TourSettingsSample (SSR markup, no Router)", () => {
  it("renders with renderToStaticMarkup without a Router wrapper", () => {
    const html = renderToStaticMarkup(<TourSettingsSample />);
    expect(html).toContain('data-tour-settings-sample="true"');
    expect(html).toContain("Privacy");
  });

  it("shows the exact in-app privacy row labels and values from the Settings page", () => {
    const html = renderToStaticMarkup(<TourSettingsSample />);
    // renderToStaticMarkup escapes ampersands in text nodes.
    expect(html).toContain("Who can find my profile");
    expect(html).toContain("Everyone");
    expect(html).toContain("My upcoming runs &amp; races");
    expect(html).toContain("Only my connections");
    expect(html).toContain("My saved runs &amp; races");
    expect(html).toContain("Only me");
    expect(html).toContain("Let people find me by name");
  });

  it("shows the name-finding row as a switch (aria-checked), matching the Settings page", () => {
    const html = renderToStaticMarkup(<TourSettingsSample />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Let people find me by name on");
  });

  it("renders the preview caption verbatim", () => {
    const html = renderToStaticMarkup(<TourSettingsSample />);
    expect(html).toContain(TOUR_SETTINGS_SAMPLE_CAPTION);
    expect(TOUR_SETTINGS_SAMPLE_CAPTION).toBe("A preview — your actual settings are on this page.");
  });

  it("is presentational: no buttons, links, or interactive handlers", () => {
    const html = renderToStaticMarkup(<TourSettingsSample />);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("onClick");
  });
});
