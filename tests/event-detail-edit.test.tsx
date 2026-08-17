/**
 * G1: event-detail "Edit" wiring — source-contract + SSR tests (no jsdom).
 *
 * The detail page's moderation ActionMenu already renders the server-provided
 * capability list (which now includes "edit" for group leads / scoped admins),
 * but the page's action dispatcher only mapped hide/restore/delete to the
 * confirm sheet — the Edit row was dead. This slice wires "edit" into the
 * EXISTING shared edit flow (EventEditSheet from EventsPage → PUT
 * /api/events/:id) with ZERO server/authorization/privacy changes: the server
 * ships the `edit` capability (src/server/eventModeration.ts) and the update
 * endpoint (src/lib/api.ts updateEvent) already; the client just routes the
 * menu key to the pre-filled sheet and reflects the server's canonical record
 * after a successful save.
 *
 * These tests pin that wiring (same style as tests/my-runs-calendar-polish.test.tsx)
 * plus the menu rendering rules (server list → exact rows, verbatim).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { EventEditSheet } from "../src/pages/EventsPage";
import { EventDetailView } from "../src/pages/EventDetailPage";
import { actionMenuItems } from "../src/lib/actionModel";
import { CITIES } from "../src/data/cities";
import type { DatedRunEvent } from "../src/lib/dates";

const city = CITIES[0];
const noop = () => {};
const RUN: DatedRunEvent = {
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

const source = async () =>
  import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/pages/EventDetailPage.tsx", import.meta.url), "utf8"));

describe("EventDetailPage — edit dispatcher wiring (source contract)", () => {
  it("reuses the shared EventEditSheet + EventEditDraft from EventsPage (no duplicate sheet)", async () => {
    const s = await source();
    expect(s).toContain('EventEditSheet, type EventEditDraft');
    expect(s).toContain('from "./EventsPage"');
    // The page must NOT re-define the sheet body locally (single source of truth).
    expect(s).not.toContain('export function EventEditSheet(');
  });

  it("routes the 'edit' menu key to the sheet pre-filled from the CANONICAL record, gated on eventCaps", async () => {
    const s = await source();
    expect(s).toContain('if (key === "edit")');
    expect(s).toContain('if (!eventCaps) return;');
    // Pre-fill uses the canonical event id (never an occurrence-prefixed id)
    // and the canonical record's fields, with scheduleDate ⇄ dayOfWeek mapping.
    expect(s).toContain('eventId: eventCaps.id,');
    expect(s).toContain("e.id === eventCaps.id || (e.seedRefId !== null && e.seedRefId === bareEventId(event.id))");
    expect(s).toContain("dayOfWeek: rec.scheduleDate ? null : rec.dayOfWeek,");
    expect(s).toContain("scheduleDate: rec.scheduleDate ?? null,");
    // Sheet is open exactly when a draft is set and rendered with the shared sheet.
    expect(s).toContain('<Sheet open={editTarget !== null} onClose={closeEdit} title="Edit run"');
    expect(s).toContain("<EventEditSheet");
  });

  it("save path calls api.updateEvent with the canonical id and the trimmed body shape", async () => {
    const s = await source();
    expect(s).toContain("api.updateEvent(t.eventId, {");
    expect(s).toContain("title: t.title.trim(),");
    expect(s).toContain("time: t.time.trim(),");
    expect(s).toContain("location: t.location.trim(),");
    expect(s).toContain("distanceLabel: t.distanceLabel.trim(),");
    expect(s).toContain("invite: t.invite,");
    expect(s).toContain("externalUrl: t.externalUrl.trim() || null,");
    // dayOfWeek XOR scheduleDate depending on the draft's mode — same as EventsPage.
    expect(s).toContain("...(t.dayOfWeek !== null ? { dayOfWeek: t.dayOfWeek } : { scheduleDate: t.scheduleDate }),");
    // Busy/error state mirrors the feed; success closes the sheet, reflects the
    // server's canonical record in the page's event source, and toasts.
    expect(s).toContain("setEditBusy(true);");
    expect(s).toContain('setEditError(r.error.message ?? "Couldn\'t save — try again.");');
    expect(s).toContain("setCanonicalEvents((cur) => (cur ? cur.map((e) => (e.id === r.data.event.id ? r.data.event : e)) : cur));");
    expect(s).toContain('toast("Run updated.", "success");');
  });

  it("close is guarded while submitting (same as the feed) and the cancel path is wired", async () => {
    const s = await source();
    expect(s).toContain("const closeEdit = () => {");
    expect(s).toContain("if (editBusy) return;");
    expect(s).toContain("setEditTarget(null);");
    expect(s).toContain("onClose={closeEdit}");
  });
});

describe("EventDetailView — menu renders exactly the server-provided capabilities", () => {
  it("lead/admin (visible) capability list renders the menu trigger; actionModel maps it to the exact rows", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventDetailView event={RUN} city={city} rsvped={false} canRsvp onRsvp={noop} onBack={noop} capabilities={["edit", "hide", "restore", "delete"]} onAction={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain('aria-label="Actions for Monday Evening Social Run"');
    expect(html).toContain('aria-haspopup="menu"');
    // The capability list is rendered verbatim, in server order, with canonical labels.
    expect(actionMenuItems(["edit", "hide", "restore", "delete"]).map((m) => m.label)).toEqual(["Edit", "Hide", "Restore", "Delete"]);
    // Hidden events ship without "hide" — the menu shrinks, "edit" stays.
    expect(actionMenuItems(["edit", "restore", "delete"]).map((m) => m.label)).toEqual(["Edit", "Restore", "Delete"]);
  });

  it("guest / out-of-scope (empty list) renders no trigger — capability list never invented client-side", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventDetailView event={RUN} city={city} rsvped={false} canRsvp onRsvp={noop} onBack={noop} capabilities={[]} onAction={noop} />
      </MemoryRouter>,
    );
    expect(html).not.toContain("Actions for");
    expect(html).not.toContain('aria-haspopup="menu"');
  });
});

describe("EventEditSheet — shared edit form still renders its fields (SSR)", () => {
  it("renders all editable fields with the draft values", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventEditSheet
          draft={{
            eventId: "canon-abc",
            title: "Monday Evening Social Run",
            time: "6:00 PM",
            location: "Flat Branch Park",
            distanceLabel: "3-5 mi",
            invite: "Open to all",
            externalUrl: "https://example.com",
            dayOfWeek: 0,
            scheduleDate: null,
          }}
          onDraftChange={noop}
          onSubmit={noop}
          onClose={noop}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Run title");
    expect(html).toContain("Monday Evening Social Run");
    expect(html).toContain('value="6:00 PM"');
    expect(html).toContain('value="Flat Branch Park"');
    expect(html).toContain("Schedule");
    expect(html).toContain("Who can join?");
    expect(html).toContain("Save changes");
    expect(html).toContain("Cancel");
  });
});
