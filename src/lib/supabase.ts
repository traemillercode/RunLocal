/** Browser-safe Supabase Auth adapter. Only the public anon key is used. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_REQUIRED_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"] as const;
export interface SupabaseClientConfig { configured: boolean; missing: string[]; urlInvalid: boolean; url: string | null; anonKey: string | null }
export function supabaseClientConfig(env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>): SupabaseClientConfig {
  const missing: string[] = [], rawUrl = env.VITE_SUPABASE_URL?.trim() ?? "", anonKey = env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
  let valid = false; try { const u = new URL(rawUrl); valid = u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)); } catch {}
  if (!rawUrl || !valid) missing.push("VITE_SUPABASE_URL");
  if (!anonKey) missing.push("VITE_SUPABASE_ANON_KEY");
  return { configured: missing.length === 0, missing, urlInvalid: Boolean(rawUrl && !valid), url: valid ? rawUrl : null, anonKey: anonKey || null };
}
export interface SupabaseAuthLike {
  signUp?: SupabaseClient["auth"]["signUp"];
  signInWithPassword?: SupabaseClient["auth"]["signInWithPassword"];
  resetPasswordForEmail?: SupabaseClient["auth"]["resetPasswordForEmail"];
}
const missingMessage = "Password sign-in is not configured on this deployment (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing).";
function authFor(cfg: SupabaseClientConfig): SupabaseAuthLike { return createClient(cfg.url!, cfg.anonKey!).auth; }
function cfg(opts?: Record<string, string | undefined>) { return supabaseClientConfig(opts ?? (import.meta.env as Record<string, string | undefined>)); }
export type AuthResult = { ok: true; accessToken: string | null; emailConfirmationRequired: boolean } | { ok: false; code: "unconfigured" | "invalid_credentials" | "email_not_confirmed" | "email_taken" | "rate_limited" | "failed"; message: string };
function mapError(message: string): AuthResult { if (/invalid login credentials/i.test(message)) return { ok:false, code:"invalid_credentials", message:"Email or password is incorrect." }; if (/email not confirmed/i.test(message)) return { ok:false, code:"email_not_confirmed", message:"Confirm your email from the message Supabase sent, then try again." }; if (/already registered|already exists/i.test(message)) return { ok:false, code:"email_taken", message:"That email already has an account. Log in instead." }; if (/rate|too many|security purposes/i.test(message)) return { ok:false, code:"rate_limited", message:"Too many attempts. Wait a moment and try again." }; return { ok:false, code:"failed", message: message || "Supabase could not complete that request." }; }
export async function signUp(email: string, password: string, opts: { env?: Record<string,string|undefined>; auth?: SupabaseAuthLike } = {}): Promise<AuthResult> {
  const c = cfg(opts.env); if (!c.configured) return { ok:false, code:"unconfigured", message:missingMessage };
  try { const { data, error } = await (opts.auth ?? authFor(c)).signUp({ email, password }); if (error) return mapError(error.message); return { ok:true, accessToken:data.session?.access_token ?? null, emailConfirmationRequired:!data.session }; } catch { return {ok:false,code:"failed",message:"Could not reach the Supabase Auth service. Check your connection and try again."}; }
}
export async function signInWithPassword(email: string, password: string, opts: { env?: Record<string,string|undefined>; auth?: SupabaseAuthLike } = {}): Promise<AuthResult> {
  const c = cfg(opts.env); if (!c.configured) return { ok:false, code:"unconfigured", message:missingMessage };
  try { const { data, error } = await (opts.auth ?? authFor(c)).signInWithPassword({ email, password }); if (error) return mapError(error.message); const token=data.session?.access_token; return token ? {ok:true,accessToken:token,emailConfirmationRequired:false} : {ok:false,code:"failed",message:"Supabase returned no session token."}; } catch { return {ok:false,code:"failed",message:"Could not reach the Supabase Auth service. Check your connection and try again."}; }
}
export async function resetPasswordForEmail(email: string, opts: { env?: Record<string,string|undefined>; auth?: SupabaseAuthLike } = {}): Promise<{ok:true}|{ok:false;code:"unconfigured"|"failed";message:string}> {
  const c=cfg(opts.env); if(!c.configured) return {ok:false,code:"unconfigured",message:missingMessage}; try { const {error}=await (opts.auth??authFor(c)).resetPasswordForEmail(email); return error ? {ok:false,code:"failed",message:"Supabase could not send a reset email. Check the address and try again."}:{ok:true}; } catch { return {ok:false,code:"failed",message:"Could not reach the Supabase Auth service. Check your connection and try again."}; }
}

/** Email-code helpers remain for the separate identity-verification funnel; password is the primary auth UI. */
export interface OtpAuthLike { signInWithOtp: SupabaseClient["auth"]["signInWithOtp"]; verifyOtp: SupabaseClient["auth"]["verifyOtp"] }
export async function sendOtp(email: string, opts: { env?: Record<string,string|undefined>; auth?: OtpAuthLike } = {}): Promise<{ok:true}|{ok:false;code:"unconfigured"|"rate_limited"|"send_failed";message:string}> {
 const c=cfg(opts.env); if(!c.configured)return {ok:false,code:"unconfigured",message:missingMessage}; try {const {error}=await (opts.auth??authFor(c) as unknown as OtpAuthLike).signInWithOtp({email,options:{shouldCreateUser:true}}); if(!error)return {ok:true}; return {ok:false,code:/rate|too many|security purposes/i.test(error.message)?"rate_limited":"send_failed",message:/signups? not allowed/i.test(error.message)?"Signups are disabled in Supabase — turn on Allow new users to sign up.":"Could not send the verification email. Try again."};}catch{return {ok:false,code:"send_failed",message:"Could not reach the Supabase Auth service."}}
}
export async function verifyOtp(email:string,token:string,opts:{env?:Record<string,string|undefined>;auth?:OtpAuthLike}={}):Promise<{ok:true;accessToken:string}|{ok:false;code:"unconfigured"|"invalid_code"|"code_expired"|"rate_limited"|"verify_failed";message:string}> {const c=cfg(opts.env);if(!c.configured)return {ok:false,code:"unconfigured",message:missingMessage};try{const {data,error}=await(opts.auth??authFor(c) as unknown as OtpAuthLike).verifyOtp({email,token,type:"email"});if(error)return {ok:false,code:/expired/i.test(error.message)?"code_expired":/rate|too many/i.test(error.message)?"rate_limited":"invalid_code",message:"That verification code was not accepted."};const tokenOut=data.session?.access_token;if(!tokenOut)return {ok:false,code:"verify_failed",message:"Supabase returned no session token."};return {ok:true,accessToken:tokenOut}}catch{return {ok:false,code:"verify_failed",message:"Could not reach the Supabase Auth service."}}}
