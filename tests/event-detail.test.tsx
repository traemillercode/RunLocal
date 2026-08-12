/**
 * Regression tests for the event-detail navigation work.
 *
 * Reported: event cards on the home/Events feed were not tappable — there was
 * no in-app detail destination for a tapped run. Fix: the whole card body is
 * now a Link to /events/:eventId rendering a detail view with the existing
 * event model info (title, host, date/time, location, meet-up notes, invite,
 * external links) plus the RSVP action. The external-link icon stays a
 * separate secondary action (new-tab anchor) and must never trigger the
 * internal route.
 *
 * Rendered with react-dom/server (no jsdom) — the same pattern as the other
 * UI tests. The live click-through (card → detail route, external icon does
 * not navigate) is verified in the browser at a mobile viewport.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { EventCard } from "../src/components/EventCard";
import { CITIES } from "../src/data/cities";
import type { DatedRunEvent } from "../src/lib/dates";
import { EventDetailView } from "../src/pages/EventDetailPage";

const CITY = CITIES[0];
const noop = () => {};

const EVENT: DatedRunEvent = {
  id: "mon-social",
  groupId: "runcomo",
  title: "Monday Evening Social Run",
  dayOfWeek: 0,
  time: "6:00 PM",
  location: "Flat Branch Park — south shelter",
  distanceLabel: "3-5 mi, no-drop pace",
  invite: "Open to all",
  externalUrl: "https://www.facebook.com/runcomo/",
  date: new Date(2026, 7, 3),
  isToday: false,
  dayAbbrev: "Mon",
};

describe("EventCard primary navigation (UI)", () => {
  it("makes the card body a link to the in-app detail route", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventCard event={EVENT} city={CITY} rsvped={false} canRsvp onRsvp={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain('href="/events/mon-social"');
    expect(html).toContain("Monday Evening Social Run");
  });

  it("keeps the external-link icon a separate secondary action that does not trigger the internal route", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventCard event={EVENT} city={CITY} rsvped={false} canRsvp onRsvp={noop} />
      </MemoryRouter>,
    );
    // External anchor opens a new tab to the real URL — never the internal route.
    expect(html).toContain('href="https://www.facebook.com/runcomo/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    // Exactly one internal detail link — the external icon is never an /events/ link.
    expect(html.match(/href="\/events\//g)?.length ?? 0).toBe(1);
    // The card body link and the external icon are siblings — the anchor is not
    // nested inside the link (no nested-interactive markup).
    const linkEnd = html.indexOf('href="/events/mon-social"');
    const externalStart = html.indexOf('href="https://www.facebook.com/runcomo/"');
    expect(linkEnd).toBeGreaterThan(-1);
    expect(externalStart).toBeGreaterThan(linkEnd);
    expect(html).toContain("(opens in new tab)");
  });

  it("still renders the RSVP button and invite/distance chips", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventCard event={EVENT} city={CITY} rsvped={false} canRsvp onRsvp={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain("Add to My Runs");
    expect(html).toContain("Open to all");
    expect(html).toContain("3-5 mi");
  });

  it("does not emit an external icon when the event has no external URL", () => {
    const plain = { ...EVENT, externalUrl: undefined };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventCard event={plain} city={CITY} rsvped={false} canRsvp onRsvp={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain('href="/events/mon-social"');
    expect(html).not.toContain("external");
  });
});

describe("EventDetailView (UI)", () => {
  it("shows the full existing event model info", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventDetailView event={EVENT} city={CITY} rsvped={false} canRsvp onRsvp={noop} onBack={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain("Monday Evening Social Run"); // title
    expect(html).toContain("RunCoMO"); // host group
    expect(html).toContain("6:00 PM"); // time
    expect(html).toContain("Flat Branch Park — south shelter"); // location
    expect(html).toContain("3-5 mi, no-drop pace"); // meet-up notes
    expect(html).toContain("Open to all"); // invite
    expect(html).toContain("Add to My Runs"); // My Runs action
    expect(html).toContain("External details"); // external link action
    expect(html).toContain('href="https://www.facebook.com/runcomo/"');
    expect(html).toContain("Back to Events");
  });

  it("renders verified-only gating and RSVP state on the action button", () => {
    const gated = renderToStaticMarkup(
      <MemoryRouter>
        <EventDetailView event={EVENT} city={CITY} rsvped={false} canRsvp={false} onRsvp={noop} onBack={noop} />
      </MemoryRouter>,
    );
    // Ineligible users keep the same action-first CTA; tapping it opens the gate sheet.
    expect(gated).toContain("Add to My Runs");
    expect(gated).not.toContain("Verified runners only");
    expect(gated).not.toContain("RSVP for this run");
    const rsvped = renderToStaticMarkup(
      <MemoryRouter>
        <EventDetailView event={EVENT} city={CITY} rsvped canRsvp onRsvp={noop} onBack={noop} />
      </MemoryRouter>,
    );
    expect(rsvped).toContain("Remove from My Runs");
  });
});
