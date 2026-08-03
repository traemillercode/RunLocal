/** Transactional email provider boundary (Resend). Secrets remain server-side. */
const REQUIRED = ["RESEND_API_KEY", "RUN_LOCAL_EMAIL_FROM"] as const;
export function emailConfig(env: Record<string,string|undefined> = process.env) {
  const missing = REQUIRED.filter((v) => !env[v]);
  return { configured: missing.length === 0, missing };
}
export type SendEmailResult = {ok:true} | {ok:false; kind:"unconfigured"|"provider_error"; message:string};
export async function sendVerificationEmail(email:string, code:string): Promise<SendEmailResult> {
  const cfg = emailConfig();
  if (!cfg.configured) return {ok:false, kind:"unconfigured", message:`Email provider is not configured (${cfg.missing.join(", ")}). No code was sent.`};
  try {
    const response = await fetch("https://api.resend.com/emails", { method:"POST", headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY!}`, "Content-Type":"application/json"}, body:JSON.stringify({from:process.env.RUN_LOCAL_EMAIL_FROM!, to:[email], subject:"Run Local verification code", text:`Your Run Local verification code is ${code}. It expires in 10 minutes. Do not share it.`}) });
    if (!response.ok) return {ok:false, kind:"provider_error", message:"The email provider rejected the message. Verification is unavailable right now."};
    return {ok:true};
  } catch { return {ok:false, kind:"provider_error", message:"Could not reach the email provider. Verification is unavailable right now."}; }
}
