import type { DatedRunEvent } from "./dates";
import { occurrenceIdFor, bareEventId } from "./dates";
import type { RunEvent as DepartureRunEvent, Person } from "../components/DepartureBoard";
import type { AttendanceSummaryEntry } from "./api";
import type { City } from "../types";

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parses "6:00 PM" style stored time strings into 24-hour hour/minute. Falls back to a safe default rather than throwing on anything malformed - a display glitch beats a crashed board. */
function parseTimeString(time: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(time.trim());
  if (!match) return { hour: 8, minute: 0 };
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return { hour, minute };
}

const TONE_COUNT = 4;

/**
 * Converts one resolved weekly event (real store data, already filtered for
 * hidden/started/moderation upstream) plus its bulk attendance summary into
 * DepartureBoard's own RunEvent contract. This is the seam the handoff asked
 * for - the component itself never sees raw storage fields.
 *
 * Independent runs (event.groupId === "") should be filtered out BEFORE
 * calling this, not inside it - DepartureBoard's whole visual language
 * (host, attendee stack, going count) assumes a real trackable group event
 * with a host, which an independent run doesn't have in the same sense.
 *
 * Known, honest gaps (see the handoff's open decisions - not silently
 * papered over):
 *  - type: no classification field exists yet on a stored event; everything
 *    maps to "group" until a real track/long/trail distinction is added to
 *    the event record itself.
 *  - paceLow/paceHigh: no pace range is stored at the event level anywhere
 *    (only a free-text per-ACCOUNT paceLabel exists) - always "All"/"paces",
 *    which is honest given what's actually stored, not a placeholder.
 *  - routePath: routes are stored as GPX (RouteRecord.gpxRef), not an SVG
 *    path in this component's 60x200 viewBox. No decoder exists yet, so
 *    this is always null until one is built server-side, exactly as the
 *    handoff's own open-decisions section specifies.
 *  - priceCents: no event carries a real price yet - always 0, so
 *    startCheckout's honest "not built yet" path is what actually runs
 *    if this ever changes before real Stripe wiring exists.
 */
export function mapRunEvent(event: DatedRunEvent, city: City, summary: AttendanceSummaryEntry | undefined): DepartureRunEvent {
  const dateStr = toDateStr(event.date);
  const occurrenceId = occurrenceIdFor(bareEventId(event.id), dateStr);
  const { hour, minute } = parseTimeString(event.time);
  const startsAt = new Date(event.date);
  startsAt.setHours(hour, minute, 0, 0);

  const host = summary?.host
    ? { name: summary.host.name, initials: summary.host.initials }
    : { name: "Community Run", initials: "CR" };
  const attendees: Person[] = (summary?.attendees ?? []).map((a, i) => ({ id: a.accountId, initials: a.initials, tone: i % TONE_COUNT }));

  return {
    id: occurrenceId,
    name: event.title,
    type: "group",
    startsAt,
    venue: event.location,
    area: city.name,
    paceLow: "All",
    paceHigh: "paces",
    detail: event.distanceLabel,
    host,
    attendees,
    goingCount: summary?.goingCount ?? 0,
    routePath: null,
    priceCents: 0,
  };
}
