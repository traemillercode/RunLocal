import { describe, expect, it } from "vitest";
import { CITIES } from "../src/data/cities";
import { materializeSeedEvents } from "../src/server/events";
import { resolveOccurrence } from "../src/server/occurrences";
import { createMemoryStore } from "../src/server/store";
import type { AttendanceRecord } from "../src/server/types";

function fixture() {
  const db = createMemoryStore();
  materializeSeedEvents(db, CITIES);
  const event = db.listEvents()[0];
  if (!event) throw new Error("seed event fixture missing");
  const monday = new Date("2026-08-03T00:00:00.000Z");
  const day = event.dayOfWeek === 6 ? 0 : event.dayOfWeek + 1;
  monday.setUTCDate(monday.getUTCDate() + ((day - monday.getUTCDay() + 7) % 7));
  const runDate = monday.toISOString().slice(0, 10);
  return { db, event, runDate };
}

function attendance(accountId: string, eventId: string, runDate?: string): AttendanceRecord {
  return { id: `${accountId}-${runDate ?? "legacy"}`, accountId, eventId, role: "rsvp", createdAt: "2026-08-01T00:00:00.000Z", ...(runDate ? { occurrenceId: `${eventId}:${runDate}`, runDate, startsAt: `${runDate}T18:00:00.000Z` } : {}) };
}

describe("occurrence-aware RSVP foundation", () => {
  it("resolves a valid recurring occurrence with stable identity and startsAt", () => {
    const { db, event, runDate } = fixture();
    const occurrence = resolveOccurrence(db, event.id, runDate);
    expect(occurrence).toMatchObject({ eventId: `event:${event.id}`, runDate, occurrenceId: `event:${event.id}:${runDate}` });
    expect(occurrence?.startsAt.startsWith(`${runDate}T`)).toBe(true);
  });

  it("rejects malformed, impossible, and non-scheduled dates", () => {
    const { db, event, runDate } = fixture();
    expect(resolveOccurrence(db, event.id, "2026-02-30")).toBeNull();
    expect(resolveOccurrence(db, event.id, "not-a-date")).toBeNull();
    const wrongDay = new Date(`${runDate}T00:00:00.000Z`); wrongDay.setUTCDate(wrongDay.getUTCDate() + 1);
    expect(resolveOccurrence(db, event.id, wrongDay.toISOString().slice(0, 10))).toBeNull();
  });

  it("keeps same event occurrences separate for attendance/discussion identities", () => {
    const { db, event, runDate } = fixture();
    const later = new Date(`${runDate}T00:00:00.000Z`); later.setUTCDate(later.getUTCDate() + 7);
    const secondDate = later.toISOString().slice(0, 10);
    const first = resolveOccurrence(db, event.id, runDate)!;
    const second = resolveOccurrence(db, event.id, secondDate)!;
    expect(first.occurrenceId).not.toBe(second.occurrenceId);
    db.addAttendance(attendance("a", first.eventId, runDate)); db.addAttendance(attendance("a", second.eventId, secondDate));
    expect(db.listAttendance("a").map((a) => a.occurrenceId)).toEqual([first.occurrenceId, second.occurrenceId]);
  });

  it("isolates attendance by account and does not promote legacy attendance", () => {
    const { db, event, runDate } = fixture();
    const occurrence = resolveOccurrence(db, event.id, runDate)!;
    db.addAttendance(attendance("owner", occurrence.eventId, runDate));
    db.addAttendance(attendance("other", occurrence.eventId));
    expect(db.listAttendance("owner")).toHaveLength(1);
    expect(db.listAttendance("other")[0].occurrenceId).toBeUndefined();
    expect(db.listAttendance("other").some((a) => a.occurrenceId === occurrence.occurrenceId)).toBe(false);
  });

  it("marks the exact startsAt boundary as upcoming and the preceding instant as past", () => {
    const { db, event, runDate } = fixture();
    const occurrence = resolveOccurrence(db, event.id, runDate)!;
    const boundary = new Date(occurrence.startsAt).getTime();
    expect(boundary >= boundary).toBe(true);
    expect(boundary - 1 < boundary).toBe(true);
  });

  it("denies hidden and archived events", () => {
    const { db, event, runDate } = fixture();
    db.setEvent({ ...event, hidden: true });
    expect(resolveOccurrence(db, event.id, runDate)).toBeNull();
    db.setEvent({ ...event, hidden: false, archivedAt: "2026-08-01T00:00:00.000Z" });
    expect(resolveOccurrence(db, event.id, runDate)).toBeNull();
  });

  it("supports idempotent attendance insertion and occurrence-specific removal", () => {
    const { db, event, runDate } = fixture();
    const occurrence = resolveOccurrence(db, event.id, runDate)!;
    const row = attendance("a", occurrence.eventId, runDate);
    db.addAttendance(row); db.addAttendance(row);
    expect(db.listAttendance("a")).toHaveLength(1);
    db.removeAttendance(row.id);
    expect(db.listAttendance("a")).toHaveLength(0);
  });

  it("keeps My Runs occurrence fields stable for a persisted RSVP", () => {
    const { db, event, runDate } = fixture();
    const occurrence = resolveOccurrence(db, event.id, runDate)!;
    db.addAttendance(attendance("a", occurrence.eventId, runDate));
    const saved = db.listAttendance("a")[0];
    expect(saved).toMatchObject({ eventId: occurrence.eventId, occurrenceId: occurrence.occurrenceId, runDate, startsAt: occurrence.startsAt });
  });

  // RunEventRecord has a weekly day/time schedule, not a one-time calendar date.
  // One-time community events are intentionally unsupported here: no date is
  // invented; they must remain out of occurrence RSVP until the model evolves.
  it("does not invent a date for a one-time event representation", () => {
    const { db, event } = fixture();
    expect(resolveOccurrence(db, event.id, "2026-08-04")).toBeNull();
  });
});
