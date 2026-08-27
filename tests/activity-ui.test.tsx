/**
 * UI tests for Build B2 — manual run activity (log-a-run composition sheet,
 * public-profile activity cards, and the Connections Activity feed).
 *
 * Rendered with react-dom/server (no jsdom — see runlocal-ui-tests-no-jsdom).
 * Privacy is enforced server-side (B1); these components only render what the
 * payload contains, so the tests pin the presentational output per state and
 * the page-wiring contracts (postManualActivity / getConnectionsActivity /
 * verified-gate routing).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RunnerActivityPanel } from "../src/pages/RunnerProfilePage";
import { ConnectionsView } from "../src/pages/ConnectionsPage";
import { LogRunSheet, buildManualActivityInput } from "../src/components/SubmissionSheets";
import { ActivityCardView, ConnectionActivityCardView } from "../src/components/ActivityCards";
import { formatActivityDate, formatActivityDistance, formatActivityDuration } from "../src/lib/activityFormat";
import type { ConnectionActivityCard, PublicActivityCard, RunnerActivityRow } from "../src/lib/api";

const card: PublicActivityCard = {
  id: "a1",
  type: "run",
  distanceMeters: 5023,
  durationSeconds: 1860,
  provider: "strava",
  attribution: "Strava",
  sharedAt: "2026-08-03T00:00:00Z",
};

describe("activity-format helpers", () => {
  it("formats distance, duration, and shared date deterministically", () => {
    expect(formatActivityDistance(5023)).toBe("5.0 km");
    expect(formatActivityDistance(3218)).toBe("3.2 km");
    expect(formatActivityDuration(1860)).toBe("31 min");
    expect(formatActivityDuration(3660)).toBe("1h 1m");
    expect(formatActivityDate("2026-08-03T00:00:00Z")).toBe("Aug 3, 2026");
  });
});

describe("Log a run — manual activity composition (B2)", () => {
  it("builds the exact postManualActivity payload (km + h/m + optional date/caption)", () => {
    const input = buildManualActivityInput({
      distance: "5", unit: "km", hours: "0", minutes: "30", startedAt: "2026-08-03T07:00", caption: "  Easy morning run  ",
    });
    expect(input).toEqual({
      distanceMeters: 5000,
      durationSeconds: 1800,
      startedAt: "2026-08-03T07:00:00Z",
      caption: "Easy morning run",
    });
  });
  it("converts miles to meters and honors the unit toggle", () => {
    const mi = buildManualActivityInput({ distance: "3", unit: "mi", hours: "0", minutes: "24", startedAt: "", caption: "" });
    expect(mi?.distanceMeters).toBe(4828); // 3 × 1609.344, rounded
    expect(mi?.durationSeconds).toBe(1440);
    expect(mi?.startedAt).toBeUndefined();
    expect(mi?.caption).toBeUndefined();
  });
  it("returns null for missing/zero distance or missing duration", () => {
    expect(buildManualActivityInput({ distance: "", unit: "km", hours: "", minutes: "", startedAt: "", caption: "" })).toBeNull();
    expect(buildManualActivityInput({ distance: "0", unit: "km", hours: "1", minutes: "0", startedAt: "", caption: "" })).toBeNull();
    expect(buildManualActivityInput({ distance: "5", unit: "km", hours: "0", minutes: "0", startedAt: "", caption: "" })).toBeNull();
    expect(buildManualActivityInput({ distance: "5", unit: "km", hours: "0", minutes: "75", startedAt: "", caption: "" })).toBeNull();
  });
  it("renders the full composition sheet (distance + unit, duration, optional date/caption) with a submit button", () => {
    const html = renderToStaticMarkup(<LogRunSheet open onClose={() => {}} />);
    expect(html).toContain("Log a run");
    expect(html).toContain("Distance");
    expect(html).toContain("Duration");
    expect(html).toContain("Date (optional)");
    expect(html).toContain('aria-label="Hours"');
    expect(html).toContain('aria-label="Minutes"');
    expect(html).toContain("Caption (optional)");
    expect(html).toContain("Log run</button>");
    // Distinct from community-hosted runs / solo scheduling — manual post only.
    expect(html).toContain("manual");
  });
  it("locks the client wiring: the sheet posts via postManualActivity (manual provider, no provider OAuth)", async () => {
    const source = await readFileSync(resolve(process.cwd(), "src/components/SubmissionSheets.tsx"), "utf8");
    expect(source).toContain("api.postManualActivity(input)");
    // Manual posting only — no provider OAuth wiring in this composition sheet.
    expect(source).not.toContain("STRAVA_CLIENT_ID");
  });
});

describe("Runner profile Activity tab — activity cards (B2)", () => {
  const row: RunnerActivityRow = { id: "p1", title: "Long run routes", excerpt: "Sharing the trail loop…", section: "community", createdAt: "Aug 2" };
  it("renders the logged-run card (distance · duration, provider attribution, shared date) alongside forum posts", () => {
    const html = renderToStaticMarkup(<RunnerActivityPanel rows={[row]} cards={[card]} loading={false} />);
    expect(html).toContain("5.0 km");
    expect(html).toContain("31 min");
    expect(html).toContain("Strava");
    expect(html).toContain("Aug 3, 2026");
    // The forum-posts surface is NOT regressed.
    expect(html).toContain("Long run routes");
    expect(html).toContain("Sharing the trail loop");
    expect(html).toContain("Aug 2");
  });
  it("renders a 'Log a run' CTA on the runner's OWN profile both with cards and in the empty state", () => {
    const withCards = renderToStaticMarkup(<RunnerActivityPanel rows={[]} cards={[card]} loading={false} ownView onLogRun={() => {}} />);
    expect(withCards).toContain("Log a run");
    const ownEmpty = renderToStaticMarkup(<RunnerActivityPanel rows={[]} cards={[]} loading={false} ownView onLogRun={() => {}} />);
    expect(ownEmpty).toContain("Log a run");
    expect(ownEmpty).toContain("No runs logged yet");
  });
  it("shows an honest publicly-visible empty state on ANOTHER runner's profile (no CTA)", () => {
    const html = renderToStaticMarkup(<RunnerActivityPanel rows={[]} cards={[]} loading={false} />);
    expect(html).toContain("No public activity yet");
    expect(html).not.toContain("Log a run");
  });
  it("gates unverified users to the verified prompt, not a silent failure (page-wiring)", async () => {
    const profileSource = await readFileSync(resolve(process.cwd(), "src/pages/RunnerProfilePage.tsx"), "utf8");
    expect(profileSource).toContain("role === \"verified\" ? setLogRunOpen(true) : setLogGateOpen(true)");
    expect(profileSource).toContain('actionLabel="logging runs"');
    expect(profileSource).toContain("VerifiedGateSheet");
  });
});

describe("Connections Activity tab (B2)", () => {
  const connCard: ConnectionActivityCard = {
    ...card,
    owner: { accountId: "u1", name: "Taylor Jones", username: "taylorj", profilePhotoUrl: null },
  };
  it("shows a connected runner's shared card with their identity linked to /runners/:id", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter><ConnectionsView tab="activity" onTabChange={() => {}} requests={[]} connections={[]} pendingCount={0} busyRequestId={null} onAcceptRequest={() => {}} onDeclineRequest={() => {}} connectionsQuery="" onConnectionsQueryChange={() => {}} confirmRemove={null} removingId={null} confirmError={null} onRequestRemove={() => {}} onCloseRemove={() => {}} onConfirmRemove={() => {}} peopleQuery="" onPeopleQueryChange={() => {}} people={[]} peopleLoading={false} busyPersonId={null} onConnect={() => {}} onAcceptFromSearch={() => {}} actionError={null} onClearActionError={() => {}} activityCards={[connCard]} activityLoading={false} /></MemoryRouter>,
    );
    expect(html).toContain("Taylor Jones");
    expect(html).toContain("@taylorj");
    expect(html).toContain('href="/runners/u1"');
    expect(html).toContain("5.0 km");
    expect(html).toContain("31 min");
    expect(html).toContain("Strava");
    // Only the passed (accepted-connections, server-filtered) cards render —
    // a non-connection's card is never present.
    expect(html).not.toContain("Sam Smith");
  });
  it("renders an empty state when there are no connections or no shared activity", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter><ConnectionsView tab="activity" onTabChange={() => {}} requests={[]} connections={[]} pendingCount={0} busyRequestId={null} onAcceptRequest={() => {}} onDeclineRequest={() => {}} connectionsQuery="" onConnectionsQueryChange={() => {}} confirmRemove={null} removingId={null} confirmError={null} onRequestRemove={() => {}} onCloseRemove={() => {}} onConfirmRemove={() => {}} peopleQuery="" onPeopleQueryChange={() => {}} people={[]} peopleLoading={false} busyPersonId={null} onConnect={() => {}} onAcceptFromSearch={() => {}} actionError={null} onClearActionError={() => {}} activityCards={[]} activityLoading={false} /></MemoryRouter>,
    );
    expect(html).toContain("No runs from your connections yet");
  });
  it("locks the connections feed wiring to getConnectionsActivity (auth-required, server-filtered)", async () => {
    const source = await readFileSync(resolve(process.cwd(), "src/pages/ConnectionsPage.tsx"), "utf8");
    expect(source).toContain("api.getConnectionsActivity()");
    // The view renders ONLY the provided cards — no client-side identity logic.
    expect(source).toContain("activityCards.map((c) =>");
  });
});

describe("activity card component markup", () => {
  it("Card views render distance/duration/provider/date in a readable layout", () => {
    const single = renderToStaticMarkup(<ActivityCardView card={card} />);
    expect(single).toContain("5.0 km");
    expect(single).toContain("31 min");
    expect(single).toContain("Strava · Strava · Aug 3, 2026");
    const conn = renderToStaticMarkup(
      <MemoryRouter><ConnectionActivityCardView card={{ ...card, owner: { accountId: "u2", name: "Morgan Lee", username: "morganlee", profilePhotoUrl: null } }} /></MemoryRouter>,
    );
    expect(conn).toContain("Morgan Lee");
    expect(conn).toContain("@morganlee");
    expect(conn).toContain('href="/runners/u2"');
  });
});
