/**
 * Role & ownership boundaries — the single source of truth for who may do
 * what on Run Local.
 *
 * Three operational roles exist, all derived SERVER-side from the signed-in
 * account (never from any client-supplied field):
 *
 *   1. Global Admin (super admin)  — the owner email (RUN_LOCAL_OWNER_EMAIL,
 *      default traemiller.email@gmail.com) OR the key-based admin session.
 *      Global scope: every city, every group, every queue.
 *   2. City Admin                   — account role "city_admin" with exactly
 *      one `adminCityId`. Scope: that one city only.
 *   3. Group Lead                   — a VERIFIED account, home city = group
 *      city, who is the group's owner or a listed leader. Scope: groups they
 *      lead only. A leader may run group operations; OWNERSHIP acts (adding
 *      or removing leaders, transferring ownership) are owner/admin-only.
 *
 * Group leadership is stored on the group record (`ownerId` + `leaderIds`)
 * and is deliberately separate from membership: a leader need not hold a
 * membership row, and leadership never grants visibility into the private
 * RSVP/discussion data beyond what the existing occurrence gates already
 * allow (leaders get check-in rosters via `canManageCheckins` — nothing new
 * is exposed here).
 *
 * Every sensitive operation in this module is reason-required and audited by
 * the caller (see `leadership.ts`); this file only answers permission
 * questions and never touches the audit log.
 */
import type { AccountRecord, GroupModRecord } from "./types";
import type { Db } from "./store";
import { isOwnerEmail } from "./owner";

/** The role an account holds ON a specific group, or "none". */
export type GroupRole = "owner" | "leader" | "member" | "none";

/**
 * Resolve the actor's role on a group. Returns "none" for guests, deleted
 * accounts, unverified accounts, and accounts whose home city differs from
 * the group's city — city boundaries apply at every level.
 */
export function groupRoleFor(db: Db, group: GroupModRecord | undefined, actor: AccountRecord | null | undefined): GroupRole {
  if (!group || !actor || actor.deletedAt || actor.status !== "verified") return "none";
  if (actor.cityId !== group.cityId) return "none";
  if (group.ownerId === actor.id) return "owner";
  if ((group.leaderIds ?? []).includes(actor.id)) return "leader";
  const m = db.getMembership(group.id, actor.id);
  return m && m.status === "active" ? "member" : "none";
}

/** True when the actor may run routine group operations (owner or leader). */
export function isGroupLead(db: Db, group: GroupModRecord | undefined, actor: AccountRecord | null | undefined): boolean {
  const role = groupRoleFor(db, group, actor);
  return role === "owner" || role === "leader";
}

/**
 * City-admin override: the actor is a City Admin scoped to exactly this
 * group's city.
 */
export function isCityAdminForGroup(actor: AccountRecord | null | undefined, group: GroupModRecord | undefined): boolean {
  if (!actor || !group || actor.deletedAt || actor.role !== "city_admin") return false;
  return typeof actor.adminCityId === "string" && actor.adminCityId === group.cityId;
}

/** Global Admin override: the actor is the server-configured owner email. */
export function isGlobalAdmin(actor: AccountRecord | null | undefined): boolean {
  return Boolean(actor && !actor.deletedAt && isOwnerEmail(actor.email));
}

/**
 * City Admin override scoped to ONE city (not a group): the actor is a City
 * Admin whose assigned city is exactly `cityId`. Used to compute per-entity
 * moderation capability lists (e.g. forum posts) without needing a group.
 */
export function isCityAdminForCity(actor: AccountRecord | null | undefined, cityId: string | null | undefined): boolean {
  if (!actor || actor.deletedAt || actor.role !== "city_admin") return false;
  return typeof actor.adminCityId === "string" && actor.adminCityId.length > 0 && actor.adminCityId === cityId;
}

/**
 * Group operations (waivers, check-ins, membership decisions, profile edits):
 * the group owner/leaders, the City Admin of the group's city, and the Global
 * Admin may act. Everyone else is denied.
 */
