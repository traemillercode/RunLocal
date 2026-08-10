import type { AccountRecord, GroupModRecord } from "./types";
import type { Db } from "./store";
import { newId } from "./store";
import { canManageGroupOps } from "./roles";

export const WAIVER_TERM_MS = 365 * 24 * 60 * 60 * 1000;
export interface GroupWaiverVersion { id:string; groupId:string; version:number; text:string; createdAt:string; createdBy:string; }
export interface GroupWaiverSignature { id:string; groupId:string; waiverVersionId:string; signerId:string; signedAt:string; expiresAt:string; expiredAt:string|null; }
export function currentWaiver(db:Db, groupId:string) { return db.listWaivers(groupId).sort((a,b)=>b.version-a.version)[0] ?? null; }
export function waiverStatus(db:Db, groupId:string, accountId:string, now=new Date()) {
 const w=currentWaiver(db,groupId); if(!w) return {status:"not_required" as const, version:null, expiresAt:null};
 const s=db.getWaiverSignature(groupId,w.id,accountId); if(!s) return {status:"unsigned" as const,version:w.version,expiresAt:null};
 return {status:new Date(s.expiresAt)>now && !s.expiredAt?"signed" as const:"expired" as const,version:w.version,expiresAt:s.expiresAt};
}
export function canManageWaiver(db: Db, group: GroupModRecord, actor: AccountRecord | undefined) {
  return canManageGroupOps(db, group, actor);
}
export function createWaiverVersion(db: Db, group: GroupModRecord, actor: AccountRecord | undefined, text: string, now = new Date()): GroupWaiverVersion|null {
 if(!canManageWaiver(db, group, actor) || !text.trim() || text.trim().length>20000) return null;
 const previous=currentWaiver(db,group.id); const rec={id:newId(),groupId:group.id,version:(previous?.version??0)+1,text:text.trim(),createdAt:now.toISOString(),createdBy:actor!.id}; db.addWaiver(rec); return rec;
}
export function signWaiver(db:Db, groupId:string, signer:AccountRecord|undefined, now=new Date()): GroupWaiverSignature|null {
 const w=currentWaiver(db,groupId); if(!w || !signer || signer.status!=="verified") return null;
 const existing=db.getWaiverSignature(groupId,w.id,signer.id); if(existing && new Date(existing.expiresAt)>now && !existing.expiredAt) return existing;
 const rec={id:newId(),groupId,waiverVersionId:w.id,signerId:signer.id,signedAt:now.toISOString(),expiresAt:new Date(now.getTime()+WAIVER_TERM_MS).toISOString(),expiredAt:null}; db.addWaiverSignature(rec); return rec;
}
/** Idempotent maintenance operation: stamps expired signatures, preserving all history. */
export function processWaiverExpiry(db:Db, now=new Date()): number { let count=0; for(const s of db.listWaiverSignatures()) if(!s.expiredAt && new Date(s.expiresAt)<=now){ db.updateWaiverSignature(s.id,{expiredAt:s.expiresAt}); count++; } return count; }
