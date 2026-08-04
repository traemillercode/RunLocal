import type { Db } from "./store";
import type { AccountRecord, SafetyReportRecord, SafetyReportStatus } from "./types";
import { newId } from "./store";

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
