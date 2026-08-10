/**
 * Group leadership operations — leader assignment/removal, ownership
 * transfer, own-group profile edits, and the leader operational queue.
 *
 * Authorization lives in `roles.ts` and is enforced HERE on the server:
 *  - Ownership acts (assign/remove leaders, transfer ownership) require the
 *    group owner, the City Admin of the group's city, or the Global Admin.
 *  - Routine group operations (profile edits) additionally allow plain
 *    leaders of the group.
 *  - Every mutation is reason-required (5–500 chars) and audited with the
 *    actor's account email, the group's city, and a change summary — exactly
 *    like the existing admin handlers. Rows are never hard-deleted.
 *
 * Privacy contract: these handlers return PUBLIC identity only (name,
 * username, profile photo). No email, phone, home city, roster, or discussion
 * data is exposed. Leaders of a group never gain visibility into other
 * groups' data, and city admins never see data outside their scope city.
 */
import type { AccountRecord, AdminAction, GroupModRecord } from "./types";
import type { Db } from "./store";
import { newId } from "./store";
import { validReason, REASON_MAX, type AdminResult } from "./admin";
import {
  canManageGroupLeadership,
  canManageGroupOps,
  groupsLedBy,
  isEligibleLeader,
  isGlobalAdmin,
  leaderAccounts,
  leaderIdentities,
  type LeaderIdentity,
} from "./roles";

/** Public-safe summary of one group the actor leads. */
export interface LedGroupRow {
  groupId: string;
  groupName: string;
  cityId: string;
  ownerId: string | null;
  /** "owner" | "leader" — the actor's role on this group. */
  role: "owner" | "leader";
  pendingCount: number;
  /** True when the actor may run ownership acts (owner/admin) on this group. */
  canManageLeaders: boolean;
  leaders: LeaderIdentity[];
}

/** Pending membership request row — public identity only, no email/phone. */
export interface PendingRequestRow {
  membershipId: string;
  groupId: string;
  accountId: string;
  name: string;
  username: string | null;
  profilePhotoUrl: string | null;
  requestedAt: string;
}

/** Groups the actor leads, with their pending-request queues (leader queue). */
export function listLedGroups(db: Db, actor: AccountRecord | null | undefined): LedGroupRow[] {
  const groups = groupsLedBy(db, actor);
  if (groups.length === 0) return [];
  return groups.map((g) => {
    const role: "owner" | "leader" = g.ownerId === actor!.id ? "owner" : "leader";
    return {
      groupId: g.id,
      groupName: g.name,
      cityId: g.cityId,
      ownerId: g.ownerId ?? null,
      role,
      pendingCount: db.listMemberships().filter((m) => m.groupId === g.id && m.status === "pending").length,
      canManageLeaders: canManageGroupLeadership(db, g, actor),
      leaders: leaderIdentities(db, g),
    };
  });
}

/**
 * Flatten the leader queue for one actor across all groups they lead:
 * pending membership requests only, public identity only.
 */
