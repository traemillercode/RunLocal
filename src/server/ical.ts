/**
 * Private iCalendar (RFC 5545) export for the runner's own upcoming My Runs.
 *
 * TIMESTAMP / TIMEZONE ASSUMPTION (documented, test-locked):
 * Run Local stores run start times as the same local wall-clock labels the app
 * displays (e.g. "6:00 PM" for Columbia, MO), encoded in UTC-formatted fields
 * (`startsAt` = `YYYY-MM-DDTHH:MM:SS.000Z`). This module emits those wall-clock
 * values as FLOATING local times — `DTSTART:20260810T180000` with no `Z` and no
 * `TZID` — so calendar apps (Google / Outlook / Apple) render them in the
 * reader's own timezone and a Columbia runner sees the same 6:00 PM the app
 * shows. This matches the app's existing UTC-field convention for both RSVP
 * occurrences and solo runs, and avoids hardcoding a city timezone while the
 * city model is extensible. Provider-side timezone-aware sync is explicitly
 * out of scope (owner decision: ICS export only).
 *
 * PRIVACY: the endpoint requires a verified session and the export is built
 * exclusively from the caller's own rows (`listMyRuns`), so no other runner's
 * data can appear. `CLASS:PRIVATE` hints calendars to keep events private.
 */

/** Default run duration when an event has no duration field (60 minutes). */
export const RUN_DURATION_MINUTES = 60;
/** Maximum octets per ICS line before RFC 5545 folding (75, excl. CRLF). */
const LINE_LIMIT = 75;

export interface IcsRun {
  id: string;
  kind: "rsvp" | "solo";
  title: string;
  startsAt: string | null;
  location: string;
}

/** Escape a TEXT property value per RFC 5545 (backslash, semicolon, comma, newline). */
export function escapeIcalText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Date-stamped, ASCII-safe download filename (`runlocal-my-runs-YYYY-MM-DD.ics`)
 * built from the LOCAL wall-clock date, so re-exports never collide on import
 * and the file is identifiable in a downloads folder. The server uses it for
 * `Content-Disposition`; the client mirrors the same name in the `download`
 * attribute (some browsers prefer one over the other, so both carry it).
 */
export function myRunsIcsFilename(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `runlocal-my-runs-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.ics`;
}

/**
 * Format an ISO instant as a floating (timezone-less) `YYYYMMDDTHHMMSS` local
 * time, using the UTC wall-clock fields exactly as the app's display labels do.
 * Returns "" for unparseable input.
 */
export function toIcalDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/**
 * RFC 5545 line folding: fold every logical line (already CRLF-terminated)
 * longer than 75 octets into continuations, each prefixed with a single space.
 * Cuts only at UTF-8 code-point boundaries.
 */
export function foldIcalText(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\r\n")) {
    if (line === "") {
      out.push("");
      continue;
    }
    let rest = line;
    while (Buffer.byteLength(rest, "utf8") > LINE_LIMIT) {
      let prefix = "";
      let octets = 0;
      for (const ch of rest) {
        const b = Buffer.byteLength(ch, "utf8");
        if (octets + b > LINE_LIMIT) break;
        prefix += ch;
        octets += b;
      }
      if (!prefix) prefix = rest.slice(0, 1); // never loop forever on an over-long code point
      out.push(prefix);
      rest = " " + rest.slice(prefix.length);
    }
    out.push(rest);
  }
  return out.join("\r\n");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** RFC 5545 UTC instant with `Z` (used for DTSTAMP, which must be UTC). */
function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/**
 * Build a complete `.ics` document for the given runs. Only the caller passes
 * pre-filtered, caller-owned rows; this function emits one VEVENT per run with
 * a stable UID (`myrun-<rowId>@runlocal`) so re-imports don't duplicate.
 * Runs without a parseable start time are skipped defensively.
 */
export function buildMyRunsIcs(runs: IcsRun[], now = new Date()): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Run Local//My Runs//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Run Local — My Runs",
  ];
  for (const run of runs) {
    if (!run.startsAt) continue;
    const start = toIcalDateTime(run.startsAt);
    if (!start) continue;
    const startMs = Date.parse(run.startsAt);
    const end = toIcalDateTime(new Date(startMs + RUN_DURATION_MINUTES * 60 * 1000).toISOString());
    lines.push(
      "BEGIN:VEVENT",
      `UID:myrun-${run.id}@runlocal`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeIcalText(run.title)}`,
      ...(run.location ? [`LOCATION:${escapeIcalText(run.location)}`] : []),
      `DESCRIPTION:${run.kind === "solo" ? "Added from Run Local. Private solo run." : "Added from Run Local. Private RSVP for this occurrence."}`,
      "CLASS:PRIVATE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return foldIcalText(lines.join("\r\n") + "\r\n");
}
