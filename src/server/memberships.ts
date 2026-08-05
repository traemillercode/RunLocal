import type { Db } from "./store";
import type { AccountRecord, GroupMembershipRecord, GroupModRecord } from "./types";
import { newId } from "./store";

export function membershipDto(db: Db, m: GroupMembershipRecord) {
  const g = db.getGroup(m.groupId);
  return { id: m.id, groupId: m.groupId, cityId: m.cityId, groupName: g?.name ?? "Group", status: m.status, requestedAt: m.requestedAt, updatedAt: m.updatedAt };
}
export function myMemberships(db: Db, accountId: string) { return db.listMemberships(accountId).map(m => membershipDto(db, m)); }
export function canAdministerMembership(group: GroupModRecord, actor: AccountRecord | undefined, target: AccountRecord | undefined, membership: GroupMembershipRecord): boolean {
  if (!actor || !target || membership.cityId !== group.cityId || target.cityId !== group.cityId) return false;
  const owner = actor.email.toLowerCase() === (process.env.RUN_LOCAL_OWNER_EMAIL ?? "").toLowerCase();
  if (owner) return true;
  if (actor.cityId !== group.cityId) return false;
  return group.ownerId === actor.id || (group.leaderIds ?? []).includes(actor.id);
}
export function createMembership(db: Db, groupId: string, accountId: string, status: GroupMembershipRecord["status"], now: Date): GroupMembershipRecord | null {
  const group = db.getGroup(groupId); if (!group) return null;
  const current = db.getMembership(groupId, accountId);
  if (current && (current.status === "pending" || current.status === "active")) return current;
  if (current) return db.updateMembership(current.id, { status, requestedAt: now.toISOString(), updatedAt: now.toISOString(), decidedAt: status === "active" ? now.toISOString() : null, decidedBy: status === "active" ? accountId : null }) ?? null;
  const m: GroupMembershipRecord = { id: newId(), groupId, accountId, cityId: group.cityId, status, requestedAt: now.toISOString(), updatedAt: now.toISOString(), decidedAt: status === "active" ? now.toISOString() : null, decidedBy: status === "active" ? accountId : null };
  db.addMembership(m); return m;
}
