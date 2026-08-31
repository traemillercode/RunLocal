import { useState } from "react";
import * as api from "../lib/api";
import { Icon } from "./ui";

/**
 * Block and report, from anywhere his name appears to her.
 *
 * THE WHOLE BLOCK SYSTEM WAS SERVER-COMPLETE AND UNREACHABLE. Silence,
 * symmetry, capability enforcement, the union with deleted and suspended — all
 * verified, all correct, and no user could invoke any of it. The api.ts wrapper
 * even existed with the right endpoint and the right comment, so a grep for "is
 * blocking wired?" returned a hit and said yes. A client path that stops one
 * layer short of a user is more misleading than none, because it passes the
 * obvious check.
 *
 * ONE ACTION, not two. Someone in the moment should not have to choose between
 * protecting herself and telling us: the block takes effect instantly and the
 * report queues. Reporting alone is also offered, because not everything that
 * needs saying needs a block.
 *
 * NO CONFIRMATION DIALOG. "Are you sure?" on a safety action is friction
 * pointed at exactly the wrong person. The caveats panel is not a confirmation
 * — it appears AFTER the block has taken effect and tells her what it did not
 * cover.
 */
export function SafetyActions({
  accountId,
  displayName,
  conversationId,
  onBlocked,
}: {
  accountId: string;
  displayName: string;
  /** Passed through on a report so the queue has the thread it came from. */
  conversationId?: string;
  onBlocked?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "report" | "done">("menu");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caveats, setCaveats] = useState<api.BlockCaveat[]>([]);

  const close = () => { setOpen(false); setMode("menu"); setReason(""); setError(null); setCaveats([]); };

  const block = async (withReport: boolean) => {
    if (withReport && reason.trim().length < 5) { setError("Give a bit more detail (at least 5 characters)."); return; }
    setBusy(true);
    setError(null);
    /*
     * BLOCK FIRST, and do not let the report's outcome gate it. She is
     * protected the moment the block lands; a failed report is a thing to
     * retry, not a reason to leave her unprotected.
     */
    const r = await api.blockConnection(accountId);
    if (!r.ok) { setBusy(false); setError(r.error.message); return; }
    setCaveats(r.data.caveats ?? []);
    if (withReport) void api.reportRunner(accountId, reason.trim(), conversationId);
    setBusy(false);
    setMode("done");
    onBlocked?.();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Safety options for ${displayName}`}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <Icon name="more" className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" onClick={close}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-8 sm:rounded-2xl sm:pb-5" onClick={(e) => e.stopPropagation()}>
        {mode === "done" ? (
          <>
            <h2 className="text-lg font-extrabold text-slate-900">{displayName} is blocked</h2>
            <p className="mt-1 text-[14px] text-slate-600">
              They won&apos;t see your profile, your RSVPs, or be able to message you. They&apos;re not told.
            </p>
            {/*
              THE CAVEATS PANEL. Not a confirmation — the block has already
              happened. It exists so she does not discover months later that
              something was not covered, and so she can decide what to do about
              it. Empty in the common case, and then nothing renders.
            */}
            {caveats.length > 0 ? (
              <div className="mt-4 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
                <p className="text-[13px] font-bold text-amber-900">What this doesn&apos;t cover</p>
                <ul className="mt-2 space-y-2">
                  {caveats.map((c) => (
                    <li key={c.groupId} className="text-[13px] leading-relaxed text-amber-900">
                      {c.kind === "leads_group" ? (
                        <>
                          They <strong>lead {c.groupName}</strong>, which you&apos;re in. Leaders can see the check-in
                          roster and moderate posts, and blocking can&apos;t change that. We&apos;ve flagged this for
                          review.
                        </>
                      ) : (
                        <>
                          You&apos;re both in <strong>{c.groupName}</strong>. They&apos;ll still see what you post in
                          the club thread.
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <button type="button" onClick={close} className="mt-5 h-11 w-full rounded-xl bg-[#14171C] text-[14px] font-bold text-white">
              Done
            </button>
          </>
        ) : mode === "report" ? (
          <>
            <h2 className="text-lg font-extrabold text-slate-900">Block and report {displayName}</h2>
            <p className="mt-1 text-[13px] text-slate-600">
              They&apos;re blocked straight away. Tell us what happened and we&apos;ll read it within 24 hours.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="What happened?"
              className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-[15px] outline-none focus:border-[#14171C]"
            />
            {error ? <p className="mt-2 text-[13px] font-semibold text-rose-600">{error}</p> : null}
            <button
              type="button"
              onClick={() => void block(true)}
              disabled={busy}
              className="mt-3 h-11 w-full rounded-xl bg-[#FF5741] text-[14px] font-bold text-[#14171C] disabled:opacity-40"
            >
              {busy ? "Blocking…" : "Block and report"}
            </button>
            <button type="button" onClick={close} className="mt-2 h-11 w-full rounded-xl text-[14px] font-bold text-slate-600">
              Cancel
            </button>
          </>
        ) : (
          <>
            <h2 className="text-lg font-extrabold text-slate-900">{displayName}</h2>
            {error ? <p className="mt-2 text-[13px] font-semibold text-rose-600">{error}</p> : null}
            {/* Block and report first: it is the action someone in the moment
                needs, and it should not be below the quieter one. */}
            <button
              type="button"
              onClick={() => setMode("report")}
              className="mt-4 h-11 w-full rounded-xl bg-[#FF5741] text-[14px] font-bold text-[#14171C]"
            >
              Block and report
            </button>
            <button
              type="button"
              onClick={() => void block(false)}
              disabled={busy}
              className="mt-2 h-11 w-full rounded-xl text-[14px] font-bold text-slate-900 ring-1 ring-slate-300 disabled:opacity-40"
            >
              {busy ? "Blocking…" : "Block only"}
            </button>
            <button type="button" onClick={close} className="mt-2 h-11 w-full rounded-xl text-[14px] font-bold text-slate-600">
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