export function leaderQueue(db: Db, actor: AccountRecord | null | undefined): PendingRequestRow[] {
  const led = groupsLedBy(db, actor);
  if (led.length === 0) return [];
  const groupIds = new Set(led.map((g) => g.id));
  return db
    .listMemberships()
    .filter((m) => groupIds.has(m.groupId) && m.status === "pending")
    .map((m) => {
      const acc = db.getAccount(m.accountId);
      return {
        membershipId: m.id,
        groupId: m.groupId,
        accountId: m.accountId,
        name: acc?.name ?? "Former member",
        username: acc?.username ?? null,
        profilePhotoUrl: acc?.profilePhotoRef ? `/uploads/public/${acc.profilePhotoRef}` : null,
        requestedAt: m.requestedAt,
      };
    })
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

export interface LeadershipMutation {
  group: GroupModRecord;
  leaders: LeaderIdentity[];
  ownerId: string | null;
}

type LeadershipResult = AdminResult<LeadershipMutation>;

function groupAudit(db: Db, actor: AccountRecord, action: AdminAction, group: GroupModRecord, reason: string, change: string, now: Date): void {
  db.appendAudit(
    {
      admin: actor.email,
      action,
      reason: reason.trim().slice(0, REASON_MAX),
      targetId: group.id,
      ip: "leader-action",
      cityId: group.cityId,
      owner: actor.email,
      change,
    },
    now,
  );
}

/**
 * Assign a leader to a group. The target is resolved by email (public account
 * identity in this app) and must be a verified runner whose home city equals
 * the group's city. Ownership acts require the owner / city admin / global
 * admin (see `canManageGroupLeadership`).
 */
export function assignGroupLeader(
  db: Db,
  actor: AccountRecord | null | undefined,
  group: GroupModRecord | undefined,
  targetEmail: string,
  reason: string,
  now = new Date(),
): LeadershipResult {
  if (!group) return { ok: false, status: 404, error: "not_found" };
  if (!actor || !canManageGroupLeadership(db, group, actor)) return { ok: false, status: 403, error: "forbidden" };
  if (!validReason(reason)) return { ok: false, status: 400, error: "reason_required", message: "A reason (at least 5 characters) is required for leadership changes." };
  const key = targetEmail.trim().toLowerCase();
  if (!key || key.length > 120) return { ok: false, status: 400, error: "invalid_email" };
  const target = db.getAccountByEmail(key);
  if (!target || target.deletedAt) return { ok: false, status: 404, error: "account_not_found", message: "No account found for that email." };
  if (!isEligibleLeader(target, group)) {
    return {
      ok: false,
      status: 400,
      error: "leader_not_eligible",
      message: "Leaders must be verified runners whose home city matches the group's city.",
    };
  }
  const current = group.leaderIds ?? [];
  if (current.includes(target.id) || group.ownerId === target.id) {
    // Harmless no-op — still audited for the trail.
    groupAudit(db, actor, "group.leader_assign", group, reason, `Leader unchanged: ${target.email}`, now);
    return { ok: true, data: { group, leaders: leaderIdentities(db, group), ownerId: group.ownerId ?? null } };
  }
  const next = db.updateGroup(group.id, { leaderIds: [...current, target.id] })!;
  groupAudit(db, actor, "group.leader_assign", group, reason, `Added leader: ${target.email}`, now);
  return { ok: true, data: { group: next, leaders: leaderIdentities(db, next), ownerId: next.ownerId ?? null } };
}

/**
 * Remove a leader from a group. The group owner cannot be removed through
 * this endpoint (ownership transfer is the only path for that); the owner may
 * remove themselves from `leaderIds` without losing ownership.
 */
export function removeGroupLeader(
  db: Db,
  actor: AccountRecord | null | undefined,
  group: GroupModRecord | undefined,
  targetAccountId: string,
  reason: string,
  now = new Date(),
): LeadershipResult {
  if (!group) return { ok: false, status: 404, error: "not_found" };
  if (!actor || !canManageGroupLeadership(db, group, actor)) return { ok: false, status: 403, error: "forbidden" };
  if (!validReason(reason)) return { ok: false, status: 400, error: "reason_required", message: "A reason (at least 5 characters) is required for leadership changes." };
  const target = db.getAccount(targetAccountId);
  if (!target || target.deletedAt) return { ok: false, status: 404, error: "not_found" };
  const current = group.leaderIds ?? [];
  if (!current.includes(target.id)) {
    return { ok: false, status: 400, error: "not_a_leader", message: "That account is not a leader of this group." };
  }
  const next = db.updateGroup(group.id, { leaderIds: current.filter((id) => id !== target.id) })!;
  groupAudit(db, actor, "group.leader_remove", group, reason, `Removed leader: ${target.email}`, now);
  return { ok: true, data: { group: next, leaders: leaderIdentities(db, next), ownerId: next.ownerId ?? null } };
}

/**
 * Transfer group ownership to another account.
 *
 * Rules (narrowest safe behavior):
 *  - The actor must hold ownership rights (owner / city admin / global admin).
 *  - Group owners may transfer ONLY to a current leader of the group.
 *  - Admins (city/global) may additionally designate any verified runner of
 *    the group's city — needed for seeded groups, which have no ownerId.
 *  - The previous owner stays on as a leader (unless a leader-removal follows
 *    separately) so the group is never left leaderless.
 */
export function transferGroupOwnership(
  db: Db,
  actor: AccountRecord | null | undefined,
  group: GroupModRecord | undefined,
  targetAccountId: string,
  reason: string,
  now = new Date(),
): LeadershipResult {
  if (!group) return { ok: false, status: 404, error: "not_found" };
  if (!actor || !canManageGroupLeadership(db, group, actor)) return { ok: false, status: 403, error: "forbidden" };
  if (!validReason(reason)) return { ok: false, status: 400, error: "reason_required", message: "A reason (at least 5 characters) is required for ownership changes." };
  const target = db.getAccount(targetAccountId);
  if (!target || target.deletedAt) return { ok: false, status: 404, error: "account_not_found", message: "No account found for that target." };
  // The caller already passed canManageGroupLeadership, so the actor is the
  // group owner, the City Admin of the group's city, or the Global Admin.
  const actorIsOwner = group.ownerId === actor.id;
  const actorIsAdmin = !actorIsOwner || actor.role === "city_admin" || isGlobalAdmin(actor);
  const targetIsLeader = (group.leaderIds ?? []).includes(target.id);
  if (actorIsOwner && !actorIsAdmin && !targetIsLeader) {
    return { ok: false, status: 400, error: "transfer_requires_leader", message: "Ownership can only be transferred to a current leader of the group." };
  }
  if (!isEligibleLeader(target, group)) {
    return { ok: false, status: 400, error: "leader_not_eligible", message: "The new owner must be a verified runner whose home city matches the group's city." };
  }
  if (group.ownerId === target.id) {
    groupAudit(db, actor, "group.ownership_transfer", group, reason, `Ownership unchanged: ${target.email}`, now);
    return { ok: true, data: { group, leaders: leaderIdentities(db, group), ownerId: target.id } };
  }
  const prevOwner = group.ownerId ?? null;
  const leaders = new Set(group.leaderIds ?? []);
  leaders.add(target.id);
  if (prevOwner) leaders.add(prevOwner); // previous owner remains a leader
  const next = db.updateGroup(group.id, { ownerId: target.id, leaderIds: [...leaders] })!;
  groupAudit(db, actor, "group.ownership_transfer", group, reason, `Ownership transferred ${prevOwner ?? "none"} -> ${target.email}`, now);
  return { ok: true, data: { group: next, leaders: leaderIdentities(db, next), ownerId: next.ownerId ?? null } };
}

/** Editable public profile fields — name/groupType/status stay admin-managed. */
export interface GroupProfilePatch {
  description?: string;
  websiteUrl?: string | null;
  groupmeUrl?: string | null;
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  membershipMode?: "open" | "request";
}

const MAX_FIELD = 500;
const MAX_DESC = 2000;

/**
 * Group Lead edits the group's public profile. Allowed for the group's
 * owner/leaders AND the scoped city/global admins (they may repair a broken
 * group). `name`, `groupType`, photos, and status are NOT editable here —
 * those remain admin-managed surfaces.
 */
export function editGroupProfile(
  db: Db,
  actor: AccountRecord | null | undefined,
  group: GroupModRecord | undefined,
  patch: GroupProfilePatch,
  reason: string,
  now = new Date(),
): LeadershipResult {
  if (!group) return { ok: false, status: 404, error: "not_found" };
  if (!actor || !canManageGroupOps(db, group, actor)) return { ok: false, status: 403, error: "forbidden" };
  if (!validReason(reason)) return { ok: false, status: 400, error: "reason_required", message: "A reason (at least 5 characters) is required for profile changes." };
  const change: string[] = [];
  const apply: Partial<GroupModRecord> = {};
  if (patch.description !== undefined) {
    if (typeof patch.description !== "string" || patch.description.length > MAX_DESC) return { ok: false, status: 400, error: "invalid_description" };
    if ((group.description ?? "") !== patch.description) change.push("description updated");
    apply.description = patch.description;
  }
  for (const urlKey of ["websiteUrl", "groupmeUrl", "facebookUrl", "instagramUrl"] as const) {
    const v = patch[urlKey];
    if (v === undefined) continue;
    if (v !== null && (typeof v !== "string" || v.length > MAX_FIELD || !/^https?:\/\//.test(v))) {
      return { ok: false, status: 400, error: "invalid_url", message: "Links must be http(s) URLs." };
    }
    const clean = v === null ? null : v.trim();
    if ((group[urlKey] ?? null) !== clean) change.push(`${urlKey} updated`);
    apply[urlKey] = clean;
  }
  if (patch.membershipMode !== undefined) {
    if (patch.membershipMode !== "open" && patch.membershipMode !== "request") return { ok: false, status: 400, error: "invalid_membership_mode" };
    if ((group.membershipMode ?? "open") !== patch.membershipMode) change.push(`membershipMode: ${group.membershipMode ?? "open"} -> ${patch.membershipMode}`);
    apply.membershipMode = patch.membershipMode;
  }
  if (Object.keys(apply).length === 0) {
    return { ok: true, data: { group, leaders: leaderIdentities(db, group), ownerId: group.ownerId ?? null } };
  }
  const next = db.updateGroup(group.id, apply)!;
  groupAudit(db, actor, "group.profile_edit", group, reason, change.join("; ") || "profile fields updated", now);
  return { ok: true, data: { group: next, leaders: leaderIdentities(db, next), ownerId: next.ownerId ?? null } };
}

/**
 * In-app notification to the group's leaders that a membership request
 * arrived. Mirrors the existing discussion-activity notification pattern:
 * category `community_updates`, gated on each leader's own preference, and
 * stored in their inbox only (no email, no push). Never sent to the
 * requester, never includes the requester's identity beyond the generic
 * copy — the leader queue is the place to review who asked.
 */
export function notifyLeadersOfMembershipRequest(db: Db, group: GroupModRecord, requesterId: string, now = new Date()): number {
  let sent = 0;
  for (const leader of leaderAccounts(db, group)) {
    if (leader.id === requesterId) continue;
    if (!db.getNotificationPreferences(leader.id).community_updates) continue;
    db.addNotification({
      id: newId(),
      accountId: leader.id,
      category: "community_updates",
      title: "New membership request",
      body: `Someone requested to join ${group.name}. Review it in your leader queue.`,
      createdAt: now.toISOString(),
      readAt: null,
    });
    sent++;
  }
  return sent;
}
