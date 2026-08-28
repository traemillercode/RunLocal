import { apiHandler, SESSION_COOKIE } from "./src/server/api";
import { createMemoryStore } from "./src/server/store";
import { seedContentRegistry } from "./src/server/contentSeed";
import { resolveWeekEvents, mergeWeekEventSources, occurrenceHasStarted, occurrenceIdFor, bareEventId } from "./src/lib/dates";
import type { IncomingMessage, ServerResponse } from "node:http";

function req(method: string, path: string, cookie?: string, body?: unknown): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  let sent = false;
  const headers: Record<string, string> = { "x-forwarded-proto": "https", ...(raw ? { "content-type": "application/json" } : {}) };
  if (cookie) headers.cookie = cookie;
  return { method, url: path, headers, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]() { return { next: async () => sent ? { done: true as const, value: undefined } : (sent = true, { done: false as const, value: Buffer.from(raw) }) }; } } as unknown as IncomingMessage;
}
function response() {
  const out = { status: 0, body: "" };
  const res = { writeHead(status: number) { out.status = status; return res; }, setHeader() { return res; }, end(value?: unknown) { if (value !== undefined) out.body += String(value); return res; } } as unknown as ServerResponse;
  return { res, out };
}
async function call(db: any, method: string, path: string, cookie?: string, body?: unknown) {
  const { res, out } = response();
  await apiHandler(req(method, path, cookie, body), res, db);
  return { status: out.status, body: out.body ? JSON.parse(out.body) : {} };
}

async function main() {
  const db = createMemoryStore();
  seedContentRegistry(db);

  const account = db.createAccount({ name: "Debug Runner", email: "debugrunner@example.com", cityId: "columbia-mo" });
  db.updateAccount(account.id, { status: "verified" });
  const session = db.createSession(account.id, "127.0.0.1");
  const cookie = `${SESSION_COOKIE}=${session.id}`;

  const canonicalRes = await call(db, "GET", "/api/events?city=columbia-mo", cookie);
  const canonicalEvents = canonicalRes.body.events;

  const city = db.listCities ? db.listCities().find((c: any) => c.id === "columbia-mo") : null;
  const cityEvents = city?.events ?? [];

  const merged = mergeWeekEventSources(cityEvents, canonicalEvents, []);
  const today = new Date();
  const weekEvents = resolveWeekEvents(merged, today).filter((e) => e.groupId !== "" && !occurrenceHasStarted(e, today));

  console.log(`Resolved ${weekEvents.length} week events:`);
  weekEvents.forEach((e, i) => {
    const dateStr = e.date.toISOString().slice(0, 10);
    console.log(`  ${i}: "${e.title}" id=${e.id} date=${dateStr}`);
  });

  if (weekEvents.length < 2) { console.log("Fewer than 2 - cannot test the real second event."); return; }

  for (let i = 0; i < Math.min(3, weekEvents.length); i++) {
    const ev = weekEvents[i];
    const dateStr = ev.date.toISOString().slice(0, 10);
    const occId = occurrenceIdFor(bareEventId(ev.id), dateStr);
    const match = /^event:(.+):(\d{4}-\d{2}-\d{2})$/.exec(occId);
    if (!match) { console.log(`Event ${i}: PARSE FAILURE on occurrenceId ${occId}`); continue; }
    const [, eventId, runDate] = match;
    const rsvpRes = await call(db, "POST", "/api/events/rsvp", cookie, { eventId, rsvp: true, runDate });
    console.log(`\nEvent ${i} ("${ev.title}") RSVP attempt: status=${rsvpRes.status}`, JSON.stringify(rsvpRes.body));
  }
}
main();
