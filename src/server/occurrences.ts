import type { Db } from "./store";
import type { RunEventRecord } from "./types";
import { CITIES } from "../data/cities";

export interface EventOccurrence { eventId: string; runDate: string; occurrenceId: string; startsAt: string; event: RunEventRecord | null; }
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s: string): boolean { if (!DATE.test(s)) return false; const d = new Date(`${s}T00:00:00.000Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === s; }
function startsAt(date: string, time: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (!m) return `${date}T00:00:00.000Z`;
  let h = Number(m[1]) % 12; if (m[3].toUpperCase() === "PM") h += 12;
  return `${date}T${String(h).padStart(2,"0")}:${m[2]}:00.000Z`;
}
export function resolveOccurrence(db: Db, requestedEventId: string, runDate: string, _now: Date): EventOccurrence | null {
  const raw = requestedEventId.replace(/^event:/, "");
  const dbEvent = db.listEvents().find(e => e.id === requestedEventId || e.id === raw || e.seedRefId === raw);
  const seed = CITIES.flatMap(c => c.events.map(e => ({ e, cityId:c.id }))).find(x => x.e.id === raw);
  const event = dbEvent ?? (seed ? ({ id:`event:${seed.e.id}`, seedRefId:seed.e.id, cityId:seed.cityId, groupId:seed.e.groupId, title:seed.e.title, dayOfWeek:seed.e.dayOfWeek, time:seed.e.time, location:seed.e.location, distanceLabel:seed.e.distanceLabel, invite:seed.e.invite, externalUrl:seed.e.externalUrl ?? null, provenance:"seed", status:"published", hidden:false, createdAt:"", updatedAt:"", createdBy:"seed", updatedBy:"seed", archivedAt:null } as RunEventRecord) : null);
  if (!event || event.hidden || event.archivedAt || event.status !== "published" || !validDate(runDate)) return null;
  const d = new Date(`${runDate}T00:00:00.000Z`);
  if (event.dayOfWeek !== d.getUTCDay() - 1 && !(event.dayOfWeek === 6 && d.getUTCDay() === 0)) return null;
  const eventId = event.id.startsWith("event:") ? event.id : `event:${event.id}`;
  return { eventId, runDate, occurrenceId:`${eventId}:${runDate}`, startsAt:startsAt(runDate,event.time), event };
}
export function defaultOccurrenceDate(event: RunEventRecord, now: Date): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const current = (d.getUTCDay()+6)%7; const delta = (event.dayOfWeek-current+7)%7; d.setUTCDate(d.getUTCDate()+delta); return d.toISOString().slice(0,10);
}
