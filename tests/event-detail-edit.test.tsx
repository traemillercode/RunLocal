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
import { preferCanonicalFields, resolveWeekEvents, type DatedRunEvent, type WeekCanonicalSource } from "../src/lib/dates";
import type { RunEvent } from "../src/types";

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

// ---- G1.1: the visible detail card must reflect a saved edit immediately ----
// QA (#135) found the card kept showing the old title/location after Save: the
// page resolved the event by id from [...city.events, ...canonical, ...recurring]
// and the client seed copy / weekly model shadowed the canonical record the
// edit replaces. The fix prefers the canonical registry record for the same
// logical run (seedRefId / bare refId) BEFORE date resolution, so the fields
// the card renders come from the server-authoritative post-edit source while
// ids (URL, RSVP, moderation index) stay untouched.

/** The server-materialized canonical row for the `sun-recovery` seed slot,
 *  as /api/events returns it AFTER a successful group-lead edit. */
const editedSunRecovery: WeekCanonicalSource = {
  id: "canon-sun-recovery",
  seedRefId: "sun-recovery",
  groupId: "runcomo",
  title: "Sunday Recovery Run (edited)",
  dayOfWeek: 6,
  time: "8:00 AM",
  location: "Stephens Lake Park — east beach lot (edited)",
  distanceLabel: "3–4 mi, easy",
  invite: "Open to all",
  externalUrl: null,
  status: "published",
  hidden: false,
  archivedAt: null,
};

/** The /api/content copy of an approved community event (bare refId). */
const communityRecurring: RunEvent = {
  id: "user-comm1",
  groupId: "",
  title: "Thursday Twilight Loop",
  dayOfWeek: 3,
  time: "5:30 PM",
  location: "Cosmo Park",
  distanceLabel: "3–5 mi",
  invite: "Open to all",
};
const editedCommunityCanonical: WeekCanonicalSource = {
  id: "event:user-comm1",
  seedRefId: null,
  groupId: "user-comm1",
  title: "Thursday Twilight Loop (edited)",
  dayOfWeek: 3,
  time: "5:30 PM",
  location: "Cosmo Park (edited)",
  distanceLabel: "3–5 mi",
  invite: "Open to all",
  externalUrl: null,
  status: "published",
  hidden: false,
  archivedAt: null,
};

/** The exact page pipeline: seed + canonical copy + /api/content weekly copy,
 *  canonical preference applied, then date resolution. */
function resolveLikePage(canonical: WeekCanonicalSource[], recurring: RunEvent[], now = new Date(2026, 7, 12, 10, 0, 0)) {
  const canonicalList: WeekCanonicalSource[] = canonical;
  const canonicalEntries = canonicalList
    .filter((e) => e.status === "published" && !e.hidden && !e.archivedAt)
    .map((e) => ({ id: e.id, groupId: e.groupId, title: e.title, dayOfWeek: e.dayOfWeek, time: e.time, location: e.location, distanceLabel: e.distanceLabel, invite: e.invite, externalUrl: e.externalUrl ?? undefined }));
  return resolveWeekEvents(
    [...city.events, ...canonicalEntries, ...recurring].map((e) => preferCanonicalFields(e, canonicalList)),
    now,
  );
}

