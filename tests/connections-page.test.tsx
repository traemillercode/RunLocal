/**
 * UI tests for the Connections page (part C1 of Connections & Privacy).
 *
 * Rendered with react-dom/server (no DOM / jsdom) so these exercise the REAL
 * component markup: the three-tab list, request rows with Accept/Decline, the
 * local-filtered My Connections list, the Find People states per
 * connectionState, and the signed-in gates. API-wiring contracts (which
 * helper is called, optimistic update + revert) are pinned on the page source
 * like the existing my-runs-ui write-feedback tests.
 *
 * Only `useAccount` is mocked (hoisted); react-router-dom is real, wrapped in
 * a MemoryRouter. The page never derives rights client-side — the gate copy
 * and buttons simply render what the server reports.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ConnectionsPage, ConnectionsView } from "../src/pages/ConnectionsPage";
import type { Me, PublicAccount } from "../src/lib/accounts";
import type { ConnectionRequestView, ConnectionView, PeopleSearchResult, RunnerProfileView } from "../src/lib/api";

const { useAccountMock } = vi.hoisted(() => ({ useAccountMock: vi.fn() }));
vi.mock("../src/state/account", () => ({ useAccount: useAccountMock }));

const account: PublicAccount = {
  id: "me", name: "Alex Runner", email: "alex@example.com", username: "alex", cityId: "columbia-mo",
  status: "verified", phase: null, badge: "verified", role: "runner", roles: ["runner"],
  isOwner: false, suspended: false, underReview: false, profilePhotoUrl: null,
};
const auth = (me: Me | null, role: "guest" | "pending" | "rejected" | "verified" = "guest") =>
  useAccountMock.mockReturnValue({
    me, backendAvailable: true, refresh: async () => {}, signOut: async () => {},
    deleteMyAccount: async () => ({ ok: false, error: new Error("unavailable") }), role,
  });

function profile(over: Partial<RunnerProfileView>): RunnerProfileView {
  return {
    id: "u1", name: "Taylor Jones", username: "taylorj", profilePhotoUrl: null, cityName: "Columbia, MO",
    isVerified: true, isTrustedMember: false, isLeader: false, ...over,
  };
}

type ViewProps = Parameters<typeof ConnectionsView>[0];
const baseProps: ViewProps = {
  tab: "requests",
  onTabChange: () => {},
  requests: [],
  connections: [],
  pendingCount: 0,
  busyRequestId: null,
  onAcceptRequest: () => {},
  onDeclineRequest: () => {},
  connectionsQuery: "",
  onConnectionsQueryChange: () => {},
  confirmRemove: null,
  removingId: null,
  confirmError: null,
  onRequestRemove: () => {},
  onCloseRemove: () => {},
  onConfirmRemove: () => {},
  peopleQuery: "",
  onPeopleQueryChange: () => {},
  people: [],
  peopleLoading: false,
  busyPersonId: null,
  onConnect: () => {},
  onAcceptFromSearch: () => {},
  actionError: null,
  onClearActionError: () => {},
};
const renderView = (over: Partial<ViewProps> = {}) =>
  renderToStaticMarkup(<MemoryRouter><ConnectionsView {...baseProps} {...over} /></MemoryRouter>);

describe("Connections page — three-tab shell", () => {
  it("renders the three in-page tabs with tablist/tab semantics", () => {
    const html = renderView();
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)?.length).toBe(3);
    expect(html).toContain("Requests");
    expect(html).toContain("My Connections");
    expect(html).toContain("Find People");
    // Requests is the default active tab; the other two are not.
    expect(html).toContain('aria-selected="true"');
    expect((html.match(/aria-selected="false"/g) ?? []).length).toBe(2);
    // The active panel carries role="tabpanel".
    expect(html).toContain('role="tabpanel"');
  });
});

describe("Connections page — Requests tab", () => {
  const requests: ConnectionRequestView[] = [
    { requestId: "req1", from: profile({ id: "u1", name: "Taylor Jones", username: "taylorj" }), createdAt: "2026-08-01T00:00:00Z" },
    { requestId: "req2", from: profile({ id: "u2", name: "Morgan Lee", username: "morganlee" }), createdAt: "2026-08-02T00:00:00Z" },
  ];
  it("shows incoming requests with Accept/Decline actions, profile links, and the pending count", () => {
    const html = renderView({ tab: "requests", requests, pendingCount: 2 });
    expect(html).toContain("Taylor Jones");
    expect(html).toContain("@taylorj");
    expect(html).toContain('href="/runners/u1"');
    expect(html).toContain('aria-label="Accept request from Taylor Jones"');
    expect(html).toContain('aria-label="Decline request from Taylor Jones"');
    expect(html).toContain("Morgan Lee");
    // The Requests tab itself shows the pending count badge.
    expect(html).toContain(">2<");
    expect(html).toContain('aria-label="Requests, 2 pending"');
  });
  it("shows an honest empty state when there are no pending requests", () => {
    const html = renderView({ tab: "requests", requests: [], pendingCount: 0 });
    expect(html).toContain("No pending requests");
    expect(html).not.toContain('aria-label="Accept request from');
  });
  it("locks the request write-wiring contract: api accept/decline + optimistic removal with revert", async () => {
    const source = await readFileSync(resolve(process.cwd(), "src/pages/ConnectionsPage.tsx"), "utf8");
    expect(source).toContain("api.acceptConnection(requestId)");
    expect(source).toContain("api.declineConnection(requestId)");
    // Optimistic: row removed + count decremented before the server answers.
    expect(source).toContain("setRequests((cur) => cur.filter((r) => r.requestId !== requestId))");
    expect(source).toContain("setPendingCount((c) => Math.max(0, c - 1))");
    // Revert on error restores both.
    expect(source).toContain("setRequests(prev)");
    expect(source).toContain("setPendingCount((c) => c + 1)");
  });
});

describe("Connections page — My Connections tab", () => {
  const conn = (over: Partial<ConnectionView>): ConnectionView => ({
    ...profile({ id: "c1", name: "Jordan Miles", username: "jordanm" }),
    connectionState: "connected",
    ...over,
  });
  it("links each connection to the runner's public profile and shows a remove affordance", () => {
    const html = renderView({ tab: "connections", connections: [conn({})] });
    expect(html).toContain('href="/runners/c1"');
    expect(html).toContain("Jordan Miles");
    expect(html).toContain('aria-label="Remove Jordan Miles from connections"');
  });
  it("filters locally by name and username", () => {
    const connections = [conn({ id: "c1", name: "Jordan Miles", username: "jordanm" }), conn({ id: "c2", name: "Sam Smith", username: "sam" })];
    const byName = renderView({ tab: "connections", connections, connectionsQuery: "miles" });
    expect(byName).toContain("Jordan Miles");
    expect(byName).not.toContain("Sam Smith");
    const byUsername = renderView({ tab: "connections", connections, connectionsQuery: "sam" });
    expect(byUsername).toContain("Sam Smith");
    expect(byUsername).not.toContain("Jordan Miles");
  });
  it("shows a no-match message for a query with no results and an empty state with none at all", () => {
    const connections = [conn({ id: "c1", name: "Jordan Miles", username: "jordanm" })];
    const noMatch = renderView({ tab: "connections", connections, connectionsQuery: "zzz" });
    expect(noMatch).toContain("No connections match");
    const none = renderView({ tab: "connections", connections: [] });
    expect(none).toContain("No connections yet");
  });
  it("locks the remove wiring: confirm sheet → api.removeConnection with optimistic removal + revert", async () => {
    const source = await readFileSync(resolve(process.cwd(), "src/pages/ConnectionsPage.tsx"), "utf8");
    expect(source).toContain("api.removeConnection(target.id)");
    expect(source).toContain("setConnections((cur) => cur.filter((c) => c.id !== target.id))");
    expect(source).toContain("setConnections(prev)");
    expect(source).toContain("ModerationConfirmSheet");
  });
});

describe("Connections page — Find People tab", () => {
  const person = (over: Partial<PeopleSearchResult>): PeopleSearchResult => ({
    ...profile({ id: "p1", name: "Ava Chen", username: "avac" }),
    connectionState: "none",
    ...over,
  });
  it("renders the right action per connectionState", () => {
    const people = [
      person({ id: "p1", name: "Ava Chen", connectionState: "none" }),
      person({ id: "p2", name: "Ben Ortiz", connectionState: "requested_by_me" }),
      person({ id: "p3", name: "Cara Diaz", connectionState: "requested_to_me" }),
      person({ id: "p4", name: "Dan Fox", connectionState: "connected" }),
    ];
    const html = renderView({ tab: "people", peopleQuery: "a", people });
    expect(html).toContain('aria-label="Connect with Ava Chen"');
    expect(html).toContain("Requested"); // ghost, already requested by me
    expect(html).toContain('aria-label="Accept request from Cara Diaz"');
    expect(html).toContain("Connected"); // chip for accepted connections
    expect(html).toContain('href="/runners/p1"');
  });
  it("shows an honest prompt before typing and 'No runners found' for an empty result set", () => {
    const prompt = renderView({ tab: "people", peopleQuery: "", people: [] });
    expect(prompt).toContain("Type a name or username to find verified runners");
    const none = renderView({ tab: "people", peopleQuery: "zzz", people: [], peopleLoading: false });
    expect(none).toContain("No runners found");
  });
  it("locks the search + connect wiring: api.searchPeople, requestConnection, accept via the request id", async () => {
    const source = await readFileSync(resolve(process.cwd(), "src/pages/ConnectionsPage.tsx"), "utf8");
    expect(source).toContain("api.searchPeople(query)");
    expect(source).toContain("api.requestConnection(person.id)");
    // requested_to_me rows resolve the request id from the loaded inbox (the
    // search DTO has no requestId) and accept via it.
    expect(source).toContain("requests.find((r) => r.from.id === person.id)?.requestId");
    expect(source).toContain("api.acceptConnection(requestId)");
  });
});

describe("Connections page — signed-in gates", () => {
  it("shows the sign-in CTA for guests", () => {
    auth({ status: "guest" });
    const html = renderToStaticMarkup(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    expect(html).toContain("Sign in to see requests and connect with runners.");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('role="tablist"');
  });
  it("shows the verify CTA for pending/rejected signed-in profiles", () => {
    auth({ status: "signed_in", account: { ...account, status: "pending", phase: "pending_review", badge: null } }, "pending");
    const html = renderToStaticMarkup(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    expect(html).toContain("Verification is required to connect with other runners.");
    expect(html).toContain('href="/verify"');
  });
  it("renders the loading state for verified signed-in runners", () => {
    auth({ status: "signed_in", account }, "verified");
    const html = renderToStaticMarkup(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    expect(html).toContain("Loading connections…");
  });
});
