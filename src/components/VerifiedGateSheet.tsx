/**
 * Shared "verified runners only" gate — shown when a guest, pending, or
 * rejected user taps RSVP / post / submit. Pending users are read-only, so
 * the sheet explains their status and routes them to /verify to finish (or
 * start). Rejected users are a DISTINCT state: denied copy with their private
 * rejection reason and NO "continue verification" action — never presented as
 * pending.
 *
 * VERIFIED members are not locked out of anything, so they must never fall
 * through to the guest ("Create account") copy. Defensive branch: if a
 * verified user ever lands here, show honest "not open yet" copy instead —
 * never a sign-up/verification gate.
 */
import { useNavigate } from "react-router-dom";
import type { AccountRole } from "../lib/accounts";
import { Icon, PillButton, Sheet } from "./ui";

export function VerifiedGateSheet({
  open,
  onClose,
  role,
  actionLabel,
  pendingLabel,
  rejectionReason = null,
}: {
  open: boolean;
  onClose: () => void;
  role: AccountRole;
  /** e.g. "RSVP to runs" */
  actionLabel: string;
  /** e.g. "Your profile is under review." */
  pendingLabel: string;
  /** Private, applicant-facing rejection reason (only when role === "rejected"). */
  rejectionReason?: string | null;
}) {
  const navigate = useNavigate();
  const subtitle =
    role === "rejected"
      ? "Your profile stays read-only"
      : role === "pending"
        ? "Pending profiles are read-only"
        : role === "verified"
          ? "Coming soon for verified members"
          : "Read-only until you're verified";
  return (
    <Sheet open={open} onClose={onClose} title="Verified runners only" subtitle={subtitle}>
      <div className="space-y-4">
        {role === "rejected" ? (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 p-3.5 text-[13px] leading-relaxed text-red-800">
            <Icon name="close" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">Verification denied.</span> {actionLabel} requires a verified runner
              profile, and your verification was not approved — so your profile stays read-only.
              {rejectionReason ? (
                <span className="mt-1.5 block rounded-lg bg-white/70 px-2.5 py-1.5 text-[12px] leading-relaxed">
                  <span className="font-semibold">Why:</span> {rejectionReason}
                </span>
              ) : null}
            </span>
          </p>
        ) : role === "pending" ? (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3.5 text-[13px] leading-relaxed text-amber-900">
            <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">{pendingLabel}</span> You can browse everything, but {actionLabel} is
              limited to verified runners.
            </span>
          </p>
        ) : role === "verified" ? (
          <p className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3.5 text-[13px] leading-relaxed text-emerald-900">
            <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">You are verified.</span> {actionLabel} is not available yet — it launches
              soon for verified members, so no action is needed.
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3.5 text-[13px] leading-relaxed text-amber-900">
            <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">{actionLabel} requires a verified runner profile.</span> Sign up with
              your email and password, confirm your email, then complete a live selfie — reviewed by a person, never
              shown publicly.
            </span>
          </p>
        )}
        {role === "rejected" ? (
          <PillButton variant="secondary" className="w-full" onClick={() => { onClose(); navigate("/verify"); }}>
            <Icon name="shield" className="h-4 w-4" /> View my verification status
          </PillButton>
        ) : role === "pending" ? (
          <PillButton variant="secondary" className="w-full" onClick={() => { onClose(); navigate("/verify"); }}>
            <Icon name="chevronRight" className="h-4 w-4 rotate-180" /> Continue verification
          </PillButton>
        ) : role === "verified" ? (
          <PillButton variant="secondary" className="w-full" onClick={onClose}>
            <Icon name="check" className="h-4 w-4" /> Got it
          </PillButton>
        ) : (
          <PillButton variant="secondary" className="w-full" onClick={() => { onClose(); navigate("/login?mode=signup"); }}>
            <Icon name="shield" className="h-4 w-4" /> Create account
          </PillButton>
        )}
        <p className="text-center text-xs leading-relaxed text-slate-400">
          Only a Verified badge is shown publicly — never your phone, selfie, or activity details.
        </p>
      </div>
    </Sheet>
  );
}
