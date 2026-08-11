/**
 * UI-level regression tests for the group manage surface data safety and
 * admin reach. Rendered with react-dom/server (no DOM / jsdom — same harness
 * as header-auth.test.tsx). Covers:
 *  - the profile form initializing from the loaded server row (textarea /
 *    select values come from props, not empty defaults);
 *  - no-op saves being blocked (Save disabled when nothing changed, patch
 *    payload `{}` for untouched fields) and partial edits sending ONLY the
 *    changed fields (untouched fields preserved);
 *  - the manage list rendering City Admin / Platform owner rows with Manage
 *    links (admin reach in the UI).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { GroupProfilePatch } from "../src/lib/api";
import {
  effectiveMembershipMode,
  GroupProfileForm,
  hasProfileChanges,
  profilePatchFor,
} from "../src/pages/GroupManagePage";
import { LedGroupsSection, ledGroupRoleLabel } from "../src/pages/MyGroupsPage";

const noop = () => {};
const SERVER_ROW = { description: "Weekly social runs", membershipMode: "open" as const };

describe("profilePatchFor — partial patches preserve untouched fields", () => {
  it("returns {} when nothing changed (a no-op save that must never reach the API)", () => {
    expect(profilePatchFor("Weekly social runs", "open", SERVER_ROW)).toEqual({});
    expect(hasProfileChanges("Weekly social runs", "open", SERVER_ROW)).toBe(false);
  });
  it("sends ONLY the description when only the description changed", () => {
    const patch = profilePatchFor("Updated blurb", "open", SERVER_ROW);
    expect(patch).toEqual({ description: "Updated blurb" });
    expect("membershipMode" in patch).toBe(false);
  });
  it("sends ONLY the membership mode when only the mode changed", () => {
    const patch = profilePatchFor("Weekly social runs", "request", SERVER_ROW);
    expect(patch).toEqual({ membershipMode: "request" });
    expect("description" in patch).toBe(false);
  });
  it("treats a seeded group without a stored mode as request (no phantom open flip)", () => {
    // Seed groups have no membershipMode field; the server treats them as
    // request-mode at runtime, so the form must too.
    const legacy = { description: "", membershipMode: undefined };
    expect(effectiveMembershipMode(legacy)).toBe("request");
    expect(profilePatchFor("", "request", legacy)).toEqual({});
    expect(profilePatchFor("", "open", legacy)).toEqual({ membershipMode: "open" });
  });
  it("types the patch as GroupProfilePatch (compile-time check of the contract)", () => {
    const patch: GroupProfilePatch = profilePatchFor("x", "request", SERVER_ROW);
    expect(Object.keys(patch).length).toBeGreaterThan(0);
  });
});

describe("GroupProfileForm — initializes from the loaded server row and blocks no-op saves", () => {
  it("renders the server description as the textarea value and the server mode as the selected option", () => {
    const html = renderToStaticMarkup(
      <GroupProfileForm
        description="Weekly social runs"
        onDescriptionChange={noop}
        mode="open"
        onModeChange={noop}
        reason=""
        onReasonChange={noop}
        onSave={noop}
        current={SERVER_ROW}
      />,
    );
    expect(html).toContain("Weekly social runs");
    expect(html).toContain('value="request"');
    expect(html).toContain('value="open"');
    // SSR renders the controlled select with `selected` on the matching option
    expect(html).toContain('<option value="open" selected=""');
  });
  it("disables Save when the form matches the server row (no-op protection)", () => {
    const html = renderToStaticMarkup(
      <GroupProfileForm
        description="Weekly social runs"
        onDescriptionChange={noop}
        mode="open"
        onModeChange={noop}
        reason="A reason typed but no change made"
        onReasonChange={noop}
        onSave={noop}
        current={SERVER_ROW}
      />,
    );
    expect(html).toContain("No profile changes to save");
    expect(html).toContain('disabled=""');
  });
  it("enables Save when the user changed a field", () => {
    const html = renderToStaticMarkup(
      <GroupProfileForm
        description="Changed blurb"
        onDescriptionChange={noop}
        mode="open"
        onModeChange={noop}
        reason=""
        onReasonChange={noop}
        onSave={noop}
        current={SERVER_ROW}
      />,
    );
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("No profile changes to save");
  });
});

describe("manage list — authorized admins reach eligible groups in the UI", () => {
  it("labels a City Admin row as City Admin with a Manage link", () => {
    expect(ledGroupRoleLabel("city_admin")).toBe("City Admin");
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LedGroupsSection groups={[{
          groupId: "g1", groupName: "Como Striders", cityId: "columbia-mo", ownerId: null,
          role: "city_admin", pendingCount: 2, canManageLeaders: true, leaders: [],
          description: "", membershipMode: "request",
        }]} />
      </MemoryRouter>,
    );
    expect(html).toContain("Groups you manage");
    expect(html).toContain("Como Striders");
    expect(html).toContain("City Admin");
    expect(html).toContain("2 pending requests");
    expect(html).toContain('href="/groups/g1/manage"');
  });
  it("labels a Global Admin row as Platform owner and an owner row as Owner", () => {
    expect(ledGroupRoleLabel("global_admin")).toBe("Platform owner");
    expect(ledGroupRoleLabel("owner")).toBe("Owner");
    expect(ledGroupRoleLabel("leader")).toBe("Leader");
  });
  it("renders nothing for an empty manage list", () => {
    expect(renderToStaticMarkup(<MemoryRouter><LedGroupsSection groups={[]} /></MemoryRouter>)).toBe("");
  });
});
