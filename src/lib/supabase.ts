/** Browser-safe Supabase Auth adapter. Only the public anon key is used. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_REQUIRED_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"] as const;
export interface SupabaseClientConfig { configured: boolean; missing: string[]; urlInvalid: boolean; url: string | null; anonKey: string | null; redirectUrl: string; emailDelivery: "provider-managed" | "not-configured" }

export const productionOrigin = "https://runlocal.ctonew.app";
export function authRedirectUrl(env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>): string {
  return env.VITE_AUTH_REDIRECT_URL?.trim() || (typeof window !== "undefined" ? window.location.origin : productionOrigin);
}
export function supabaseClientConfig(env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>): SupabaseClientConfig {
  const missing: string[] = [], rawUrl = env.VITE_SUPABASE_URL?.trim() ?? "", anonKey = env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
  let valid = false; try { const u = new URL(rawUrl); valid = u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)); } catch {}
  if (!rawUrl || !valid) missing.push("VITE_SUPABASE_URL");
  if (!anonKey) missing.push("VITE_SUPABASE_ANON_KEY");
  return { configured: missing.length === 0, missing, urlInvalid: Boolean(rawUrl && !valid), url: valid ? rawUrl : null, anonKey: anonKey || null, redirectUrl: authRedirectUrl(env), emailDelivery: env.VITE_SUPABASE_SMTP_CONFIGURED === "true" ? "provider-managed" : "not-configured" };
}
export interface SupabaseAuthLike {
  signUp?: SupabaseClient["auth"]["signUp"];
  signInWithPassword?: SupabaseClient["auth"]["signInWithPassword"];
  resetPasswordForEmail?: SupabaseClient["auth"]["resetPasswordForEmail"];
  updateUser?: SupabaseClient["auth"]["updateUser"];
  setSession?: SupabaseClient["auth"]["setSession"];
}
const missingMessage = "Password sign-in is not configured on this deployment (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing).";
function authFor(cfg: SupabaseClientConfig): SupabaseAuthLike { return createClient(cfg.url!, cfg.anonKey!).auth; }
function cfg(opts?: Record<string, string | undefined>) { return supabaseClientConfig(opts ?? (import.meta.env as Record<string, string | undefined>)); }
export type AuthResult = { ok: true; accessToken: string | null; emailConfirmationRequired: boolean } | { ok: false; code: "unconfigured" | "invalid_credentials" | "email_not_confirmed" | "email_taken" | "rate_limited" | "failed"; message: string };
function mapError(message: string): AuthResult { if (/invalid login credentials/i.test(message)) return { ok:false, code:"invalid_credentials", message:"Email or password is incorrect." }; if (/email not confirmed/i.test(message)) return { ok:false, code:"email_not_confirmed", message:"Confirm your email from the message Supabase sent, then try again." }; if (/already registered|already exists/i.test(message)) return { ok:false, code:"email_taken", message:"That email already has an account. Log in instead." }; if (/rate|too many|security purposes/i.test(message)) return { ok:false, code:"rate_limited", message:"Too many attempts. Wait a moment and try again." }; return { ok:false, code:"failed", message: message || "Supabase could not complete that request." }; }
export async function signUp(email: string, password: string, opts: { env?: Record<string,string|undefined>; auth?: SupabaseAuthLike } = {}): Promise<AuthResult> {
  const c = cfg(opts.env); if (!c.configured) return { ok:false, code:"unconfigured", message:missingMessage };
  try { const { data, error } = await (opts.auth ?? authFor(c)).signUp!({ email, password, options: { emailRedirectTo: c.redirectUrl } }); if (error) return mapError(error.message); return { ok:true, accessToken:data.session?.access_token ?? null, emailConfirmationRequired:!data.session }; } catch { return {ok:false,code:"failed",message:"Could not reach the Supabase Auth service. Check your connection and try again."}; }
}
export async function signInWithPassword(email: string, password: string, opts: { env?: Record<string,string|undefined>; auth?: SupabaseAuthLike } = {}): Promise<AuthResult> {
  const c = cfg(opts.env); if (!c.configured) return { ok:false, code:"unconfigured", message:missingMessage };
  try { const { data, error } = await (opts.auth ?? authFor(c)).signInWithPassword!({ email, password }); if (error) return mapError(error.message); const token=data.session?.access_token; return token ? {ok:true,accessToken:token,emailConfirmationRequired:false} : {ok:false,code:"failed",message:"Supabase returned no session token."}; } catch { return {ok:false,code:"failed",message:"Could not reach the Supabase Auth service. Check your connection and try again."}; }
}
export async function resetPasswordForEmail(email: string, opts: { env?: Record<string,string|undefined>; auth?: SupabaseAuthLike } = {}): Promise<{ok:true}|{ok:false;code:"unconfigured"|"failed";message:string}> {
  const c=cfg(opts.env); if(!c.configured) return {ok:false,code:"unconfigured",message:missingMessage};
  try { const {error}=await (opts.auth??authFor(c)).resetPasswordForEmail!(email, { redirectTo: c.redirectUrl }); return error ? {ok:false,code:"failed",message:"Supabase could not send a reset email. Check the address and try again."}:{ok:true}; } catch { return {ok:false,code:"failed",message:"Could not reach the Supabase Auth service. Check your connection and try again."}; }
}
export async function setRecoverySession(accessToken: string, refreshToken: string, opts: { env?: Record<string,string|undefined>; auth?: SupabaseAuthLike } = {}) {
  const c=cfg(opts.env); if(!c.configured) return {ok:false as const, code:"unconfigured", message:missingMessage};
  try { const {error}=await (opts.auth??authFor(c)).setSession!({access_token:accessToken, refresh_token:refreshToken}); return error ? {ok:false as const, code:"failed", message:"This recovery link is invalid or expired. Request a new one."}:{ok:true as const}; } catch { return {ok:false as const,code:"failed",message:"This recovery link is invalid or expired. Request a new one."}; }
}
export async function updatePassword(password: string, opts: { env?: Record<string,string|undefined>; auth?: SupabaseAuthLike } = {}) {
  const c=cfg(opts.env); if(!c.configured) return {ok:false as const, code:"unconfigured", message:missingMessage};
  try { const {error}=await (opts.auth??authFor(c)).updateUser!({password}); return error ? {ok:false as const,code:"failed",message:"Could not update your password. The recovery link may have expired."}:{ok:true as const}; } catch { return {ok:false as const,code:"failed",message:"Could not update your password. The recovery link may have expired."}; }
}

/** Email-code helpers remain for the separate identity-verification funnel; password is the primary auth UI. */
export interface OtpAuthLike { signInWithOtp: SupabaseClient["auth"]["signInWithOtp"]; verifyOtp: SupabaseClient["auth"]["verifyOtp"] }
export async function sendOtp(email: string, opts: { env?: Record<string,string|undefined>; auth?: OtpAuthLike } = {}): Promise<{ok:true}|{ok:false;code:"unconfigured"|"rate_limited"|"send_failed";message:string}> {
 const c=cfg(opts.env); if(!c.configured)return {ok:false,code:"unconfigured",message:missingMessage}; try {const {error}=await (opts.auth??authFor(c) as unknown as OtpAuthLike).signInWithOtp({email,options:{shouldCreateUser:true}}); if(!error)return {ok:true}; return {ok:false,code:/rate|too many|security purposes/i.test(error.message)?"rate_limited":"send_failed",message:"Could not send the verification email. Try again."};}catch{return {ok:false,code:"send_failed",message:"Could not reach the Supabase Auth service."}}
}
export async function verifyOtp(email:string,token:string,opts:{env?:Record<string,string|undefined>;auth?:OtpAuthLike}={}):Promise<{ok:true;accessToken:string}|{ok:false;code:"unconfigured"|"invalid_code"|"code_expired"|"rate_limited"|"verify_failed";message:string}> {const c=cfg(opts.env);if(!c.configured)return {ok:false,code:"unconfigured",message:missingMessage};try{const {data,error}=await(opts.auth??authFor(c) as unknown as OtpAuthLike).verifyOtp({email,token,type:"email"});if(error)return {ok:false,code:/expired/i.test(error.message)?"code_expired":/rate|too many/i.test(error.message)?"rate_limited":"invalid_code",message:"That verification code was not accepted."};const tokenOut=data.session?.access_token;if(!tokenOut)return {ok:false,code:"verify_failed",message:"Supabase returned no session token."};return {ok:true,accessToken:tokenOut}}catch{return {ok:false,code:"verify_failed",message:"Could not reach the Supabase Auth service."}}}
