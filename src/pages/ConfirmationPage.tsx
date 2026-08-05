/**
 * Confirmation callback page.
 *
 * Success (type=signup): tells the runner their email is confirmed and routes
 * to login.
 *
 * Error (expired/invalid link): the old behavior only offered "Request a new
 * confirmation email" as a button that navigated to login — it never actually
 * requested anything. Now the error state asks for the email (prefilled from
 * the `email` query param when available) and issues a real resend through
 * supabase.resendConfirmationEmail, with loading/error/success feedback and an
 * honest delivery caveat. Delivery is never claimed.
 */
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PillButton } from "../components/ui";
import { ResendConfirmationBox } from "../components/ResendConfirmationBox";
import * as supabase from "../lib/supabase";
import { normalizeErrorMessage } from "../lib/errors";
import { useAccount } from "../state/account";
import { cancelCallback } from "../lib/callbackNavigation";

const inputCls =
  "h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-[16px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#14171C] focus:ring-2 focus:ring-[#FF5741]/60";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function ConfirmationPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rawError = params.get("error");
  const error = rawError ? normalizeErrorMessage(rawError, "Confirmation link unavailable. Please request a new one.") : null;
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [deliveryState] = useState(() => supabase.supabaseClientConfig().emailDelivery);
  const { me } = useAccount();

  const emailValid = EMAIL_RE.test(email.trim());

  const resend = async () => {
    setResendError(null);
    setResendNotice(null);
    if (!emailValid) {
      setResendError("Enter a valid email first.");
      return;
    }
    setResending(true);
    const r = await supabase.resendConfirmationEmail(email.trim());
    setResending(false);
    if (!r.ok) {
      setResendError(r.message);
      return;
    }
    setResendNotice("Confirmation email requested. If that address exists, check your inbox (and spam folder) — delivery depends on the configured email provider.");
  };

  if (!error) {
    const signedIn = me?.status === "signed_in";
    return (
      <div className="mx-auto w-full max-w-md px-4 pb-32 pt-8">
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
          <h1 className="text-xl font-extrabold">Email confirmed</h1>
          <p className="mt-2 text-sm text-slate-600">
            {signedIn ? "You’re signed in and your Run Local account is linked." : "Your email is confirmed. Log in to continue."}
          </p>
          <PillButton variant="primary" className="mt-5 w-full" onClick={() => navigate(signedIn ? "/profile" : "/login")}>
            {signedIn ? "Go to my profile" : "Log in"}
          </PillButton>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-32 pt-8">
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
        <h1 className="text-xl font-extrabold">Confirmation link unavailable</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
        <p className="mt-3 text-sm text-slate-600">Enter the email you signed up with and we'll send a fresh confirmation link.</p>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-semibold">Email</span>
          <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </label>
        <div className="mt-4">
          <ResendConfirmationBox
            email={email.trim() || "your email"}
            deliveryState={deliveryState}
            resending={resending}
            error={resendError}
            notice={resendNotice}
            onResend={() => void resend()}
          />
        </div>
        <button type="button" onClick={() => navigate("/login")} className="mt-4 block w-full text-center text-sm font-semibold text-[#14171C] underline">
          Go to log in
        </button>
        <button type="button" onClick={() => cancelCallback(navigate, "/")} className="mt-3 block w-full text-center text-sm font-semibold text-slate-600 underline">
          Cancel
        </button>
      </section>
    </div>
  );
}
