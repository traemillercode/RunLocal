import { useState } from "react";
import * as api from "../lib/api";
import { PillButton } from "./ui";

/**
 * Owner-only, irreversible: deletes every account except the owner's own.
 * Deliberately NOT a single button - preview first (shows exactly who'd be
 * deleted), then a literal typed confirmation, then a final button that's
 * disabled until the typed text matches exactly. The server independently
 * enforces the same gates (exact confirm string + a stale-count check
 * against what was actually previewed) - this UI can't be the only thing
 * standing between a click and real data loss.
 */
export function PurgeAllSection({ reason }: { reason: string }) {
  const [preview, setPreview] = useState<{ count: number; emails: string[] } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ deletedCount: number } | null>(null);

  const loadPreview = async () => {
    if (!reason.trim() || reason.trim().length < 5) { setError("Enter a reason above first."); return; }
    setError(null);
    setBusy(true);
    const r = await api.adminPurgePreview(reason.trim());
    setBusy(false);
    if (r.ok) setPreview(r.data);
    else setError(r.error.message ?? "Couldn't load the preview.");
  };

  const execute = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const r = await api.adminPurgeAll(confirmText, preview.count, reason.trim());
    setBusy(false);
    if (r.ok) {
      setResult({ deletedCount: r.data.deletedCount });
      setPreview(null);
      setConfirmText("");
    } else {
      setError(r.error.message ?? "Purge failed — nothing was deleted.");
    }
  };

  return (
    <section className="mt-4 rounded-2xl border-2 border-rose-200 bg-rose-50/40 p-5">
      <h2 className="text-[15px] font-bold text-rose-900">Danger zone — purge all accounts except yours</h2>
      <p className="mt-1 text-xs text-rose-700">Irreversible. Deletes every account except the owner's. Only ever use this to clear test/dev data before a real launch.</p>

      {result ? (
        <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-[13px] font-semibold text-emerald-800">
          Done — {result.deletedCount} account{result.deletedCount === 1 ? "" : "s"} deleted. Your account is untouched.
        </p>
      ) : null}

      {error ? <p role="alert" className="mt-3 rounded-xl bg-white p-3 text-[13px] font-semibold text-rose-800 ring-1 ring-rose-200">{error}</p> : null}

      {!preview ? (
        <PillButton variant="ghost" className="mt-3" disabled={busy} onClick={() => void loadPreview()}>
          {busy ? "Loading…" : "Preview what would be deleted"}
        </PillButton>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="max-h-40 overflow-y-auto rounded-xl bg-white p-3 ring-1 ring-rose-200">
            <p className="text-[13px] font-bold text-slate-900">{preview.count} account{preview.count === 1 ? "" : "s"} will be permanently deleted:</p>
            <ul className="mt-1.5 space-y-0.5">
              {preview.emails.map((e) => (
                <li key={e} className="truncate text-[12px] text-slate-600">{e}</li>
              ))}
            </ul>
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-semibold text-rose-800">Type DELETE ALL to confirm</label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE ALL"
              className="h-10 w-full rounded-xl border border-rose-300 bg-white px-3 text-[14px] outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-300"
            />
          </div>
          <div className="flex gap-2">
            <PillButton variant="ghost" className="flex-1" onClick={() => { setPreview(null); setConfirmText(""); setError(null); }}>
              Cancel
            </PillButton>
            <button
              type="button"
              disabled={busy || confirmText !== "DELETE ALL"}
              onClick={() => void execute()}
              className="flex-1 rounded-full bg-rose-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? "Deleting…" : `Permanently delete ${preview.count} account${preview.count === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
