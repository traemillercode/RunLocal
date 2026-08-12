/**
 * SSR tests for the public-profile connect block + Activity/Tagged tabs
 * (part C2 of Connections & Privacy). Rendered with react-dom/server (no
 * jsdom — see runlocal-ui-tests-no-jsdom).
 *
 * Pins:
 *  - RunnerConnectBlock per connectionState: Connect / Requested (non-
 *    actionable ghost + honest helper) / Accept Request / Connected;
 *  - guests render NO button; pending/rejected viewers get a Connect CTA
 *    that routes through the VerifiedGateSheet (page wiring pinned);
 *  - the mutual line renders ONLY when mutualVisible is true AND the count
 *    is > 0 — never "0 mutual connections";
 *  - Activity | Tagged tablist + role=tabpanel panels render server data
 *    (activity rows; tagged rows with a self-hide toggle ONLY for the
 *    tagged user themself);
 *  - page wiring contracts: requestConnection / inbox-resolved
 *    acceptConnection / removeConnection / selfHideTag / getRunnerActivity /
 *    getRunnerTagged.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RunnerActivityPanel,
  RunnerConnectBlock,
  RunnerProfilePage,
  RunnerProfileTabs,
  RunnerTaggedPanel,
} from "../src/pages/RunnerProfilePage";
import type { RunnerActivityRow, RunnerProfileView, RunnerTaggedRow } from "../src/lib/api";

const OTHER = "b".repeat(32);

function profile(patch: Partial<RunnerProfileView> = {}): RunnerProfileView {
  return {
    id: OTHER,
    name: "Taylor Jones",
    username: "taylorj",
    profilePhotoUrl: null,
    cityName: "Columbia, MO",
    isVerified: true,
    isTrustedMember: false,
    isLeader: false,
    ...patch,
  };
}

type BlockProps = Parameters<typeof RunnerConnectBlock>[0];
const blockProps = (over: Partial<BlockProps> = {}): BlockProps => ({
  profile: profile(),
  viewerRole: "verified",
  busy: false,
  onConnect: () => {},
  onAcceptRequest: () => {},
  onOpenGate: () => {},
  onOpenRemove: () => {},
  ...over,
});
const renderBlock = (over: Partial<BlockProps> = {}) =>
  renderToStaticMarkup(<RunnerConnectBlock {...blockProps(over)} />);

describe("RunnerConnectBlock — button per connectionState", () => {
  it("renders 'Connect' when there is no relationship", () => {
    const html = renderBlock({ profile: profile({ connectionState: "none" }) });
    expect(html).toContain("Connect");
    expect(html).not.toContain("Connected");
  });
  it("renders a non-actionable ghost 'Requested' with honest helper text", () => {
    const html = renderBlock({ profile: profile({ connectionState: "requested_by_me" }) });
    expect(html).toContain("Requested");
    expect(html).toContain("Request sent");
    expect(html).toContain('aria-disabled="true"');
    // No fake affordance on the sender side.
    expect(html).not.toContain("Accept Request");
    expect(html).not.toContain("Cancel");
  });
  it("renders 'Accept Request' when the viewer received the request", () => {
    const html = renderBlock({ profile: profile({ connectionState: "requested_to_me" }) });
    expect(html).toContain("Accept Request");
  });
  it("renders the emerald 'Connected' state", () => {
    const html = renderBlock({ profile: profile({ connectionState: "connected" }) });
    expect(html).toContain("Connected");
    expect(html).toContain("bg-emerald-100");
  });
  it("renders nothing for guests", () => {
    const html = renderBlock({ viewerRole: "guest", profile: profile({ connectionState: "none" }) });
    expect(html).toBe("");
    const connected = renderBlock({ viewerRole: "guest", profile: profile({ connectionState: "connected" }) });
    expect(connected).toBe("");
  });
  it("gives pending/rejected viewers a Connect CTA that opens the verify gate", () => {
    const pending = renderBlock({ viewerRole: "pending", profile: profile({ connectionState: "none" }) });
    expect(pending).toContain("Connect");
    const rejected = renderBlock({ viewerRole: "rejected", profile: profile({ connectionState: null }) });
    expect(rejected).toContain("Connect");
  });
});

describe("RunnerConnectBlock — mutual line (server-gated derived data)", () => {
  it("renders the plural line when mutualVisible && 3 mutual connections", () => {
    const html = renderBlock({ profile: profile({ mutualVisible: true, mutualConnectionsCount: 3 }) });
    expect(html).toContain("3 mutual connections");
  });
  it("renders the singular line for exactly one", () => {
    const html = renderBlock({ profile: profile({ mutualVisible: true, mutualConnectionsCount: 1 }) });
    expect(html).toContain("1 mutual connection");
  });
  it("NEVER renders the line for a zero count, even when visible", () => {
    const html = renderBlock({ profile: profile({ mutualVisible: true, mutualConnectionsCount: 0 }) });
    expect(html).not.toContain("mutual");
  });
  it("never renders the line when mutualVisible is false or absent", () => {
    expect(renderBlock({ profile: profile({ mutualVisible: false, mutualConnectionsCount: 3 }) })).not.toContain("mutual");
    expect(renderBlock({ profile: profile({ mutualConnectionsCount: 3 }) })).not.toContain("mutual");
    expect(renderBlock({ profile: profile({ mutualVisible: true }) })).not.toContain("mutual");
  });
});

describe("RunnerProfileTabs + panels", () => {
  it("renders the Activity | Tagged tablist with tab semantics", () => {
    const html = renderToStaticMarkup(<RunnerProfileTabs tab="activity" onSelect={() => {}} />);
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)?.length).toBe(2);
    expect(html).toContain("Activity");
    expect(html).toContain("Tagged");
    expect(html).toContain('aria-selected="true"'); // activity active by default
    expect(html).toContain('aria-selected="false"');
  });
  it("Activity panel renders server rows (title/excerpt/date) and an honest empty state", () => {
    const rows: RunnerActivityRow[] = [
      { id: "p1", title: "Long run routes", excerpt: "Sharing the trail loop I scouted…", section: "community", createdAt: "Aug 2" },
    ];
    const filled = renderToStaticMarkup(<RunnerActivityPanel rows={rows} />);
    expect(filled).toContain('role="tabpanel"');
    expect(filled).toContain("Long run routes");
    expect(filled).toContain("Sharing the trail loop");
    expect(filled).toContain("Aug 2");
    const empty = renderToStaticMarkup(<RunnerActivityPanel rows={[]} />);
    expect(empty).toContain("No public activity yet");
  });
  it("Tagged panel renders content rows and the self-hide toggle ONLY for the tagged user", () => {
    const rows: RunnerTaggedRow[] = [
      { tag: { id: "t1", contentType: "post", contentId: "p1", hiddenByTaggedUser: false, createdAt: "2026-08-01T00:00:00Z" }, content: { kind: "post", id: "p1", title: "Saturday long run" } },
      { tag: { id: "t2", contentType: "event", contentId: "e1", hiddenByTaggedUser: true, createdAt: "2026-08-02T00:00:00Z" }, content: { kind: "event", id: "e1", title: "Holiday 5K" } },
    ];
    const own = renderToStaticMarkup(<RunnerTaggedPanel rows={rows} isOwn busyTagId={null} onToggleHide={() => {}} />);
    expect(own).toContain("Saturday long run");
    expect(own).toContain("Holiday 5K");
    expect(own).toContain("Forum post");
    expect(own).toContain("Event");
    // Hidden row shows the re-show action; visible row shows the hide action.
    expect(own).toContain("Hide me from this tag");
    expect(own).toContain("Show me again");
    const other = renderToStaticMarkup(<RunnerTaggedPanel rows={rows} isOwn={false} busyTagId={null} onToggleHide={() => {}} />);
    expect(other).toContain("Saturday long run");
    expect(other).not.toContain("Hide me from this tag");
    expect(other).not.toContain("Show me again");
  });
});

describe("RunnerProfilePage — wiring contracts (source)", () => {
  it("locks connect/accept/remove wiring: requestConnection, inbox-resolved acceptConnection, removeConnection", async () => {
    const source = await readFileSync(resolve(process.cwd(), "src/pages/RunnerProfilePage.tsx"), "utf8");
    expect(source).toContain("api.requestConnection(data.profile.id)");
    expect(source).toContain("api.getConnections()");
    expect(source).toContain("r.data.requests.find((x) => x.from.id === data.profile.id)?.requestId");
    expect(source).toContain("api.acceptConnection(requestId)");
    expect(source).toContain("api.removeConnection(data.profile.id)");
    // Optimistic updates + revert on error for each mutation.
    expect(source).toContain('connectionState: "requested_by_me"');
    expect(source).toContain('connectionState: "connected"');
    expect(source).toContain('connectionState: "none"');
    expect(source).toContain("setData(prev)");
  });
  it("locks tab wiring: getRunnerActivity + getRunnerTagged fetch and selfHideTag toggles", async () => {
    const source = await readFileSync(resolve(process.cwd(), "src/pages/RunnerProfilePage.tsx"), "utf8");
    expect(source).toContain("api.getRunnerActivity(id)");
    expect(source).toContain("api.getRunnerTagged(id)");
    expect(source).toContain("api.selfHideTag(row.tag.id, hidden)");
    expect(source).toContain("setTagged(prev)");
  });
  it("routes pending/rejected Connect taps through VerifiedGateSheet with connect-specific copy", async () => {
    const source = await readFileSync(resolve(process.cwd(), "src/pages/RunnerProfilePage.tsx"), "utf8");
    expect(source).toContain('actionLabel="connecting with runners"');
    expect(source).toContain("VerifiedGateSheet");
  });
  it("never renders a connect affordance on self-view via /runners/:id", () => {
    // Presentational block is driven by props; the PAGE hides it for self-view
    // while still showing the Tagged self-hide toggles (isOwn).
    const source = readFileSync(resolve(process.cwd(), "src/pages/RunnerProfilePage.tsx"), "utf8");
    expect(source).toContain("const isSelf = viewerId !== null && viewerId === id");
    expect(source).toContain("{!isSelf ?");
    expect(source).toContain("isOwn={isSelf}");
  });
  it("page stays guest-accessible with tabs present once loaded (no account gate)", () => {
    const html = renderToStaticMarkup(<MemoryRouter><RunnerProfilePage id={OTHER} /></MemoryRouter>);
    expect(html).toContain("Runner profile");
    expect(html).toContain("Public community profile");
    // Effects don't run under SSR, so still loading — but no gate or button.
    expect(html).not.toContain("Connect");
  });
});
