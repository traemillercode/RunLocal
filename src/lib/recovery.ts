/** Helpers for Supabase recovery links delivered in the URL hash. */
export interface RecoveryParams { accessToken: string; refreshToken: string; type: "recovery" }
export function parseRecoveryHash(hash: string): RecoveryParams | { error: string } | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw.startsWith("/") ? "" : raw);
  if (params.get("error") || params.get("error_description")) return { error: params.get("error_description") || params.get("error") || "This recovery link is invalid or expired." };
  if (params.get("type") !== "recovery") return null;
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return { error: "This recovery link is incomplete or expired. Request a new one." };
  return { accessToken, refreshToken, type: "recovery" };
}
