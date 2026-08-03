/**
 * Account roles & permission gating.
 *
 * Roles: guest → pending → verified. Pending (including "under review")
 * users are READ-ONLY: they cannot RSVP, comment, post, or submit.
 * Verification records are never shipped to the client — the only public
 * artifact is the boolean-ish `badge: "verified"` on the public account.
 */
export type AccountRole = "guest" | "pending" | "verified";

/** Actions a verified runner may take; everyone else is read-only. */
export type GatedAction = "rsvp" | "comment" | "post" | "submit";

export const ROLE_RANK: Record<AccountRole, number> = { guest: 0, pending: 1, verified: 2 };

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

/** A public account payload — the ONLY account shape the client may hold. */
export interface PublicAccount {
  id: string;
  name: string;
  email: string;
  status: "pending" | "verified" | "rejected";
  /** Funnel stage for pending accounts: email | code | selfie | pending_review. */
  phase: "email" | "code" | "selfie" | "pending_review" | null;
  /** The only verification artifact shown publicly. */
  badge: "verified" | null;
  /** Assigned runner role — a label only, never a power source. */
  role: "runner" | "group_leader";
  /**
   * Super-admin flag, computed SERVER-side (account email vs
   * RUN_LOCAL_OWNER_EMAIL). The client renders this boolean and can never
   * self-assign the role — never derive it from the email client-side.
   */
  isOwner: boolean;
  /**
   * Posting-blocking suspension, computed SERVER-side against the current
   * time. The client may only see the boolean — never the expiry or reason.
   */
  suspended: boolean;
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
  return me.account.status === "verified" ? "verified" : "pending";
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
  return role === "group_leader" ? "Group Leader" : "Verified Runner";
}
