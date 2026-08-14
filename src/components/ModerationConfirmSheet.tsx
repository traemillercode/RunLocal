/**
 * Confirmation sheet for moderation actions (Phase 1 of the role-aware
 * moderation UI). Built on the shared `Sheet`.
 *
 * Two variants:
 * - Variant A (`requireReason`): destructive action, e.g. Hide/Delete. The
 *   moderator must type a 5–500 character reason before confirming. Shows a
 *   live character counter, honest impact copy, and any server error via
 *   `role="alert"`. The confirm button is disabled while busy or until the
 *   reason meets the minimum.
 * - Variant B: plain confirm (e.g. Withdraw, Restore, Archive). No reason
 *   field. Report-style confirmations pass a `note` (e.g. "Only Run Local
 *   admins see your report and your name.") which renders under the buttons.
 *
 * The component is presentational: it renders exactly what the caller passes
 * (title, entity summary, impact, verb labels) and never decides what a role
 * may do — authorization stays server-side.
 */
import { useState } from "react";
import { Icon, PillButton, Sheet } from "./ui";

const REASON_MIN = 5;
const REASON_MAX = 500;

export function ModerationConfirmSheet({
  open,
  onClose,
  title,
  entity,
  impact,
  confirmLabel,
  cancelLabel = "Cancel",
  requireReason = false,
  reasonLabel = "Reason",
  reasonPlaceholder = "Explain what's wrong and what you did to check",
  note,
  busy = false,
  error = null,
  tone = "danger",
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  /** Sheet title, e.g. "Hide this run?" */
  title: string;
  /** Entity summary line, e.g. "Tuesday Track Night · Thu, Jun 12". */
  entity: string;
  /** Honest impact copy, e.g. "The run will disappear from public listings." */
  impact: string;
  /** Confirm button verb, e.g. "Hide run". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Variant A: require a 5–500 character reason before confirming. */
  requireReason?: boolean;
  /** Applicant-facing reason label, e.g. "Rejection reason (the submitter will see this)". */
  reasonLabel?: string;
  /** Placeholder for the Variant A reason field. */
  reasonPlaceholder?: string;
  /** Optional privacy/trust note shown under the buttons (variant B, report flow). */
  note?: string;
  /** In-flight state: buttons and the reason field are disabled. */
  busy?: boolean;
  /** Server-side error message, announced via role="alert". */
  error?: string | null;
  /** Confirm button color: "danger" (red, destructive) or "neutral" (dark, routine). */
  tone?: "danger" | "neutral";
  /** Called with the reason string ("" when requireReason is false). */
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;

  const handleConfirm = () => {
    if (requireReason && !reasonValid) return;
    onConfirm(requireReason ? trimmed : "");
  };

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-[14px] font-bold text-slate-900">{entity}</p>
          <p className="text-[13px] leading-relaxed text-slate-500">{impact}</p>
        </div>

        {requireReason ? (
          <div className="space-y-1.5">
            <label htmlFor="moderation-reason" className="block text-[13px] font-semibold text-slate-800">
              {reasonLabel} <span className="font-normal text-slate-400">(required)</span>
            </label>
            <textarea
              id="moderation-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={REASON_MAX}
              disabled={busy}
              placeholder={reasonPlaceholder}
              rows={3}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] text-slate-900 placeholder:text-slate-400 focus:border-[#FF5741] focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
            />
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">{reasonValid ? "" : `${REASON_MIN}–${REASON_MAX} characters`}</span>
              <span className={reason.length >= REASON_MAX ? "font-semibold text-amber-700" : "text-slate-400"}>
                {reason.length} / {REASON_MAX}
              </span>
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-[13px] leading-relaxed text-red-800">
            <Icon name="alertTriangle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}

        <div className="flex gap-3">
          <PillButton variant="ghost" className="flex-1" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </PillButton>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || (requireReason && !reasonValid)}
            className={`rl-control inline-flex desktop-compact-control min-h-11 flex-1 items-center justify-center gap-2 px-5 text-sm font-semibold transition-colors disabled:bg-slate-200 disabled:text-slate-400 ${
              tone === "danger" ? "bg-red-600 text-white active:bg-red-700" : "bg-[#14171C] text-white active:bg-[#252a31]"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>

        {note ? <p className="text-center text-xs leading-relaxed text-slate-400">{note}</p> : null}
      </div>
    </Sheet>
  );
}
