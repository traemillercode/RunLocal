/**
 * UI tests for the Privacy settings section (part C1 of Connections & Privacy).
 *
 * The section is presentational (props only) so SSR tests render the REAL
 * markup: exact plain-language labels in the owner-specified order, the
 * verbatim safety line directly above "My upcoming runs & races", the
 * saved-runs control with exactly two options (no "Everyone", ever), the
 * radiogroup/radio semantics, and the searchable_by_name switch. The
 * optimistic-save wiring (getPrivacy/putPrivacy + revert on error) is pinned
 * on the SettingsPage source like the existing toggleNotification tests.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PrivacySettingsSection } from "../src/pages/SettingsPage";
import type { PrivacySettings } from "../src/lib/api";

function settings(over: Partial<PrivacySettings> = {}): PrivacySettings {
  return {
    profile_visibility: "public",
    show_upcoming_events: "connections_only",
    show_saved_events: "connections_only",
    show_past_activity: "public",
    show_connections_list: "connections_only",
    show_tagged_content: "connections_only",
    searchable_by_name: true,
    ...over,
  };
}

const renderSection = (over: Partial<PrivacySettings> = {}, props: { saving?: boolean; error?: string | null } = {}) =>
  renderToStaticMarkup(
    <PrivacySettingsSection settings={settings(over)} onSave={() => {}} saving={props.saving ?? false} error={props.error ?? null} />,
  );

describe("Privacy settings section — labels & order", () => {
  it("renders every control with its exact plain-language label, in the owner's order", () => {
    const html = renderSection();
    // Rendered text escapes & and ' in SSR output.
    const order = [
      "Who can find my profile",
      "We default this to connections only", // safety line (apostrophe-free fragment)
      "My upcoming runs &amp; races",
      "My saved runs &amp; races",
      "My past activity",
      "My connections list",
      "Posts I&#x27;m tagged in",
      "Let people find me by name",
    ];
    for (const label of order) expect(html).toContain(label);
    let prev = -1;
    for (const label of order) {
      const at = html.indexOf(label);
      expect(at).toBeGreaterThan(prev);
      prev = at;
    }
    // Plain-language values only — never raw enum names.
    expect(html).toContain("Everyone");
    expect(html).toContain("Only my connections");
    expect(html).toContain("Only me");
    expect(html).not.toContain("connections_only");
    expect(html).not.toContain("profile_visibility");
    expect(html).not.toContain("show_upcoming_events");
  });

  it("places the verbatim safety line directly above the upcoming-runs control", () => {
    const html = renderSection();
    const safety = html.indexOf("We default this to connections only");
    const upcoming = html.indexOf("My upcoming runs &amp; races");
    const profile = html.indexOf("Who can find my profile");
    expect(safety).toBeGreaterThan(profile);
    expect(safety).toBeLessThan(upcoming);
  });

  it("locks the verbatim safety-line copy in the source", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/SettingsPage.tsx"), "utf8");
    expect(source).toContain("Runs you haven't done yet reveal where you'll be. We default this to connections only.");
  });
});

describe("Privacy settings section — saved runs", () => {
  it("renders exactly two options for saved runs & races, and never an Everyone option", () => {
    const html = renderSection();
    // Slice from the saved-runs radiogroup's aria-label (the label text also
    // appears once in the question row, so anchor on the aria-label instead).
    const afterLabel = html.split('aria-label="My saved runs &amp; races"')[1] ?? "";
    const slice = afterLabel.split("My past activity")[0];
    expect(slice.match(/role="radio"/g)?.length).toBe(2);
    expect(slice).toContain("Only my connections");
    expect(slice).toContain("Only me");
    expect(slice).not.toContain("Everyone");
  });
});

describe("Privacy settings section — semantics", () => {
  it("uses radiogroup/radio semantics with the active value checked", () => {
    const html = renderSection();
    // Six controls: profile, upcoming, saved, past, connections list, tagged.
    expect(html.match(/role="radiogroup"/g)?.length).toBe(6);
    // 2 + 3 + 2 + 3 + 3 + 3 radio rows.
    expect(html.match(/role="radio"/g)?.length).toBe(16);
    // One checked radio per control (defaults: public, connections_only,
    // connections_only, public, connections_only, connections_only) plus the
    // searchable_by_name switch, which is also aria-checked="true".
    expect(html.match(/aria-checked="true"/g)?.length).toBe(7);
  });

  it("renders the searchable_by_name switch with helper text", () => {
    const html = renderSection();
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-label="Let people find me by name on"');
    expect(html).toContain("Controls whether you appear in Find People.");
    const off = renderSection({ searchable_by_name: false });
    expect(off).toContain('aria-checked="false"');
  });

  it("surfaces save errors via role=alert", () => {
    const html = renderSection({}, { error: "Couldn't save privacy settings. Try again." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Couldn&#x27;t save privacy settings. Try again.");
  });
});

describe("Privacy settings section — save wiring (SettingsPage)", () => {
  it("loads via getPrivacy and saves optimistically via putPrivacy with revert on error", () => {
    const source = readFileSync(resolve(process.cwd(), "src/pages/SettingsPage.tsx"), "utf8");
    expect(source).toContain("api.getPrivacy()");
    expect(source).toContain("api.putPrivacy(patch)");
    // Optimistic apply then revert to the previous snapshot on error.
    expect(source).toContain("setPrivacySettings({ ...privacySettings, ...patch })");
    expect(source).toContain("setPrivacySettings(prev)");
    expect(source).toContain("setPrivacyError(r.error.message");
    // Signed-in only, rendered only after the real server values arrive.
    expect(source).toContain("signedIn && privacySettings ?");
    expect(source).toContain("<PrivacySettingsSection");
  });
});
