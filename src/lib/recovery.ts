/** Parse Supabase callbacks before HashRouter consumes the URL. */
export type AuthCallback =
  | { kind: "recovery"; accessToken?: string; refreshToken?: string; code?: string }
  | { kind: "confirmation"; accessToken?: string; refreshToken?: string; code?: string }
  | { kind: "error"; flow: "recovery" | "confirmation"; error: string };
export function parseAuthCallback(url: string): AuthCallback | null {
  const parsed = new URL(url, "https://runlocal.invalid");
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  const params = new URLSearchParams(hash.includes("=") ? hash : parsed.search.slice(1));
  const type = params.get("type");
  const err = params.get("error_description") || params.get("error");
  const flow = type === "recovery" || parsed.searchParams.get("type") === "recovery" ? "recovery" : "confirmation";
  if (err) return { kind: "error", flow, error: err };
  if (type === "recovery") {
    const accessToken = params.get("access_token"); const refreshToken = params.get("refresh_token");
    const code = params.get("code") ?? parsed.searchParams.get("code");
    if (accessToken && refreshToken) return { kind: "recovery", accessToken, refreshToken };
    if (code) return { kind: "recovery", code };
    return { kind: "error", flow: "recovery", error: "This recovery link is incomplete or expired. Request a new one." };
  }
  if (type === "signup" || parsed.searchParams.get("code")) {
    return {
      kind: "confirmation",
      ...(params.get("access_token") ? { accessToken: params.get("access_token")! } : {}),
      ...(params.get("refresh_token") ? { refreshToken: params.get("refresh_token")! } : {}),
      ...(params.get("code") || parsed.searchParams.get("code") ? { code: params.get("code") ?? parsed.searchParams.get("code")! } : {}),
    };
  }
  return null;
}
export function cleanCallbackUrl(url: string): string {
  const parsed = new URL(url, "https://runlocal.invalid");
  parsed.hash = ""; parsed.search = "";
  return parsed.pathname + (parsed.pathname.endsWith("/") ? "" : "") ;
}
/** Backward-compatible recovery parser. */
export function parseRecoveryHash(hash: string) {
  const result = parseAuthCallback(`https://runlocal.invalid/${hash.startsWith("#") ? hash : `#${hash}`}`);
  if (!result || result.kind === "confirmation") return null;
  if (result.kind === "error") return { error: result.error };
  return { accessToken: result.accessToken, refreshToken: result.refreshToken, type: "recovery" as const };
}
