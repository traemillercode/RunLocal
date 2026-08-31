import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { SafetyActions } from "./SafetyActions";

/**
 * Who's going, in full, with a block reachable from each name.
 *
 * THE MOMENT THE SAFETY DOCUMENT IS ABOUT. Every other entry point — profile,
 * conversation, forum — is somewhere she has already engaged. This is the
 * decision point: she is looking at Saturday, deciding whether to go, and his
 * name is on the list.
 *
 * Expanding past the card's four is safe because the server filters through
 * hiddenFrom, not because the cap was ever a privacy boundary. The cap stops
 * the list LENGTH revealing how many people are hiding; it was never a limit on
 * how many names a member may see.
 *
 * The count shown on the card is deliberately NOT this list's length. It comes
 * from the summary endpoint unfiltered, so a blocked person sees the same
 * number everyone else does — if it were derived from here, he would see a
 * smaller one and the block would be readable.
 */
export function AttendeeListSheet({ occurrenceId, onClose }: { occurrenceId: string; onClose: () => void }) {
  const [rows, setRows] = useState<api.OccurrenceAttendee[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api.getOccurrenceAttendees(occurrenceId).then((r) => {
      if (!alive) return;
      if (r.ok) setRows(r.data.attendees);
      else setError(r.error.message);
    });
    return () => { alive = false; };
  }, [occurrenceId]);

  /*
   * Escape closes, matching every other sheet. Someone who opened this to check
   * for one name and found it should be able to leave immediately.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 pb-8 sm:rounded-2xl sm:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold text-slate-900">Who&apos;s going</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-slate-100">
            <span aria-hidden="true" className="text-[18px] leading-none text-slate-500">×</span>
          </button>
        </div>

        {error ? <p className="mt-3 text-[13px] font-semibold text-rose-600">{error}</p> : null}

        {rows === null ? (
          <p className="mt-4 text-[13px] text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-[13px] text-slate-500">Nobody has RSVP&apos;d yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {rows.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-[12px] font-bold text-slate-700">
                  {p.initials}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-slate-900">{p.name}</span>
                {/*
                  Inline, so blocking never requires opening his profile — the
                  last page she wants to pass through on the way to protecting
                  herself.
                */}
                <SafetyActions accountId={p.id} displayName={p.name} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
