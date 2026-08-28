import { useState } from "react";
import * as api from "../lib/api";
import { useToast } from "../lib/toast";

/**
 * The actual missing piece of the whole coach feature - a way to REQUEST a
 * coaching relationship in the first place. Everything else (freeze,
 * propose-a-change, scoring, roster) has been fully built and tested, but
 * without this, two people could never actually connect. Shown on a
 * runner's profile page, offering both directions since either the coach
 * or the athlete can be the one to initiate.
 */
export function CoachRequestBlock({ targetAccountId, targetName }: { targetAccountId: string; targetName: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"coach" | "athlete" | null>(null);
  const [sent, setSent] = useState<"coach" | "athlete" | null>(null);

  const send = async (asCoach: boolean) => {
    const kind = asCoach ? "coach" : "athlete";
    setBusy(kind);
    const r = await api.requestCoachRelationship(targetAccountId, asCoach);
    setBusy(null);
    if (r.ok) {
      setSent(kind);
      toast(asCoach ? `Asked to coach ${targetName}.` : `Asked ${targetName} to be your coach.`, "success");
    } else {
      toast(r.error.message ?? "Couldn't send that request.", "info");
    }
  };

  if (sent) {
    return (
      <div className="mt-3 rounded-2xl bg-slate-50 p-3.5 text-center text-[13px] font-semibold text-slate-500">
        Request sent — waiting on {targetName} to respond.
      </div>
    );
  }

  return (
    <div className="mt-3 flex gap-2">
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void send(true)}
        className="h-10 flex-1 rounded-full bg-slate-100 text-[13px] font-bold text-slate-700 disabled:opacity-50"
      >
        {busy === "coach" ? "Sending…" : `Offer to coach ${targetName.split(" ")[0]}`}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void send(false)}
        className="h-10 flex-1 rounded-full bg-slate-100 text-[13px] font-bold text-slate-700 disabled:opacity-50"
      >
        {busy === "athlete" ? "Sending…" : `Ask them to coach you`}
      </button>
    </div>
  );
}
