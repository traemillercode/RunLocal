/**
 * Username rules & normalization — the single source of truth for what a
 * valid Kimbio username is.
 *
 * ALLOWED CHARACTERS: 3–24 characters; must start with a letter (a–z), then
 * lowercase letters, digits, underscore (`_`) or hyphen (`-`):
 *
 *     /^[a-z][a-z0-9_-]{2,23}$/
 *
 * CASE BEHAVIOR: usernames are case-insensitive and are stored normalized to
 * lowercase. `JordanLee`, `jordanlee`, and `JORDANLEE` are the SAME name —
 * the second account to claim any casing of a taken name is rejected as a
 * duplicate. Input is trimmed before validation, so leading/trailing
 * whitespace is ignored (never stored).
 *
 * SECURITY MODEL: the server validates with `normalizeUsername()` on every
 * write (signup and profile update). The client uses this module only for
 * inline UX hints and fast feedback; a client-side pass is never trusted —
 * the server is authoritative and rejects anything that does not normalize.
 *
 * Uniqueness is enforced server-side (case-insensitive, normalized form) by
 * the API layer against the single in-process store; see `Db` in
 * `src/server/store.ts`. Usernames are public profile identity — they are
 * deliberately included in the public account payload — but never anything
 * sensitive (no phone/selfie/IP/verification data travels with them).
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const USERNAME_PATTERN = /^[a-z][a-z0-9_-]{2,23}$/;

/** Short copy shown under the signup/editor inputs. */
export const USERNAME_HINT =
  "3–24 characters: letters, numbers, _ and - (must start with a letter). Usernames are case-insensitive and stored lowercase.";

/** Longer copy for the profile editor empty state. */
export const USERNAME_PROMPT =
  "Pick a username (3–24 characters: letters, numbers, _ and -, starting with a letter). It's public and unique — case doesn't matter.";

/**
 * Normalize + validate a raw username input.
 *
 * Returns the canonical (trimmed, lowercase) form, or `null` when the input
 * is not a valid username. Callers MUST treat `null` as a hard rejection —
 * never fall back to a partial or unnormalized value.
 */
export function normalizeUsername(input: string): string | null {
  const candidate = input.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(candidate)) return null;
  return candidate;
}
