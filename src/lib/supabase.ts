/**
 * Browser-side Supabase Auth adapter for email OTP verification.
 *
 * Supabase owns email delivery and OTP verification. The browser only ever
 * uses the PUBLIC anon key (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`);
 * there is no service_role key, no secret of any kind in this bundle, and no
 * verification record is stored client-side.
 *
 * Honesty rules:
 *  - When Supabase env vars are missing this adapter returns an explicit
 *    `unconfigured` result — it NEVER pretends a code was sent.
 *  - Provider errors are mapped to explicit, user-safe results (rate limits,
 *    invalid/expired codes, network failures). Nothing is faked.
 *
 * The 6-digit code boxes are preserved: `sendOtp` uses Supabase's
 * `signInWithOtp` (email, default 6-digit OTP) and `verifyOtp` uses
 * `verifyOtp({ type: "email" })`, returning the access token the Run Local
 * server will validate before it grants anything.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_REQUIRED_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"] as const;

export interface SupabaseClientConfig {
  configured: boolean;
  /** Names of missing/unusable variables (never values). */
  missing: string[];
  /** True when VITE_SUPABASE_URL is present but not a usable https URL. */
  urlInvalid: boolean;
  url: string | null;
  anonKey: string | null;
}

export function supabaseClientConfig(env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>): SupabaseClientConfig {
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

/** The subset of the auth client the adapter uses (easy to stub in tests). */
export interface SupabaseAuthLike {
  signInWithOtp: SupabaseClient["auth"]["signInWithOtp"];
  verifyOtp: SupabaseClient["auth"]["verifyOtp"];
}

const UNCONFIGURED_MESSAGE =
  "Email verification is not configured on this deployment (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing). No code was sent — nothing is faked.";

function makeAuth(cfg: SupabaseClientConfig): SupabaseAuthLike {
  return createClient(cfg.url!, cfg.anonKey!).auth;
}

// ------------------------------------------------------------------ sending
export type OtpSendResult =
  | { ok: true }
  | { ok: false; code: "unconfigured" | "rate_limited" | "send_failed"; message: string };

export interface OtpSendOptions {
  env?: Record<string, string | undefined>;
  /** Injectable auth stub for tests — defaults to the real supabase client. */
  auth?: SupabaseAuthLike;
}

export async function sendOtp(email: string, opts: OtpSendOptions = {}): Promise<OtpSendResult> {
  const cfg = supabaseClientConfig(opts.env ?? (import.meta.env as Record<string, string | undefined>));
  if (!cfg.configured) return { ok: false, code: "unconfigured", message: UNCONFIGURED_MESSAGE };
  const auth = opts.auth ?? makeAuth(cfg);
  try {
    const { error } = await auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) {
      const msg = error.message ?? "";
      if (/security purposes|only request this|too (many|often)|try again/i.test(msg)) {
        return {
          ok: false,
          code: "rate_limited",
          message: "Supabase is rate-limiting code requests for this email. Wait a minute, then try again.",
        };
      }
      if (/signups? not allowed/i.test(msg)) {
        return {
          ok: false,
          code: "send_failed",
          message: "Signups are disabled in the Supabase project settings — turn on 'Allow new users to sign up'.",
        };
      }
      return { ok: false, code: "send_failed", message: `Supabase couldn't send the code: ${msg}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: "send_failed", message: "Could not reach the Supabase email service. Check your connection and try again." };
  }
}

// ---------------------------------------------------------------- verifying
export type OtpVerifyResult =
  | { ok: true; accessToken: string }
  | { ok: false; code: "unconfigured" | "invalid_code" | "code_expired" | "rate_limited" | "verify_failed"; message: string };

export interface OtpVerifyOptions {
  env?: Record<string, string | undefined>;
  /** Injectable auth stub for tests — defaults to the real supabase client. */
  auth?: SupabaseAuthLike;
}

export async function verifyOtp(email: string, token: string, opts: OtpVerifyOptions = {}): Promise<OtpVerifyResult> {
  const cfg = supabaseClientConfig(opts.env ?? (import.meta.env as Record<string, string | undefined>));
  if (!cfg.configured) return { ok: false, code: "unconfigured", message: UNCONFIGURED_MESSAGE };
  const auth = opts.auth ?? makeAuth(cfg);
  try {
    const { data, error } = await auth.verifyOtp({ email, token, type: "email" });
    if (error) {
      const msg = error.message ?? "";
      if (/expired/i.test(msg)) {
        return { ok: false, code: "code_expired", message: "That code expired. Request a new one below." };
      }
      if (/security purposes|only request this|too (many|often)/i.test(msg)) {
        return { ok: false, code: "rate_limited", message: "Too many attempts. Wait a minute, then request a new code." };
      }
      if (/invalid|wrong|incorrect|otp/i.test(msg)) {
        return { ok: false, code: "invalid_code", message: "That code wasn't right — check the email and try again." };
      }
      return { ok: false, code: "verify_failed", message: msg };
    }
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      return { ok: false, code: "verify_failed", message: "Supabase verified the code but returned no session token." };
    }
    return { ok: true, accessToken };
  } catch {
    return { ok: false, code: "verify_failed", message: "Could not reach the Supabase email service. Check your connection and try again." };
  }
}
