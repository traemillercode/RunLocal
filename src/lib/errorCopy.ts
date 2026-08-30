/**
 * Server error codes → human copy.
 *
 * THE DEFECT THIS FIXES is one line: `super(message ?? code)` in ApiError.
 * When the server omits a message — which it does for most of its 189 codes —
 * the client fell back to the code itself, so a signed-out visitor on /groups
 * saw a pink box containing the literal string `sign_in_required`. Forty-seven
 * places render an error message, so any of the 189 could surface as machine
 * output at any of them.
 *
 * Fixed at the ApiError constructor rather than at the 47 call sites: one
 * chokepoint means a code added tomorrow is covered without touching a page.
 *
 * THE FALLBACK IS THE IMPORTANT PART. An unmapped code must produce something
 * human, never its own name — the map cannot be complete, because the server
 * grows codes faster than this file will be updated, and a partial map that
 * leaks the remainder is barely better than no map.
 */

/** Shown when a code has no entry. Deliberately vague rather than wrong. */
export const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Codes worth saying something specific about.
 *
 * Deliberately NOT all 189. A code only earns an entry when the specific
 * wording helps the person act differently — otherwise the generic message is
 * more honest than an invented explanation. Most of the 189 are internal
 * validation failures a user can neither cause nor fix.
 */
export const ERROR_COPY: Readonly<Record<string, string>> = {
  // ── Auth and access ──────────────────────────────────────────────────
  sign_in_required: "Sign in to see this.",
  verified_runner_required: "Verify your account to do this.",
  participant_required: "This is only visible to people going to the run.",
  forbidden: "You don't have access to this.",
  suspended: "Your account is suspended. Check your email for details.",
  city_mismatch: "This belongs to a different city.",

  // ── Signup and invitations ───────────────────────────────────────────
  invitation_not_found: "We couldn't find an invitation for that email address.",
  invitation_revoked: "That invitation was withdrawn.",
  invitation_used: "That invitation has already been used.",
  invitation_expired: "That invitation has expired. Ask for a new one.",
  invalid_token: "That invitation link isn't valid. Check you copied all of it.",
  email_taken: "Already have an account? Sign in, or reset your password if you've forgotten it.",
  username_taken: "That username is taken. Try another.",
  invalid_email: "That doesn't look like an email address.",

  // ── Rate limiting and availability ───────────────────────────────────
  rate_limited: "Too many attempts. Wait a minute and try again.",
  city_coming_soon: "Kimbio isn't open in that city yet.",
  city_inactive: "That city isn't currently active.",

  // ── Content and validation ───────────────────────────────────────────
  not_found: "That's not here — it may have been removed.",
  image_too_large: "That image is too large. Try one under 4MB.",
  invalid_image: "That file isn't an image we can read.",
  message_required: "Add a little detail so we know what happened.",

  // ── Network, from the client ─────────────────────────────────────────
  network_error: "Couldn't reach Kimbio. Check your connection and try again.",
  timeout: "That took too long. Try again.",
};

/**
 * Human copy for a code, falling back to something readable.
 *
 * Also guards against a SERVER message that is itself a code — some handlers
 * pass the code through as the message, which would defeat the map entirely.
 */
export function errorCopy(code: string, serverMessage?: string): string {
  /*
   * SERVER MESSAGE WINS when it is a real sentence.
   *
   * The map's job is to fill the gap where the server said nothing — not to
   * override what it did say. A handler that took the trouble to write
   * "That username is already taken." knows more about the specific situation
   * than a generic entry keyed only on the code, and overriding it makes this
   * file a slow-drifting second source of copy.
   *
   * First version of this got the precedence backwards and silently replaced a
   * better message with a worse one; a signup test caught it.
   */
  if (serverMessage && !looksLikeCode(serverMessage)) return serverMessage;
  return ERROR_COPY[code] ?? GENERIC_ERROR;
}

/** snake_case with no spaces: `sign_in_required`, never a real sentence. */
export function looksLikeCode(value: string): boolean {
  return /^[a-z]+(_[a-z0-9]+)+$/.test(value.trim());
}
