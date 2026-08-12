/**
 * Owner / super-admin identity — a server-side role rule.
 *
 * The owner is identified by EMAIL only, and only ever server-side: the signed
 * in session's account email is compared against `RUN_LOCAL_OWNER_EMAIL`
 * (default: the owner's address). The browser receives just an `isOwner`
 * boolean from `/api/me`; it never derives the role from the email itself and
 * can never self-assign it (there is no client-supplied role input anywhere).
 *
 * Being the owner grants access to the admin control center (pending queue).
 * It does NOT bypass verification: the owner still verifies their own email
 * and selfie like anyone else, and owner admin actions are reason-required and
 * audited exactly like key-based admin actions.
 */
type Env = Record<string, string | undefined>;

export const OWNER_EMAIL_VAR = "RUN_LOCAL_OWNER_EMAIL";
/** Owner/developer super-admin (traemiller.email@gmail.com). */
export const DEFAULT_OWNER_EMAIL = "traemiller.email@gmail.com";

export function ownerEmail(env: Env = process.env): string {
  return env[OWNER_EMAIL_VAR]?.trim().toLowerCase() || DEFAULT_OWNER_EMAIL;
}

/** Case-insensitive owner check against a stored account email. */
export function isOwnerEmail(email: string | null | undefined, env: Env = process.env): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ownerEmail(env);
}
