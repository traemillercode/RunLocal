/**
 * Server-side Supabase Auth bridge for email OTP verification.
 *
 * Supabase owns email delivery + OTP verification (signInWithOtp /
 * verifyOtp run in the browser with the PUBLIC anon key). This module is the
 * server's half of the bridge: it validates that a presented access token is
 * a REAL Supabase session for a given identity, so the Run Local server never
 * trusts a client-supplied "email verified" claim, email address, or role.
 *
 * Verification strategy (honest, no fake auth):
 *  - The server introspects the access token against the Supabase project's
 *    `/auth/v1/user` endpoint, sending `apikey: <anon key>` (the same public,
 *    browser-safe key the client uses) plus `Authorization: Bearer <token>`.
 *    That endpoint only returns the user when the token is a genuine,
 *    unexpired session minted by Supabase — this is exactly the call the
 *    supabase-js client makes internally, so no service_role key is needed.
 *  - If the token is rejected (401), expired, malformed, or the project is
 *    unreachable, we return an explicit failure — we never fake success.
 *
 * No provider secrets exist here: the anon key is public by design, and no
 * service_role key is ever requested, stored, or shipped to the client.
 */
export const SUPABASE_REQUIRED_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"] as const;

export interface SupabaseServerConfig {
  configured: boolean;
  /** Names of missing/unusable variables (never their values). */
  missing: string[];
  /** True when VITE_SUPABASE_URL is present but not a usable https URL. */
  urlInvalid: boolean;
  url: string | null;
  anonKey: string | null;
}

export function supabaseConfig(env: Record<string, string | undefined> = process.env): SupabaseServerConfig {
  const missing: string[] = [];
  const rawUrl = env.VITE_SUPABASE_URL?.trim() ?? "";
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
  let urlValid = false;
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      urlValid = u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
    } catch {
      urlValid = false;
    }
  }
  if (!rawUrl) missing.push("VITE_SUPABASE_URL");
  else if (!urlValid) missing.push("VITE_SUPABASE_URL");
  if (!anonKey) missing.push("VITE_SUPABASE_ANON_KEY");
  return {
    configured: missing.length === 0,
    missing,
    urlInvalid: Boolean(rawUrl && !urlValid),
    url: urlValid ? rawUrl : null,
    anonKey: anonKey || null,
  };
}

export type TokenVerifyResult =
  | { ok: true; sub: string; email: string }
  | { ok: false; reason: "unconfigured" | "rejected" | "network"; message: string };

export interface TokenVerifyOptions {
  env?: Record<string, string | undefined>;
  /** Injectable for tests — production uses the global fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Validate a Supabase access token and return the authenticated identity
 * (sub = Supabase user UUID, email = verified email claim). Only an OK result
 * may ever be treated as "the user proved control of this email via Supabase".
 */
export async function verifySupabaseToken(token: string, opts: TokenVerifyOptions = {}): Promise<TokenVerifyResult> {
  const cfg = supabaseConfig(opts.env ?? process.env);
  if (!cfg.configured) {
    return {
      ok: false,
      reason: "unconfigured",
      message: "Supabase email verification is not configured on this server (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing).",
    };
  }
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  try {
    const res = await fetchFn(`${cfg.url}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: cfg.anonKey!,
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 401) {
      return { ok: false, reason: "rejected", message: "The Supabase session token was rejected. Request a new code and try again." };
    }
    if (!res.ok) {
      return { ok: false, reason: "network", message: `The Supabase identity check failed (HTTP ${res.status}).` };
    }
    const body = (await res.json()) as { id?: unknown; email?: unknown };
    const sub = typeof body.id === "string" && body.id.length > 0 ? body.id : null;
    const email = typeof body.email === "string" && body.email.length > 0 ? body.email.toLowerCase() : null;
    if (!sub || !email) {
      return { ok: false, reason: "rejected", message: "Supabase did not return a usable identity for this token." };
    }
    return { ok: true, sub, email };
  } catch {
    return { ok: false, reason: "network", message: "Could not reach the Supabase identity service. Try again." };
  }
}

/**
 * Apply the Supabase identity to a Run Local account — the secure bridge
 * rules. Returns the store patch to apply on success; on failure the caller
 * must NOT link anything.
 *
 * - The token's email MUST equal the account's email (a Supabase user for a
 *   different address proves nothing about this account).
 * - If the account is already linked to a Supabase user, the token's sub MUST
 *   match that link (an account can't be silently re-homed to another
 *   Supabase identity). A null link is bound on first successful verification.
 */
export function applySupabaseIdentity(
  account: { email: string; supabaseAuthId: string | null },
  token: { sub: string; email: string },
): { ok: true; patch: { supabaseAuthId: string } } | { ok: false; code: "email_mismatch" | "identity_mismatch"; message: string } {
  if (token.email !== account.email.toLowerCase()) {
    return {
      ok: false,
      code: "email_mismatch",
      message: "The verified email doesn't match this account's email. Sign in with the email you used to sign up.",
    };
  }
  if (account.supabaseAuthId && account.supabaseAuthId !== token.sub) {
    return {
      ok: false,
      code: "identity_mismatch",
      message: "This account is already linked to a different Supabase identity.",
    };
  }
  return { ok: true, patch: { supabaseAuthId: token.sub } };
}
