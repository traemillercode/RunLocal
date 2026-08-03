/**
 * Transactional email provider boundary (Resend). Secrets remain server-side.
 *
 * The provider is only ever contacted from sendVerificationEmail(). Health and
 * diagnostics never call Resend per request — emailSenderCheck() is a
 * deterministic, provider-free classification of the configured FROM address.
 */
const REQUIRED = ["RESEND_API_KEY", "RUN_LOCAL_EMAIL_FROM"] as const;
type EmailEnv = Record<string, string | undefined>;

export function emailConfig(env: EmailEnv = process.env) {
  const missing = REQUIRED.filter((name) => !(env[name]?.trim()));
  return { configured: missing.length === 0, missing };
}

export type SendEmailResult =
  | { ok: true }
  | { ok: false; kind: "unconfigured" | "provider_error"; message: string };

type SendEmailOptions = {
  env?: EmailEnv;
  fetchFn?: typeof fetch;
};

/**
 * Known consumer-mail domains. Resend only delivers from a domain you have
 * verified with them, and it is impossible to verify Gmail, Yahoo, Outlook and
 * similar personal mailboxes — so a FROM address on one of these can be called
 * "blocked" with certainty, without contacting the provider.
 */
const CONSUMER_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "aol.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "zoho.com",
  "yandex.com",
]);

export type EmailSenderStatus = "unconfigured" | "blocked" | "test_mode" | "custom_domain";

/**
 * Safe, deterministic view of the configured sender. No secrets and no
 * provider calls — used by /api/health on every request.
 *
 * - `unconfigured`: no usable FROM address.
 * - `blocked`: FROM domain is a consumer mailbox (Gmail etc.) — Resend can
 *   never verify it, so delivery WILL fail. `verified` is determinable: false.
 * - `test_mode`: Resend's `resend.dev` test sender — only delivers to the
 *   account owner's own inbox, so not valid for real user verification.
 * - `custom_domain`: Resend CAN verify this domain, but we do not call Resend
 *   here, so confirmation is undetermined (`verified` is null).
 */
export interface EmailSenderCheck {
  status: EmailSenderStatus;
  /** True only for a custom domain — a candidate Resend can verify, not a confirmation. */
  verifiable: boolean;
  /** Confirmed-verified status: false when determinably invalid, null when undetermined. */
  verified: boolean | null;
  /** Domain part of RUN_LOCAL_EMAIL_FROM only — never the full address. */
  domain: string | null;
  reason: "missing_sender" | "consumer_domain" | "resend_dev_test_sender" | "not_confirmed";
}

export function emailSenderCheck(env: EmailEnv = process.env): EmailSenderCheck {
  const raw = env.RUN_LOCAL_EMAIL_FROM?.trim() ?? "";
  // Accept both "Name <addr@domain>" and bare "addr@domain".
  const angle = /<([^<>]+)>/.exec(raw);
  const address = (angle ? angle[1] : raw).trim();
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) {
    return { status: "unconfigured", verifiable: false, verified: null, domain: null, reason: "missing_sender" };
  }
  const domain = address.slice(at + 1).toLowerCase();
  if (CONSUMER_MAIL_DOMAINS.has(domain)) {
    return { status: "blocked", verifiable: false, verified: false, domain, reason: "consumer_domain" };
  }
  if (domain === "resend.dev") {
    return { status: "test_mode", verifiable: false, verified: false, domain, reason: "resend_dev_test_sender" };
  }
  return { status: "custom_domain", verifiable: true, verified: null, domain, reason: "not_confirmed" };
}

/**
 * User-facing hint appended to provider failures. The most common deployment
 * mistake is a FROM address like a Gmail mailbox, which Resend cannot verify.
 */
const RESEND_VERIFY_HINT =
  "The sender address/domain must be verified in Resend before codes can be delivered (Gmail, Yahoo, Outlook and other personal mailboxes cannot be used).";

/**
 * Send one verification message using Resend's REST API. The dependency
 * injection is server/test-only: callers in production use the process env
 * and global fetch, while tests never contact Resend.
 */
export async function sendVerificationEmail(
  email: string,
  code: string,
  { env = process.env, fetchFn = fetch }: SendEmailOptions = {},
): Promise<SendEmailResult> {
  const cfg = emailConfig(env);
  if (!cfg.configured) {
    return {
      ok: false,
      kind: "unconfigured",
      message: `Email provider is not configured (${cfg.missing.join(", ")}). No code was sent.`,
    };
  }

  try {
    const response = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RUN_LOCAL_EMAIL_FROM!.trim(),
        to: [email],
        subject: "Run Local verification code",
        text: `Your Run Local verification code is ${code}. It expires in 10 minutes. Do not share it.`,
      }),
    });
    if (!response.ok) {
      // Resend's JSON error message is safe to surface (never contains
      // credentials); truncate it defensively and always add the verify hint.
      let detail = "";
      try {
        const body = (await response.clone().json()) as { message?: unknown };
        if (typeof body.message === "string" && body.message.trim()) {
          detail = body.message.trim().slice(0, 200);
        }
      } catch {
        // Non-JSON error body — fall back to the generic message below.
      }
      return {
        ok: false,
        kind: "provider_error",
        message: detail ? `${detail} ${RESEND_VERIFY_HINT}` : `The email provider rejected the message. ${RESEND_VERIFY_HINT}`,
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      kind: "provider_error",
      message: "Could not reach the email provider (Resend). Verification is unavailable right now.",
    };
  }
}
