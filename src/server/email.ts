/**
 * Minimal transactional email sender via Resend's HTTP API.
 *
 * Separate from Supabase's SMTP (which only handles Supabase Auth's own
 * emails — confirm signup, reset password, etc.). This is for emails OUR
 * OWN server needs to send in response to app events, like verification
 * approval. Silently no-ops if RESEND_API_KEY isn't set, so a misconfigured
 * deployment degrades to "no email sent" rather than a crash.
 */
export async function sendEmail(input: { to: string; subject: string; html: string }): Promise<{ ok: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from: "Kimbio <hello@getkimbio.com>", to: [input.to], subject: input.subject, html: input.html }),
    });
    return { ok: r.ok };
  } catch {
    return { ok: false };
  }
}

export function verifiedEmailHtml(name: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>You're verified on Kimbio</title></head>
  <body style="margin:0;background:#f7f7f5;font-family:Arial,Helvetica,sans-serif;color:#14171C;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f7f5;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
          <tr><td style="background:#14171C;padding:28px 32px;">
            <div style="font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-.5px;">Kim<span style="color:#FF5741;">bio</span></div>
            <div style="margin-top:6px;font-size:14px;color:#c9cdd3;">Your run. Your people. Your city.</div>
          </td></tr>
          <tr><td style="padding:36px 32px;">
            <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;color:#14171C;">You're verified, ${name}!</h1>
            <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Your identity has been reviewed and approved. You're all set to join runs, connect with other runners, and post in the forum.</p>
            <a href="https://getkimbio.com" style="display:inline-block;background:#FF5741;color:#14171C;text-decoration:none;font-size:16px;font-weight:800;padding:14px 22px;border-radius:10px;">Open Kimbio</a>
          </td></tr>
          <tr><td style="padding:20px 32px;background:#f2f2f0;font-size:12px;line-height:1.5;color:#5b5f66;">Kimbio helps runners connect with local group runs and running communities.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
