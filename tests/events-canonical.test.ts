import { afterEach, describe, expect, it } from "vitest";
import { CITIES } from "../src/data/cities";
import { createEvent, editEvent, listAdminEvents, materializeSeedEvents, publicEvents, transitionEvent } from "../src/server/events";
import { resolveOccurrence } from "../src/server/occurrences";
import { createMemoryStore } from "../src/server/store";
import type { AdminCtx } from "../src/server/admin";

const oldKey = process.env.RUN_LOCAL_ADMIN_KEY;
const ctx = (db: ReturnType<typeof createMemoryStore>, reason = "canonical event maintenance"): AdminCtx => ({ adminSessionId: db.createSession("__admin__", "198.51.100.1").id, userSessionId: null, reason, ip: "198.51.100.1" });
afterEach(() => { if (oldKey === undefined) delete process.env.RUN_LOCAL_ADMIN_KEY; else process.env.RUN_LOCAL_ADMIN_KEY = oldKey; });

describe("canonical group-run registry", () => {
  it("materializes seed events idempotently and public filtering is authoritative", () => {
    const db = createMemoryStore();
    materializeSeedEvents(db, CITIES);
    const first = db.listEvents().length;
    materializeSeedEvents(db, CITIES);
    expect(db.listEvents()).toHaveLength(first);
    const published = publicEvents(db, CITIES[0].id);
    expect(published.every((e) => e.status === "published" && !e.hidden)).toBe(true);
  });

  it("audits the full create/edit/approve/publish/hide/unhide/archive lifecycle", () => {
    process.env.RUN_LOCAL_ADMIN_KEY = "test-canonical-key";
    const db = createMemoryStore(); const admin = ctx(db);
    const created = createEvent(db, admin, { cityId: "columbia-mo", groupId: "g1", title: "Test run", dayOfWeek: 2, time: "18:00", location: "Park", distanceLabel: "5K", invite: "Open to all" });
    expect(created.ok).toBe(true); if (!created.ok) return;
    expect(editEvent(db, admin, created.data.id, { title: "Edited run" }).ok).toBe(true);
    for (const action of ["approve", "publish", "hide", "unhide"] as const) expect(transitionEvent(db, admin, created.data.id, action).ok).toBe(true);
    expect(transitionEvent(db, admin, created.data.id, "archive").ok).toBe(true);
    expect(publicEvents(db, "columbia-mo").some((e) => e.id === created.data.id)).toBe(false);
    expect(db.listAudit().some((a) => a.action === "admin.event_archive" && a.reason === "canonical event maintenance")).toBe(true);
  });

  it("denies a city filter to a city-admin outside its scope", () => {
    const db = createMemoryStore();
    const account = db.createAccount({ name: "City admin", email: "city@example.com", username: "cityadmin" });
    db.updateAccount(account.id, { status: "verified", role: "city_admin", adminCityId: "columbia-mo" });
    const session = db.createSession(account.id, "198.51.100.2");
    const result = listAdminEvents(db, { adminSessionId: null, userSessionId: session.id, reason: "review another city", ip: "198.51.100.2" }, "kansas-city-mo");
    expect(result).toMatchObject({ ok: false, status: 403, error: "city_scope_denied" });
  });
});

