import { useState } from "react";
import { useLocation } from "react-router-dom";
import * as api from "../lib/api";
import { getRecentActions, getLastErrorShown } from "../lib/friction";
import { useAccount } from "../state/account";
import { Sheet, Icon } from "./ui";

/**
 * The in-app feedback channel (roadmap 0.7).
 *
 * Distinct from RunnerFeedbackSheet, which is PEER trust-rating between two
 * runners. That answers "is this person good to run with"; this answers "is
 * the app working". They share a word and nothing else.
 *
 * The auto-attached context is the entire point. "The button doesn't work" is
 * unactionable; "the button doesn't work, /training-plan, coach role, after
 * tapping Add run, with 'Couldn't save.' on screen" is a bug report. The user
 * types one sentence and the report carries the rest.
 */

const CATEGORIES: { id: api.FeedbackCategory; label: string; hint: string }[] = [
  { id: "broken", label: "Something's broken", hint: "Sent to us right away" },
  { id: "confusing", label: "Confusing", hint: "" },
  { id: "idea", label: "Idea", hint: "" },
  { id: "praise", label: "Praise", hint: "" },
];

export function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  const { role } = useAccount();
  const [category, setCategory] = useState<api.FeedbackCategory | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setCategory(null); setMessage(""); setSent(false); setError(null); };
  const close = () => { onClose(); setTimeout(reset, 250); };

  const submit = async () => {
    if (!category || !message.trim()) return;
    setBusy(true);
    setError(null);
    const r = await api.submitFeedback(category, message.trim(), {
      path: location.pathname,
      role,
      viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : null,
      appVersion: (import.meta.env as Record<string, unknown>).VITE_BUILD_ID as string | undefined ?? null,
      recentActions: getRecentActions(),
      onScreenError: getLastErrorShown(),
    });
    setBusy(false);
    if (r.ok) setSent(true);
    else setError(r.error.message ?? "Couldn't send that — try again in a moment.");
  };

  return (
    <Sheet open={open} onClose={close} title={sent ? "Thanks" : "What's not working?"} subtitle={sent ? undefined : "This goes straight to the person building Kimbio."}>
      {sent ? (
        <div className="space-y-4 pb-2">
          <p className="text-[14px] leading-relaxed text-slate-600">
            {category === "broken"
              ? "Sent. We'll see this right away, and we can reply to you directly."
              : "Logged — we read every one of these."}
          </p>
          <button type="button" onClick={close} className="h-11 w-full rounded-xl bg-[#14171C] text-[14px] font-bold text-white">Done</button>
        </div>
      ) : (
        <div className="space-y-4 pb-2">
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                aria-pressed={category === c.id}
                className={`flex h-11 items-center justify-center rounded-xl px-3 text-[13px] font-bold ${category === c.id ? "bg-[#14171C] text-white" : "bg-slate-100 text-slate-700"}`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What happened? Even one line helps."
            rows={4}
            maxLength={2000}
            className="w-full resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-[15px] outline-none focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60"
          />

          {/* Shown, not hidden: the reporter should know what they're sending. */}
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Sent with your report</p>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
              The page you're on ({location.pathname}), your device, and your last few taps — so we can reproduce it without asking you questions.
            </p>
          </div>

          {error ? <p className="text-[13px] font-semibold text-rose-600">{error}</p> : null}

          <button
            type="button"
            disabled={!category || !message.trim() || busy}
            onClick={() => void submit()}
            className="h-11 w-full rounded-xl bg-[#14171C] text-[14px] font-bold text-white disabled:opacity-40"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      )}
    </Sheet>
  );
}

/** Persistent affordance — available on every screen, per Launch Readiness §3.1. */
export function FeedbackLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Send feedback about Kimbio"
        title="Send feedback"
        className="fixed bottom-28 right-3 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-slate-500 shadow-md ring-1 ring-slate-200 backdrop-blur active:scale-95 sm:bottom-6"
      >
        <Icon name="megaphone" className="h-4 w-4" />
      </button>
      <FeedbackSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
