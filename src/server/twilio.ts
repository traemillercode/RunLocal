/**
 * SMS provider boundary (Twilio).
 *
 * Required env vars (exact names, per owner-approved discovery):
 *   TWILIO_ACCOUNT_SID     — Twilio account SID
 *   TWILIO_AUTH_TOKEN      — Twilio auth token (secret; server-side only)
 *   TWILIO_PHONE_NUMBER    — the From number, E.164 (non-secret identifier)
 *
 * Optional:
 *   RUN_LOCAL_SMS_MODE     — "twilio" (default) | "log" (DEV ONLY)
 *
 * Behavior:
 *  - twilio mode with all three vars set  → real SMS via Twilio Messages API.
 *  - twilio mode with any var missing    → explicit `sms_unconfigured` result.
 *    The API/UI then shows an explicit "SMS provider not configured" state —
 *    we NEVER fake a sent code.
 *  - log mode (explicit, dev only)       → the code is written to the server
 *    log so a developer can complete the flow locally. It is a real
 *    server-side code check, just delivered to the console instead of a
 *    phone. Never used in production; never claimed as SMS.
 *
 * Sensitive-value logging: this module logs only Twilio error codes and a
 * masked phone suffix — never full numbers, never codes.
 */
const REQUIRED_VARS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"] as const;

export interface SmsConfig {
  mode: "twilio" | "log";
  configured: boolean;
  missing: string[];
}

export function smsConfig(env: Record<string, string | undefined> = process.env): SmsConfig {
  const mode = (env.RUN_LOCAL_SMS_MODE ?? "twilio").toLowerCase();
  const missing = REQUIRED_VARS.filter((v) => !env[v]);
  if (mode === "log") return { mode: "log", configured: true, missing: [] };
  return { mode: "twilio", configured: missing.length === 0, missing };
}

export type SendCodeResult =
  | { ok: true }
  | { ok: false; kind: "unconfigured" | "provider_error"; message: string };

export async function sendVerificationCode(phone: string, code: string): Promise<SendCodeResult> {
  const cfg = smsConfig();
  if (cfg.mode === "log") {
    // DEV ONLY — explicitly enabled, delivers to the server console.
    // The verification itself is still a real server-side check.
    // eslint-disable-next-line no-console
    console.log(`[dev-only SMS] verification code for ${maskPhone(phone)}: ${code}`);
    return { ok: true };
  }
  if (!cfg.configured) {
    return {
      ok: false,
      kind: "unconfigured",
      message:
        "SMS provider is not configured on this server (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER). No code was sent.",
    };
  }
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const token = process.env.TWILIO_AUTH_TOKEN!;
    const from = process.env.TWILIO_PHONE_NUMBER!;
    const body = new URLSearchParams({
      From: from,
      To: phone,
      Body: `Run Local verification code: ${code}. It expires in 10 minutes. Do not share it.`,
    });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    if (!res.ok) {
      let twilioCode = "unknown";
      try {
        const data = (await res.json()) as { code?: number };
        twilioCode = String(data.code ?? res.status);
      } catch {
        twilioCode = String(res.status);
      }
      // Log the error code only — never the phone number or the code.
      // eslint-disable-next-line no-console
      console.error(`[twilio] send failed (error code ${twilioCode})`);
      return {
        ok: false,
        kind: "provider_error",
        message: "The SMS provider rejected the message. Verification is unavailable right now.",
      };
    }
    return { ok: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[twilio] send threw: ${err instanceof Error ? err.message : "unknown"}`);
    return {
      ok: false,
      kind: "provider_error",
      message: "Could not reach the SMS provider. Verification is unavailable right now.",
    };
  }
}

/** Logging/masking helper: "+15735550123" → "+******0123". */
export function maskPhone(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  if (clean.length < 4) return "****";
  return `+******${clean.slice(-4)}`;
}