export function canManageGroupOps(db: Db, group: GroupModRecord | undefined, actor: AccountRecord | null | undefined): boolean {
  if (!group || !actor) return false;
  if (isGlobalAdmin(actor)) return true;
  if (isCityAdminForGroup(actor, group)) return true;
  return isGroupLead(db, group, actor);
}

/**
 * Ownership acts — assigning/removing leaders and transferring ownership:
 * the group OWNER (not a plain leader), the City Admin of the group's city,
 * or the Global Admin. Seeded groups have no ownerId, so their leadership is
 * admin-managed until an owner is designated via transfer.
 */
export function canManageGroupLeadership(db: Db, group: GroupModRecord | undefined, actor: AccountRecord | null | undefined): boolean {
  if (!group || !actor) return false;
  if (isGlobalAdmin(actor)) return true;
  if (isCityAdminForGroup(actor, group)) return true;
  return groupRoleFor(db, group, actor) === "owner";
}

/**
 * Groups the account leads (owner or leader). Used by the leader queue and
 * the manage surface. Never includes groups from another city.
 */
export function groupsLedBy(db: Db, actor: AccountRecord | null | undefined): GroupModRecord[] {
  if (!actor || actor.deletedAt || actor.status !== "verified") return [];
  return db
    .listGroups()
    .filter((g) => g.cityId === actor.cityId && !(g.archived ?? false))
    .filter((g) => g.ownerId === actor.id || (g.leaderIds ?? []).includes(actor.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}
/**
 * Groups the account may MANAGE (the manage surface / leader queue): for a
 * plain verified runner this is exactly the groups they lead; a City Admin
 * may manage every non-archived group in their scoped city (even ones they
 * do not lead); the Global Admin may manage every non-archived group in any
 * city. Cross-city and plain-runner boundaries are preserved — a City Admin
 * never sees another city's groups, and a plain runner never sees a group
 * they do not lead.
 */
export function groupsManagedBy(db: Db, actor: AccountRecord | null | undefined): GroupModRecord[] {
  if (!actor || actor.deletedAt || actor.status !== "verified") return [];
  const all = db.listGroups().filter((g) => !(g.archived ?? false));
  if (isGlobalAdmin(actor)) return all.sort((a, b) => a.name.localeCompare(b.name));
  if (actor.role === "city_admin" && typeof actor.adminCityId === "string") {
    return all.filter((g) => g.cityId === actor.adminCityId).sort((a, b) => a.name.localeCompare(b.name));
  }
  return groupsLedBy(db, actor);
}

/**
 * All leader account ids for a group (owner + leaders, deduped), resolved to
 * live accounts only. The returned records exist so callers can ship
 * notifications without exposing emails/phones anywhere.
 */
export function leaderAccounts(db: Db, group: GroupModRecord): AccountRecord[] {
  const ids = new Set<string>([...(group.leaderIds ?? [])]);
  if (group.ownerId) ids.add(group.ownerId);
  const out: AccountRecord[] = [];
  for (const id of ids) {
    const rec = db.getAccount(id);
    if (rec && !rec.deletedAt) out.push(rec);
  }
  return out;
}

/** Public leader identity row (name/username/photo only — no email/phone). */
export interface LeaderIdentity {
  id: string;
  name: string;
  username: string | null;
  profilePhotoUrl: string | null;
}

/** Public-safe leader identities for a group (used by the manage surface). */
export function leaderIdentities(db: Db, group: GroupModRecord): LeaderIdentity[] {
  return leaderAccounts(db, group).map((a) => ({
    id: a.id,
    name: a.name,
    username: a.username,
    profilePhotoUrl: a.profilePhotoRef ? `/uploads/public/${a.profilePhotoRef}` : null,
  }));
}

/**
 * A target account is eligible to BECOME a leader: verified, not deleted,
 * home city = group city. Admins do not bypass the city rule — a leader must
 * be a local verified runner so leadership never crosses city boundaries.
 */
export function isEligibleLeader(actor: AccountRecord | null | undefined, group: GroupModRecord): boolean {
  return Boolean(actor && !actor.deletedAt && actor.status === "verified" && actor.cityId === group.cityId);
}
