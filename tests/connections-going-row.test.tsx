/**
 * SSR tests for the "X connections going" row on event detail (part C2).
 * Rendered with react-dom/server (no jsdom).
 *
 * Pins:
 *  - the row renders the avatar stack + count text from the prop;
 *  - an EMPTY array renders NOTHING — never "0 connections going";
 *  - the row links to /connections;
 *  - guests (canRsvp false) never get the row: the page only fetches for
 *    verified viewers and the presentational row renders nothing for [].
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CITIES } from "../src/data/cities";
import type { DatedRunEvent } from "../src/lib/dates";
import type { ConnectionGoingRow } from "../src/lib/api";
import { ConnectionsGoingRow, EventDetailView } from "../src/pages/EventDetailPage";

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

const going = (over: Partial<ConnectionGoingRow> = {}): ConnectionGoingRow => ({
  accountId: "u1",
  name: "Taylor Jones",
  username: "taylorj",
  profilePhotoUrl: null,
  ...over,
});

const renderRow = (rows: ConnectionGoingRow[]) =>
  renderToStaticMarkup(<MemoryRouter><ConnectionsGoingRow connections={rows} /></MemoryRouter>);

describe("ConnectionsGoingRow — presentational strip", () => {
  it("renders avatars (initials fallback) plus the count text and a /connections link", () => {
    const html = renderRow([going(), going({ accountId: "u2", name: "Morgan Lee", username: "morganlee" })]);
    expect(html).toContain("TJ"); // initials fallback
    expect(html).toContain("ML");
    expect(html).toContain("2 connections going");
    expect(html).toContain('href="/connections"');
    expect(html).toContain("-space-x-2"); // avatar stack
    expect(html).toContain("ring-2 ring-white");
  });
  it("uses the singular label for exactly one connection", () => {
    const html = renderRow([going()]);
    expect(html).toContain("1 connection going");
  });
  it("renders photos when present and caps the stack at 5 with a +N badge", () => {
    const rows = [
      going({ accountId: "u1", name: "One", profilePhotoUrl: "/uploads/public/p1.jpg" }),
      going({ accountId: "u2", name: "Two", profilePhotoUrl: "/uploads/public/p2.jpg" }),
      going({ accountId: "u3", name: "Three" }),
      going({ accountId: "u4", name: "Four" }),
      going({ accountId: "u5", name: "Five" }),
      going({ accountId: "u6", name: "Six" }),
    ];
    const html = renderRow(rows);
    expect(html).toContain('/uploads/public/p1.jpg');
    expect(html).toContain('/uploads/public/p2.jpg');
    expect(html).toContain("+1"); // 6 going, 5 avatars shown
    expect(html).toContain("6 connections going");
  });
  it("EMPTY array renders NOTHING — never '0 connections going'", () => {
    const html = renderRow([]);
    expect(html).toBe("");
  });
});

describe("ConnectionsGoingRow inside EventDetailView", () => {
  it("renders the strip inside the white card body right after the dark header when connections exist", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventDetailView event={EVENT} city={CITY} rsvped={false} canRsvp onRsvp={noop} onBack={noop} connectionsGoing={[going()]} />
      </MemoryRouter>,
    );
    expect(html).toContain("1 connection going");
    // The row sits between the dark header block and the chip/detail block.
    const headerEnd = html.indexOf('class="rounded-t-2xl bg-[#14171C]');
    const row = html.indexOf("connections going");
    const detailBlock = html.indexOf("space-y-3.5");
    expect(headerEnd).toBeGreaterThan(-1);
    expect(row).toBeGreaterThan(headerEnd);
    expect(detailBlock).toBeGreaterThan(row);
  });
  it("renders NO strip for an empty list (guest/ineligible default)", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventDetailView event={EVENT} city={CITY} rsvped={false} canRsvp={false} onRsvp={noop} onBack={noop} />
      </MemoryRouter>,
    );
    expect(html).not.toContain("connections going");
    expect(html).not.toContain('href="/connections"');
  });
  it("locks the page wiring: fetch only for verified viewers (guests get no row)", async () => {
    const source = await readFileSync(resolve(process.cwd(), "src/pages/EventDetailPage.tsx"), "utf8");
    expect(source).toContain("api.getConnectionsGoing(event.id, occ)");
    expect(source).toContain('if (!canRsvp || !event) { setConnectionsGoing([]); return; }');
  });
});
