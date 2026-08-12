/**
 * Account role hierarchy — the single source of truth for the multi-role
 * model ("roles glue together").
 *
 * Roles are stored as a set (`AccountRecord.roles`) with the legacy single
 * `role` field kept in sync (highest-ranked role) for backward compatibility
 * during migration. The hierarchy is:
 *
 *     runner(0) < group_leader(1) < city_admin(2) < site_admin(3)
 *
 * Each role IMPLIES every role of equal or lower rank: an account holding
 * `site_admin` is also (effectively) a city admin, group leader, and runner.
 * `effectiveRole()` is the highest-ranked held role and every capability
 * check goes through `hasRole()` so grants glue together.
 *
 * The owner email (see `owner.ts`) is ALWAYS a site admin — that is derived
 * server-side, never stored/assigned from a client payload.
 */
import type { AccountRecord, AccountRole } from "./types";
import { isOwnerEmail } from "./owner";

/** Canonical rank per role — higher implies all lower roles. */
export const ROLE_RANK: Record<AccountRole, number> = {
  runner: 0,
  group_leader: 1,
  city_admin: 2,
  site_admin: 3,
};

/** Canonical ordering for storage/display (lowest → highest). */
export const ALL_ACCOUNT_ROLES: AccountRole[] = ["runner", "group_leader", "city_admin", "site_admin"];

export const ADMIN_ROLES: AccountRole[] = ["city_admin", "site_admin"];

/** Dedupe + validate a raw role list against the known role set. */
export function normalizeRoles(roles: readonly AccountRole[]): AccountRole[] {
  const seen = new Set<AccountRole>();
  const out: AccountRole[] = [];
  for (const r of ALL_ACCOUNT_ROLES) {
    if (roles.includes(r) && !seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

/** Highest-ranked role in a list ("roles glue together"). */
export function highestRole(roles: readonly AccountRole[]): AccountRole {
  return roles.reduce<AccountRole>((a, b) => (ROLE_RANK[b] > ROLE_RANK[a] ? b : a), "runner");
}

/**
 * Stored role set, falling back to the legacy single `role` field for records
 * persisted before multi-role existed (helpers treat `role` as the full set
 * when `roles` is empty/absent).
 */
export function storedRoles(rec: Pick<AccountRecord, "roles" | "role">): AccountRole[] {
  if (Array.isArray(rec.roles) && rec.roles.length > 0) return normalizeRoles(rec.roles);
  const fallback = rec.role && ALL_ACCOUNT_ROLES.includes(rec.role) ? rec.role : "runner";
  return [fallback];
}

/**
 * The account's full effective role set: stored roles plus `site_admin`
 * implied by the owner email (server-derived, always on).
 */
export function accountRoles(rec: Pick<AccountRecord, "roles" | "role" | "email">): AccountRole[] {
  const roles = new Set(storedRoles(rec));
  if (isOwnerEmail(rec.email)) roles.add("site_admin");
  return ALL_ACCOUNT_ROLES.filter((r) => roles.has(r));
}

/** Highest-ranked effective role. */
export function effectiveRole(rec: Pick<AccountRecord, "roles" | "role" | "email">): AccountRole {
  return highestRole(accountRoles(rec));
}

/**
 * "Roles glue together": true when the account effectively holds `role` —
 * i.e. it holds ANY role of rank >= `role`. An account with site_admin
 * therefore hasRole("city_admin"), hasRole("group_leader"), and
 * hasRole("runner") too.
 */
export function hasRole(rec: Pick<AccountRecord, "roles" | "role" | "email">, role: AccountRole): boolean {
  return ROLE_RANK[effectiveRole(rec)] >= ROLE_RANK[role];
}

/**
 * Write patch for setting a role set: stores `roles` AND keeps the legacy
 * single `role` field in sync (`role` = highest-ranked role in `roles`).
 * "runner" is always included (everyone is a Verified Runner).
 */
export function rolesPatch(roles: readonly AccountRole[]): { roles: AccountRole[]; role: AccountRole } {
  const normalized = normalizeRoles([...roles, "runner"]);
  return { roles: normalized, role: highestRole(normalized) };
}

/** Add a role to an account's stored set (idempotent). */
export function addRolePatch(rec: Pick<AccountRecord, "roles" | "role">, role: AccountRole): { roles: AccountRole[]; role: AccountRole } {
  return rolesPatch([...storedRoles(rec), role]);
}

/** Remove a role from an account's stored set (idempotent; runner remains). */
export function removeRolePatch(rec: Pick<AccountRecord, "roles" | "role">, role: AccountRole): { roles: AccountRole[]; role: AccountRole } {
  return rolesPatch(storedRoles(rec).filter((r) => r !== role));
}

/** Human-readable label for an operational role (display copy). */
export function roleLabel(role: AccountRole): string {
  switch (role) {
    case "group_leader":
      return "Group Leader";
    case "city_admin":
      return "City Admin";
    case "site_admin":
      return "Site Admin";
    default:
      return "Verified Runner";
  }
}
