/**
 * Account roles & permission gating.
 *
 * Roles: guest → pending → verified. Pending (including "under review")
 * users are READ-ONLY: they cannot RSVP, comment, post, or submit.
 * Verification records are never shipped to the client — the only public
 * artifact is the boolean-ish `badge: "verified"` on the public account.
 */
export type AccountRole = "guest" | "pending" | "rejected" | "verified";

/** Actions a verified runner may take; everyone else is read-only. */
export type GatedAction = "rsvp" | "comment" | "post" | "submit";

export const ROLE_RANK: Record<AccountRole, number> = { guest: 0, pending: 1, rejected: 1, verified: 2 };

export const MIN_ROLE: Record<GatedAction, AccountRole> = {
  rsvp: "verified",
  comment: "verified",
  post: "verified",
  submit: "verified",
};

/** True when `role` is allowed to perform `action`. */
export function canDo(role: AccountRole, action: GatedAction): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_ROLE[action]];
}

/**
 * Operational account roles (multi-role model, server-authoritative). Roles
 * "glue together": each role implies every role of equal or lower rank
 * (runner(0) < group_leader(1) < city_admin(2) < site_admin(3)), so the
 * effective role is the highest-ranked held role. The server ships the full
 * `roles` set on the public account; this module only renders it.
 */
export type OpRole = "runner" | "group_leader" | "city_admin" | "site_admin";
export const OP_ROLE_RANK: Record<OpRole, number> = { runner: 0, group_leader: 1, city_admin: 2, site_admin: 3 };
export const ALL_OP_ROLES: OpRole[] = ["runner", "group_leader", "city_admin", "site_admin"];

/** Highest-ranked role from a public account's role set. */
export function effectiveOpRole(account: Pick<PublicAccount, "roles" | "role">): OpRole {
  const roles = Array.isArray(account.roles) && account.roles.length > 0 ? account.roles : [account.role];
  return roles.reduce<OpRole>((a, b) => (OP_ROLE_RANK[b] > OP_ROLE_RANK[a] ? b : a), "runner");
}

/** "Roles glue together": true when the account effectively holds `role`. */
export function accountHasRole(account: Pick<PublicAccount, "roles" | "role">, role: OpRole): boolean {
  return OP_ROLE_RANK[effectiveOpRole(account)] >= OP_ROLE_RANK[role];
}

/** A public account payload — the ONLY account shape the client may hold. */
export interface PublicAccount {
  id: string;
  name: string;
  email: string;
  /**
   * Unique public handle, normalized to lowercase (see `src/lib/username.ts`).
   * `null` for legacy accounts created before usernames existed — they stay
   * fully functional and can claim one from their profile at any time.
   */
  username: string | null;
  /**
   * Home city id — a supported city from the known city entities. `null` for
   * legacy accounts that have not chosen one yet (they are clearly prompted).
   * Public profile identity, never sensitive.
   */
  cityId: string | null;
  bio?: string | null;
  customTitle?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  tiktokUrl?: string | null;
  showSocialLinks?: boolean;
  paceLabel?: string | null;
  runningGoal?: string | null;
  trainingBlock?: string | null;
  upcomingRaces?: string | null;
  status: "pending" | "verified" | "rejected";
  /** Funnel stage for pending accounts: email | code | selfie | pending_review. */
  phase: "email" | "code" | "selfie" | "pending_review" | null;
  /** The only verification artifact shown publicly. */
  badge: "verified" | null;
  /** Assigned runner role — a label only, never a power source. */
  role: OpRole;
  /** Full multi-role set (server-authoritative; `role` = highest of these). */
  roles: OpRole[];
  /** City Admin's server-enforced scope, when applicable. */
  /** City Admin scope exposed for rendering only; authorization remains server-side. */
  adminCityId?: string | null;
  /**
   * Super-admin flag, computed SERVER-side (account email vs
   * RUN_LOCAL_OWNER_EMAIL). The client renders this boolean and can never
   * self-assign the role — never derive it from the email client-side.
   */
  isOwner: boolean;
  /** Present on real server responses; optional here only so existing test fixtures that construct this type directly don't all need updating for a new field. */
  isGeofenceExempt?: boolean;
  /**
   * Posting-blocking suspension, computed SERVER-side against the current
   * time. The client may only see the boolean — never the expiry or reason.
   */
  suspended: boolean;
  /**
   * Community-trust review state (server-computed). While true the account
   * may still browse, RSVP, and comment, but hosting and club/coach posting
   * are paused. Never a count or score — just the state boolean.
   */
  underReview: boolean;
  /**
   * Trusted Member (manual trust / blue-check) state — server-authoritative
   * and display-only here. Distinct from identity verification: granted only
   * by Global/City Admins through audited endpoints to identity-verified
   * members. The client can render it but can never set it.
   */
  trustedMember?: boolean;
  /**
   * Applicant-facing verification rejection reason — PRIVATE to the account
   * itself (only present in the owner's own `/api/me` payload, never in other
   * members' projections). `null` when not rejected.
   */
  rejectionReason?: string | null;
  priorRejectionReason?: string | null;
  profilePhotoUrl: string | null;
}

export interface MeGuest {
  status: "guest";
}
export interface MeSignedIn {
  status: "signed_in";
  account: PublicAccount;
}

export type Me = MeGuest | MeSignedIn;

export function roleOf(me: Me): AccountRole {
  if (me.status !== "signed_in") return "guest";
  // Rejected accounts are their own read-only role — they must NEVER render
  // (or be treated) as pending. Gating rank equals pending (read-only); only
  // the UI copy and actions differ.
  if (me.account.status === "verified") return "verified";
  if (me.account.status === "rejected") return "rejected";
  return "pending";
}

export function isVerified(me: Me): boolean {
  return roleOf(me) === "verified";
}

/** True when a signed-in account's posting rights are suspended (server-computed). */
export function isSuspended(me: Me): boolean {
  return me.status === "signed_in" && me.account.suspended === true;
}

/** Human-readable label for a pending funnel stage (UI copy only). */
export function phaseLabel(phase: PublicAccount["phase"]): string {
  switch (phase) {
    case "email":
      return "Verify your email address";
    case "code":
      return "Enter the code we sent";
    case "selfie":
      return "Complete your selfie verification";
    case "pending_review":
      return "Under review";
    default:
      return "In progress";
  }
}

/** Human-readable label for the assigned runner role. */
export function roleLabel(role: PublicAccount["role"]): string {
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
