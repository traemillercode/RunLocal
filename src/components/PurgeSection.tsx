import { useState } from "react";
import * as api from "../lib/api";
import { Button } from "./Button";

/**
 * Clearing test data.
 *
 * THE ENDPOINTS AND THE CLIENT FUNCTIONS BOTH ALREADY EXISTED — purge-preview,
 * purge-all and purge on the server, adminPurgePreview / adminPurgeAll /
 * adminPurge in lib/api — and nothing rendered them. Working capability with no
 * path to it, which is the ninth instance of that pattern in this build and the
 * reason "I can't delete anything" was true while the code to do it sat there.
 *
 * PREVIEW BEFORE DESTROY. The count and the addresses come back first, so the
 * confirmation is against a real list rather than a promise. `expectedCount`
 * goes back with the request: if the number changed between preview and
 * confirm, the server refuses rather than deleting more than was shown.
 *
 * This is the one place in the product where a confirmation dialog is CORRECT.
 * The safety rule — never confirm a safety action — exists because someone
 * blocking a person who frightens them should not be asked twice. The opposite
 * applies here: this is irreversible, unhurried, and typing DELETE ALL is the
 * point rather than friction to be minimised.
 */
export function PurgeSection({ reason }: { reason: string }) {
  const [preview, setPreview] = useState<{ count: number; emails: string[] } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const loadPreview = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    const r = await api.adminPurgePreview(reason);
    setBusy(false);
    if (!r.ok) { setError(r.error.message ?? "Couldn't load the preview."); return; }
    setPreview(r.data);
  };

  const purgeAll = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const r = await api.adminPurgeAll(confirmText, preview.count, reason);
    setBusy(false);
    if (!r.ok) { setError(r.error.message ?? "That didn't work."); return; }
    setDone(`Deleted ${r.data.deletedCount} account${r.data.deletedCount === 1 ? "" : "s"}.`);
    setPreview(null);
    setConfirmText("");
  };

  const retentionPurge = async () => {
    setBusy(true);
    setError(null);
    const r = await api.adminPurge(reason);
    setBusy(false);
    if (!r.ok) { setError(r.error.message ?? "That didn't work."); return; }
    setDone(`Purged ${r.data.purged} past-retention record${r.data.purged === 1 ? "" : "s"}; ${r.data.retained} retained.`);
  };

  return (
    <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-rose-200">
      <h2 className="text-[15px] font-extrabold text-slate-900">Clear test data</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
        Deletes every account except the owner, with everything attached to them — runs, check-ins,
        messages, memberships. Irreversible.
      </p>

      {done ? <p className="mt-3 text-[13px] font-bold text-emerald-700">{done}</p> : null}
      {error ? <p className="mt-3 text-[13px] font-bold text-rose-700">{error}</p> : null}

      {!preview ? (
        <Button variant="secondary" loading={busy} onClick={() => void loadPreview()} className="mt-3">
          {busy ? "Checking…" : "Show what would be deleted"}
        </Button>
      ) : (
        <div className="mt-3">
          {/*
            The actual list, not a number alone. "12 accounts" is a promise;
            twelve addresses is a thing you can check before destroying it.
          */}
          <p className="text-[13px] font-bold text-slate-900">
            {preview.count} account{preview.count === 1 ? "" : "s"} would be deleted:
          </p>
          <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto rounded-xl bg-slate-50 p-3">
            {preview.emails.map((e) => (
              <li key={e} className="text-[12px] tabular-nums text-slate-600">{e}</li>
            ))}
          </ul>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
              Type DELETE ALL to confirm
            </span>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE ALL"
              className="h-11 w-full rounded-[10px] border border-slate-300 px-3 text-[15px] outline-none focus:border-[#14171C]"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <Button
              variant="destructive"
              loading={busy}
              disabled={confirmText !== "DELETE ALL"}
              onClick={() => void purgeAll()}
            >
              {busy ? "Deleting…" : `Delete ${preview.count}`}
            </Button>
            <Button variant="ghost" onClick={() => { setPreview(null); setConfirmText(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/*
        Separate from the destructive path: retention purge removes records that
        are already past their retention window, which is routine rather than
        exceptional and needs no confirmation.
      */}
      <div className="mt-5 border-t border-slate-200 pt-4">
        <p className="text-[13px] font-semibold text-slate-700">Past-retention records</p>
        <p className="mt-0.5 text-[12px] text-slate-500">
          Removes records older than the retention window. Routine; does not touch active accounts.
        </p>
        <Button variant="ghost" loading={busy} onClick={() => void retentionPurge()} className="mt-2">
          {busy ? "Purging…" : "Purge past-retention"}
        </Button>
      </div>
    </section>
  );
}
