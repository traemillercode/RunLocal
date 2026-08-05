import { afterEach, describe, expect, it } from "vitest";
import { CITIES } from "../src/data/cities";
import { createEvent, editEvent, listAdminEvents, materializeSeedEvents, publicEvents, transitionEvent } from "../src/server/events";
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
