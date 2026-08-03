/** Transactional email provider boundary (Resend). Secrets remain server-side. */
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
      return {
        ok: false,
        kind: "provider_error",
        message: "The email provider rejected the message. Verification is unavailable right now.",
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      kind: "provider_error",
      message: "Could not reach the email provider. Verification is unavailable right now.",
    };
  }
}
