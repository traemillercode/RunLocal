import { newId } from "./store";
import type { AdminCtx, AdminResult } from "./admin";
import { authorizeScoped, routineAdminCtx } from "./admin";
import type { Db } from "./store";
import type { InviteLabel } from "../types";
import { CITIES } from "../data/cities";
import type { RunEventRecord } from "./types";
import { pacePolicyFromLabel } from "../types";

const statuses = ["draft", "approved", "published", "hidden", "archived"] as const;
function valid(input: Partial<RunEventRecord>): string | null {
  if (!input.cityId || typeof input.title !== "string" || !input.title.trim() || typeof input.groupId !== "string" || !input.groupId.trim()) return "invalid_event";
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek! < 0 || input.dayOfWeek! > 6) return "invalid_event";
  if (typeof input.time !== "string" || typeof input.location !== "string" || typeof input.distanceLabel !== "string") return "invalid_event";
  if (!(statuses as readonly string[]).includes(String(input.status))) return "invalid_status";
  if (!(<[string, ...string[]]>["Open to all", "Members + guests", "RSVP requested"] as readonly string[]).includes(String(input.invite))) return "invalid_invite";
  return null;
}
export function materializeSeedEvents(db: Db, cities = CITIES, now = new Date()): void {
  for (const city of cities) for (const e of city.events) {
    if (db.listEvents().some((existing) => existing.seedRefId === e.id)) continue;
    db.setEvent({ id: newId(), seedRefId: e.id, cityId: city.id, groupId: e.groupId, title: e.title, dayOfWeek: e.dayOfWeek, time: e.time, location: e.location, distanceLabel: e.distanceLabel, pacePolicy: pacePolicyFromLabel(e.distanceLabel), invite: e.invite, externalUrl: e.externalUrl ?? null, provenance: "seed", status: "published", hidden: false, createdAt: now.toISOString(), updatedAt: now.toISOString(), createdBy: "seed", updatedBy: "seed", archivedAt: null });
  }
}
/**
 * Records written before pacePolicy existed carry no value. Rather than render
 * an empty badge, resolve one from the legacy "Distance / pace" free text at
 * read time. Stored values always win; null means the host genuinely said
 * nothing about pace.
 */
export function withResolvedPacePolicy(e: RunEventRecord): RunEventRecord {
  return e.pacePolicy === undefined ? { ...e, pacePolicy: pacePolicyFromLabel(e.distanceLabel) } : e;
}
export function publicEvents(db: Db, cityId?: string): RunEventRecord[] { return db.listEvents().filter(e => (!cityId || e.cityId === cityId) && e.status === "published" && !e.hidden && !e.archivedAt).map(withResolvedPacePolicy); }
export function listAdminEvents(db: Db, ctx: AdminCtx, cityId?: string, now = new Date()): AdminResult<RunEventRecord[]> {
  // Routine read: audited with the server-generated routine reason — no operator prompt.
  const a = authorizeScoped(db, routineAdminCtx(ctx), "admin.event_list", null, now, { enforceCity: cityId ?? undefined, auditCity: cityId ?? null }); if (!a.ok) return a;
  return { ok: true, data: db.listEvents().filter(e => !cityId || e.cityId === cityId) };
}
export type EventInput = Partial<Pick<RunEventRecord,"cityId"|"groupId"|"title"|"dayOfWeek"|"time"|"location"|"distanceLabel"|"pacePolicy"|"invite"|"externalUrl">>;
export function createEvent(db: Db, ctx: AdminCtx, input: EventInput, now = new Date()): AdminResult<RunEventRecord> {
  const cityId = input.cityId ?? null; const a = authorizeScoped(db, ctx, "admin.event_create", null, now, { enforceCity: cityId }); if (!a.ok) return a;
  const rec: RunEventRecord = { id:newId(), seedRefId:null, cityId:cityId!, groupId:input.groupId??"", title:input.title??"", dayOfWeek:input.dayOfWeek??-1, time:input.time??"", location:input.location??"", distanceLabel:input.distanceLabel??"", pacePolicy:input.pacePolicy ?? pacePolicyFromLabel(input.distanceLabel), invite:(input.invite??"Open to all") as InviteLabel, externalUrl:input.externalUrl??null, provenance:"admin", status:"draft", hidden:false, createdAt:now.toISOString(), updatedAt:now.toISOString(), createdBy:a.data.accountId??a.data.admin, updatedBy:a.data.accountId??a.data.admin, archivedAt:null };
  const bad=valid(rec); if(bad)return {ok:false,status:400,error:bad}; db.setEvent(rec); return {ok:true,data:rec};
}
export function editEvent(db: Db, ctx: AdminCtx, id: string, patch: EventInput, now = new Date()): AdminResult<RunEventRecord> {
  const prev=db.getEvent(id); if(!prev)return {ok:false,status:404,error:"not_found"}; const a=authorizeScoped(db,ctx,"admin.event_edit",id,now,{enforceCity:prev.cityId,auditCity:prev.cityId});if(!a.ok)return a;
  const next={...prev,...patch,updatedAt:now.toISOString(),updatedBy:a.data.accountId??a.data.admin}; const bad=valid(next);if(bad)return {ok:false,status:400,error:bad};db.setEvent(next);return {ok:true,data:next};
}
export function transitionEvent(db: Db, ctx: AdminCtx, id: string, action: "approve"|"publish"|"hide"|"unhide"|"archive", now = new Date()): AdminResult<RunEventRecord> {
 const prev=db.getEvent(id);if(!prev)return {ok:false,status:404,error:"not_found"}; const map={approve:["admin.event_approve","approved"],publish:["admin.event_publish","published"],hide:["admin.event_hide","hidden"],unhide:["admin.event_unhide","published"],archive:["admin.event_archive","archived"]} as const; const [audit,status]=map[action];const a=authorizeScoped(db,ctx,audit,id,now,{enforceCity:prev.cityId,auditCity:prev.cityId});if(!a.ok)return a; const next={...prev,status,hidden:action==="hide"?true:action==="unhide"?false:prev.hidden,archivedAt:action==="archive"?now.toISOString():prev.archivedAt,updatedAt:now.toISOString(),updatedBy:a.data.accountId??a.data.admin};db.setEvent(next);return {ok:true,data:next};
}
