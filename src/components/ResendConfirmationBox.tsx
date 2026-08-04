/**
 * Presentational resend-confirmation action shared by the login page (email is
 * already known from the signup attempt) and the confirmation page (email is
 * typed or prefilled from the query string). Honest by contract: the success
 * message never claims the email was delivered — the provider only accepted the
 * request, and when email delivery isn't configured the UI says so.
 */
import type { SupabaseClientConfig } from "../lib/supabase";
import { PillButton } from "./ui";
import { normalizeErrorMessage } from "../lib/errors";

export function ResendConfirmationBox({
  email,
  deliveryState,
  resending,
  error,
  notice,
  onResend,
}: {
  email: string;
  deliveryState: SupabaseClientConfig["emailDelivery"];
  resending: boolean;
  error: string | null;
  notice: string | null;
  onResend: () => void;
}) {
  return (
    <div className="rounded-xl bg-sky-50 p-3.5 text-[13px] text-sky-900">
      <p className="font-semibold">Didn't get the confirmation email?</p>
      <p className="mt-1 text-sky-800">
        We can send a fresh confirmation link to <span className="font-semibold">{email}</span>.
      </p>
      {deliveryState === "not-configured" && (
        <p className="mt-1 text-amber-700">Email delivery isn't confirmed on this deployment — delivery is not guaranteed.</p>
      )}
      <PillButton variant="secondary" className="mt-2.5 w-full" disabled={resending} onClick={onResend}>
        {resending ? "Sending…" : "Resend confirmation email"}
      </PillButton>
      {notice ? <p className="mt-2 rounded-lg bg-emerald-50 p-2.5 text-emerald-900">{notice}</p> : null}
      {error ? (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2.5 text-red-800">
          {normalizeErrorMessage(error)}
        </p>
      ) : null}
    </div>
  );
}
