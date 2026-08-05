import type { Db } from "./store";
import type { GroupMembershipRecord } from "./types";
import { newId } from "./store";

export function membershipDto(db: Db, m: GroupMembershipRecord) {
  const g = db.getGroup(m.groupId);
  return { id: m.id, groupId: m.groupId, cityId: m.cityId, groupName: g?.name ?? "Group", status: m.status, requestedAt: m.requestedAt, updatedAt: m.updatedAt };
}
export function myMemberships(db: Db, accountId: string) { return db.listMemberships(accountId).map(m => membershipDto(db,m)); }
export function createMembership(db: Db, groupId: string, accountId: string, status: GroupMembershipRecord["status"], now: Date): GroupMembershipRecord | null {
  const group = db.getGroup(groupId); if (!group) return null;
  const current = db.getMembership(groupId, accountId);
  if (current && (current.status === "pending" || current.status === "active")) return current;
  const m: GroupMembershipRecord = { id: newId(), groupId, accountId, cityId: group.cityId, status, requestedAt: now.toISOString(), updatedAt: now.toISOString(), decidedAt: status === "active" ? now.toISOString() : null, decidedBy: status === "active" ? accountId : null };
  db.addMembership(m); return m;
}
