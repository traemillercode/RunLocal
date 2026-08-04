/**
 * Shared "verified runners only" gate — shown when a guest or pending user
 * taps RSVP / post / submit. Pending users are read-only, so the sheet
 * explains their status and routes them to /verify to finish (or start).
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
}: {
  open: boolean;
  onClose: () => void;
  role: AccountRole;
  /** e.g. "RSVP to runs" */
  actionLabel: string;
  /** e.g. "Your profile is under review." */
  pendingLabel: string;
}) {
  const navigate = useNavigate();
  return (
    <Sheet open={open} onClose={onClose} title="Verified runners only" subtitle="Pending profiles are read-only">
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3.5 text-[13px] leading-relaxed text-amber-900">
          <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
          {role === "pending" ? (
            <span>
              <span className="font-semibold">{pendingLabel}</span> You can browse everything, but {actionLabel} is
              limited to verified runners.
            </span>
          ) : (
            <span>
              <span className="font-semibold">{actionLabel} requires a verified runner profile.</span> Sign up with
              your email and password, confirm your email, then complete a live selfie — reviewed by a person, never
              shown publicly.
            </span>
          )}
        </p>
        {role === "pending" ? (
          <PillButton variant="secondary" className="w-full" onClick={() => { onClose(); navigate("/verify"); }}>
            <Icon name="chevronRight" className="h-4 w-4 rotate-180" /> Continue verification
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
