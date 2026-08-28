import type { Db } from "./store";
import { sendEmail } from "./email";

const WORKOUT_LABELS: Record<string, string> = { run: "Run", cross_training: "Cross-training", rest: "Rest", recovery: "Recovery", race: "Race day", swim: "Swim" };
const RUN_LABELS: Record<string, string> = { easy: "Easy", tempo: "Tempo", long_run: "Long run", workout: "Workout", recovery_run: "Recovery run", race_pace: "Race pace", intervals: "Intervals" };

function formatDayLine(day: { date: string; workoutType: string; runLabel: string | null; title: string; distanceValue: number | null; distanceUnit: string }): string {
  const dateLabel = new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const kind = day.runLabel ? RUN_LABELS[day.runLabel] : WORKOUT_LABELS[day.workoutType] ?? day.workoutType;
  const distance = day.distanceValue != null ? ` — ${day.distanceValue} ${day.distanceUnit}` : "";
  const title = day.title ? ` (${day.title})` : "";
  return `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;"><strong>${dateLabel}</strong> — ${kind}${distance}${title}</td></tr>`;
}

/**
 * Builds and sends one weekly plan email - shared by the manual "send this
 * week" action (coach or self-coached athlete) and the automatic scheduled
 * fallback, so both paths produce identical, simple emails: the week's
 * schedule plus a notes section, nothing more.
 */
export async function sendWeeklyPlanEmail(
  db: Db,
  accountId: string,
  weekStartDate: string,
  notes: string,
  sentBy: "self" | "coach" | "automatic",
  coachId: string | null,
  now: Date,
): Promise<{ ok: boolean }> {
  const account = db.getAccount(accountId);
  if (!account || account.deletedAt) return { ok: false };
  const weekEnd = new Date(`${weekStartDate}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);
  const days = db.listTrainingPlanDays(accountId).filter((d) => d.date >= weekStartDate && d.date <= weekEndStr);
  const strength = db.listStrengthEntries(accountId).filter((e) => e.date >= weekStartDate && e.date <= weekEndStr);
  const coach = coachId ? db.getAccount(coachId) : null;

  const rows = [...days].sort((a, b) => a.date.localeCompare(b.date)).map(formatDayLine).join("");
  const strengthRows = strength.length
    ? `<p style="margin:20px 0 8px;font-size:14px;font-weight:bold;">Strength / gym</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${strength.map((s) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;">${new Date(`${s.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })} — ${s.title}</td></tr>`).join("")}</table>`
    : "";

  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your week on Kimbio</title></head>
  <body style="margin:0;background:#f7f7f5;font-family:Arial,Helvetica,sans-serif;color:#14171C;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f7f5;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
          <tr><td style="background:#14171C;padding:28px 32px;">
            <div style="font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-.5px;">Kim<span style="color:#FF5741;">bio</span></div>
            <div style="margin-top:6px;font-size:14px;color:#c9cdd3;">Your week ahead</div>
          </td></tr>
          <tr><td style="padding:36px 32px;">
            <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;color:#14171C;">Hi ${account.name.split(" ")[0]},</h1>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#5b5f66;">${coach ? `${coach.name} sent your` : "Here's your"} schedule for the week of ${new Date(`${weekStartDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows || '<tr><td style="padding:10px 0;font-size:14px;color:#8a8f98;">Nothing scheduled yet this week.</td></tr>'}</table>
            ${strengthRows}
            ${notes.trim() ? `<p style="margin:24px 0 4px;font-size:14px;font-weight:bold;">Notes</p><p style="margin:0;font-size:14px;line-height:1.6;color:#3a3d42;white-space:pre-wrap;">${notes.trim()}</p>` : ""}
            <a href="https://getkimbio.com/training-plan" style="display:inline-block;margin-top:24px;background:#FF5741;color:#14171C;text-decoration:none;font-size:15px;font-weight:800;padding:12px 20px;border-radius:10px;">View full plan</a>
          </td></tr>
          <tr><td style="padding:20px 32px;background:#f2f2f0;font-size:12px;line-height:1.5;color:#5b5f66;">${sentBy === "automatic" ? "Sent automatically — no one made changes to this week's plan, so here's what's currently scheduled." : "Kimbio training plans."}</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const result = await sendEmail({ to: account.email, subject: `Your week on Kimbio — ${new Date(`${weekStartDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`, html });
  // Only record success - if this failed (e.g. Resend misconfigured), recording it anyway would
  // make the idempotency check think this week is handled, permanently blocking any future retry
  // (manual or automatic) for an email that never actually went out.
  if (result.ok) {
    db.recordWeeklyPlanEmail({ id: `${accountId}-weekemail-${weekStartDate}`, accountId, weekStartDate, notes: notes.trim(), sentAt: now.toISOString(), sentBy, coachId });
  }
  return result;
}
