import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const events = readFileSync("src/pages/EventsPage.tsx", "utf8");
const profile = readFileSync("src/pages/ProfilePage.tsx", "utf8");
const detail = readFileSync("src/pages/EventDetailPage.tsx", "utf8");
const groupDetail = readFileSync("src/pages/GroupDetailPage.tsx", "utf8");

describe("Events feed segmented control", () => {
  it("offers All / Group runs / Independent runs with All as the default", () => {
    expect(events).toContain('useState<"all" | "group" | "independent">("all")');
    expect(events).toContain("All");
    expect(events).toContain("Group runs");
    expect(events).toContain("Independent runs");
    expect(events).toContain('aria-pressed={feedSegment === value}');
    expect(events).toContain('role="group"');
  });
  it("filters BOTH the week feed and the one-off section by groupId", () => {
    expect(events).toContain('e.groupId !== ""');
    expect(events).toContain('e.groupId === ""');
    expect(events).toContain('feedSegment !== "group"');
  });
  it("keeps honest per-segment empty states", () => {
    expect(events).toMatch(/No group runs this week yet/);
    expect(events).toMatch(/No independent runs this week yet/);
  });
});

describe("ProfilePage — public-profile rework", () => {
  it("is a public-profile view, not a settings dashboard", () => {
    expect(profile).toContain("Your public profile");
    expect(profile).toContain("View public profile");
    expect(profile).toContain("encodeURIComponent(signedIn.id)");
  });
  it("removes the settings forms and home-city editor from /profile", () => {
    expect(profile).not.toContain("Open Settings");
    expect(profile).not.toContain("Choose your username");
    expect(profile).not.toContain("ProfilePhotoSettings");
    expect(profile).not.toContain("UsernameEditor");
  });
  it("keeps tour targets and the verified-content strings", () => {
    expect(profile).toContain("profile-header");
    expect(profile).toContain("profile-my-groups");
    expect(profile).toContain("My groups");
    expect(profile).toContain("View my groups");
    expect(profile).toContain("Upcoming RSVPs");
    expect(profile).toContain("mx-auto w-full max-w-md px-4 pb-32 pt-4 desktop-reading");
  });
});

describe("stable back affordances", () => {
  it("links the event detail back affordance to /events (no navigate(-1))", () => {
    expect(detail).toContain("Back to Events");
    expect(detail).toContain('to="/events"');
    // The legacy onBack wiring is gone from the render path.
    expect(detail).not.toMatch(/Back to this week/);
  });
  it("adds a Back to Groups link on group detail", () => {
    expect(groupDetail).toContain("Back to Groups");
    expect(groupDetail).toContain('to="/groups"');
  });
});
