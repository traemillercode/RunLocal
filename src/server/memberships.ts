import type { Db } from "./store";
import type { AccountRecord, GroupMembershipRecord, GroupModRecord } from "./types";
import { newId } from "./store";
import { isGlobalAdmin, isCityAdminForGroup, canManageGroupOps } from "./roles";

export function membershipDto(db: Db, m: GroupMembershipRecord) {
  const g = db.getGroup(m.groupId);
  return { id: m.id, groupId: m.groupId, cityId: m.cityId, groupName: g?.name ?? "Group", status: m.status, requestedAt: m.requestedAt, updatedAt: m.updatedAt, websiteUrl: g?.websiteUrl ?? null };
}
export function myMemberships(db: Db, accountId: string) { return db.listMemberships(accountId).map(m => membershipDto(db, m)); }

/**
 * Native group chat for a club — lazily created on first access (seeded
 * with every currently-active member), reused after that. Membership
 * changes sync in via syncGroupChatMembership below, called from the
 * membership approve/leave/remove/revoke paths.
 */
export function getOrCreateGroupChat(db: Db, groupId: string, now: Date): string {
  const group = db.getGroup(groupId);
  if (group?.chatConversationId && db.getConversation(group.chatConversationId)) return group.chatConversationId;
  const memberIds = db.listMemberships().filter((m) => m.groupId === groupId && m.status === "active").map((m) => m.accountId);
  const ownerId = group?.ownerId ?? memberIds[0] ?? "system";
  const participantIds = [...new Set([ownerId, ...memberIds])];
  const convo = db.createGroupConversation({ name: group?.name ?? "Club chat", participantIds, createdBy: ownerId }, now);
  db.updateGroup(groupId, { chatConversationId: convo.id });
  return convo.id;
}

/** Adds or removes an account from the group's chat when their membership changes — a no-op if the chat hasn't been created yet (it'll be seeded correctly whenever it first is). */
export function syncGroupChatMembership(db: Db, groupId: string, accountId: string, action: "add" | "remove"): void {
  const group = db.getGroup(groupId);
  if (!group?.chatConversationId) return;
  const convo = db.getConversation(group.chatConversationId);
  if (!convo) return;
  const participantIds = action === "add"
    ? [...new Set([...convo.participantIds, accountId])]
    : convo.participantIds.filter((id) => id !== accountId);
  db.updateConversation(convo.id, { participantIds });
}

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
