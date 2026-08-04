import type { Db } from "./store";
import type { AccountRecord, SafetyReportRecord, SafetyReportStatus } from "./types";
import { newId } from "./store";
import { authorizeScoped, type AdminCtx, type AdminResult, validReason } from "./admin";

export const REPORT_MAX = 500;
export type SafetyResult<T> = { ok:true; data:T } | { ok:false; error:string; status:number };
export function createSafetyReport(db: Db, reporter: AccountRecord, input: { subjectId:string; cityId:string; contextType: SafetyReportRecord["contextType"]; contextId:string; reason:string }, now=new Date()): SafetyResult<{id:string;status:SafetyReportStatus}> {
  if (reporter.deletedAt || reporter.status !== "verified" || reporter.underReview) return {ok:false,error:"verified_runner_required",status:403};
  if (!input.reason || input.reason.trim().length < 5 || input.reason.trim().length > REPORT_MAX) return {ok:false,error:"invalid_reason",status:400};
  const subject=db.getAccount(input.subjectId); if(!subject || subject.deletedAt || subject.id===reporter.id) return {ok:false,error:"not_found",status:404};
  if (reporter.cityId !== input.cityId || db.isBlocked(reporter.id,subject.id)) return {ok:false,error:"invalid_context",status:403};
  if (input.contextType === "join_request") { const r=db.getJoinRequest(input.contextId); if(!r || !((r.requesterId===reporter.id&&r.recipientId===subject.id)||(r.requesterId===subject.id&&r.recipientId===reporter.id))) return {ok:false,error:"invalid_context",status:403}; }
  if (input.contextType === "personal_run") { const r=db.getPersonalRun(input.contextId); if(!r || r.deletedAt || r.accountId!==subject.id || r.cityId!==input.cityId) return {ok:false,error:"invalid_context",status:403}; }
  if (input.contextType === "event" && (!db.hasAttendance(reporter.id,input.contextId)||!db.hasAttendance(subject.id,input.contextId))) return {ok:false,error:"invalid_context",status:403};
  if (!db.consumeSafetyReportRate(reporter.id,now.getTime())) return {ok:false,error:"rate_limited",status:429};
  if (db.listSafetyReports().some(r=>r.reporterId===reporter.id&&r.subjectId===subject.id&&r.contextType===input.contextType&&r.contextId===input.contextId&&r.status!=="dismissed")) return {ok:false,error:"duplicate_report",status:409};
  const r:SafetyReportRecord={id:newId(),reporterId:reporter.id,subjectId:subject.id,cityId:input.cityId,contextType:input.contextType,contextId:input.contextId,reason:input.reason.trim(),status:"open",createdAt:now.toISOString(),updatedAt:now.toISOString(),resolvedAt:null}; db.addSafetyReport(r); return {ok:true,data:{id:r.id,status:r.status}};
}
export function publicSafetyReport(r: SafetyReportRecord) { return {id:r.id,cityId:r.cityId,contextType:r.contextType,contextId:r.contextId,status:r.status,createdAt:r.createdAt,updatedAt:r.updatedAt,resolvedAt:r.resolvedAt}; }

/** Admin view deliberately omits account records and all verification/contact fields. */
export function adminSafetyReport(r: SafetyReportRecord) {
  return { id:r.id, cityId:r.cityId, contextType:r.contextType, contextId:r.contextId, status:r.status, reason:r.reason, createdAt:r.createdAt, updatedAt:r.updatedAt, resolvedAt:r.resolvedAt };
}
const transitions: Record<SafetyReportStatus, SafetyReportStatus[]> = { open:["under_review","dismissed"], under_review:["resolved","dismissed"], resolved:[], dismissed:[] };
export function listSafetyReportsAdmin(db: Db, ctx: AdminCtx, cityId: string|null, now=new Date()): AdminResult<ReturnType<typeof adminSafetyReport>[]> {
  const auth = authorizeScoped(db,ctx,"admin.safety_report_list",null,now);
  if (!auth.ok) return auth;
  const scope = auth.data.scope.kind === "city" ? auth.data.scope.cityId : cityId;
  if (auth.data.scope.kind === "city" && cityId && cityId !== scope) return {ok:false,status:403,error:"city_scope_denied"};
  return {ok:true,data:db.listSafetyReports().filter(r=>!scope||r.cityId===scope).map(adminSafetyReport)};
}
export function decideSafetyReport(db: Db, ctx: AdminCtx, id: string, status: SafetyReportStatus, now=new Date()): AdminResult<ReturnType<typeof adminSafetyReport>> {
  if (!validReason(ctx.reason)) return {ok:false,status:400,error:"reason_required"};
  if (!(status in transitions)) return {ok:false,status:400,error:"invalid_status"};
  const current=db.getSafetyReport(id); if (!current) return {ok:false,status:404,error:"not_found"};
  const auth=authorizeScoped(db,ctx,"admin.safety_report_resolve",id,now,{enforceCity:current.cityId,auditCity:current.cityId});
  if (!auth.ok) return auth;
  if (status !== current.status && !transitions[current.status].includes(status)) return {ok:false,status:409,error:"invalid_transition"};
  const next=db.updateSafetyReport(id,{status,updatedAt:now.toISOString(),resolvedAt:(status === "resolved" || status === "dismissed") ? (current.resolvedAt ?? now.toISOString()) : current.resolvedAt});
  return {ok:true,data:adminSafetyReport(next!)};
}
