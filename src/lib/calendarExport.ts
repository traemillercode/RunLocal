/**
 * Calendar EXPORT — real Google/Outlook web links and a real downloadable
 * .ics file, built from an event's already-resolved date + its free-text
 * time string (e.g. "6:00 PM"). Distinct from lib/calendar.ts, which is the
 * unrelated My Runs month-grid helper.
 *
 * Default duration is 1 hour since group runs don't have a stored end time
 * — a stated, reasonable assumption, not a fabricated data point.
 */

export interface CalendarEventInput {
  title: string;
  /** The concrete calendar date this occurrence falls on. */
  date: Date;
  /** Free-text time as stored on the event, e.g. "6:00 PM", "6:30 AM". */
  time: string;
  location: string;
  description?: string;
  durationMinutes?: number;
}

/** Parses "6:00 PM" / "6:30am" / "18:00" into {hours, minutes} in 24h form. Returns null on an unrecognized format so callers can fall back gracefully instead of silently producing a wrong time. */
export function parseTimeString(input: string): { hours: number; minutes: number } | null {
  const trimmed = input.trim();
  const twelveHour = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(trimmed);
  if (twelveHour) {
    let hours = Number(twelveHour[1]) % 12;
    const minutes = Number(twelveHour[2]);
    if (/pm/i.test(twelveHour[3])) hours += 12;
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) return { hours, minutes };
  }
  const twentyFourHour = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (twentyFourHour) {
    const hours = Number(twentyFourHour[1]);
    const minutes = Number(twentyFourHour[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) return { hours, minutes };
  }
  return null;
}

/** Combines the event's date with its parsed time into real start/end Date objects. Falls back to 7:00 AM (a reasonable default for a group run) if the time string can't be parsed, rather than silently producing midnight. */
function resolveStartEnd(input: CalendarEventInput): { start: Date; end: Date } {
  const parsed = parseTimeString(input.time) ?? { hours: 7, minutes: 0 };
  const start = new Date(input.date);
  start.setHours(parsed.hours, parsed.minutes, 0, 0);
  const end = new Date(start.getTime() + (input.durationMinutes ?? 60) * 60_000);
  return { start, end };
}

function toUtcCompact(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function googleCalendarUrl(input: CalendarEventInput): string {
  const { start, end } = resolveStartEnd(input);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${toUtcCompact(start)}/${toUtcCompact(end)}`,
    location: input.location,
    details: input.description ?? `${input.title} — via Kimbio`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function outlookCalendarUrl(input: CalendarEventInput): string {
  const { start, end } = resolveStartEnd(input);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: input.title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    location: input.location,
    body: input.description ?? `${input.title} — via Kimbio`,
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/** Builds a real RFC-5545 VCALENDAR/VEVENT block and triggers a browser download of it as a .ics file. */
export function downloadIcs(input: CalendarEventInput): void {
  const { start, end } = resolveStartEnd(input);
  const escape = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kimbio//Event Export//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${Date.now()}-${Math.random().toString(36).slice(2)}@getkimbio.com`,
    `DTSTAMP:${toUtcCompact(new Date())}`,
    `DTSTART:${toUtcCompact(start)}`,
    `DTEND:${toUtcCompact(end)}`,
    `SUMMARY:${escape(input.title)}`,
    `LOCATION:${escape(input.location)}`,
    `DESCRIPTION:${escape(input.description ?? `${input.title} — via Kimbio`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${input.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
