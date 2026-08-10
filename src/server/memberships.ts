import type { Db } from "./store";
import type { AccountRecord, GroupMembershipRecord, GroupModRecord } from "./types";
import { newId } from "./store";
import { isGlobalAdmin, isCityAdminForGroup, canManageGroupOps } from "./roles";

export function membershipDto(db: Db, m: GroupMembershipRecord) {
  const g = db.getGroup(m.groupId);
  return { id: m.id, groupId: m.groupId, cityId: m.cityId, groupName: g?.name ?? "Group", status: m.status, requestedAt: m.requestedAt, updatedAt: m.updatedAt };
}
export function myMemberships(db: Db, accountId: string) { return db.listMemberships(accountId).map(m => membershipDto(db, m)); }

/**
 * Who may decide a group's membership requests: the group owner/leaders, the
 * City Admin of the group's city, or the Global Admin. The target must be a
 * verified same-city runner — city boundaries apply at every level, and
 * Group Leads can only ever act on groups they lead.
 */
export function canAdministerMembership(db: Db, group: GroupModRecord, actor: AccountRecord | undefined, target: AccountRecord | undefined, membership: GroupMembershipRecord): boolean {
  if (!actor || !target || membership.cityId !== group.cityId || target.cityId !== group.cityId) return false;
  if (target.status !== "verified") return false;
  if (isGlobalAdmin(actor)) return true;
  if (isCityAdminForGroup(actor, group)) return true;
  return canManageGroupOps(db, group, actor);
}

export function createMembership(db: Db, groupId: string, accountId: string, status: GroupMembershipRecord["status"], now: Date): GroupMembershipRecord | null {
  const group = db.getGroup(groupId); if (!group) return null;
  const current = db.getMembership(groupId, accountId);
  if (current && (current.status === "pending" || current.status === "active")) return current;
  if (current) return db.updateMembership(current.id, { status, requestedAt: now.toISOString(), updatedAt: now.toISOString(), decidedAt: status === "active" ? now.toISOString() : null, decidedBy: status === "active" ? accountId : null }) ?? null;
  const m: GroupMembershipRecord = { id: newId(), groupId, accountId, cityId: group.cityId, status, requestedAt: now.toISOString(), updatedAt: now.toISOString(), decidedAt: status === "active" ? now.toISOString() : null, decidedBy: status === "active" ? accountId : null };
  db.addMembership(m); return m;
}