// Group → Event model: one Group hosts MULTIPLE independent events (recurring
// and/or one-time) with NO single-series constraint. A regression here fails if
// anyone adds a unique-groupId rule, a per-group collapse, or a "one event per
// group" validation anywhere in the store/API/occurrence pipeline.
describe("Group → Event: multiple independent events per group", () => {
  it("seed data materializes several independent events per group", () => {
    const db = createMemoryStore();
    materializeSeedEvents(db, CITIES);
    const byGroup = (groupId: string) =>
      db.listEvents().filter((e) => e.cityId === "columbia-mo" && e.groupId === groupId);
    expect(byGroup("runcomo").map((e) => e.seedRefId).sort()).toEqual(["mon-social", "sun-recovery", "wed-hills"]);
    expect(byGroup("ctc").map((e) => e.seedRefId).sort()).toEqual(["sat-long", "tue-track"]);
    const published = publicEvents(db, "columbia-mo");
    expect(published.filter((e) => e.groupId === "runcomo")).toHaveLength(3);
    expect(published.filter((e) => e.groupId === "ctc")).toHaveLength(2);
  });

  it("admin createEvent accepts multiple independent recurring events for the same group", () => {
    process.env.RUN_LOCAL_ADMIN_KEY = "test-canonical-key";
    const db = createMemoryStore(); const admin = ctx(db);
    const first = createEvent(db, admin, { cityId: "columbia-mo", groupId: "g1", title: "Tuesday speedwork", dayOfWeek: 1, time: "6:00 PM", location: "Track", distanceLabel: "Intervals", invite: "Open to all" });
    const second = createEvent(db, admin, { cityId: "columbia-mo", groupId: "g1", title: "Thursday easy run", dayOfWeek: 3, time: "6:00 PM", location: "Trailhead", distanceLabel: "3–5 mi", invite: "Open to all" });
    expect(first.ok).toBe(true); expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // New events start as drafts; approve + publish before they are public.
    for (const id of [first.data.id, second.data.id]) {
      expect(transitionEvent(db, admin, id, "approve").ok).toBe(true);
      expect(transitionEvent(db, admin, id, "publish").ok).toBe(true);
    }
    const groupEvents = db.listEvents().filter((e) => e.groupId === "g1");
    expect(groupEvents).toHaveLength(2);
    expect(new Set(groupEvents.map((e) => e.id)).size).toBe(2);
    const pub = publicEvents(db, "columbia-mo").filter((e) => e.groupId === "g1");
    expect(pub.map((e) => e.title).sort()).toEqual(["Thursday easy run", "Tuesday speedwork"]);
    // Each event resolves to its OWN occurrence on its own weekday — no collapse.
    const tue = resolveOccurrence(db, first.data.id, "2026-08-04")!; // Tuesday
    const thu = resolveOccurrence(db, second.data.id, "2026-08-06")!; // Thursday
    expect(tue.eventId).not.toBe(thu.eventId);
    expect(tue.occurrenceId).not.toBe(thu.occurrenceId);
    expect(tue.occurrenceId).toBe(`event:${first.data.id}:2026-08-04`);
    expect(thu.occurrenceId).toBe(`event:${second.data.id}:2026-08-06`);
  });

  it("a group can host a recurring event and a one-time event side by side", () => {
    process.env.RUN_LOCAL_ADMIN_KEY = "test-canonical-key";
    const db = createMemoryStore(); const admin = ctx(db);
    const recurring = createEvent(db, admin, { cityId: "columbia-mo", groupId: "g2", title: "Weekly Wednesday", dayOfWeek: 2, time: "6:00 PM", location: "Park", distanceLabel: "3 mi", invite: "Open to all" });
    expect(recurring.ok).toBe(true); if (!recurring.ok) return;
    expect(transitionEvent(db, admin, recurring.data.id, "approve").ok).toBe(true);
    expect(transitionEvent(db, admin, recurring.data.id, "publish").ok).toBe(true);
    // Model-level one-time record under the SAME groupId (the data model carries
    // scheduleDate + recurrenceType; store/API/occurrence layers must not reject
    // the mix).
    db.setEvent({ id: "event:user-g2-onetime", seedRefId: null, cityId: "columbia-mo", groupId: "g2", title: "One-off 10K shakeout", dayOfWeek: -1, scheduleDate: "2026-09-20", recurrenceType: "one_time", time: "9:00 AM", location: "Cosmo Park", distanceLabel: "6 mi", invite: "RSVP requested", externalUrl: null, provenance: "community", status: "published", hidden: false, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", createdBy: "a1", updatedBy: "admin", archivedAt: null });
    const groupEvents = db.listEvents().filter((e) => e.groupId === "g2");
    expect(groupEvents).toHaveLength(2);
    expect(groupEvents.some((e) => e.recurrenceType === "one_time" && e.scheduleDate === "2026-09-20")).toBe(true);
    expect(groupEvents.some((e) => e.id === recurring.data.id && e.dayOfWeek === 2)).toBe(true);
    const pub = publicEvents(db, "columbia-mo").filter((e) => e.groupId === "g2");
    expect(pub.map((e) => e.title).sort()).toEqual(["One-off 10K shakeout", "Weekly Wednesday"]);
    // The one-time occurrence exists ONLY on its exact schedule date.
    const oneTimeOcc = resolveOccurrence(db, "event:user-g2-onetime", "2026-09-20");
    expect(oneTimeOcc).not.toBeNull();
    expect(oneTimeOcc?.occurrenceId).toBe("event:user-g2-onetime:2026-09-20");
    expect(resolveOccurrence(db, "event:user-g2-onetime", "2026-09-21")).toBeNull();
    // The recurring event still resolves independently in that same week.
    const wed = resolveOccurrence(db, recurring.data.id, "2026-09-16")!; // Wednesday
    expect(wed.occurrenceId).toBe(`event:${recurring.data.id}:2026-09-16`);
    expect(wed.occurrenceId).not.toBe(oneTimeOcc?.occurrenceId);
  });
});
