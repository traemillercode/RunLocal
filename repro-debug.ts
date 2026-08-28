import { resolveWeekEvents, mergeWeekEventSources, occurrenceHasStarted, occurrenceIdFor, bareEventId } from "./src/lib/dates";

async function main() {
  const res = await fetch("http://localhost:8741/api/events?city=columbia-mo");
  const data = await res.json();
  const canonicalEvents = data.events;

  // city.events is empty in this bare local test (no seed city registry file loaded) - matches
  // real behavior closely enough since canonicalEvents already carries the seed rows materialized.
  const merged = mergeWeekEventSources([], canonicalEvents, []);
  const today = new Date();
  const weekEvents = resolveWeekEvents(merged, today)
    .filter((e) => e.groupId !== "" && !occurrenceHasStarted(e, today));

  console.log("Resolved week events, in board order:");
  weekEvents.forEach((e, i) => {
    const dateStr = e.date.toISOString().slice(0, 10);
    const occId = occurrenceIdFor(bareEventId(e.id), dateStr);
    console.log(`${i}: id=${e.id} bareId=${bareEventId(e.id)} title="${e.title}" date=${dateStr} occurrenceId=${occId}`);
  });

  if (weekEvents.length < 2) { console.log("Fewer than 2 events resolved this week - can't reproduce 'second event' directly."); return; }

  const second = weekEvents[1];
  const dateStr = second.date.toISOString().slice(0, 10);
  const occId = occurrenceIdFor(bareEventId(second.id), dateStr);
  console.log("\n--- Testing RSVP for the second event ---");
  console.log("occurrenceId:", occId);

  const match = /^event:(.+):(\d{4}-\d{2}-\d{2})$/.exec(occId);
  if (!match) { console.log("PARSE FAILURE: occurrenceId did not match the expected pattern at all!"); return; }
  const [, eventId, runDate] = match;
  console.log("Parsed eventId:", eventId, "runDate:", runDate);

  // Need a real signed-in, verified session to RSVP - create one via the test-only account path if available, else report.
  console.log("\n(Manual verification of the actual RSVP call requires an authenticated session - see next step)");
}
main();