describe("preferCanonicalFields — post-edit resolution source (G1.1)", () => {
  it("overlays the edited canonical fields onto the matching seed entry, keeping the seed id", () => {
    const seedEntry = city.events.find((e) => e.id === "sun-recovery")!;
    const out = preferCanonicalFields(seedEntry, [editedSunRecovery]);
    expect(out.id).toBe("sun-recovery"); // URL/RSVP identity unchanged
    expect(out.title).toBe("Sunday Recovery Run (edited)");
    expect(out.location).toBe("Stephens Lake Park — east beach lot (edited)");
    expect(out.groupId).toBe("runcomo");
  });

  it("overlays the edited canonical record onto the /api/content copy of a community event (bare refId)", () => {
    const out = preferCanonicalFields(communityRecurring, [editedCommunityCanonical]);
    expect(out.id).toBe("user-comm1");
    expect(out.title).toBe("Thursday Twilight Loop (edited)");
    expect(out.location).toBe("Cosmo Park (edited)");
  });

  it("passes seed-only events through unchanged when no canonical row exists", () => {
    const seedEntry = city.events.find((e) => e.id === "sun-recovery")!;
    expect(preferCanonicalFields(seedEntry, [])).toBe(seedEntry);
  });

  it("never overlays hidden, non-published, or archived canonical records", () => {
    const seedEntry = city.events.find((e) => e.id === "sun-recovery")!;
    for (const variant of [
      { ...editedSunRecovery, hidden: true },
      { ...editedSunRecovery, status: "archived" as const },
      { ...editedSunRecovery, archivedAt: "2026-08-01T00:00:00.000Z" },
      { ...editedSunRecovery, status: "draft" as const },
    ]) {
      expect(preferCanonicalFields(seedEntry, [variant]).title).toBe("Sunday Recovery Run");
    }
  });

  it("is a no-op for the canonical entry itself (identity match)", () => {
    const canonicalEntry: RunEvent = {
      id: "canon-sun-recovery",
      groupId: "runcomo",
      title: "Sunday Recovery Run (edited)",
      dayOfWeek: 6,
      time: "8:00 AM",
      location: "Stephens Lake Park — east beach lot (edited)",
      distanceLabel: "3–4 mi, easy",
      invite: "Open to all",
    };
    const out = preferCanonicalFields(canonicalEntry, [editedSunRecovery]);
    expect(out).toEqual(canonicalEntry);
  });
});

describe("EventDetailPage — the visible card renders the saved server record after an edit (G1.1)", () => {
  it("resolves the seed URL to the EDITED canonical fields (no reload needed)", () => {
    const resolved = resolveLikePage([editedSunRecovery], []);
    const event = resolved.find((e) => e.id === "sun-recovery")!;
    expect(event.title).toBe("Sunday Recovery Run (edited)");
    expect(event.location).toBe("Stephens Lake Park — east beach lot (edited)");
  });

  it("moves the resolved date when the edit changes the weekday", () => {
    const moved = { ...editedSunRecovery, dayOfWeek: 5, title: "Saturday Recovery Run (edited)" };
    const resolved = resolveLikePage([moved], []);
    const event = resolved.find((e) => e.id === "sun-recovery")!;
    expect(event.title).toBe("Saturday Recovery Run (edited)");
    // Week of Wed Aug 12 2026: Saturday = Aug 15 (seed Sunday would be Aug 16).
    expect(event.date.getDate()).toBe(15);
    expect(event.dayAbbrev).toBe("Sat");
  });

  it("renders the edited title/location in the detail card markup (SSR)", () => {
    const resolved = resolveLikePage([editedSunRecovery], [communityRecurring]);
    const event = resolved.find((e) => e.id === "sun-recovery")!;
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EventDetailView event={event} city={city} rsvped={false} canRsvp onRsvp={noop} onBack={noop} capabilities={[]} onAction={noop} />
      </MemoryRouter>,
    );
    expect(html).toContain("Sunday Recovery Run (edited)");
    expect(html).toContain("Stephens Lake Park — east beach lot (edited)");
    expect(html).not.toContain("Sunday Recovery Run</h1>");
  });

  it("keeps non-edited community events on the /api/content copy (no canonical record → unchanged)", () => {
    const resolved = resolveLikePage([], [communityRecurring]);
    const event = resolved.find((e) => e.id === "user-comm1")!;
    expect(event.title).toBe("Thursday Twilight Loop");
    expect(event.location).toBe("Cosmo Park");
  });
});

describe("EventDetailPage — post-save refresh wiring (source contract, G1.1)", () => {
  it("applies preferCanonicalFields to the merged list BEFORE date resolution", async () => {
    const s = await source();
    expect(s).toContain("preferCanonicalFields");
    expect(s).toContain("resolveWeekEvents([...city.events, ...canonical, ...recurring].map((e) => preferCanonicalFields(e, canonicalEvents)), new Date())");
  });

  it("success still replaces the saved record in canonicalEvents (re-render source)", async () => {
    const s = await source();
    expect(s).toContain("setCanonicalEvents((cur) => (cur ? cur.map((e) => (e.id === r.data.event.id ? r.data.event : e)) : cur));");
  });
});
